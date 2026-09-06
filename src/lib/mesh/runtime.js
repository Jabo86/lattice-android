// RUNTIME DEL NODO SOVRANO — mette insieme protocollo, trasporto, mixnet e barometro.
// Gira solo quando l'utente sceglie la Modalità Nodo Sovrano. Il lavoro pesante (radio,
// socket) sta nel processo nativo separato: qui c'è lo svuotamento della posta, la decisione
// cieca su ogni pacchetto (inoltra / consegna / scarta) e il MIXNET.
import * as node from "./index";
import { wrap, MAX_PAYLOAD, MAX_PAYLOAD_SAFE, PACKET_SIZE, routeHybrid } from "./onion";
import * as transport from "./transport";
import { bytesToHex } from "../crypto";
import { hexToBytes } from "./onion";

let timer = null;
let deliverCb = null;
let queueCb = null;                  // coda dei messaggi in attesa (meshchat.flush)
// PROVA DEL RELAY: una cipolla a 4 salti indirizzata a NOI STESSI. La logica viene provata
// SEMPRE (il pacchetto entra anche dal cortocircuito interno, quindi la prova non dipende
// dall'eco del Wi-Fi), e in più si dice se il pacchetto è tornato anche DALLA RETE.
let selfTest = null;

// ── Vicini (dai beacon) ───────────────────────────────────────────────────────────────
// Un beacon dice SOLO "esisto e questa è la mia chiave mesh": nessun indirizzo Lattice,
// nessun nome, nessun numero. Serve a formare la rete senza alcun server e a scegliere i
// relay. Limite dichiarato: sul mezzo locale la presenza di un nodo è visibile per forza.
const BEACON_MAGIC = "LATBEACON1";
const PEER_TTL = 10 * 60 * 1000;
const peers = new Map();             // idHex → { pk, at }
let beaconAt = 0;
let queueAt = 0;
let carrierCb = null;      // funzione del ponte (impostata all'avvio)
let online = false;        // l'ultima operazione col server è andata a buon fine?
/// Lo comunica meshchat: serve a dire ai vicini "da me si può passare per internet".
export function setOnline(v) { online = !!v; }
export function isOnline() { return online; }
/// Vicini che hanno dichiarato di avere internet: sono i possibili PONTI.
export function bridgePeers(now = Date.now()) {
  const out = [];
  for (const [id, v] of peers) if (v.net && now - v.at <= PEER_TTL) out.push({ id, pk: v.pk, x: v.x || "" });
  return out;
}

export function knownPeers(now = Date.now()) {
  const out = [];
  for (const [id, v] of peers) if (now - v.at <= PEER_TTL) out.push({ id, pk: v.pk, x: v.x || "" });
  return out;
}
export function learnPeer(idHex, pkHex, now = Date.now(), net = false, xHex = "") {
  const me = node.nodeInfo();
  if (!/^[0-9a-f]{32}$/.test(idHex) || !/^[0-9a-f]{64,}$/.test(pkHex)) return false;
  if (me && idHex === me.id) return false;
  const x = /^[0-9a-f]{64}$/.test(String(xHex || "")) ? String(xHex) : "";
  peers.set(idHex, { pk: pkHex, at: now, net: !!net, x });
  if (peers.size > 256) { const k = peers.keys().next().value; if (k !== undefined) peers.delete(k); }
  return true;
}
export function forgetPeers() { peers.clear(); }

function beaconPacket() {
  const me = node.nodeInfo();
  if (!me) return null;
  // `net` dice ai vicini che da qui si può uscire su internet: è così che nasce il Ponte.
  // `x` e' la chiave su curva del nodo: la sua presenza e' cio' che rende possibile la
  // cipolla ibrida. Chi non la manda riceve comunque la cipolla precedente.
  const head = new TextEncoder().encode(BEACON_MAGIC + JSON.stringify({ id: me.id, pk: me.pk, x: me.x || "", net: online ? 1 : 0 }));
  if (head.length > PACKET_SIZE) return null;
  const out = new Uint8Array(PACKET_SIZE);
  (globalThis.crypto || global.crypto).getRandomValues(out);   // riempimento casuale
  out.set(head, 0);
  out[head.length] = 0;                                        // fine del testo
  return out;
}
function readBeacon(bytes) {
  for (let i = 0; i < BEACON_MAGIC.length; i++) if (bytes[i] !== BEACON_MAGIC.charCodeAt(i)) return null;
  let end = BEACON_MAGIC.length;
  while (end < bytes.length && bytes[end] !== 0) end++;
  try { return JSON.parse(new TextDecoder().decode(bytes.subarray(BEACON_MAGIC.length, end))); }
  catch { return null; }
}

/// Percorso a 4 salti verso un nodo: fino a 2 relay veri fra quelli visti di recente, poi
/// il destinatario. I salti mancanti sono il destinatario stesso: i suoi strati li sbuccia
/// in memoria (nessun giro in più sulla rete).
export function routeTo(destIdHex, destPkHex, destXHex) {
  if (!/^[0-9a-f]{32}$/.test(String(destIdHex)) || !destPkHex) return null;
  const me = node.nodeInfo();
  const hyDest = /^[0-9a-f]{64}$/.test(String(destXHex || ""));
  const dest = { id: hexToBytes(destIdHex), pk: hexToBytes(destPkHex) };
  if (hyDest) dest.xpk = hexToBytes(destXHex);
  let pool = knownPeers().filter((p) => p.id !== destIdHex && (!me || p.id !== me.id));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  // Se il destinatario sa fare l'ibrido, si PREFERISCONO relay che lo sanno fare: basta un
  // salto senza curva per far scendere l'intero pacchetto alla cipolla precedente.
  if (hyDest) {
    const conX = pool.filter((p) => p.x);
    if (conX.length >= 2) pool = conX;
  }
  const relays = pool.slice(0, 2).map((p) => {
    const h = { id: hexToBytes(p.id), pk: hexToBytes(p.pk) };
    if (p.x) h.xpk = hexToBytes(p.x);
    return h;
  });
  const route = relays.concat([dest]);
  while (route.length < 4) route.push(dest);
  return route.slice(0, 4);
}

// ── MIXNET ────────────────────────────────────────────────────────────────────────────
// Senza accumulo, l'uscita segue l'ingresso a intervallo quasi fisso: un osservatore sullo
// stesso mezzo ricuce le tratte col solo tempo. Qui i pacchetti da inoltrare finiscono in
// una vasca, ognuno con un istante di partenza casuale; quando tocca a loro si spediscono
// RIMESCOLATI, così l'ordine d'uscita non racconta l'ordine d'ingresso.
const MIX_MIN = 400, MIX_MAX = 3500;
let mix = [];
export function mixSize() { return mix.length; }
export function mixReset() { mix = []; }

function mixPush(packet, next, now = Date.now()) {
  mix.push({ packet, next, due: now + MIX_MIN + Math.floor(Math.random() * (MIX_MAX - MIX_MIN)) });
}
/// Estrae i pacchetti pronti, RIMESCOLATI (non in ordine di arrivo).
export function mixDue(now = Date.now()) {
  const due = [], keep = [];
  for (const m of mix) (m.due <= now ? due : keep).push(m);
  mix = keep;
  for (let i = due.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [due[i], due[j]] = [due[j], due[i]]; }
  return due;
}

// ── Cortocircuito interno ─────────────────────────────────────────────────────────────
// Quando il salto successivo siamo NOI (percorsi con il destinatario ripetuto, e la prova
// del relay), il pacchetto non esce affatto: rientra in memoria. Così la Prova 2 funziona
// anche su reti che non restituiscono il proprio broadcast.
let localIn = [];
export function localCount() { return localIn.length; }

async function handle(p, fromNet) {
  const r = node.ingest(p);
  if (r.action === "forward") {
    if (selfTest && !selfTest.done) { selfTest.hops++; if (fromNet) selfTest.net = true; }
    const me = node.nodeInfo();
    if (me && String(r.next) === me.id) localIn.push(r.packet);       // salto verso noi stessi
    else mixPush(r.packet, r.next);
    return;
  }
  if (r.action === "deliver") {
    const txt = (() => { try { return new TextDecoder().decode(r.payload); } catch { return ""; } })();
    if (selfTest && !selfTest.done && txt.indexOf(selfTest.code) === 0) {
      selfTest.done = true;
      selfTest.ms = Date.now() - selfTest.startedAt;
      if (fromNet) selfTest.net = true;
      return;
    }
    // PONTE: se il pacchetto è la spedizione di un altro, va spinto sul server per lui.
    if (carrierCb) {
      try { if (await carrierCb(r.payload)) return; } catch { /* il mittente riproverà */ }
    }
    if (deliverCb) { try { await deliverCb(r.payload); } catch { /* la consegna non ferma il nodo */ } }
  }
}

async function pump() {
  try {
    // 1) posta dalla rete
    const packets = await transport.receive();
    for (const p of packets) {
      const b = readBeacon(p);
      if (b) { learnPeer(String(b.id || ""), String(b.pk || ""), Date.now(), !!b.net, String(b.x || "")); continue; }
      await handle(p, true);
    }
    // 2) cortocircuito interno (salti verso noi stessi): si svuota tutto subito, sono
    //    sbucciature in memoria e non giri di rete (il tetto evita cicli infiniti).
    let guard = 0;
    while (localIn.length && guard++ < 64) {
      const p = localIn.shift();
      await handle(p, false);
    }
    // 3) mixnet: quello che è pronto esce rimescolato
    for (const m of mixDue()) {
      try { await transport.send(m.packet, m.next); } catch { mix.push(m); }
    }
    // 4) beacon: ogni 20-45 s, mai a cadenza fissa
    const now = Date.now();
    // Più insistente quando non si vede NESSUNO: è il momento in cui serve farsi trovare
    // (senza internet è l'unico modo per accorgersi l'uno dell'altro).
    const alone = knownPeers().length === 0;
    if (now - beaconAt > (alone ? 4000 + Math.random() * 3000 : 20000 + Math.random() * 25000)) {
      beaconAt = now;
      const bp = beaconPacket();
      if (bp) { try { await transport.send(bp, null); } catch { /* si riprova */ } }
    }
    // 5) messaggi in attesa: se è tornato il server o è apparso un nodo, partono da soli.
    //    Non a ogni giro: la coda apre un blob cifrato e tenta la rete, ogni 20 s è già
    //    abbondante e non trasforma l'attesa in traffico continuo.
    if (queueCb && now - queueAt > 20000) { queueAt = now; try { await queueCb(); } catch { /* niente */ } }
  } catch { /* il nodo non deve mai far cadere l'app */ }
}

/// Accende il nodo. `user` serve solo per derivare le chiavi mesh (nessuna chiave nuova).
/// `onDeliver` riceve i messaggi arrivati per noi, `onQueue` fa girare la coda.
export async function start(user, onDeliver, onQueue, onCarry) {
  if (!user || !user.kem || !user.kem.secretKey) throw new Error("identità non disponibile");
  deliverCb = onDeliver || null;
  queueCb = onQueue || null;
  carrierCb = onCarry || null;
  const info = node.initNode(bytesToHex(user.kem.secretKey));
  await node.setMode(node.SOVEREIGN);
  await transport.writeMode(true);   // accende SUBITO il motore nativo (MeshControl)
  if (timer) clearTimeout(timer);
  // Cadenza CASUALE (non fissa): una cadenza fissa è essa stessa un'impronta riconoscibile.
  const jitter = () => 700 + Math.floor(Math.random() * 2100);
  const loop = async () => { await pump(); if (timer) timer = setTimeout(loop, jitter()); };
  timer = setTimeout(loop, jitter());
  return info;
}

export function running() { return !!timer; }

export async function stop() {
  if (timer) { clearTimeout(timer); timer = null; }
  deliverCb = null; queueCb = null; carrierCb = null;
  mixReset(); localIn = []; forgetPeers();
  await node.setMode(node.STANDARD);
  await transport.writeMode(false);
}

/// Avvia la prova del relay: cipolla a 4 salti verso noi stessi, spedita sulla rete reale E
/// immessa nel cortocircuito interno. Così la prova dice due cose distinte: la LOGICA (4
/// salti completati) e la RETE (il pacchetto è tornato anche dal Wi-Fi).
export async function startSelfTest() {
  const info = node.nodeInfo();
  if (!info) throw new Error("nodo non attivo");
  const code = "ST" + Math.random().toString(36).slice(2, 8).toUpperCase();
  const me = { id: hexToBytes(info.id), pk: hexToBytes(info.pk) };
  if (info.x) me.xpk = hexToBytes(info.x);
  const body = new TextEncoder().encode(code + ":prova-relay");
  if (body.length > MAX_PAYLOAD_SAFE) throw new Error("prova troppo grande");
  const pkt = wrap([me, me, me, me], body);   // tutti i salti siamo noi: nessun altro coinvolto
  selfTest = { code, hops: 0, done: false, net: false, startedAt: Date.now(), ms: 0 };
  try { await transport.send(pkt, info.id); } catch { /* la logica si prova comunque */ }
  localIn.push(pkt);
  return code;
}
export function selfTestStatus() {
  if (!selfTest) return null;
  return { code: selfTest.code, hops: selfTest.hops, done: selfTest.done, ms: selfTest.ms,
    net: !!selfTest.net, elapsed: Date.now() - selfTest.startedAt };
}

/// Stato per il Barometro: solo numeri anonimi.
export async function status() {
  const h = node.health();
  let st = await transport.stats();
  return { key: h.key, pulses: h.pulses, seen: st.seen, node: node.nodeInfo(),
    probes: st.probes, probeCode: st.probeCode, probeAt: st.probeAt, self: selfTestStatus(),
    neighbours: knownPeers().length, mix: mix.length,
    // Quanti vicini sanno fare la cipolla ibrida: si vede nel Barometro.
    hybrid: knownPeers().filter((p) => p.x).length,
    // Diagnostica del PROPRIO telefono: serve a capire in 5 secondi se il problema e' il
    // motore, il telefono o il router. Nessun dato di chi c'e' intorno.
    diag: { running: st.running, ip: st.ip, targets: st.targets, tx: st.tx, txErr: st.txErr,
      rx: st.rx, loops: st.loops, probes: st.probes, err: st.err, since: st.since,
      p2p: st.p2p, p2pPeers: st.p2pPeers, p2pFound: st.p2pFound, p2pClients: st.p2pClients,
      ble: st.ble, bleSeen: st.bleSeen, bleAt: st.bleAt, radioErr: st.radioErr } };
}

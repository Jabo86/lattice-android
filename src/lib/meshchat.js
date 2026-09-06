// CHAT REALE SULLA MESH — indipendenza dal server, senza che l'utente se ne accorga.
//
// Come funziona, in ordine:
//  1. Con il server raggiungibile il messaggio parte come sempre (/pulse/send).
//  2. Se il server non risponde e la Modalità Nodo Sovrano è accesa, il messaggio parte
//     sulla mesh: cipolla a 4 salti, cifrata ML-KEM-768 + AES-256-GCM verso la chiave mesh
//     del destinatario (derivata dalla sua identità: nessuna chiave nuova da custodire).
//  3. Se non c'è nessun percorso, resta in CODA cifrata sul telefono e parte da sola appena
//     torna il server o appena appare un nodo. In chat si vede l'icona "in attesa".
//
// Identità mesh del contatto: dalla sua chiave PUBBLICA non è ricavabile, quindi si scambia
// una volta dentro la chat cifrata (messaggio di controllo invisibile, come la cassetta
// anonima). Nello stesso scambio viaggia un SEGRETO CONDIVISO da 32 byte: ogni messaggio
// mesh porta un sigillo `sha3(segreto|canonico)`. Senza quel segreto — consegnato solo
// dentro la chat E2EE — nessuno può fabbricare un messaggio a nome di un contatto, anche
// conoscendo la chiave mesh pubblica (che sulla rete locale è visibile per forza).
//
// Limiti dichiarati: sulla mesh viaggia il TESTO (un pacchetto è di 8192 byte fissi).
// Foto, file e vocali passano da un blob sul server e restano in coda finché il server torna.
import { sha3_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, randomHex, packMessage, unpackMessage, encryptForRecipients } from "./crypto";
import { getBlob, setBlob } from "./lock";
import * as api from "./api";
import * as transport from "./mesh/transport";
import { wrap, MAX_PAYLOAD_SAFE, meshKeypair, meshXKeypair, nodeId, hexToBytes } from "./mesh/onion";
import { ratchetEnvelopesFor, tryRatchetDecrypt } from "./ratchet";
import { routeTo, setOnline, knownPeers } from "./mesh/runtime";
import * as bridge from "./bridge";
import * as gossip from "./mesh/gossip";

const BLOB = "mshc";
export const CTL_PREFIX = "\u0001msh:";
const REPUBLISH = 3 * 24 * 3600 * 1000;
const RESYNC = 10 * 60 * 1000;      // finché non abbiamo la SUA identità mesh si riprova spesso

// Contatori per la diagnostica (in memoria: nessun dato sensibile, solo numeri).
export const counters = { badSeal: 0, unknown: 0, delivered: 0, sent: 0, rat: 0, noRat: 0, passed: 0, partial: 0 };
let lastVia = "server";
export function via() { return lastVia; }

const enc8 = (s) => new TextEncoder().encode(s);
const h3 = (s) => bytesToHex(sha3_256(enc8(s)));

let identity = null;                 // serve alla coda quando nessuna chat è aperta
export function setIdentity(u) { identity = u && u.kem ? u : null; }

async function load() {
  const o = await getBlob(BLOB);
  return o && typeof o === "object" ? o : { peers: {}, msgs: {}, queue: [] };
}
async function save(o) { await setBlob(BLOB, o); }

function myMesh(user) {
  const sk = bytesToHex(user.kem.secretKey);
  const kp = meshKeypair(sk);
  const xkp = meshXKeypair(sk);
  return { id: bytesToHex(nodeId(kp.publicKey)), pk: bytesToHex(kp.publicKey),
           x: bytesToHex(xkp.publicKey) };
}

// ── Scambio dell'identità mesh (dentro la chat cifrata) ───────────────────────────────
/// Consegna al contatto id mesh, chiave mesh pubblica e il segreto con cui sigilleremo
/// i NOSTRI messaggi verso di lui. Ripetuto al massimo ogni 3 giorni.
export async function publishTo(peerLns, user, opts) {
  if (!user || !user.kem || !peerLns) return false;
  const o = opts || {};
  const st = await load();
  const p = st.peers[peerLns] || {};
  // RESYNC: se non abbiamo ancora la SUA identità mesh si riprova ogni 10 minuti (e si
  // chiede di rispondere subito), non ogni 3 giorni: altrimenti una presentazione persa
  // teneva la coppia fuori dalla mesh per giorni.
  const wait = p.sin ? REPUBLISH : RESYNC;
  if (!o.force && Date.now() - (p.published_at || 0) < wait) return false;
  if (!p.sout) p.sout = randomHex(32);
  const me = myMesh(user);
  const ask = o.req === false ? 0 : (p.sin ? 0 : 1);
  // `x` è la chiave su curva del nodo mesh: senza di essa la cipolla verso di lui resta
  // post-quantistica pura invece che ibrida.
  const payload = packMessage(CTL_PREFIX + JSON.stringify({ id: me.id, pk: me.pk, x: me.x, s: p.sout, req: ask }), [], null, 0);
  // Le buste sono quelle dei messaggi normali (ratchet quando c'è, più la copia per i MIEI
  // dispositivi): con `encryptForRecipients` la presentazione era leggibile solo dall'altro
  // e nella MIA chat restava un "messaggio non decifrabile".
  const { buildEnvelopes } = require("./send");
  const envelopes = await buildEnvelopes(payload, [peerLns], user);
  if (!envelopes.length) return false;
  await api.send({ to_lns: [peerLns], envelopes, silent: true });
  p.published_at = Date.now();
  st.peers[peerLns] = p;
  await save(st);
  return true;
}

/// Messaggio di controllo ricevuto: si memorizzano identità mesh e segreto del contatto.
export async function onControl(text, fromLns) {
  try {
    const d = JSON.parse(text.slice(CTL_PREFIX.length));
    if (!/^[0-9a-f]{32}$/.test(String(d.id || "")) || !/^[0-9a-f]{64,}$/.test(String(d.pk || ""))) return;
    if (!/^[0-9a-f]{64}$/.test(String(d.s || ""))) return;
    const st = await load();
    const p = st.peers[fromLns] || {};
    p.id = d.id; p.pk = d.pk; p.sin = d.s; p.at = Date.now();
    if (/^[0-9a-f]{64}$/.test(String(d.x || ""))) p.x = String(d.x);
    st.peers[fromLns] = p;
    await save(st);
    // Ci ha chiesto di rispondere: gli mandiamo subito la nostra (lo scambio si chiude in
    // un solo giro, appena la chat è aperta con internet attivo).
    if (d.req && identity) { try { await publishTo(fromLns, identity, { force: true, req: false }); } catch { /* si riprova */ } }
  } catch { /* controllo illeggibile: ignorato */ }
}

// ── FRAMMENTAZIONE ────────────────────────────────────────────────────────────────────
// Una busta del ratchet che porta l'aggancio iniziale pesa ~4,8 KB: in un pacchetto mesh
// (3524 byte utili con la cipolla ibrida) non ci sta. Si spezza in pezzi, ognuno dentro la
// SUA cipolla con il SUO percorso, e il destinatario la ricompone. I relay non vedono
// niente di diverso: per loro sono pacchetti da 8192 byte come tutti gli altri.
// I pezzi vivono solo in memoria e scadono: nessuna traccia sul telefono.
const FRAG_TTL = 5 * 60 * 1000;
const FRAG_MAX = 8;             // oltre, non si spedisce: sarebbe un messaggio da server
const frags = new Map();        // k → { n, parts, at }

function fragOf(text, budget) {
  const LIM = budget || MAX_PAYLOAD_SAFE;
  const bytes = enc8(text);
  if (bytes.length <= LIM) return [bytes];
  // Il contenuto in v2 è JSON puro ASCII (il testo sta dentro il cifrato in base64):
  // spezzare la STRINGA è quindi esatto byte per byte.
  const CH = LIM - 140;
  const n = Math.ceil(text.length / CH);
  if (n > FRAG_MAX) return null;
  const k = randomHex(6);
  const out = [];
  for (let i = 0; i < n; i++) {
    const piece = enc8(JSON.stringify({ v: 3, k, i, n, d: text.slice(i * CH, (i + 1) * CH) }));
    if (piece.length > LIM) return null;
    out.push(piece);
  }
  return out;
}

/// Rimette insieme i pezzi. Ritorna il testo completo, oppure null se ne mancano ancora.
function fragJoin(o) {
  const now = Date.now();
  for (const [key, v] of frags) if (now - v.at > FRAG_TTL) frags.delete(key);
  if (frags.size > 32) frags.delete(frags.keys().next().value);
  const k = String(o.k || "");
  const n = o.n | 0;
  const i = o.i | 0;
  if (!k || n < 2 || n > FRAG_MAX || i < 0 || i >= n || typeof o.d !== "string") return null;
  let st = frags.get(k);
  if (!st || st.n !== n) { st = { n, parts: new Array(n).fill(null), at: now }; frags.set(k, st); }
  st.parts[i] = o.d;
  st.at = now;
  if (st.parts.some((x) => x === null)) return null;
  frags.delete(k);
  return st.parts.join("");
}

// ── Invio ─────────────────────────────────────────────────────────────────────────────
function canon(o) { return [o.v, o.f, o.cid, o.at, o.v === 2 ? JSON.stringify(o.e) : o.b].join("|"); }

/// Contenuto della cipolla. Si preferisce SEMPRE la busta del ratchet (v2); si ripiega sul
/// formato precedente (v1, protetto dalla sola chiave mesh) soltanto se una sessione ratchet
/// non esiste ancora o se le buste non stanno in un pacchetto.
async function buildPayload(user, peer, cid, plain, peerLns, budget, info) {
  const body = packMessage(plain.text, [], plain.reply || null, plain.ttl || 0);
  if (peerLns) {
    try {
      const r = await ratchetEnvelopesFor(body, peerLns, user);
      if (r && r.envelopes && r.envelopes.length) {
        const o = { v: 2, f: user.lns, cid: cid || "", at: new Date().toISOString(), e: r.envelopes };
        o.mac = h3(peer.sout + "|" + canon(o));
        const parts = fragOf(JSON.stringify(o), budget);
        if (parts) { if (info) info.v = 2; return parts; }
      }
    } catch { /* nessuna sessione: si usa il formato precedente */ }
  }
  const o = { v: 1, f: user.lns, cid: cid || "", at: new Date().toISOString(), b: body };
  o.mac = h3(peer.sout + "|" + canon(o));
  const bytes = enc8(JSON.stringify(o));
  if (info) info.v = 1;
  return bytes.length > (budget || MAX_PAYLOAD_SAFE) ? null : [bytes];
}

/// Consegna sulla mesh, destinatario per destinatario.
///
/// Prima era tutto-o-niente: in un gruppo di cinque, con quattro a portata di radio e uno
/// lontano, non partiva niente per nessuno. Ora parte per chi c'è. Chi non c'è finisce in
/// `left` e lo prende in carico chi viene dopo (ponte, corriere, coda). Per chi ha
/// un'identità mesh ma non un percorso si costruisce comunque la copia sigillata, così un
/// altro membro può portargliela: quelle copie escono in `custody`.
///
/// Ritorna { done, left, custody }. `done` è consegnato DAVVERO, non "tentato".
export async function trySendTo(recipients, plain, convId, user) {
  const all = Array.isArray(recipients) ? recipients.slice() : [];
  const none = { done: [], left: all, custody: [] };
  if (!user || !user.kem || !plain || typeof plain.text !== "string" || !plain.text) return none;
  if (plain.atts && plain.atts.length) return none;       // foto/file: servono i blob sul server
  const st = await load();
  // Chi si vede ADESSO, per beacon. Il percorso a cipolla si costruisce comunque per tutti
  // (verso chi è a due salti passa dai relay), ma di chi non si vede non abbiamo prova che
  // sia raggiungibile: a quello si affida anche una copia a un altro membro.
  const near = new Set(knownPeers().map((p) => p.id));
  const done = [], left = [], custody = [], plans = [];
  for (const r of all) {
    const peer = st.peers[r];
    if (!peer || !peer.id || !peer.pk || !peer.sout) { left.push(r); continue; }  // mai presentato
    const vicino = near.has(peer.id);
    // Per chi non si vede la copia si fa più piccola: dovrà stare dentro il pacchetto di
    // custodia di un altro membro, che aggiunge la sua intestazione.
    const info = {};
    const parts = await buildPayload(user, peer, convId, plain, r, vicino ? 0 : MAX_PAYLOAD_SAFE - gossip.HEADROOM, info);
    if (!parts) { left.push(r); continue; }               // testo troppo lungo per un pacchetto
    for (const bytes of parts) plans.push({ peer, bytes });
    done.push(r);
    // La custodia si affida SOLO alle buste del ratchet (v2). Nel formato precedente (v1) il
    // corpo è protetto dai soli strati della cipolla: il membro che fa da corriere sbuccia
    // il suo strato, e a quel punto lo leggerebbe. Un messaggio in chiaro non si dà a
    // nessuno, nemmeno a un membro del gruppo — meglio che resti in coda.
    if (!vicino && info.v === 2) custody.push({ to: r, parts });
  }
  if (!done.length) return { done: [], left, custody };
  for (const p of plans) {
    const route = routeTo(p.peer.id, p.peer.pk, p.peer.x);
    if (!route) continue;
    await transport.send(wrap(route, p.bytes), bytesToHex(route[0].id));
  }
  // PASSAPAROLA: la copia di chi non si vede la porta un membro che si vede. Se poi arriva
  // anche per via diretta non è un problema: il sigillo è identico, e il destinatario
  // scarta il doppione (onDeliver confronta l'id ricavato dal sigillo).
  const relays = done.filter((l) => near.has(st.peers[l].id)).map((l) => Object.assign({ lns: l }, st.peers[l]));
  const passed = [];
  for (const c of custody) {
    try { if (await gossip.offer(c.to, c.parts, relays)) passed.push(c.to); } catch { /* pazienza */ }
  }
  const rest = left.slice();
  appendLocal(st, convId, { id: "msh-" + randomHex(6), mine: true, at: new Date().toISOString(),
    body: plain.text, atts: [], pending: false, via: "mesh" });
  await save(st);
  counters.sent++;
  if (passed.length) counters.passed += passed.length;
  lastVia = "mesh";
  return { done, left: rest, custody, passed };
}

/// Come prima: vero solo se TUTTI hanno ricevuto. Resta per chi ha un solo destinatario.
export async function trySend(recipients, plain, convId, user) {
  const r = await trySendTo(recipients, plain, convId, user);
  return r.done.length > 0 && r.left.length === 0;
}

/// Tiene solo le buste dei destinatari indicati (più le copie per i MIEI dispositivi):
/// ogni busta porta scritto per chi è, quindi ridurre l'elenco è esatto, non approssimato.
function envelopesFor(envelopes, keep, user) {
  if (!Array.isArray(envelopes)) return [];
  const mine = user && user.lns;
  return envelopes.filter((e) => keep.indexOf(e.for) >= 0 || (mine && e.for === mine));
}

/// UNICA VIA D'INVIO usata dalla chat: server → mesh → coda. L'utente non vede differenza.
export async function sendOrQueue(payload, convId, user, plain) {
  try {
    const r = await api.send(payload);
    lastVia = "server";
    setOnline(true);      // così i vicini sanno che da qui si può passare per internet
    return r;
  } catch (e) {
    if (!isOffline(e)) throw e;                            // 403, blocchi, errori veri: si mostrano
    setOnline(false);
    // Ogni meccanismo si prende la SUA parte dei destinatari, una volta sola: chi è stato
    // consegnato sulla mesh non viene rimesso in coda, altrimenti gli arriverebbe due volte.
    let to = payload.to_lns || [];
    try {
      const r = await trySendTo(to, plain || {}, convId, user);
      if (r.done.length && !r.left.length) return { conv_id: convId, via: "mesh" };
      if (r.done.length) {
        counters.partial++;
        to = r.left;                                       // restano solo quelli non raggiunti
        payload = Object.assign({}, payload, { to_lns: to, envelopes: envelopesFor(payload.envelopes, to, user) });
      }
    } catch { /* si prova il ponte */ }
    if (!to.length) return { conv_id: convId, via: "mesh" };
    // PONTE INTERNET: il destinatario è lontano e io non ho connessione, ma un nodo vicino
    // sì: gli passo la busta già cifrata e lui la spinge al server per me.
    try {
      const how = await bridge.sendVia(to, payload.envelopes || []);
      if (how) {
        const st2 = await load();
        if (plain && plain.text) {
          appendLocal(st2, convId, { id: "brg-" + randomHex(6), mine: true, at: new Date().toISOString(),
            body: plain.text, atts: [], pending: how === "ponte", via: how });
          await save(st2);
        }
        lastVia = how;                 // "ponte" (subito) oppure "corriere" (appena può)
        return { conv_id: convId, via: how };
      }
    } catch { /* si mette in coda */ }
    await enqueue(payload, convId, plain);
    return { conv_id: convId, queued: true };
  }
}

// Solo i guasti di RETE giustificano la mesh: un rifiuto del server (403, 400) è una
// risposta legittima e va mostrata all'utente, non aggirata.
function isOffline(e) {
  if (!e) return false;
  if (e.response && e.response.status) return e.response.status >= 500;
  return true;                                             // nessuna risposta = niente rete
}

async function enqueue(payload, convId, plain) {
  const st = await load();
  const id = "q-" + randomHex(6);
  st.queue = (st.queue || []).concat([{ id, to: payload.to_lns || [], cid: convId || "",
    plain: { text: (plain && plain.text) || "", reply: (plain && plain.reply) || null, ttl: (plain && plain.ttl) || 0 },
    at: new Date().toISOString() }]).slice(-200);
  if (plain && plain.text) {
    appendLocal(st, convId, { id, mine: true, at: new Date().toISOString(), body: plain.text, atts: [], pending: true });
  }
  await save(st);
}

/// Coda: si riprova PRIMA il server (se è tornato), poi la mesh. Gira da sola.
export async function flush(user) {
  const u = user && user.kem ? user : identity;
  if (!u) return 0;
  const st = await load();
  const q = st.queue || [];
  if (!q.length) return 0;
  let done = 0;
  const rest = [];
  for (const item of q) {
    let sent = false;
    try {
      const { buildEnvelopes } = require("./send");
      const payload = packMessage(item.plain.text, [], item.plain.reply, item.plain.ttl || 0);
      const envelopes = await buildEnvelopes(payload, item.to, u);
      await api.send({ to_lns: item.to, envelopes });
      sent = "server";
    } catch { /* server ancora giù: si prova la mesh */ }
    if (!sent) {
      try { if (await trySendQueued(st, item, u)) sent = "mesh"; } catch { /* niente percorso */ }
    }
    if (sent === "server") {
      // Il server ha la sua copia: quella locale in attesa sparisce (altrimenti doppia).
      dropLocal(st, item.cid, item.id);
      done++;
    } else if (sent === "mesh") {
      markSent(st, item.cid, item.id);
      done++;
    } else rest.push(item);
  }
  st.queue = rest;
  if (done) await save(st);
  return done;
}

async function trySendQueued(st, item, user) {
  const ready = item.to.filter((r) => st.peers[r] && st.peers[r].id && st.peers[r].sout);
  if (!ready.length || ready.length !== item.to.length) return false;
  const plans = [];
  for (const r of item.to) {
    const peer = st.peers[r];
    const route = routeTo(peer.id, peer.pk, peer.x);
    if (!route) return false;
    const parts = await buildPayload(user, peer, item.cid, item.plain, r);
    if (!parts) return false;
    for (const bytes of parts) plans.push({ route: routeTo(peer.id, peer.pk, peer.x) || route, bytes });
  }
  for (const p of plans) await transport.send(wrap(p.route, p.bytes), bytesToHex(p.route[0].id));
  return true;
}

// ── Ricezione (chiamata dal nodo quando una cipolla è per noi) ────────────────────────
export async function onDeliver(payloadBytes) {
  try {
    // Custodia di gruppo: non è roba per noi, è roba DA PORTARE a un altro membro.
    if (gossip.isGossip(payloadBytes)) return await gossip.take(payloadBytes);
    let o = JSON.parse(new TextDecoder().decode(payloadBytes));
    if (o.v === 3) {
      const full = fragJoin(o);
      if (full == null) return false;                      // mancano ancora dei pezzi
      o = JSON.parse(full);
    }
    const v2 = o.v === 2 && Array.isArray(o.e) && o.e.length;
    const v1 = o.v === 1 && typeof o.b === "string";
    if ((!v1 && !v2) || typeof o.f !== "string" || typeof o.mac !== "string") return false;
    const st = await load();
    const peer = st.peers[o.f];
    if (!peer || !peer.sin) { counters.unknown++; return false; }        // mai presentato
    if (h3(peer.sin + "|" + canon(o)) !== o.mac) { counters.badSeal++; return false; }   // sigillo non valido
    const id = "msh-" + o.mac.slice(0, 16);
    const list = (st.msgs && st.msgs[o.cid]) || [];
    if (list.some((m) => m.id === id)) return false;       // già arrivato da un altro percorso
    let body = null;
    if (v2) {
      // Busta del ratchet arrivata dalla mesh: si apre esattamente come quelle del server.
      if (!identity) { counters.noRat++; return false; }
      try { body = await tryRatchetDecrypt(o.e, identity, o.f); } catch { body = null; }
      if (body == null) { counters.noRat++; return false; }
      counters.rat++;
    } else body = o.b;
    const u = unpackMessage(body);
    appendLocal(st, o.cid, { id, mine: false, at: o.at || new Date().toISOString(),
      body: u.text, atts: [], from: o.f, pending: false, via: "mesh" });
    await save(st);
    counters.delivered++;
    lastVia = "mesh";
    return true;
  } catch { return false; }
}

function appendLocal(st, cid, m) {
  st.msgs = st.msgs || {};
  const k = cid || "";
  st.msgs[k] = (st.msgs[k] || []).concat([m]).slice(-400);
}
function dropLocal(st, cid, id) {
  const k = cid || "";
  if (st.msgs && st.msgs[k]) st.msgs[k] = st.msgs[k].filter((m) => m.id !== id);
}
function markSent(st, cid, id) {
  const k = cid || "";
  if (st.msgs && st.msgs[k]) st.msgs[k] = st.msgs[k].map((m) => (m.id === id ? Object.assign({}, m, { pending: false, via: "mesh" }) : m));
}

/// Messaggi mesh (e in attesa) di una conversazione: vivono SOLO su questo telefono.
export async function localForConv(cid) {
  const st = await load();
  const list = (st.msgs && st.msgs[cid || ""]) || [];
  return list.map((m) => ({
    id: m.id, mine: !!m.mine, body: m.body, atts: m.atts || [], reply: null, signed: null,
    reactions: [], ttl: 0, at: m.at, delivered: !m.pending, read: false, edited: false,
    pinned: false, mesh: true, pending: !!m.pending,
  }));
}

/// Identità mesh dei contatti che si sono presentati. Serve al passaparola per sapere se
/// il destinatario di una copia in custodia è comparso a portata di radio.
export async function peerMesh() {
  const st = await load();
  return (lns) => (st.peers && st.peers[lns]) || null;
}

export async function status() {
  const st = await load();
  const peers = Object.keys(st.peers || {}).filter((k) => st.peers[k] && st.peers[k].id);
  let carried = 0;
  try { carried = await gossip.carrying(); } catch { /* niente */ }
  return { known: peers.length, queued: (st.queue || []).length, lastVia,
    passed: counters.passed, partial: counters.partial, carried,
    badSeal: counters.badSeal, unknown: counters.unknown, delivered: counters.delivered,
    sent: counters.sent, rat: counters.rat, noRat: counters.noRat };
}

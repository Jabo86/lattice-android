// PONTE INTERNET — i messaggi arrivano lontano anche se TU non hai connessione.
//
// Il problema che risolve: Wi-Fi Direct e Bluetooth arrivano a decine di metri, non da
// Catania a Roma. Ma se un nodo Lattice vicino a te HA internet, il tuo pacchetto può
// uscire attraverso di lui: lui lo spinge al server per te e da lì arriva in tutto il mondo.
//
// Cosa vede il ponte: NIENTE. Il pacchetto viaggia come cipolla a 4 salti, e dentro c'è la
// busta già cifrata punto-a-punto per il destinatario. Il ponte non può leggere il messaggio,
// non sa chi l'ha scritto né per chi è: consegna al server una busta chiusa e un TICKET.
//
// Il ticket è firmato dal SERVER e autorizza solo "consegna un messaggio a nome di questo
// account": nessun accesso in lettura, nessuna sessione, scadenza 7 giorni, tetto d'uso.
// Il telefono se lo prende quando ha connessione e lo tiene da parte per i giorni in cui
// non l'avrà. Tutte le regole del server (rubrica reciproca, blocchi) restano in vigore.
import * as api from "./api";
import { getBlob, setBlob } from "./lock";
import { bytesToHex, randomHex } from "./crypto";
import * as transport from "./mesh/transport";
import { wrap, MAX_PAYLOAD_SAFE } from "./mesh/onion";
import { bridgePeers, knownPeers, routeTo } from "./mesh/runtime";

const BLOB = "brg";
const HEAD = "BRG1";
const CHUNK = MAX_PAYLOAD_SAFE - 96;    // spazio per l'intestazione dei pezzi
const MAX_PARTS = 8;
const TTL = 5 * 60 * 1000;
export const counters = { sent: 0, carried: 0, pushed: 0, failed: 0, held: 0, later: 0 };
const QBLOB = "brgq";                   // pacchetti presi in custodia (opachi, cifrati)
const HOLD_TTL = 24 * 3600 * 1000;      // oltre un giorno si lascia perdere
const HOLD_MAX = 20;                    // tetto: nessuno deve poter riempire il tuo telefono
let lastMode = "";
export function mode() { return lastMode; }

// ── Lato MITTENTE ─────────────────────────────────────────────────────────────────────
/// Si prende (o rinnova) il ticket quando c'è connessione. Da fare per tempo: senza ticket
/// il ponte non è utilizzabile.
export async function refreshTicket() {
  const st = (await getBlob(BLOB)) || {};
  const now = Math.floor(Date.now() / 1000);
  if (st.ticket && Number(st.exp) - now > 2 * 24 * 3600) return st.ticket;
  const r = await api.relayTicket();
  if (r && r.ticket) {
    await setBlob(BLOB, { ticket: String(r.ticket), exp: Number(r.exp) || 0 });
    return String(r.ticket);
  }
  return st.ticket || "";
}

export async function ticket() {
  const st = (await getBlob(BLOB)) || {};
  const now = Math.floor(Date.now() / 1000);
  if (!st.ticket || (st.exp && Number(st.exp) < now)) return "";
  return String(st.ticket);
}

/// Spedisce attraverso un nodo vicino che ha internet. Vero se il pacchetto è partito.
export async function sendVia(to_lns, envelopes) {
  const t = await ticket();
  if (!t || !Array.isArray(to_lns) || !to_lns.length || !Array.isArray(envelopes) || !envelopes.length) return false;
  // Prima i vicini che HANNO internet (Ponte). Se nessuno ce l'ha, si affida il pacchetto
  // a un vicino qualsiasi: il CORRIERE lo custodisce cifrato e lo consegnerà quando
  // ritroverà rete, anche ore dopo e chilometri più in là.
  const netPeers = bridgePeers();
  const peers = netPeers.length ? netPeers : knownPeers();
  if (!peers.length) return false;
  lastMode = netPeers.length ? "ponte" : "corriere";
  const bytes = new TextEncoder().encode(JSON.stringify({ t, to: to_lns, e: envelopes }));
  const n = Math.ceil(bytes.length / CHUNK);
  if (n > MAX_PARTS) return false;                 // troppo grande: resterà in coda
  const b = peers[Math.floor(Math.random() * peers.length)];
  const route = routeTo(b.id, b.pk, b.x);
  if (!route) return false;
  const bid = randomHex(6);
  for (let i = 0; i < n; i++) {
    const head = new TextEncoder().encode(HEAD + JSON.stringify({ b: bid, i, n }) + "\n");
    const chunk = bytes.subarray(i * CHUNK, (i + 1) * CHUNK);
    const payload = new Uint8Array(head.length + chunk.length);
    payload.set(head, 0);
    payload.set(chunk, head.length);
    if (payload.length > MAX_PAYLOAD_SAFE) return false;
    await transport.send(wrap(route, payload), bytesToHex(route[0].id));
  }
  counters.sent++;
  return lastMode;
}

// ── Lato PONTE ────────────────────────────────────────────────────────────────────────
const parts = new Map();

export function isBridgePayload(p) {
  if (!(p instanceof Uint8Array) || p.length < HEAD.length + 4) return false;
  for (let i = 0; i < HEAD.length; i++) if (p[i] !== HEAD.charCodeAt(i)) return false;
  return true;
}

/// Raccoglie i pezzi e, quando il pacchetto è completo, lo consegna al server per conto di
/// un altro. Se non c'è internet non si perde nulla: il mittente riproverà.
export async function carry(payload) {
  if (!isBridgePayload(payload)) return false;
  try {
    let nl = HEAD.length;
    while (nl < payload.length && payload[nl] !== 10) nl++;
    const h = JSON.parse(new TextDecoder().decode(payload.subarray(HEAD.length, nl)));
    const bid = String(h.b || ""), i = Number(h.i), n = Number(h.n);
    if (!/^[0-9a-f]{12}$/.test(bid) || !(n >= 1 && n <= MAX_PARTS) || !(i >= 0 && i < n)) return false;
    const now = Date.now();
    for (const [k, v] of parts) if (now - v.at > TTL) parts.delete(k);
    const e = parts.get(bid) || { at: now, n, got: new Array(n).fill(null) };
    if (e.n !== n) return false;
    e.got[i] = payload.subarray(nl + 1);
    parts.set(bid, e);
    if (e.got.some((x) => x === null)) return true;       // mancano ancora dei pezzi
    parts.delete(bid);
    let size = 0;
    for (const c of e.got) size += c.length;
    const all = new Uint8Array(size);
    let off = 0;
    for (const c of e.got) { all.set(c, off); off += c.length; }
    const o = JSON.parse(new TextDecoder().decode(all));
    if (!o || typeof o.t !== "string" || !Array.isArray(o.to) || !Array.isArray(o.e)) return false;
    counters.carried++;
    // Si consegna al server la busta chiusa di un altro. Qui non si legge niente.
    try {
      await api.relaySubmit(o.t, o.to, o.e);
      counters.pushed++;
      return true;
    } catch {
      // CORRIERE: non abbiamo rete adesso. Il pacchetto si tiene in custodia (opaco: un
      // ticket e una busta che non possiamo aprire) e si consegna appena torna la rete.
      return await hold(o);
    }
  } catch {
    counters.failed++;
    return false;
  }
}

/// Presa in custodia (fino a 20 pacchetti, un giorno ciascuno).
async function hold(o) {
  try {
    const st = (await getBlob(QBLOB)) || { q: [] };
    const q = (st.q || []).filter((x) => Date.now() - (x.at || 0) < HOLD_TTL);
    if (q.some((x) => x.t === o.t && JSON.stringify(x.e) === JSON.stringify(o.e))) return true;
    q.push({ t: o.t, to: o.to, e: o.e, at: Date.now() });
    await setBlob(QBLOB, { q: q.slice(-HOLD_MAX) });
    counters.held++;
    return true;
  } catch { return false; }
}

/// Consegna quello che stiamo portando per altri: si chiama appena c'è rete.
export async function deliverCarried() {
  const st = (await getBlob(QBLOB)) || { q: [] };
  const q = (st.q || []).filter((x) => Date.now() - (x.at || 0) < HOLD_TTL);
  if (!q.length) { if ((st.q || []).length) await setBlob(QBLOB, { q: [] }); return 0; }
  const rest = [];
  let done = 0;
  for (const x of q) {
    try {
      await api.relaySubmit(x.t, x.to, x.e);
      done++; counters.later++; counters.pushed++;
    } catch { rest.push(x); }
  }
  await setBlob(QBLOB, { q: rest });
  return done;
}

/// Quanti pacchetti di altri stiamo portando (solo un numero: sono opachi).
export async function carrying() {
  const st = (await getBlob(QBLOB)) || { q: [] };
  return (st.q || []).filter((x) => Date.now() - (x.at || 0) < HOLD_TTL).length;
}

export function summary() { return Object.assign({}, counters); }

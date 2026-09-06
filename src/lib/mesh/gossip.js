// PASSAPAROLA DI GRUPPO — la copia per chi non si vede adesso la porta un altro membro.
//
// In un gruppo di cinque, offline, capita sempre la stessa cosa: due membri sono a portata
// di radio e tre no. Prima il messaggio non partiva per nessuno. Ora parte per chi c'è, e la
// copia dei tre lontani viene affidata a chi c'è: appena quello incrocia uno dei tre, gliela
// consegna. Non è una funzione nuova del protocollo, è la custodia del corriere applicata
// dentro un gruppo.
//
// Cosa vede il membro che fa da corriere: il nome del destinatario, e un blocco di byte
// opachi. Non può leggerli (sono cifrati col ratchet fra mittente e destinatario) e non può
// modificarli (il sigillo è calcolato col segreto mesh di quella coppia, che lui non ha).
// Sa che il mittente ha scritto a quel destinatario — ma è nel gruppo, quindi lo sapeva già.
// Per questo la custodia si affida SOLO ai membri del gruppo, non a un vicino qualsiasi.
import { getBlob, setBlob } from "../lock";
import { randomHex, bytesToHex } from "../crypto";
import { wrap } from "./onion";
import { routeTo } from "./runtime";
import * as transport from "./transport";

const HEAD = "GRP1";
const BLOB = "grpg";
const TTL = 12 * 3600 * 1000;   // oltre mezza giornata la si lascia perdere
const MAX = 40;                 // tetto: nessuno deve poter riempire il telefono di un altro
export const HEADROOM = 160;    // spazio da lasciare libero per l'intestazione

export const counters = { offered: 0, held: 0, forwarded: 0, expired: 0, refused: 0 };

const enc = (s) => new TextEncoder().encode(s);

export function isGossip(p) {
  if (!(p instanceof Uint8Array) || p.length < HEAD.length + 4) return false;
  for (let i = 0; i < HEAD.length; i++) if (p[i] !== HEAD.charCodeAt(i)) return false;
  return true;
}

async function load() {
  const o = await getBlob(BLOB);
  return Array.isArray(o) ? o : [];
}

// ── Lato MITTENTE ─────────────────────────────────────────────────────────────────────
/// Affida a un membro raggiungibile le copie destinate a chi non si vede. `parts` sono i
/// pacchetti già sigillati per il destinatario: qui nessuno li tocca, si spostano soltanto.
/// Vero se la custodia è partita.
export async function offer(toLns, parts, relays) {
  if (!toLns || !Array.isArray(parts) || !parts.length) return false;
  const usable = (relays || []).filter((r) => r && r.lns !== toLns && r.id && r.pk);
  if (!usable.length) return false;
  const r = usable[Math.floor(Math.random() * usable.length)];
  const route = routeTo(r.id, r.pk, r.x);
  if (!route) return false;
  const g = randomHex(6);
  for (let i = 0; i < parts.length; i++) {
    const head = enc(HEAD + JSON.stringify({ g, to: toLns, i, n: parts.length }) + "\n");
    const pkt = new Uint8Array(head.length + parts[i].length);
    pkt.set(head, 0);
    pkt.set(parts[i], head.length);
    await transport.send(wrap(route, pkt), bytesToHex(route[0].id));
  }
  counters.offered++;
  return true;
}

// ── Lato CORRIERE ─────────────────────────────────────────────────────────────────────
/// Prende in custodia una copia per un altro membro. Non la apre: non potrebbe.
export async function take(payload) {
  if (!isGossip(payload)) return false;
  try {
    const nl = payload.indexOf(10);
    if (nl < 0) return false;
    const meta = JSON.parse(new TextDecoder().decode(payload.subarray(HEAD.length, nl)));
    const to = String(meta.to || "");
    if (!to || !/^[0-9a-f]{6,}$/.test(String(meta.g || ""))) return false;
    const body = payload.subarray(nl + 1);
    if (!body.length) return false;
    const list = (await load()).filter((x) => Date.now() - x.at < TTL);
    if (list.length >= MAX) { counters.refused++; return false; }
    const key = String(meta.g) + ":" + (meta.i | 0);
    if (list.some((x) => x.k === key)) return true;                 // già in custodia
    list.push({ k: key, to, at: Date.now(), b: bytesToHex(body) });
    await setBlob(BLOB, list);
    counters.held++;
    return true;
  } catch { return false; }
}

/// Gira ogni volta che la coda gira: se il destinatario è comparso, gli si consegna.
/// `peersOf(lns)` restituisce l'identità mesh di un membro, o null se non la conosciamo.
export async function deliverStashed(peersOf) {
  const list = await load();
  if (!list.length) return 0;
  const now = Date.now();
  const keep = [];
  let sent = 0;
  for (const x of list) {
    if (now - x.at > TTL) { counters.expired++; continue; }
    const p = typeof peersOf === "function" ? peersOf(x.to) : null;
    const route = p && p.id && p.pk ? routeTo(p.id, p.pk, p.x) : null;
    if (!route) { keep.push(x); continue; }
    try {
      const bytes = Uint8Array.from(x.b.match(/../g).map((h) => parseInt(h, 16)));
      await transport.send(wrap(route, bytes), bytesToHex(route[0].id));
      counters.forwarded++;
      sent++;
    } catch { keep.push(x); }
  }
  if (keep.length !== list.length) await setBlob(BLOB, keep);
  return sent;
}

export async function carrying() {
  const list = await load();
  return list.filter((x) => Date.now() - x.at < TTL).length;
}

export function summary() { return Object.assign({}, counters); }

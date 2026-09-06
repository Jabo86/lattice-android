// NODO SOVRANO — logica del nodo mesh (modalità, inoltro cieco, anti-duplicato, barometro).
// Il protocollo a cipolla sta in onion.js (certificato da test/test_mesh_v160.mjs). Qui c'è
// il comportamento del nodo: quando è attivo, cosa scarta, cosa inoltra e come misura la
// salute della rete SENZA identificare nessuno.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { peel, layerTag, meshKeypair, meshXKeypair, nodeId, bytesToHex } from "./onion";

export const MODE_KEY = "lat.mesh.mode";
export const STANDARD = "standard";
export const SOVEREIGN = "sovereign";

// ── Modalità ──────────────────────────────────────────────────────────────────────────
let mode = STANDARD;
let modeLoaded = false;

export async function getMode() {
  if (!modeLoaded) {
    try { const v = await AsyncStorage.getItem(MODE_KEY); if (v === SOVEREIGN) mode = SOVEREIGN; } catch { /* standard */ }
    modeLoaded = true;
  }
  return mode;
}
export async function setMode(m) {
  mode = m === SOVEREIGN ? SOVEREIGN : STANDARD;
  modeLoaded = true;
  try { await AsyncStorage.setItem(MODE_KEY, mode); } catch { /* niente */ }
  return mode;
}
export function isSovereign() { return mode === SOVEREIGN; }

// ── Anti-duplicato ────────────────────────────────────────────────────────────────────
// Si ricordano SOLO le etichette degli strati già visti (che cambiano a ogni salto: non
// diventano un identificatore comune fra i nodi). Memoria limitata, le più vecchie cadono.
const MAX_SEEN = 4096;
const SEEN_TTL = 10 * 60 * 1000;   // le etichette scadono: la memoria non si "svuota a comando"
const seen = new Map(); // tag → timestamp

export function alreadySeen(tag, now = Date.now()) {
  const t = seen.get(tag);
  if (t === undefined) return false;
  if (now - t > SEEN_TTL) { seen.delete(tag); return false; }
  return true;
}
export function remember(tag, now = Date.now()) {
  // Prima si buttano le scadute: cosi' un aggressore non puo' far cadere le voci utili
  // riempiendo la memoria di rumore (le sue scadono come le altre).
  if (seen.size >= MAX_SEEN) {
    for (const [k, t] of seen) { if (now - t > SEEN_TTL) seen.delete(k); }
    while (seen.size >= MAX_SEEN) {
      const oldest = seen.keys().next().value;
      if (oldest === undefined) break;
      seen.delete(oldest);
    }
  }
  seen.set(tag, now);
}
export function seenCount() { return seen.size; }
export function resetSeen() { seen.clear(); }

// ── Barometro della Privacy ───────────────────────────────────────────────────────────
// SOLO conteggi anonimi: si tiene un elenco di ISTANTI in cui si è visto passare traffico
// cifrato. Nessun identificativo, nessun indirizzo, nessun dispositivo: non si può risalire
// a chi c'era intorno, solo a "quanto si muove" la rete.
const WINDOW_MS = 5 * 60 * 1000;
let pulses = [];

/// Si registra SOLO traffico crittograficamente valido (vedi ingest): il rumore non conta,
/// altrimenti un solo dispositivo potrebbe far sembrare "Robusta" una rete deserta.
export function notePulse(at = Date.now()) {
  pulses.push(at);
  const cut = at - WINDOW_MS;
  if (pulses.length > 512 || (pulses.length && pulses[0] < cut)) pulses = pulses.filter((t) => t >= cut);
}
export function resetPulses() { pulses = []; }

/// Salute della rete: solo dal numero di flussi cifrati visti negli ultimi 5 minuti.
export function health(now = Date.now()) {
  const cut = now - WINDOW_MS;
  const n = pulses.filter((t) => t >= cut).length;
  let key = "isolated";
  if (n >= 40) key = "robust";
  else if (n >= 12) key = "good";
  else if (n >= 3) key = "weak";
  return { key, pulses: n };
}
export function healthLabel(key, en) {
  const it = { isolated: "Isolata", weak: "Debole", good: "Discreta", robust: "Robusta" };
  const gb = { isolated: "Isolated", weak: "Weak", good: "Fair", robust: "Robust" };
  return (en ? gb : it)[key] || (en ? "Unknown" : "Sconosciuta");
}

// ── Identità del nodo (derivata, nessuna chiave nuova da custodire) ───────────────────
let me = null;
export function initNode(identitySkHex) {
  const kp = meshKeypair(identitySkHex);
  const xkp = meshXKeypair(identitySkHex);
  me = { pk: kp.publicKey, sk: kp.secretKey, id: nodeId(kp.publicKey),
         xpk: xkp.publicKey, xsk: xkp.secretKey };
  return { id: bytesToHex(me.id), pk: bytesToHex(me.pk), x: bytesToHex(me.xpk) };
}
export function nodeInfo() {
  return me ? { id: bytesToHex(me.id), pk: bytesToHex(me.pk), x: bytesToHex(me.xpk) } : null;
}

/**
 * INOLTRO CIECO. Riceve i byte di un pacchetto e decide, da solo, cosa farne.
 * Restituisce:
 *   { action: "deliver", payload }        → era per noi
 *   { action: "forward", next, packet }   → da passare al prossimo salto
 *   { action: "drop", why }               → doppione, non nostro, manomesso, ttl finito
 * Non registra MAI da chi è arrivato: il salto precedente lo conosce solo il trasporto.
 */
export function ingest(packetBytes) {
  // Cancello di consenso: in Modalità Standard il nodo non partecipa, punto. Difesa in
  // profondità: non si dipende dal fatto che il chiamante non ci chiami.
  if (!isSovereign()) return { action: "drop", why: "standard" };
  if (!me) return { action: "drop", why: "standard" };
  let tag;
  try { tag = layerTag(packetBytes); } catch { return { action: "drop", why: "standard" }; }
  if (alreadySeen(tag)) return { action: "drop", why: "standard" };
  let r;
  try {
    r = peel({ sk: me.sk, xsk: me.xsk }, packetBytes);
  } catch (e) {
    // Non è per noi, o è manomesso: si scarta in silenzio. Motivo SEMPRE identico agli altri
    // scarti, per non fare da oracolo a chi sonda la rete.
    return { action: "drop", why: "standard" };
  }
  // Da qui in poi il pacchetto è autentico: solo ora lo ricordiamo (i pacchetti non nostri
  // non consumano memoria) e solo ora alimenta il Barometro (non falsificabile con rumore).
  remember(tag);
  notePulse();
  if (r.exit) return { action: "deliver", payload: r.payload };
  return { action: "forward", next: r.next, packet: r.packet };
}

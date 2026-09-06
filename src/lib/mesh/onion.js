// BLIND RELAY — instradamento a cipolla per la rete Nodo Sovrano (P2P).  v2 (1.6.1)
//
// ── PERCHÉ QUESTA È LA VERSIONE 2 ──────────────────────────────────────────────────────
// La v1 (1.6.0) è stata smontata da una revisione indipendente e va considerata INSICURA.
// Difetto radice: si cifrava il contenuto SENZA prima portarlo a lunghezza fissa, e la
// lunghezza del cifrato finiva IN CHIARO nell'intestazione (campo `clen`). Poiché ogni
// strato aggiunge un numero fisso di byte, valeva  clen = lunghezza_messaggio + costante:
// quindi (a) il primo relay leggeva la lunghezza esatta del messaggio senza chiavi, e (b)
// sottraendo la costante si otteneva lo STESSO numero su tutte le tratte — un identificatore
// comune che permetteva di ricucire l'intero percorso (40 su 40 ricostruiti).
//
// ── COME È FATTA ADESSO ────────────────────────────────────────────────────────────────
// Nel pacchetto NON c'È PIÙ NESSUN METADATO IN CHIARO: né versione, né TTL, né lunghezza.
//     pacchetto = [ML-KEM ct(1088)][iv(12)][AES-GCM ct][riempimento casuale]   = PACKET_SIZE
// Il contenuto viene sempre portato a LUNGHEZZA FISSA (MAX_PAYLOAD) prima di essere cifrato,
// quindi il cifrato di ogni strato ha una lunghezza che dipende SOLO dalla profondità, mai
// dal messaggio: identica per tutti i messaggi. Le lunghezze possibili sono soltanto HOPS,
// e non vengono scritte da nessuna parte: il nodo le prova (poche decifrature simmetriche,
// una sola decapsulazione ML-KEM) e quella autentica vince. Così spariscono insieme la fuga
// di lunghezza, l'identificatore fra i salti e anche l'indizio sulla posizione nel percorso.
// Il testo in chiaro di ogni strato è  [next(16)][flags(1)][len(2)][dati]  ed è tutto DENTRO
// l'autenticazione AES-GCM: nulla di modificabile senza far fallire l'apertura.
// Cicli impossibili per costruzione (ogni strato è cifrato per un nodo diverso), quindi il
// TTL non serve più — ed era proprio il byte che rendeva aggirabile l'anti-duplicato.
//
// Chiavi ML-KEM-768 per ogni salto: i metadati di percorso restano al riparo anche da un
// futuro computer quantistico.
//
// ── LIMITE ANCORA PRESENTE, DICHIARATO ────────────────────────────────────────────────
// L'ULTIMO relay del percorso conosce l'ID del nodo che consegna (deve passargli la busta).
// Con HOPS=4 quel nodo è il quarto: mittente e destinatario non sono mai noti allo stesso
// nodo. L'ID di nodo è però uno pseudonimo PERMANENTE (derivato dall'identità, senza
// rotazione): un ultimo salto ricorrente potrebbe accorgersi che "quel nodo" riceve spesso.
// La rotazione periodica delle chiavi mesh è il prossimo passo.
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { gcm } from "@noble/ciphers/aes.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { x25519 } from "@noble/curves/ed25519.js";

export const HOPS = 4;              // 3 relay + il nodo che consegna
export const PACKET_SIZE = 8192;    // dimensione identica per ogni pacchetto e ogni tratta
const KEM_CT = 1088;                // ML-KEM-768
const IV = 12;
const TAG = 16;
const INNER_HDR = 19;               // next(16) + flags(1) + len(2)  — tutto cifrato
const CORE = KEM_CT + IV;           // parte in chiaro: solo materiale crittografico
export const ID_LEN = 16;

// ── CIPOLLA IBRIDA (v3) ───────────────────────────────────────────────────────────────
// Ogni strato porta, oltre all'incapsulazione ML-KEM-768, una chiave X25519 effimera. La
// chiave dello strato nasce dai DUE segreti concatenati: per sapere a chi va il pacchetto
// bisogna rompere ENTRAMBI i mondi, i reticoli e le curve. Costo: 32 byte per strato, cioe'
// 128 su 8192, cioe' 128 byte in meno di contenuto utile. Non e' un prezzo, e' un arrotondamento.
const XPK = 32;
const CORE3 = KEM_CT + XPK + IV;
const L3 = "lattice-mesh-onion-v3";

// Lunghezze possibili del cifrato, per profondità: dipendono SOLO da quanti strati restano.
// Ricavate a partire dal contenuto a lunghezza fissa: ct = 19 + interno + 16.
function ctLengths(payloadSize) {
  const out = [];
  let inner = payloadSize;                 // lo strato più interno porta il contenuto
  for (let i = 0; i < HOPS; i++) {
    const ct = INNER_HDR + inner + TAG;
    out.unshift(ct);                       // dal più esterno al più interno
    inner = CORE + ct;                     // lo strato successivo porta il pacchetto interno
  }
  return out;
}
// MAX_PAYLOAD scelto perché lo strato più esterno riempia esattamente PACKET_SIZE.
export const MAX_PAYLOAD = PACKET_SIZE - CORE - (INNER_HDR + TAG) * HOPS - CORE * (HOPS - 1);
export const CT_LENS = ctLengths(MAX_PAYLOAD);

function ctLengths3(payloadSize) {
  const out = [];
  let inner = payloadSize;
  for (let i = 0; i < HOPS; i++) {
    const ct = INNER_HDR + inner + TAG;
    out.unshift(ct);
    inner = CORE3 + ct;
  }
  return out;
}
export const MAX_PAYLOAD3 = PACKET_SIZE - CORE3 - (INNER_HDR + TAG) * HOPS - CORE3 * (HOPS - 1);
export const CT_LENS3 = ctLengths3(MAX_PAYLOAD3);
/// Tetto prudente per chi compone i contenuti: vale per la cipolla ibrida E per quella
/// precedente, così un messaggio non diventa impossibile da spedire a seconda dei vicini.
export const MAX_PAYLOAD_SAFE = MAX_PAYLOAD3;

function rand(n) {
  const a = new Uint8Array(n);
  (globalThis.crypto || global.crypto).getRandomValues(a);
  return a;
}
export function bytesToHex(b) {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}
export function hexToBytes(h) {
  const s = String(h || "");
  const out = new Uint8Array(Math.floor(s.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

/// Chiavi del nodo mesh, derivate dalla chiave d'identità: nessuna chiave nuova da custodire.
export function meshKeypair(skHex) {
  const seed = sha512(new TextEncoder().encode("lattice-mesh-v1:" + (skHex || "")));
  return ml_kem768.keygen(seed);
}

/// Chiave X25519 del nodo mesh, anch'essa derivata dall'identità: niente da custodire.
export function meshXKeypair(skHex) {
  const seed = sha512(new TextEncoder().encode("lattice-mesh-x-v1:" + (skHex || ""))).slice(0, 32);
  return { secretKey: seed, publicKey: x25519.getPublicKey(seed) };
}

/// ID pubblico del nodo (16 byte): impronta della chiave mesh. Non contiene l'identità.
/// Resta calcolato sulla sola chiave ML-KEM: così un nodo aggiornato e uno vecchio si
/// riconoscono ancora, e la rete non si spacca in due il giorno dell'aggiornamento.
export function nodeId(publicKey) { return sha256(publicKey).slice(0, ID_LEN); }

function u16(n) { return new Uint8Array([(n >> 8) & 255, n & 255]); }
function readU16(b, o) { return (b[o] << 8) | b[o + 1]; }
function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// Uno strato. `data` è già a lunghezza fissa: il cifrato risulta identico per ogni messaggio.
// Strato IBRIDO: [ml-kem ct(1088)][curva effimera(32)][iv(12)][cifrato]
function seal3(pubKey, xPubKey, nextId, isExit, data, realLen) {
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(pubKey);
  const esk = rand(32);
  const epk = x25519.getPublicKey(esk);
  const ssX = x25519.getSharedSecret(esk, xPubKey);
  const key = hkdf(sha256, concat([sharedSecret, ssX]), undefined, new TextEncoder().encode(L3), 32);
  const iv = rand(IV);
  const plain = concat([
    nextId && nextId.length === ID_LEN ? nextId : new Uint8Array(ID_LEN),
    new Uint8Array([isExit ? 1 : 0]),
    u16(realLen),
    data,
  ]);
  return concat([cipherText, epk, iv, gcm(key, iv).encrypt(plain)]);
}

function seal(pubKey, nextId, isExit, data, realLen) {
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(pubKey);
  const iv = rand(IV);
  const plain = concat([
    nextId && nextId.length === ID_LEN ? nextId : new Uint8Array(ID_LEN),
    new Uint8Array([isExit ? 1 : 0]),
    u16(realLen),
    data,
  ]);
  return concat([cipherText, iv, gcm(sharedSecret, iv).encrypt(plain)]);
}

/// Riempie fino alla dimensione fissa con byte casuali (indistinguibili dal cifrato).
export function padToPacket(core) {
  if (core.length > PACKET_SIZE) throw new Error("pacchetto oltre la dimensione fissa");
  if (core.length === PACKET_SIZE) return core;
  return concat([core, rand(PACKET_SIZE - core.length)]);
}

/**
 * Costruisce la cipolla. `route` = esattamente HOPS nodi [{ id, pk }]; l'ultimo consegna.
 * Il contenuto viene portato a MAX_PAYLOAD byte: due messaggi di lunghezza diversa producono
 * pacchetti indistinguibili, su ogni tratta.
 */
export function wrap(route, payload) {
  if (!Array.isArray(route) || route.length !== HOPS) throw new Error("il percorso deve avere " + HOPS + " nodi");
  const body = payload instanceof Uint8Array ? payload : new TextEncoder().encode(String(payload));
  // IBRIDO solo se TUTTI i salti hanno una chiave su curva: un percorso misto non esiste,
  // sarebbe un pacchetto con due geometrie diverse. Se manca a uno, si usa la cipolla
  // precedente (post-quantistica pura) per l'intero percorso: mai niente.
  const hy = route.every((h) => h && h.xpk && h.xpk.length === XPK);
  const CAP = hy ? MAX_PAYLOAD3 : MAX_PAYLOAD;
  if (body.length > CAP) throw new Error("contenuto oltre " + CAP + " byte");
  const fixed = new Uint8Array(CAP);           // lunghezza fissa: niente fughe di dimensione
  fixed.set(body, 0);
  let core = hy
    ? seal3(route[HOPS - 1].pk, route[HOPS - 1].xpk, null, true, fixed, body.length)
    : seal(route[HOPS - 1].pk, null, true, fixed, body.length);
  for (let i = HOPS - 2; i >= 0; i--) {
    core = hy
      ? seal3(route[i].pk, route[i].xpk, route[i + 1].id, false, core, core.length)
      : seal(route[i].pk, route[i + 1].id, false, core, core.length);
  }
  return padToPacket(core);
}

/// Dice se il percorso viaggerà in ibrido: serve solo alla diagnostica.
export function routeHybrid(route) {
  return Array.isArray(route) && route.length === HOPS
    && route.every((h) => h && h.xpk && h.xpk.length === XPK);
}

/// Etichetta anti-duplicato: calcolata SOLO sul materiale crittografico dello strato
/// (ML-KEM ct + iv). Cambia a ogni salto — non è un identificatore comune — e non può essere
/// falsificata: alterare quei byte rende il pacchetto impossibile da aprire.
export function layerTag(packet) {
  if (!(packet instanceof Uint8Array) || packet.length < CORE) throw new Error("pacchetto non valido");
  return bytesToHex(sha256(packet.subarray(0, CORE)).subarray(0, 16));
}

/**
 * Apre il proprio strato. Nessun metadato in chiaro da consultare: si prova la decifratura
 * con le poche lunghezze possibili e quella autentica vince.
 *   { exit: true, payload }              → sei l'ultimo: consegna
 *   { exit: false, next, packet }         → inoltra `packet` a `next`
 * Lancia se il pacchetto non è per te o è manomesso (motivo sempre identico: nessun oracolo).
 */
export function peel(keys, packet) {
  if (!(packet instanceof Uint8Array) || packet.length !== PACKET_SIZE) throw new Error("pacchetto scartato");
  // `keys` può essere la sola chiave ML-KEM (compatibilità) oppure { sk, xsk } per l'ibrido.
  const sk = keys instanceof Uint8Array ? keys : keys && keys.sk;
  const xsk = keys instanceof Uint8Array ? null : (keys && keys.xsk) || null;
  if (!sk) throw new Error("pacchetto scartato");
  let shared;
  try { shared = ml_kem768.decapsulate(packet.subarray(0, KEM_CT), sk); } catch { throw new Error("pacchetto scartato"); }
  let plain = null;
  // Prima la geometria ibrida (se abbiamo la curva), poi quella precedente. Nessun campo
  // in chiaro dice quale sia: si provano, e quella autentica vince. Il motivo di scarto
  // resta unico, quindi non si fa da oracolo su quale versione parli il mittente.
  if (xsk) {
    try {
      const ssX = x25519.getSharedSecret(xsk, packet.subarray(KEM_CT, KEM_CT + XPK));
      const key = hkdf(sha256, concat([shared, ssX]), undefined, new TextEncoder().encode(L3), 32);
      const iv3 = packet.subarray(KEM_CT + XPK, CORE3);
      for (const L of CT_LENS3) {
        if (CORE3 + L > PACKET_SIZE) continue;
        try { plain = gcm(key, iv3).decrypt(packet.subarray(CORE3, CORE3 + L)); break; } catch { /* la prossima */ }
      }
    } catch { /* non è ibrido, o non è per noi */ }
  }
  if (!plain) {
    const iv = packet.subarray(KEM_CT, CORE);
    for (const L of CT_LENS) {
      if (CORE + L > PACKET_SIZE) continue;
      try { plain = gcm(shared, iv).decrypt(packet.subarray(CORE, CORE + L)); break; } catch { /* si prova la prossima */ }
    }
  }
  if (!plain) throw new Error("pacchetto scartato");   // non è per noi, oppure è manomesso
  const next = plain.subarray(0, ID_LEN);
  const isExit = plain[ID_LEN] === 1;
  const len = readU16(plain, ID_LEN + 1);
  const data = plain.subarray(INNER_HDR);
  if (isExit) {
    if (len > data.length) throw new Error("pacchetto scartato");
    return { exit: true, payload: new Uint8Array(data.subarray(0, len)) };
  }
  if (len > data.length) throw new Error("pacchetto scartato");
  return { exit: false, next: bytesToHex(next), packet: padToPacket(new Uint8Array(data.subarray(0, len))) };
}

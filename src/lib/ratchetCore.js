// BLOCCO R — DOPPIO RATCHET POST-QUANTISTICO (cuore crittografico puro, testabile in Node).
//
// Ogni messaggio ha una chiave nuova derivata da quella precedente (catena simmetrica) e a
// ogni cambio di direzione si rinegozia una radice nuova con ML-KEM-768 (passo asimmetrico).
// Conseguenze:
//   · forward secrecy per messaggio: la chiave usata viene cancellata subito;
//   · post-compromise security (auto-guarigione): chi copia lo stato del telefono viene
//     tagliato fuori dopo un solo scambio in entrambe le direzioni, senza che nessuno
//     debba accorgersi di nulla.
// Nessuna dipendenza da React Native: qui dentro c'è solo matematica.
import { ml_kem768, ml_kem1024 } from "@noble/post-quantum/ml-kem.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { gcm } from "@noble/ciphers/aes.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes, randomHex } from "./crypto";

export const RAT_V = 1;
export const CAP = "rat1"; // capability annunciata dal dispositivo
const MAX_SKIP = 300;        // messaggi mancanti che accettiamo di scavalcare in un colpo
const MAX_SKIPPED_KEYS = 600; // chiavi tenute da parte per i messaggi fuori ordine
const L_INIT = "lattice-ratchet-init-v1";
const L_ROOT = "lattice-ratchet-root-v1";
const L_CHAIN = "lattice-ratchet-chain-v1";

function u8(str) {
  const out = [];
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff) {
      const cp = 0x10000 + ((c & 0x3ff) << 10) + (s.charCodeAt(++i) & 0x3ff);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(out);
}
function fromU8(b) {
  const codes = [];
  let i = 0;
  while (i < b.length) {
    const c = b[i++];
    if (c < 0x80) codes.push(c);
    else if (c < 0xe0) codes.push(((c & 0x1f) << 6) | (b[i++] & 0x3f));
    else if (c < 0xf0) codes.push(((c & 0x0f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f));
    else {
      const cp = ((c & 0x07) << 18) | ((b[i++] & 0x3f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f);
      const v = cp - 0x10000;
      codes.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    }
  }
  let s = "";
  for (let j = 0; j < codes.length; j += 8192) s += String.fromCharCode.apply(null, codes.slice(j, j + 8192));
  return s;
}

// Radice nuova + chiave di catena, dal segreto ML-KEM appena incapsulato.
function kdfRoot(rkHex, ss) {
  const out = hkdf(sha256, ss, hexToBytes(rkHex), u8(L_ROOT), 64);
  return { rk: bytesToHex(out.slice(0, 32)), ck: bytesToHex(out.slice(32)) };
}
// Avanzamento della catena: chiave del messaggio + catena successiva.
function kdfChain(ckHex) {
  const out = hkdf(sha256, hexToBytes(ckHex), undefined, u8(L_CHAIN), 64);
  return { ck: bytesToHex(out.slice(0, 32)), mk: bytesToHex(out.slice(32)) };
}
function newKeypair() {
  const kp = ml_kem768.keygen(hexToBytes(randomHex(64)));
  return { pk: bytesToHex(kp.publicKey), sk: bytesToHex(kp.secretKey) };
}
const clone = (o) => JSON.parse(JSON.stringify(o));
export function sessionKey(theirDev, myDev) {
  return String(theirDev || "?") + "|" + String(myDev || "?");
}
// AAD canonica: indipendente dall'ordine dei campi JSON (il server rimaneggia i documenti).
function aadOf(h) {
  return u8([RAT_V, h.sdev || "", h.pk || "", h.ct || "", h.n | 0, h.pn | 0, h.init ? h.init.ct1 : ""].join("|"));
}
const skKey = (pk, n) => String(pk || "").slice(0, 24) + ":" + n;

function pruneSkipped(st) {
  const keys = Object.keys(st.skipped || {});
  if (keys.length <= MAX_SKIPPED_KEYS) return;
  for (const k of keys.slice(0, keys.length - MAX_SKIPPED_KEYS)) delete st.skipped[k];
}

/// Chi apre la conversazione: incapsula sulla chiave d'identità del destinatario (radice) e
/// prende la sua chiave usa-e-getta come primo anello del ratchet.
export function initSender({ theirStaticPk, theirRatchetPk, pkId, myDev, theirDev, peer }) {
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(hexToBytes(theirStaticPk));
  const rk = bytesToHex(hkdf(sha256, sharedSecret, undefined, u8(L_INIT), 32));
  return {
    v: RAT_V, rk, cks: null, ckr: null, ns: 0, nr: 0, pn: 0,
    theirPk: theirRatchetPk, myPk: null, mySk: null,
    needStep: true, skipped: {}, heals: 0, sent: 0, recv: 0,
    myDev, theirDev, peer: peer || "",
    pendingInit: { ct1: bytesToHex(cipherText), pk_id: pkId || "" },
    at: Date.now(),
  };
}

/// Chi riceve il primo messaggio: ricava la stessa radice con la propria chiave d'identità e
/// usa la privata della chiave usa-e-getta consumata come primo anello del ratchet.
export function initReceiver({ header, myStaticSk, myRatchetPk, myRatchetSk, myDev, peer }) {
  const init = header && header.init;
  if (!init || !init.ct1) return null;
  const ss = ml_kem768.decapsulate(hexToBytes(init.ct1), hexToBytes(myStaticSk));
  const rk = bytesToHex(hkdf(sha256, ss, undefined, u8(L_INIT), 32));
  return {
    v: RAT_V, rk, cks: null, ckr: null, ns: 0, nr: 0, pn: 0,
    theirPk: null, myPk: myRatchetPk, mySk: myRatchetSk,
    needStep: false, skipped: {}, heals: 0, sent: 0, recv: 0,
    myDev, theirDev: header.sdev || "", peer: peer || "",
    at: Date.now(),
  };
}

/// Cifra un messaggio: se serve fa il passo asimmetrico (radice nuova), poi avanza la catena.
export function ratchetEncrypt(state, plaintext) {
  if (state && state.v === RAT_V2) return encrypt2(state, plaintext);
  const st = clone(state);
  const h = { v: RAT_V, sdev: st.myDev, pk: null, ct: null, n: 0, pn: st.pn };
  if (!st.cks || st.needStep) {
    if (!st.theirPk) throw new Error("Sessione senza chiave del destinatario");
    const kp = newKeypair();
    st.myPk = kp.pk; st.mySk = kp.sk;
    const { cipherText, sharedSecret } = ml_kem768.encapsulate(hexToBytes(st.theirPk));
    const d = kdfRoot(st.rk, sharedSecret);
    st.rk = d.rk; st.cks = d.ck;
    st.pn = st.ns; st.ns = 0; st.needStep = false; st.heals = (st.heals || 0) + 1;
    h.ct = bytesToHex(cipherText); h.pn = st.pn;
  }
  h.pk = st.myPk;
  // L'aggancio iniziale resta in testa a ogni messaggio finché l'altro non risponde: così
  // la conversazione parte anche se i messaggi arrivano in ordine sparso.
  if (st.pendingInit) {
    // Nell'aggancio viaggia anche il passo che ha creato questa catena: così QUALSIASI
    // messaggio del primo blocco è in grado di aprire la sessione dall'altra parte.
    if (h.ct) { st.pendingInit.sct = h.ct; st.pendingInit.spk = h.pk; }
    h.init = st.pendingInit;
  }
  const { ck, mk } = kdfChain(st.cks);
  st.cks = ck; h.n = st.ns; st.ns++; st.sent = (st.sent || 0) + 1; st.at = Date.now();
  const iv = randomHex(12);
  const ct = gcm(hexToBytes(mk), hexToBytes(iv), aadOf(h)).encrypt(u8(plaintext));
  return { state: st, env: { r: RAT_V, h, iv, ct: bytesToHex(ct) } };
}

function openWith(mkHex, env, h) {
  try {
    return fromU8(gcm(hexToBytes(mkHex), hexToBytes(env.iv), aadOf(h)).decrypt(hexToBytes(env.ct)));
  } catch { return null; }
}

/// Decifra. Ritorna { state, plaintext } oppure null: lo stato viene aggiornato SOLO se la
/// decifratura riesce (un messaggio corrotto non deve rompere la sessione).
export function ratchetDecrypt(state, env) {
  if (state && state.v === RAT_V2) return decrypt2(state, env);
  const raw = (env && env.h) || {};
  // L'AAD si calcola SEMPRE sull'intestazione originale; per la logica usiamo la versione
  // normalizzata, che recupera il passo di ratchet dall'aggancio iniziale.
  const h = (!raw.ct && raw.init && raw.init.sct)
    ? Object.assign({}, raw, { ct: raw.init.sct, pk: raw.init.spk })
    : raw;
  const st = clone(state);
  st.skipped = st.skipped || {};

  // 1) messaggio arrivato in ritardo: chiave messa da parte in precedenza
  const kk = skKey(h.pk, h.n | 0);
  if (st.skipped[kk]) {
    const pt = openWith(st.skipped[kk], env, raw);
    if (pt != null) { delete st.skipped[kk]; st.recv = (st.recv || 0) + 1; return { state: st, plaintext: pt }; }
  }

  // 2) l'altro ha girato la chiave: nuova radice (è il passo che caccia fuori un intruso)
  if (h.ct && h.pk && h.pk !== st.theirPk) {
    if (!st.mySk) return null;
    if (st.ckr) skipTo(st, h.pn | 0);
    let ss;
    try { ss = ml_kem768.decapsulate(hexToBytes(h.ct), hexToBytes(st.mySk)); } catch { return null; }
    const d = kdfRoot(st.rk, ss);
    st.rk = d.rk; st.ckr = d.ck; st.theirPk = h.pk; st.nr = 0;
    st.needStep = true; st.heals = (st.heals || 0) + 1;
  }
  if (!st.ckr) return null;
  if (h.pk !== st.theirPk) return null;

  // 3) messaggi mancanti in mezzo: le loro chiavi restano da parte, senza bloccare la catena
  const n = h.n | 0;
  if (n < st.nr) return null; // già consumato: solo le chiavi messe da parte possono aprirlo
  if (n > st.nr) {
    if (n - st.nr > MAX_SKIP) return null;
    skipTo(st, n);
  }
  const { ck, mk } = kdfChain(st.ckr);
  st.ckr = ck; st.nr++;
  const pt = openWith(mk, env, raw);
  if (pt == null) return null;
  st.recv = (st.recv || 0) + 1; st.at = Date.now();
  if (st.pendingInit) delete st.pendingInit; // l'altro ha risposto: aggancio non più necessario
  pruneSkipped(st);
  return { state: st, plaintext: pt };
}

// Avanza la catena di ricezione fino a `upto`, conservando le chiavi non usate.
function skipTo(st, upto) {
  let guard = 0;
  while (st.ckr && st.nr < upto && guard++ < MAX_SKIP) {
    const { ck, mk } = kdfChain(st.ckr);
    st.ckr = ck;
    st.skipped[skKey(st.theirPk, st.nr)] = mk;
    st.nr++;
  }
  pruneSkipped(st);
}

// ══════════════════════════════════════════════════════════════════════════════════════
// RATCHET v2 — TRIPLO RATCHET IBRIDO
//
// Tre catene, non due, e ognuna serve a una cosa diversa:
//
//   1. CATENA SIMMETRICA — una chiave nuova per ogni messaggio, cancellata subito.
//      Forward secrecy: la chiave di ieri non esiste piu' da nessuna parte.
//   2. RATCHET SU CURVA (X25519) — una chiave nuova a OGNI cambio di turno, 32 byte.
//      Post-compromise security continua: chi copia il tuo telefono viene tagliato fuori
//      dopo un solo scambio, e il costo e' irrisorio.
//   3. RATCHET POST-QUANTISTICO (ML-KEM-768) — una radice nuova ogni pochi turni.
//      E' l'unico passo costoso (2,6 KB fra chiave e cifrato): farlo a ogni messaggio
//      significherebbe messaggi da 3 KB per scrivere "ok". Si fa rado, e la sua eredita'
//      resta comunque dentro la radice per SEMPRE.
//
// La conseguenza che conta: la riservatezza e' SEMPRE ibrida. Per leggere una sola riga
// servono rotti entrambi i mondi, i reticoli E le curve — anche nei turni in cui il passo
// post-quantistico non viene rifatto, perche' il suo segreto e' gia' cotto nella radice.
// Quello che e' rado e' solo il RINNOVO post-quantistico, cioe' la velocita' con cui un
// intruso post-quantistico viene cacciato: entro 3 turni o 20 minuti, non entro uno.
//
// E una proprieta' pratica che vale piu' di quanto sembri: OGNI messaggio porta con se'
// tutto il necessario per ricostruire il proprio turno. Non esiste un "messaggio chiave"
// che, se si perde, blocca la catena: i messaggi possono arrivare in qualsiasi ordine,
// che e' esattamente quello che succede sulla mesh.
//
// Intestazione: base64, non esadecimale, e la chiave ML-KEM da 1184 byte non viaggia piu'
// in ogni messaggio. Un messaggio di testo passa da ~11,5 KB a ~180 byte.
// ══════════════════════════════════════════════════════════════════════════════════════
export const RAT_V2 = 2;
export const CAP2 = "rat2";
const L2_INIT = "lattice-ratchet-init-v2";
const L2_ROOT = "lattice-ratchet-root-v2";
const L2_CHAIN = "lattice-ratchet-chain-v2";
// Cadenza del passo post-quantistico: ogni 3 turni oppure ogni 20 minuti, quello che
// arriva prima. E' il ritardo massimo con cui un intruso post-quantistico viene cacciato.
const PQ_EVERY = 3;
const PQ_MS = 20 * 60 * 1000;

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64R = (() => { const m = {}; for (let i = 0; i < 64; i++) m[B64[i]] = i; return m; })();
function b64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (b === undefined ? 0 : b >> 4)];
    out += b === undefined ? "=" : B64[((b & 15) << 2) | (c === undefined ? 0 : c >> 6)];
    out += c === undefined ? "=" : B64[c & 63];
  }
  return out;
}
function unb64(str) {
  const s = String(str || "").replace(/[^A-Za-z0-9+/]/g, "");
  const n = (s.length * 3) >> 2;
  const out = new Uint8Array(n);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const a = B64R[s[i]] | 0, b = B64R[s[i + 1]] | 0, c = B64R[s[i + 2]] | 0, d = B64R[s[i + 3]] | 0;
    if (o < n) out[o++] = (a << 2) | (b >> 4);
    if (o < n) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (o < n) out[o++] = ((c & 3) << 6) | d;
  }
  return out;
}
function cat2(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0); out.set(b, a.length);
  return out;
}
const b64hex = (h) => b64(hexToBytes(h || ""));
const hexb64 = (s) => bytesToHex(unb64(s));
// Impronta a 8 byte di una chiave pubblica: sostituisce i 1184 byte nell'intestazione.
function pfOf(pkHex) { return b64(sha256(hexToBytes(pkHex || "")).subarray(0, 8)); }

// Radice nuova. `ssKem` e' vuoto nei turni in cui il passo post-quantistico non si rifa':
// la sua eredita' e' comunque dentro `rk`, che non si dimentica di niente.
function kdfRoot2(rkHex, ssKem, ssX, pq) {
  const out = hkdf(sha256, cat2(ssKem, ssX), hexToBytes(rkHex), u8(L2_ROOT + (pq ? "|pq" : "|cl")), 64);
  return { rk: bytesToHex(out.slice(0, 32)), ck: bytesToHex(out.slice(32)) };
}
function kdfChain2(ckHex) {
  const out = hkdf(sha256, hexToBytes(ckHex), undefined, u8(L2_CHAIN), 64);
  return { ck: bytesToHex(out.slice(0, 32)), mk: bytesToHex(out.slice(32)) };
}
// Trascrizione dell'aggancio: entrambe le parti la ricostruiscono senza chiedere nulla al
// server. Lega la radice a CHI la riceve, a QUALE chiave usa-e-getta e a COSA e' stato
// incapsulato. Un incapsulamento catturato non e' riusabile in nessun altro contesto.
function transcript2(bKemPkHex, bDhPkHex, pkId, ct1b64, epkb64, sdevA, lvl) {
  const who = b64(sha256(cat2(hexToBytes(bKemPkHex || ""), hexToBytes(bDhPkHex || ""))));
  return [L2_INIT, who, String(pkId || ""), String(ct1b64 || ""), String(epkb64 || ""),
    String(sdevA || ""), String(lvl || "")].join("|");
}
// AAD: copre TUTTA l'intestazione trasmessa, compreso il livello ML-KEM dichiarato
// nell'aggancio: nessuno può farlo scendere di grado senza far fallire la decifratura.
function aad2(h) {
  return u8([RAT_V2, h.sdev || "", h.pf || "", h.xpk || "", h.pk || "", h.ct || "", h.kf || "",
    h.n | 0, h.pn | 0, h.init ? h.init.ct1 : "", h.init ? h.init.epk : "",
    h.init ? (h.init.k || "") : ""].join("|"));
}
const skKey2 = (pf, n) => String(pf || "") + ":" + n;
function newX() {
  const sk = randomHex(32);
  return { sk, pk: bytesToHex(x25519.getPublicKey(hexToBytes(sk))) };
}

/// Chi apre la conversazione. La radice nasce da DUE segreti: incapsulazione ML-KEM-768
/// sull'identita' del destinatario e X25519 effimero contro la sua chiave su curva. La
/// chiave usa-e-getta entra al primo passo, che avviene subito col primo messaggio.
export function initSender2({ theirStaticPk, theirDhPk, theirRatchetPk, pkId, myDev, theirDev, peer, theirStaticPk1024, theirHdhPk }) {
  if (!theirStaticPk || !theirDhPk || !theirRatchetPk) return null;
  // Se il destinatario ha pubblicato una curva d'aggancio ruotabile si usa quella; altrimenti
  // la sua curva d'identità, che è la generazione 0. Mai niente.
  if (theirHdhPk && theirHdhPk.length === 64) theirDhPk = theirHdhPk;
  // LIVELLO 5 QUANDO SI PUÒ. L'aggancio protegge la radice, cioè il segreto più longevo di
  // tutta la conversazione: se il destinatario ha pubblicato una chiave ML-KEM-1024 si usa
  // quella. Altrimenti si resta a 768, che è ciò che c'era: mai niente.
  const lvl = theirStaticPk1024 && theirStaticPk1024.length > 2400 ? "1024" : "768";
  const ikPk = lvl === "1024" ? theirStaticPk1024 : theirStaticPk;
  const { cipherText, sharedSecret } = (lvl === "1024" ? ml_kem1024 : ml_kem768)
    .encapsulate(hexToBytes(ikPk));
  const e = newX();
  const ssX = x25519.getSharedSecret(hexToBytes(e.sk), hexToBytes(theirDhPk));
  const ct1 = b64(cipherText), epk = b64hex(e.pk);
  const rk = bytesToHex(hkdf(sha256, cat2(sharedSecret, ssX), undefined,
    u8(transcript2(ikPk, theirDhPk, pkId, ct1, epk, myDev, lvl)), 32));
  return {
    v: RAT_V2, rk, cks: null, ckr: null, ns: 0, nr: 0, pn: 0,
    theirXpk: theirDhPk, theirPf: "", theirKemPk: theirRatchetPk,
    myXpk: null, myXsk: null, myPf: "",
    myKemPk: null, myKemSk: null, myKemCt: null, prevKemPk: null, prevKemSk: null,
    pqOut: false, turns: 0, lastPq: 0,
    needStep: true, skipped: {}, heals: 0, sent: 0, recv: 0,
    myDev, theirDev, peer: peer || "", pkId: pkId || "",
    pendingInit: lvl === "1024" ? { ct1, pk_id: pkId || "", epk, k: lvl } : { ct1, pk_id: pkId || "", epk },
    lvl,
    at: Date.now(),
  };
}

/// Chi riceve il primo messaggio: ricostruisce la stessa radice con la propria identita'
/// (ML-KEM + curva) e la stessa trascrizione. Chi chiama DEVE cancellare subito il segreto
/// della chiave usa-e-getta: e' la differenza fra forward secrecy adesso e fra nove giorni.
/// Il mittente ha usato UNA delle nostre generazioni di chiavi d'aggancio: quale, non c'è
/// bisogno di dirlo nella busta. Si provano la corrente e qualcuna indietro, e vince quella
/// che apre. Nessun campo in più sul filo, nessun oracolo su quale generazione usiamo.
export function initReceiver2Gens(args, gens, env) {
  const list = Array.isArray(gens) && gens.length ? gens : [null];
  for (const g of list) {
    const a = g ? Object.assign({}, args, {
      myDhSk: g.dhSk, myDhPk: g.dhPk, myStaticSk1024: g.k5Sk, myStaticPk1024: g.k5Pk,
    }) : args;
    const st = initReceiver2(a);
    if (!st) continue;
    st.hsgen = g ? g.gen | 0 : 0;
    if (!env) return st;
    // ML-KEM non fallisce MAI la decapsulazione: con la generazione sbagliata restituisce
    // un segreto pseudocasuale, e la radice esce diversa senza che nessuno se ne accorga.
    // L'unica prova che tiene è aprire per davvero il primo messaggio. Si prova su una
    // copia, così lo stato restituito resta intonso e chi chiama decifra una volta sola.
    if (ratchetDecrypt(clone(st), env)) return st;
  }
  return null;
}

export function initReceiver2({ header, myStaticSk, myStaticPk, myDhSk, myDhPk, myRatchetPk, myRatchetSk, myDev, peer, myStaticSk1024, myStaticPk1024 }) {
  const init = header && header.init;
  if (!init || !init.ct1 || !init.epk || !myDhSk || !myDhPk || !myStaticPk) return null;
  // Il livello lo dichiara il mittente ed è coperto dall'AAD: non è modificabile per strada.
  const lvl = String(init.k || "") === "1024" ? "1024" : "768";
  const ikSk = lvl === "1024" ? myStaticSk1024 : myStaticSk;
  const ikPk = lvl === "1024" ? myStaticPk1024 : myStaticPk;
  if (!ikSk || !ikPk) return null;
  let ss, ssX;
  try { ss = (lvl === "1024" ? ml_kem1024 : ml_kem768).decapsulate(unb64(init.ct1), hexToBytes(ikSk)); } catch { return null; }
  try { ssX = x25519.getSharedSecret(hexToBytes(myDhSk), unb64(init.epk)); } catch { return null; }
  const rk = bytesToHex(hkdf(sha256, cat2(ss, ssX), undefined,
    u8(transcript2(ikPk, myDhPk, init.pk_id, init.ct1, init.epk, header.sdev || "", lvl)), 32));
  return {
    v: RAT_V2, rk, cks: null, ckr: null, ns: 0, nr: 0, pn: 0,
    theirXpk: hexb64(init.epk), theirPf: "", theirKemPk: null,
    myXpk: myDhPk, myXsk: myDhSk, myPf: "",
    myKemPk: myRatchetPk, myKemSk: myRatchetSk, myKemCt: null, prevKemPk: null, prevKemSk: null,
    pqOut: false, turns: PQ_EVERY, lastPq: 0,   // la prima risposta rifa' subito il passo PQ
    lvl,
    needStep: false, skipped: {}, heals: 0, sent: 0, recv: 0,
    myDev, theirDev: header.sdev || "", peer: peer || "", pkId: init.pk_id || "",
    at: Date.now(),
  };
}

function encrypt2(state, plaintext) {
  const st = clone(state);
  const h = { v: RAT_V2, sdev: st.myDev, pf: "", xpk: "", n: 0, pn: st.pn };
  if (!st.cks || st.needStep) {
    if (!st.theirXpk) throw new Error("Sessione senza chiave del destinatario");
    // Passo su curva: SEMPRE, a ogni turno. Costa 32 byte e caccia un intruso classico.
    const x = newX();
    const ssX = x25519.getSharedSecret(hexToBytes(x.sk), hexToBytes(st.theirXpk));
    // Passo post-quantistico: rado. La prima volta e' obbligatorio.
    const pq = !!st.theirKemPk && (!st.myKemPk || !st.myKemCt
      || (st.turns | 0) >= PQ_EVERY || Date.now() - (st.lastPq || 0) >= PQ_MS);
    let ssKem = new Uint8Array(0);
    if (pq) {
      const kp = newKeypair();
      const enc = ml_kem768.encapsulate(hexToBytes(st.theirKemPk));
      ssKem = enc.sharedSecret;
      st.prevKemPk = st.myKemPk; st.prevKemSk = st.myKemSk;
      st.myKemPk = kp.pk; st.myKemSk = kp.sk;
      st.myKemCt = bytesToHex(enc.cipherText);
      st.myKemFor = pfOf(st.theirKemPk);   // quale sua chiave abbiamo usato
      st.turns = 0; st.lastPq = Date.now(); st.pqOut = true;
    } else {
      st.turns = (st.turns | 0) + 1; st.pqOut = false;
    }
    const d = kdfRoot2(st.rk, ssKem, ssX, pq);
    st.myXpk = x.pk; st.myXsk = x.sk; st.myPf = pfOf(x.pk);
    st.rk = d.rk; st.cks = d.ck;
    st.pn = st.ns; st.ns = 0; st.needStep = false; st.heals = (st.heals || 0) + 1;
    h.pn = st.pn;
  }
  h.pf = st.myPf;
  h.xpk = b64hex(st.myXpk);
  // Nei turni post-quantistici il materiale sta in OGNI messaggio del turno: cosi' nessun
  // messaggio dipende dall'arrivo di un altro, e l'ordine di consegna non conta.
  if (st.pqOut) {
    h.pk = b64hex(st.myKemPk);
    h.ct = b64hex(st.myKemCt);
    h.kf = st.myKemFor || "";
  }
  if (st.pendingInit) h.init = st.pendingInit;
  const { ck, mk } = kdfChain2(st.cks);
  st.cks = ck; h.n = st.ns; st.ns++; st.sent = (st.sent || 0) + 1; st.at = Date.now();
  const iv = hexToBytes(randomHex(12));
  const ct = gcm(hexToBytes(mk), iv, aad2(h)).encrypt(u8(plaintext));
  return { state: st, env: { r: RAT_V2, h, iv: b64(iv), ct: b64(ct) } };
}

function open2(mkHex, env, h) {
  try {
    return fromU8(gcm(hexToBytes(mkHex), unb64(env.iv), aad2(h)).decrypt(unb64(env.ct)));
  } catch { return null; }
}

function skipTo2(st, upto) {
  let guard = 0;
  while (st.ckr && st.nr < upto && guard++ < MAX_SKIP) {
    const { ck, mk } = kdfChain2(st.ckr);
    st.ckr = ck;
    st.skipped[skKey2(st.theirPf, st.nr)] = mk;
    st.nr++;
  }
  pruneSkipped(st);
}

// Quale delle nostre chiavi ML-KEM ha usato l'altro: la corrente o la precedente. Serve
// perche' ML-KEM non "sbaglia" in modo visibile — con la chiave errata restituisce un
// segreto diverso senza protestare, e ce ne accorgeremmo solo con la busta illeggibile.
function kemSkFor(st, kf) {
  if (!kf) return st.myKemSk || null;
  if (st.myKemPk && pfOf(st.myKemPk) === kf) return st.myKemSk;
  if (st.prevKemPk && pfOf(st.prevKemPk) === kf) return st.prevKemSk;
  return null;
}

function decrypt2(state, env) {
  const h = (env && env.h) || {};
  const st = clone(state);
  st.skipped = st.skipped || {};

  // 1) ritardatario: la sua chiave era stata messa da parte
  const kk = skKey2(h.pf, h.n | 0);
  if (st.skipped[kk]) {
    const pt = open2(st.skipped[kk], env, h);
    if (pt != null) { delete st.skipped[kk]; st.recv = (st.recv || 0) + 1; return { state: st, plaintext: pt }; }
  }

  // 2) turno nuovo dell'altro. Ogni messaggio porta tutto il necessario, quindi qualunque
  //    messaggio del turno lo apre: nessun "messaggio chiave" da perdere.
  if (h.xpk && h.pf && h.pf !== st.theirPf) {
    const xpkHex = hexb64(h.xpk);
    if (pfOf(xpkHex) !== h.pf) return null;      // impronta che non corrisponde: si butta
    if (!st.myXsk) return null;
    if (st.ckr) skipTo2(st, h.pn | 0);
    let ssX;
    try { ssX = x25519.getSharedSecret(hexToBytes(st.myXsk), unb64(h.xpk)); } catch { return null; }
    const pq = !!(h.pk && h.ct);
    let ssKem = new Uint8Array(0);
    if (pq) {
      const sk = kemSkFor(st, h.kf);
      if (!sk) return null;
      try { ssKem = ml_kem768.decapsulate(unb64(h.ct), hexToBytes(sk)); } catch { return null; }
    }
    const d = kdfRoot2(st.rk, ssKem, ssX, pq);
    st.rk = d.rk; st.ckr = d.ck;
    st.theirPf = h.pf; st.theirXpk = xpkHex;
    if (pq) st.theirKemPk = hexb64(h.pk);
    st.nr = 0; st.needStep = true; st.heals = (st.heals || 0) + 1;
  }
  if (!st.ckr) return null;
  if (h.pf !== st.theirPf) return null;

  const n = h.n | 0;
  if (n < st.nr) return null;
  if (n > st.nr) {
    if (n - st.nr > MAX_SKIP) return null;
    skipTo2(st, n);
  }
  const { ck, mk } = kdfChain2(st.ckr);
  st.ckr = ck; st.nr++;
  const pt = open2(mk, env, h);
  if (pt == null) return null;
  st.recv = (st.recv || 0) + 1; st.at = Date.now();
  if (st.pendingInit) delete st.pendingInit;
  pruneSkipped(st);
  return { state: st, plaintext: pt };
}

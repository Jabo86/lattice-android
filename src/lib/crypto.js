// Post-quantum crypto for Lattice Pulse (RN + Node compatible).
// ML-DSA-65 (FIPS 204) for login signatures, ML-KEM-768 (FIPS 203) + AES-256-GCM
// for E2EE. Wire-compatible with the web client (same @noble/post-quantum 0.6.1).
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { ml_kem768, ml_kem1024 } from "@noble/post-quantum/ml-kem.js";
import { sha512, sha256 } from "@noble/hashes/sha2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { gcm } from "@noble/ciphers/aes.js";

// ── Signaling anonimo: chiave X25519 statica deterministica (dal seed ML-DSA sk) ──
// CHIAVI D'AGGANCIO RUOTABILI.
//
// La generazione 0 è, per definizione, esattamente quello che c'era prima: le stesse
// etichette, le stesse chiavi, lo stesso numero di sicurezza. Chi non ruota non si accorge
// di nulla.
//
// Dalla generazione 1 in poi le chiavi d'aggancio si staccano da quelle d'identità: la
// curva usata per aprire le sessioni non è più la stessa che genera il tuo numero di
// sicurezza e i codici d'incontro anonimi. È la rotazione stessa a fare il disaccoppiamento,
// ed è il motivo per cui ruotare NON cambia la tua identità agli occhi di chi ti ha
// verificato: quel numero resta calcolato sulla generazione 0, che non si tocca.
//
// Cosa la rotazione dà davvero, detto senza giri: permette di abbandonare una chiave
// specifica — perché è finita in un backup, perché il parametro va migrato, perché sono
// passati mesi — senza cambiare identità e senza rifare le verifiche. Cosa NON dà: non
// nasconde il passato a chi possiede il tuo segreto d'identità, perché ogni generazione
// resta ricavabile da quello. La forward secrecy dei messaggi non viene da qui: viene dal
// ratchet e dalla chiave usa-e-getta, che vengono distrutte.
export function handshakeDhKeypair(skHex, gen) {
  const g = gen | 0;
  if (g <= 0) return deriveDhKeypair(skHex);
  const seed = sha512(utf8Encode("lattice-hs-dh-v2:" + g + ":" + (skHex || ""))).slice(0, 32);
  return { secretKey: seed, publicKey: x25519.getPublicKey(seed) };
}
export function handshakeKem1024Keypair(skHex, gen) {
  const g = gen | 0;
  if (g <= 0) return deriveKem1024Keypair(skHex);
  const seed = sha512(utf8Encode("lattice-hs-mlkem1024-v2:" + g + ":" + (skHex || ""))); // 64 byte
  return ml_kem1024.keygen(seed);
}

export function deriveDhKeypair(skHex) {
  const seed = sha512(utf8Encode("lattice-anon-dh-v1:" + (skHex || ""))).slice(0, 32);
  return { secretKey: seed, publicKey: x25519.getPublicKey(seed) };
}
// Segreto condiviso pairwise (simmetrico, deterministico): il server non lo può calcolare.
export function anonSharedSecret(myDhSk, theirDhPkHex) {
  return x25519.getSharedSecret(myDhSk, hexToBytes(theirDhPkHex));
}
export function anonRid(shared, label) {
  return bytesToHex(hkdf(sha256, shared, undefined, utf8Encode(label), 16));
}
export function randomHex(n) {
  const a = new Uint8Array(n);
  (globalThis.crypto || global.crypto).getRandomValues(a);
  return bytesToHex(a);
}

// ── Verifica chiamata sicura (SAS anti-MITM, stile ZRTP) ──
// Deriva una breve sequenza di emoji dai fingerprint DTLS di ENTRAMBI i peer (dai loro SDP).
// Se un attaccante intercetta il media, i fingerprint cambiano → i due peer vedono emoji DIVERSE.
const SAS_EMOJIS = ["🐶","🐱","🦊","🐼","🦁","🐸","🐵","🦉","🐝","🐢","🐙","🦋","🌸","🍎","🌙","⭐"];
export function computeSAS(sdp1, sdp2) {
  const fp = (s) => { const m = /a=fingerprint:sha-256 ([0-9A-Fa-f:]+)/.exec(s || ""); return m ? m[1].toUpperCase() : ""; };
  const a = fp(sdp1), b = fp(sdp2);
  if (!a || !b) return null;
  const joined = [a, b].sort().join("|");
  const h = sha256(utf8Encode("lattice-sas-v1:" + joined));
  return Array.from(h.slice(0, 5)).map((x) => SAS_EMOJIS[x & 15]).join(" ");
}

// SHA-256 esadecimale di una stringa (per l'hash della trascrizione negli export firmati).
export function sha256Hex(str) {
  return bytesToHex(sha256(utf8Encode(String(str))));
}

export function hexToBytes(hex) {
  const clean = (hex || "").trim();
  const len = clean.length >> 1;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    const hi = clean.charCodeAt(i * 2);
    const lo = clean.charCodeAt(i * 2 + 1);
    out[i] = (((hi <= 57 ? hi - 48 : (hi & 0x5f) - 55) << 4) | (lo <= 57 ? lo - 48 : (lo & 0x5f) - 55)) & 0xff;
  }
  return out;
}
export function bytesToHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

// Manual UTF-8 (avoids TextEncoder/TextDecoder which Hermes lacks).
function utf8Encode(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff) {
      const c2 = str.charCodeAt(++i);
      const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(out);
}
function utf8Decode(bytes) {
  const codes = [];
  let i = 0;
  while (i < bytes.length) {
    const c = bytes[i++];
    if (c < 0x80) codes.push(c);
    else if (c < 0xe0) codes.push(((c & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (c < 0xf0) codes.push(((c & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    else {
      const cp = ((c & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      const u = cp - 0x10000;
      codes.push(0xd800 + (u >> 10), 0xdc00 + (u & 0x3ff));
    }
  }
  // Chunked join: avoids O(n^2) string concatenation (catastrophic on Hermes for large payloads).
  let s = "";
  const CH = 8192;
  for (let j = 0; j < codes.length; j += CH) {
    s += String.fromCharCode.apply(null, codes.slice(j, j + CH));
  }
  return s;
}
function randBytes(n) {
  const a = new Uint8Array(n);
  // eslint-disable-next-line no-undef
  crypto.getRandomValues(a);
  return a;
}

// Generazione chiave ML-DSA-65 ON-DEVICE (auto-registrazione utenti personali).
// La chiave privata NON lascia mai il dispositivo: al server va solo la pk.
export function keygen() {
  const kp = ml_dsa65.keygen(randBytes(32));
  return { publicKeyHex: bytesToHex(kp.publicKey), secretKeyHex: bytesToHex(kp.secretKey) };
}

// Sign the login challenge nonce (order matches the web client: sign(nonce, sk)).
export function signChallenge(nonceHex, secretKeyHex) {
  return bytesToHex(ml_dsa65.sign(hexToBytes(nonceHex), hexToBytes(secretKeyHex)));
}

// Firma/verifica generica di un messaggio (SDP delle chiamate, testo) con ML-DSA-65.
// noble 0.6.x: sign(msg, secretKey) -> firma ; verify(sig, msg, publicKey) -> bool.
export function signMessage(message, secretKeyHex) {
  if (!secretKeyHex) return "";
  return bytesToHex(ml_dsa65.sign(utf8Encode(String(message)), hexToBytes(secretKeyHex)));
}
export function verifyMessage(message, sigHex, publicKeyHex) {
  try {
    if (!sigHex || !publicKeyHex) return false;
    return ml_dsa65.verify(hexToBytes(sigHex), utf8Encode(String(message)), hexToBytes(publicKeyHex));
  } catch { return false; }
}

export function parseKeyfile(obj) {
  if (!obj || typeof obj !== "object") return null;
  const lns = obj.lns_name || obj.lns || null;
  const sk = obj.secret_key_hex || obj.private_key || null;
  const pk = obj.public_key_hex || obj.public_key || null;
  if (!lns || !sk) return null;
  return { lns, sk, pk, tenant_id: obj.tenant_id || null, did: obj.did || null };
}

// ML-KEM keypair derived deterministically from the ML-DSA secret key.
export function deriveKemKeypair(skHex) {
  const seed = sha512(utf8Encode("lattice-pulse-mlkem-v1:" + (skHex || ""))); // 64 bytes
  return ml_kem768.keygen(seed);
}

// CHIAVE D'IDENTITÀ DI LIVELLO 5 (ML-KEM-1024, FIPS 203).
// Serve a UNA cosa sola: l'apertura di una sessione. È il punto che protegge il segreto più
// longevo di tutta la conversazione — la radice — e quindi merita il parametro più alto che
// lo standard prevede, anche se il ratchet poi continua a 768 dove un passo si rifà ogni
// pochi turni. Deriva dallo stesso segreto d'identità con un'etichetta diversa: non c'è
// nessuna chiave in più da custodire, e il numero di sicurezza NON cambia (resta calcolato
// sulla chiave a 768 e sulla curva), così chi si è già verificato non vede falsi allarmi.
export function deriveKem1024Keypair(skHex) {
  const seed = sha512(utf8Encode("lattice-pulse-mlkem1024-v1:" + (skHex || ""))); // 64 byte
  return ml_kem1024.keygen(seed);
}

// recipientPubHex: { lns: kem_pk_hex }. Returns [{ for, kem, iv, ct }].
// Il valore per ogni destinatario può essere:
//  · una stringa hex → chiave d'identità statica (comportamento storico);
//  · un array [{device_id, pk_id, kem_pub}] → BLOCCO A: una busta per ogni dispositivo,
//    cifrata con una chiave usa-e-getta che verrà buttata (forward secrecy).
export function encryptForRecipients(plaintext, recipientPubHex) {
  const pt = utf8Encode(plaintext);
  const envelopes = [];
  const seal = (lns, pkHex, extra) => {
    const { cipherText, sharedSecret } = ml_kem768.encapsulate(hexToBytes(pkHex));
    const iv = randBytes(12);
    const ct = gcm(sharedSecret, iv).encrypt(pt);
    envelopes.push(Object.assign({ for: lns, kem: bytesToHex(cipherText), iv: bytesToHex(iv), ct: bytesToHex(ct) }, extra || {}));
  };
  for (const [lns, v] of Object.entries(recipientPubHex)) {
    if (!v) continue;
    if (Array.isArray(v)) {
      for (const d of v) if (d && d.kem_pub) seal(lns, d.kem_pub, { dev: d.device_id, pk_id: d.pk_id });
    } else {
      seal(lns, v);
    }
  }
  return envelopes;
}

export function decryptEnvelope(env, kemSecretKey) {
  try {
    const sharedSecret = ml_kem768.decapsulate(hexToBytes(env.kem), kemSecretKey);
    const pt = gcm(sharedSecret, hexToBytes(env.iv)).decrypt(hexToBytes(env.ct));
    return utf8Decode(pt);
  } catch {
    return null;
  }
}

// ── Base64 (Hermes-safe, no atob/btoa) ──
const _B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function bytesToBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    s += _B64[b0 >> 2];
    s += _B64[((b0 & 3) << 4) | ((b1 || 0) >> 4)];
    s += i + 1 < bytes.length ? _B64[((b1 & 15) << 2) | ((b2 || 0) >> 6)] : "=";
    s += i + 2 < bytes.length ? _B64[b2 & 63] : "=";
  }
  return s;
}
export function base64ToBytes(b64) {
  const clean = (b64 || "").replace(/\s/g, "");
  const out = [];
  let buffer = 0, bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === "=") break;
    const v = _B64.indexOf(c);
    if (v < 0) continue;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buffer >> bits) & 0xff); }
  }
  return new Uint8Array(out);
}

// ── E2EE attachments (AES-256-GCM, random per-file key; wire-compatible with web) ──
export function encryptFileBytes(bytes) {
  const keyRaw = randBytes(32);
  const iv = randBytes(12);
  const ct = gcm(keyRaw, iv).encrypt(bytes);
  return { ciphertext: ct, key: bytesToHex(keyRaw), iv: bytesToHex(iv) };
}
export function decryptFileBytes(ciphertext, keyHex, ivHex) {
  return gcm(hexToBytes(keyHex), hexToBytes(ivHex)).decrypt(ciphertext);
}

const PAD_BLOCK = 512;
// PRIVACY (blocco B): uniforma la lunghezza del testo in chiaro a blocchi di 512 byte prima
// di cifrare, così il server non puo' dedurre dalla dimensione se e' un "ok" o una foto.
// Il campo "z" e' ignorato da unpackMessage e dai client vecchi.
export function padPlaintext(s) {
  const over = 7;
  const target = Math.ceil((s.length + over) / PAD_BLOCK) * PAD_BLOCK;
  const n = Math.max(0, target - s.length - over);
  return s.slice(0, -1) + ',"z":"' + " ".repeat(n) + '"}';
}
export function packMessage(text, attachments, reply, ttl) {
  return padPlaintext(JSON.stringify({ __lat: 1, t: text || "", a: attachments || [], r: reply || null, ttl: ttl || 0 }));
}
export function unpackMessage(plaintext) {
  if (typeof plaintext !== "string") return { text: "", atts: [], reply: null, ttl: 0 };
  try {
    const o = JSON.parse(plaintext);
    if (o && typeof o === "object" && o.__lat === 1) return { text: o.t || "", atts: Array.isArray(o.a) ? o.a : [], reply: o.r || null, ttl: o.ttl || 0 };
  } catch { /* legacy plain text */ }
  return { text: plaintext, atts: [], reply: null, ttl: 0 };
}


// ── Canali broadcast E2EE (chiave di gruppo AES-256 + wrapping ML-KEM-768) ──
// Wire-compatible col client web (stessi @noble/post-quantum + AES-GCM).
export function generateGroupKey() {
  return randBytes(32);
}
export function wrapGroupKeyFor(groupKey, recipientPubHex) {
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(hexToBytes(recipientPubHex));
  const iv = randBytes(12);
  const ct = gcm(sharedSecret, iv).encrypt(groupKey);
  return { kem: bytesToHex(cipherText), iv: bytesToHex(iv), ct: bytesToHex(ct) };
}
export function unwrapGroupKey(env, kemSecretKey) {
  const sharedSecret = ml_kem768.decapsulate(hexToBytes(env.kem), kemSecretKey);
  return gcm(sharedSecret, hexToBytes(env.iv)).decrypt(hexToBytes(env.ct));
}
export function encryptWithGroupKey(plaintext, groupKey) {
  const iv = randBytes(12);
  const ct = gcm(groupKey, iv).encrypt(utf8Encode(plaintext));
  return { iv: bytesToHex(iv), ct: bytesToHex(ct) };
}
export function decryptWithGroupKey(ivHex, ctHex, groupKey) {
  try {
    return utf8Decode(gcm(groupKey, hexToBytes(ivHex)).decrypt(hexToBytes(ctHex)));
  } catch {
    return null;
  }
}

// DERIVAZIONE DEL PIN — v2.5.1
//
// Il metodo usato da un telefono e' scritto nel marcatore `lat.pin.kdf`, mai indovinato:
// cosi un vault creato con un metodo si riapre sempre con quello, anche dopo un
// aggiornamento dell'app.
//
//   "pbkdf2-sha512-600000"  → PBKDF2-HMAC-SHA512 nativo di Android (600.000 iterazioni).
//                             E' il metodo di riferimento: gira in codice nativo, fuori
//                             dal thread dell'interfaccia, e sul telefono si misura in
//                             frazioni di secondo.
//   "a2id-19456-2"          → argon2id in JavaScript puro. Resta SOLO come ripiego dove il
//                             modulo nativo non c'e' (e per i test fuori dal telefono).
//                             Sulla carta e' piu forte (memory-hard), sul telefono con
//                             Hermes era cosi lenta da bloccare l'app: nella v2.5.0 il
//                             salvataggio del PIN non finiva mai. Un KDF che blocca l'app
//                             vale zero.
//   nessun marcatore        → installazione vecchia: un solo sha512. Si aggiorna al primo
//                             sblocco riuscito.
import { NativeModules } from "react-native";
import { argon2id } from "@noble/hashes/argon2.js";
import { hexToBytes } from "./crypto";

export const M_PBKDF2 = "pbkdf2-sha512-600000";
export const M_ARGON2 = "a2id-19456-2";
const PBKDF2_ITER = 600000;
const A2 = { t: 2, m: 19456, p: 1, dkLen: 32 };

const N = NativeModules.LatticeKdf || null;
export const NATIVO = !!N;

function enc8(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 128) out.push(c);
    else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63));
    else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
  }
  return new Uint8Array(out);
}

/// Metodo da usare per un PIN NUOVO su questo telefono.
export function metodoMigliore() {
  return N ? M_PBKDF2 : M_ARGON2;
}

/// Deriva la chiave da PIN + sale con il metodo indicato. 32 byte.
export async function derive(metodo, pin, salt) {
  if (metodo === M_PBKDF2) {
    if (!N) throw new Error("Su questo telefono manca il modulo di derivazione nativo.");
    const hex = await N.derive(String(pin), String(salt), PBKDF2_ITER);
    return hexToBytes(String(hex).slice(0, 64));
  }
  return argon2id(enc8(String(pin)), enc8(String(salt)), A2);
}

/// Millisecondi reali su QUESTO telefono. -1 se non misurabile.
export async function costoMisurato() {
  if (!N || typeof N.bench !== "function") return -1;
  try { return await N.bench(PBKDF2_ITER); } catch { return -1; }
}

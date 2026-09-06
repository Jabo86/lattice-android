// Verifica dell'aggiornamento: firma del manifest (ML-DSA-65) e impronta SHA-256 dell'APK
// scaricato, calcolata a blocchi per non far esplodere la memoria del telefono.
import * as FileSystem from "expo-file-system/legacy";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "./crypto";
import { VENDOR_PUB, MANIFEST_LABEL } from "./vendorKey";

// Decoder base64 veloce (tabella + Uint8Array): serve per macinare 60+ MB a blocchi.
const B64 = new Int16Array(256).fill(-1);
{
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < A.length; i++) B64[A.charCodeAt(i)] = i;
}
function b64Bytes(s) {
  const len = s.length;
  const out = new Uint8Array((len >> 2) * 3 + 3);
  let o = 0, buf = 0, bits = 0;
  for (let i = 0; i < len; i++) {
    const v = B64[s.charCodeAt(i)];
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (buf >> bits) & 0xff; }
  }
  return out.subarray(0, o);
}

function utf8(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(out);
}

/// Il manifest è firmato dal produttore? (nessuna firma = manifest non attendibile)
export function verifyManifest(m) {
  if (!m || !m.sig || m.sig_alg !== "ml-dsa-65") return false;
  const canon = [MANIFEST_LABEL, m.versionName, m.versionCode, m.url, m.sha256, m.size].join("|");
  try {
    return ml_dsa65.verify(hexToBytes(m.sig), utf8(canon), hexToBytes(VENDOR_PUB));
  } catch { return false; }
}

const CHUNK = 768 * 1024;

/// SHA-256 del file scaricato, a blocchi. onProgress riceve 0..1.
export async function fileSha256(uri, size, onProgress) {
  const h = sha256.create();
  let pos = 0;
  while (pos < size) {
    const b64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64, position: pos, length: CHUNK,
    });
    if (!b64) break;
    const bytes = b64Bytes(b64);
    if (!bytes.length) break;
    h.update(bytes);
    pos += bytes.length;
    if (onProgress) onProgress(Math.min(1, pos / size));
  }
  if (pos < size) throw new Error("File incompleto durante la verifica");
  return bytesToHex(h.digest());
}

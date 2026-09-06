// ALLEGATI GRANDI SUL TELEFONO — cifratura e decifratura a pezzi da 4 MB.
//
// Prima un allegato passava per una stringa base64 dell'INTERO file: con 8 MB si stava
// già al limite, e 100 MB avrebbero spento l'app. Qui il file non entra mai tutto in
// memoria: si leggono 4 MB, si cifrano, si spediscono — e al contrario in discesa.
//
// Formato identico a quello del browser (v2): una sola chiave AES-256, un nonce per
// pezzo (gli ultimi quattro byte del nonce sono il numero del pezzo, come prescrive
// GCM), pezzi concatenati in un unico blob opaco lato server. Il manifest dell'allegato
// porta `cs` (dimensione del pezzo) e `n` (quanti pezzi): se non ci sono, è un allegato
// del vecchio formato e si apre come prima.
import { File, FileMode } from "expo-file-system";
import { gcm } from "@noble/ciphers/aes.js";
import * as api from "./api";
import { bytesToHex, hexToBytes } from "./crypto";

export const ATT_CHUNK = 4 * 1024 * 1024;   // 4 MB in chiaro per pezzo
export const MAX_ATT = 100 * 1024 * 1024;   // tetto per allegato, come sul web
const TAG = 16;                             // tag di autenticazione GCM

function rand(n) {
  const a = new Uint8Array(n);
  // eslint-disable-next-line no-undef
  crypto.getRandomValues(a);
  return a;
}

export function attNonce(iv, index) {
  const n = new Uint8Array(12);
  n.set(iv.subarray(0, 8));
  n[8] = (index >>> 24) & 255;
  n[9] = (index >>> 16) & 255;
  n[10] = (index >>> 8) & 255;
  n[11] = index & 255;
  return n;
}

export const isChunked = (att) => !!(att && att.n && att.cs);

// Cifra e spedisce un file dal disco, un pezzo alla volta. Restituisce la voce di
// manifest da infilare nel messaggio cifrato (la chiave viaggia lì dentro, non al server).
export async function uploadFileChunked({ uri, name, mime, size, allowed, onProgress }) {
  const src = new File(uri);
  const total = size || src.size || 0;
  if (!total) throw new Error("File vuoto o non leggibile");
  if (total > MAX_ATT) throw new Error("File troppo grande");

  const key = rand(32);
  const iv = rand(12);
  const n = Math.max(1, Math.ceil(total / ATT_CHUNK));
  const { upload_id } = await api.blobInit();
  const h = src.open(FileMode.ReadOnly);
  try {
    for (let i = 0; i < n; i++) {
      const plain = h.readBytes(ATT_CHUNK);
      if (!plain || plain.length === 0) break;
      await api.blobPutChunk(upload_id, i, gcm(key, attNonce(iv, i)).encrypt(plain));
      onProgress?.((i + 1) / n);
    }
  } finally { try { h.close(); } catch { /* niente */ } }
  const { id } = await api.blobFinalize(upload_id, allowed);
  return {
    id, name, mime: mime || "application/octet-stream", size: total,
    key: bytesToHex(key), iv: bytesToHex(iv), cs: ATT_CHUNK, n,
  };
}

// Scarica il cifrato in un file temporaneo e lo decifra pezzo per pezzo dentro `destUri`.
// Restituisce il primo pezzo in chiaro: serve alla scansione euristica, che guarda
// l'inizio del file e non ha bisogno di tenerne in memoria cento megabyte.
export async function decryptToFile(att, destUri, onProgress) {
  const tmp = new File(destUri + ".ct");
  try { if (tmp.exists) tmp.delete(); } catch { /* niente */ }
  await File.downloadFileAsync(api.blobUrl(att.id), tmp, {
    headers: await api.authHeaders(),
    idempotent: true,
  });

  const out = new File(destUri);
  try { if (out.exists) out.delete(); } catch { /* niente */ }
  out.create({ overwrite: true });

  const key = hexToBytes(att.key);
  const iv = hexToBytes(att.iv);
  const step = att.cs + TAG;
  const rh = tmp.open(FileMode.ReadOnly);
  const wh = out.open(FileMode.Truncate);
  let first = null;
  try {
    for (let i = 0; i < att.n; i++) {
      const ct = rh.readBytes(step);
      if (!ct || ct.length === 0) break;
      const plain = gcm(key, attNonce(iv, i)).decrypt(ct);
      if (i === 0) first = plain;
      wh.writeBytes(plain);
      onProgress?.((i + 1) / att.n);
    }
  } finally {
    try { rh.close(); } catch { /* niente */ }
    try { wh.close(); } catch { /* niente */ }
    try { tmp.delete(); } catch { /* niente */ }
  }
  return first;
}

// Copia un file in un'altra destinazione (anche una cartella scelta con SAF) leggendo e
// scrivendo 4 MB alla volta: salvare 100 MB in Download non deve passare per una stringa
// base64 da 133 MB.
export async function copyToUriChunked(srcUri, destUri, onProgress) {
  const src = new File(srcUri);
  const dst = new File(destUri);
  const total = src.size || 0;
  const rh = src.open(FileMode.ReadOnly);
  const wh = dst.open(FileMode.Truncate);
  let done = 0;
  try {
    for (;;) {
      const chunk = rh.readBytes(ATT_CHUNK);
      if (!chunk || chunk.length === 0) break;
      wh.writeBytes(chunk);
      done += chunk.length;
      if (total) onProgress?.(Math.min(1, done / total));
    }
  } finally {
    try { rh.close(); } catch { /* niente */ }
    try { wh.close(); } catch { /* niente */ }
  }
}

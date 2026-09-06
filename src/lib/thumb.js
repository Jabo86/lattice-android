// ANTEPRIME ISTANTANEE — ThumbHash (v1.5.0)
//
// Un'immagine allegata, prima di essere scaricata e decifrata, non si può mostrare: al suo
// posto restava un rettangolo grigio. Fino alla 1.4.4 mandavamo dentro la busta cifrata un
// micro-JPEG da 14 px (600-1500 byte): funzionava, ma pesava.
//
// ThumbHash fa la stessa cosa in ~25 BYTE: una rappresentazione a coefficienti DCT della
// foto, che il telefono di chi riceve trasforma in una sfumatura molto simile all'originale.
// Sta comodamente dentro la busta cifrata (che ha padding a 512 byte, quindi spesso il
// costo reale è ZERO) e il server non lo vede mai, come tutto il resto del contenuto.
//
// Perché serve il PNG: ThumbHash lavora sui pixel, e su React Native non esiste un modo di
// leggere i pixel di una foto. Chiediamo quindi al manipolatore di immagini un PNG minuscolo
// (max 64 px) e lo decodifichiamo qui in JS (`pako` per lo sgonfiaggio dello zlib). È veloce:
// 64x64 = 4096 pixel.
import pako from "pako";
import { rgbaToThumbHash, thumbHashToRGBA } from "thumbhash";
import { bytesToBase64, base64ToBytes } from "./crypto";

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

/// PNG (8 bit, non interlacciato) → { w, h, rgba }. `null` se il formato non è quello
/// che sappiamo leggere: in quel caso si rinuncia all'anteprima, non si sbaglia.
export function pngToRgba(u8) {
  if (!u8 || u8.length < 24) return null;
  for (let i = 0; i < 8; i++) if (u8[i] !== PNG_SIG[i]) return null;
  const be32 = (i) => ((u8[i] << 24) | (u8[i + 1] << 16) | (u8[i + 2] << 8) | u8[i + 3]) >>> 0;
  let p = 8, w = 0, h = 0, depth = 0, ctype = 0, inter = 0;
  const parts = [];
  while (p + 8 <= u8.length) {
    const len = be32(p);
    const type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
    const data = u8.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = be32(p + 8); h = be32(p + 12); depth = data[8]; ctype = data[9]; inter = data[12];
    } else if (type === "IDAT") parts.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (!w || !h || depth !== 8 || inter !== 0 || !parts.length) return null;
  const ch = ctype === 6 ? 4 : ctype === 2 ? 3 : ctype === 4 ? 2 : ctype === 0 ? 1 : 0;
  if (!ch) return null;

  let comp;
  if (parts.length === 1) comp = parts[0];
  else {
    let n = 0;
    for (const d of parts) n += d.length;
    comp = new Uint8Array(n);
    let off = 0;
    for (const d of parts) { comp.set(d, off); off += d.length; }
  }
  let raw;
  try { raw = pako.inflate(comp); } catch (e) { return null; }

  const stride = w * ch;
  if (raw.length < (stride + 1) * h) return null;
  const rgba = new Uint8Array(w * h * 4);
  const cur = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  let ri = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[ri++];
    for (let x = 0; x < stride; x++) cur[x] = raw[ri + x];
    ri += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev[x];
      const c = x >= ch ? prev[x - ch] : 0;
      let v = cur[x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      cur[x] = v;
    }
    const o = y * w * 4;
    for (let x = 0; x < w; x++) {
      const s = x * ch, d = o + x * 4;
      if (ch === 4) { rgba[d] = cur[s]; rgba[d + 1] = cur[s + 1]; rgba[d + 2] = cur[s + 2]; rgba[d + 3] = cur[s + 3]; }
      else if (ch === 3) { rgba[d] = cur[s]; rgba[d + 1] = cur[s + 1]; rgba[d + 2] = cur[s + 2]; rgba[d + 3] = 255; }
      else if (ch === 2) { rgba[d] = rgba[d + 1] = rgba[d + 2] = cur[s]; rgba[d + 3] = cur[s + 1]; }
      else { rgba[d] = rgba[d + 1] = rgba[d + 2] = cur[s]; rgba[d + 3] = 255; }
    }
    prev.set(cur);
  }
  return { w, h, rgba };
}

/// PNG (base64, max 100 px per lato) → ThumbHash in base64 (~34 caratteri). "" se non riesce.
export function encodeThumbHashFromPngBase64(b64) {
  try {
    const img = pngToRgba(base64ToBytes(b64));
    if (!img || img.w < 4 || img.h < 4 || img.w > 100 || img.h > 100) return "";
    const hash = rgbaToThumbHash(img.w, img.h, img.rgba);
    return hash && hash.length ? bytesToBase64(new Uint8Array(hash)) : "";
  } catch (e) { return ""; }
}

// ── ThumbHash → immagine da mostrare ──
// La libreria offre `thumbHashToDataURL`, ma passa da `btoa` e da uno spread di migliaia di
// argomenti a `String.fromCharCode`: su Hermes il primo non esiste e il secondo può far
// esplodere la pila. Ricostruiamo quindi il PNG qui, con le nostre funzioni base64.
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (~c) >>> 0;
}
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
export function rgbaToPngBase64(w, h, rgba) {
  const stride = w * 4;
  const raw = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // nessun filtro: l'immagine è minuscola
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const z = pako.deflate(raw, { level: 6 });
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bit, RGBA
  const parts = [new Uint8Array(PNG_SIG), chunk("IHDR", ihdr), chunk("IDAT", z), chunk("IEND", new Uint8Array(0))];
  let n = 0;
  for (const p of parts) n += p.length;
  const all = new Uint8Array(n);
  let off = 0;
  for (const p of parts) { all.set(p, off); off += p.length; }
  return bytesToBase64(all);
}

// La stessa anteprima ricompare in ogni ridisegno della lista: si decodifica una volta sola.
const cache = new Map();
const CACHE_MAX = 120;

/// ThumbHash (base64) → data URI PNG pronta per <Image>. "" se il gettone non è valido.
export function thumbDataUri(hashB64) {
  const k = String(hashB64 || "");
  if (!k) return "";
  const hit = cache.get(k);
  if (hit !== undefined) return hit;
  let uri = "";
  try {
    const img = thumbHashToRGBA(base64ToBytes(k));
    if (img && img.w && img.h) uri = "data:image/png;base64," + rgbaToPngBase64(img.w, img.h, img.rgba);
  } catch (e) { uri = ""; }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(k, uri);
  return uri;
}

/// Svuota la cache delle anteprime (chiamata quando l'app si blocca: anche una sfumatura
/// racconta qualcosa di una foto).
export function clearThumbCache() { cache.clear(); }

// FOTO IN CHAT: compressione automatica + anteprima istantanea (v1.5.0)
//
// · L'immagine viene ricompressa sul TELEFONO prima di essere cifrata: lato massimo 1600 px
//   e formato WEBP, che a pari qualità visiva pesa il 25-35% meno del JPEG. Se il telefono
//   non sapesse produrre WEBP si torna al JPEG (nessun invio deve mai fallire per questo).
// · AVIF e HEIC (i formati delle fotocamere recenti) vengono riconosciuti e riconvertiti:
//   così la foto si apre anche sui telefoni più vecchi di chi la riceve.
// · Insieme alla foto viaggia un ThumbHash da ~25 byte (`tf`) e le dimensioni reali (`w`,`h`):
//   la chat mostra subito una sfumatura fedele e riserva lo spazio giusto, senza scaricare
//   nulla. Tutto DENTRO la busta cifrata: il server non vede né anteprima né dimensioni.
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { encodeThumbHashFromPngBase64 } from "./thumb";

export const MAX_SIDE = 1600;   // lato massimo dell'immagine inviata
export const ATT_Q = 0.72;      // qualità dell'allegato (WEBP)
export const HASH_SIDE = 64;    // lato del PNG da cui si calcola il ThumbHash
export const THUMB_SIDE = 14;   // lato della micro-anteprima di ripiego
export const THUMB_Q = 0.45;    // qualità della micro-anteprima di ripiego

// Soglia oltre la quale un'immagine NON si scarica da sola: si mostra l'anteprima e si
// scarica solo se l'utente la tocca (risparmio di banda aziendale).
export const AUTO_MAX_BYTES = 900 * 1024;

function base64Len(b64) {
  // byte reali rappresentati da una stringa base64 (serve per i controlli nei test)
  const s = String(b64 || "").replace(/=+$/, "");
  return Math.floor((s.length * 3) / 4);
}

/// Formati che vanno riconvertiti prima dell'invio (non tutti i telefoni li aprono).
export function isModernFormat(mime, name) {
  const m = String(mime || "").toLowerCase();
  const n = String(name || "").toLowerCase();
  return /avif|heic|heif/.test(m) || /\.(avif|heic|heif)$/.test(n);
}

// Immagine pronta per l'invio: {uri, base64, w, h, tf, th, mime, ext}
// In caso di errore del manipolatore si restituisce l'originale (mai bloccare l'invio).
export async function prepareImage(asset) {
  const out = {
    uri: asset?.uri, base64: asset?.base64 || "",
    w: asset?.width || 0, h: asset?.height || 0,
    tf: "", th: "", mime: asset?.mimeType || "image/jpeg", ext: "jpg",
  };
  if (!asset?.uri) return out;
  const w = asset.width || 0;
  const h = asset.height || 0;
  const side = Math.max(w, h);
  // Ridimensiona solo se serve davvero: ricomprimere un'immagine già piccola la peggiora.
  const ops = side > MAX_SIDE && side > 0
    ? [{ resize: w >= h ? { width: MAX_SIDE } : { height: MAX_SIDE } }]
    : [];
  const tries = [
    { format: SaveFormat.WEBP, mime: "image/webp", ext: "webp" },
    { format: SaveFormat.JPEG, mime: "image/jpeg", ext: "jpg" },
  ];
  for (const t of tries) {
    try {
      const r = await manipulateAsync(asset.uri, ops, { compress: ATT_Q, format: t.format, base64: true });
      if (r?.base64) {
        out.uri = r.uri || out.uri;
        out.base64 = r.base64;
        out.w = r.width || out.w;
        out.h = r.height || out.h;
        out.mime = t.mime;
        out.ext = t.ext;
        break;
      }
    } catch (e) { /* si prova il formato successivo */ }
  }
  if (out.base64 === (asset.base64 || "") && isModernFormat(asset.mimeType, asset.fileName)) {
    // Nessuna conversione riuscita su un formato moderno: meglio dichiararlo per quello che è.
    out.mime = String(asset.mimeType || "image/avif");
    out.ext = out.mime.split("/")[1] || "img";
  }
  out.tf = await thumbHash(out.uri || asset.uri, out.w, out.h);
  if (!out.tf) out.th = await microThumb(out.uri || asset.uri, out.w, out.h);
  return out;
}

/// ThumbHash dell'immagine (~34 caratteri base64). "" se non riesce: l'anteprima è un lusso,
/// non deve mai impedire l'invio di un allegato.
export async function thumbHash(uri, w, h) {
  if (!uri) return "";
  try {
    const wide = (w || 1) >= (h || 1);
    const t = await manipulateAsync(
      uri,
      [{ resize: wide ? { width: HASH_SIDE } : { height: HASH_SIDE } }],
      { format: SaveFormat.PNG, base64: true }
    );
    return t?.base64 ? encodeThumbHashFromPngBase64(t.base64) : "";
  } catch (e) { return ""; }
}

// Ripiego storico: micro-JPEG di THUMB_SIDE px sul lato lungo (usato solo se il ThumbHash
// non si è potuto calcolare). Le buste della 1.4.x portano questo campo (`th`).
export async function microThumb(uri, w, h) {
  if (!uri) return "";
  try {
    const wide = (w || 1) >= (h || 1);
    const t = await manipulateAsync(
      uri,
      [{ resize: wide ? { width: THUMB_SIDE } : { height: THUMB_SIDE } }],
      { compress: THUMB_Q, format: SaveFormat.JPEG, base64: true }
    );
    const b64 = t?.base64 || "";
    // Guardia: se per qualsiasi motivo il risultato è grosso, si scarta. La busta cifrata
    // ha padding a 512 byte: un'anteprima da 4 KB peggiorerebbe la chat invece di aiutarla.
    if (b64 && base64Len(b64) <= 1500) return b64;
    return "";
  } catch (e) { return ""; }
}

// L'allegato si scarica da solo? Le immagini leggere e i vocali sì; video, documenti e
// immagini pesanti no (li apre l'utente con un tocco).
export function autoLoads(att) {
  const mime = String(att?.mime || "");
  const size = Number(att?.size || 0);
  if (att?.kind === "voice" || mime.startsWith("audio/")) return true;
  if (mime.startsWith("image/")) return !(size > AUTO_MAX_BYTES);
  return false;
}

// Etichetta leggibile della dimensione (per il pulsante "Scarica").
export function humanSize(n) {
  const b = Number(n || 0);
  if (b <= 0) return "";
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return Math.round(b / 1024) + " KB";
  return (b / (1024 * 1024)).toFixed(b < 10 * 1024 * 1024 ? 1 : 0) + " MB";
}

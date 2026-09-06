// FOTO LEGGERE E ANTEPRIMA ISTANTANEA
// 1) In SDK 57 `manipulateAsync` è DEPRECATA e lancia un errore invece di lavorare: per
//    questo le foto (e gli avatar dei gruppi, 2,6 MB!) partivano a piena risoluzione. Qui si
//    usa la nuova API a contesto, con la vecchia solo come ripiego.
// 2) `microPreview` produce un'immagine da ~24px (poche centinaia di byte) che viaggia DENTRO
//    la busta cifrata: si vede sfocata all'istante, mentre la foto vera si scarica e decifra.
//    È l'idea di ThumbHash resa possibile senza accesso ai pixel grezzi.
import { ImageManipulator, manipulateAsync, SaveFormat } from "expo-image-manipulator";

async function run(uri, width, compress) {
  try {
    const img = await ImageManipulator.manipulate(uri).resize({ width }).renderAsync();
    const out = await img.saveAsync({ compress, format: SaveFormat.JPEG, base64: true });
    try { img.release?.(); } catch { /* niente */ }
    if (out?.base64) return out;
  } catch { /* si prova la via vecchia */ }
  try {
    const out = await manipulateAsync(uri, [{ resize: { width } }], { compress, format: SaveFormat.JPEG, base64: true });
    if (out?.base64) return out;
  } catch { /* niente da fare */ }
  return null;
}

/// Riduce una foto sotto `maxBytes` (di norma 500 KB) restando nitida.
/// Restituisce { base64, width, height } oppure null se non è stato possibile.
export async function shrinkPhoto(uri, maxBytes = 500 * 1024) {
  const steps = [[1600, 0.72], [1280, 0.65], [1024, 0.6], [800, 0.55]];
  let last = null;
  for (const [w, q] of steps) {
    const out = await run(uri, w, q);
    if (!out) break;
    last = out;
    // base64 è ~4/3 dei byte reali
    if ((out.base64.length * 3) / 4 <= maxBytes) return out;
  }
  return last;
}

/// Micro-anteprima (~24px): poche centinaia di byte, da mostrare sfocata subito.
export async function microPreview(uri) {
  const out = await run(uri, 24, 0.4);
  if (!out?.base64 || out.base64.length > 3000) return null;
  return "data:image/jpeg;base64," + out.base64;
}

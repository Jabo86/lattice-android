// QR → PNG in JavaScript puro (nessun modulo nativo, nessun canvas).
// Sta in una funzione a parte perché così è verificabile fuori dall'app: il test
// `test/test_v151.mjs` genera il PNG con QUESTA funzione e lo rilegge col lettore
// (jsQR + pngToRgba), cioè la stessa strada che fanno i due telefoni.
import { rgbaToPngBase64 } from "./thumb";

const PX = 6; // pixel per modulo: abbondante per qualunque lettore
const QZ = 3; // margine chiaro obbligatorio (quiet zone), in moduli

/// Restituisce il PNG in base64 (senza prefisso data:) oppure "" se non è possibile.
export function qrPngBase64(value) {
  try {
    const gen = require("qrcode-generator");
    const qrcode = gen && (gen.default || gen);
    const qr = qrcode(0, "M");
    qr.addData(String(value || ""));
    qr.make();
    const n = qr.getModuleCount();
    const dim = (n + QZ * 2) * PX;
    const rgba = new Uint8Array(dim * dim * 4).fill(255);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!qr.isDark(r, c)) continue;
        for (let y = 0; y < PX; y++) {
          const row = ((r + QZ) * PX + y) * dim;
          for (let x = 0; x < PX; x++) {
            const d = (row + (c + QZ) * PX + x) * 4;
            rgba[d] = 0; rgba[d + 1] = 0; rgba[d + 2] = 0; rgba[d + 3] = 255;
          }
        }
      }
    }
    return rgbaToPngBase64(dim, dim, rgba);
  } catch (e) { return ""; }
}

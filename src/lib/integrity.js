// SENSORE DI INTEGRITA — lato JS.
// Il controllo si fa all'avvio e ogni volta che l'app torna in primo piano: un cavo ADB si
// collega mentre l'app e' aperta, non prima.
import { NativeModules, AppState } from "react-native";

const N = NativeModules.LatticeIntegrity || null;

const VUOTO = { root: false, debug: false, emulatore: false, allarme: false, motivi: [] };

export async function controlla() {
  if (!N) return VUOTO;
  try {
    const r = await N.check();
    return { ...VUOTO, ...r, motivi: Array.isArray(r.motivi) ? r.motivi : [] };
  } catch { return VUOTO; }
}

/// Sorveglia in continuo: chiama `fn(esito)` all'avvio e a ogni ritorno in primo piano.
export function sorveglia(fn) {
  let vivo = true;
  const giro = () => { controlla().then((r) => { if (vivo) fn(r); }).catch(() => {}); };
  giro();
  const sub = AppState.addEventListener("change", (s) => { if (s === "active") giro(); });
  return () => { vivo = false; try { sub.remove(); } catch { /* niente */ } };
}

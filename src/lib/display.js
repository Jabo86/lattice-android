// Frequenza dello schermo, lato JS. Nessuna promessa: si mostra cio' che il telefono da.
import { NativeModules } from "react-native";

const N = NativeModules.LatticeDeviceInfo || null;

export async function display() {
  if (!N || typeof N.display !== "function") return { hz: 0, maxHz: 0, modes: 0 };
  try {
    const d = await N.display();
    return { hz: Number(d.hz) || 0, maxHz: Number(d.maxHz) || 0, modes: Number(d.modes) || 0 };
  } catch { return { hz: 0, maxHz: 0, modes: 0 }; }
}

/// Riga da mostrare in Impostazioni. Onesta per costruzione:
/// · se il telefono e' a 120 Hz e l'app li ha ottenuti → "120 fps"
/// · se il pannello li avrebbe ma il sistema li ha negati → lo dice
/// · se il pannello e' a 60 Hz → dice 60, senza far finta.
export function fpsLine(d, it = true) {
  const hz = Math.round(d.hz), max = Math.round(d.maxHz);
  if (!hz) return it ? "Fluidita: non leggibile su questo telefono" : "Smoothness: not readable on this phone";
  if (max > hz) {
    return it
      ? `Fluidita: ${hz} fps attivi · il tuo schermo arriverebbe a ${max} (il sistema li sta limitando, spesso per batteria o temperatura)`
      : `Smoothness: ${hz} fps active · your screen could reach ${max} (the system is limiting it, usually for battery or heat)`;
  }
  return it
    ? `Fluidita: ${hz} fps · il massimo che questo schermo puo dare`
    : `Smoothness: ${hz} fps · the maximum this screen can give`;
}

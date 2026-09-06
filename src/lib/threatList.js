import * as FileSystem from "expo-file-system/legacy";
import { setThreatDomains } from "./threatEngine";

// Feed gratuito di domini malevoli (URLhaus) aggiornato sul server.
// La lista pesa ~3 MB: scaricarla e analizzarla a OGNI avvio (con tanto di
// `?t=` che impediva qualsiasi cache) rallentava l'intera app per secondi.
// Ora resta sul telefono, si riscarica al massimo una volta al giorno e viene caricata
// dopo che l'app è già utilizzabile. La protezione è identica.
const THREAT_LIST_URL = "https://lattice-network.it/downloads/threats.json";
const FILE = FileSystem.documentDirectory + "threats.json";
const MAX_AGE_MS = 24 * 3600 * 1000;

function apply(txt) {
  const j = JSON.parse(txt);
  if (!Array.isArray(j?.domains)) return 0;
  setThreatDomains(j.domains);
  return j.domains.length;
}

export async function loadThreatList() {
  let fresh = false;
  try {
    const info = await FileSystem.getInfoAsync(FILE);
    if (info?.exists) {
      fresh = !!info.modificationTime && Date.now() - info.modificationTime * 1000 < MAX_AGE_MS;
      try {
        const n = apply(await FileSystem.readAsStringAsync(FILE));
        if (fresh) return n;
      } catch { fresh = false; /* file rovinato: si riscarica */ }
    }
  } catch { /* nessuna copia locale */ }
  try {
    const r = await fetch(THREAT_LIST_URL);
    if (!r.ok) return 0;
    const txt = await r.text();
    const n = apply(txt);
    if (n) { try { await FileSystem.writeAsStringAsync(FILE, txt); } catch { /* spazio pieno */ } }
    return n;
  } catch { /* nessuna rete: euristiche locali sempre attive */ }
  return 0;
}

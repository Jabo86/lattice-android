import AsyncStorage from "@react-native-async-storage/async-storage";

// Registro locale delle minacce fermate dallo Scudo (solo sul dispositivo).
const KEY = "lattice_threat_log";
const COUNT_KEY = "lattice_threat_count";
let cache = null;
let countCache = null;

export async function getThreatCount() {
  if (countCache != null) return countCache;
  try { const s = await AsyncStorage.getItem(COUNT_KEY); countCache = s ? parseInt(s, 10) || 0 : 0; }
  catch { countCache = 0; }
  return countCache;
}

async function bumpThreatCount() {
  const c = (await getThreatCount()) + 1;
  countCache = c;
  try { await AsyncStorage.setItem(COUNT_KEY, String(c)); } catch { /* ignore */ }
  return c;
}

export async function getThreatLog() {
  if (cache) return cache;
  try { const s = await AsyncStorage.getItem(KEY); cache = s ? JSON.parse(s) : []; }
  catch { cache = []; }
  return cache;
}

export async function recordThreat({ level, reasons = [], context = "Messaggio" }) {
  if (!level || level === "safe" || !reasons.length) return;
  try {
    const list = await getThreatLog();
    const at = Date.now();
    const sig = context + "|" + level + "|" + reasons.join("|");
    const last = list[0];
    // Dedup: stessa minaccia stesso contesto entro 2 minuti
    if (last && (last.context + "|" + last.level + "|" + last.reasons.join("|")) === sig && at - last.at < 120000) return;
    list.unshift({ level, reasons: reasons.slice(0, 6), context, at });
    cache = list.slice(0, 50);
    await AsyncStorage.setItem(KEY, JSON.stringify(cache));
    await bumpThreatCount();
  } catch { /* ignore */ }
}

export async function clearThreatLog() {
  cache = [];
  try { await AsyncStorage.removeItem(KEY); } catch { /* ignore */ }
}

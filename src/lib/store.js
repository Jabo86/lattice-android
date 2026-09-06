import AsyncStorage from "@react-native-async-storage/async-storage";

const KF_KEY = "lattice.pulse.keyfile.v1";
const SRV_KEY = "lattice.pulse.server.v1";

export async function saveKeyfile(rawKf) {
  // Il file chiave NON resta mai in chiaro: va nel blob cifrato (col PIN se attivo,
  // altrimenti con la chiave del dispositivo custodita dal Keystore Android).
  const lock = require("./lock");
  await lock.setBlob("keyfile", rawKf);
  await AsyncStorage.removeItem(KF_KEY); // via l'eventuale copia in chiaro delle versioni vecchie
}
export async function loadKeyfile() {
  const lock = require("./lock");
  const blob = await lock.getBlob("keyfile");
  if (blob) return blob;
  // Installazioni vecchie: copia in chiaro ancora sul telefono → si cifra e si cancella.
  const s = await AsyncStorage.getItem(KF_KEY);
  if (s) {
    const kf = JSON.parse(s);
    try { await lock.setBlob("keyfile", kf); await AsyncStorage.removeItem(KF_KEY); } catch { /* riprova al prossimo avvio */ }
    return kf;
  }
  return null; // col PIN attivo e app ancora bloccata è normale: si legge dopo lo sblocco
}
export async function clearStoredKeyfile() {
  await AsyncStorage.removeItem(KF_KEY);
  try { await require("./lock").removeBlob("keyfile"); } catch { /* lock non disponibile */ }
}

export async function saveServer(url) {
  await AsyncStorage.setItem(SRV_KEY, url);
}
export async function loadServer() {
  return (await AsyncStorage.getItem(SRV_KEY)) || null;
}

const LOCK_KEY = "lattice.pulse.applock.v1";
const NOTIF_KEY = "lattice.pulse.notif.v1";
export async function saveAppLock(v) { await AsyncStorage.setItem(LOCK_KEY, v ? "1" : "0"); }
export async function loadAppLock() { const s = await AsyncStorage.getItem(LOCK_KEY); return s === null ? null : s === "1"; }
export async function saveNotifPref(v) { await AsyncStorage.setItem(NOTIF_KEY, v ? "1" : "0"); }
export async function loadNotifPref() { const s = await AsyncStorage.getItem(NOTIF_KEY); return s === null ? null : s === "1"; }
const RINGTONE_KEY = "lattice.pulse.ringtone.v1";
export async function saveRingtone(k) { await AsyncStorage.setItem(RINGTONE_KEY, k || "classic"); }
export async function loadRingtone() { return (await AsyncStorage.getItem(RINGTONE_KEY)) || "classic"; }
const RINGVOL_KEY = "lattice.pulse.ringvol.v1";
export async function saveRingVolume(v) { await AsyncStorage.setItem(RINGVOL_KEY, String(v)); }
export async function loadRingVolume() { const s = await AsyncStorage.getItem(RINGVOL_KEY); const n = parseFloat(s); return isNaN(n) ? 1 : n; }
const VIBMODE_KEY = "lattice.pulse.vibmode.v1";
export async function saveVibMode(m) { await AsyncStorage.setItem(VIBMODE_KEY, m || "standard"); }
export async function loadVibMode() { return (await AsyncStorage.getItem(VIBMODE_KEY)) || "standard"; }

const AUTOTR_KEY = "lattice.pulse.autotranslate.v1";
export async function saveAutoTranslate(v) { await AsyncStorage.setItem(AUTOTR_KEY, v ? "1" : "0"); }
export async function loadAutoTranslate() { return (await AsyncStorage.getItem(AUTOTR_KEY)) === "1"; }

// Lingua di destinazione della traduzione (null = automatico: lingua dell'app).
const TRTGT_KEY = "lattice.pulse.translatetarget.v1";
export async function saveTranslateTarget(code) { await AsyncStorage.setItem(TRTGT_KEY, code || ""); }
export async function loadTranslateTarget() { const s = await AsyncStorage.getItem(TRTGT_KEY); return s ? s : null; }

// Registro chiamate SOLO LOCALE (privacy: il server non conserva nulla sulle chiamate).
const CALLLOG_KEY = "lattice.pulse.calllog.v1";
export async function addCallLog(entry) {
  try {
    const raw = await AsyncStorage.getItem(CALLLOG_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    arr.unshift(entry);
    await AsyncStorage.setItem(CALLLOG_KEY, JSON.stringify(arr.slice(0, 200)));
  } catch {}
}
export async function loadCallLog() {
  try { const raw = await AsyncStorage.getItem(CALLLOG_KEY); return raw ? JSON.parse(raw) : []; } catch { return []; }
}
export async function clearCallLog() { try { await AsyncStorage.removeItem(CALLLOG_KEY); } catch {} }

// Contatore chiamate perse non ancora viste (badge rosso sull'icona chiamate).
const CALLSEEN_KEY = "lattice.pulse.callseen.v1";
export async function markCallLogSeen() { try { await AsyncStorage.setItem(CALLSEEN_KEY, new Date().toISOString()); } catch {} }
export async function missedCallCount() {
  try {
    const raw = await AsyncStorage.getItem(CALLLOG_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    const seen = (await AsyncStorage.getItem(CALLSEEN_KEY)) || "";
    return arr.filter((i) => i && i.missed && (!seen || String(i.created_at || "") > seen)).length;
  } catch { return 0; }
}

// SAS verificato per contatto (Verifica Chiamata Sicura persistente).
export async function saveVerifiedSas(peer, sas) { try { await AsyncStorage.setItem("sasv:" + peer, sas); } catch {} }
export async function loadVerifiedSas(peer) { try { return (await AsyncStorage.getItem("sasv:" + peer)) || null; } catch { return null; } }

// Chiamate: connessione diretta consentita? Spenta per scelta (l'IP resta nascosto).
const CALL_DIRECT_KEY = "lat.call.direct";
export async function loadAllowDirect() {
  return (await AsyncStorage.getItem(CALL_DIRECT_KEY)) === "1";
}
export async function saveAllowDirect(v) {
  await AsyncStorage.setItem(CALL_DIRECT_KEY, v ? "1" : "0");
}

export const CONSENT_VERSION = "1";
const CONSENT_KEY = "lattice.pulse.consent.v1";
const CONSENT_SYNC_KEY = "lattice.pulse.consent.synced.v1";
export async function saveConsent() {
  await AsyncStorage.setItem(CONSENT_KEY, JSON.stringify({ version: CONSENT_VERSION, at: new Date().toISOString() }));
}
export async function loadConsent() {
  try { const s = await AsyncStorage.getItem(CONSENT_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}
export async function saveConsentSynced(version) { await AsyncStorage.setItem(CONSENT_SYNC_KEY, version); }
export async function loadConsentSynced() { return (await AsyncStorage.getItem(CONSENT_SYNC_KEY)) || null; }

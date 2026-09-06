// PERMESSI DELLA RADIO (Fase 2 della mesh) — chiesti solo quando servono, spiegati in chiaro.
// Wi-Fi Direct e Bluetooth LE su Android richiedono "Dispositivi nelle vicinanze" e, su
// Android 12 e precedenti, la Posizione: è un'imposizione del sistema operativo, non nostra
// (l'app non legge e non manda da nessuna parte la tua posizione).
import { NativeModules, PermissionsAndroid, Platform } from "react-native";

const P = PermissionsAndroid.PERMISSIONS || {};

export function needed() {
  if (Platform.OS !== "android") return [];
  const v = Number(Platform.Version) || 0;
  const out = [];
  if (v >= 33) out.push(P.NEARBY_WIFI_DEVICES || "android.permission.NEARBY_WIFI_DEVICES");
  else out.push(P.ACCESS_FINE_LOCATION || "android.permission.ACCESS_FINE_LOCATION");
  if (v >= 31) {
    out.push(P.BLUETOOTH_ADVERTISE || "android.permission.BLUETOOTH_ADVERTISE");
    out.push(P.BLUETOOTH_SCAN || "android.permission.BLUETOOTH_SCAN");
  }
  return out;
}

/// Vero se abbiamo TUTTI i permessi della radio.
export async function has() {
  if (Platform.OS !== "android") return false;
  try {
    for (const p of needed()) if (!(await PermissionsAndroid.check(p))) return false;
    return true;
  } catch { return false; }
}

/// Chiede i permessi. Ritorna { ok, missing }.
export async function request() {
  if (Platform.OS !== "android") return { ok: false, missing: [] };
  const list = needed();
  try {
    const r = await PermissionsAndroid.requestMultiple(list);
    const missing = list.filter((p) => r[p] !== "granted");
    // Il motore rilegge i permessi solo alla partenza: si riavvia per farli valere.
    if (!missing.length) {
      try {
        const C = NativeModules.MeshControl;
        if (C) { await C.stop(); await C.start(); }
      } catch { /* il motore riparte al rientro nell'app */ }
    }
    return { ok: !missing.length, missing };
  } catch { return { ok: false, missing: list }; }
}

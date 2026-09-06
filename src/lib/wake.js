// SVEGLIA SENZA GOOGLE (lato app).
// Scrive la configurazione in files/wake.json: il servizio nativo (WakeService.kt) la legge
// e tiene aperta una connessione in attesa verso il nostro server. Il gettone (rid) è
// casuale e non contiene la tua identità; il servizio non ha bisogno della chiave privata.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { randomHex } from "./crypto";
import { loadServer } from "./store";
import { DEFAULT_SERVER } from "../config";
import * as api from "./api";

const FILE = FileSystem.documentDirectory + "wake.json";
const RID_KEY = "lat.wake.rid";
const ON_KEY = "lat.wake.on";

export async function isOn() {
  return (await AsyncStorage.getItem(ON_KEY)) === "1";
}

async function writeConfig(on, rid) {
  const base = String((await loadServer()) || DEFAULT_SERVER).replace(/\/+$/, "");
  // Il rumore in background (letto dal WakeService nativo) è acceso di default.
  const chaff = (await AsyncStorage.getItem("lat.chaff.v1")) !== "0";
  await FileSystem.writeAsStringAsync(FILE, JSON.stringify({ on: !!on, rid: rid || "", base, chaff }));
}

/// Riscrive il file di config quando l'utente cambia l'interruttore del rumore, così il
/// servizio nativo vede subito il nuovo stato (mantiene lo stato della sveglia).
export async function applyChaff() {
  const on = (await AsyncStorage.getItem(ON_KEY)) === "1";
  const rid = (await AsyncStorage.getItem(RID_KEY)) || "";
  await writeConfig(on, rid);
}

export async function enable() {
  let rid = await AsyncStorage.getItem(RID_KEY);
  if (!rid || rid.length < 32) {
    rid = randomHex(24); // 48 caratteri esadecimali
    await AsyncStorage.setItem(RID_KEY, rid);
  }
  await api.wakeRegister(rid);
  await writeConfig(true, rid);
  await AsyncStorage.setItem(ON_KEY, "1");
  return rid;
}

export async function disable() {
  const rid = await AsyncStorage.getItem(RID_KEY);
  await AsyncStorage.setItem(ON_KEY, "0");
  await writeConfig(false, rid);
  if (rid) { try { await api.wakeRevoke(rid); } catch { /* il gettone scade da solo */ } }
}

/// All'avvio dell'app: se la sveglia è attiva riallinea server e file di configurazione
/// (per esempio dopo un cambio di server o un ripristino da backup).
export async function refresh() {
  if (!(await isOn())) return false;
  const rid = await AsyncStorage.getItem(RID_KEY);
  if (!rid) return false;
  try { await api.wakeRegister(rid); } catch { /* riprova al prossimo avvio */ }
  await writeConfig(true, rid);
  return true;
}

// CANARINO, lato app.
//
// Lo stato è un file statico firmato dal server: l'app lo legge e lo mostra. Due parole sul
// perché è statico e non un endpoint: un endpoint che dice "tutto bene" è esattamente ciò
// che un server compromesso continuerebbe a dire. Qui l'app verifica la DATA e la presenza
// della firma: se il canarino non viene rifirmato, l'app lo dice da sola, senza che il
// server debba collaborare.
//
// Gli avvisi (3 giorni, 1 giorno) sono SOLO per l'owner: sono manutenzione, non una notizia.
// Gli utenti comuni vedono lo stato, e basta.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { DEFAULT_SERVER, OWNER_LNS_LIST } from "../config";

const URL = "/downloads/canary-status.json";
const K_LAST = "lat.canary.avvisato";

export function isOwner(user) {
  const me = (user && user.lns ? String(user.lns) : "").toLowerCase();
  if (!me) return false;
  return OWNER_LNS_LIST.some((o) => String(o).toLowerCase() === me);
}

// ── Modo della striscia in cima alle conversazioni ──
// "auto"   = compare da sola secondo la scala (14/10/7/5/3/2/1/0 giorni) o in allarme.
// "always" = sempre visibile, anche con la scadenza lontana.
// La scelta e' dell'owner e si cambia toccando la striscia: nessuna costante da
// ricompilare, come era in v2.3.3 (`FORZA_OWNER`), che infatti nessuno poteva spegnere.
const K_MODE = "lat.canary.strip";
export const SOGLIA_GIORNI = 14;

export async function stripMode() {
  try { return (await AsyncStorage.getItem(K_MODE)) === "auto" ? "auto" : "always"; }
  catch { return "always"; }
}

export async function setStripMode(m) {
  const v = m === "auto" ? "auto" : "always";
  try { await AsyncStorage.setItem(K_MODE, v); } catch { /* niente */ }
  return v;
}

/// Va mostrata? Pura, cosi si prova senza schermo.
export function shouldShow(s, mode) {
  if (!s || s.state === "unknown") return false;
  if (s.state === "alarm") return true;
  if (mode === "always") return true;
  return s.daysLeft != null && s.daysLeft <= SOGLIA_GIORNI;
}

/// Stato del canarino. Se non si raggiunge il server si torna "unknown": mentire dicendo
/// "verificato" quando non si è verificato niente sarebbe il peggiore dei difetti.
export async function status() {
  try {
    const r = await fetch(DEFAULT_SERVER + URL, { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    const days = parseInt(j.days_left, 10);
    return {
      state: j.state === "ok" && j.sig_valid && days >= 0 ? "ok" : "alarm",
      sigValid: !!j.sig_valid,
      signedAt: j.signed_at || "",
      expiresAt: j.expires_at || "",
      daysLeft: isNaN(days) ? null : days,
      reason: j.reason || null,
    };
  } catch {
    return { state: "unknown", sigValid: false, signedAt: "", expiresAt: "", daysLeft: null, reason: null };
  }
}

/// Promemoria all'owner a 14, 10, 7, 5, 3, 2, 1 e 0 giorni dalla scadenza, e ogni giorno
/// in caso di allarme. Tre giorni di preavviso non bastano: rifirmare richiede di essere
/// davanti al server con la chiave, e questo non sempre capita entro tre giorni.
/// Una volta al giorno al massimo, così non diventa rumore e quindi non viene ignorato.
export async function remindOwner(user, it) {
  if (!isOwner(user)) return false;
  const s = await status();
  if (s.state === "unknown") return false;
  const SCALA = [14, 10, 7, 5, 3, 2, 1, 0];
  const urge = s.state === "alarm" || SCALA.indexOf(s.daysLeft) >= 0;
  if (!urge) return false;
  const oggi = new Date().toISOString().slice(0, 10);
  if ((await AsyncStorage.getItem(K_LAST)) === oggi + ":" + s.state + ":" + s.daysLeft) return false;
  const titolo = s.state === "alarm"
    ? (it ? "Canarino in ALLARME" : "Canary in ALARM")
    : (it ? "Il canarino scade" : "The canary is expiring");
  const corpo = s.state === "alarm"
    ? (it ? "Motivo: " + (s.reason || "sconosciuto") + ". Va rifirmato adesso." : "Reason: " + (s.reason || "unknown") + ". It must be re-signed now.")
    : (it ? "Restano " + s.daysLeft + " giorni. Rifirmalo prima della scadenza." : s.daysLeft + " days left. Re-sign it before it expires.");
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title: titolo, body: corpo, data: { canary: true } },
      trigger: null,
    });
    await AsyncStorage.setItem(K_LAST, oggi + ":" + s.state + ":" + s.daysLeft);
    return true;
  } catch { return false; }
}

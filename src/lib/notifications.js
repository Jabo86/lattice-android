import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { isGhost, GHOST_CHANNEL } from "./ghost";

// Foreground behaviour: show banner + list + sound even while the app is open.
// Impostato dopo l'avvio dell'app (non a tempo di importazione: una chiamata nativa
// eseguita mentre si carica il modulo può far morire l'app prima di poter reagire).
export function initNotificationHandler() {
  Notifications.setNotificationHandler({
    // NOTIFICHE FANTASMA: con l'opzione attiva l'app in primo piano non mostra nulla e
    // non suona. Resta solo il conteggio sull'icona: chi guarda lo schermo da lontano
    // non vede comparire niente.
    handleNotification: async () => {
      let ghost = false;
      try { ghost = await isGhost(); } catch (e) { /* comportamento normale */ }
      return {
        shouldPlaySound: !ghost,
        shouldSetBadge: true,
        shouldShowBanner: !ghost,
        shouldShowList: !ghost,
      };
    },
  });
}

// Normalizza un orario in {hour, minute} da numero, "HH:MM" o oggetto.
function normTime(t) {
  if (t == null) return null;
  if (typeof t === "number") return { hour: t, minute: 0 };
  if (typeof t === "string") { const [h, m] = t.split(":"); return { hour: parseInt(h, 10) || 0, minute: parseInt(m, 10) || 0 }; }
  if (typeof t === "object") return { hour: t.hour | 0, minute: t.minute | 0 };
  return null;
}

// Carica gli orari promemoria salvati (array di {hour, minute}). Migra il vecchio reminder_hour.
export async function loadReminderTimes() {
  try {
    const raw = await AsyncStorage.getItem("reminder_times");
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr.map(normTime).filter(Boolean);
    }
  } catch { /* */ }
  try {
    const h = parseInt(await AsyncStorage.getItem("reminder_hour"), 10);
    if (h >= 0 && h <= 23) return [{ hour: h, minute: 0 }];
  } catch { /* */ }
  return [{ hour: 19, minute: 0 }];
}

// Programma il promemoria quiz giornaliero.
// NB: da v1.0.76 il promemoria è un PUSH DAL SERVER (ULTRON) — affidabile anche con il
// risparmio batteria aggressivo (Samsung/Xiaomi ecc.) che uccideva le notifiche LOCALI.
// Salviamo gli orari + fuso orario sul server; lo scheduler backend invia la push.
// arg: undefined → carica gli orari salvati; array di orari; oppure un singolo numero (ora).
export async function scheduleDailyQuizReminder(arg) {
  try {
    let times;
    if (Array.isArray(arg)) times = arg.map(normTime).filter(Boolean);
    else if (typeof arg === "number") times = [{ hour: arg, minute: 0 }];
    else times = await loadReminderTimes();
    if (!times.length) times = [{ hour: 19, minute: 0 }];
    // Assicura il canale Android (serve alla push ULTRON su channel "reminders").
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("reminders", {
        name: "Promemoria",
        importance: Notifications.AndroidImportance.HIGH,
        sound: "default",
      });
    }
    // Pulisci eventuali promemoria LOCALI residui delle vecchie versioni (evita doppioni).
    try {
      const sched = await Notifications.getAllScheduledNotificationsAsync();
      for (const s of sched) {
        if (s?.content?.data?.kind === "daily_quiz") await Notifications.cancelScheduledNotificationAsync(s.identifier);
      }
    } catch { /* */ }
    // Sincronizza col server: -getTimezoneOffset() = minuti da AGGIUNGERE a UTC per il locale.
    const tzOffsetMin = -new Date().getTimezoneOffset();
    await api.saveQuizReminder(times, tzOffsetMin);
  } catch { /* opzionale */ }
}

export async function cancelDailyQuizReminder() {
  try {
    const sched = await Notifications.getAllScheduledNotificationsAsync();
    for (const s of sched) {
      if (s?.content?.data?.kind === "daily_quiz") await Notifications.cancelScheduledNotificationAsync(s.identifier);
    }
  } catch { /* */ }
  try { await api.disableQuizReminder(); } catch { /* */ }
}

// Solo notifiche locali e servizio ULTRON WakeService: nessun token ULTRON.
export async function registerForPush() {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("messages", {
      name: "Messaggi ULTRON", importance: Notifications.AndroidImportance.MAX,
      sound: "default", vibrationPattern: [0, 250, 250, 250],
      enableVibrate: true, showBadge: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
    await Notifications.setNotificationChannelAsync(GHOST_CHANNEL, {
      name: "Silenzioso", importance: Notifications.AndroidImportance.MIN,
      sound: null, enableVibrate: false, showBadge: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.SECRET,
    });
    await Notifications.setNotificationChannelAsync("calls", {
      name: "Chiamate", importance: Notifications.AndroidImportance.MAX,
      sound: "default", enableVibrate: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
  }
  const { status: existing } = await Notifications.getPermissionsAsync();
  const status = existing === "granted" ? existing :
    (await Notifications.requestPermissionsAsync()).status;
  // Il gettone di sveglia viene generato e registrato dal modulo wake.js.
  return status === "granted";
}

// Notifiche ULTRON: niente FCM, Firebase o Expo Push.
// Le notifiche remote sono intercettate da WakeService.kt direttamente via HTTPS.
// react-native-notify-kit fornisce soltanto i canali locali di Android.
import { Platform, PermissionsAndroid } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import notifee, { AndroidImportance } from "react-native-notify-kit";
import * as api from "./api";
import { GHOST_CHANNEL } from "./ghost";

export function initNotificationHandler() {
  // La notifica viene generata dal servizio Android locale dopo long-poll ULTRON.
}
function normTime(t) {
  if (t == null) return null;
  if (typeof t === "number") return { hour: t, minute: 0 };
  if (typeof t === "string") { const [h,m]=t.split(":"); return { hour: parseInt(h,10)||0, minute: parseInt(m,10)||0 }; }
  if (typeof t === "object") return { hour: t.hour|0, minute: t.minute|0 };
  return null;
}
export async function loadReminderTimes() {
  try {
    const raw = await AsyncStorage.getItem("reminder_times");
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr.map(normTime).filter(Boolean);
    }
  } catch (_) {}
  try {
    const h = parseInt(await AsyncStorage.getItem("reminder_hour"),10);
    if (h>=0 && h<=23) return [{hour:h,minute:0}];
  } catch (_) {}
  return [{hour:19,minute:0}];
}
export async function scheduleDailyQuizReminder(arg) {
  try {
    let times = Array.isArray(arg) ? arg.map(normTime).filter(Boolean)
      : typeof arg === "number" ? [{hour:arg,minute:0}] : await loadReminderTimes();
    if (!times.length) times = [{hour:19,minute:0}];
    await notifee.createChannel({id:"reminders",name:"Promemoria",importance:AndroidImportance.HIGH});
    await api.saveQuizReminder(times, -new Date().getTimezoneOffset());
  } catch (_) {}
}
export async function cancelDailyQuizReminder() {
  try { await api.disableQuizReminder(); } catch (_) {}
}
export async function registerForPush() {
  if (Platform.OS !== "android") return false;
  await notifee.createChannel({id:"messages",name:"Messaggi ULTRON",importance:AndroidImportance.HIGH});
  await notifee.createChannel({id:GHOST_CHANNEL,name:"Silenzioso",importance:AndroidImportance.MIN});
  await notifee.createChannel({id:"calls",name:"Chiamate",importance:AndroidImportance.HIGH});
  const apiLevel = Number(Platform.Version);
  if (apiLevel < 33) return true;
  const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS || "android.permission.POST_NOTIFICATIONS";
  const granted = await PermissionsAndroid.check(permission);
  if (granted) return true;
  return (await PermissionsAndroid.request(permission)) === PermissionsAndroid.RESULTS.GRANTED;
}

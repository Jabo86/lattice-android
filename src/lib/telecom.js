// CHIAMATE SOVRANE, lato JS — v2.5.0
//
// Involucro sul modulo nativo `LatticeCallControl` (ConnectionService autogestita).
// Ogni funzione qui non lancia MAI: se il telecom non c'e' (Android < 8, permesso negato,
// produttore che lo ha mutilato) si torna `false` e la chiamata prosegue come prima.
// La priorita di sistema e' un guadagno, non un requisito.
import { NativeModules, NativeEventEmitter, PermissionsAndroid, Platform } from "react-native";

const N = NativeModules.LatticeCallControl || null;
export const AVAILABLE = !!N;

let emitter = null;
function em() {
  if (!emitter && N) emitter = new NativeEventEmitter(N);
  return emitter;
}

const call = async (fn, ...args) => {
  if (!N || typeof N[fn] !== "function") return false;
  try { return await N[fn](...args); } catch { return false; }
};

/// Permesso MANAGE_OWN_CALLS. Si chiede alla prima chiamata, non all'avvio: chiedere
/// permessi a freddo e' il modo piu rapido per farseli negare.
export async function ensurePermission() {
  if (Platform.OS !== "android" || !N) return false;
  try {
    const p = "android.permission.MANAGE_OWN_CALLS";
    if (await PermissionsAndroid.check(p)) return true;
    const r = await PermissionsAndroid.request(p);
    return r === PermissionsAndroid.RESULTS.GRANTED;
  } catch { return false; }
}

export const available = () => call("available");
export const register = () => call("register");
export const setActive = () => call("setActive");
export const end = () => call("end");
export const state = async () => {
  if (!N) return "none";
  try { return await N.state(); } catch { return "none"; }
};

/// Dichiara la chiamata al sistema PRIMA di aprire il microfono.
export async function declare(direction, label) {
  if (!N) return false;
  if (!(await ensurePermission())) return false;
  await call("register");
  return direction === "in" ? call("reportIncoming", String(label || "")) : call("startOutgoing", String(label || ""));
}

/// Eventi del telecom: answer · reject · hold · unhold · end · muted · unmuted.
/// `hold` e' quello che conta: e' il sistema che dice "e' arrivata un'altra chiamata".
export function onAction(fn) {
  const e = em();
  if (!e) return () => {};
  const sub = e.addListener("LatticeCallAction", (ev) => {
    try { fn((ev && ev.action) || "", (ev && ev.detail) || ""); } catch { /* niente */ }
  });
  return () => { try { sub.remove(); } catch { /* niente */ } };
}

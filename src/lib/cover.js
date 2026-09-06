// TRAFFICO DI RUMORE (chaffing) — la seconda metà del "protocollo invisibile".
//
// Il padding (pad.js) nasconde QUANTO è grande ogni pacchetto. Questo modulo nasconde
// QUANDO agisci: se il telefono parlasse col server solo mentre scrivi o chiami, chi osserva
// la rete capirebbe i momenti esatti in cui comunichi, anche senza leggere nulla. Qui l'app
// invia richieste finte (`api.coverPing`, cioè un innocuo /api/health con lo stesso padding
// delle richieste vere) a intervalli CASUALI e continui finché l'app è in primo piano. Un
// messaggio vero si perde in mezzo a questo rumore: dall'esterno non si distingue un momento
// di silenzio da un momento di conversazione.
//
// Distribuzione esponenziale (processo di Poisson): gli intervalli sono davvero casuali, non
// a cadenza fissa — una cadenza fissa sarebbe a sua volta un'impronta riconoscibile.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import * as api from "./api";

const KEY = "lat.chaff.v1";
const MEAN = 17000; // intervallo medio ~17 s
const MIN = 6000;
const MAX = 60000;

let enabled = true;
let loaded = false;
let running = false;
let timer = null;

/// Prossimo intervallo casuale (esponenziale, limitato tra MIN e MAX). Puro: testabile.
export function nextDelay(rand = Math.random) {
  const u = Math.min(0.999999, Math.max(1e-6, rand()));
  const d = -MEAN * Math.log(1 - u);
  return Math.round(Math.min(MAX, Math.max(MIN, d)));
}

export async function isEnabled() {
  if (!loaded) {
    try { const v = await AsyncStorage.getItem(KEY); enabled = v == null ? true : v === "1"; } catch { /* default acceso */ }
    loaded = true;
  }
  return enabled;
}

export async function setEnabled(v) {
  enabled = !!v; loaded = true;
  try { await AsyncStorage.setItem(KEY, enabled ? "1" : "0"); } catch { /* niente */ }
  // Sincronizza il servizio nativo (rumore in background, anche a schermo spento).
  try { await require("./wake").applyChaff(); } catch { /* il servizio si riallinea al prossimo avvio */ }
  if (enabled) start(); else stop();
  return enabled;
}

// v2.5.0 — IL RUMORE NON GIRA PIU SUL THREAD DELL'INTERFACCIA.
// Prima questo modulo teneva un timer in JS e, a ogni scatto, faceva partire una fetch
// dal thread che disegna lo schermo: una richiesta ogni ~17 s non e' molta, ma cadeva a
// caso, quindi ogni tanto atterrava proprio mentre stavi scorrendo una lista — ed e' cosi
// che nasce un fotogramma perso senza una causa apparente.
// Adesso il rumore lo produce il servizio nativo (`WakeService`, thread `chaffLoop`
// dedicato, processo separato): continua anche a schermo spento e non tocca l'interfaccia.
// Il timer JS resta solo se il servizio nativo non c'e' (`opts.ping` nei test).
let nativeOnly = true;

/// Solo per i test: rimette il timer in JS.
export function useJsTimer(v) { nativeOnly = !v; }

function tick(ping) {
  if (!running) return;
  if (enabled && AppState.currentState === "active") {
    try { const p = (ping || api.coverPing)(); if (p && p.catch) p.catch(() => {}); } catch { /* silenzioso */ }
  }
  timer = setTimeout(() => tick(ping), nextDelay());
}

export async function start(opts = {}) {
  await isEnabled();
  if (!enabled || running) return;
  running = true;
  // Il servizio nativo si allinea da se leggendo `wake.json` (`applyChaff`).
  if (nativeOnly && !opts.ping) {
    try { await require("./wake").applyChaff(); } catch { /* si riallinea al prossimo avvio */ }
    return;
  }
  timer = setTimeout(() => tick(opts.ping), nextDelay());
}

export function stop() {
  running = false;
  if (timer) { clearTimeout(timer); timer = null; }
}

export function status() { return { running, enabled }; }

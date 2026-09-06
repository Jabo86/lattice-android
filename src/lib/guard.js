// AZZERAMENTO REATTIVO DELLA MEMORIA (v1.5.0) — "strappo di mano"
//
// Scenario: qualcuno ti strappa il telefono dalle mani mentre la chat è aperta e sbloccata.
// Da quel momento ha davanti i messaggi in chiaro, la chiave d'identità caricata in
// memoria e la cache delle foto decifrate.
//
// Con questa protezione attiva, l'accelerometro riconosce lo strappo (un picco di forza
// molto più violento di qualsiasi movimento normale) e in quello stesso istante:
//   · la chiave derivata dal PIN viene rimossa dalla memoria (`lockMemory`);
//   · le foto e i documenti già decifrati vengono cancellati (`clearPlainCache`);
//   · l'app torna alla schermata di blocco: chi ha il telefono in mano vede solo il PIN.
//
// Scelte di prudenza:
//   · spento per impostazione predefinita (un falso allarme costa uno sblocco);
//   · `expo-sensors` viene caricato con `require` DENTRO la funzione: se il modulo non
//     è disponibile su quel telefono l'app continua a funzionare come prima (regola del
//     progetto dopo il crash della 1.2.8: nessun modulo nativo sul percorso di avvio);
//   · serve una raffica di CONSEC letture oltre la soglia: un urto secco della scrivania
//     o il telefono che cade in tasca non basta.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { lockMemory } from "./lock";

const KEY_ON = "lat.guard.on";
const KEY_SENS = "lat.guard.sens"; // "bassa" | "media" | "alta"
const CONSEC = 2;                  // letture consecutive oltre soglia
const INTERVAL_MS = 60;

// Soglie in g (1 g = telefono fermo). Più bassa = più sensibile.
const THRESHOLD = { bassa: 3.4, media: 2.8, alta: 2.2 };

let sub = null;
let handler = null;
let hits = 0;
let lastFire = 0;

export async function isOn() {
  try { return (await AsyncStorage.getItem(KEY_ON)) === "1"; } catch { return false; }
}
export async function sensitivity() {
  try { return (await AsyncStorage.getItem(KEY_SENS)) || "media"; } catch { return "media"; }
}
export async function setSensitivity(s) {
  const v = THRESHOLD[s] ? s : "media";
  try { await AsyncStorage.setItem(KEY_SENS, v); } catch { /* */ }
  if (sub) await start(handler); // riapplica subito la nuova soglia
  return v;
}
export async function setOn(on) {
  try { await AsyncStorage.setItem(KEY_ON, on ? "1" : "0"); } catch { /* */ }
  if (on) await start(handler); else stop();
  return !!on;
}

// Soglia corrispondente a una sensibilità (esportata per i test).
export function thresholdFor(s) { return THRESHOLD[s] || THRESHOLD.media; }

// Decide se una lettura dell'accelerometro è uno "strappo". Funzione pura: è questa che
// i test verificano, senza bisogno di un telefono.
export function isSnatch({ x = 0, y = 0, z = 0 }, thr) {
  const g = Math.sqrt(x * x + y * y + z * z);
  return g >= thr;
}

export async function start(onSnatch) {
  handler = onSnatch || handler;
  stop();
  if (!(await isOn())) return false;
  let Accelerometer;
  try {
    Accelerometer = require("expo-sensors").Accelerometer;
    if (!Accelerometer) return false;
    if (Accelerometer.isAvailableAsync && !(await Accelerometer.isAvailableAsync())) return false;
  } catch (e) {
    return false; // sensore assente: la protezione resta semplicemente inattiva
  }
  const thr = thresholdFor(await sensitivity());
  try {
    Accelerometer.setUpdateInterval(INTERVAL_MS);
    hits = 0;
    sub = Accelerometer.addListener((d) => {
      if (isSnatch(d, thr)) {
        hits++;
        if (hits >= CONSEC) { hits = 0; fire(); }
      } else if (hits > 0) {
        hits = 0;
      }
    });
    return true;
  } catch (e) { return false; }
}

export function stop() {
  try { if (sub) sub.remove(); } catch { /* */ }
  sub = null;
  hits = 0;
}

// Azzeramento + blocco. Protetto da un intervallo minimo: durante uno strappo arrivano
// decine di letture e non serve rifare tutto ogni 60 ms.
function fire() {
  const now = Date.now();
  if (now - lastFire < 4000) return;
  lastFire = now;
  try { lockMemory(); } catch (e) { /* */ }
  try { if (handler) handler(); } catch (e) { /* */ }
}

// Solo per i test: chiama l'allarme come se il sensore avesse rilevato lo strappo.
// NON azzera `lastFire`, altrimenti la protezione anti-raffica non sarebbe verificabile.
export function __fireForTest() { fire(); }

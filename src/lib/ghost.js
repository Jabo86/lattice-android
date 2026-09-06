// NOTIFICHE FANTASMA (v1.5.0)
//
// Problema: anche con il testo generico ("Hai un nuovo messaggio", già senza il nome di
// chi scrive), la notifica COMPARE in tendina e sulla schermata di blocco. Chi ti guarda
// il telefono vede che Lattice ha ricevuto qualcosa, e quando.
//
// Con le notifiche fantasma attive:
//   · in primo piano l'app non mostra NULLA (nessun banner, nessun suono): solo il
//     pallino di conteggio sull'icona;
//   · le push del server arrivano sul canale Android "ghost", creato con importanza
//     MINIMA e visibilità SECRET: niente suono, niente vibrazione, niente comparsa sulla
//     schermata di blocco. Resta solo una riga silenziosa in fondo alla tendina.
//   · il titolo e il testo diventano neutri ("Lattice" · "•"): nessun indizio del
//     contenuto, del mittente o del tipo di evento (messaggio, chiamata, contatto).
// Il server sceglie il canale in base al contrassegno registrato con il token di questo
// dispositivo (vedi fcm.rs): la scelta è per-dispositivo, non per-account.
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "lat.ghost.on";
export const GHOST_CHANNEL = "ghost";
let cached = null; // niente letture ripetute da AsyncStorage nel gestore delle notifiche

export async function isGhost() {
  if (cached !== null) return cached;
  try { cached = (await AsyncStorage.getItem(KEY)) === "1"; } catch { cached = false; }
  return cached;
}

// Valore già in memoria (per i percorsi sincroni, come il gestore di primo piano).
export function ghostNow() { return cached === true; }

export async function setGhost(on) {
  cached = !!on;
  try { await AsyncStorage.setItem(KEY, on ? "1" : "0"); } catch { /* */ }
  return cached;
}

// Da chiamare all'avvio: popola la cache prima che arrivi la prima notifica.
export async function loadGhost() { return isGhost(); }

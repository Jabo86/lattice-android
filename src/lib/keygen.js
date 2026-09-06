// GENERAZIONE DELLE CHIAVI D'AGGANCIO — rotazione senza cambio d'identità.
//
// Un solo contatore per entrambe le chiavi d'aggancio (curva e ML-KEM-1024): ruotano insieme,
// così chi riceve deve provare quattro possibilità e non sedici. La generazione 0 è quello che
// c'era prima, e chi non ruota resta lì per sempre senza accorgersi di niente.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { handshakeDhKeypair, handshakeKem1024Keypair, bytesToHex } from "./crypto";
import * as api from "./api";

const K_GEN = "lat.hsgen";
const K_AT = "lat.hsgen.at";
/// Quante generazioni indietro si accetta un aggancio: copre la corsa fra chi ha già letto
/// la chiave nuova dal server e chi ha ancora in mano quella vecchia. A trenta giorni per
/// generazione, sei generazioni sono mezzo anno di tolleranza per chi è stato offline.
/// Costa al massimo sette tentativi di apertura, e solo sul PRIMO messaggio di una sessione.
export const BACK = 6;
/// Ricambio automatico: trenta giorni. Un anno è la misura di un'app qualunque; qui la
/// chiave d'aggancio è ciò che protegge la radice della conversazione, cioè il segreto più
/// longevo che esiste, e resta esposta sul tabellone pubblico per tutta la sua vita.
export const ROTATE_EVERY_MS = 30 * 24 * 3600 * 1000;
const MAX_AGE_MS = ROTATE_EVERY_MS;

export async function currentGen() {
  const v = await AsyncStorage.getItem(K_GEN);
  const n = parseInt(v || "0", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/// Le generazioni da provare in ricezione: la corrente, qualcuna indietro, e sempre la 0.
export async function candidateGens() {
  const g = await currentGen();
  const out = [];
  for (let i = g; i >= 0 && out.length < BACK + 1; i--) out.push(i);
  if (!out.includes(0)) out.push(0);
  return out;
}

/// Le chiavi d'aggancio di una generazione. Sono ricavate dal segreto d'identità, quindi
/// nessuna generazione va custodita: si rifà quando serve.
export function keysFor(skHex, gen) {
  const dh = handshakeDhKeypair(skHex, gen);
  const k5 = handshakeKem1024Keypair(skHex, gen);
  return { gen: gen | 0, dh, k5 };
}

/// Ruota. Le nuove pubbliche vanno sul tabellone; l'identità, il numero di sicurezza e i
/// codici d'incontro NON si toccano, perché restano sulla generazione 0.
export async function rotate(user) {
  if (!user || !user.sk) return null;
  const g = (await currentGen()) + 1;
  const k = keysFor(user.sk, g);
  await api.publishKey(
    bytesToHex(user.kem.publicKey),
    bytesToHex(user.dh.publicKey),              // identità: sempre generazione 0
    bytesToHex(k.k5.publicKey),
    bytesToHex(k.dh.publicKey),
  );
  await AsyncStorage.setItem(K_GEN, String(g));
  await AsyncStorage.setItem(K_AT, String(Date.now()));
  return g;
}

/// Ricambio automatico quando la generazione corrente ha più di un anno.
export async function rotateIfStale(user) {
  const at = parseInt((await AsyncStorage.getItem(K_AT)) || "0", 10);
  if (at && Date.now() - at < MAX_AGE_MS) return 0;
  if (!at) { await AsyncStorage.setItem(K_AT, String(Date.now())); return 0; }
  try { return (await rotate(user)) || 0; } catch { return 0; }
}

export async function status() {
  const at = parseInt((await AsyncStorage.getItem(K_AT)) || "0", 10);
  return { gen: await currentGen(), at, next: at ? at + ROTATE_EVERY_MS : 0, back: BACK };
}

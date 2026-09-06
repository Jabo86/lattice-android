// CHIAVE LEGATA AL CHIP — v2.5.2, lato JS.
//
// Il "pepe" e' 32 byte casuali sigillati dal chip di sicurezza. Entra nella derivazione
// della chiave dei dati:  chiaveFinale = SHA-512( pepe || derivazioneDelPin ).
// Fuori da QUESTO telefono il pepe e' un blocco cifrato la cui chiave sta in un processore
// separato e non e' esportabile: provare i PIN su un altro computer non porta a nulla,
// nemmeno indovinando il PIN giusto.
import { NativeModules } from "react-native";
import * as SecureStore from "expo-secure-store";

const N = NativeModules.LatticeHwKey || null;
export const DISPONIBILE = !!N;
const K_PEPE = "lat.pin.hw";

const ss = {
  get: (k) => SecureStore.getItemAsync(k).catch(() => null),
  set: (k, v) => SecureStore.setItemAsync(k, String(v)).catch(() => {}),
  del: (k) => SecureStore.deleteItemAsync(k).catch(() => {}),
};

/// Livello reale della protezione: "strongbox" | "tee" | "software" | "assente".
/// Va mostrato all'utente cosi com'e': su un telefono senza chip dedicato non si puo
/// scrivere "chip di sicurezza" e sperare che nessuno controlli.
export async function info() {
  if (!N) return { presente: false, livello: "assente" };
  try { return await N.info(); } catch { return { presente: false, livello: "assente" }; }
}

/// Crea il pepe se non c'e'. Torna false se il chip non collabora: in quel caso si resta
/// al metodo senza hardware invece di lasciare l'utente senza PIN.
export async function assicuraPepe(randomHex) {
  if (!N) return false;
  try {
    if (await ss.get(K_PEPE)) return true;
    const sigillato = await N.seal(randomHex(32));
    if (!sigillato) return false;
    await ss.set(K_PEPE, sigillato);
    // Controllo immediato: se non si riapre, il pepe non vale niente e va buttato subito,
    // non alla prossima apertura dell'app con i dati gia cifrati sopra.
    const prova = await N.open(sigillato);
    if (!prova) { await ss.del(K_PEPE); return false; }
    return true;
  } catch { try { await ss.del(K_PEPE); } catch { /* niente */ } return false; }
}

/// Legge il pepe passando dal chip. Lancia se il chip non c'e' piu: e' un caso da
/// dichiarare all'utente, MAI da nascondere cancellando i dati.
export async function pepe() {
  if (!N) throw new Error("Questo telefono non ha piu accesso al chip di sicurezza.");
  const sigillato = await ss.get(K_PEPE);
  if (!sigillato) throw new Error("Il sigillo hardware non e' presente su questo telefono.");
  const hex = await N.open(sigillato);
  if (!hex) throw new Error("Il chip di sicurezza ha rifiutato di aprire il sigillo.");
  return hex;
}

export async function distruggi() {
  try { await ss.del(K_PEPE); } catch { /* niente */ }
  if (!N) return false;
  try { return await N.destroy(); } catch { return false; }
}

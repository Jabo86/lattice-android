// BLOCCO C/SICUREZZA LOCALE — PIN dell'app, cifratura dei dati sul dispositivo,
// PIN di emergenza e autodistruzione totale.
//
// Come funziona:
// · Il PIN non viene salvato: si salva solo un verificatore (hash con sale casuale).
// · Dal PIN si deriva la chiave AES-256 che cifra sul telefono il file chiave, le chiavi
//   usa-e-getta e la cronologia locale: a telefono bloccato o spento quei dati sono
//   illeggibili anche estraendo la memoria dell'app.
// · Tre PIN sbagliati (avviso a schermo pieno al secondo) → distruzione totale.
// · PIN di emergenza: sblocca "normalmente" ma cancella tutto in silenzio.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { sha512 } from "@noble/hashes/sha2.js";
import * as kdf from "./kdf";
import * as hw from "./hwkey";
import { gcm } from "@noble/ciphers/aes.js";
import { bytesToHex, hexToBytes, randomHex } from "./crypto";
import { clearThumbCache } from "./thumb";

const K_SALT = "lat.pin.salt";
const K_VER = "lat.pin.ver";
const K_PANIC_VER = "lat.pin.panicver";
const K_PANIC_TOKEN = "lat.panic.token";
const K_TRIES = "lat.pin.tries";
// Chiave AES-256 del DISPOSITIVO, custodita dal Keystore Android tramite SecureStore.
// Serve a non lasciare NULLA in chiaro quando il PIN non è attivo: prima file chiave,
// chiavi usa-e-getta e stato del ratchet stavano in chiaro in AsyncStorage, leggibili da
// un telefono rootato o da un backup ADB. Con il PIN attivo vince il PIN (più forte: i
// dati restano illeggibili anche a app aperta finché non lo inserisci).
const K_DEV_KEY = "lat.dev.key";
const K_DEV_FB = "lat.dev.key.fb"; // ripiego se il Keystore non è disponibile
const KF_PLAIN = "lattice.pulse.keyfile.v1";
const ENC_PREFIX = "lat.enc.";
// Marcatore del metodo di derivazione. La sua presenza dice soltanto "questo telefono usa
// argon2id e nomi opachi": non dice quanti profili ci sono, ne che ne esista un secondo.
const K_KDF = "lat.pin.kdf";
// Suffisso del metodo quando la chiave e' legata al chip di sicurezza.
const SUFF_HW = "+hw";
// Nomi interni. Il primo byte 0x01 li tiene fuori da qualunque collisione con i nomi veri.
const N_PROBE = "\u0001p";
const N_INDEX = "\u0001i";
const PROBE_MAGIC = "L2V";
export const MAX_TRIES = 3;
export const PACKAGE_NAME = "com.latticenetwork.pulse";

let memKey = null; // chiave AES derivata dal PIN, solo in RAM
// Namespace del profilo attivo. Stringa vuota = installazioni vecchie, dove i blocchi
// hanno ancora il loro nome in chiaro. NON viene salvato da nessuna parte: si ricalcola
// dalla chiave del PIN ad ogni sblocco, ed e' questo che rende impossibile contare i
// profili guardando la memoria del telefono.
let memNs = "";

function cat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0); out.set(b, a.length);
  return out;
}

// ── Cache in memoria dei blob locali ──
// I dati sul disco restano cifrati esattamente come prima. Cambia solo che non si rilegge
// (e non si ri-decifra) lo stesso blob decine di volte di fila: il ratchet e le chiavi
// usa-e-getta lo facevano per OGNI messaggio, ed era la causa principale della lentezza.
const blobCache = new Map();
const blobPending = new Map();
let blobTimer = null;

function setMemKey(k, ns) {
  memKey = k;
  memNs = ns || "";
  blobCache.clear(); // dati di un'altra chiave: mai riusarli
  blobPending.clear();
}

/// Namespace di un profilo, derivato dalla chiave del PIN.
function nsOf(key) {
  return bytesToHex(sha512(cat(enc8("lattice-ns-v1:"), key))).slice(0, 16);
}

/// Nome con cui il blocco finisce davvero in memoria. Con un namespace attivo il nome
/// vero non compare: resta solo un hash che dipende dal PIN.
function blobKey(name) {
  if (!memNs) return ENC_PREFIX + name;
  return ENC_PREFIX + bytesToHex(sha512(enc8("lattice-blobname-v1:" + memNs + ":" + name))).slice(0, 32);
}


function enc8(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(out);
}
function dec8(bytes) {
  const codes = [];
  let i = 0;
  while (i < bytes.length) {
    const c = bytes[i++];
    if (c < 0x80) codes.push(c);
    else if (c < 0xe0) codes.push(((c & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else codes.push(((c & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
  }
  let s = "";
  for (let j = 0; j < codes.length; j += 8192) s += String.fromCharCode.apply(null, codes.slice(j, j + 8192));
  return s;
}
function derive(salt, pin, label) {
  return sha512(enc8(`lattice-${label}-v1:${salt}:${pin}`));
}
function verifierOf(salt, pin) {
  return bytesToHex(derive(salt, pin, "pinver")).slice(0, 64);
}
function keyOf(salt, pin) {
  return derive(salt, pin, "pinkey").slice(0, 32);
}

const ss = {
  get: (k) => SecureStore.getItemAsync(k).catch(() => null),
  set: (k, v) => SecureStore.setItemAsync(k, String(v)).catch(() => {}),
  del: (k) => SecureStore.deleteItemAsync(k).catch(() => {}),
};

let devKey = null;
/// Chiave del dispositivo: generata una volta e mai più mostrata. Se il Keystore non la
/// conserva (telefoni con SecureStore rotto) si usa un ripiego in AsyncStorage: meno
/// robusto, ma sempre meglio del testo in chiaro, e i dati restano leggibili all'utente.
export async function deviceKey() {
  if (devKey) return devKey;
  let hex = await ss.get(K_DEV_KEY);
  if (!hex || hex.length !== 64) {
    hex = randomHex(32);
    await ss.set(K_DEV_KEY, hex);
    const back = await ss.get(K_DEV_KEY);
    if (back !== hex) {
      const fb = await AsyncStorage.getItem(K_DEV_FB);
      if (fb && fb.length === 64) hex = fb;
      else await AsyncStorage.setItem(K_DEV_FB, hex);
    }
  }
  devKey = hexToBytes(hex);
  return devKey;
}

export async function hasPin() {
  return !!(await ss.get(K_VER));
}

// ── DERIVAZIONE DEL PIN ──
// `derivePin` e' l'unico posto che trasforma un PIN in una chiave. Restituisce anche il
// verificatore e il namespace, cosi chi la chiama non ricalcola niente: una sola passata
// di argon2id per tentativo (mezzo secondo circa), non una per profilo.
/// Metodo registrato su QUESTO telefono. "" = installazione vecchia (un solo sha512).
async function metodoAttivo() {
  const m = await ss.get(K_KDF);
  return m ? String(m) : "";
}

// Cache in RAM delle derivazioni. Non e' un'ottimizzazione elegante: e' la differenza fra
// un PIN che si salva e una rotella che gira per sempre. Salvare il PIN con l'esca fa piu
// di una verifica, e ogni verifica ripartiva da zero. Vive solo in memoria e muore con
// `lockMemory()`; la chiave include il metodo, quindi non puo restituire una chiave
// derivata con un metodo diverso da quello richiesto.
const derivCache = new Map();

/// Indice della cache. NON contiene il PIN: e' un hash di (metodo|sale|PIN). Serve a
/// ritrovare una voce, non a ricostruire cio' che l'utente ha digitato.
function cacheTag(met, salt, pin) {
  return bytesToHex(sha512(enc8("lattice-kcache-v1:" + met + ":" + salt + ":" + String(pin)))).slice(0, 32);
}

async function derivePin(pin, metodoForzato) {
  const salt = await ss.get(K_SALT);
  if (!salt) return null;
  const met = metodoForzato !== undefined ? metodoForzato : await metodoAttivo();
  const ck = cacheTag(met, salt, pin);
  if (derivCache.has(ck)) return derivCache.get(ck);
  const conHw = met.endsWith(SUFF_HW);
  const base = conHw ? met.slice(0, -SUFF_HW.length) : met;
  let key, ver;
  if (met) {
    key = await kdf.derive(base, pin, salt);
    if (conHw) {
      // Il pepe si ottiene SOLO passando dal chip. Se il chip non risponde si lancia:
      // e' un caso da dichiarare all'utente, mai da nascondere cancellando i dati.
      key = sha512(cat(hexToBytes(await hw.pepe()), key)).slice(0, 32);
    }
    ver = bytesToHex(sha512(cat(enc8("lattice-pinver-a2:"), key))).slice(0, 64);
  } else {
    key = keyOf(salt, pin);
    ver = verifierOf(salt, pin);
  }
  const out = { salt, key, ver, ns: nsOf(key), met, a2: !!met, hw: conHw };
  // Tetto basso: la cache serve a non pagare la derivazione dieci volte nello stesso
  // flusso, non a tenere chiavi in giro. Oltre quattro voci si butta la piu vecchia.
  if (derivCache.size >= 4) derivCache.delete(derivCache.keys().next().value);
  derivCache.set(ck, out);
  return out;
}

/// La sonda: un blocchetto che si apre SOLO con la chiave di quel profilo. E' il modo di
/// riconoscere un PIN senza salvarne il verificatore — e quindi senza lasciare la prova
/// che quel PIN esiste.
async function probeOpens(d) {
  try {
    const nsBefore = memNs, keyBefore = memKey;
    memNs = d.ns; memKey = d.key;
    const raw = await AsyncStorage.getItem(blobKey(N_PROBE));
    memNs = nsBefore; memKey = keyBefore;
    if (!raw) return false;
    const o = JSON.parse(raw);
    if (!o || !o.iv || !o.ct) return false;
    const v = JSON.parse(dec8(gcm(d.key, hexToBytes(o.iv)).decrypt(hexToBytes(o.ct))));
    return !!(v && v.m === PROBE_MAGIC);
  } catch { return false; }
}

async function writeProbe(key, ns) {
  const nsBefore = memNs, keyBefore = memKey;
  memNs = ns; memKey = key;
  try { await writeBlob(N_PROBE, { m: PROBE_MAGIC, v: 2 }); }
  finally { memNs = nsBefore; memKey = keyBefore; }
}
export async function isUnlocked() {
  return !!memKey || !(await hasPin());
}
export async function tries() {
  const n = parseInt((await ss.get(K_TRIES)) || "0", 10);
  return isNaN(n) ? 0 : n;
}
export async function triesLeft() {
  return Math.max(0, MAX_TRIES - (await tries()));
}

// ── Cifratura dei blob locali (file chiave, chiavi usa-e-getta, cronologia) ──
// Niente resta più in chiaro: col PIN attivo si usa la chiave derivata dal PIN, altrimenti
// la chiave del dispositivo custodita dal Keystore Android.
async function writeBlob(name, value) {
  const json = JSON.stringify(value);
  const withPin = !!memKey;
  const key = memKey || (await deviceKey());
  const iv = hexToBytes(randomHex(12));
  const ct = gcm(key, iv).encrypt(enc8(json));
  await AsyncStorage.setItem(blobKey(name), JSON.stringify({ k: withPin ? "pin" : "dev", iv: bytesToHex(iv), ct: bytesToHex(ct) }));
}

export async function setBlob(name, value) {
  blobCache.set(name, value);
  blobPending.delete(name);
  await writeBlob(name, value);
  await noteName(name);
}

/// Con i nomi opachi non si possono piu elencare i blocchi leggendo le chiavi di
/// AsyncStorage: l'elenco vive dentro un blocco cifrato come tutti gli altri.
async function noteName(name) {
  if (!memNs || name === N_INDEX || name === N_PROBE) return;
  try {
    const idx = (await getBlob(N_INDEX)) || [];
    if (idx.indexOf(name) >= 0) return;
    idx.push(name);
    blobCache.set(N_INDEX, idx);
    await writeBlob(N_INDEX, idx);
  } catch { /* l'elenco si ricostruisce alla prossima scrittura */ }
}

/// Salvataggio accorpato (entro 250 ms, o subito quando l'app passa in secondo piano):
/// il ratchet salva lo stato a ogni messaggio e cifrare+scrivere l'intero blob 50 volte
/// di fila bloccava l'interfaccia. Il dato in memoria è già aggiornato.
export function setBlobSoon(name, value) {
  blobCache.set(name, value);
  blobPending.set(name, value);
  noteName(name).catch(() => {});
  if (blobTimer) return;
  blobTimer = setTimeout(() => { blobTimer = null; flushBlobs(); }, 250);
}

export async function flushBlobs() {
  if (blobTimer) { clearTimeout(blobTimer); blobTimer = null; }
  const items = Array.from(blobPending.entries());
  blobPending.clear();
  for (const it of items) {
    try { await writeBlob(it[0], it[1]); } catch { blobPending.set(it[0], it[1]); }
  }
}

export async function getBlob(name) {
  if (blobCache.has(name)) return blobCache.get(name);
  const raw = await AsyncStorage.getItem(blobKey(name));
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    let v;
    let legacyPlain = false;
    if (o.p !== undefined) {
      // Vecchio formato in chiaro (installazioni prima della chiave di dispositivo):
      // si legge e si ricifra subito.
      v = JSON.parse(o.p);
      legacyPlain = true;
    } else if (o.k === "dev") {
      v = JSON.parse(dec8(gcm(await deviceKey(), hexToBytes(o.iv)).decrypt(hexToBytes(o.ct))));
    } else if (!memKey) {
      return null; // cifrato col PIN e il PIN non è ancora stato inserito
    } else {
      v = JSON.parse(dec8(gcm(memKey, hexToBytes(o.iv)).decrypt(hexToBytes(o.ct))));
    }
    blobCache.set(name, v);
    if (legacyPlain) writeBlob(name, v).catch(() => {});
    return v;
  } catch {
    return null;
  }
}

/// Rilegge tutti i blob con le chiavi attuali (serve prima di cambiare chiave).
async function readAllBlobs() {
  let names;
  if (memNs) {
    names = (await getBlob(N_INDEX)) || [];
  } else {
    names = (await AsyncStorage.getAllKeys())
      .filter((k) => k.startsWith(ENC_PREFIX))
      .map((k) => k.slice(ENC_PREFIX.length));
  }
  const out = [];
  for (const name of names) {
    if (name === N_INDEX || name === N_PROBE) continue;
    const v = await getBlob(name);
    if (v !== null && v !== undefined) out.push([name, v]);
  }
  return out;
}

export async function removeBlob(name) {
  blobCache.delete(name);
  blobPending.delete(name);
  await AsyncStorage.removeItem(blobKey(name));
}

// ── Impostazione / modifica del PIN ──
export async function setupPin(pin, panicPin, armFn) {
  if (!/^\d{4,10}$/.test(String(pin || ""))) throw new Error("Il PIN deve avere da 4 a 10 cifre.");
  if (panicPin && panicPin === pin) throw new Error("Il PIN di emergenza deve essere diverso dal PIN normale.");
  if (panicPin && !/^\d{4,10}$/.test(String(panicPin))) throw new Error("Il PIN di emergenza deve avere da 4 a 10 cifre.");
  const salt = randomHex(16);
  // I blob esistenti sono cifrati con la chiave del dispositivo: si rileggono PRIMA di
  // cambiare chiave e si riscrivono dopo, altrimenti chiavi usa-e-getta e stato del
  // ratchet diventerebbero illeggibili (messaggi non decifrabili).
  const snapshot = await readAllBlobs();
  await ss.set(K_SALT, salt);
  // Dalla v2.5.0 un PIN nuovo nasce con argon2id e con i nomi opachi: cosi il doppio
  // fondo e' possibile senza migrazioni, e un PIN corto costa comunque caro da provare.
  derivCache.clear(); // il sale e' cambiato: qualunque derivazione in cache non vale piu
  const migliore = await metodoMigliore();
  await ss.set(K_KDF, migliore);
  const dNew = await derivePin(pin, migliore);
  await ss.set(K_VER, dNew.ver);
  if (panicPin) {
    const dp = await derivePin(panicPin, migliore);
    await ss.set(K_PANIC_VER, dp.ver);
  } else await ss.del(K_PANIC_VER);
  await ss.set(K_TRIES, "0");
  setMemKey(dNew.key, dNew.ns);
  const nomi = [];
  for (const [n, v] of snapshot) {
    blobCache.set(n, v);
    await writeBlob(n, v);
    nomi.push(n);
  }
  await writeBlob(N_INDEX, nomi);
  await writeProbe(dNew.key, dNew.ns);

  // I blocchi col nome in chiaro erano cifrati con la CHIAVE DEL DISPOSITIVO: lasciarli lì
  // significherebbe che il file chiave resta leggibile SENZA il PIN, cioe' che attivare il
  // PIN non ha protetto nulla. Si cancellano — ma solo dopo aver riletto DAL DISCO ogni
  // singolo blocco nella sua copia nuova. Se una sola rilettura non torna, si annulla
  // tutto e il telefono resta come era: meglio la cifratura di prima che dati perduti.
  blobCache.clear();
  let copiaOk = true;
  for (const [n, v] of snapshot) {
    const back = await getBlob(n);
    if (!back || JSON.stringify(back) !== JSON.stringify(v)) { copiaOk = false; break; }
  }
  if (!copiaOk) {
    setMemKey(null, "");
    await ss.del(K_VER); await ss.del(K_SALT); await ss.del(K_PANIC_VER); await ss.del(K_KDF);
    throw new Error("Verifica della cifratura locale non riuscita: PIN non attivato.");
  }
  for (const n of nomi) {
    try { await AsyncStorage.removeItem(ENC_PREFIX + n); } catch { /* niente */ }
  }
  // La chiave del PIN d'emergenza e' servita solo per scriverne il verificatore.
  derivCache.clear();
  // Il file chiave passa da "in chiaro" a "cifrato col PIN".
  const plain = await AsyncStorage.getItem(KF_PLAIN);
  if (plain) {
    const parsed = JSON.parse(plain);
    await setBlob("keyfile", parsed);
    // Controllo di sicurezza: se il blob cifrato non si rilegge, si annulla tutto
    // invece di lasciare l'utente fuori dal proprio account.
    const back = await getBlob("keyfile");
    if (!back) {
      setMemKey(null, "");
      await ss.del(K_VER); await ss.del(K_SALT); await ss.del(K_PANIC_VER); await ss.del(K_KDF);
      throw new Error("Verifica della cifratura locale non riuscita: PIN non attivato.");
    }
    await AsyncStorage.removeItem(KF_PLAIN);
  }
  // Token di autodistruzione: permette di ordinare la cancellazione al server anche
  // quando la chiave d'identità è già cifrata dietro al PIN o distrutta.
  let token = await ss.get(K_PANIC_TOKEN);
  if (!token) {
    token = randomHex(32);
    await ss.set(K_PANIC_TOKEN, token);
  }
  if (typeof armFn === "function") {
    try { await armFn(token); } catch { /* si riproverà al prossimo avvio */ }
  }
  return true;
}

export async function disablePin(pin) {
  const r = await verifyPin(pin);
  if (r !== "ok") throw new Error("PIN errato.");
  // Tutto ciò che era cifrato col PIN torna sotto la chiave del dispositivo: niente in
  // chiaro, e niente dati persi.
  const snapshot = await readAllBlobs();
  const vecchi = snapshot.map((x) => x[0]);
  const nsVecchio = memNs;
  await ss.del(K_VER); await ss.del(K_SALT); await ss.del(K_PANIC_VER); await ss.del(K_KDF);
  await ss.set(K_TRIES, "0");
  setMemKey(null, "");
  for (const [n, v] of snapshot) {
    blobCache.set(n, v);
    await writeBlob(n, v);
  }
  // Togliendo il PIN i nomi tornano in chiaro: i blocchi opachi del profilo vanno
  // cancellati, altrimenti resterebbero lì cifrati con una chiave che non esiste piu.
  // ATTENZIONE: cosi si perde anche l'eventuale profilo esca — ed e' giusto, perche' un
  // doppio fondo senza PIN non ha alcun senso.
  if (nsVecchio) {
    const tutte = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(ENC_PREFIX));
    for (const k of tutte) {
      if (vecchi.indexOf(k.slice(ENC_PREFIX.length)) < 0) {
        try { await AsyncStorage.removeItem(k); } catch { /* niente */ }
      }
    }
  }
  await AsyncStorage.removeItem(KF_PLAIN); // eventuale residuo delle versioni vecchie
  return true;
}

/// "ok" | "panic" | "decoy" | "wrong"
/// L'ordine conta: prima il profilo vero, poi l'emergenza, e SOLO alla fine l'esca —
/// che non ha un verificatore e si riconosce unicamente perche' apre la propria sonda.
export async function verifyPin(pin) {
  const d = await derivePin(pin);
  if (!d) return "wrong";
  const ver = await ss.get(K_VER);
  if (!ver) return "wrong";
  if (d.ver === ver) return "ok";
  const pv = await ss.get(K_PANIC_VER);
  if (pv && d.ver === pv) return "panic";
  // Un PIN di emergenza impostato PRIMA del passaggio ad argon2 ha ancora il verificatore
  // vecchio: si controlla anche quello, altrimenti l'aggiornamento gli spegnerebbe
  // l'unica difesa che ha in caso di costrizione.
  if (pv && d.a2 && verifierOf(d.salt, pin) === pv) return "panic";
  if (await probeOpens(d)) return "decoy";
  return "wrong";
}

/// Chiave e namespace di un PIN gia' verificato. Esposta per i test.
export async function _derive(pin) { return derivePin(pin); }

/// Sblocco: restituisce { status, keyfile }.
export async function unlockWithPin(pin) {
  const r = await verifyPin(pin);
  if (r === "wrong") {
    const n = (await tries()) + 1;
    await ss.set(K_TRIES, String(n));
    const left = Math.max(0, MAX_TRIES - n);
    // distruzione non delegata: parte QUI, non nello strato che disegna lo schermo.
    // Prima era `AuthContext` a decidere di cancellare dopo aver visto `left: 0`: chi ha
    // il telefono in mano puo uccidere il processo in quell'istante. Adesso la parte
    // locale e' gia partita quando questa funzione ritorna.
    if (left <= 0) {
      try { await selfDestruct(null, { uninstall: false }); } catch { /* si prosegue */ }
    }
    return { status: "wrong", tries: n, left };
  }
  if (r === "panic") {
    // Il PIN di emergenza NON apre nulla: cancella, subito e qui.
    try { await selfDestruct(null, { uninstall: false }); } catch { /* si prosegue */ }
    return { status: "panic" };
  }
  const d = await derivePin(pin);
  setMemKey(d.key, d.a2 ? d.ns : "");
  await ss.set(K_TRIES, "0");
  if (r === "decoy") {
    // Profilo ESCA. Da qui dentro non esiste alcun modo di sapere che il profilo vero
    // esista: nessun contatore, nessun elenco, nessuna scorciatoia. I suoi dati sono
    // cifrati con una chiave che questo PIN non produce, e i suoi blocchi hanno nomi
    // che questo PIN non sa calcolare.
    const kfd = await getBlob("keyfile");
    return { status: "decoy", keyfile: kfd || null };
  }
  const kf = await getBlob("keyfile");
  // Installazioni con il PIN vecchio: si passa ad argon2id e ai nomi opachi al primo
  // sblocco riuscito, quando i dati sono in mano e verificabili. Se qualcosa non torna
  // NON si tocca niente: meglio la cifratura di ieri che un account irraggiungibile.
  metodoMigliore().then((m) => { if (d.met !== m) upgradeKdf(pin).catch(() => {}); }).catch(() => {});
  return { status: "ok", keyfile: kf };
}

/// PASSAGGIO AD ARGON2ID + NOMI OPACHI, senza perdere niente.
/// Ordine studiato per non poter fallire a metà: si SCRIVE la copia nuova, si VERIFICA
/// che il file chiave si rilegga, solo allora si sposta il verificatore e si cancella la
/// copia vecchia. Se si interrompe prima della verifica, il telefono resta esattamente
/// come era.
/// Metodo migliore possibile SU QUESTO telefono. Se il chip collabora, con il pepe.
async function metodoMigliore() {
  const base = kdf.metodoMigliore();
  if (hw.DISPONIBILE && (await hw.assicuraPepe(randomHex))) return base + SUFF_HW;
  return base;
}

export async function upgradeKdf(pin) {
  const cur = await derivePin(pin);
  if (!cur) return false;
  const migliore = await metodoMigliore();
  if (cur.met === migliore) return true;
  const ver0 = await ss.get(K_VER);
  if (!ver0 || cur.ver !== ver0) return false;

  setMemKey(cur.key, cur.met ? cur.ns : "");
  const snapshot = await readAllBlobs();

  const nomiVecchi = snapshot.map((x) => x[0]);
  const nsVecchio = cur.met ? cur.ns : "";
  const nuovo = await derivePin(pin, migliore);
  setMemKey(nuovo.key, nuovo.ns);
  const names = [];
  for (const [n, v] of snapshot) {
    blobCache.set(n, v);
    await writeBlob(n, v);
    names.push(n);
  }
  await writeBlob(N_INDEX, names);
  await writeProbe(nuovo.key, nuovo.ns);

  // VERIFICA: si rilegge dal disco, non dalla cache in memoria.
  blobCache.clear();
  const back = await getBlob("keyfile");
  const atteso = (snapshot.find((x) => x[0] === "keyfile") || [])[1];
  if (atteso && (!back || JSON.stringify(back) !== JSON.stringify(atteso))) {
    // Si torna indietro: la copia vecchia e' ancora tutta lì.
    setMemKey(cur.key, "");
    return false;
  }

  await ss.set(K_KDF, migliore);
  await ss.set(K_VER, nuovo.ver);
  // Ora, e solo ora, si buttano i blocchi vecchi: quelli col nome in chiaro se si veniva
  // da un'installazione vecchia, o quelli del namespace precedente se si cambia metodo.
  const vecchioKey = (n) => (nsVecchio
    ? ENC_PREFIX + bytesToHex(sha512(enc8("lattice-blobname-v1:" + nsVecchio + ":" + n))).slice(0, 32)
    : ENC_PREFIX + n);
  for (const n of nomiVecchi.concat([N_INDEX, N_PROBE])) {
    try { await AsyncStorage.removeItem(vecchioKey(n)); } catch { /* niente */ }
  }
  return true;
}

/// DOPPIO FONDO — crea il profilo esca.
/// Non scrive NESSUN verificatore: l'unica traccia dell'esca e' la sua sonda, che senza
/// il PIN esca e' indistinguibile da un blocco qualunque di dati cifrati.
export async function activateDecoy(realPin, decoyPin) {
  if (!/^\d{4,10}$/.test(String(decoyPin || ""))) throw new Error("Il PIN esca deve avere da 4 a 10 cifre.");
  if (String(decoyPin) === String(realPin)) throw new Error("Il PIN esca deve essere diverso dal PIN normale.");
  const r = await verifyPin(realPin);
  if (r !== "ok") throw new Error("PIN attuale errato.");
  const migliore = await metodoMigliore();
  if ((await metodoAttivo()) !== migliore) {
    const ok = await upgradeKdf(realPin);
    if (!ok) throw new Error("Aggiornamento della cifratura locale non riuscito: profilo esca non creato.");
  }
  const pv = await ss.get(K_PANIC_VER);
  const d = await derivePin(decoyPin, migliore);
  const vero = await derivePin(realPin, migliore);
  if (d.ns === vero.ns) throw new Error("PIN esca non utilizzabile.");
  if (pv && d.ver === pv) throw new Error("Il PIN esca non puo essere uguale al PIN di emergenza.");

  const nsBefore = memNs, keyBefore = memKey;
  memNs = d.ns; memKey = d.key;
  try {
    await writeBlob(N_INDEX, []);
    await writeBlob(N_PROBE, { m: PROBE_MAGIC, v: 2 });
  } finally {
    memNs = nsBefore; memKey = keyBefore;
    blobCache.clear();
  }
  // Controllo: il PIN esca deve essere riconosciuto, e il PIN vero deve continuare ad
  // aprire il profilo vero. Se una delle due cose non vale, e' un guasto e va detto.
  if ((await verifyPin(decoyPin)) !== "decoy") throw new Error("Verifica del profilo esca non riuscita.");
  if ((await verifyPin(realPin)) !== "ok") throw new Error("Verifica del profilo reale non riuscita.");
  // Il PIN esca e' scritto: la sua chiave non ha piu motivo di stare in RAM.
  derivCache.clear();
  return true;
}

/// Profilo attivo, per la diagnostica. NON dice se esiste un'esca: dice solo dove sei.
export function activeNs() { return memNs; }

/// Metodo di derivazione in uso e costo misurato, per la diagnostica in-app.
export async function kdfInfo() {
  const met = await metodoAttivo();
  const i = await hw.info();
  return {
    metodo: met || "sha512-v1 (vecchio)",
    nativo: kdf.NATIVO,
    ms: await kdf.costoMisurato(),
    hardware: met.endsWith(SUFF_HW),
    livello: i.livello,
  };
}

export function lockMemory() {
  setMemKey(null, "");
  derivCache.clear(); // le chiavi derivate non sopravvivono al blocco dell'app
  clearPlainCache().catch(() => {});
}

/// Cancella dalla cache dell'app tutto ciò che è stato DECIFRATO per essere mostrato:
/// foto, video, documenti aperti dalle chat ed esportazioni. Restavano lì in chiaro per
/// sempre; ora sparisce appena blocchi l'app o esci. Il file cifrato sul server resta,
/// quindi non si perde nulla: alla prossima apertura viene decifrato di nuovo.
const PLAIN_PREFIXES = ["att_", "lattice-dati-", "lattice-export-"];
export async function clearPlainCache() {
  // Anteprime già ricostruite in memoria: via anche quelle.
  try { clearThumbCache(); } catch (e) { /* */ }
  const dir = FileSystem.cacheDirectory;
  if (!dir) return 0;
  let n = 0;
  try {
    const names = await FileSystem.readDirectoryAsync(dir);
    for (const nm of names) {
      if (!PLAIN_PREFIXES.some((p) => nm.startsWith(p))) continue;
      try { await FileSystem.deleteAsync(dir + nm, { idempotent: true }); n++; } catch { /* file in uso */ }
    }
  } catch { /* cache non leggibile */ }
  return n;
}

export async function panicToken() {
  return await ss.get(K_PANIC_TOKEN);
}

// ── AUTODISTRUZIONE ──
// 1) ordina al server la cancellazione totale dell'account (messaggi, chiamate,
//    metadati, rubrica, gruppi, identità); 2) rade al suolo i dati locali;
//    3) apre la schermata di disinstallazione (Android chiede un tap di conferma).
export async function selfDestruct(serverWipeFn, { uninstall = true } = {}) {
  const report = { server: false, local: false };
  try {
    const tok = await ss.get(K_PANIC_TOKEN);
    if (tok && typeof serverWipeFn === "function") {
      await serverWipeFn(tok);
      report.server = true;
    }
  } catch { /* si prosegue comunque: la parte locale è la priorità */ }
  try {
    await AsyncStorage.clear();
    // La chiave nel chip e' l'ultima cosa e la piu definitiva: senza di lei nessun dato
    // locale e' piu leggibile, nemmeno con il PIN giusto.
    try { await hw.distruggi(); } catch { /* si prosegue */ }
    for (const k of [K_SALT, K_VER, K_PANIC_VER, K_PANIC_TOKEN, K_TRIES, K_DEV_KEY, K_KDF]) await ss.del(k);
    derivCache.clear();
    setMemKey(null, "");
    devKey = null;
    for (const dir of [FileSystem.cacheDirectory, FileSystem.documentDirectory]) {
      try {
        const names = await FileSystem.readDirectoryAsync(dir);
        for (const nm of names) {
          try { await FileSystem.deleteAsync(dir + nm, { idempotent: true }); } catch { /* file in uso */ }
        }
      } catch { /* directory non leggibile */ }
    }
    report.local = true;
  } catch { /* best effort */ }
  if (uninstall) {
    try {
      await IntentLauncher.startActivityAsync("android.intent.action.DELETE", { data: "package:" + PACKAGE_NAME });
    } catch { /* l'utente potrà disinstallare a mano */ }
  }
  return report;
}

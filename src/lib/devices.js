// BLOCCO A — FORWARD SECRECY con chiavi usa-e-getta e registro dispositivi.
//
// Ogni dispositivo (telefono, browser) genera un lotto di coppie ML-KEM-768
// "usa-e-getta": le pubbliche vanno sul server, le private restano qui, cifrate col PIN.
// Chi ti scrive consuma UNA pubblica per OGNI tuo dispositivo attivo → resti
// multi-dispositivo, ma la chiave d'identità da sola non basta più a decifrare la
// cronologia catturata: quella chiave è già stata buttata.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { Platform } from "react-native";
import { bytesToHex, hexToBytes, randomHex, decryptEnvelope } from "./crypto";
import { getBlob, setBlob } from "./lock";
import * as api from "./api";
import { CAP, CAP2, tryRatchetDecrypt } from "./ratchet";

const DEV_ID_KEY = "lat.device.id";
let cachedDid = null; // letto una volta: prima si andava su AsyncStorage per ogni messaggio
const BLOB = "prekeys";
const TARGET = 30; // lotto tenuto disponibile sul server
const REFILL_UNDER = 12;
// Le private scadono con i messaggi sul server (7 giorni + margine): dopo, nemmeno
// noi possiamo più decifrare quelle buste. È il senso della forward secrecy.
const MAX_AGE_MS = 9 * 24 * 3600 * 1000;

export async function deviceId() {
  if (cachedDid) return cachedDid;
  let id = await AsyncStorage.getItem(DEV_ID_KEY);
  if (!id) {
    id = "dev-" + randomHex(8);
    await AsyncStorage.setItem(DEV_ID_KEY, id);
  }
  cachedDid = id;
  return id;
}

async function loadPrivs() {
  const o = await getBlob(BLOB);
  return o && typeof o === "object" ? o : {};
}
async function savePrivs(o) {
  await setBlob(BLOB, o);
}

function newPrekey() {
  const kp = ml_kem768.keygen(hexToBytes(randomHex(64)));
  return { pk_id: "pk-" + randomHex(10), pub: bytesToHex(kp.publicKey), sec: bytesToHex(kp.secretKey) };
}

/// Registra il dispositivo e mantiene il lotto di chiavi usa-e-getta.
export async function ensureDevice(label) {
  const did = await deviceId();
  await api.registerDevice(did, label || (Platform.OS === "android" ? "Telefono Android" : Platform.OS), Platform.OS, [CAP, CAP2]);
  let privs = await loadPrivs();
  // Pulizia delle private scadute (forward secrecy: le vecchie non devono sopravvivere).
  const now = Date.now();
  let changed = false;
  for (const k of Object.keys(privs)) {
    if (!privs[k] || !privs[k].at || now - privs[k].at > MAX_AGE_MS) { delete privs[k]; changed = true; }
  }
  let available = 0;
  try { available = (await api.prekeysStatus(did))?.available || 0; } catch { available = 0; }
  if (available < REFILL_UNDER) {
    const batch = [];
    for (let i = 0; i < TARGET - available; i++) {
      const p = newPrekey();
      privs[p.pk_id] = { sec: p.sec, pub: p.pub, at: now };
      batch.push({ pk_id: p.pk_id, kem_pub: p.pub });
      changed = true;
    }
    if (batch.length) {
      // ORDINE CRITICO: prima i segreti al sicuro sul telefono (e si RI-LEGGE per esserne
      // certi), solo dopo le pubbliche sul server. Nell'ordine inverso un salvataggio
      // fallito (app chiusa in quell'istante, cassaforte non pronta) lasciava sul server
      // chiavi che il telefono non potrà mai aprire: chi ti scrive ne consuma una e il
      // messaggio diventa illeggibile per sempre, senza che nessuno se ne accorga.
      await savePrivs(privs);
      changed = false;
      const check = await loadPrivs();
      const safe = batch.every((b) => check[b.pk_id] && check[b.pk_id].sec);
      if (!safe) return did;                 // niente pubblicazione senza segreti al sicuro
      await api.uploadPrekeys(did, batch);
    }
  }
  if (changed) await savePrivs(privs);
  return did;
}

/// Aggiunge al keyMap le chiavi usa-e-getta dei MIEI dispositivi (così la copia del
/// mittente non resta legata alla chiave d'identità). Fallback: chiave statica.
export async function addSelfKeys(keyMap, user) {
  const staticPub = bytesToHex(user.kem.publicKey);
  try {
    const r = await api.claimPrekeys([user.lns]);
    const list = r && Array.isArray(r[user.lns]) ? r[user.lns] : [];
    keyMap[user.lns] = list.length ? list : staticPub;
  } catch {
    keyMap[user.lns] = staticPub;
  }
  return keyMap;
}

/// Prova a decifrare una busta con la chiave d'identità e con tutte le usa-e-getta locali.
/// `msg` può essere il messaggio intero (con `envelopes`) o una singola busta.
/// `opts.deep === false` esclude i tentativi a tentoni (ogni busta con ogni chiave locale):
/// costano fino a ~120 decapsulazioni ML-KEM per un solo messaggio e vanno fatti fuori
/// dal percorso che l'utente sta aspettando. Nessuna chiave in meno: solo più tardi.
export async function decryptAny(msg, user, opts) {
  const deep = !opts || opts.deep !== false;
  // Tetto ai tentativi a tentoni e respiro all'interfaccia: senza questi due limiti una
  // chat con messaggi non decifrabili teneva il thread di disegno occupato per secondi
  // (fino a 30 decapsulazioni ML-KEM per busta), i tap si accodavano e l'app sembrava
  // bloccata. Nessuna chiave in meno: cambia solo il ritmo.
  const budget = opts && typeof opts.budget === "number" ? opts.budget : (deep ? 60 : 8);
  const breathe = !!(opts && opts.breathe);
  let used = 0;
  const attempt = async (env, secBytes) => {
    if (used >= budget) return undefined;
    used++;
    if (breathe && used % 3 === 0) await new Promise((r) => setTimeout(r, 0));
    return decryptEnvelope(env, secBytes);
  };
  const list = Array.isArray(msg?.envelopes) && msg.envelopes.length
    ? msg.envelopes
    : (msg?.envelope ? [msg.envelope] : (msg?.ct ? [msg] : []));
  if (!list.length || !user?.kem) return null;
  // 0) BLOCCO R: buste con doppio ratchet (chiave nuova a ogni messaggio, auto-guarigione)
  if (list.some((e) => e && e.r && e.h)) {
    try {
      const pt = await tryRatchetDecrypt(list, user, msg && msg.from_lns);
      if (pt != null) return pt;
    } catch { /* si prosegue con gli schemi precedenti */ }
  }
  // 1) chiave d'identità (messaggi vecchi o mittenti senza forward secrecy)
  for (const env of list) {
    if (env && !env.pk_id) {
      const pt = await attempt(env, user.kem.secretKey);
      if (pt != null) return pt;
    }
  }
  // 2) chiavi usa-e-getta di questo dispositivo
  const privs = await loadPrivs();
  const did = await deviceId();
  for (const env of list) {
    if (!env) continue;
    const cand = [];
    if (env.pk_id && privs[env.pk_id]) cand.push(privs[env.pk_id].sec);
    else if (env.pk_id) continue; // busta per un altro dispositivo
    if (!env.pk_id && env.dev === did) {
      if (!deep) continue;
      for (const k of Object.keys(privs)) cand.push(privs[k].sec);
    }
    for (const sec of cand) {
      const pt = await attempt(env, hexToBytes(sec));
      if (pt != null) return pt;
    }
  }
  // 3) ultimo tentativo: qualsiasi busta con qualsiasi private locale
  if (!deep) return null;
  for (const env of list) {
    for (const k of Object.keys(privs)) {
      if (used >= budget) return null;
      const pt = await attempt(env, hexToBytes(privs[k].sec));
      if (pt != null) return pt;
    }
  }
  return null;
}

/// SOLO DIAGNOSTICA: gli ID (mai i segreti) delle chiavi usa-e-getta che questo telefono
/// possiede davvero. Serve a capire se una busta non si apre perché il mittente ha usato
/// una chiave che qui non c'è più (reinstallazione, cambio PIN, scadenza).
export async function localPrekeyIds() {
  try { return Object.keys((await loadPrivs()) || {}); } catch { return []; }
}

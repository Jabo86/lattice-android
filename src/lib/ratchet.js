// BLOCCO R — memoria e trasporto del doppio ratchet.
// Lo stato delle sessioni vive SOLO su questo telefono, dentro il blob cifrato col PIN.
// Il server vede passare l'intestazione (chiave pubblica e incapsulamento ML-KEM): non gli
// serve a niente e non gli dice con chi stai parlando più di quanto già sappia.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { bytesToHex } from "./crypto";
import { getBlob, setBlob, setBlobSoon } from "./lock";
import * as api from "./api";
import {
  CAP, CAP2, sessionKey, initSender, initReceiver, initSender2, initReceiver2,
  initReceiver2Gens, ratchetEncrypt, ratchetDecrypt,
} from "./ratchetCore";
import { candidateGens, keysFor } from "./keygen";

const BLOB = "rat";
const SPK_BLOB = "spk";   // chiavi statiche dei contatti, tenute in cassaforte locale
const DHK_BLOB = "dhpk";  // chiavi X25519 d'identita' dei contatti (per il ratchet ibrido)
const K5_BLOB = "kem1024"; // chiavi d'identita' ML-KEM-1024 dei contatti (solo per l'aggancio)
const HDH_BLOB = "hdh";   // curve d'AGGANCIO dei contatti: sono quelle che si possono ruotare
const PROBE_BLOB = "ratprobe";
const PROBE_MS = 24 * 3600 * 1000; // ogni tanto ricontrolliamo se l'altro ha aggiunto un dispositivo
const MAX_SESSIONS = 200;
export { CAP, CAP2 };

async function loadAll() {
  const o = await getBlob(BLOB);
  return o && typeof o === "object" ? o : {};
}
async function saveAll(all) {
  const keys = Object.keys(all);
  if (keys.length > MAX_SESSIONS) {
    keys.sort((a, b) => (all[a].at || 0) - (all[b].at || 0));
    for (const k of keys.slice(0, keys.length - MAX_SESSIONS)) delete all[k];
  }
  setBlobSoon(BLOB, all);
}
let cachedDev = null; // letto una volta: prima si leggeva AsyncStorage per ogni messaggio
async function myDeviceId() {
  if (cachedDev) return cachedDev;
  const v = (await AsyncStorage.getItem("lat.device.id")) || "";
  if (v) cachedDev = v;
  return v;
}
/// La chiave usa-e-getta si BUTTA appena ha aperto una sessione: e' l'unica differenza fra
/// "forward secrecy fra nove giorni" e "forward secrecy adesso". Chi ti sequestra il telefono
/// domani non deve poter ricostruire la radice di una conversazione iniziata oggi.
async function consumePrekey(pkId) {
  if (!pkId) return;
  try {
    const privs = await getBlob("prekeys");
    if (privs && privs[pkId]) { delete privs[pkId]; await setBlob("prekeys", privs); }
  } catch { /* al prossimo giro di manutenzione */ }
}

async function prekeySecret(pkId) {
  const privs = await getBlob("prekeys");
  const rec = privs && privs[pkId];
  return rec ? rec.sec : null;
}
async function prekeyPublic(pkId) {
  const privs = await getBlob("prekeys");
  const rec = privs && privs[pkId];
  return rec ? rec.pub || "" : "";
}

/// Chiavi statiche dei contatti in cassaforte locale. Senza la chiave statica la catena che
/// si rigenera NON parte e si ricade per sempre sulle usa-e-getta (è quello che è successo
/// fra due utenti reali): una richiesta al server andata male non deve più impedirlo.
export async function cacheStaticKeys(peers) {
  let n = 0;
  try {
    const got = await api.pulseStaticKeys(peers);
    const cache = (await getBlob(SPK_BLOB)) || {};
    for (const p of peers) {
      const v = got && got[p];
      if (typeof v === "string" && v.length > 64) { cache[p] = v; n++; }
    }
    await setBlob(SPK_BLOB, cache);
  } catch { /* si riprova al prossimo avvio */ }
  return n;
}

/// Chiave X25519 d'identita' di un contatto, con cassaforte locale: senza di essa il
/// ratchet ibrido non parte e si ricade sulla v1 (post-quantistica pura), non su niente.
async function dhKeyFor(peer) {
  let pk = "";
  try { pk = ((await api.pulseDhKeys([peer])) || {})[peer] || ""; } catch { /* niente rete adesso */ }
  const cache = (await getBlob(DHK_BLOB)) || {};
  if (typeof pk === "string" && pk.length === 64) {
    if (cache[peer] !== pk) { cache[peer] = pk; await setBlob(DHK_BLOB, cache); }
    return pk;
  }
  return typeof cache[peer] === "string" ? cache[peer] : "";
}

/// Chiave d'identità di livello 5 di un contatto, con cassaforte locale. Se non c'è,
/// l'aggancio resta a 768: si scende di parametro, non di protocollo.
async function k5KeyFor(peer) {
  let pk = "";
  try { pk = ((await api.pulseKeys1024([peer])) || {})[peer] || ""; } catch { /* niente rete adesso */ }
  const cache = (await getBlob(K5_BLOB)) || {};
  if (typeof pk === "string" && pk.length > 2400) {
    if (cache[peer] !== pk) { cache[peer] = pk; await setBlob(K5_BLOB, cache); }
    return pk;
  }
  return typeof cache[peer] === "string" ? cache[peer] : "";
}

/// Curva d'aggancio di un contatto (ruotabile). Se non l'ha pubblicata si torna alla sua
/// curva d'identita', cioe' alla generazione 0.
async function hdhKeyFor(peer) {
  let pk = "";
  try { pk = ((await api.pulseHdhKeys([peer])) || {})[peer] || ""; } catch { /* niente rete */ }
  const cache = (await getBlob(HDH_BLOB)) || {};
  if (typeof pk === "string" && pk.length === 64) {
    if (cache[peer] !== pk) { cache[peer] = pk; await setBlob(HDH_BLOB, cache); }
    return pk;
  }
  return typeof cache[peer] === "string" ? cache[peer] : "";
}

async function staticKeyFor(peer) {
  let pk = "";
  try { pk = (await api.pulseStaticKeys([peer]))[peer] || ""; } catch { /* niente rete adesso */ }
  const cache = (await getBlob(SPK_BLOB)) || {};
  if (typeof pk === "string" && pk.length > 64) {
    if (cache[peer] !== pk) { cache[peer] = pk; await setBlob(SPK_BLOB, cache); }
    return pk;
  }
  return typeof cache[peer] === "string" ? cache[peer] : "";
}

/// Buste ratchet per un contatto (chat 1:1). Ritorna anche le buste "vecchio stile" per i
/// dispositivi che non sanno ancora ratchettare, così nessuno resta senza messaggi.
export async function ratchetEnvelopesFor(payload, peer, user) {
  const myDev = await myDeviceId();
  if (!myDev || !user || !user.kem) return { envelopes: [], legacy: [] };
  const all = await loadAll();
  const mine = Object.keys(all).filter((k) => all[k] && all[k].peer === peer && all[k].myDev === myDev);

  // Sessioni già aperte: nessuna chiamata al server, nessuna chiave usa-e-getta consumata.
  let probes = (await getBlob(PROBE_BLOB)) || {};
  const stale = !probes[peer] || Date.now() - probes[peer] > PROBE_MS;
  let claimed = null;
  if (!mine.length || stale) {
    try { claimed = (await api.claimPrekeys([peer]))[peer] || []; } catch { claimed = null; }
    probes = { ...probes, [peer]: Date.now() };
    await setBlob(PROBE_BLOB, probes);
  }

  const legacy = [];
  if (Array.isArray(claimed)) {
    const staticPk = await staticKeyFor(peer);
    // Serve solo se qualcuno dei suoi dispositivi sa fare l'ibrido: nessuna chiamata inutile.
    const wantsHybrid = claimed.some((d) => d && Array.isArray(d.caps) && d.caps.includes(CAP2));
    const theirDhPk = wantsHybrid ? await dhKeyFor(peer) : "";
    const theirK5 = wantsHybrid && theirDhPk ? await k5KeyFor(peer) : "";
    const theirHdh = wantsHybrid && theirDhPk ? await hdhKeyFor(peer) : "";
    for (const d of claimed) {
      if (!d || !d.kem_pub) continue;
      const caps = Array.isArray(d.caps) ? d.caps : [];
      const k = sessionKey(d.device_id, myDev);
      if (!caps.includes(CAP) && !caps.includes(CAP2)) {
        // dispositivo con app vecchia: busta usa-e-getta come prima
        legacy.push({ device_id: d.device_id, pk_id: d.pk_id, kem_pub: d.kem_pub });
        continue;
      }
      // NEGOZIAZIONE: ibrido solo se il suo dispositivo lo sa fare E abbiamo la sua curva;
      // altrimenti si scende alla v1 post-quantistica pura, mai a niente.
      const hybrid = caps.includes(CAP2) && !!theirDhPk;
      if (!all[k] && staticPk) {
        const st = hybrid
          ? initSender2({
              theirStaticPk: staticPk, theirDhPk, theirStaticPk1024: theirK5, theirHdhPk: theirHdh,
              theirRatchetPk: d.kem_pub, pkId: d.pk_id,
              myDev, theirDev: d.device_id, peer,
            })
          : initSender({
              theirStaticPk: staticPk, theirRatchetPk: d.kem_pub, pkId: d.pk_id,
              myDev, theirDev: d.device_id, peer,
            });
        if (st) all[k] = st;
        else legacy.push({ device_id: d.device_id, pk_id: d.pk_id, kem_pub: d.kem_pub });
      } else if (!all[k]) {
        legacy.push({ device_id: d.device_id, pk_id: d.pk_id, kem_pub: d.kem_pub });
      }
    }
  }

  const envelopes = [];
  for (const k of Object.keys(all)) {
    const st = all[k];
    if (!st || st.peer !== peer || st.myDev !== myDev) continue;
    try {
      const r = ratchetEncrypt(st, payload);
      all[k] = r.state;
      envelopes.push(Object.assign({ for: peer, dev: st.theirDev }, r.env));
    } catch { /* sessione inutilizzabile: si ripiega sulle buste classiche */ }
  }
  if (envelopes.length) await saveAll(all);
  return { envelopes, legacy };
}

/// Tentativo di decifratura ratchet su una lista di buste. Ritorna il testo o null.
export async function tryRatchetDecrypt(list, user, peerHint) {
  const rats = (list || []).filter((e) => e && e.r && e.h);
  const myDhSk = user && user.dh && user.dh.secretKey ? bytesToHex(user.dh.secretKey) : "";
  const myDhPk = user && user.dh && user.dh.publicKey ? bytesToHex(user.dh.publicKey) : "";
  const k5 = user && user.kem1024;
  const myK5Sk = k5 && k5.secretKey ? bytesToHex(k5.secretKey) : "";
  const myK5Pk = k5 && k5.publicKey ? bytesToHex(k5.publicKey) : "";
  // Le nostre generazioni di chiavi d'aggancio, dalla corrente indietro. Si ricavano dal
  // segreto d'identità: nessuna vecchia chiave da custodire, e nessuna smette di funzionare.
  let gens = null;
  if (user && user.sk && rats.some((e) => e.h && e.h.v === 2 && e.h.init)) {
    try {
      gens = (await candidateGens()).map((g) => {
        const k = keysFor(user.sk, g);
        return { gen: g, dhSk: bytesToHex(k.dh.secretKey), dhPk: bytesToHex(k.dh.publicKey),
                 k5Sk: bytesToHex(k.k5.secretKey), k5Pk: bytesToHex(k.k5.publicKey) };
      });
    } catch { gens = null; }
  }
  if (!rats.length) return null;
  const myDev = await myDeviceId();
  const all = await loadAll();
  for (const env of rats) {
    const h = env.h || {};
    const k = sessionKey(h.sdev, myDev);
    let st = all[k];
    let fresh = "";
    if (!st && h.init) {
      // primo messaggio di una conversazione: la radice si ricava con la chiave d'identità,
      // il primo anello del ratchet è la chiave usa-e-getta che il mittente ha consumato.
      const usedStatic = !h.init.pk_id;
      const sk = usedStatic ? bytesToHex(user.kem.secretKey) : await prekeySecret(h.init.pk_id);
      if (!sk) continue;
      const pub = usedStatic ? bytesToHex(user.kem.publicKey) : await prekeyPublic(h.init.pk_id);
      st = h.v === 2
        ? initReceiver2Gens({
            header: h, myStaticSk: bytesToHex(user.kem.secretKey),
            myStaticPk: bytesToHex(user.kem.publicKey), myDhSk, myDhPk,
            myStaticSk1024: myK5Sk, myStaticPk1024: myK5Pk,
            myRatchetPk: pub, myRatchetSk: sk, myDev, peer: peerHint || "",
          }, gens, env)
        : initReceiver({
            header: h, myStaticSk: bytesToHex(user.kem.secretKey),
            myRatchetPk: pub, myRatchetSk: sk, myDev, peer: peerHint || "",
          });
      if (!st) continue;
      fresh = h.init.pk_id || "";
    }
    if (!st) continue;
    const r = ratchetDecrypt(st, env);
    if (r) {
      if (peerHint && !r.state.peer) r.state.peer = peerHint;
      all[k] = r.state;
      await saveAll(all);
      // Sessione aperta per davvero: la usa-e-getta ha finito il suo lavoro e si butta.
      if (fresh) await consumePrekey(fresh);
      return r.plaintext;
    }
  }
  return null;
}

/// Numeri per il pannello di sicurezza: quante volte la catena si è rigenerata.
export async function ratchetStats(peer) {
  const all = await loadAll();
  let heals = 0, sent = 0, recv = 0, since = 0, sessions = 0, hybrid = 0, lvl5 = 0;
  for (const k of Object.keys(all)) {
    const st = all[k];
    if (!st || (peer && st.peer !== peer)) continue;
    sessions++;
    if (st.v === 2) hybrid++;
    if (st.lvl === "1024") lvl5++;
    heals += st.heals || 0; sent += st.sent || 0; recv += st.recv || 0;
    since = since ? Math.min(since, st.at || 0) : st.at || 0;
  }
  return { sessions, heals, sent, recv, since, hybrid, lvl5 };
}

/// Azzera TUTTO: ogni sessione e ogni chiave dei contatti tenuta in cassaforte locale.
/// È il cuore di "Dopo la dogana". Le due cose vanno insieme: se si buttano le sessioni ma
/// si tengono le chiavi in cassaforte, un eventuale chiave falsa infilata mentre il telefono
/// era via resterebbe lì a fare danno. Buttandole si riscaricano dal server, e se non
/// combaciano più con l'impronta verificata l'app lo dice.
export async function resetAllRatchets() {
  const all = await loadAll();
  const sessions = Object.keys(all).length;
  await setBlob(BLOB, {});
  await setBlob(PROBE_BLOB, {});
  let peerKeys = 0;
  for (const b of [SPK_BLOB, DHK_BLOB, K5_BLOB, HDH_BLOB]) {
    const o = await getBlob(b);
    if (o && typeof o === "object") peerKeys += Object.keys(o).length;
    await setBlob(b, {});
  }
  return { sessions, peerKeys };
}

/// Azzera la sessione con un contatto: il prossimo messaggio riparte da una radice nuova.
export async function resetRatchet(peer) {
  const all = await loadAll();
  for (const k of Object.keys(all)) if (all[k] && all[k].peer === peer) delete all[k];
  await saveAll(all);
  const probes = (await getBlob(PROBE_BLOB)) || {};
  delete probes[peer];
  await setBlob(PROBE_BLOB, probes);
}

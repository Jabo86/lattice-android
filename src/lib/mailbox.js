// CASSETTE POSTALI ANONIME (lato app) — fase 2 del sigillo mittente.
//
// Con la modalità attiva il messaggio NON passa più da /pulse/send: viene depositato in
// una cassetta con indirizzo casuale usando un gettone monouso, SENZA autenticarsi. Il
// server non sa chi scrive né che due indirizzi Lattice sono nella stessa conversazione.
// Gettoni e chiavi monouso vengono consegnati ai contatti dentro la chat cifrata
// (messaggio di controllo invisibile), quindi il server non li vede mai.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { sha3_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes, randomHex, encryptForRecipients, decryptEnvelope, packMessage, unpackMessage } from "./crypto";
import { getBlob, setBlob } from "./lock";
import { ratchetEnvelopesFor, tryRatchetDecrypt } from "./ratchet";
import * as api from "./api";

const FLAG = "lat.mbx.on";
const BLOB = "mbx";
const CTL = "\u0001mbx:";
const BATCH = 12; // gettoni + chiavi monouso consegnati per volta a ogni contatto

let identity = null;
/// Chi siamo: serve al ratchet dentro la cassetta. Senza, si resta alla crittografia a
/// colpo singolo di prima — mai a niente.
export function setIdentity(u) { identity = u || null; }

const enc8 = (s) => new TextEncoder().encode(s);
const h3 = (s) => bytesToHex(sha3_256(enc8(s)));
const day = () => new Date().toISOString().slice(0, 10);

export async function isOn() {
  return (await AsyncStorage.getItem(FLAG)) === "1";
}
export async function setOn(v) {
  await AsyncStorage.setItem(FLAG, v ? "1" : "0");
  if (v) {
    await ensure();
    try {
      const { registerForPush } = require("./notifications");
      const t = await registerForPush();
      if (t) await registerPush(t, "android");
    } catch { /* niente permesso notifiche */ }
  }
}

async function load() {
  const o = await getBlob(BLOB);
  return o && typeof o === "object" ? o : { peers: {}, msgs: {}, keys: {}, tickets: [] };
}
async function save(o) {
  await setBlob(BLOB, o);
}
function proofOf(st) {
  return h3(h3(st.secret) + day() + st.id);
}
function newKey() {
  const kp = ml_kem768.keygen(hexToBytes(randomHex(64)));
  return { id: "mk-" + randomHex(8), pub: bytesToHex(kp.publicKey), sec: bytesToHex(kp.secretKey) };
}

/// Crea la cassetta (se non c'è) e mantiene il magazzino di gettoni sul server.
export async function ensure() {
  if (!(await isOn())) return null;
  const st = await load();
  if (!st.id) {
    st.id = "mbx-" + randomHex(10);
    st.secret = randomHex(32);
    const r = await api.mailboxCreate(st.id, h3(st.secret));
    if (!r || !r.ok) return null;
    st.tickets = [];
    await save(st);
  }
  // Gettoni: ne generiamo un lotto e carichiamo sul server SOLO i loro hash.
  if (!Array.isArray(st.tickets) || st.tickets.length < 24) {
    const fresh = [];
    for (let i = 0; i < 48; i++) fresh.push(randomHex(32));
    await api.mailboxTickets(st.id, proofOf(st), fresh.map(h3));
    st.tickets = (st.tickets || []).concat(fresh);
    await save(st);
  }
  return st;
}

/// Consegna a un contatto, DENTRO la chat cifrata, l'indirizzo della cassetta più un
/// lotto di gettoni e di chiavi monouso (le chiavi private restano qui).
export async function publishTo(peerLns, user) {
  const st = await ensure();
  if (!st) return false;
  const last = (st.peers[peerLns] || {}).published_at || 0;
  if (Date.now() - last < 3 * 24 * 3600 * 1000) return false; // già fatto di recente
  const tickets = (st.tickets || []).splice(0, BATCH);
  if (!tickets.length) return false;
  const keys = [];
  st.keys = st.keys || {};
  for (let i = 0; i < BATCH; i++) {
    const k = newKey();
    st.keys[k.id] = k.sec;
    keys.push({ id: k.id, pub: k.pub });
  }
  const payload = packMessage(CTL + JSON.stringify({ mbx: st.id, tk: tickets, pk: keys }), [], null, 0);
  const keyMap = await api.pulseKeys([peerLns]);
  const envelopes = encryptForRecipients(payload, keyMap);
  if (!envelopes.length) return false;
  await api.pulseSend([peerLns], envelopes);
  st.peers[peerLns] = Object.assign(st.peers[peerLns] || {}, { published_at: Date.now() });
  await save(st);
  return true;
}

/// Messaggio di controllo ricevuto: memorizza cassetta, gettoni e chiavi del contatto.
export async function onControl(text, fromLns) {
  try {
    const data = JSON.parse(text.slice(CTL.length));
    if (!data.mbx || !Array.isArray(data.tk)) return;
    const st = await load();
    const p = st.peers[fromLns] || {};
    p.mbx = data.mbx;
    p.tickets = (p.tickets || []).concat(data.tk).slice(-96);
    p.keys = (p.keys || []).concat(Array.isArray(data.pk) ? data.pk : []).slice(-96);
    st.peers[fromLns] = p;
    await save(st);
  } catch { /* controllo illeggibile: ignorato */ }
}

/// Prova a inviare in modo anonimo. Ritorna true se TUTTI i destinatari sono stati serviti.
export async function trySend(recipients, payload, convId, user) {
  if (!(await isOn())) return false;
  const st = await load();
  if (!st.id) return false;
  const ready = recipients.filter((r) => st.peers[r] && st.peers[r].mbx && (st.peers[r].tickets || []).length && (st.peers[r].keys || []).length);
  if (!ready.length || ready.length !== recipients.length) return false;
  for (const r of ready) {
    const p = st.peers[r];
    const ticket = p.tickets.shift();
    const key = p.keys.shift();
    const body = packMessage(payload.text !== undefined ? payload.text : payload, payload.atts || [], payload.reply || null, payload.ttl || 0);
    // DENTRO la busta anonima va la busta del TRIPLO RATCHET, non il testo. La busta esterna
    // (cifrata con una chiave monouso della cassetta) è ciò che rende il deposito anonimo per
    // il server; quella interna è ciò che dà chiave nuova per ogni messaggio e auto-guarigione.
    // Gettone e chiave monouso restano identici: l'anonimato non cambia di una virgola.
    let inner = null;
    try {
      const rr = await ratchetEnvelopesFor(body, r, user);
      if (rr && rr.envelopes && rr.envelopes.length) {
        inner = JSON.stringify({ f: user.lns, cid: convId, at: new Date().toISOString(), e: rr.envelopes });
      }
    } catch { /* nessuna sessione: si usa la crittografia di prima */ }
    if (inner == null) inner = JSON.stringify({ f: user.lns, cid: convId, at: new Date().toISOString(), body });
    const envs = encryptForRecipients(inner, { anon: key.pub });
    const env = Object.assign({}, envs[0], { pk_id: key.id });
    delete env.for;
    const ok = await api.mailboxDrop(ticket, env);
    if (!ok || !ok.ok) return false;
  }
  // Copia locale del mittente (il server non conserva nulla per noi).
  await appendLocal(st, convId, { id: "loc-" + randomHex(6), mine: true, at: new Date().toISOString(), body: payload.text !== undefined ? payload.text : payload, atts: payload.atts || [] });
  await save(st);
  return true;
}

async function appendLocal(st, cid, m) {
  st.msgs = st.msgs || {};
  st.msgs[cid] = (st.msgs[cid] || []).concat([m]).slice(-400);
}

/// Ritiro dei depositi: decifra con le chiavi monouso locali e salva nella cronologia
/// locale cifrata. Sul server, dopo il ritiro, non resta nulla.
export async function pickup(user) {
  const me = user || identity;
  if (!(await isOn())) return 0;
  const st = await load();
  if (!st.id) return 0;
  let r;
  try {
    r = await api.mailboxPickup(st.id, proofOf(st));
  } catch {
    return 0;
  }
  const drops = (r && r.drops) || [];
  let n = 0;
  for (const d of drops) {
    const env = d.envelope || {};
    const secs = [];
    if (env.pk_id && st.keys && st.keys[env.pk_id]) secs.push(st.keys[env.pk_id]);
    else if (st.keys) for (const k of Object.keys(st.keys)) secs.push(st.keys[k]);
    for (const sec of secs) {
      const pt = decryptEnvelope(env, hexToBytes(sec));
      if (pt == null) continue;
      try {
        const o = JSON.parse(pt);
        let body = o.body;
        if (Array.isArray(o.e) && o.e.length) {
          // Busta del ratchet dentro il deposito anonimo: si apre come tutte le altre.
          if (!me) break;
          body = await tryRatchetDecrypt(o.e, me, o.f);
          if (body == null) break;              // non è per noi, o non si apre: si lascia stare
        }
        const u = unpackMessage(body);
        await appendLocal(st, o.cid, { id: d.drop_id, mine: false, at: o.at || d.created_at, body: u.text, atts: u.atts || [], from: o.f, rat: Array.isArray(o.e) });
        n++;
      } catch { /* deposito malformato */ }
      break;
    }
  }
  if (n) await save(st);
  return n;
}

/// Messaggi anonimi salvati localmente per una conversazione.
export async function localForConv(cid) {
  if (!(await isOn())) return [];
  const st = await load();
  const list = (st.msgs && st.msgs[cid]) || [];
  return list.map((m) => ({
    id: m.id, mine: !!m.mine, body: m.body, atts: m.atts || [], reply: null, signed: null,
    reactions: [], ttl: 0, at: m.at, delivered: true, read: true, edited: false, pinned: false, anon: true,
  }));
}

/// Collega il token di notifica alla CASSETTA e non all'identità Lattice: il server
/// può svegliare il telefono senza sapere di chi sia l'account.
export async function registerPush(token, platform) {
  if (!token || !(await isOn())) return false;
  const st = await ensure();
  if (!st) return false;
  try {
    await api.mailboxNotify(st.id, proofOf(st), String(token), platform || "android");
    return true;
  } catch {
    return false;
  }
}

/// Stato leggibile per la schermata Impostazioni.
export async function status() {
  const on = await isOn();
  const st = await load();
  const peers = Object.keys(st.peers || {}).filter((k) => st.peers[k].mbx);
  return {
    on,
    rat: Object.values(st.msgs || {}).reduce((a, l) => a + (l || []).filter((m) => m && m.rat).length, 0),
    mailbox: st.id || null,
    tickets: (st.tickets || []).length,
    peers: peers.length,
    peer_tickets: peers.reduce((a, k) => a + ((st.peers[k].tickets || []).length), 0),
  };
}

/// Chiusura della cassetta (usata anche dall'autodistruzione).
export async function close() {
  const st = await load();
  if (!st.id) return;
  try { await api.mailboxClose(st.id, proofOf(st)); } catch { /* best effort */ }
  await setBlob(BLOB, { peers: {}, msgs: {}, keys: {}, tickets: [] });
}

export const CTL_PREFIX = CTL;

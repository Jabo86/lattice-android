// Lattice Pulse API client (sidecar session model, mirrors the web client).
// Node-safe: only depends on axios + crypto.js (no React Native imports here),
// so the same code path is exercised by the Node E2E test.
import axios from "axios";
import { DEFAULT_SERVER } from "../config";
import { signChallenge } from "./crypto";
import { randPad } from "./pad";

export function normalizeServer(url) {
  let u = (url || "").trim();
  if (!u) return DEFAULT_SERVER;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u.replace(/\/+$/, "");
}

let _base = DEFAULT_SERVER;
const attachChaff = (c) => {
  // Ogni richiesta (vera o di rumore) porta un riempitivo di lunghezza casuale: le stazze
  // dei pacchetti diventano indistinguibili. Il server ignora questa intestazione.
  c.interceptors.request.use((cfg) => {
    try { cfg.headers = cfg.headers || {}; cfg.headers["X-Pad"] = randPad(); } catch { /* niente */ }
    return cfg;
  });
  return c;
};
const makeClient = (base) => attachChaff(axios.create({ baseURL: `${base}/api`, timeout: 25000 }));

// Richiesta finta per il Traffico di Rumore: innocua e con lo stesso padding delle vere.
export async function coverPing() {
  try { await client.get("/health", { timeout: 8000 }); } catch { /* il rumore non deve mai disturbare */ }
}
let client = makeClient(_base);

export function setServerUrl(url) {
  _base = normalizeServer(url);
  client = makeClient(_base);
  _token = null;
}
export function getServerUrl() { return _base; }

let _kf = null; // { lns, sk, pk }
let _token = null; // sidecar session JWT

export function setKeyfile(kf) { _kf = kf; _token = null; }
export function clearAuth() { _kf = null; _token = null; }

async function ensureSession() {
  if (_token) return _token;
  if (!_kf) throw new Error("Sessione non disponibile: importa il tuo file chiave.");
  const { data: c } = await client.post("/public/sign-challenge", { lns_name: _kf.lns });
  const signature_hex = signChallenge(c.nonce_hex, _kf.sk);
  const { data: r } = await client.post("/public/session/verify", {
    lns_name: _kf.lns, nonce_id: c.nonce_id, signature_hex,
  });
  _token = r.token;
  return _token;
}

async function withAuth(fn) {
  try {
    return await fn({ headers: { Authorization: `Bearer ${await ensureSession()}` } });
  } catch (e) {
    if (e?.response?.status === 401) {
      _token = null;
      return await fn({ headers: { Authorization: `Bearer ${await ensureSession()}` } });
    }
    throw e;
  }
}

// Validate a keyfile by establishing a live session.
export async function login(kf) {
  setKeyfile(kf);
  await ensureSession();
  return true;
}

// Contesto identità (include must_rotate) — GET pubblico per lns_name, senza sessione.
export const meContext = (lns) =>
  client.get("/public/me/context", { params: { lns_name: lns } }).then((r) => r.data);

// Rotazione chiave (primo accesso / cambio obbligatorio): firma una challenge con la chiave
// attuale, il server genera una NUOVA coppia e restituisce il nuovo keyfile. Mirror del web.
export async function rotateKey() {
  if (!_kf) throw new Error("Sessione non disponibile: importa il tuo file chiave.");
  const { data: c } = await client.post("/public/sign-challenge", { lns_name: _kf.lns });
  const signature_hex = signChallenge(c.nonce_hex, _kf.sk);
  const { data: r } = await client.post("/public/rotate", {
    lns_name: _kf.lns, nonce_id: c.nonce_id, signature_hex,
  });
  return r; // { ok, keyfile, keyfile_filename, user }
}

export const publishKey = (kem_pk_hex, dh_pk_hex, kem1024_pk_hex, hdh_pk_hex) =>
  withAuth((a) => client.post("/public/pulse/publish-key",
    { kem_pk_hex, dh_pk_hex, kem1024_pk_hex: kem1024_pk_hex || "", hdh_pk_hex: hdh_pk_hex || "" }, a)
    .then((r) => r.data));

/// Curva d'aggancio dei contatti: quella che si può ruotare. Se un contatto non l'ha
/// pubblicata si usa la sua curva d'identità, cioè la generazione 0.
export const pulseHdhKeys = (lns_list) =>
  withAuth((a) => client.post("/public/pulse/hdhkeys", { lns_list }, a).then((r) => r.data));

/// Chiavi d'identità ML-KEM-1024 dei contatti (livello 5), usate solo nell'aggancio.
export const pulseKeys1024 = (lns_list) =>
  withAuth((a) => client.post("/public/pulse/keys1024", { lns_list }, a).then((r) => r.data));
export const pulseDhKeys = (lns_list) =>
  withAuth((a) => client.post("/public/pulse/dhkeys", { lns_list }, a).then((r) => r.data));
// ── Signaling anonimo (blind rendezvous): endpoint pubblici non identificanti ──
export const anonPut = (rid, slot, data) =>
  client.post("/public/anon/put", { rid, slot, data }).then((r) => r.data);
export const anonGet = (rid, ice_c_from = 0, ice_e_from = 0) =>
  client.post("/public/anon/get", { rid, ice_c_from, ice_e_from }).then((r) => r.data);
export const anonPoll = (rids) =>
  client.post("/public/anon/poll", { rids }).then((r) => r.data);
// `ghost`: se non viene passato si legge l'impostazione del telefono, così TUTTI i punti
// che registrano il token (login, impostazioni, cassette anonime) mandano il valore giusto
// senza doverlo sapere. Il server sceglie il canale Android in base a questo contrassegno.
export const registerPushToken = async (token, platform, ghost) => {
  let g = ghost;
  if (g === undefined) {
    try { g = await require("./ghost").isGhost(); } catch (e) { g = false; }
  }
  // FASCIA DI SILENZIO: lo scostamento dall'UTC lo dichiara il telefono, così il server
  // può tacere fra le 23:00 e le 07:00 ORA LOCALE senza sapere dove sei.
  const tz_offset = -new Date().getTimezoneOffset();
  return withAuth((a) => client.post("/public/pulse/push-token", { token, platform, ghost: !!g, tz_offset, quiet: true }, a).then((r) => r.data));
};
export const saveQuizReminder = (times, tzOffsetMin) =>
  withAuth((a) => client.post("/public/pulse/quiz-reminder", { times, tz_offset_min: tzOffsetMin }, a).then((r) => r.data));
export const disableQuizReminder = () =>
  withAuth((a) => client.post("/public/pulse/quiz-reminder/disable", {}, a).then((r) => r.data));
export const channelConcorsoReminder = (id, payload) =>
  withAuth((a) => client.post(`/public/pulse/channels/${id}/concorso-reminder`, payload, a).then((r) => r.data));
// BLOCCO A: alla chiave d'identità statica si sostituiscono, quando disponibili, le
// chiavi ML-KEM usa-e-getta dei dispositivi attivi del destinatario (forward secrecy).
// Nodi Sovrani della catena: punti tecnici che inoltrano traffico. Lettura pubblica.
export const sovereignNodes = () => client.get("/public/nodes").then((r) => r.data);

export const pulseKeys = async (lns_list) => {
  const stat = await withAuth((a) => client.post("/public/pulse/keys", { lns_list }, a).then((r) => r.data));
  try {
    const pre = await claimPrekeys(lns_list);
    for (const k of Object.keys(pre || {})) {
      if (Array.isArray(pre[k]) && pre[k].length) stat[k] = pre[k];
    }
  } catch { /* nessuna usa-e-getta: si resta sulla chiave statica */ }
  return stat;
};
export const pulseStaticKeys = (lns_list) =>
  withAuth((a) => client.post("/public/pulse/keys", { lns_list }, a).then((r) => r.data));

// ── Registro dispositivi, chiavi usa-e-getta e autodistruzione ──
export const registerDevice = (device_id, label, platform, caps) =>
  withAuth((a) => client.post("/public/pulse/devices/register", { device_id, label, platform, caps: caps || [] }, a).then((r) => r.data));
export const listDevices = () =>
  withAuth((a) => client.get("/public/pulse/devices", a).then((r) => r.data));
export const revokeDevice = (device_id) =>
  withAuth((a) => client.post("/public/pulse/devices/revoke", { device_id }, a).then((r) => r.data));

/// PONTE INTERNET. Il ticket lo chiede il telefono quando HA connessione e lo conserva:
/// autorizza SOLO la consegna a nome del proprio account (nessuna lettura, 7 giorni).
export const relayTicket = () =>
  withAuth((a) => client.post("/public/pulse/relay/ticket", {}, a).then((r) => r.data));
/// Consegna al server la busta chiusa di un altro nodo (nessuna sessione: vale il ticket).
export const relaySubmit = (ticket, to_lns, envelopes) =>
  client.post("/public/pulse/relay/submit", { ticket, to_lns, envelopes }).then((r) => r.data);

/// Controllo magazzino: si dichiarano gli ID delle usa-e-getta che questo telefono sa
/// aprire; il server cancella tutte le altre non consumate (chiavi orfane).
export const prekeysSync = (device_id, have) =>
  withAuth((a) => client.post("/public/pulse/prekeys/sync", { device_id, have }, a).then((r) => r.data));
export const uploadPrekeys = (device_id, keys) =>
  withAuth((a) => client.post("/public/pulse/prekeys/upload", { device_id, keys }, a).then((r) => r.data));
export const prekeysStatus = (device_id) =>
  withAuth((a) => client.get(`/public/pulse/prekeys/status?device_id=${encodeURIComponent(device_id)}`, a).then((r) => r.data));
export const claimPrekeys = (lns_list) =>
  withAuth((a) => client.post("/public/pulse/prekeys/claim", { lns_list }, a).then((r) => r.data));
// SVEGLIA SENZA GOOGLE: gettone di sveglia per il servizio in ascolto sul nostro server.
export const wakeRegister = (rid) =>
  withAuth((a) => client.post("/public/pulse/wake/register", { rid }, a).then((r) => r.data));
export const wakeRevoke = (rid) =>
  withAuth((a) => client.post("/public/pulse/wake/revoke", { rid }, a).then((r) => r.data));
export const panicArm = (token) =>
  withAuth((a) => client.post("/public/pulse/panic/arm", { token }, a).then((r) => r.data));
// ── CASSETTE POSTALI ANONIME: nessun token di sessione, per costruzione ──
export const mailboxCreate = (mailbox_id, secret_hash) =>
  client.post("/public/mailbox/create", { mailbox_id, secret_hash }).then((r) => r.data);
export const mailboxTickets = (mailbox_id, proof, ticket_hashes) =>
  client.post("/public/mailbox/tickets", { mailbox_id, proof, ticket_hashes }).then((r) => r.data);
export const mailboxDrop = (ticket, envelope) =>
  client.post("/public/mailbox/drop", { ticket, envelope }).then((r) => r.data);
export const mailboxPickup = (mailbox_id, proof) =>
  client.post("/public/mailbox/pickup", { mailbox_id, proof }).then((r) => r.data);
export const mailboxNotify = (mailbox_id, proof, token, platform) =>
  client.post("/public/mailbox/notify", { mailbox_id, proof, token, platform }).then((r) => r.data);
export const mailboxClose = (mailbox_id, proof) =>
  client.post("/public/mailbox/close", { mailbox_id, proof }).then((r) => r.data);

// Dichiarazione pubblica dei tempi di conservazione (usata nella schermata Sicurezza & Audit).
export const privacyRetention = () => client.get("/public/privacy/retention").then((r) => r.data);
// NB: nessuna sessione richiesta — vale il token di autodistruzione.
export const panicWipe = (token) =>
  client.post("/public/pulse/panic/wipe", { token }).then((r) => r.data);
// ── RUBRICA CIECA ──
// `contactsRaw` è la vecchia lettura dal server (serve solo alla migrazione una volta sola).
// `contacts()` unisce i colleghi d'azienda (che il server conosce per forza) con la rubrica
// CIFRATA SUL TELEFONO: gli indirizzi dei contatti personali non tornano più dal server.
export const contactsRaw = () =>
  withAuth((a) => client.get("/public/pulse/contacts", a).then((r) => r.data));
export const publishBlindContacts = (rids, blocked) =>
  withAuth((a) => client.post("/public/pulse/contacts/blind", { rids, blocked }, a).then((r) => r.data));
export const prunePlainContacts = (lns) =>
  withAuth((a) => client.post("/public/pulse/contacts/plain/prune", { lns }, a).then((r) => r.data));
export const dropPlainContacts = () =>
  withAuth((a) => client.delete("/public/pulse/contacts/plain", a).then((r) => r.data));
// Scritture sulla rubrica IN CHIARO del server: servono ancora verso chi non ha aggiornato
// l'app (senza il suo gettone la reciprocità si verifica solo così).
export const contactAddServer = (lns) =>
  withAuth((a) => client.post("/public/pulse/contacts/add", { lns }, a).then((r) => r.data));
export const contactRemoveServer = (lns) =>
  withAuth((a) => client.delete(`/public/pulse/contacts/${encodeURIComponent(lns)}`, a).then((r) => r.data));
export const blockServer = (lns, on) =>
  withAuth((a) => client.post("/public/pulse/block", { lns, on }, a).then((r) => r.data));

export const contacts = async () => {
  const book = require("./book");
  const server = await contactsRaw().catch(() => []);
  const rows = Array.isArray(server) ? server.slice() : [];
  const seen = new Set(rows.map((c) => String(c.lns || "").toLowerCase()));
  let local = [];
  try { local = await book.list(); } catch { local = []; }
  for (const e of local) {
    const lns = String(e.lns || "").toLowerCase();
    if (!lns) continue;
    if (seen.has(lns)) {
      // Il server lo conosce già (collega d'azienda): il nome locale ha la precedenza.
      const row = rows.find((c) => String(c.lns || "").toLowerCase() === lns);
      if (row && e.name) row.display_name = e.name;
      if (row) { row.blocked = !!e.blocked; row.favorite = !!e.favorite; }
      continue;
    }
    rows.push({
      lns, display_name: e.name || lns.split("@")[0], avatar: e.avatar || null,
      role: null, department: null, company_name: null,
      online: false, has_key: e.has_key !== false, same_company: false,
      favorite: !!e.favorite, blocked: !!e.blocked,
      // In rubrica cieca la reciprocità la conosce solo il gettone: qui si dà per buona,
      // e se manca è il server a rifiutare l'invio (con il suo messaggio).
      in_my_book: true, they_have_me: true, mutual: true, blind: true,
    });
  }
  rows.sort((a, b) => String(a.display_name || "").toLowerCase().localeCompare(String(b.display_name || "").toLowerCase()));
  return rows;
};
export const addContact = async (lns, info) => {
  const book = require("./book");
  await book.put(lns, Object.assign({ has_key: true }, info || {}));
  // Doppia scrittura durante il passaggio: in locale (rubrica cieca) e in chiaro sul server,
  // perché finché l'altro non ha i gettoni la reciprocità si verifica solo con l'indirizzo.
  // `sync` toglierà l'indirizzo appena il gettone dell'altro compare.
  try { await contactAddServer(lns); } catch { /* si riprova alla riconciliazione */ }
  book.syncSoon();
  return { ok: true, lns };
};
export const favoriteContact = async (lns, on) => {
  const book = require("./book");
  await book.setFavorite(lns, on);
  return { ok: true };
};
export const removeContact = async (lns) => {
  const book = require("./book");
  await book.remove(lns);
  try { await contactRemoveServer(lns); } catch { /* poteva già essere solo locale */ }
  book.syncSoon();
  return { ok: true };
};
export const blocksList = () =>
  withAuth((a) => client.get("/public/pulse/blocks", a).then((r) => r.data));
export const blockContact = async (lns, on) => {
  const book = require("./book");
  await book.setBlocked(lns, on);
  try { await blockServer(lns, on); } catch { /* vale comunque il blocco col gettone */ }
  book.syncSoon();
  return { ok: true };
};
export const consoleReports = (status) =>
  withAuth((a) => client.get("/public/console/reports", { params: { status: status || "open" }, ...a }).then((r) => r.data));
export const consoleReportStatus = (id, status) =>
  withAuth((a) => client.post(`/public/console/reports/${id}/status`, { status }, a).then((r) => r.data));
export const consoleReportDelete = (id) =>
  withAuth((a) => client.delete(`/public/console/reports/${id}`, a).then((r) => r.data));
export const consoleUserStatus = (lns, action, reason) =>
  withAuth((a) => client.post(`/public/console/users/${encodeURIComponent(lns)}/status`, { action, reason: reason || "" }, a).then((r) => r.data));
export const consoleUserBlock = (lns, on) =>
  withAuth((a) => client.post(`/public/console/users/${encodeURIComponent(lns)}/block`, { on: !!on }, a).then((r) => r.data));
export const consoleUserDelete = (lns) =>
  withAuth((a) => client.delete(`/public/console/users/${encodeURIComponent(lns)}`, a).then((r) => r.data));
// ── Gruppi pubblici: ricerca, richiesta di ingresso, uscita ──
export const groupsSearch = (q) =>
  withAuth((a) => client.get("/public/pulse/groups/search", { params: { q }, ...a }).then((r) => r.data));
export const hideContact = (lns, on) =>
  withAuth((a) => client.post("/public/pulse/contacts/hide", { lns, on: on !== false }, a).then((r) => r.data));
export const callAnswered = (call_id) =>
  withAuth((a) => client.post("/public/pulse/call/answered", { call_id }, a).then((r) => r.data));
export const callEnded = (call_id) =>
  withAuth((a) => client.post("/public/pulse/call/ended", { call_id }, a).then((r) => r.data));
export const groupJoinRequest = (id, message) =>
  withAuth((a) => client.post(`/public/pulse/channels/${encodeURIComponent(id)}/join-request`, { message: message || "" }, a).then((r) => r.data));
export const groupJoinRequests = (id) =>
  withAuth((a) => client.get(`/public/pulse/channels/${encodeURIComponent(id)}/join-requests`, a).then((r) => r.data));
export const groupJoinApprove = (id, lns, key_env, role) =>
  withAuth((a) => client.post(`/public/pulse/channels/${encodeURIComponent(id)}/join-requests/${encodeURIComponent(lns)}/approve`, { key_env, role: role || "member" }, a).then((r) => r.data));
export const groupJoinReject = (id, lns) =>
  withAuth((a) => client.post(`/public/pulse/channels/${encodeURIComponent(id)}/join-requests/${encodeURIComponent(lns)}/reject`, {}, a).then((r) => r.data));
export const groupLeave = (id) =>
  withAuth((a) => client.post(`/public/pulse/channels/${encodeURIComponent(id)}/leave`, {}, a).then((r) => r.data));
export const reportUser = (lns, reason, block) =>
  withAuth((a) => client.post("/public/pulse/report-user", { lns, reason: reason || "", block: !!block }, a).then((r) => r.data));

// ── Gestione membri/iscrizioni (solo admin/owner del tenant) ──
export const membersPermissions = () =>
  withAuth((a) => client.get("/public/members/permissions", a).then((r) => r.data));
export const membersList = () =>
  withAuth((a) => client.get("/public/members/list", a).then((r) => r.data));
export const membersCreate = (payload) =>
  withAuth((a) => client.post("/public/members/create", payload, a).then((r) => r.data));
export const membersRevoke = (lns_name, reactivate) =>
  withAuth((a) => client.post("/public/members/revoke", { lns_name, reactivate: !!reactivate }, a).then((r) => r.data));
export const convs = () =>
  withAuth((a) => client.get("/public/pulse/conversations", a).then((r) => r.data));
// Tutti i pallini in una sola risposta: {chat, certify}. Leggera per costruzione, così si
// può chiedere ogni secondo e mezzo senza far scaldare il telefono.
export const badges = () =>
  withAuth((a) => client.get("/public/pulse/badges", a).then((r) => r.data));
// Avviso di prova a me stesso: dice quali canali hanno risposto e in quanti millisecondi.
export const testNotify = () =>
  withAuth((a) => client.post("/public/pulse/test-notify", {}, a).then((r) => r.data));
// Butta dal server, per tutti, le buste che nessuno può più aprire.
export const purgeMessages = (conv_id, message_ids) =>
  withAuth((a) => client.post("/public/pulse/purge", { conv_id, message_ids }, a).then((r) => r.data));
// `limit` scarica solo gli ultimi N messaggi: senza limite arrivava TUTTA la cronologia ad
// ogni aggiornamento (93 messaggi = 1,4 MB ogni 4 secondi, ed era la vera lentezza).
export const messages = (conv_id, limit, before) =>
  withAuth((a) => client.get("/public/pulse/messages", { params: { conv_id, limit, before }, ...a }).then((r) => r.data));
export const pulseReact = (message_id, emoji) =>
  withAuth((a) => client.post("/public/pulse/react", { message_id, emoji }, a).then((r) => r.data));
export const pulseTyping = (conv_id) =>
  withAuth((a) => client.post("/public/pulse/typing", { conv_id }, a).then((r) => r.data));
export const pulseTypingGet = (conv_id) =>
  withAuth((a) => client.get("/public/pulse/typing", { params: { conv_id }, ...a }).then((r) => r.data));
export const presencePing = () =>
  withAuth((a) => client.post("/public/presence/ping", {}, a).then((r) => r.data));
export const send = (payload) =>
  withAuth((a) => client.post("/public/pulse/send", payload, a).then((r) => r.data));
export const deleteMessage = (message_id, scope) =>
  withAuth((a) => client.delete(`/public/pulse/messages/${encodeURIComponent(message_id)}`, { params: scope ? { scope } : {}, ...a }).then((r) => r.data));
export const editMessage = (message_id, envelopes) =>
  withAuth((a) => client.post("/public/pulse/message/edit", { message_id, envelopes }, a).then((r) => r.data));
export const pinMessage = (message_id, pin) =>
  withAuth((a) => client.post("/public/pulse/message/pin", { message_id, pin }, a).then((r) => r.data));
export const reportMessage = (message_id, reason) =>
  withAuth((a) => client.post("/public/pulse/message/report", { message_id, reason: reason || "" }, a).then((r) => r.data));
export const deleteConversation = (conv_id) =>
  withAuth((a) => client.delete(`/public/pulse/conversations/${encodeURIComponent(conv_id)}`, a).then((r) => r.data));

// ── Canali broadcast (E2EE chiave di gruppo) ──
// L'identità serve per decifrare il NOME dei gruppi privati (chiave di gruppo dentro una
// busta ML-KEM): la mette AuthContext dopo l'accesso.
let identity = null;
export const setIdentity = (u) => { identity = u || null; };

export const channels = () =>
  withAuth((a) => client.get("/public/pulse/channels", a).then((r) => require("./gname").openRows(r.data, identity)));
export const channelCreate = (payload) =>
  withAuth((a) => client.post("/public/pulse/channels", payload, a).then((r) => r.data));
export const channelDetail = (id) =>
  withAuth((a) => client.get(`/public/pulse/channels/${encodeURIComponent(id)}`, a).then((r) => require("./gname").openRow(r.data, identity)));
export const channelDelete = (id) =>
  withAuth((a) => client.delete(`/public/pulse/channels/${encodeURIComponent(id)}`, a).then((r) => r.data));
export const channelPost = (id, payload) =>
  withAuth((a) => client.post(`/public/pulse/channels/${encodeURIComponent(id)}/post`, payload, a).then((r) => r.data));
export const channelPosts = (id, after) =>
  withAuth((a) => client.get(`/public/pulse/channels/${encodeURIComponent(id)}/posts`, { params: after ? { after } : {}, ...a }).then((r) => r.data));
export const channelRead = (id) =>
  withAuth((a) => client.post(`/public/pulse/channels/${encodeURIComponent(id)}/read`, {}, a).then((r) => r.data));
export const channelReads = (id) =>
  withAuth((a) => client.get(`/public/pulse/channels/${encodeURIComponent(id)}/reads`, a).then((r) => r.data));
export const channelMembers = (id, skip = 0) =>
  withAuth((a) => client.get(`/public/pulse/channels/${encodeURIComponent(id)}/members`, { params: { skip }, ...a }).then((r) => r.data));
export const channelAddMembers = (id, members) =>
  withAuth((a) => client.post(`/public/pulse/channels/${encodeURIComponent(id)}/members`, { members }, a).then((r) => r.data));
export const channelRemoveMember = (id, lns) =>
  withAuth((a) => client.delete(`/public/pulse/channels/${encodeURIComponent(id)}/members/${encodeURIComponent(lns)}`, a).then((r) => r.data));
export const channelSetRole = (id, lns, role) =>
  withAuth((a) => client.post(`/public/pulse/channels/${encodeURIComponent(id)}/role`, { lns, role }, a).then((r) => r.data));
export const channelUpdate = (id, payload) =>
  withAuth((a) => client.post(`/public/pulse/channels/${encodeURIComponent(id)}/update`, payload, a).then((r) => r.data));

// ── Funzioni gruppo: sondaggi, reazioni, sotto-gruppi, moderazione ──
export const channelPolls = (id) =>
  withAuth((a) => client.get(`/public/pulse/channels/${encodeURIComponent(id)}/polls`, a).then((r) => r.data));
export const channelCreatePoll = (id, payload) =>
  withAuth((a) => client.post(`/public/pulse/channels/${encodeURIComponent(id)}/polls`, payload, a).then((r) => r.data));
export const channelUpdatePoll = (id, pid, payload) =>
  withAuth((a) => client.post(`/public/pulse/channels/${encodeURIComponent(id)}/polls/${encodeURIComponent(pid)}/update`, payload, a).then((r) => r.data));
export const channelVotePoll = (id, pid, option) =>
  withAuth((a) => client.post(`/public/pulse/channels/${encodeURIComponent(id)}/polls/${encodeURIComponent(pid)}/vote`, { option }, a).then((r) => r.data));
export const channelClosePoll = (id, pid) =>
  withAuth((a) => client.post(`/public/pulse/channels/${encodeURIComponent(id)}/polls/${encodeURIComponent(pid)}/close`, {}, a).then((r) => r.data));
export const channelDeletePoll = (id, pid) =>
  withAuth((a) => client.post(`/public/pulse/channels/${encodeURIComponent(id)}/polls/${encodeURIComponent(pid)}/delete`, {}, a).then((r) => r.data));
export const channelReactions = (id) =>
  withAuth((a) => client.get(`/public/pulse/channels/${encodeURIComponent(id)}/reactions`, a).then((r) => r.data));
export const channelPollLike = (id, pid) =>
  withAuth((a) => client.post(`/public/pulse/channels/${encodeURIComponent(id)}/polls/${encodeURIComponent(pid)}/like`, {}, a).then((r) => r.data));
export const channelPollLikes = (id) =>
  withAuth((a) => client.get(`/public/pulse/channels/${encodeURIComponent(id)}/poll-likes`, a).then((r) => r.data));
export const channelPostLike = (id, pid) =>
  withAuth((a) => client.post(`/public/pulse/channels/${encodeURIComponent(id)}/posts/${encodeURIComponent(pid)}/like`, {}, a).then((r) => r.data));
export const channelPostLikes = (id) =>
  withAuth((a) => client.get(`/public/pulse/channels/${encodeURIComponent(id)}/post-likes`, a).then((r) => r.data));
export const shareCreate = (payload) =>
  withAuth((a) => client.post(`/public/pulse/share`, payload, a).then((r) => r.data));
export const channelReact = (id, pid, emoji) =>
  withAuth((a) => client.post(`/public/pulse/channels/${encodeURIComponent(id)}/posts/${encodeURIComponent(pid)}/react`, { emoji }, a).then((r) => r.data));
export const channelDeletePost = (id, pid) =>
  withAuth((a) => client.post(`/public/pulse/channels/${encodeURIComponent(id)}/posts/${encodeURIComponent(pid)}/delete`, {}, a).then((r) => r.data));
export const channelEditPost = (id, pid, payload) =>
  withAuth((a) => client.post(`/public/pulse/channels/${encodeURIComponent(id)}/posts/${encodeURIComponent(pid)}/edit`, payload, a).then((r) => r.data));
export const channelPinPost = (id, pid) =>
  withAuth((a) => client.post(`/public/pulse/channels/${encodeURIComponent(id)}/posts/${encodeURIComponent(pid)}/pin`, {}, a).then((r) => r.data));
export const channelQuizReset = (id) =>
  withAuth((a) => client.post(`/public/pulse/channels/${encodeURIComponent(id)}/quiz/reset`, {}, a).then((r) => r.data));
export const channelReportPost = (id, pid, reason) =>
  withAuth((a) => client.post(`/public/pulse/channels/${encodeURIComponent(id)}/posts/${encodeURIComponent(pid)}/report`, { reason }, a).then((r) => r.data));
export const channelTopics = (id) =>
  withAuth((a) => client.get(`/public/pulse/channels/${encodeURIComponent(id)}/topics`, a).then((r) => r.data));
export const channelCreateTopic = (id, name) =>
  withAuth((a) => client.post(`/public/pulse/channels/${encodeURIComponent(id)}/topics`, { name }, a).then((r) => r.data));
export const channelDeleteTopic = (id, tid) =>
  withAuth((a) => client.post(`/public/pulse/channels/${encodeURIComponent(id)}/topics/${encodeURIComponent(tid)}/delete`, {}, a).then((r) => r.data));
export const channelReorderTopics = (id, order) =>
  withAuth((a) => client.post(`/public/pulse/channels/${encodeURIComponent(id)}/topics/reorder`, { order }, a).then((r) => r.data));
// Anteprima Sicura Link: metadati OG estratti lato server (SSRF-safe). Solo per link "sicuri".
export const linkPreview = (url) =>
  withAuth((a) => client.get(`/public/pulse/link-preview`, { params: { url }, ...a }).then((r) => r.data));

// ── E2EE blob storage (chunked upload of opaque ciphertext) ──
const BLOB_CHUNK = 3 * 1024 * 1024; // 3MB
export const blobUpload = (ciphertext, onProgress, allowed) =>
  withAuth(async (a) => {
    const { upload_id } = (await client.post("/public/blob/init", {}, { ...a, timeout: 30000 })).data;
    const total = Math.max(1, Math.ceil(ciphertext.length / BLOB_CHUNK));
    for (let i = 0; i < total; i++) {
      const chunk = ciphertext.subarray(i * BLOB_CHUNK, (i + 1) * BLOB_CHUNK);
      const body = chunk.slice().buffer;
      await client.post("/public/blob/chunk", body, {
        params: { upload_id, index: i },
        headers: { ...a.headers, "Content-Type": "application/octet-stream" },
        timeout: 120000,
        onUploadProgress: (e) => {
          const inner = e && e.total ? e.loaded / e.total : 1;
          onProgress?.(Math.min(1, (i + inner) / total));
        },
      });
      onProgress?.((i + 1) / total);
    }
    return (await client.post("/public/blob/finalize", { upload_id, allowed: allowed || [] }, { ...a, timeout: 60000 })).data;
  });
// ── logout: revoca la sessione lato server (SEC-002) ──
export const logout = () =>
  withAuth((a) => client.post("/public/logout", {}, a).then((r) => r.data)).catch(() => {});

// ── Caricamento granulare: serve agli allegati a pezzi (lib/bigatt.js) ──
// Ogni pezzo del file cifrato diventa un pezzo del blob: il telefono non tiene mai in
// memoria più di 4 MB, e il server continua a vedere soltanto byte opachi.
export const blobInit = () =>
  withAuth((a) => client.post("/public/blob/init", {}, { ...a, timeout: 30000 }).then((r) => r.data));
export const blobPutChunk = (upload_id, index, bytes) =>
  withAuth((a) => client.post("/public/blob/chunk", bytes.slice().buffer, {
    params: { upload_id, index },
    headers: { ...a.headers, "Content-Type": "application/octet-stream" },
    timeout: 300000,
  }).then((r) => r.data));
export const blobFinalize = (upload_id, allowed) =>
  withAuth((a) => client.post("/public/blob/finalize", { upload_id, allowed: allowed || [] }, { ...a, timeout: 120000 }).then((r) => r.data));
// Indirizzo diretto del blob: lo scarico di un allegato grande va su FILE, non in memoria.
export const blobUrl = (id) => `${_base}/api/public/blob/${encodeURIComponent(id)}`;
export const authHeaders = async () => ({ Authorization: `Bearer ${await ensureSession()}` });

export const blobDownload = (id) =>
  withAuth(async (a) => {
    const r = await client.get(`/public/blob/${encodeURIComponent(id)}`, { responseType: "arraybuffer", timeout: 120000, ...a });
    return new Uint8Array(r.data);
  });
export const markRead = (conv_id) =>
  withAuth((a) => client.post("/public/pulse/read", { conv_id }, a).then((r) => r.data));
export const myProfile = () =>
  withAuth((a) => client.get("/public/pulse/profile", a).then((r) => r.data));
export const saveProfile = (payload) =>
  withAuth((a) => client.post("/public/pulse/profile", payload, a).then((r) => r.data));
export const hubFeed = () =>
  withAuth((a) => client.get("/public/pulse/hub", a).then((r) => r.data));
export const hubCreate = (payload) =>
  withAuth((a) => client.post("/public/pulse/hub", payload, a).then((r) => r.data));
export const hubLike = (id) =>
  withAuth((a) => client.post(`/public/pulse/hub/${id}/like`, {}, a).then((r) => r.data));
export const hubReply = (id, text) =>
  withAuth((a) => client.post(`/public/pulse/hub/${id}/reply`, { text }, a).then((r) => r.data));
export const hubDelete = (id) =>
  withAuth((a) => client.delete(`/public/pulse/hub/${id}`, a).then((r) => r.data));
export const jobsList = () =>
  withAuth((a) => client.get("/public/pulse/jobs", a).then((r) => r.data));
export const jobCreate = (payload) =>
  withAuth((a) => client.post("/public/pulse/jobs", payload, a).then((r) => r.data));
export const jobDelete = (id) =>
  withAuth((a) => client.delete(`/public/pulse/jobs/${id}`, a).then((r) => r.data));
export const networkLive = () => client.get("/public/network/live").then((r) => r.data);
export const trialStatus = () =>
  withAuth((a) => client.get("/public/trial/status", a).then((r) => r.data));

// ── Certify (certified E2EE mail) ──
export const certifyInbox = (box = "inbox") =>
  withAuth((a) => client.get("/public/certify/inbox", { params: { box }, ...a }).then((r) => r.data));
export const certifyMessage = (mail_id) =>
  withAuth((a) => client.get("/public/certify/message", { params: { mail_id }, ...a }).then((r) => r.data));
export const certifyRead = (mail_id) =>
  withAuth((a) => client.post("/public/certify/read", { mail_id }, a).then((r) => r.data));
export const certifyTrash = (mail_id) =>
  withAuth((a) => client.post("/public/certify/trash", { mail_id }, a).then((r) => r.data));
export const certifyRestore = (mail_id) =>
  withAuth((a) => client.post("/public/certify/restore", { mail_id }, a).then((r) => r.data));
export const certifyDelete = (mail_id) =>
  withAuth((a) => client.post("/public/certify/delete", { mail_id }, a).then((r) => r.data));
export const certifyReceipt = (mail_id) =>
  withAuth((a) => client.get("/public/certify/receipt", { params: { mail_id }, ...a }).then((r) => r.data));
export const certifySend = (payload) =>
  withAuth((a) => client.post("/public/certify/send", payload, a).then((r) => r.data));
export const certifyStats = () =>
  withAuth((a) => client.get("/public/certify/stats", a).then((r) => r.data));
export const certifyContacts = () =>
  withAuth((a) => client.get("/public/certify/contacts", a).then((r) => r.data));
// ── Account personali (username@lattice.lns) ──
export const personalCheck = (username) =>
  client.get("/public/personal/check", { params: { username } }).then((r) => r.data);
export const personalSignup = (payload) =>
  client.post("/public/personal/signup", payload).then((r) => r.data);
export const personalDiscoverable = (enabled) =>
  withAuth((a) => client.post("/public/personal/discoverable", { enabled }, a).then((r) => r.data));
export const directorySearch = (q) =>
  withAuth((a) => client.get("/public/directory/search", { params: { q }, ...a }).then((r) => r.data));

export const directoryResolve = (lns_list) =>
  withAuth((a) => client.post("/public/directory/resolve", { lns_list }, a).then((r) => r.data));
// Traduzione on-device sovrana (LibreTranslate self-hosted, nessuna chiave a pagamento).
export const translate = (text, target = "it", source = "auto") =>
  withAuth((a) => client.post("/public/translate", { text, target, source }, a).then((r) => r.data));

// ── Stato/Storie E2EE 24h ──
export const statusAudience = () =>
  withAuth((a) => client.get("/public/pulse/status-audience", a).then((r) => r.data));
export const statusList = () =>
  withAuth((a) => client.get("/public/pulse/status", a).then((r) => r.data));
export const statusCreate = (payload) =>
  withAuth((a) => client.post("/public/pulse/status", payload, a).then((r) => r.data));
export const statusDelete = (id) =>
  withAuth((a) => client.delete(`/public/pulse/status/${encodeURIComponent(id)}`, a).then((r) => r.data));

// ── Chiamate WebRTC verificabili (signaling REST) ──
export const callOffer = (payload) =>
  withAuth((a) => client.post("/public/pulse/call/offer", payload, a).then((r) => r.data));
export const callAnswer = (payload) =>
  withAuth((a) => client.post("/public/pulse/call/answer", payload, a).then((r) => r.data));
export const callIce = (payload) =>
  withAuth((a) => client.post("/public/pulse/call/ice", payload, a).then((r) => r.data));
export const callGet = (id) =>
  withAuth((a) => client.get(`/public/pulse/call/${encodeURIComponent(id)}`, a).then((r) => r.data));
export const callHangup = (call_id) =>
  withAuth((a) => client.post("/public/pulse/call/hangup", { call_id }, a).then((r) => r.data));
export const callIncoming = () =>
  withAuth((a) => client.get("/public/pulse/call/incoming", a).then((r) => r.data));
export const callLog = () =>
  withAuth((a) => client.get("/public/pulse/call/log", a).then((r) => r.data));
export const callRing = (payload) =>
  withAuth((a) => client.post("/public/pulse/call/ring", payload, a).then((r) => r.data));
// Conferma al server che il telefono ha GIÀ mostrato lo squillo (nessuna sessione: in
// background non c'è token) → il server salta la notifica di sistema di fallback.
export const callRingShown = (call_id) =>
  client.post("/public/pulse/call/ring-shown", { call_id }).then((r) => r.data);
export const callReject = (call_id) =>
  withAuth((a) => client.post("/public/pulse/call/reject", { call_id }, a).then((r) => r.data));
export const callMissed = () =>
  withAuth((a) => client.get("/public/pulse/call/missed", a).then((r) => r.data));
export const callSeen = () =>
  withAuth((a) => client.post("/public/pulse/call/seen", {}, a).then((r) => r.data));

// ── Reazioni Stato ──
export const statusReact = (id, emoji) =>
  withAuth((a) => client.post(`/public/pulse/status/${encodeURIComponent(id)}/react`, { emoji }, a).then((r) => r.data));
// ── Visto da (read receipts dello Stato) ──
export const statusSeen = (id) =>
  withAuth((a) => client.post(`/public/pulse/status/${encodeURIComponent(id)}/seen`, {}, a).then((r) => r.data));

// ── Chiamate di gruppo (mesh) ──
export const gcallStart = (chan_id, video) =>
  withAuth((a) => client.post("/public/pulse/gcall/start", { chan_id, video }, a).then((r) => r.data));
export const gcallJoin = (room_id) =>
  withAuth((a) => client.post("/public/pulse/gcall/join", { room_id }, a).then((r) => r.data));
export const gcallLeave = (room_id) =>
  withAuth((a) => client.post("/public/pulse/gcall/leave", { room_id }, a).then((r) => r.data));
export const gcallActive = (chan_id) =>
  withAuth((a) => client.get(`/public/pulse/gcall/active/${encodeURIComponent(chan_id)}`, a).then((r) => r.data));
export const gcallRoom = (room_id) =>
  withAuth((a) => client.get(`/public/pulse/gcall/room/${encodeURIComponent(room_id)}`, a).then((r) => r.data));
export const gcallSignal = (payload) =>
  withAuth((a) => client.post("/public/pulse/gcall/signal", payload, a).then((r) => r.data));
export const gcallIce = (payload) =>
  withAuth((a) => client.post("/public/pulse/gcall/ice", payload, a).then((r) => r.data));
export const gcallSignals = (room_id) =>
  withAuth((a) => client.get(`/public/pulse/gcall/signals/${encodeURIComponent(room_id)}`, a).then((r) => r.data));
// Drafts
export const certifyDrafts = () =>
  withAuth((a) => client.get("/public/certify/drafts", a).then((r) => r.data));
export const certifySaveDraft = (payload) =>
  withAuth((a) => client.post("/public/certify/drafts", payload, a).then((r) => r.data));
export const certifyDelDraft = (draft_id) =>
  withAuth((a) => client.delete(`/public/certify/drafts/${encodeURIComponent(draft_id)}`, a).then((r) => r.data));
// Scheduled
export const certifySchedule = (payload) =>
  withAuth((a) => client.post("/public/certify/schedule", payload, a).then((r) => r.data));
export const certifyScheduled = () =>
  withAuth((a) => client.get("/public/certify/scheduled", a).then((r) => r.data));
export const certifyCancelScheduled = (scheduled_id) =>
  withAuth((a) => client.delete(`/public/certify/scheduled/${encodeURIComponent(scheduled_id)}`, a).then((r) => r.data));
// Calendar notes
export const certifyNotes = () =>
  withAuth((a) => client.get("/public/certify/notes", a).then((r) => r.data));
export const certifyAddNote = (payload) =>
  withAuth((a) => client.post("/public/certify/notes", payload, a).then((r) => r.data));
export const certifyDelNote = (note_id) =>
  withAuth((a) => client.delete(`/public/certify/notes/${encodeURIComponent(note_id)}`, a).then((r) => r.data));
// GDPR
export const accountExport = () =>
  withAuth((a) => client.get("/public/account/export", a).then((r) => r.data));
export const accountDelete = () =>
  withAuth((a) => client.post("/public/account/delete", {}, a).then((r) => r.data));
export const recordConsent = (payload) =>
  withAuth((a) => client.post("/public/account/consent", payload, a).then((r) => r.data));

// Console admin (owner-only): richieste (leads) + statistiche.
export const consoleLeads = () =>
  withAuth((a) => client.get("/public/console/leads", a).then((r) => r.data));
export const consoleStats = () =>
  withAuth((a) => client.get("/public/console/stats", a).then((r) => r.data));
export const consoleLeadRead = (id) =>
  withAuth((a) => client.post(`/public/console/leads/${encodeURIComponent(id)}/read`, {}, a).then((r) => r.data));
export const consoleLeadDelete = (id) =>
  withAuth((a) => client.delete(`/public/console/leads/${encodeURIComponent(id)}`, a).then((r) => r.data));
export const consoleLeadManage = (id, managed) =>
  withAuth((a) => client.post(`/public/console/leads/${encodeURIComponent(id)}/manage`, { managed }, a).then((r) => r.data));
// Aziende + stato licenze (owner-only) — per la vista in-app "Licenze / Scadenze".
export const consoleTenants = () =>
  withAuth((a) => client.get("/public/console/tenants", a).then((r) => r.data));
// Attiva/rinnova licenza OSPITATA per un'azienda (owner-only). duration_months: 0=perpetua.
export const consoleActivateLicense = ({ tenant_id, pkg, duration_months, hosted = true }) =>
  withAuth((a) => client.post("/public/console/activate-license", { tenant_id, package: pkg, duration_months, hosted }, a).then((r) => r.data));
// Estende (rinnova) una licenza a termine esistente di N mesi (owner-only).
export const consoleRenewLicense = ({ tenant_id, months }) =>
  withAuth((a) => client.post("/public/console/renew-license", { tenant_id, months }, a).then((r) => r.data));

export function apiErr(e) {
  return e?.response?.data?.detail || e?.response?.data?.error || e?.message || "Errore di rete";
}
export function normalizeLns(v) {
  const s = (v || "").trim().toLowerCase();
  const at = s.indexOf("@");
  if (at <= 0 || at === s.length - 1) return s;
  const local = s.slice(0, at);
  const token = s.slice(at + 1).split(".")[0];
  if (!token) return s;
  return `${local}@${token}.lns`;
}

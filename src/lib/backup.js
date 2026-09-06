// BACKUP CIFRATO LOCALE — il file non passa MAI dal server: viene creato sul telefono,
// cifrato con AES-256-GCM (chiave da scrypt) e consegnato al sistema (Condividi/Salva) così
// lo metti dove vuoi tu. Nessun upload, nessuna copia in cloud fatta dall'app.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import * as Notifications from "expo-notifications";
import { scrypt } from "@noble/hashes/scrypt.js";
import { gcm } from "@noble/ciphers/aes.js";
import {
  bytesToHex, hexToBytes, randomHex, bytesToBase64, base64ToBytes,
  unpackMessage, decryptFileBytes,
} from "./crypto";
import * as api from "./api";
import * as store from "./store";
import { getBlob, setBlob } from "./lock";
import { decryptAny } from "./devices";
import * as mbx from "./mailbox";

export const FMT = "lattice-backup-1";
const KDF = { N: 1 << 14, r: 8, p: 1 };
const ARC_BLOB = "arc";
const K_LAST = "lat.bkp.last";
const K_EVERY = "lat.bkp.every"; // "off" | "weekly" | "monthly"
const MAX_FILE = 8 * 1024 * 1024;
const MAX_TOTAL = 120 * 1024 * 1024;
const RESTORED_DIR = "lattice-ripristinati/";

function enc8(str) {
  const out = [];
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff) {
      const c2 = s.charCodeAt(++i);
      const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
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
    else if (c < 0xf0) codes.push(((c & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    else {
      const cp = ((c & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      const v = cp - 0x10000;
      codes.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    }
  }
  let s = "";
  for (let j = 0; j < codes.length; j += 8192) s += String.fromCharCode.apply(null, codes.slice(j, j + 8192));
  return s;
}

// ── Contenuto del backup ──
export async function buildPayload({ user, includeAtts = false, onStep } = {}) {
  const step = (s) => { try { onStep && onStep(s); } catch { /* */ } };
  const counts = { convs: 0, msgs: 0, files: 0, prefs: 0, bytes: 0, skippedEphemeral: 0 };

  step("Chiavi e impostazioni");
  const keyfile = await store.loadKeyfile();
  const prefs = {};
  try {
    const keys = await AsyncStorage.getAllKeys();
    const wanted = keys.filter((k) => !k.startsWith("lat.enc.") && k !== "lattice.pulse.keyfile.v1");
    const pairs = await AsyncStorage.multiGet(wanted);
    for (const [k, v] of pairs) if (v != null) prefs[k] = v;
    counts.prefs = Object.keys(prefs).length;
  } catch { /* */ }
  const mbxHistory = await getBlob("mbx");
  const archivePrev = (await getBlob(ARC_BLOB)) || {};

  let contacts = [];
  const convs = [];
  const files = [];
  if (user && user.lns) {
    step("Rubrica");
    try { contacts = await api.contacts(); } catch { /* */ }
    step("Conversazioni");
    let list = [];
    try { list = await api.convs(); } catch { /* */ }
    for (const c of Array.isArray(list) ? list : []) {
      step("Conversazione: " + (c.title || c.title_lns || c.conv_id));
      let raw = [];
      try { raw = await api.messages(c.conv_id); } catch { continue; }
      const msgs = [];
      for (const m of Array.isArray(raw) ? raw : []) {
        let body = "";
        let atts = [];
        if (m.envelope && user.kem) {
          const pt = await decryptAny(m, user);
          if (pt == null) continue;
          const u = unpackMessage(pt);
          // Messaggi a scomparsa: NON entrano nel backup. Se devono svanire, svaniscono
          // anche qui: un backup non può diventare la scappatoia dell'autodistruzione.
          if ((u.ttl || 0) > 0) { counts.skippedEphemeral++; continue; }
          body = u.text || "";
          atts = u.atts || [];
        }
        if (typeof body === "string" && body.startsWith(mbx.CTL_PREFIX)) continue;
        const names = [];
        for (const a of atts) {
          names.push({ name: a.name || "allegato", mime: a.mime || "" });
          if (!includeAtts) continue;
          if (counts.bytes > MAX_TOTAL) continue;
          try {
            const ct = await api.blobDownload(a.id);
            if (ct.length > MAX_FILE) continue;
            const bytes = decryptFileBytes(ct, a.key, a.iv);
            files.push({ id: a.id, name: a.name || a.id, mime: a.mime || "application/octet-stream", b64: bytesToBase64(bytes) });
            counts.files++;
            counts.bytes += bytes.length;
          } catch { /* allegato non più sul server */ }
        }
        msgs.push({ id: m.message_id, mine: !!m.mine, body, atts: names, at: m.sent_at || m.created_at });
        counts.msgs++;
      }
      // I messaggi anonimi (cassetta) e quelli già archiviati vivono solo sul telefono:
      // vanno nel backup, altrimenti si perdono per sempre.
      try {
        const anon = await mbx.localForConv(c.conv_id);
        for (const a of anon) { msgs.push({ id: a.id, mine: a.mine, body: a.body, atts: [], at: a.at, anon: true }); counts.msgs++; }
      } catch { /* */ }
      const prev = archivePrev[c.conv_id] || [];
      const have = new Set(msgs.map((m) => m.id));
      for (const p of prev) if (!have.has(p.id)) { msgs.push(p); counts.msgs++; }
      msgs.sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
      convs.push({ conv_id: c.conv_id, title: c.title || c.title_lns || "", title_lns: c.title_lns || "", msgs });
      counts.convs++;
    }
  }

  return {
    payload: {
      v: 1, at: new Date().toISOString(), lns: (user && user.lns) || (keyfile && keyfile.lns) || "",
      keyfile: keyfile || null, prefs, mbx: mbxHistory || null, contacts, convs, files,
    },
    counts,
  };
}

// ── Container cifrato ──
export function encryptContainer(payload, password, hint) {
  const salt = randomHex(16);
  const key = scrypt(enc8(password), hexToBytes(salt), { N: KDF.N, r: KDF.r, p: KDF.p, dkLen: 32 });
  const iv = randomHex(12);
  const ct = gcm(key, hexToBytes(iv)).encrypt(enc8(JSON.stringify(payload)));
  return {
    fmt: FMT, at: payload.at, lns: payload.lns, hint: hint || "password",
    kdf: { alg: "scrypt", N: KDF.N, r: KDF.r, p: KDF.p, salt },
    iv, ct: bytesToBase64(ct),
  };
}

export function decryptContainer(container, password) {
  if (!container || container.fmt !== FMT) throw new Error("Questo file non è un backup Lattice.");
  const k = container.kdf || {};
  const key = scrypt(enc8(password), hexToBytes(k.salt || ""), { N: k.N || KDF.N, r: k.r || KDF.r, p: k.p || KDF.p, dkLen: 32 });
  let pt;
  try {
    pt = gcm(key, hexToBytes(container.iv)).decrypt(base64ToBytes(container.ct));
  } catch {
    throw new Error("Password errata (oppure il file è danneggiato).");
  }
  return JSON.parse(dec8(pt));
}

function fileName(lns, at) {
  const d = String(at || new Date().toISOString()).slice(0, 16).replace(/[:T]/g, "-");
  const who = String(lns || "lattice").split("@")[0].replace(/[^a-zA-Z0-9._-]/g, "");
  return `lattice-backup-${who}-${d}.lattice`;
}

export async function exportBackup({ user, includeAtts, password, hint, onStep } = {}) {
  if (!password || String(password).length < 4) throw new Error("Serve una password (o il PIN) per cifrare il backup.");
  const { payload, counts } = await buildPayload({ user, includeAtts, onStep });
  onStep && onStep("Cifratura del file");
  const container = encryptContainer(payload, String(password), hint);
  const name = fileName(payload.lns, payload.at);
  const uri = FileSystem.documentDirectory + name;
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(container));
  const info = await FileSystem.getInfoAsync(uri);
  await AsyncStorage.setItem(K_LAST, payload.at);
  onStep && onStep("Pronto: scegli dove salvarlo");
  try {
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: "application/octet-stream", dialogTitle: "Salva il backup cifrato" });
    }
  } catch { /* l'utente può recuperarlo dalla cartella dell'app */ }
  return { uri, name, size: (info && info.size) || 0, counts };
}

export async function pickBackupFile() {
  const r = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true, multiple: false });
  if (r.canceled) return null;
  const asset = r.assets && r.assets[0];
  if (!asset) return null;
  const txt = await FileSystem.readAsStringAsync(asset.uri);
  let container;
  try { container = JSON.parse(txt); } catch { throw new Error("File illeggibile: non è un backup Lattice."); }
  if (container.fmt !== FMT) throw new Error("Questo file non è un backup Lattice.");
  return { container, name: asset.name || "backup" };
}

// ── Ripristino ──
export async function restorePayload(payload) {
  const report = { prefs: 0, convs: 0, msgs: 0, files: 0, keyfile: false, mbx: false };
  if (!payload || payload.v !== 1) throw new Error("Versione del backup non supportata.");
  if (payload.prefs) {
    const pairs = Object.entries(payload.prefs).filter(([k]) => k !== K_LAST);
    if (pairs.length) { try { await AsyncStorage.multiSet(pairs); report.prefs = pairs.length; } catch { /* */ } }
  }
  if (payload.mbx) { try { await setBlob("mbx", payload.mbx); report.mbx = true; } catch { /* */ } }
  if (Array.isArray(payload.convs) && payload.convs.length) {
    const arc = (await getBlob(ARC_BLOB)) || {};
    for (const c of payload.convs) {
      const prev = arc[c.conv_id] || [];
      const have = new Set(prev.map((m) => m.id));
      const merged = prev.concat((c.msgs || []).filter((m) => !have.has(m.id)));
      merged.sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
      arc[c.conv_id] = merged;
      report.convs++;
      report.msgs += (c.msgs || []).length;
    }
    await setBlob(ARC_BLOB, arc);
  }
  if (Array.isArray(payload.files) && payload.files.length) {
    const dir = FileSystem.documentDirectory + RESTORED_DIR;
    try { await FileSystem.makeDirectoryAsync(dir, { intermediates: true }); } catch { /* già presente */ }
    for (const f of payload.files) {
      try {
        await FileSystem.writeAsStringAsync(dir + safeName(f.name || f.id), f.b64, { encoding: FileSystem.EncodingType.Base64 });
        report.files++;
      } catch { /* */ }
    }
  }
  if (payload.keyfile) { await store.saveKeyfile(payload.keyfile); report.keyfile = true; }
  return report;
}

function safeName(n) {
  return String(n).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

export async function restoredFiles() {
  try {
    const dir = FileSystem.documentDirectory + RESTORED_DIR;
    const names = await FileSystem.readDirectoryAsync(dir);
    return names.map((n) => ({ name: n, uri: dir + n }));
  } catch { return []; }
}

export async function shareRestoredFile(uri) {
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
}

/// Messaggi dell'archivio (ripristinati da un backup) per una conversazione.
export async function archiveForConv(cid) {
  const arc = await getBlob(ARC_BLOB);
  const list = (arc && arc[cid]) || [];
  return list.map((m) => ({
    id: m.id, mine: !!m.mine,
    body: (m.body || "") + ((m.atts || []).length ? "\n📎 " + m.atts.map((a) => a.name).join(", ") : ""),
    atts: [], reply: null, signed: null, reactions: [], ttl: 0, at: m.at,
    delivered: true, read: true, edited: false, pinned: false, archived: true,
  }));
}

export async function clearArchive() {
  await setBlob(ARC_BLOB, {});
}

// ── Promemoria (solo locale: il server non sa nulla dei tuoi backup) ──
export async function lastBackupAt() {
  return await AsyncStorage.getItem(K_LAST);
}
export async function getSchedule() {
  return (await AsyncStorage.getItem(K_EVERY)) || "off";
}
export async function setSchedule(mode) {
  await AsyncStorage.setItem(K_EVERY, mode);
  try {
    const sched = await Notifications.getAllScheduledNotificationsAsync();
    for (const s of sched) {
      if (s && s.content && s.content.data && s.content.data.kind === "backup_reminder") {
        await Notifications.cancelScheduledNotificationAsync(s.identifier);
      }
    }
  } catch { /* */ }
  if (mode === "off") return true;
  const seconds = mode === "monthly" ? 30 * 86400 : 7 * 86400;
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Backup Lattice",
        body: "Promemoria: crea un backup cifrato aggiornato delle tue chat.",
        data: { kind: "backup_reminder" },
      },
      trigger: { type: "timeInterval", seconds, repeats: true },
    });
  } catch { /* notifiche non concesse */ }
  return true;
}

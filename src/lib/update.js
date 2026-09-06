// Aggiornamento in-app VERIFICATO: legge /downloads/latest.json, controlla che il manifest
// sia firmato dal produttore (ML-DSA-65), scarica l'APK e ne verifica l'impronta SHA-256
// prima di passarlo all'installer. Se il server viene bucato e l'APK sostituito, la firma o
// l'impronta non tornano e l'installazione NON parte. Rifiutati anche i "downgrade".
import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { Linking, Platform } from "react-native";
import { loadServer } from "./store";
import { DEFAULT_SERVER } from "../config";
import { verifyManifest, fileSha256 } from "./apkVerify";

const cur = () => String(Constants.expoConfig?.version || "0.0.0");

const cmp = (a, b) => {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
};

async function base() {
  const s = (await loadServer()) || DEFAULT_SERVER;
  return String(s).replace(/\/+$/, "");
}

// { available, version, current, url, notes, verified, untrusted, manifest }
export async function checkUpdate() {
  const b = await base();
  const r = await fetch(b + "/downloads/latest.json?t=" + Date.now());
  if (!r.ok) throw new Error("HTTP " + r.status);
  const d = await r.json();
  const version = String(d.versionName || d.version || "");
  const url = d.url && /^https?:/.test(d.url) ? d.url : b + "/downloads/lattice-pulse.apk";
  const manifest = { ...d, versionName: version, url };
  const verified = verifyManifest(manifest);
  const newer = !!version && cmp(version, cur()) > 0;
  return {
    available: newer && verified,
    untrusted: newer && !verified,
    verified,
    version,
    current: cur(),
    url,
    notes: Array.isArray(d.notes) ? d.notes : [],
    manifest,
  };
}

// Scarica l'APK, ne verifica firma e impronta, poi apre l'installazione in sovrascrittura.
// `info` è il risultato di checkUpdate (accetta anche una semplice URL, ma in quel caso
// rifiuta: senza manifest firmato non installiamo nulla).
// onProgress(p 0..1, fase: "download" | "verify")
export async function downloadAndInstall(info, onProgress) {
  if (typeof info === "string") info = await checkUpdate();
  const m = info && info.manifest;
  if (!m || !verifyManifest(m)) throw new Error("Firma del manifest non valida: aggiornamento rifiutato.");
  if (cmp(m.versionName, cur()) <= 0) throw new Error("Versione non più recente: aggiornamento rifiutato.");
  const url = m.url;
  if (Platform.OS !== "android") { await Linking.openURL(url); return; }

  const dest = FileSystem.cacheDirectory + "lattice-update.apk";
  try { await FileSystem.deleteAsync(dest, { idempotent: true }); } catch { /* nuovo file */ }
  const task = FileSystem.createDownloadResumable(url, dest, {}, (p) => {
    if (onProgress && p.totalBytesExpectedToWrite > 0) {
      onProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite, "download");
    }
  });
  const res = await task.downloadAsync();
  if (!res || !res.uri) throw new Error("Download non completato");

  const info2 = await FileSystem.getInfoAsync(res.uri, { size: true });
  const size = (info2 && info2.size) || 0;
  if (!info2.exists || size < 5 * 1024 * 1024) throw new Error("Download incompleto: riprova");
  if (m.size && size !== m.size) {
    try { await FileSystem.deleteAsync(res.uri, { idempotent: true }); } catch { /* */ }
    throw new Error("Il file scaricato non corrisponde al manifest firmato: installazione annullata.");
  }

  const sha = await fileSha256(res.uri, size, (p) => { if (onProgress) onProgress(p, "verify"); });
  if (String(m.sha256 || "").toLowerCase() !== sha.toLowerCase()) {
    try { await FileSystem.deleteAsync(res.uri, { idempotent: true }); } catch { /* */ }
    throw new Error("Impronta dell'APK diversa da quella firmata: file rifiutato e cancellato.");
  }

  const contentUri = await FileSystem.getContentUriAsync(res.uri);
  const opts = { data: contentUri, flags: 1, type: "application/vnd.android.package-archive" };
  try {
    await IntentLauncher.startActivityAsync("android.intent.action.INSTALL_PACKAGE", opts);
  } catch {
    // ACTION_INSTALL_PACKAGE è deprecata da API 29: proviamo VIEW.
    await IntentLauncher.startActivityAsync("android.intent.action.VIEW", opts);
  }
}

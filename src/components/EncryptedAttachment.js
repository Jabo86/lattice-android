import React, { useState, useEffect, useRef } from "react";
import { View, Text, Image, TouchableOpacity, ActivityIndicator, Alert, StyleSheet, Modal, Pressable } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
// SDK 57: le funzioni `saveToLibraryAsync`/`createAssetAsync` importate da
// "expo-media-library" sono deprecate e LANCIANO un errore invece di salvare (è il motivo
// per cui la galleria rifiutava ogni foto). La via valida è "expo-media-library/legacy".
import * as MediaLibrary from "expo-media-library/legacy";
import { Asset as MLAsset } from "expo-media-library";
import * as Sharing from "expo-sharing";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as api from "../lib/api";
import { decryptFileBytes, bytesToBase64 } from "../lib/crypto";
import * as bigatt from "../lib/bigatt";
import { analyzeAttachment } from "../lib/threatEngine";
import ThreatBanner from "./ThreatBanner";
import VoiceNote from "./VoiceNote";
import { useI18n } from "../lib/i18n";
import { Ionicons } from "@expo/vector-icons";
import { theme, avatarColor } from "../theme";

// Un allegato E2EE: scarica il cifrato opaco, lo decifra sul telefono e lo scrive UNA volta
// nella cache privata dell'app. Da lì in poi non si riscarica e non si ri-decifra più:
// prima ogni comparsa a schermo rifaceva download + decifratura + una stringa base64 da
// megabyte dentro <Image>, ed era uno dei motivi per cui l'app arrancava.
const scans = new Map(); // att.id -> esito della scansione antivirus/euristica
const DIR_KEY = "lat.savedir";   // cartella scelta dall'utente per i salvataggi
let savedDir = null;

function report(where, e) {
  try {
    fetch(api.getServerUrl() + "/api/public/crash", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ v: "save", android: where, trace: String((e && (e.message || e.code)) || e).slice(0, 500) }),
    }).catch(() => {});
  } catch (x) { /* */ }
}

const EXT = {
  "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png", "image/webp": ".webp",
  "image/gif": ".gif", "image/heic": ".heic", "video/mp4": ".mp4", "video/quicktime": ".mov",
  "audio/mp4": ".m4a", "audio/m4a": ".m4a", "audio/mpeg": ".mp3", "application/pdf": ".pdf",
};

function fileNameFor(att) {
  const mime = String(att?.mime || "");
  const wanted = EXT[mime] || (mime.startsWith("image/") ? ".jpg" : mime.startsWith("video/") ? ".mp4" : mime.startsWith("audio/") ? ".m4a" : "");
  let base = String(att?.name || "").replace(/[^\w.\-]/g, "_");
  if (!base) base = "lattice_" + String(att?.id || Date.now());
  if (wanted && !base.toLowerCase().endsWith(wanted)) base = base.replace(/\.[^.]*$/, "") + wanted;
  return base;
}

export default function EncryptedAttachment({ att }) {
  const { lang } = useI18n();
  const en = lang === "en";
  const isImage = (att?.mime || "").startsWith("image/");
  const isVideo = (att?.mime || "").startsWith("video/");
  const isAudio = (att?.mime || "").startsWith("audio/") || att?.kind === "voice";
  const [uri, setUri] = useState("");        // file:// nella cache privata dell'app
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [threat, setThreat] = useState(scans.get(att?.id) || null);
  const [full, setFull] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    (async () => {
      try {
        const path = FileSystem.cacheDirectory + "att_" + String(att.id) + "_" + fileNameFor(att);
        const info = await FileSystem.getInfoAsync(path);
        if (info?.exists && info.size > 0) {
          if (!alive.current) return;
          setUri(path); setReady(true);
          if (scans.has(att.id)) setThreat(scans.get(att.id));
          return;
        }
        // Allegato a pezzi (v2): si scarica il cifrato su file e si decifra 4 MB alla
        // volta scrivendo direttamente nella cache. La scansione euristica guarda il primo
        // pezzo: riconosce un eseguibile travestito senza tenere in memoria il file intero.
        if (bigatt.isChunked(att)) {
          const first = await bigatt.decryptToFile(att, path);
          const scan2 = analyzeAttachment({ name: att.name, mime: att.mime, bytes: first }, lang);
          scans.set(att.id, scan2);
          if (!alive.current) return;
          setThreat(scan2);
          setUri(path);
          setReady(true);
          return;
        }
        const ct = await api.blobDownload(att.id);
        const bytes = decryptFileBytes(ct, att.key, att.iv);
        const scan = analyzeAttachment({ name: att.name, mime: att.mime, bytes }, lang);
        scans.set(att.id, scan);
        await FileSystem.writeAsStringAsync(path, bytesToBase64(bytes), { encoding: FileSystem.EncodingType.Base64 });
        if (!alive.current) return;
        setThreat(scan);
        setUri(path);
        setReady(true);
      } catch {
        if (alive.current) setFailed(true);
      }
    })();
    return () => { alive.current = false; };
  }, [att?.id]);

  const danger = threat?.level === "danger";

  const doSave = async () => {
    setSaving(true);
    try {
      // Su Android 13+ il permesso di SOLA SCRITTURA è quello giusto. UNA sola richiesta:
      // due di fila lasciavano Android con "You have an unfinished permission request" e
      // anche il ripiego sulla cartella si rompeva.
      let perm = await MediaLibrary.getPermissionsAsync(true);
      if (!perm?.granted) perm = await MediaLibrary.requestPermissionsAsync(true);
      if (!perm?.granted) {
        report("perm", "granted=false");
        Alert.alert(
          en ? "Gallery permission denied" : "Permesso galleria negato",
          en ? "Save it in a folder of your phone instead (e.g. Download)." : "Salvalo in una cartella del telefono (per esempio Download).",
          [{ text: en ? "Cancel" : "Annulla", style: "cancel" }, { text: en ? "Choose folder" : "Scegli cartella", onPress: doFolder }]
        );
        return;
      }
      try {
        await MediaLibrary.saveToLibraryAsync(uri);
      } catch (e1) {
        report("saveToLibrary", e1);
        try {
          // Seconda via classica.
          await MediaLibrary.createAssetAsync(uri);
        } catch (e2) {
          report("createAssetLegacy", e2);
          // Terza via: API nuova a classi della SDK 57.
          await MLAsset.create(uri);
        }
      }
      Alert.alert(en ? "Saved" : "Salvato", en ? "Saved to your gallery." : "Salvato nella galleria del telefono.");
    } catch (e) {
      report("createAsset", e);
      Alert.alert(
        en ? "Gallery refused" : "La galleria ha rifiutato",
        String((e && e.message) || e) + (en ? "\n\nSave it in a folder instead." : "\n\nSalvalo in una cartella del telefono."),
        [{ text: en ? "Cancel" : "Annulla", style: "cancel" }, { text: en ? "Share" : "Condividi", onPress: doShare }, { text: en ? "Choose folder" : "Scegli cartella", onPress: doFolder }]
      );
    } finally { setSaving(false); }
  };

  // Salvataggio in una cartella del telefono (es. Download): funziona anche quando la
  // galleria di sistema nega il permesso. La cartella si sceglie una volta e resta.
  const doFolder = async () => {
    setSaving(true);
    try {
      const SAF = FileSystem.StorageAccessFramework;
      if (!SAF) throw new Error("non disponibile su questo telefono");
      if (!savedDir) savedDir = await AsyncStorage.getItem(DIR_KEY);
      if (savedDir) {
        try { await SAF.readDirectoryAsync(savedDir); } catch { savedDir = null; }
      }
      if (!savedDir) {
        // "You have an unfinished permission request": se una richiesta di permesso è
        // ancora aperta, si aspetta un attimo e si riprova una volta.
        let perm;
        try {
          perm = await SAF.requestDirectoryPermissionsAsync();
        } catch (e0) {
          await new Promise((r) => setTimeout(r, 600));
          perm = await SAF.requestDirectoryPermissionsAsync();
        }
        if (!perm?.granted) return;
        savedDir = perm.directoryUri;
        await AsyncStorage.setItem(DIR_KEY, savedDir);
      }
      const name = fileNameFor(att);
      const target = await SAF.createFileAsync(savedDir, name.replace(/\.[^.]*$/, ""), att.mime || "application/octet-stream");
      if (bigatt.isChunked(att)) {
        await bigatt.copyToUriChunked(uri, target);
      } else {
        const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        await FileSystem.writeAsStringAsync(target, b64, { encoding: FileSystem.EncodingType.Base64 });
      }
      Alert.alert(en ? "Saved" : "Salvato", (en ? "Saved as " : "Salvato come ") + name);
    } catch (e) {
      report("folder", e);
      Alert.alert(en ? "Could not save" : "Non riesco a salvare", String((e && e.message) || e));
    } finally { setSaving(false); }
  };

  const doShare = async () => {
    try {
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: att.mime || "application/octet-stream" });
    } catch { /* niente da fare */ }
  };

  const guard = (fn) => {
    if (!ready) return;
    if (!danger) { fn(); return; }
    Alert.alert(
      en ? "⚠️ Dangerous file blocked" : "⚠️ File pericoloso bloccato",
      (threat.reasons.join("\n• ")) + (en
        ? "\n\nLattice blocked this file for your safety. Open only if you are 100% sure."
        : "\n\nLattice ha bloccato questo file per la tua sicurezza. Aprilo solo se sei sicuro al 100%."),
      [
        { text: en ? "Keep me safe" : "Proteggimi", style: "cancel" },
        { text: en ? "Open anyway (at my own risk)" : "Apri comunque (a mio rischio)", style: "destructive", onPress: fn },
      ]
    );
  };

  const save = () => guard(doSave);
  const openFull = () => guard(() => setFull(true));
  const openExternal = () => guard(doShare);

  if (failed) return <Text style={st.failed} testID="attachment-failed">📎 {att.name} · {en ? "decryption failed" : "decifratura fallita"}</Text>;

  if (isAudio) {
    return (
      <View>
        {ready && !danger ? <VoiceNote uri={uri} duration={att.duration} /> : (
          <View style={st.audioLoading} testID="attachment-audio-loading"><ActivityIndicator color={theme.primary} /></View>
        )}
        <ThreatBanner result={threat} lang={lang} />
      </View>
    );
  }

  if (isVideo) {
    // ANTEPRIMA DEI VIDEO: prima c'era una riga grigia con un'icona. Ora si vede un
    // riquadro sfocato (macchie di colore ricavate dall'identificativo dell'allegato, quindi
    // sempre le stesse per quel video) con il tasto play sopra: la chat non si sposta quando
    // il video è pronto e si capisce a colpo d'occhio che c'è un filmato. Nessun fotogramma
    // viene estratto: il contenuto resta cifrato finché non lo apri tu.
    const c1 = avatarColor(String(att?.id || "v"));
    const c2 = avatarColor(String(att?.id || "v") + "·2");
    return (
      <View>
        <TouchableOpacity activeOpacity={0.9} onPress={openExternal} disabled={!ready} style={st.vidTile} testID="attachment-video">
          <View style={[st.vidBlob1, { backgroundColor: c1 }]} />
          <View style={[st.vidBlob2, { backgroundColor: c2 }]} />
          <View style={st.vidVeil} />
          <View style={st.vidPlay} testID="attachment-video-play">
            <Ionicons name={danger ? "alert" : "play"} size={26} color="#fff" />
          </View>
          {!ready && <View style={st.vidSpin}><ActivityIndicator color="#fff" /></View>}
          <View style={st.vidFoot}>
            <Text style={st.videoName} numberOfLines={1}>{att.name}</Text>
            <Text style={st.videoMeta}>
              {danger
                ? (en ? "Blocked video" : "Video bloccato")
                : ready
                  ? (en ? "E2EE video · tap to play" : "Video cifrato E2EE · tocca per aprire")
                  : (en ? "Decrypting…" : "Decifro…")}
            </Text>
          </View>
        </TouchableOpacity>
        <View style={[st.imgBar, st.vidBar]}>
          <TouchableOpacity onPress={openExternal} disabled={!ready} style={st.imgBarBtn} testID="attachment-video-open">
            <Text style={st.saveText}>{danger ? "⚠" : "▶︎"}  {en ? "Play" : "Apri"}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={save} disabled={!ready || saving} style={st.imgBarBtn} testID="attachment-video-save">
            <Text style={st.saveText}>{saving ? "…" : "⬇"}  {en ? "Gallery" : "Galleria"}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => guard(doFolder)} disabled={!ready || saving} style={st.imgBarBtn} testID="attachment-video-folder">
            <Text style={st.saveText}>📁  {en ? "Folder" : "Cartella"}</Text>
          </TouchableOpacity>
        </View>
        <ThreatBanner result={threat} lang={lang} />
      </View>
    );
  }

  if (isImage) {
    return (
      <View>
        <View style={st.imgWrap} testID="attachment-image">
          {danger ? (
            <View style={[st.loading, st.blocked]}>
              <Text style={st.blockedIcon}>🚫</Text>
              <Text style={st.blockedText}>{en ? "Blocked image" : "Immagine bloccata"}</Text>
            </View>
          ) : uri ? (
            <TouchableOpacity activeOpacity={0.9} onPress={openFull} testID="attachment-image-open">
              <Image source={{ uri }} style={st.img} resizeMode="cover" />
            </TouchableOpacity>
          ) : (
            // Anteprima sfocata da ~500 byte, arrivata dentro il messaggio cifrato: si vede
            // ISTANTE ZERO, mentre la foto vera si scarica e si decifra. Stesso spazio, così
            // la lista non si sposta quando la foto arriva.
            att?.prev ? (
              <View style={st.imgWrap}>
                <Image source={{ uri: att.prev }} style={st.img} resizeMode="cover" blurRadius={6} />
                <View style={st.previewSpinner}><ActivityIndicator color="#fff" /></View>
              </View>
            ) : (
              <View style={st.loading}><ActivityIndicator color={theme.primary} /></View>
            )
          )}
          <View style={st.imgBar}>
            <TouchableOpacity onPress={openFull} disabled={!ready} style={st.imgBarBtn} testID="attachment-view">
              <Text style={st.saveText}>{danger ? (en ? "⚠ Blocked" : "⚠ Bloccato") : (en ? "⤢  View" : "⤢  Apri")}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={save} disabled={!ready || saving} style={st.imgBarBtn} testID="attachment-save">
              <Text style={st.saveText}>{saving ? (en ? "Saving…" : "Salvataggio…") : (en ? "⬇  Gallery" : "⬇  Galleria")}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => guard(doFolder)} disabled={!ready || saving} style={st.imgBarBtn} testID="attachment-folder">
              <Text style={st.saveText}>{en ? "📁  Folder" : "📁  Cartella"}</Text>
            </TouchableOpacity>
          </View>
        </View>
        <ThreatBanner result={threat} lang={lang} />

        <Modal visible={full} transparent animationType="fade" onRequestClose={() => setFull(false)}>
          <View style={st.fullWrap}>
            <Pressable style={st.fullTap} onPress={() => setFull(false)} testID="attachment-full-close">
              <Image source={{ uri }} style={st.fullImg} resizeMode="contain" />
            </Pressable>
            <View style={st.fullBar}>
              <TouchableOpacity onPress={() => setFull(false)} style={st.fullBtn}><Text style={st.fullBtnTxt}>{en ? "Close" : "Chiudi"}</Text></TouchableOpacity>
              <TouchableOpacity onPress={doShare} style={st.fullBtn} testID="attachment-full-share"><Text style={st.fullBtnTxt}>{en ? "Share" : "Condividi"}</Text></TouchableOpacity>
              <TouchableOpacity onPress={doFolder} style={st.fullBtn} testID="attachment-full-folder"><Text style={st.fullBtnTxt}>{en ? "Folder" : "Cartella"}</Text></TouchableOpacity>
              <TouchableOpacity onPress={doSave} style={[st.fullBtn, st.fullBtnMain]} testID="attachment-full-save"><Text style={st.fullBtnTxt}>{saving ? "…" : (en ? "Save" : "Salva")}</Text></TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  return (
    <View>
      <TouchableOpacity onPress={save} disabled={!ready || saving} style={[st.fileBtn, danger && st.fileBtnDanger]} testID="attachment-file">
        <Text style={st.fileText}>{danger ? "🚫" : "📎"} {att.name}   {saving ? "…" : (danger ? "⚠" : "⬇")}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => guard(doFolder)} disabled={!ready || saving} style={st.fileBtn} testID="attachment-file-folder">
        <Text style={st.fileText}>📁 {en ? "Save in a folder" : "Salva in una cartella"}</Text>
      </TouchableOpacity>
      <ThreatBanner result={threat} lang={lang} />
    </View>
  );
}

const st = StyleSheet.create({
  imgWrap: { marginTop: 6, borderRadius: 12, overflow: "hidden", backgroundColor: "rgba(0,0,0,0.25)" },
  img: { width: 210, height: 210 },
  loading: { width: 210, height: 210, alignItems: "center", justifyContent: "center" },
  previewSpinner: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  imgBar: { flexDirection: "row", backgroundColor: "rgba(0,0,0,0.35)" },
  imgBarBtn: { flex: 1, paddingVertical: 8, alignItems: "center" },
  saveText: { color: "#DCE7FF", fontSize: 12, fontWeight: "700" },
  fileBtn: { marginTop: 6, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.25)" },
  fileText: { color: "#DCE7FF", fontSize: 13, fontWeight: "600" },
  failed: { color: "#FFB3BD", fontSize: 12, marginTop: 5 },
  blocked: { backgroundColor: "rgba(255,77,94,0.15)" },
  blockedIcon: { fontSize: 34 },
  blockedText: { color: "#FF4D5E", fontSize: 12, fontWeight: "800", marginTop: 4 },
  fileBtnDanger: { backgroundColor: "rgba(255,77,94,0.18)", borderWidth: 1, borderColor: "#FF4D5E" },
  vidTile: { marginTop: 6, width: 240, height: 150, borderRadius: 14, overflow: "hidden", backgroundColor: "#0B1220", justifyContent: "flex-end" },
  vidBlob1: { position: "absolute", width: 210, height: 210, borderRadius: 105, top: -70, left: -50, opacity: 0.5 },
  vidBlob2: { position: "absolute", width: 190, height: 190, borderRadius: 95, bottom: -80, right: -40, opacity: 0.45 },
  vidVeil: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(5,8,15,0.34)" },
  vidPlay: { position: "absolute", top: 42, left: 96, width: 50, height: 50, borderRadius: 25, backgroundColor: "rgba(0,0,0,0.42)", borderWidth: 1, borderColor: "rgba(255,255,255,0.4)", alignItems: "center", justifyContent: "center" },
  vidSpin: { position: "absolute", top: 10, right: 10 },
  vidFoot: { paddingHorizontal: 10, paddingVertical: 8, backgroundColor: "rgba(0,0,0,0.38)" },
  vidBar: { width: 240, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, overflow: "hidden" },
  videoCard: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6, padding: 10, borderRadius: 12, backgroundColor: "rgba(0,0,0,0.28)", width: 240 },
  videoIcon: { fontSize: 26 },
  videoName: { color: "#EAF1FF", fontSize: 13, fontWeight: "700" },
  videoMeta: { color: "#9fb8e6", fontSize: 11, marginTop: 2 },
  videoBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)" },
  videoBtnTxt: { color: "#fff", fontSize: 15, fontWeight: "800" },
  audioLoading: { marginTop: 6, minWidth: 210, height: 40, justifyContent: "center" },
  fullWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.96)" },
  fullTap: { flex: 1, alignItems: "center", justifyContent: "center" },
  fullImg: { width: "100%", height: "100%" },
  fullBar: { flexDirection: "row", gap: 10, padding: 16, paddingBottom: 32, justifyContent: "center" },
  fullBtn: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.14)" },
  fullBtnMain: { backgroundColor: theme.primary },
  fullBtnTxt: { color: "#fff", fontSize: 14, fontWeight: "800" },
});

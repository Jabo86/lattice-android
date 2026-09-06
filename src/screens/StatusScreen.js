import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../lib/i18n";
import * as api from "../lib/api";
import { suppressLock } from "../lib/lockGuard";
import {
  generateGroupKey, wrapGroupKeyFor, unwrapGroupKey, encryptWithGroupKey, decryptWithGroupKey,
  bytesToHex, base64ToBytes, bytesToBase64, encryptFileBytes, decryptFileBytes,
} from "../lib/crypto";
import { theme } from "../theme";

// Stato/Storie E2EE 24h — visibili a contatti + membri dei gruppi. Cifrate con chiave di gruppo
// casuale, wrappata ML-KEM-768 per ogni destinatario. Scadenza automatica lato server (24h).
export default function StatusScreen({ navigation }) {
  const { user } = useAuth();
  const { lang } = useI18n();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState("");
  const [img, setImg] = useState(null); // {uri, base64, mime}
  const [busy, setBusy] = useState(false);
  const [imgCache, setImgCache] = useState({}); // status_id -> data uri

  const load = useCallback(async () => {
    try {
      const raw = await api.statusList();
      const out = [];
      for (const s of Array.isArray(raw) ? raw : []) {
        let body = { t: "", img: null };
        try {
          const wrap = s.mine ? s.wrap : s.wrap;
          if (wrap && user?.kem) {
            const gk = unwrapGroupKey(wrap, user.kem.secretKey);
            const pt = decryptWithGroupKey(s.iv, s.ct, gk);
            if (pt) body = JSON.parse(pt);
          }
        } catch {}
        out.push({ ...s, body });
      }
      setItems(out);
      // Segna come "visto" gli stati altrui (read receipts per l'autore).
      out.filter((s) => !s.mine).forEach((s) => { api.statusSeen(s.status_id).catch(() => {}); });
    } catch {}
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const loadImg = useCallback(async (s) => {
    if (imgCache[s.status_id] || !s.body?.img) return;
    try {
      const bytes = await api.blobDownload(s.body.img.id);
      const dec = decryptFileBytes(bytes, s.body.img.key, s.body.img.iv);
      setImgCache((m) => ({ ...m, [s.status_id]: `data:${s.body.img.mime || "image/jpeg"};base64,${bytesToBase64(dec)}` }));
    } catch {}
  }, [imgCache]);

  useEffect(() => { items.forEach((s) => { if (s.body?.img) loadImg(s); }); }, [items, loadImg]);

  const pickImg = async () => {
    suppressLock();
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.6, base64: true });
    if (!r.canceled && r.assets?.[0]?.base64) setImg({ base64: r.assets[0].base64, uri: r.assets[0].uri, mime: r.assets[0].mimeType || "image/jpeg" });
  };

  const publish = async () => {
    if ((!text.trim() && !img) || !user?.kem) return;
    setBusy(true);
    try {
      const audience = await api.statusAudience();
      const gk = generateGroupKey();
      const payload = { t: text.trim(), img: null };
      if (img) {
        const bytes = base64ToBytes(img.base64);
        const enc = encryptFileBytes(bytes);
        const { id } = await api.blobUpload(enc.ciphertext);
        payload.img = { id, key: enc.key, iv: enc.iv, mime: img.mime };
      }
      const { iv, ct } = encryptWithGroupKey(JSON.stringify(payload), gk);
      const wraps = [];
      const myHex = bytesToHex(user.kem.publicKey);
      wraps.push({ for: user.lns, ...wrapGroupKeyFor(gk, myHex) });
      for (const a of Array.isArray(audience) ? audience : []) {
        if (a.lns && a.kem_pk && a.lns !== user.lns) { try { wraps.push({ for: a.lns, ...wrapGroupKeyFor(gk, a.kem_pk) }); } catch {} }
      }
      await api.statusCreate({ ct, iv, wraps, has_image: !!payload.img });
      setText(""); setImg(null); setComposing(false);
      await load();
    } catch (e) { Alert.alert("Stato", api.apiErr(e)); }
    finally { setBusy(false); }
  };

  const del = (s) => Alert.alert(lang === "en" ? "Delete status" : "Elimina stato", "", [
    { text: lang === "en" ? "Cancel" : "Annulla", style: "cancel" },
    { text: lang === "en" ? "Delete" : "Elimina", style: "destructive", onPress: async () => { try { await api.statusDelete(s.status_id); await load(); } catch {} } },
  ]);

  const ago = (iso) => { const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000)); return s < 60 ? `${s}m` : `${Math.floor(s / 60)}h`; };
  const react = async (s, emoji) => {
    const next = s.my_reaction === emoji ? "" : emoji;
    setItems((arr) => arr.map((x) => x.status_id === s.status_id ? { ...x, my_reaction: next } : x));
    try { await api.statusReact(s.status_id, next); if (s.mine) await load(); } catch {}
  };
  const summarize = (arr) => { const m = {}; (arr || []).forEach((r) => { m[r.emoji] = (m[r.emoji] || 0) + 1; }); return Object.entries(m).map(([e, c]) => `${e} ${c}`).join("   "); };
  const EMOJIS = ["👍", "❤️", "😮", "🎉"];

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} testID="status-back"><Ionicons name="chevron-back-outline" size={26} color={theme.text} /></TouchableOpacity>
        <Text style={styles.title}>{lang === "en" ? "Status" : "Stato"}</Text>
        <TouchableOpacity onPress={() => setComposing((v) => !v)} hitSlop={10} testID="status-compose-toggle"><Ionicons name={composing ? "close" : "add-circle"} size={26} color={theme.primary} /></TouchableOpacity>
      </View>

      {composing && (
        <View style={styles.composer} testID="status-composer">
          <TextInput style={styles.input} placeholder={lang === "en" ? "Share an update (24h)…" : "Condividi un aggiornamento (24h)…"} placeholderTextColor={theme.textFaint}
            value={text} onChangeText={setText} multiline selectionColor={theme.primary} testID="status-input" />
          {img && <Image source={{ uri: img.uri }} style={styles.preview} />}
          <View style={styles.composerRow}>
            <TouchableOpacity onPress={pickImg} style={styles.imgBtn} testID="status-pick-img"><Ionicons name="image-outline" size={20} color={theme.primary} /></TouchableOpacity>
            <TouchableOpacity onPress={publish} disabled={busy} style={styles.pubBtn} testID="status-publish">
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.pubTxt}>{lang === "en" ? "Publish" : "Pubblica"}</Text>}
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>🔒 {lang === "en" ? "E2EE · visible to contacts and group members · auto-deletes in 24h" : "Cifrato E2EE · visibile a contatti e membri dei gruppi · si elimina in 24h"}</Text>
        </View>
      )}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>
          {items.length === 0 && <Text style={styles.empty}>{lang === "en" ? "No status yet." : "Nessuno stato al momento."}</Text>}
          {items.map((s) => (
            <View key={s.status_id} style={styles.card} testID="status-card">
              <View style={styles.cardHead}>
                <View style={styles.dot} />
                <Text style={styles.author}>{s.mine ? (lang === "en" ? "You" : "Tu") : (s.author || "").split("@")[0]}</Text>
                <Text style={styles.time}>{ago(s.created_at)}</Text>
                {s.mine && <TouchableOpacity onPress={() => del(s)} hitSlop={8} testID="status-delete"><Ionicons name="trash-outline" size={16} color={theme.textDim} /></TouchableOpacity>}
              </View>
              {!!s.body?.t && <Text style={styles.body}>{s.body.t}</Text>}
              {s.body?.img && (imgCache[s.status_id]
                ? <Image source={{ uri: imgCache[s.status_id] }} style={styles.cardImg} resizeMode="cover" />
                : <View style={[styles.cardImg, styles.imgLoad]}><ActivityIndicator color={theme.primary} /></View>)}
              <View style={styles.reactBar}>
                {EMOJIS.map((e) => (
                  <TouchableOpacity key={e} onPress={() => react(s, e)} style={[styles.reactBtn, s.my_reaction === e && styles.reactOn]} testID="status-react"><Text style={{ fontSize: 17 }}>{e}</Text></TouchableOpacity>
                ))}
              </View>
              {s.mine && Array.isArray(s.reactions) && s.reactions.length > 0 && (
                <View style={styles.reactSummary}><Ionicons name="eye-outline" size={12} color={theme.textDim} /><Text style={styles.reactSummaryTxt}>{summarize(s.reactions)}</Text></View>
              )}
              {s.mine && (
                <View style={styles.seenBar} testID="status-seen-by">
                  <Ionicons name="eye-outline" size={13} color={theme.primary} />
                  <Text style={styles.seenTxt}>
                    {s.views_count > 0
                      ? `${lang === "en" ? "Seen by" : "Visto da"} ${s.views_count}${(Array.isArray(s.views) && s.views.length) ? ": " + s.views.map((v) => (v.by || "").split("@")[0]).slice(0, 6).join(", ") + (s.views.length > 6 ? "…" : "") : ""}`
                      : (lang === "en" ? "No views yet" : "Ancora nessuna visualizzazione")}
                  </Text>
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border },
  title: { color: theme.text, fontSize: 20, fontWeight: "800" },
  composer: { padding: 14, borderBottomWidth: 1, borderBottomColor: theme.border, backgroundColor: theme.surface },
  input: { backgroundColor: theme.surfaceAlt, borderRadius: 12, color: theme.text, paddingHorizontal: 14, paddingVertical: 10, minHeight: 60, maxHeight: 140, fontSize: 15, textAlignVertical: "top" },
  preview: { width: "100%", height: 160, borderRadius: 12, marginTop: 10 },
  composerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10 },
  imgBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.surfaceAlt, alignItems: "center", justifyContent: "center" },
  pubBtn: { flex: 1, backgroundColor: theme.primary, borderRadius: 22, paddingVertical: 12, alignItems: "center" },
  pubTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },
  hint: { color: theme.accent, fontSize: 11, marginTop: 8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { color: theme.textDim, textAlign: "center", marginTop: 40 },
  card: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 14, padding: 14, marginBottom: 12 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.primary },
  author: { color: theme.text, fontSize: 14, fontWeight: "800", flex: 1 },
  time: { color: theme.textDim, fontSize: 12 },
  body: { color: theme.text, fontSize: 15, lineHeight: 21, marginTop: 8 },
  cardImg: { width: "100%", height: 220, borderRadius: 12, marginTop: 10, backgroundColor: theme.surfaceAlt },
  imgLoad: { alignItems: "center", justifyContent: "center" },
  reactBar: { flexDirection: "row", gap: 8, marginTop: 12 },
  reactBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.surfaceAlt, alignItems: "center", justifyContent: "center" },
  reactOn: { backgroundColor: theme.primary + "44", borderWidth: 1, borderColor: theme.primary },
  reactSummary: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  reactSummaryTxt: { color: theme.textDim, fontSize: 13 },
  seenBar: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.border },
  seenTxt: { color: theme.textDim, fontSize: 12, flex: 1, fontWeight: "600" },
});

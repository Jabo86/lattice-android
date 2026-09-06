import React, { useState, useEffect, useCallback, useRef } from "react";
import { AppState,
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput,
  ActivityIndicator, Modal, Alert, Image, ScrollView, Pressable, Switch, Linking, Share,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useHeaderHeight } from "@react-navigation/elements";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../lib/i18n";
import * as api from "../lib/api";
import { theme } from "../theme";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { loadAutoTranslate, loadTranslateTarget } from "../lib/store";
import { detectLang, langFlag } from "../lib/detectLang";
import SafeText from "../components/SafeText";
import LinkPreview from "../components/LinkPreview";
import ThreatBanner from "../components/ThreatBanner";
import EncryptedAttachment from "../components/EncryptedAttachment";
import { analyzeMessage } from "../lib/threatEngine";
import * as ImagePicker from "expo-image-picker";
import { prepareImage } from "../lib/media";
import { pickAvatarDataUrl } from "../lib/avatar";
import { suppressLock } from "../lib/lockGuard";
import {
  unwrapGroupKey, encryptWithGroupKey, decryptWithGroupKey, wrapGroupKeyFor,
  packMessage, unpackMessage, base64ToBytes, bytesToBase64, encryptFileBytes, decryptFileBytes,
} from "../lib/crypto";
import * as DocumentPicker from "expo-document-picker";
import * as bigatt from "../lib/bigatt";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { exportConversation } from "../lib/legalExport";

const EMOJI = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

// Marker (identici al Web) per messaggi strutturati dentro le bolle E2EE.
const CAMBIO_PREFIX = "\uE0FFCAMBIO\uE0FF";
const CONCORSO_PREFIX = "\uE0FFCONCORSO\uE0FF";
const REGIONI = ["Abruzzo", "Basilicata", "Calabria", "Campania", "Emilia-Romagna", "Friuli-Venezia Giulia", "Lazio", "Liguria", "Lombardia", "Marche", "Molise", "Piemonte", "Puglia", "Sardegna", "Sicilia", "Toscana", "Trentino-Alto Adige", "Umbria", "Valle d'Aosta", "Veneto"];

function daysUntil(dstr) {
  if (!dstr) return null;
  const d = new Date(String(dstr) + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86400000);
}
function scadBadge(dstr, lang) {
  const du = daysUntil(dstr);
  if (du === null) return null;
  if (du < 0) return { bg: "#7a1f27", txt: lang === "en" ? "Expired" : "Scaduto" };
  if (du === 0) return { bg: "#a13208", txt: lang === "en" ? "Ends today" : "Scade oggi" };
  const label = (lang === "en" ? "Ends in " : "Scade tra ") + du + (lang === "en" ? " days" : (du === 1 ? " giorno" : " giorni"));
  return { bg: du <= 7 ? "#a15a08" : "#0b3a66", txt: label };
}
async function openPdf(pdf, lang) {
  try {
    if (!pdf) return;
    let b64;
    if (pdf.data) {
      b64 = String(pdf.data).replace(/^data:[^,]*,/, "");
    } else if (pdf.ref) {
      const ct = await api.blobDownload(pdf.ref.id);
      const bytes = decryptFileBytes(ct, pdf.ref.key, pdf.ref.iv);
      b64 = bytesToBase64(bytes);
    } else return;
    const uri = FileSystem.cacheDirectory + (pdf.name || "bando.pdf").replace(/[^\w.\-]/g, "_");
    await FileSystem.writeAsStringAsync(uri, b64, { encoding: FileSystem.EncodingType.Base64 });
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: pdf.mime || "application/pdf" });
    else Alert.alert(lang === "en" ? "PDF saved" : "PDF salvato", uri);
  } catch (e) { Alert.alert("PDF", String(e && e.message || e)); }
}

export default function ChannelDetailScreen({ route, navigation }) {
  const { chan_id, name, openRipasso, topic_id: wantTopic } = route.params || {};
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const me = (user?.lns || "").toLowerCase();
  const [detail, setDetail] = useState(null);
  const [posts, setPosts] = useState([]);
  const [polls, setPolls] = useState([]);
  const [reactions, setReactions] = useState({}); // post_id -> [{emoji,count,mine}]
  const [pollLikes, setPollLikes] = useState({}); // poll_id -> {count, mine}
  const [postLikes, setPostLikes] = useState({}); // post_id -> {count, mine}
  const [reads, setReads] = useState({ members: [], total_others: 0 }); // stato lettura per le spunte
  const [topics, setTopics] = useState([]);
  const [activeTopic, setActiveTopic] = useState(null); // null = Tutti
  const [replyTo, setReplyTo] = useState(null); // {post_id, name, text}
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showManage, setShowManage] = useState(false);
  const [showPoll, setShowPoll] = useState(false);
  const [editingPoll, setEditingPoll] = useState(null);
  const [editPost, setEditPost] = useState(null);
  const [showRipasso, setShowRipasso] = useState(false);
  const [dailyCount, setDailyCount] = useState(0);
  const [showTopicPrompt, setShowTopicPrompt] = useState(false);
  const [showReorder, setShowReorder] = useState(false);
  const [reorderList, setReorderList] = useState([]);
  const [showCambio, setShowCambio] = useState(false);
  const [showConcorso, setShowConcorso] = useState(false);
  const [cambioRegion, setCambioRegion] = useState("");
  const [editing, setEditing] = useState(null); // { kind:'cambio'|'concorso', data, pid }
  const [actionPost, setActionPost] = useState(null); // post under long-press menu
  const [upPct, setUpPct] = useState(null); // avanzamento dell'allegato a pezzi
  const [translations, setTranslations] = useState({}); // post_id -> traduzione
  const autoTrRef = useRef(false);
  const trTargetRef = useRef(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const gk = useRef(null);
  const postMap = useRef({});
  const decCache = useRef({}); // post_id -> { ct, body, atts } — decifra ogni post UNA sola volta
  const listRef = useRef(null);
  const mounted = useRef(true);
  const pollsSig = useRef("");
  const pollLikesSig = useRef("");

  // Export "Valore Legale" del gruppo — on-device, firmato ML-DSA-65 (il server non vede nulla).
  const exportRef = useRef({});
  exportRef.current = { posts, detail, name, user, lang, t };
  const exportingRef = useRef(false);
  const onGroupExport = useCallback(() => {
    const { posts, detail, name, user, lang, t } = exportRef.current;
    if (exportingRef.current) return;
    const run = async () => {
      exportingRef.current = true;
      try {
        const rows = (posts || [])
          .filter((p) => p && p.body && p.body.indexOf(CAMBIO_PREFIX) !== 0 && p.body.indexOf(CONCORSO_PREFIX) !== 0)
          .map((p) => ({ at: p.created_at || "", from: p.from_lns || "", body: p.body, atts: p.atts }));
        const senders = Array.from(new Set([user?.lns, ...rows.map((r) => r.from)].filter(Boolean)));
        const downloadAttachment = async (a) => { const ct = await api.blobDownload(a.id); return decryptFileBytes(ct, a.key, a.iv); };
        const r = await exportConversation({ title: detail?.name || name || "Gruppo", participants: senders, messages: rows, user, lang, downloadAttachment });
        Alert.alert(lang === "en" ? "Export ready" : "Export pronto", (lang === "en" ? "Signed on device · " : "Firmato sul dispositivo · ") + r.count + (lang === "en" ? " messages" : " messaggi"));
      } catch (e) { Alert.alert("Export", String((e && e.message) || e)); }
      finally { exportingRef.current = false; }
    };
    Alert.alert(
      lang === "en" ? "Export conversation" : "Esporta conversazione",
      lang === "en" ? "Generate a signed PDF + JSON on your device (server sees nothing)?" : "Generare un PDF + JSON firmati sul tuo dispositivo (il server non vede nulla)?",
      [{ text: t("cancel"), style: "cancel" }, { text: lang === "en" ? "Export" : "Esporta", onPress: run }]
    );
  }, []);

  const loadPosts = useCallback(async () => {
    try {
      const raw = await api.channelPosts(chan_id);
      const out = [];
      const map = {};
      const cache = decCache.current;
      for (const p of raw) {
        // Riusa la decifratura in cache se il contenuto cifrato non è cambiato.
        // Evita di ri-decifrare TUTTI i post (incluso un PDF base64 da ~300KB) ad ogni
        // poll di 6s: su Hermes questo saturava il thread JS e congelava la UI.
        const cached = cache[p.post_id];
        let body, atts;
        if (cached && cached.ct === p.ct) {
          body = cached.body; atts = cached.atts;
        } else {
          body = t("channels.cannotDecrypt"); atts = [];
          if (gk.current) {
            const pt = decryptWithGroupKey(p.iv, p.ct, gk.current);
            if (pt != null) { const u = unpackMessage(pt); body = u.text; atts = u.atts; }
          }
          cache[p.post_id] = { ct: p.ct, body, atts };
        }
        const item = { ...p, body, atts };
        map[p.post_id] = item;
        out.push(item);
      }
      postMap.current = map;
      if (mounted.current) setPosts(out);
    } catch { /* keep */ }
  }, [chan_id, t]);

  const loadPolls = useCallback(async () => {
    try {
      const d = await api.channelPolls(chan_id);
      const arr = Array.isArray(d) ? d : [];
      // Evita di rimpiazzare lo stato (lista quiz ~2MB) se nulla è cambiato:
      // ricalcolare `feed` e ri-renderizzare la FlatList ad ogni poll congelava la UI su Hermes.
      let sig = arr.length + "#";
      for (let i = 0; i < arr.length; i++) { const p = arr[i]; sig += (p.total || 0) + "." + (p.my_vote == null ? "-" : p.my_vote) + "." + (p.closed ? 1 : 0) + "|"; }
      if (sig === pollsSig.current) return;
      pollsSig.current = sig;
      if (mounted.current) setPolls(arr);
    } catch { /* */ }
  }, [chan_id]);

  const loadReactions = useCallback(async () => {
    try {
      const list = await api.channelReactions(chan_id);
      const map = {};
      (Array.isArray(list) ? list : []).forEach((r) => { (map[r.post_id] = map[r.post_id] || []).push(r); });
      Object.keys(map).forEach((k) => map[k].sort((a, b) => EMOJI.indexOf(a.emoji) - EMOJI.indexOf(b.emoji)));
      if (mounted.current) setReactions(map);
    } catch { /* */ }
  }, [chan_id]);

  const loadTopics = useCallback(async () => {
    try { const d = await api.channelTopics(chan_id); if (mounted.current) setTopics(Array.isArray(d) ? d : []); } catch { /* */ }
  }, [chan_id]);

  const loadPollLikes = useCallback(async () => {
    try {
      const m = await api.channelPollLikes(chan_id);
      const obj = m && typeof m === "object" ? m : {};
      let sig = "";
      Object.keys(obj).sort().forEach((k) => { sig += k + ":" + (obj[k].count || 0) + (obj[k].mine ? "m" : "") + "|"; });
      if (sig === pollLikesSig.current) return;
      pollLikesSig.current = sig;
      if (mounted.current) setPollLikes(obj);
    } catch { /* */ }
  }, [chan_id]);

  const loadPostLikes = useCallback(async () => {
    try { const m = await api.channelPostLikes(chan_id); if (mounted.current) setPostLikes(m && typeof m === "object" ? m : {}); } catch { /* */ }
  }, [chan_id]);

  const loadReads = useCallback(async () => {
    try {
      const r = await api.channelReads(chan_id);
      if (mounted.current && r && typeof r === "object") setReads({ members: Array.isArray(r.members) ? r.members : [], total_others: r.total_others || 0 });
    } catch { /* */ }
  }, [chan_id]);

  const init = useCallback(async () => {
    try {
      pollsSig.current = ""; pollLikesSig.current = "";
      const d = await api.channelDetail(chan_id);
      if (!mounted.current) return;
      setDetail(d);
      navigation.setOptions({
        title: d.name || name || "Gruppo",
        headerRight: () => (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <TouchableOpacity onPress={() => startGcall(false)} testID="channel-call-audio" hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}><Ionicons name="call-outline" size={20} color={theme.primary} /></TouchableOpacity>
            <TouchableOpacity onPress={() => startGcall(true)} testID="channel-call-video" hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}><Ionicons name="videocam-outline" size={22} color={theme.primary} /></TouchableOpacity>
            <TouchableOpacity onPress={onGroupExport} testID="channel-export" hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}><Ionicons name="document-text-outline" size={20} color={theme.primary} /></TouchableOpacity>
          </View>
        ),
      });
      if (d.my_key && user?.kem) { try { gk.current = unwrapGroupKey(d.my_key, user.kem.secretKey); } catch { gk.current = null; } }
      // Apertura rapida: chat/topic/reazioni subito; i dati pesanti (lista quiz ~2MB + like) in background.
      await Promise.all([loadPosts(), loadReactions(), loadTopics()]);
      loadPolls(); loadPollLikes(); loadPostLikes(); loadReads();
      api.channelRead(chan_id).catch(() => {});
    } catch (e) { setErr(api.apiErr(e)); }
  }, [chan_id, name, user, loadPosts, loadPolls, loadReactions, loadTopics, loadPollLikes, loadPostLikes, navigation]);

  useEffect(() => {
    mounted.current = true; init();
    // Chat reattiva (post/reazioni ogni 6s), dati pesanti (lista quiz + like) ogni 24s.
    let tick = 0;
    const tmr = setInterval(() => {
      if (AppState.currentState !== "active") return; // niente lavoro con l'app chiusa
      tick++;
      loadPosts(); loadReactions(); loadPostLikes(); loadReads();
      api.channelRead(chan_id).catch(() => {}); // tieni aggiornato il "letto" mentre il gruppo è aperto
      if (tick % 4 === 0) { loadPolls(); loadPollLikes(); }
    }, 6000);
    return () => { mounted.current = false; clearInterval(tmr); };
  }, [init, loadPosts, loadPolls, loadReactions, loadPollLikes, loadPostLikes]);

  // Sotto-gruppi: nessun "Generale". Se ci sono topic, seleziona sempre il primo valido.
  useEffect(() => {
    if (topics.length === 0) { if (activeTopic) setActiveTopic(null); return; }
    if (!activeTopic || !topics.some((x) => x.topic_id === activeTopic)) setActiveTopic(topics[0].topic_id);
  }, [topics, activeTopic]);
  // Deep-link dal promemoria quiz: apre il topic QUIZ e il Ripasso.
  const deepQuizDone = React.useRef(false);
  React.useEffect(() => {
    if (!openRipasso || deepQuizDone.current || topics.length === 0) return;
    const target = topics.find((x) => x.topic_id === wantTopic) || topics.find((x) => /quiz/i.test(x.name || ""));
    if (target) setActiveTopic(target.topic_id);
    deepQuizDone.current = true;
    setShowRipasso(true);
  }, [openRipasso, wantTopic, topics]);

  const isAdmin = !!detail?.is_admin;
  const isOwner = (detail?.owner_lns || "").toLowerCase() === me;
  const headerHeight = useHeaderHeight();
  const activeTopicName = React.useMemo(() => topics.find((x) => x.topic_id === activeTopic)?.name || "", [topics, activeTopic]);
  const isCambioTopic = /cambi\s*compensativ/i.test(activeTopicName);
  const isConcorsoTopic = /concors/i.test(activeTopicName);

  // ── Feed combinato (post + sondaggi) filtrato per sotto-gruppo ──
  const feed = React.useMemo(() => {
    const items = [];
    posts.forEach((p) => {
      const tp = p.topic || "";
      if (activeTopic ? tp !== activeTopic : tp !== "") return;
      // Filtro per Regione nel sotto-gruppo CAMBI COMPENSATIVI (regione attuale O destinazione).
      if (isCambioTopic && cambioRegion && p.body && p.body.indexOf(CAMBIO_PREFIX) === 0) {
        let cd = {}; try { cd = JSON.parse(p.body.slice(CAMBIO_PREFIX.length)); } catch { /* */ }
        const cr = (cd.current || {}).regione || "", dr = (cd.dest || {}).regione || "";
        if (cr !== cambioRegion && dr !== cambioRegion) return;
      }
      items.push({ kind: "post", key: "p:" + p.post_id, at: p.created_at || "", data: p });
    });
    polls.forEach((p) => {
      const tp = p.topic || "";
      if (activeTopic ? tp !== activeTopic : tp !== "") return;
      items.push({ kind: "poll", key: "q:" + p.poll_id, at: p.created_at || "", data: p });
    });
    items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    let qn = 0;
    items.forEach((it) => { if (it.kind === "poll" && it.data.is_quiz) { qn += 1; it.quizNo = qn; } });
    return items;
  }, [posts, polls, activeTopic, isCambioTopic, cambioRegion]);

  // Messaggio fissato più recente nel sotto-gruppo attivo.
  const pinnedMsg = React.useMemo(() => {
    const list = (posts || []).filter((p) => p.pinned && (p.topic || "") === (activeTopic || ""));
    list.sort((a, b) => ((a.pinned_at || "") < (b.pinned_at || "") ? 1 : -1));
    return list[0] || null;
  }, [posts, activeTopic]);

  // Punteggio quiz personale (privato) + pool per la Modalità Ripasso.
  const quizStats = React.useMemo(() => {
    const qz = polls.filter((p) => p.is_quiz && (activeTopic ? (p.topic || "") === activeTopic : (p.topic || "") === ""));
    const ans = qz.filter((p) => p.my_vote !== null && p.my_vote !== undefined);
    const corr = ans.filter((p) => Array.isArray(p.correct) && p.correct.indexOf(p.my_vote) >= 0).length;
    const catOf = (c) => {
      const q = qz.filter((p) => (p.category || "") === c);
      const a = q.filter((p) => p.my_vote !== null && p.my_vote !== undefined);
      const cc = a.filter((p) => Array.isArray(p.correct) && p.correct.indexOf(p.my_vote) >= 0).length;
      return { a: a.length, c: cc, t: q.length };
    };
    return { total: qz.length, answered: ans.length, correct: corr, pct: ans.length ? Math.round((corr / ans.length) * 100) : 0, oss: catOf("oss"), law: catOf("law") };
  }, [polls, activeTopic]);
  const ripassoPool = React.useMemo(() => polls.filter((p) => p.is_quiz && (activeTopic ? (p.topic || "") === activeTopic : (p.topic || "") === "") && (p.my_vote === null || p.my_vote === undefined)), [polls, activeTopic]);
  const ripassoWrong = React.useMemo(() => polls.filter((p) => p.is_quiz && (activeTopic ? (p.topic || "") === activeTopic : (p.topic || "") === "") && p.my_vote !== null && p.my_vote !== undefined && Array.isArray(p.correct) && p.correct.indexOf(p.my_vote) < 0), [polls, activeTopic]);
  const onRipassoAnswered = useCallback((pid, opt, r) => {
    setPolls((prev) => prev.map((p) => (p.poll_id === pid ? { ...p, my_vote: opt, correct: (r && r.correct) || p.correct, explanation: (r && r.explanation) || p.explanation, total: (p.total || 0) + 1 } : p)));
    setDailyCount((c) => { const n = c + 1; AsyncStorage.setItem("daily_quiz_" + new Date().toISOString().slice(0, 10), String(n)).catch(() => {}); return n; });
  }, []);
  useEffect(() => { AsyncStorage.getItem("daily_quiz_" + new Date().toISOString().slice(0, 10)).then((v) => setDailyCount(parseInt(v || "0", 10) || 0)).catch(() => {}); }, []);

  useEffect(() => { setTimeout(() => listRef.current?.scrollToEnd?.({ animated: true }), 150); }, [feed.length]);

  const publish = async () => {
    if (!text.trim() || !gk.current) return;
    setBusy(true); setErr("");
    try {
      const { iv, ct } = encryptWithGroupKey(packMessage(text.trim(), []), gk.current);
      const payload = { iv, ct, key_version: detail?.key_version || 1 };
      if (replyTo) payload.reply_to = replyTo.post_id;
      if (activeTopic) payload.topic = activeTopic;
      await api.channelPost(chan_id, payload);
      setText(""); setReplyTo(null);
      await loadPosts();
    } catch (e) { setErr(api.apiErr(e)); } finally { setBusy(false); }
  };

  const publishAtt = async (att) => {
    if (!gk.current || !att) return;
    setBusy(true); setErr("");
    try {
      const { iv, ct } = encryptWithGroupKey(packMessage(text.trim(), [att]), gk.current);
      const payload = { iv, ct, key_version: detail?.key_version || 1 };
      if (replyTo) payload.reply_to = replyTo.post_id;
      if (activeTopic) payload.topic = activeTopic;
      await api.channelPost(chan_id, payload);
      setText(""); setReplyTo(null);
      await loadPosts();
    } catch (e) { setErr(api.apiErr(e)); } finally { setBusy(false); }
  };

  const onAttachPhoto = async () => {
    setShowAttachMenu(false);
    if (!gk.current) return;
    suppressLock();
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setErr(t("chat.attach.denied")); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.6, base64: true });
    suppressLock();
    if (r.canceled || !r.assets?.[0]?.base64) return;
    const asset = r.assets[0];
    try {
      // v1.5.0 — compressione automatica (WEBP) + ThumbHash: chi apre il gruppo vede
      // subito l'anteprima e scarica molti byte in meno.
      const prep = await prepareImage(asset);
      const bytes = base64ToBytes(prep.base64 || asset.base64);
      const enc = encryptFileBytes(bytes);
      const { id } = await api.blobUpload(enc.ciphertext);
      const att = { id, name: `foto_${Date.now()}.${prep.ext || "jpg"}`, mime: prep.mime || asset.mimeType || "image/jpeg", size: bytes.length, key: enc.key, iv: enc.iv };
      if (prep.tf) att.tf = prep.tf;
      if (prep.th) att.th = prep.th;
      if (prep.w) att.w = prep.w;
      if (prep.h) att.h = prep.h;
      await publishAtt(att);
    } catch (e) { setErr(api.apiErr(e)); }
  };

  const onAttachFile = async () => {
    setShowAttachMenu(false);
    if (!gk.current) return;
    try {
      suppressLock();
      const res = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
      suppressLock();
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      if (a.size && a.size > bigatt.MAX_ATT) { setErr(lang === "en" ? "File too large (max 100MB)" : "File troppo grande (max 100MB)"); return; }
      const name = a.name || `file_${Date.now()}`;
      const mime = a.mimeType || "application/octet-stream";
      // Come nelle chat: oltre i 4 MB si cifra e si spedisce a pezzi. La chiave del file
      // resta dentro il messaggio cifrato con la chiave del gruppo.
      if ((a.size || 0) > bigatt.ATT_CHUNK) {
        setUpPct(0);
        try {
          const att = await bigatt.uploadFileChunked({ uri: a.uri, name, mime, size: a.size, onProgress: (p) => setUpPct(p) });
          await publishAtt(att);
        } finally { setUpPct(null); }
        return;
      }
      const b64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 });
      const bytes = base64ToBytes(b64);
      const enc = encryptFileBytes(bytes);
      const { id } = await api.blobUpload(enc.ciphertext);
      await publishAtt({ id, name, mime, size: bytes.length, key: enc.key, iv: enc.iv });
    } catch (e) { setErr(api.apiErr(e)); }
  };

  const toggleReact = async (pid, emoji) => {
    try { await api.channelReact(chan_id, pid, emoji); await loadReactions(); } catch (e) { setErr(api.apiErr(e)); }
  };

  const doDelete = (pid) => {
    Alert.alert(lang === "en" ? "Delete message" : "Elimina messaggio",
      lang === "en" ? "Delete this message for everyone?" : "Eliminare questo messaggio per tutti?",
      [
        { text: t("cancel"), style: "cancel" },
        { text: t("delete"), style: "destructive", onPress: async () => { try { await api.channelDeletePost(chan_id, pid); await loadPosts(); await loadReactions(); } catch (e) { setErr(api.apiErr(e)); } } },
      ]);
  };

  const doReport = (pid) => {
    api.channelReportPost(chan_id, pid, "").then(() => {
      Alert.alert(lang === "en" ? "Reported" : "Segnalato", lang === "en" ? "Report sent to admins." : "Segnalazione inviata agli amministratori.");
    }).catch((e) => setErr(api.apiErr(e)));
  };

  // Traduzione on-device sovrana (LibreTranslate self-hosted).
  const onTranslate = async (post) => {
    if (!post?.body) return;
    const target = trTargetRef.current || (lang === "en" ? "en" : "it");
    try {
      const r = await api.translate(post.body, target);
      setTranslations((m) => ({ ...m, [post.post_id]: { text: r?.translated || "", detected: r?.detected || "", show: true, target } }));
    } catch (e) { setErr(api.apiErr(e)); }
  };
  const toggleTr = (id) => setTranslations((m) => ({ ...m, [id]: { ...m[id], show: !m[id].show } }));
  const [gActive, setGActive] = useState(null);
  const startGcall = async (video) => {
    try { const r = await api.gcallStart(chan_id, video); navigation.navigate("GroupCall", { room_id: r.room_id, video: r.video, chan_name: detail?.name || name }); }
    catch (e) { setErr(api.apiErr(e)); }
  };
  useEffect(() => {
    if (!chan_id) return;
    let on = true;
    const chk = async () => { try { const r = await api.gcallActive(chan_id); if (on) setGActive(r && r.room ? r.room : null); } catch {} };
    chk(); const iv = setInterval(chk, 8000); return () => { on = false; clearInterval(iv); };
  }, [chan_id]);
  useEffect(() => { loadAutoTranslate().then((v) => { autoTrRef.current = v; }); loadTranslateTarget().then((v) => { trTargetRef.current = v; }); }, []);
  useEffect(() => {
    if (!autoTrRef.current || !posts.length) return;
    posts.filter((p) => (p.from_lns || "").toLowerCase() !== me && p.body && p.body.indexOf(CAMBIO_PREFIX) !== 0 && p.body.indexOf(CONCORSO_PREFIX) !== 0 && translations[p.post_id] == null).slice(-30).forEach((p) => onTranslate(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts]);

  // ── Modifica messaggio (solo i propri, testo semplice) ──
  const doEditPost = (post) => {
    if ((post.atts || []).length) { Alert.alert(lang === "en" ? "Edit" : "Modifica", lang === "en" ? "You can't edit a message with attachments." : "Non puoi modificare un messaggio con allegati."); return; }
    setEditPost(post);
  };
  const submitEdit = async (newText) => {
    const p = editPost; setEditPost(null);
    const nv = (newText || "").trim();
    if (!p || !nv || nv === (p.body || "")) return;
    try {
      if (!gk.current) throw new Error(lang === "en" ? "Key unavailable" : "Chiave non disponibile");
      const { iv, ct } = encryptWithGroupKey(packMessage(nv, []), gk.current);
      await api.channelEditPost(chan_id, p.post_id, { iv, ct, key_version: detail?.key_version || 1 });
      delete decCache.current[p.post_id];
      await loadPosts();
    } catch (e) { setErr(api.apiErr(e)); }
  };

  // ── Fissa/sfissa messaggio (solo admin) ──
  const doPin = async (post) => {
    try { await api.channelPinPost(chan_id, post.post_id); await loadPosts(); } catch (e) { setErr(api.apiErr(e)); }
  };
  const showPinned = () => {
    if (!pinnedMsg) return;
    Alert.alert(lang === "en" ? "📌 Pinned message" : "📌 Messaggio fissato", (pinnedMsg.body || "🔒").slice(0, 500));
  };

  // ── Reset Punteggio: azzera le proprie risposte ai quiz del gruppo ──
  const doResetScore = () => {
    Alert.alert(lang === "en" ? "Reset score" : "Reset punteggio",
      lang === "en" ? "Reset ALL your quiz answers in this group? Your score and today's goal reset and you can redo Practice from scratch." : "Azzerare TUTTE le tue risposte ai quiz di questo gruppo? Punteggio e obiettivo di oggi torneranno a zero e potrai rifare il Ripasso da capo.",
      [
        { text: t("cancel"), style: "cancel" },
        { text: lang === "en" ? "Reset" : "Azzera", style: "destructive", onPress: async () => {
          try {
            await api.channelQuizReset(chan_id);
            await AsyncStorage.removeItem("daily_quiz_" + new Date().toISOString().slice(0, 10));
            if (mounted.current) setDailyCount(0);
            await loadPolls();
          } catch (e) { setErr(api.apiErr(e)); }
        } },
      ]);
  };

  const doVote = async (poll_id, option) => {
    try { await api.channelVotePoll(chan_id, poll_id, option); await loadPolls(); } catch (e) { setErr(api.apiErr(e)); }
  };
  const closePoll = (pid) => api.channelClosePoll(chan_id, pid).then(loadPolls).catch((e) => setErr(api.apiErr(e)));
  const deletePoll = (pid) => Alert.alert(lang === "en" ? "Delete poll" : "Elimina sondaggio", "", [
    { text: t("cancel"), style: "cancel" },
    { text: t("delete"), style: "destructive", onPress: () => api.channelDeletePoll(chan_id, pid).then(loadPolls).catch((e) => setErr(api.apiErr(e))) },
  ]);

  const togglePollLike = async (pid) => {
    try { await api.channelPollLike(chan_id, pid); await loadPollLikes(); } catch (e) { setErr(api.apiErr(e)); }
  };
  const toggleConcorsoLike = async (pid) => {
    try { await api.channelPostLike(chan_id, pid); await loadPostLikes(); } catch (e) { setErr(api.apiErr(e)); }
  };
  const sharePoll = async (poll, quizNo) => {
    try {
      const r = await api.shareCreate({ kind: "quiz", question: poll.question || "", options: (poll.options || []).map((o) => o.text || "") });
      await Share.share({ message: `🧠 Quiz${quizNo ? " #" + quizNo : ""}\n${poll.question}\n${r.url}`, url: r.url });
    } catch (e) { if (!/cancel|dismiss/i.test(String(e))) setErr(api.apiErr(e)); }
  };
  const shareConcorso = async (data) => {
    try {
      const payload = {
        kind: "concorso",
        title: data.titolo || data.title || "Concorso pubblico",
        ente: data.ente || "", localita: data.localita || "", posti: String(data.posti || ""),
        scadenza: data.scadenza || "", url: data.url || "",
      };
      if (data.pdf && data.pdf.data) { payload.pdf_b64 = data.pdf.data; payload.pdf_name = data.pdf.name || "bando.pdf"; }
      const r = await api.shareCreate(payload);
      await Share.share({ message: `🏛️ ${payload.title}\n${r.url}`, url: r.url });
    } catch (e) { if (!/cancel|dismiss/i.test(String(e))) setErr(api.apiErr(e)); }
  };

  const createTopic = async (nm) => {
    setShowTopicPrompt(false);
    if (!nm || !nm.trim()) return;
    try { const r = await api.channelCreateTopic(chan_id, nm.trim()); await loadTopics(); if (r?.topic_id) setActiveTopic(r.topic_id); }
    catch (e) { setErr(api.apiErr(e)); }
  };

  const deleteTopic = (tp) => {
    Alert.alert(
      lang === "en" ? "Delete sub-group" : "Elimina sotto-gruppo",
      (lang === "en" ? 'Delete "' : 'Eliminare "') + (tp.name || "") + (lang === "en" ? '"? The messages inside are not deleted.' : '"? I messaggi al suo interno non vengono eliminati.'),
      [
        { text: t("cancel"), style: "cancel" },
        { text: t("delete"), style: "destructive", onPress: async () => {
          try { await api.channelDeleteTopic(chan_id, tp.topic_id); if (activeTopic === tp.topic_id) setActiveTopic(null); setReorderList((l) => l.filter((x) => x.topic_id !== tp.topic_id)); await loadTopics(); }
          catch (e) { setErr(api.apiErr(e)); }
        } },
      ]);
  };

  const openReorder = () => { setReorderList(topics.slice()); setShowReorder(true); };
  const moveTopic = (idx, dir) => {
    setReorderList((list) => {
      const a = list.slice(); const j = idx + dir;
      if (j < 0 || j >= a.length) return a;
      const tmp = a[idx]; a[idx] = a[j]; a[j] = tmp; return a;
    });
  };
  const saveReorder = async () => {
    const order = reorderList.map((t) => t.topic_id);
    setTopics(reorderList.slice()); setShowReorder(false);
    try { await api.channelReorderTopics(chan_id, order); await loadTopics(); }
    catch (e) { setErr(api.apiErr(e)); }
  };


  const submitPoll = async (payload) => {
    setBusy(true);
    try {
      if (editingPoll) await api.channelUpdatePoll(chan_id, editingPoll.poll_id, { ...payload, topic: editingPoll.topic || activeTopic || "" });
      else await api.channelCreatePoll(chan_id, { ...payload, topic: activeTopic || "" });
      setShowPoll(false); setEditingPoll(null); await loadPolls();
    }
    catch (e) { Alert.alert(t("att.error") || "Errore", api.apiErr(e)); }
    finally { setBusy(false); }
  };

  const sendStructured = async (prefix, data, editPid) => {
    if (!gk.current) throw new Error(lang === "en" ? "Group key unavailable" : "Chiave del gruppo non disponibile");
    if (prefix === CONCORSO_PREFIX && data && data.pdf && data.pdf.data && !data.pdf.ref) {
      const b64 = String(data.pdf.data).replace(/^data:[^,]*,/, "");
      const bytes = base64ToBytes(b64);
      const enc = encryptFileBytes(bytes);
      const { id } = await api.blobUpload(enc.ciphertext);
      data = { ...data, pdf: { ref: { id, key: enc.key, iv: enc.iv }, name: data.pdf.name || "bando.pdf", mime: "application/pdf" } };
    }
    const { iv, ct } = encryptWithGroupKey(packMessage(prefix + JSON.stringify(data), []), gk.current);
    const payload = { iv, ct, key_version: detail?.key_version || 1 };
    if (activeTopic) payload.topic = activeTopic;
    const resp = await api.channelPost(chan_id, payload);
    // Registra il reminder scadenza per il concorso (avvisi push a 3 e 0 giorni).
    if (prefix === CONCORSO_PREFIX && resp?.post_id && data.scadenza) {
      const title = [data.ente || "", data.posti ? "· " + data.posti + (lang === "en" ? " positions" : " posti") : ""].filter(Boolean).join(" ").slice(0, 120);
      try { await api.channelConcorsoReminder(chan_id, { post_id: resp.post_id, scadenza: data.scadenza, title }); } catch { /* */ }
    }
    if (editPid) { try { await api.channelDeletePost(chan_id, editPid); } catch { /* */ } }
    await loadPosts();
    setTimeout(() => listRef.current?.scrollToEnd?.({ animated: true }), 200);
  };
  const submitCambio = async (data) => {
    setBusy(true);
    try { await sendStructured(CAMBIO_PREFIX, data, editing && editing.kind === "cambio" ? editing.pid : null); setShowCambio(false); setEditing(null); }
    catch (e) { Alert.alert(t("att.error") || "Errore", api.apiErr ? api.apiErr(e) : String(e)); }
    finally { setBusy(false); }
  };
  const submitConcorso = async (data) => {
    setBusy(true);
    try { await sendStructured(CONCORSO_PREFIX, data, editing && editing.kind === "concorso" ? editing.pid : null); setShowConcorso(false); setEditing(null); }
    catch (e) { Alert.alert(t("att.error") || "Errore", api.apiErr ? api.apiErr(e) : String(e)); }
    finally { setBusy(false); }
  };
  const editCambio = (data, pid) => { setEditing({ kind: "cambio", data, pid }); setShowCambio(true); };
  const editConcorso = (data, pid) => { setEditing({ kind: "concorso", data, pid }); setShowConcorso(true); };
  const contactViaPulse = (lns) => {
    lns = (lns || "").trim();
    if (!lns) return;
    if (lns.toLowerCase() === me) { Alert.alert("Pulse", lang === "en" ? "This swap is yours." : "Questo cambio è tuo."); return; }
    api.addContact(lns).catch(() => {});
    navigation.navigate("Chat", { conv_id: null, others: [lns], title: lns.split("@")[0], title_lns: lns });
  };

  // Stato spunte per i MIEI messaggi: "sent" (nessuno ha letto), "some" (qualcuno), "all" (tutti).
  const readState = (item) => {
    const T = item.created_at || "";
    const mem = reads.members || [];
    const totalOthers = reads.total_others || mem.length;
    if (!mem.length || !totalOthers) return "sent";
    let n = 0;
    for (const m of mem) { if ((m.last_read_at || "") >= T) n++; }
    if (n <= 0) return "sent";
    if (n >= totalOthers) return "all";
    return "some";
  };

  const renderPost = (item) => {
    const mine = (item.from_lns || "").toLowerCase() === me;
    // Messaggi strutturati (Cambio compensativo / Concorso pubblico)
    if (item.body && item.body.indexOf(CAMBIO_PREFIX) === 0) {
      let data = {}; try { data = JSON.parse(item.body.slice(CAMBIO_PREFIX.length)); } catch { /* */ }
      return (
        <Pressable onLongPress={() => setActionPost(item)}>
          <CambioCard data={data} mine={mine} lang={lang} onContact={() => contactViaPulse(item.from_lns || "")} onEdit={mine ? (() => editCambio(data, item.post_id)) : null} onMenu={() => setActionPost(item)} />
        </Pressable>
      );
    }
    if (item.body && item.body.indexOf(CONCORSO_PREFIX) === 0) {
      let data = {}; try { data = JSON.parse(item.body.slice(CONCORSO_PREFIX.length)); } catch { /* */ }
      const clk = postLikes[item.post_id] || { count: 0, mine: false };
      return (
        <Pressable onLongPress={() => setActionPost(item)}>
          <ConcorsoCard data={data} lang={lang} onOpenPdf={() => openPdf(data.pdf, lang)} onEdit={isOwner ? (() => editConcorso(data, item.post_id)) : null} onMenu={() => setActionPost(item)} onShare={() => shareConcorso(data)}
            liked={!!clk.mine} likeCount={clk.count || 0} onLike={() => toggleConcorsoLike(item.post_id)} />
        </Pressable>
      );
    }
    const ref = item.reply_to ? postMap.current[item.reply_to] : null;
    const rx = reactions[item.post_id] || [];
    return (
      <Pressable onLongPress={() => setActionPost(item)} style={[styles.post, mine ? styles.postMine : styles.postOther]} testID="channel-post">
        <View style={styles.postHead}>
          {mine ? <View style={{ flex: 1 }} /> : <Text style={styles.postFrom}>{(item.from_lns || "").split("@")[0]}</Text>}
          <Text style={styles.postTime}>{fmt(item.created_at)}</Text>
          {mine && (() => {
            const st = readState(item);
            return (
              <Ionicons
                name={st === "sent" ? "checkmark" : "checkmark-done"}
                size={15}
                color={st === "all" ? theme.primary : theme.textFaint}
                style={{ marginLeft: 3 }}
                testID={`channel-read-${st}`}
              />
            );
          })()}
          {item.edited && (
            <TouchableOpacity onPress={() => Alert.alert(lang === "en" ? "Edited" : "Modificato", (lang === "en" ? "Last edited: " : "Ultima modifica: ") + (item.edited_at ? fmt(item.edited_at) : (lang === "en" ? "unknown" : "sconosciuta")))} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }} testID="channel-edited-label">
              <Text style={styles.postEdited}>{lang === "en" ? "(edited)" : "(modificato)"}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => setActionPost(item)} style={styles.postMenuBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID="channel-post-menu">
            <Ionicons name="ellipsis-horizontal-outline" size={18} color={theme.textDim} />
          </TouchableOpacity>
        </View>
        {!!item.reply_to && (
          <View style={styles.quote}>
            <Text style={styles.quoteName} numberOfLines={1}>{ref ? (ref.from_lns || "").split("@")[0] : (lang === "en" ? "message" : "messaggio")}</Text>
            <Text style={styles.quoteText} numberOfLines={2}>{ref ? (ref.body || "📎") : "🔒"}</Text>
          </View>
        )}
        {!!item.body && <SafeText text={item.body} style={styles.postBody} lang={lang} />}
        {translations[item.post_id] && (
          <View style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.12)" }} testID="channel-translated">
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
              <Text style={{ color: theme.textDim, fontSize: 10, fontWeight: "800" }}>🌐 {(translations[item.post_id].detected || "").toUpperCase()} → {((translations[item.post_id].target) || (lang === "en" ? "en" : "it")).toUpperCase()}</Text>
              <TouchableOpacity onPress={() => toggleTr(item.post_id)} testID="channel-translate-toggle"><Text style={{ color: theme.primary, fontSize: 10, fontWeight: "800" }}>{translations[item.post_id].show ? (lang === "en" ? "See original" : "Vedi originale") : (lang === "en" ? "See translation" : "Vedi traduzione")}</Text></TouchableOpacity>
            </View>
            {translations[item.post_id].show && <Text style={{ color: theme.text, fontSize: 14, lineHeight: 19, fontStyle: "italic" }}>{translations[item.post_id].text}</Text>}
          </View>
        )}
        {(item.atts || []).map((a, i) => <EncryptedAttachment key={a.id || i} att={a} />)}
        <LinkPreview text={item.body} lang={lang} />
        {!!item.body && <ThreatBanner result={analyzeMessage(item.body, lang)} lang={lang} context="Gruppo" />}
        {rx.length > 0 && (
          <View style={styles.rxRow}>
            {rx.map((r) => (
              <TouchableOpacity key={r.emoji} onPress={() => toggleReact(item.post_id, r.emoji)} style={[styles.rxChip, r.mine && styles.rxChipMine]} testID="channel-reaction-chip">
                <Text style={styles.rxChipText}>{r.emoji} {r.count}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </Pressable>
    );
  };

  const renderItem = ({ item }) => item.kind === "poll"
    ? <PollCard poll={item.data} me={me} lang={lang} quizNo={item.quizNo} onVote={doVote} onClose={closePoll} onDelete={deletePoll} onShare={sharePoll}
        onEdit={item.data.can_edit ? (() => { setEditingPoll(item.data); setShowPoll(true); }) : null}
        liked={!!(pollLikes[item.data.poll_id] && pollLikes[item.data.poll_id].mine)} likeCount={(pollLikes[item.data.poll_id] && pollLikes[item.data.poll_id].count) || 0} onLike={() => togglePollLike(item.data.poll_id)} />
    : renderPost(item.data);

  const leaveGroup = () => Alert.alert("Esci dal gruppo", `Uscire da «${detail?.name || name}»? Non riceverai più i messaggi.`, [
    { text: "Annulla", style: "cancel" },
    {
      text: "Esci", style: "destructive",
      onPress: async () => {
        try { await api.groupLeave(chan_id); navigation.goBack(); }
        catch (e) { setErr(api.apiErr(e)); }
      },
    },
  ]);

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <View style={styles.badgeBar}>
        <Ionicons name="shield-checkmark-outline" size={13} color={theme.accent} />
        <Text style={styles.badgeText}>{t("channels.e2eeBadge")}</Text>
        {isAdmin && (
          <TouchableOpacity style={styles.manageBtn} onPress={() => setShowManage(true)} testID="channel-manage-btn">
            <Ionicons name="people-outline" size={14} color={theme.primary} />
            <Text style={styles.manageText}>{t("channels.manage")}</Text>
          </TouchableOpacity>
        )}
        {!isAdmin && (
          <TouchableOpacity style={styles.manageBtn} onPress={leaveGroup} testID="channel-leave-btn-top">
            <Ionicons name="exit-outline" size={14} color={theme.danger} />
            <Text style={[styles.manageText, { color: theme.danger }]}>{lang === "en" ? "Leave" : "Esci"}</Text>
          </TouchableOpacity>
        )}
      </View>

      {gActive && (
        <TouchableOpacity style={styles.gcallBanner} onPress={() => navigation.navigate("GroupCall", { room_id: gActive.room_id, video: gActive.video, chan_name: detail?.name || name })} testID="gcall-banner">
          <Ionicons name={gActive.video ? "videocam" : "call"} size={16} color="#fff" />
          <Text style={styles.gcallBannerTxt}>{lang === "en" ? "Group call in progress" : "Chiamata di gruppo in corso"} · {gActive.count}</Text>
          <Text style={styles.gcallJoin}>{lang === "en" ? "Join" : "Partecipa"}</Text>
        </TouchableOpacity>
      )}

      {(topics.length > 0 || isAdmin) && (
        <View style={styles.topicBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: "center", paddingRight: 10 }}>
            {topics.map((tp) => (
              <TopicChip key={tp.topic_id} label={tp.name} active={activeTopic === tp.topic_id}
                onPress={() => setActiveTopic(tp.topic_id)}
                onLongPress={isAdmin ? (() => deleteTopic(tp)) : null}
                testID="channel-topic-tab" />
            ))}
            {isAdmin && topics.length > 1 && (
              <TouchableOpacity style={styles.topicAdd} onPress={openReorder} testID="channel-topic-reorder">
                <Ionicons name="swap-horizontal-outline" size={18} color={theme.primary} />
              </TouchableOpacity>
            )}
            {isAdmin && (
              <TouchableOpacity style={styles.topicAdd} onPress={() => setShowTopicPrompt(true)} testID="channel-topic-add">
                <Ionicons name="add-outline" size={18} color={theme.primary} />
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      )}

      {quizStats.total > 0 && (
        <View style={styles.quizBar}>
          <View style={{ flex: 1, flexShrink: 1, paddingRight: 8 }}>
            <Text style={styles.quizBarText}>🏆 {lang === "en" ? "Score" : "Punteggio"}: <Text style={{ color: "#22c55e", fontWeight: "800" }}>{quizStats.correct}/{quizStats.answered}</Text> ({quizStats.pct}%) · {quizStats.total} quiz</Text>
            <Text style={[styles.quizBarText, { marginTop: 3 }]}>📚 OSS: <Text style={{ fontWeight: "800" }}>{quizStats.oss.c}/{quizStats.oss.a}</Text>   ⚖️ {lang === "en" ? "Law" : "Legge"}: <Text style={{ fontWeight: "800" }}>{quizStats.law.c}/{quizStats.law.a}</Text></Text>
            <Text style={[styles.quizBarText, { marginTop: 3 }]}>🎯 {lang === "en" ? "Today" : "Oggi"}: <Text style={{ color: dailyCount >= 10 ? "#22c55e" : "#50C878", fontWeight: "800" }}>{dailyCount}/10</Text>{dailyCount >= 10 ? " 🎉" : ""}</Text>
          </View>
          <View style={{ gap: 6 }}>
            <TouchableOpacity style={styles.quizBarBtn} onPress={() => setShowRipasso(true)} testID="channel-ripassa"><Text style={styles.quizBarBtnText}>🎯 {lang === "en" ? "Practice" : "Ripassa"}</Text></TouchableOpacity>
            <TouchableOpacity style={styles.quizResetBtn} onPress={doResetScore} testID="channel-reset-score"><Text style={styles.quizResetBtnText}>🔄 Reset</Text></TouchableOpacity>
          </View>
        </View>
      )}

      {pinnedMsg && (
        <TouchableOpacity style={styles.pinBar} onPress={showPinned} activeOpacity={0.8} testID="channel-pin-bar">
          <Ionicons name="pin-outline" size={16} color={theme.primary} />
          <View style={{ flex: 1, marginHorizontal: 8 }}>
            <Text style={styles.pinBarLabel}>{lang === "en" ? "Pinned message" : "Messaggio fissato"}</Text>
            <Text style={styles.pinBarText} numberOfLines={1}>{(pinnedMsg.body || "🔒").slice(0, 120)}</Text>
          </View>
          {isAdmin && (
            <TouchableOpacity onPress={() => doPin(pinnedMsg)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID="channel-unpin-btn">
              <Ionicons name="close-outline" size={18} color={theme.textDim} />
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      )}

      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={headerHeight} style={{ flex: 1 }}>
        <FlatList
          ref={listRef}
          style={{ flex: 1 }}
          data={feed}
          keyExtractor={(it) => it.key}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 14, paddingBottom: 20 }}
          ListEmptyComponent={<Text style={styles.empty}>{t("channels.noPosts")}</Text>}
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={11}
          updateCellsBatchingPeriod={60}
        />

        {!!err && <Text style={styles.err}>{err}</Text>}

        {replyTo && (
          <View style={styles.replyBar} testID="channel-reply-bar">
            <View style={{ flex: 1 }}>
              <Text style={styles.replyBarName} numberOfLines={1}>↩︎ {replyTo.name}</Text>
              <Text style={styles.replyBarText} numberOfLines={1}>{replyTo.text || "📎"}</Text>
            </View>
            <TouchableOpacity onPress={() => setReplyTo(null)} testID="channel-reply-cancel" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close-outline" size={20} color={theme.textDim} />
            </TouchableOpacity>
          </View>
        )}

        {activeTopic && (
          <View style={styles.topicHint}>
            <Text style={styles.topicHintText}>{lang === "en" ? "Posting in" : "Scrivi in"}: {topics.find((x) => x.topic_id === activeTopic)?.name || ""}</Text>
          </View>
        )}

        {isCambioTopic && (
          <View style={styles.mFilterBar}>
            <Text style={styles.mFilterLbl}>🔎 {lang === "en" ? "Region" : "Regione"}:</Text>
            <View style={{ flex: 1 }}>
              <RegionSelect value={cambioRegion} onChange={setCambioRegion} lang={lang} />
            </View>
          </View>
        )}
        {isCambioTopic && (
          <TouchableOpacity style={styles.structBtn} onPress={() => { setEditing(null); setShowCambio(true); }} testID="channel-cambio-open">
            <Text style={styles.structBtnText}>📢 {lang === "en" ? "Publish shift swap" : "Pubblica cambio compensativo"}</Text>
          </TouchableOpacity>
        )}
        {isConcorsoTopic && isOwner && (
          <TouchableOpacity style={styles.structBtn} onPress={() => { setEditing(null); setShowConcorso(true); }} testID="channel-concorso-open">
            <Text style={styles.structBtnText}>🏛️ {lang === "en" ? "Publish competition" : "Pubblica concorso"}</Text>
          </TouchableOpacity>
        )}

        <View style={styles.composer}>
          <TouchableOpacity style={styles.plusBtn} onPress={() => setShowAttachMenu((v) => !v)} testID="channel-attach-btn">
            <Ionicons name="add-circle-outline" size={24} color={theme.primary} />
          </TouchableOpacity>
          <TextInput style={styles.input} placeholder={t("channels.postPlaceholder")} placeholderTextColor={theme.textFaint}
            selectionColor={theme.primary} cursorColor={theme.text} keyboardAppearance="dark"
            value={text} onChangeText={setText} multiline testID="channel-post-input" onFocus={() => setShowAttachMenu(false)} />
          <TouchableOpacity style={styles.sendBtn} onPress={publish} disabled={busy || !text.trim()} testID="channel-publish-btn">
            {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="send-outline" size={20} color="#fff" />}
          </TouchableOpacity>
        </View>
        {upPct !== null && (
          <Text style={{ color: theme.textDim, fontSize: 11, paddingHorizontal: 14, paddingBottom: 6 }} testID="channel-upload-pct">
            {(lang === "en" ? "Encrypting and sending… " : "Cifro e spedisco… ") + Math.round(upPct * 100) + "%"}
          </Text>
        )}
        {showAttachMenu && (
          <View style={styles.attachMenu} testID="channel-attach-menu">
            <TouchableOpacity style={styles.attachItem} onPress={onAttachPhoto} disabled={busy} testID="channel-attach-photo">
              <Ionicons name="image-outline" size={20} color={theme.primary} />
              <Text style={styles.attachItemText}>{lang === "en" ? "Photo" : "Foto"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.attachItem} onPress={onAttachFile} disabled={busy} testID="channel-attach-file">
              <Ionicons name="document-attach-outline" size={20} color={theme.primary} />
              <Text style={styles.attachItemText}>{lang === "en" ? "File" : "File"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.attachItem} onPress={() => { setShowAttachMenu(false); setShowPoll(true); }} disabled={busy} testID="channel-attach-poll">
              <Ionicons name="stats-chart-outline" size={20} color={theme.primary} />
              <Text style={styles.attachItemText}>{lang === "en" ? "Poll" : "Sondaggio"}</Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Menu azioni su un messaggio (long-press) */}
      {actionPost && (
        <PostActionSheet
          post={actionPost} me={me} isAdmin={isAdmin} lang={lang}
          onClose={() => setActionPost(null)}
          onReact={(emoji) => { const p = actionPost; setActionPost(null); toggleReact(p.post_id, emoji); }}
          onReply={() => { const p = actionPost; setActionPost(null); setReplyTo({ post_id: p.post_id, name: (p.from_lns || "").split("@")[0], text: (p.body || "").slice(0, 140) }); }}
          onEdit={() => { const p = actionPost; setActionPost(null); setTimeout(() => doEditPost(p), 300); }}
          onPin={() => { const p = actionPost; setActionPost(null); setTimeout(() => doPin(p), 300); }}
          onDelete={() => { const p = actionPost; setActionPost(null); doDelete(p.post_id); }}
          onReport={() => { const p = actionPost; setActionPost(null); doReport(p.post_id); }}
          onTranslate={() => { const p = actionPost; setActionPost(null); onTranslate(p); }}
        />
      )}

      {showPoll && <PollFormModal lang={lang} busy={busy} initial={editingPoll} onClose={() => { setShowPoll(false); setEditingPoll(null); }} onSubmit={submitPoll} />}
      {showRipasso && <RipassoModal lang={lang} pool={ripassoPool} wrongPool={ripassoWrong} chan_id={chan_id} onAnswered={onRipassoAnswered} onClose={() => setShowRipasso(false)} />}

      {editPost && <EditMessageModal lang={lang} initial={editPost.body || ""} onCancel={() => setEditPost(null)} onSubmit={submitEdit} />}

      {showCambio && <CambioFormModal lang={lang} busy={busy} initial={editing && editing.kind === "cambio" ? editing.data : null} onClose={() => { setShowCambio(false); setEditing(null); }} onSubmit={submitCambio} />}
      {showConcorso && <ConcorsoFormModal lang={lang} busy={busy} initial={editing && editing.kind === "concorso" ? editing.data : null} onClose={() => { setShowConcorso(false); setEditing(null); }} onSubmit={submitConcorso} />}

      {showTopicPrompt && (
        <PromptModal
          title={lang === "en" ? "New sub-group" : "Nuovo sotto-gruppo"}
          placeholder={lang === "en" ? "Name (e.g. WORK)" : "Nome (es. LAVORO)"}
          lang={lang}
          onCancel={() => setShowTopicPrompt(false)}
          onSubmit={createTopic}
        />
      )}

      {showReorder && (
        <Modal transparent animationType="fade" onRequestClose={() => setShowReorder(false)}>
          <View style={styles.reorderOverlay}>
            <View style={styles.reorderBox}>
              <Text style={styles.reorderTitle}>{lang === "en" ? "Reorder sub-groups" : "Riordina sotto-gruppi"}</Text>
              <Text style={styles.reorderHint}>{lang === "en" ? "The order is saved for everyone in the group." : "L'ordine viene salvato per tutti i membri del gruppo."}</Text>
              <ScrollView style={{ maxHeight: 320 }}>
                {reorderList.map((tp, idx) => (
                  <View key={tp.topic_id} style={styles.reorderRow} testID="reorder-row">
                    <Text style={styles.reorderName} numberOfLines={1}>{idx + 1}. {tp.name}</Text>
                    <TouchableOpacity disabled={idx === 0} onPress={() => moveTopic(idx, -1)} style={[styles.reorderArrow, idx === 0 && styles.reorderArrowOff]} testID="reorder-up">
                      <Ionicons name="arrow-up-outline" size={18} color={idx === 0 ? "#556" : theme.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity disabled={idx === reorderList.length - 1} onPress={() => moveTopic(idx, 1)} style={[styles.reorderArrow, idx === reorderList.length - 1 && styles.reorderArrowOff]} testID="reorder-down">
                      <Ionicons name="arrow-down-outline" size={18} color={idx === reorderList.length - 1 ? "#556" : theme.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => deleteTopic(tp)} style={styles.reorderArrow} testID="reorder-delete">
                      <Ionicons name="trash-outline" size={18} color={theme.danger} />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
              <View style={styles.reorderBtns}>
                <TouchableOpacity onPress={() => setShowReorder(false)} style={styles.reorderCancel} testID="reorder-cancel">
                  <Text style={styles.reorderCancelText}>{lang === "en" ? "Cancel" : "Annulla"}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={saveReorder} style={styles.reorderSave} testID="reorder-save">
                  <Text style={styles.reorderSaveText}>{lang === "en" ? "Save order" : "Salva ordine"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {showManage && detail && (
        <ManageModal detail={detail} user={user} groupKey={gk.current} t={t} lang={lang}
          onClose={() => setShowManage(false)}
          onDeleted={() => { setShowManage(false); navigation.goBack(); }}
          onChanged={init} />
      )}
    </SafeAreaView>
  );
}

// ── Chip sotto-gruppo ──
function TopicChip({ label, active, onPress, onLongPress, testID }) {
  return (
    <TouchableOpacity onPress={onPress} onLongPress={onLongPress || undefined} delayLongPress={400} style={[styles.topicChip, active && styles.topicChipOn]} testID={testID}>
      <Text style={[styles.topicChipText, active && styles.topicChipTextOn]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Card sondaggio / quiz ──
function PollCard({ poll, me, lang, quizNo, onVote, onClose, onDelete, onShare, onEdit, liked, likeCount, onLike }) {
  const total = poll.total || 0;
  const revealed = poll.my_vote !== null && poll.my_vote !== undefined || poll.closed;
  const showStats = !poll.is_quiz || revealed;
  const correct = Array.isArray(poll.correct) ? poll.correct : null;
  const manage = !!poll.can_close;
  const title = poll.is_quiz
    ? `🧠 Quiz${quizNo ? " #" + quizNo : ""} — ${poll.question}`
    : `📊 ${poll.question}`;
  return (
    <View style={styles.pollCard} testID="channel-poll">
      <View style={styles.pollHead}>
        {poll.is_quiz && <Text style={styles.pollQuizBadge}>{quizNo ? "QUIZ #" + quizNo : "QUIZ"}</Text>}
        <Text style={styles.pollQ}>{title}</Text>
        <TouchableOpacity onPress={() => onLike && onLike()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.pollShareBtn} testID="channel-poll-like">
          <Ionicons name={liked ? "heart" : "heart-outline"} size={18} color={liked ? "#ef4444" : theme.textDim} />
          {likeCount > 0 && <Text style={styles.likeCount}>{likeCount}</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onShare && onShare(poll, quizNo)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.pollShareBtn} testID="channel-poll-share">
          <Ionicons name="share-social-outline" size={17} color={theme.primary} />
        </TouchableOpacity>
      </View>
      {!!poll.description && <Text style={styles.pollDesc}>{poll.description}</Text>}
      {(poll.options || []).map((o, i) => {
        const pct = total ? Math.round((o.count / total) * 100) : 0;
        const mine = poll.my_vote === i;
        const isC = correct && correct.indexOf(i) >= 0;
        const clickable = !poll.closed && !(poll.is_quiz && revealed);
        let borderColor = theme.border;
        if (revealed && poll.is_quiz) { if (isC) borderColor = "#22c55e"; else if (mine) borderColor = "#ff5555"; }
        else if (mine) borderColor = theme.primary;
        return (
          <TouchableOpacity key={i} disabled={!clickable} onPress={() => onVote(poll.poll_id, i)} style={[styles.pollOpt, { borderColor }]} testID="channel-poll-option">
            <View style={[styles.pollBar, { width: `${showStats ? pct : 0}%` }]} />
            <View style={styles.pollOptRow}>
              <Text style={styles.pollOptText} numberOfLines={2}>
                {revealed && poll.is_quiz && isC ? "✓ " : revealed && poll.is_quiz && mine ? "✗ " : mine ? "• " : ""}{o.text}
              </Text>
              <Text style={styles.pollOptPct}>{showStats ? `${pct}% · ${o.count}` : ""}</Text>
            </View>
          </TouchableOpacity>
        );
      })}
      {revealed && poll.is_quiz && !!poll.explanation && (
        <View style={styles.pollExplain}><Text style={styles.pollExplainText}>💡 {poll.explanation}</Text></View>
      )}
      <View style={styles.pollFoot}>
        <Text style={styles.pollFootText}>{showStats ? `${total} ${lang === "en" ? "votes" : "voti"} · ` : ""}{lang === "en" ? "anonymous" : "anonimo"}</Text>
        <View style={{ flexDirection: "row", gap: 12 }}>
          {poll.closed ? (
            <Text style={styles.pollClosed}>{lang === "en" ? "closed" : "chiuso"}</Text>
          ) : (manage && (
            <TouchableOpacity onPress={() => onClose(poll.poll_id)} testID="channel-poll-close"><Text style={styles.pollAction}>{lang === "en" ? "Close" : "Chiudi"}</Text></TouchableOpacity>
          ))}
          {poll.can_edit && <TouchableOpacity onPress={() => onEdit && onEdit()} testID="channel-poll-edit"><Ionicons name="create-outline" size={16} color="#50C878" /></TouchableOpacity>}
          {manage && <TouchableOpacity onPress={() => onDelete(poll.poll_id)} testID="channel-poll-delete"><Ionicons name="trash-outline" size={16} color={theme.danger} /></TouchableOpacity>}
        </View>
      </View>
    </View>
  );
}

// ── Menu azioni messaggio ──
function PostActionSheet({ post, me, isAdmin, lang, onClose, onReact, onReply, onEdit, onPin, onDelete, onReport, onTranslate }) {
  const mine = (post.from_lns || "").toLowerCase() === me;
  const canDelete = mine || isAdmin;
  const isStruct = (post.body || "").indexOf(CAMBIO_PREFIX) === 0 || (post.body || "").indexOf(CONCORSO_PREFIX) === 0;
  const canEdit = mine && !isStruct && !((post.atts || []).length);
  const canTranslate = !!(post.body) && !isStruct;
  const dl = canTranslate ? detectLang(post.body) : null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetWrap} onPress={onClose}>
        <Pressable style={styles.sheet}>
          <View style={styles.emojiRow}>
            {EMOJI.map((em) => (
              <TouchableOpacity key={em} onPress={() => onReact(em)} style={styles.emojiBtn} testID={`channel-react-${em}`}>
                <Text style={styles.emojiText}>{em}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.sheetItem} onPress={onReply} testID="channel-action-reply">
            <Ionicons name="arrow-undo-outline" size={18} color={theme.text} />
            <Text style={styles.sheetItemText}>{lang === "en" ? "Reply" : "Rispondi"}</Text>
          </TouchableOpacity>
          {canTranslate && (
            <TouchableOpacity style={styles.sheetItem} onPress={onTranslate} testID="channel-action-translate">
              <Ionicons name="language-outline" size={18} color={theme.text} />
              <Text style={styles.sheetItemText}>{(lang === "en" ? "Translate text" : "Traduci testo")}{dl ? "  " + langFlag(dl) : ""}</Text>
            </TouchableOpacity>
          )}
          {canEdit && (
            <TouchableOpacity style={styles.sheetItem} onPress={onEdit} testID="channel-action-edit">
              <Ionicons name="create-outline" size={18} color={theme.text} />
              <Text style={styles.sheetItemText}>{lang === "en" ? "Edit" : "Modifica"}</Text>
            </TouchableOpacity>
          )}
          {isAdmin && (
            <TouchableOpacity style={styles.sheetItem} onPress={onPin} testID="channel-action-pin">
              <Ionicons name={post.pinned ? "remove-circle-outline" : "pin"} size={18} color={theme.primary} />
              <Text style={styles.sheetItemText}>{post.pinned ? (lang === "en" ? "Unpin" : "Rimuovi dai fissati") : (lang === "en" ? "Pin message" : "Fissa messaggio")}</Text>
            </TouchableOpacity>
          )}
          {canDelete && (
            <TouchableOpacity style={styles.sheetItem} onPress={onDelete} testID="channel-action-delete">
              <Ionicons name="trash-outline" size={18} color={theme.danger} />
              <Text style={[styles.sheetItemText, { color: theme.danger }]}>{lang === "en" ? "Delete" : "Elimina"}</Text>
            </TouchableOpacity>
          )}
          {!mine && (
            <TouchableOpacity style={styles.sheetItem} onPress={onReport} testID="channel-action-report">
              <Ionicons name="flag-outline" size={18} color="#50C878" />
              <Text style={[styles.sheetItemText, { color: "#50C878" }]}>{lang === "en" ? "Report" : "Segnala"}</Text>
            </TouchableOpacity>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Modale creazione sondaggio / quiz ──
function RipassoModal({ lang, pool, wrongPool, chan_id, onAnswered, onClose }) {
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState(null);
  const [fb, setFb] = useState(null);
  const [busy, setBusy] = useState(false);
  const poolRef = React.useRef(pool);
  poolRef.current = pool;
  const wrongRef = React.useRef(wrongPool);
  wrongRef.current = wrongPool;
  const pick = React.useCallback(() => {
    setFb(null);
    const pl = cat === "wrong" ? (wrongRef.current || []) : (poolRef.current || []).filter((p) => cat === "all" || (p.category || "") === cat);
    setQ(pl.length ? pl[Math.floor(Math.random() * pl.length)] : null);
  }, [cat]);
  React.useEffect(() => { pick(); }, [pick]);
  const answer = async (opt) => {
    if (busy || fb || !q) return;
    const already = Array.isArray(q.correct) && q.correct.length && q.my_vote !== null && q.my_vote !== undefined;
    if (already) { setFb({ correct: q.correct, expl: q.explanation || "", chosen: opt }); return; }
    setBusy(true);
    try {
      const r = await api.channelVotePoll(chan_id, q.poll_id, opt);
      setFb({ correct: Array.isArray(r.correct) ? r.correct : [], expl: r.explanation || "", chosen: opt });
      onAnswered && onAnswered(q.poll_id, opt, r);
    } catch (e) { setFb({ error: api.apiErr(e) }); }
    finally { setBusy(false); }
  };
  const chips = [["all", lang === "en" ? "All" : "Tutte"], ["oss", "OSS"], ["law", lang === "en" ? "Law" : "Legge"], ["wrong", lang === "en" ? "Wrong" : "Sbagliate"]];
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalWrap}>
        <View style={styles.modal}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>🎯 {lang === "en" ? "Practice" : "Ripasso"}</Text>
            <TouchableOpacity onPress={onClose} testID="ripasso-close"><Ionicons name="close-outline" size={24} color={theme.textDim} /></TouchableOpacity>
          </View>
          <View style={{ flexDirection: "row", marginBottom: 12 }}>
            {chips.map((c) => (
              <TouchableOpacity key={c[0]} onPress={() => setCat(c[0])} style={[styles.ripChip, cat === c[0] && styles.ripChipOn]} testID={`ripasso-cat-${c[0]}`}>
                <Text style={[styles.ripChipText, cat === c[0] && { color: "#fff" }]}>{c[1]}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {!q ? (
            <View style={{ alignItems: "center", padding: 30 }}>
              <Text style={{ fontSize: 40 }}>🎉</Text>
              <Text style={{ color: theme.text, fontSize: 15, marginTop: 8, textAlign: "center" }}>{lang === "en" ? "You answered all quizzes!" : "Hai risposto a tutti i quiz!"}</Text>
            </View>
          ) : (
            <>
              <ScrollView style={{ maxHeight: 330 }} keyboardShouldPersistTaps="handled">
                <Text style={styles.ripQ}>{q.question}</Text>
                {(q.options || []).map((o, i) => {
                  let bc = theme.border, bg = "#0d0d0d";
                  if (fb && !fb.error) { if (fb.correct.indexOf(i) >= 0) { bc = "#22c55e"; bg = "rgba(34,197,94,0.14)"; } else if (i === fb.chosen) { bc = "#ff5555"; bg = "rgba(255,85,85,0.14)"; } }
                  return (
                    <TouchableOpacity key={i} disabled={!!fb || busy} onPress={() => answer(i)} style={[styles.ripOpt, { borderColor: bc, backgroundColor: bg }]} testID={`ripasso-option-${i}`}>
                      <Text style={styles.ripOptText}>{o.text}</Text>
                    </TouchableOpacity>
                  );
                })}
                {fb && !fb.error && !!fb.expl && <View style={styles.pollExplain}><Text style={styles.pollExplainText}>💡 {fb.expl}</Text></View>}
                {fb && fb.error && <Text style={{ color: "#ff5555", marginTop: 10 }}>{fb.error}</Text>}
              </ScrollView>
              {fb && !fb.error && (
                <View style={styles.ripFooter}>
                  <Text style={{ fontWeight: "800", fontSize: 15, color: fb.correct.indexOf(fb.chosen) >= 0 ? "#22c55e" : "#ff5555" }}>
                    {fb.correct.indexOf(fb.chosen) >= 0 ? (lang === "en" ? "✓ Correct!" : "✓ Giusto!") : (lang === "en" ? "✗ Wrong" : "✗ Sbagliato")}
                  </Text>
                  <TouchableOpacity style={[styles.addBtn, { marginTop: 8 }]} onPress={pick} testID="ripasso-next"><Text style={styles.addBtnText}>{lang === "en" ? "Next question →" : "Prossima domanda →"}</Text></TouchableOpacity>
                </View>
              )}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function PollFormModal({ lang, busy, onClose, onSubmit, initial }) {
  const initOpts = (initial?.options || []).map((x) => (typeof x === "string" ? x : (x.text || "")));
  const initEC = initial && Array.isArray(initial.edit_correct) ? initial.edit_correct : [];
  const [q, setQ] = useState(initial?.question || "");
  const [desc, setDesc] = useState(initial?.description || "");
  const [opts, setOpts] = useState(initOpts.length >= 2 ? initOpts : ["", ""]);
  const [quiz, setQuiz] = useState(!!(initial && (initial.is_quiz || initEC.length)));
  const [correct, setCorrect] = useState(initEC.length ? initEC[0] : null);
  const [explanation, setExplanation] = useState(initial?.edit_explanation || "");
  const [msg, setMsg] = useState("");

  const setOpt = (i, v) => setOpts((o) => o.map((x, j) => (j === i ? v : x)));
  const addOpt = () => { if (opts.length < 12) setOpts((o) => [...o, ""]); };

  const submit = () => {
    const question = q.trim();
    const options = opts.map((o) => o.trim()).filter(Boolean);
    if (!question || options.length < 2) { setMsg(lang === "en" ? "Question and 2+ options" : "Domanda e almeno 2 opzioni"); return; }
    if (quiz && correct === null) { setMsg(lang === "en" ? "Mark the correct answer" : "Segna la risposta corretta"); return; }
    // riallineo l'indice corretto sulle sole opzioni non vuote
    let correctIdx = [];
    if (quiz && correct !== null) {
      const filled = [];
      opts.forEach((o, i) => { if (o.trim()) filled.push(i); });
      const pos = filled.indexOf(correct);
      if (pos >= 0) correctIdx = [pos];
    }
    const payload = { question, description: desc.trim(), options };
    if (quiz) { payload.correct = correctIdx; payload.explanation = explanation.trim(); }
    onSubmit(payload);
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalWrap}>
        <View style={styles.modal}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>📊 {initial ? (lang === "en" ? "Edit poll" : "Modifica sondaggio") : (lang === "en" ? "New poll" : "Nuovo sondaggio")}</Text>
            <TouchableOpacity onPress={onClose}><Ionicons name="close-outline" size={24} color={theme.textDim} /></TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: "82%" }} keyboardShouldPersistTaps="handled">
            <TextInput style={styles.infoInput} placeholder={lang === "en" ? "Ask a question" : "Fai una domanda"} placeholderTextColor={theme.textFaint}
              selectionColor={theme.primary} cursorColor={theme.text} keyboardAppearance="dark" value={q} onChangeText={setQ} testID="poll-question" />
            <TextInput style={[styles.infoInput, { marginTop: 8 }]} placeholder={lang === "en" ? "Description (optional)" : "Descrizione (opzionale)"} placeholderTextColor={theme.textFaint}
              selectionColor={theme.primary} cursorColor={theme.text} keyboardAppearance="dark" value={desc} onChangeText={setDesc} />
            {opts.map((o, i) => (
              <View key={i} style={styles.pollOptEdit}>
                {quiz && (
                  <TouchableOpacity onPress={() => setCorrect(i)} style={[styles.correctBtn, correct === i && styles.correctBtnOn]} testID={`poll-correct-${i}`}>
                    <Ionicons name="checkmark-outline" size={16} color={correct === i ? "#04120a" : "#22c55e"} />
                  </TouchableOpacity>
                )}
                <TextInput style={[styles.infoInput, { flex: 1 }]} placeholder={`${lang === "en" ? "Option" : "Opzione"} ${i + 1}`} placeholderTextColor={theme.textFaint}
                  selectionColor={theme.primary} cursorColor={theme.text} keyboardAppearance="dark" value={o} onChangeText={(v) => setOpt(i, v)} testID={`poll-option-${i}`} />
              </View>
            ))}
            <TouchableOpacity onPress={addOpt} style={{ paddingVertical: 8 }} testID="poll-add-option"><Text style={{ color: theme.primary, fontWeight: "700" }}>+ {lang === "en" ? "Add option" : "Aggiungi opzione"}</Text></TouchableOpacity>
            <View style={styles.quizToggle}>
              <Text style={{ color: theme.text, fontSize: 14, flex: 1 }}>{lang === "en" ? "Quiz mode" : "Modalità quiz"}</Text>
              <Switch value={quiz} onValueChange={(v) => { setQuiz(v); if (!v) setCorrect(null); }} trackColor={{ true: theme.primary }} testID="poll-quiz-toggle" />
            </View>
            {quiz && (
              <TextInput style={[styles.infoInput, { minHeight: 60, textAlignVertical: "top" }]} placeholder={lang === "en" ? "Explanation (optional)" : "Spiegazione (opzionale)"} placeholderTextColor={theme.textFaint}
                selectionColor={theme.primary} cursorColor={theme.text} keyboardAppearance="dark" value={explanation} onChangeText={setExplanation} multiline />
            )}
            {!!msg && <Text style={{ color: "#ff5555", marginTop: 8 }}>{msg}</Text>}
          </ScrollView>
          <TouchableOpacity style={styles.addBtn} onPress={submit} disabled={busy} testID="poll-submit">
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.addBtnText}>{initial ? (lang === "en" ? "Save changes" : "Salva modifiche") : (lang === "en" ? "Send poll" : "Invia sondaggio")}</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Modale prompt generica (per nuovo sotto-gruppo) ──
function EditMessageModal({ initial, lang, onCancel, onSubmit }) {
  const [val, setVal] = useState(initial || "");
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.promptWrap}>
        <View style={styles.promptBox}>
          <Text style={styles.promptTitle}>{lang === "en" ? "Edit message" : "Modifica messaggio"}</Text>
          <TextInput style={[styles.infoInput, { minHeight: 80, textAlignVertical: "top" }]} placeholder={lang === "en" ? "Message…" : "Messaggio…"} placeholderTextColor={theme.textFaint} autoFocus multiline
            selectionColor={theme.primary} cursorColor={theme.text} keyboardAppearance="dark" value={val} onChangeText={setVal} testID="edit-message-input" />
          <View style={styles.promptBtns}>
            <TouchableOpacity onPress={onCancel}><Text style={styles.promptCancel}>{lang === "en" ? "Cancel" : "Annulla"}</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => onSubmit(val)} testID="edit-message-submit"><Text style={styles.promptOk}>{lang === "en" ? "Save" : "Salva"}</Text></TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function PromptModal({ title, placeholder, lang, onCancel, onSubmit }) {  const [val, setVal] = useState("");
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.promptWrap}>
        <View style={styles.promptBox}>
          <Text style={styles.promptTitle}>{title}</Text>
          <TextInput style={styles.infoInput} placeholder={placeholder} placeholderTextColor={theme.textFaint} autoFocus
            selectionColor={theme.primary} cursorColor={theme.text} keyboardAppearance="dark" value={val} onChangeText={setVal} testID="topic-name-input" />
          <View style={styles.promptBtns}>
            <TouchableOpacity onPress={onCancel}><Text style={styles.promptCancel}>{lang === "en" ? "Cancel" : "Annulla"}</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => onSubmit(val)} testID="topic-create-submit"><Text style={styles.promptOk}>{lang === "en" ? "Create" : "Crea"}</Text></TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ManageModal({ detail, user, groupKey, t, lang, onClose, onDeleted, onChanged }) {
  const [members, setMembers] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [sel, setSel] = useState({});
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("list");
  const [name, setName] = useState(detail.name || "");
  const [desc, setDesc] = useState(detail.description || "");
  const [avatar, setAvatar] = useState(detail.avatar || "");
  const [publicJoin, setPublicJoin] = useState(!!detail.public_join);
  const [reqs, setReqs] = useState([]);
  const [reqBusy, setReqBusy] = useState("");
  const [savingInfo, setSavingInfo] = useState(false);
  // Nome del gruppo: nei gruppi privati va al server CIFRATO con la chiave di gruppo, e in
  // chiaro resta solo un'etichetta fissa. Nei gruppi pubblici (cercabili per nome) resta in
  // chiaro: iv vuoto dice al server di dimenticare la versione cifrata.
  const nameFields = (plainName, isPublic) => {
    const g = require("../lib/gname");
    const nm = String(plainName || "").trim();
    if (isPublic || !groupKey) return { name: nm, name_enc: { iv: "", ct: "" } };
    return { name: g.PLACEHOLDER, name_enc: g.sealName(nm, groupKey) };
  };
  const isOwner = detail.owner_lns === user.lns;

  // La foto del gruppo viene salvata SUBITO: se l'app si chiude o si riblocca prima del
  // salvataggio manuale, la scelta non va persa.
  const pickAvatar = async () => {
    const { denied, dataUrl, error } = await pickAvatarDataUrl();
    if (denied) { Alert.alert(t("profile.avatar.denied"), t("profile.avatar.deniedText")); return; }
    if (error) { Alert.alert(t("att.error"), t("groups.avatarUnreadable")); return; }
    if (!dataUrl) return;
    setAvatar(dataUrl);
    if (!name.trim()) return;
    setSavingInfo(true);
    try {
      await api.channelUpdate(detail.chan_id, Object.assign(nameFields(name, publicJoin), { description: desc.trim(), avatar: dataUrl, public_join: publicJoin }));
      onChanged();
    } catch (e) { Alert.alert(t("att.error"), api.apiErr(e)); }
    finally { setSavingInfo(false); }
  };
  // Condivisione del gruppo: link pubblico da cui si chiede di entrare (gli admin
  // approvano dalla scheda RICHIESTE). Richiede l'ingresso su richiesta attivo.
  // Aggiunge un membro del gruppo alla propria rubrica: per scriversi in privato serve
  // il contatto reciproco (regola prodotto).
  const addMemberToBook = async (lns) => {
    try {
      await api.addContact(lns);
      Alert.alert(
        lang === "en" ? "Added to address book" : "Aggiunto in rubrica",
        lang === "en"
          ? "To chat privately they must add you back too: the contact has to be mutual."
          : "Per scrivervi in privato deve aggiungere anche te: il contatto deve essere reciproco.",
      );
    } catch (e) { Alert.alert(t("att.error"), api.apiErr(e)); }
  };

  const shareGroup = async () => {
    const link = `${api.getServerUrl()}/invito.html?g=${encodeURIComponent(detail.chan_id)}`;
    const doShare = () => Share.share({
      message: (lang === "en" ? `Join "${name || detail.name}" on Lattice Network:\n` : `Entra nel gruppo "${name || detail.name}" su Lattice Network:\n`) + link,
      url: link,
    }).catch(() => {});
    if (publicJoin) { doShare(); return; }
    Alert.alert(
      lang === "en" ? "Enable join requests?" : "Attivo l'ingresso su richiesta?",
      lang === "en"
        ? "To let people join with the link the group must accept join requests. Admins still approve every request."
        : "Perché il link funzioni il gruppo deve accettare le richieste di ingresso. Gli amministratori approvano comunque ogni richiesta.",
      [
        { text: t("cancel"), style: "cancel" },
        {
          text: lang === "en" ? "Enable and share" : "Attiva e condividi",
          onPress: async () => {
            try {
              await api.channelUpdate(detail.chan_id, Object.assign(nameFields(name || detail.name, true), { description: desc.trim(), avatar, public_join: true }));
              setPublicJoin(true); onChanged(); doShare();
            } catch (e) { Alert.alert(t("att.error"), api.apiErr(e)); }
          },
        },
      ],
    );
  };

  const saveInfo = async () => {
    if (!name.trim()) { Alert.alert(t("att.error"), t("groups.nameRequired")); return; }
    setSavingInfo(true);
    try {
      await api.channelUpdate(detail.chan_id, Object.assign(nameFields(name, publicJoin), { description: desc.trim(), avatar, public_join: publicJoin }));
      onChanged();
      onClose();
    } catch (e) { Alert.alert(t("att.error"), api.apiErr(e)); }
    finally { setSavingInfo(false); }
  };

  const load = useCallback(async () => {
    try { const d = await api.channelMembers(detail.chan_id); setMembers(Array.isArray(d) ? d : []); } catch { /* */ }
    try { const r = await api.groupJoinRequests(detail.chan_id); setReqs(Array.isArray(r?.items) ? r.items : []); } catch { /* */ }
  }, [detail.chan_id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.contacts().then((d) => {
      const have = new Set(members.map((m) => m.lns));
      setContacts((Array.isArray(d) ? d : []).filter((c) => c.has_key && !have.has(c.lns)));
    }).catch(() => {});
  }, [members]);

  const toggle = (lns) => setSel((s) => ({ ...s, [lns]: !s[lns] }));
  const chosen = Object.keys(sel).filter((k) => sel[k]);

  const addMembers = async () => {
    if (chosen.length === 0 || !groupKey) return;
    setBusy(true);
    try {
      const keyMap = await api.pulseKeys(chosen);
      const payload = [];
      for (const lns of chosen) { if (keyMap[lns]) payload.push({ lns, role: "member", key_env: wrapGroupKeyFor(groupKey, keyMap[lns]) }); }
      await api.channelAddMembers(detail.chan_id, payload);
      setSel({}); setTab("list"); await load(); onChanged();
    } catch (e) { Alert.alert("Errore", api.apiErr(e)); } finally { setBusy(false); }
  };
  const remove = (lns) => api.channelRemoveMember(detail.chan_id, lns).then(() => { load(); onChanged(); }).catch(() => {});

  // Accetta la richiesta: la chiave di gruppo viene avvolta qui, sul device dell'admin.
  const acceptReq = async (it) => {
    if (!groupKey) { Alert.alert("Errore", "Chiave del gruppo non disponibile: riapri il gruppo e riprova."); return; }
    if (!it.kem_pk) { Alert.alert("Errore", "Chiave pubblica del richiedente non disponibile."); return; }
    setReqBusy(it.lns);
    try {
      await api.groupJoinApprove(detail.chan_id, it.lns, wrapGroupKeyFor(groupKey, it.kem_pk), "member");
      await load(); onChanged();
    } catch (e) { Alert.alert("Errore", api.apiErr(e)); }
    finally { setReqBusy(""); }
  };
  const rejectReq = (it) => Alert.alert("Rifiuta richiesta", `Rifiutare la richiesta di ${it.display_name || it.lns}?`, [
    { text: "Annulla", style: "cancel" },
    {
      text: "Rifiuta", style: "destructive",
      onPress: async () => {
        setReqBusy(it.lns);
        try { await api.groupJoinReject(detail.chan_id, it.lns); await load(); }
        catch (e) { Alert.alert("Errore", api.apiErr(e)); }
        finally { setReqBusy(""); }
      },
    },
  ]);
  const leave = () => Alert.alert("Esci dal gruppo", `Uscire da «${detail.name}»? Non riceverai più i messaggi.`, [
    { text: "Annulla", style: "cancel" },
    {
      text: "Esci", style: "destructive",
      onPress: async () => {
        try { await api.groupLeave(detail.chan_id); onDeleted(); }
        catch (e) { Alert.alert("Errore", api.apiErr(e)); }
      },
    },
  ]);
  const setRole = (lns, role) => api.channelSetRole(detail.chan_id, lns, role).then(load).catch(() => {});
  const del = () => Alert.alert(t("channels.delete"), t("channels.confirmDelete"), [
    { text: t("cancel"), style: "cancel" },
    { text: t("channels.delete"), style: "destructive", onPress: () => api.channelDelete(detail.chan_id).then(onDeleted).catch(() => {}) },
  ]);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalWrap}>
        <View style={styles.modal}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>{detail.name}</Text>
            <TouchableOpacity onPress={onClose}><Ionicons name="close-outline" size={24} color={theme.textDim} /></TouchableOpacity>
          </View>
          <View style={styles.tabs}>
            <TouchableOpacity onPress={() => setTab("list")}><Text style={[styles.tab, tab === "list" && styles.tabOn]}>{t("channels.members")}</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setTab("add")} testID="channel-add-members-tab"><Text style={[styles.tab, tab === "add" && styles.tabOn]}>{t("channels.addMembers")}</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setTab("info")} testID="channel-info-tab"><Text style={[styles.tab, tab === "info" && styles.tabOn]}>{lang === "en" ? "Info" : "Info"}</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setTab("reqs")} testID="channel-requests-tab"><Text style={[styles.tab, tab === "reqs" && styles.tabOn]}>{(lang === "en" ? "Requests" : "Richieste") + (reqs.length ? ` (${reqs.length})` : "")}</Text></TouchableOpacity>
          </View>
          {tab === "reqs" ? (
            <FlatList
              data={reqs}
              keyExtractor={(r) => r.lns}
              style={{ maxHeight: 340 }}
              ListEmptyComponent={<Text style={styles.empty}>{lang === "en" ? "No pending requests." : "Nessuna richiesta in attesa."}</Text>}
              renderItem={({ item }) => (
                <View style={styles.mrow} testID="channel-request-row">
                  <View style={{ flex: 1 }}>
                    <Text style={styles.mname} numberOfLines={1}>{item.display_name || item.lns.split("@")[0]}</Text>
                    <Text style={styles.mlns} numberOfLines={1}>{item.lns}</Text>
                  </View>
                  <TouchableOpacity onPress={() => acceptReq(item)} disabled={reqBusy === item.lns} testID="channel-request-accept">
                    <Ionicons name="checkmark-circle-outline" size={24} color={theme.accent} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => rejectReq(item)} disabled={reqBusy === item.lns} testID="channel-request-reject">
                    <Ionicons name="close-circle-outline" size={24} color={theme.danger} />
                  </TouchableOpacity>
                </View>
              )}
            />
          ) : tab === "info" ? (
            <View testID="channel-info-panel">
              <TouchableOpacity style={styles.avatarEdit} onPress={pickAvatar} testID="channel-avatar-btn">
                {avatar ? <Image source={{ uri: avatar }} style={styles.avatarImg} /> : <Ionicons name="people-outline" size={34} color={theme.primary} />}
                <Text style={styles.avatarEditTxt}>{lang === "en" ? "CHANGE PHOTO" : "CAMBIA FOTO"}</Text>
              </TouchableOpacity>
              <Text style={styles.infoLbl}>{lang === "en" ? "Group name" : "Nome del gruppo"}</Text>
              <TextInput style={styles.infoInput} value={name} onChangeText={setName} placeholder={t("groups.name")} placeholderTextColor={theme.textFaint} selectionColor={theme.primary} cursorColor={theme.text} keyboardAppearance="dark" testID="channel-name-input" />
              <Text style={styles.infoLbl}>{lang === "en" ? "Description" : "Descrizione"}</Text>
              <TextInput style={[styles.infoInput, { height: 84, textAlignVertical: "top" }]} value={desc} onChangeText={setDesc} placeholder={lang === "en" ? "What is this group about?" : "Di cosa si occupa questo gruppo?"} placeholderTextColor={theme.textFaint} selectionColor={theme.primary} cursorColor={theme.text} keyboardAppearance="dark" multiline testID="channel-desc-input" />
              <TouchableOpacity style={styles.pubRow} onPress={() => setPublicJoin((v) => !v)} testID="channel-public-toggle">
                <Ionicons name={publicJoin ? "checkbox" : "square-outline"} size={22} color={publicJoin ? theme.primary : theme.textFaint} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.mname}>{lang === "en" ? "Public group" : "Gruppo pubblico"}</Text>
                  <Text style={styles.mlns}>{lang === "en" ? "Findable in search: people can ask to join and admins approve." : "Trovabile nella ricerca: si può chiedere di entrare e gli admin approvano."}</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.addBtn} onPress={saveInfo} disabled={savingInfo} testID="channel-info-save">
                {savingInfo ? <ActivityIndicator color="#fff" /> : <Text style={styles.addBtnText}>{lang === "en" ? "Save changes" : "Salva modifiche"}</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.shareGroupBtn} onPress={shareGroup} testID="channel-share-btn">
                <Ionicons name="share-social-outline" size={16} color={theme.primary} />
                <Text style={styles.shareGroupTxt}>{lang === "en" ? "Share group (invite link)" : "Condividi gruppo (link d'invito)"}</Text>
              </TouchableOpacity>
            </View>
          ) : tab === "list" ? (
            <FlatList
              data={members}
              keyExtractor={(m) => m.lns}
              style={{ maxHeight: 340 }}
              renderItem={({ item }) => (
                <View style={styles.mrow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.mname} numberOfLines={1}>{item.display_name || item.lns.split("@")[0]}{item.lns === user.lns ? ` (${t("channels.you")})` : ""}</Text>
                    <Text style={styles.mlns} numberOfLines={1}>{item.lns}</Text>
                  </View>
                  <Text style={[styles.mrole, item.role === "admin" && styles.mroleAdmin]}>{item.role === "admin" ? t("channels.admin") : t("channels.member")}</Text>
                  {item.lns !== user.lns && (
                    <TouchableOpacity onPress={() => addMemberToBook(item.lns)} testID="channel-member-add-contact" hitSlop={6}>
                      <Ionicons name="person-add-outline" size={19} color={theme.primary} />
                    </TouchableOpacity>
                  )}
                  {isOwner && item.lns !== detail.owner_lns && (
                    <>
                      <TouchableOpacity onPress={() => setRole(item.lns, item.role === "admin" ? "member" : "admin")}><Ionicons name="ribbon-outline" size={20} color="#ffb300" /></TouchableOpacity>
                      <TouchableOpacity onPress={() => remove(item.lns)} testID="channel-remove-member"><Ionicons name="trash-outline" size={20} color={theme.danger} /></TouchableOpacity>
                    </>
                  )}
                </View>
              )}
            />
          ) : (
            <>
              <FlatList
                data={contacts}
                keyExtractor={(c) => c.lns}
                style={{ maxHeight: 300 }}
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={<Text style={styles.empty}>{t("channels.noMembers")}</Text>}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.mrow} onPress={() => toggle(item.lns)}>
                    <Ionicons name={sel[item.lns] ? "checkbox" : "square-outline"} size={22} color={sel[item.lns] ? theme.primary : theme.textFaint} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.mname} numberOfLines={1}>{item.display_name || item.lns.split("@")[0]}</Text>
                      <Text style={styles.mlns} numberOfLines={1}>{item.lns}{item.same_company ? "" : (lang === "en" ? "  · external" : "  · esterno")}</Text>
                    </View>
                  </TouchableOpacity>
                )}
              />
              {contacts.length > 0 && (
                <TouchableOpacity style={styles.addBtn} onPress={addMembers} disabled={busy || chosen.length === 0} testID="channel-add-members-submit">
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.addBtnText}>{t("channels.addMembers")} ({chosen.length})</Text>}
                </TouchableOpacity>
              )}
            </>
          )}
          {isOwner && (
            <TouchableOpacity style={styles.delBtn} onPress={del} testID="channel-delete-btn">
              <Ionicons name="trash-outline" size={16} color={theme.danger} />
              <Text style={styles.delText}>{t("channels.delete")}</Text>
            </TouchableOpacity>
          )}
          {!isOwner && (
            <TouchableOpacity style={styles.delBtn} onPress={leave} testID="channel-leave-btn">
              <Ionicons name="exit-outline" size={16} color={theme.danger} />
              <Text style={styles.delText}>{lang === "en" ? "Leave group" : "Esci dal gruppo"}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Riga etichetta:valore per card strutturate ──
function SRow({ label, val }) {
  if (!val) return null;
  return <Text style={styles.cRow}><Text style={styles.cLabel}>{label}: </Text>{String(val)}</Text>;
}

// ── Selettore regione a chip (scroll orizzontale) ──
function RegionSelect({ value, onChange, lang }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }} contentContainerStyle={{ alignItems: "center" }}>
      <TouchableOpacity onPress={() => onChange("")} style={[styles.regChip, !value && styles.regChipOn]}>
        <Text style={[styles.regChipText, !value && styles.regChipTextOn]}>{lang === "en" ? "None" : "—"}</Text>
      </TouchableOpacity>
      {REGIONI.map((r) => (
        <TouchableOpacity key={r} onPress={() => onChange(r)} style={[styles.regChip, value === r && styles.regChipOn]}>
          <Text style={[styles.regChipText, value === r && styles.regChipTextOn]} numberOfLines={1}>{r}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

// ── Card Cambio compensativo ──
function CambioCard({ data, mine, lang, onContact, onEdit, onMenu }) {
  const L = (it, en) => (lang === "en" ? en : it);
  const cur = data.current || {}, dst = data.dest || {};
  return (
    <View style={styles.structCard} testID="channel-cambio-card">
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
        <Text style={[styles.structTitle, { marginBottom: 0, flex: 1 }]}>🔁 {L("CAMBIO COMPENSATIVO", "SHIFT SWAP")}</Text>
        {onMenu && (
          <TouchableOpacity onPress={onMenu} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID="channel-cambio-menu">
            <Ionicons name="ellipsis-horizontal-outline" size={18} color={theme.textDim} />
          </TouchableOpacity>
        )}
      </View>
      <SRow label={L("Ruolo", "Role")} val={data.ruolo} />
      <SRow label={L("Livello", "Level")} val={data.livello} />
      <SRow label={L("Tipo cambio", "Swap type")} val={data.cambio ? (L("Cambio a", "Swap of") + " " + data.cambio) : ""} />
      <Text style={styles.structSection}>📍 {L("SITUAZIONE ATTUALE", "CURRENT")}</Text>
      <SRow label={L("Ospedale", "Hospital")} val={cur.ospedale} />
      <SRow label={L("Città", "City")} val={cur.citta} />
      <SRow label={L("Regione", "Region")} val={cur.regione} />
      <SRow label={L("Reparto", "Ward")} val={cur.reparto} />
      <SRow label={L("Orari", "Shifts")} val={cur.orari} />
      <SRow label={L("Limitazioni", "Limitations")} val={cur.limitazioni} />
      <Text style={styles.structSection}>🎯 {L("DESTINAZIONE", "DESTINATION")}</Text>
      <SRow label={L("Regione", "Region")} val={dst.regione} />
      <SRow label={L("Città", "City")} val={dst.citta} />
      <SRow label={L("Ospedale", "Hospital")} val={dst.ospedale} />
      <SRow label={L("Note", "Notes")} val={dst.note} />
      {!mine && (
        <TouchableOpacity style={styles.contactBtn} onPress={onContact} testID="channel-cambio-contact">
          <Text style={styles.contactBtnText}>💬 {L("Contatta via Pulse", "Contact via Pulse")}</Text>
        </TouchableOpacity>
      )}
      {mine && onEdit && (
        <TouchableOpacity style={styles.editBtn} onPress={onEdit} testID="channel-cambio-edit">
          <Text style={styles.editBtnText}>✏️ {L("Modifica cambio", "Edit swap")}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Card Concorso pubblico ──
function ConcorsoCard({ data, lang, onOpenPdf, onEdit, onMenu, onShare, liked, likeCount, onLike }) {
  const L = (it, en) => (lang === "en" ? en : it);
  const badge = scadBadge(data.scadenza, lang);
  const url = data.url ? (/^https?:\/\//i.test(data.url) ? data.url : "https://" + data.url) : "";
  return (
    <View style={styles.structCard} testID="channel-concorso-card">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <Text style={[styles.structTitle, { marginBottom: 0, flex: 1 }]}>🏛️ {L("CONCORSO PUBBLICO", "PUBLIC COMPETITION")}</Text>
        {badge && <Text style={[styles.cBadge, { backgroundColor: badge.bg }]}>⏳ {badge.txt}</Text>}
        {onLike && (
          <TouchableOpacity onPress={onLike} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ flexDirection: "row", alignItems: "center" }} testID="channel-concorso-like">
            <Ionicons name={liked ? "heart" : "heart-outline"} size={18} color={liked ? "#ef4444" : theme.textDim} />
            {likeCount > 0 && <Text style={styles.likeCount}>{likeCount}</Text>}
          </TouchableOpacity>
        )}
        {onShare && (
          <TouchableOpacity onPress={onShare} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID="channel-concorso-share">
            <Ionicons name="share-social-outline" size={17} color={theme.primary} />
          </TouchableOpacity>
        )}
        {onMenu && (
          <TouchableOpacity onPress={onMenu} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID="channel-concorso-menu">
            <Ionicons name="ellipsis-horizontal-outline" size={18} color={theme.textDim} />
          </TouchableOpacity>
        )}
      </View>
      {!!data.anteprima && <Text style={styles.cAnteprima}>{data.anteprima}</Text>}
      <SRow label={L("Scheda Occupazione", "Job profile")} val={data.scheda} />
      <SRow label={L("Ente", "Body")} val={data.ente} />
      <SRow label={L("Regione", "Region")} val={data.regione} />
      <SRow label={L("Località", "Location")} val={data.localita} />
      <SRow label={L("Posti", "Positions")} val={data.posti} />
      <SRow label={L("Scadenza", "Deadline")} val={data.scadenza} />
      <SRow label={L("Fonte", "Source")} val={data.fonte} />
      <SRow label={L("Tipo", "Type")} val={data.tipo} />
      <SRow label={L("Contratto", "Contract")} val={data.contratto} />
      {!!url && (
        <>
          <Text style={styles.structSection}>📮 {L("DOVE INVIARE LA DOMANDA", "WHERE TO APPLY")}</Text>
          <TouchableOpacity onPress={() => Linking.openURL(url).catch(() => {})} testID="channel-concorso-link">
            <Text style={styles.cLink}>🌐 {data.url}</Text>
          </TouchableOpacity>
        </>
      )}
      {data.pdf && (data.pdf.data || data.pdf.ref) && (
        <TouchableOpacity style={styles.pdfBtn} onPress={onOpenPdf} testID="channel-concorso-pdf">
          <Text style={styles.pdfBtnText}>📎 {data.pdf.name || L("Scarica PDF", "Download PDF")}</Text>
        </TouchableOpacity>
      )}
      {onEdit && (
        <TouchableOpacity style={styles.editBtn} onPress={onEdit} testID="channel-concorso-edit">
          <Text style={styles.editBtnText}>✏️ {L("Modifica concorso", "Edit competition")}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Modale Nuovo cambio compensativo ──
function CambioFormModal({ lang, busy, onClose, onSubmit, initial }) {
  const L = (it, en) => (lang === "en" ? en : it);
  const I = initial || {}, Ic = I.current || {}, Id = I.dest || {};
  const [f, setF] = useState({ ruolo: I.ruolo || "", livello: I.livello || "", cambio: I.cambio || "", cur_ospedale: Ic.ospedale || "", cur_citta: Ic.citta || "", cur_regione: Ic.regione || "", cur_reparto: Ic.reparto || "", cur_orari: Ic.orari || "", cur_limitazioni: Ic.limitazioni || "", dst_regione: Id.regione || "", dst_citta: Id.citta || "", dst_ospedale: Id.ospedale || "", dst_note: Id.note || "" });
  const [msg, setMsg] = useState("");
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));
  const inp = (k, ph) => (
    <TextInput style={[styles.infoInput, { marginTop: 8 }]} placeholder={ph} placeholderTextColor={theme.textFaint}
      selectionColor={theme.primary} cursorColor={theme.text} keyboardAppearance="dark" value={f[k]} onChangeText={(v) => set(k, v)} />
  );
  const submit = () => {
    if (!f.ruolo.trim() || !f.cur_ospedale.trim() || !f.cur_citta.trim() || !f.cur_regione || !f.cur_reparto.trim() || !f.dst_regione) {
      setMsg(L("Compila i campi obbligatori (*)", "Fill the required fields (*)")); return;
    }
    onSubmit({
      ruolo: f.ruolo.trim(), livello: f.livello.trim(), cambio: f.cambio,
      current: { ospedale: f.cur_ospedale.trim(), citta: f.cur_citta.trim(), regione: f.cur_regione, reparto: f.cur_reparto.trim(), orari: f.cur_orari.trim(), limitazioni: f.cur_limitazioni.trim() },
      dest: { regione: f.dst_regione, citta: f.dst_citta.trim(), ospedale: f.dst_ospedale.trim(), note: f.dst_note.trim() },
    });
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalWrap}>
        <View style={styles.modal}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>🔁 {initial ? L("Modifica cambio", "Edit swap") : L("Nuovo cambio", "New shift swap")}</Text>
            <TouchableOpacity onPress={onClose}><Ionicons name="close-outline" size={24} color={theme.textDim} /></TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: "82%" }} keyboardShouldPersistTaps="handled">
            {inp("ruolo", L("Ruolo (es. OSS) *", "Role *"))}
            {inp("livello", L("Livello", "Level"))}
            <View style={styles.swapTypeRow}>
              {["", "2", "3"].map((v) => (
                <TouchableOpacity key={v || "x"} onPress={() => set("cambio", v)} style={[styles.regChip, f.cambio === v && styles.regChipOn]}>
                  <Text style={[styles.regChipText, f.cambio === v && styles.regChipTextOn]}>{v ? L("Cambio a " + v, "Swap of " + v) : L("Tipo cambio", "Swap type")}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.structSection}>📍 {L("SITUAZIONE ATTUALE", "CURRENT")}</Text>
            {inp("cur_ospedale", L("Ospedale attuale *", "Current hospital *"))}
            {inp("cur_citta", L("Città attuale *", "Current city *"))}
            <Text style={styles.formLbl}>{L("Regione attuale *", "Current region *")}</Text>
            <RegionSelect value={f.cur_regione} onChange={(v) => set("cur_regione", v)} lang={lang} />
            {inp("cur_reparto", L("Reparto *", "Ward *"))}
            {inp("cur_orari", L("Orari (opzionale)", "Shifts (optional)"))}
            {inp("cur_limitazioni", L("Limitazioni (opzionale)", "Limitations (optional)"))}
            <Text style={styles.structSection}>🎯 {L("DESTINAZIONE", "DESTINATION")}</Text>
            <Text style={styles.formLbl}>{L("Regione destinazione *", "Destination region *")}</Text>
            <RegionSelect value={f.dst_regione} onChange={(v) => set("dst_regione", v)} lang={lang} />
            {inp("dst_citta", L("Città (opzionale)", "City (optional)"))}
            {inp("dst_ospedale", L("Ospedale (opzionale)", "Hospital (optional)"))}
            {inp("dst_note", L("Note (opzionale)", "Notes (optional)"))}
            {!!msg && <Text style={{ color: "#ff5555", marginTop: 8 }}>{msg}</Text>}
          </ScrollView>
          <TouchableOpacity style={styles.addBtn} onPress={submit} disabled={busy} testID="channel-cambio-send">
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.addBtnText}>{initial ? "✏️ " + L("Salva modifiche", "Save changes") : "📢 " + L("Pubblica cambio", "Publish swap")}</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Modale Nuovo concorso pubblico ──
function ConcorsoFormModal({ lang, busy, onClose, onSubmit, initial }) {
  const L = (it, en) => (lang === "en" ? en : it);
  const I = initial || {};
  const [f, setF] = useState({ anteprima: I.anteprima || "", scheda: I.scheda || "", ente: I.ente || "", regione: I.regione || "", localita: I.localita || "", posti: I.posti || "", scadenza: I.scadenza || "", fonte: I.fonte || "", tipo: I.tipo || "", contratto: I.contratto || "", url: I.url || "" });
  const [pdf, setPdf] = useState(I.pdf || null);
  const [msg, setMsg] = useState("");
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));
  const inp = (k, ph) => (
    <TextInput style={[styles.infoInput, { marginTop: 8 }]} placeholder={ph} placeholderTextColor={theme.textFaint}
      selectionColor={theme.primary} cursorColor={theme.text} keyboardAppearance="dark" value={f[k]} onChangeText={(v) => set(k, v)} />
  );
  const pickPdf = async () => {
    try {
      suppressLock();
      const r = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
      suppressLock();
      if (r.canceled || !r.assets || !r.assets[0]) return;
      const a = r.assets[0];
      if (a.size && a.size > 8 * 1024 * 1024) { setMsg(L("PDF troppo grande (max 8MB)", "PDF too large (max 8MB)")); return; }
      const b64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 });
      setPdf({ name: a.name || "bando.pdf", data: "data:application/pdf;base64," + b64 });
      setMsg("");
    } catch (e) { setMsg(String(e && e.message || e)); }
  };
  const submit = () => {
    if (!f.anteprima.trim() || !f.ente.trim()) { setMsg(L("Compila i campi obbligatori (*): Anteprima ed Ente", "Fill required fields (*): Preview and Body")); return; }
    onSubmit({ ...f, anteprima: f.anteprima.trim(), ente: f.ente.trim(), pdf });
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalWrap}>
        <View style={styles.modal}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>🏛️ {initial ? L("Modifica concorso", "Edit competition") : L("Nuovo concorso", "New competition")}</Text>
            <TouchableOpacity onPress={onClose}><Ionicons name="close-outline" size={24} color={theme.textDim} /></TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: "82%" }} keyboardShouldPersistTaps="handled">
            <TextInput style={[styles.infoInput, { minHeight: 70, textAlignVertical: "top" }]} placeholder={L("Anteprima / oggetto del concorso *", "Preview / subject *")} placeholderTextColor={theme.textFaint}
              selectionColor={theme.primary} cursorColor={theme.text} keyboardAppearance="dark" value={f.anteprima} onChangeText={(v) => set("anteprima", v)} multiline />
            {inp("scheda", L("Scheda Occupazione", "Job profile"))}
            {inp("ente", L("Ente *", "Body *"))}
            <Text style={styles.formLbl}>{L("Regione (per i filtri)", "Region (for filters)")}</Text>
            <RegionSelect value={f.regione} onChange={(v) => set("regione", v)} lang={lang} />
            {inp("localita", L("Località (città)", "Location (city)"))}
            {inp("posti", L("Posti (es. 84)", "Positions"))}
            {inp("scadenza", L("Scadenza (AAAA-MM-GG)", "Deadline (YYYY-MM-DD)"))}
            {inp("fonte", L("Fonte (es. gazzetta n.55…)", "Source"))}
            {inp("tipo", L("Tipo (es. Concorso)", "Type"))}
            {inp("contratto", L("Contratto (es. Tempo indeterminato)", "Contract"))}
            {inp("url", L("Dove va spedita la domanda (link)", "Where to apply (link)"))}
            <TouchableOpacity style={styles.pdfPick} onPress={pickPdf} testID="channel-concorso-pick-pdf">
              <Ionicons name="document-attach-outline" size={18} color={theme.primary} />
              <Text style={styles.pdfPickText}>{pdf ? ("📎 " + pdf.name) : L("Allega PDF (max 8MB)", "Attach PDF (max 8MB)")}</Text>
            </TouchableOpacity>
            {!!msg && <Text style={{ color: "#ff5555", marginTop: 8 }}>{msg}</Text>}
          </ScrollView>
          <TouchableOpacity style={styles.addBtn} onPress={submit} disabled={busy} testID="channel-concorso-send">
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.addBtnText}>{initial ? "✏️ " + L("Salva modifiche", "Save changes") : "🏛️ " + L("Pubblica concorso", "Publish competition")}</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function fmt(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const styles = StyleSheet.create({
  reorderOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 20 },
  reorderBox: { backgroundColor: "#12161C", borderRadius: 14, borderWidth: 1, borderColor: "#23324A", padding: 16 },
  reorderTitle: { color: "#E7ECF5", fontSize: 16, fontWeight: "800", marginBottom: 4 },
  reorderHint: { color: "#9AA4B2", fontSize: 12, marginBottom: 10 },
  reorderRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#1E2A3D" },
  reorderName: { flex: 1, color: "#E7ECF5", fontSize: 14, fontWeight: "600", paddingRight: 8 },
  reorderArrow: { padding: 8, marginLeft: 4, borderRadius: 8, backgroundColor: "#0B0F16", borderWidth: 1, borderColor: "#23324A" },
  reorderArrowOff: { opacity: 0.4 },
  reorderBtns: { flexDirection: "row", justifyContent: "flex-end", marginTop: 14 },
  reorderCancel: { paddingVertical: 10, paddingHorizontal: 16, marginRight: 8 },
  reorderCancelText: { color: "#9AA4B2", fontWeight: "700" },
  reorderSave: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10, backgroundColor: theme.primary },
  reorderSaveText: { color: "#fff", fontWeight: "800" },

  root: { flex: 1, backgroundColor: "transparent" },
  badgeBar: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.border, backgroundColor: theme.surface },
  gcallBanner: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#1f7a4d" },
  gcallBannerTxt: { color: "#fff", fontSize: 13, fontWeight: "700", flex: 1 },
  gcallJoin: { color: "#fff", fontSize: 13, fontWeight: "900", textDecorationLine: "underline" },
  badgeText: { color: theme.accent, fontSize: 11, fontWeight: "700", flex: 1 },
  manageBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: theme.border },
  manageText: { color: theme.primary, fontSize: 11, fontWeight: "700" },
  // Topic bar
  topicBar: { paddingLeft: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.border, backgroundColor: theme.surface },
  topicChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surfaceAlt, marginRight: 8, maxWidth: 180 },
  topicChipOn: { borderColor: theme.primary, backgroundColor: "rgba(80,200,120,0.2)" },
  topicChipText: { color: theme.textDim, fontSize: 12, fontWeight: "700" },
  topicChipTextOn: { color: "#fff" },
  topicAdd: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderStyle: "dashed", borderColor: theme.border, alignItems: "center", justifyContent: "center", marginRight: 8 },
  topicHint: { paddingHorizontal: 16, paddingVertical: 4 },
  topicHintText: { color: theme.textFaint, fontSize: 11 },
  // Post
  post: { backgroundColor: theme.surface, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: theme.border },
  postMine: { alignSelf: "flex-end", maxWidth: "82%", backgroundColor: "rgba(80,200,120,0.16)", borderColor: "rgba(80,200,120,0.38)", borderTopRightRadius: 4 },
  postOther: { alignSelf: "flex-start", maxWidth: "82%", borderTopLeftRadius: 4 },
  postHead: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  postFrom: { color: theme.primary, fontSize: 12, fontWeight: "700", flex: 1 },
  postTime: { color: theme.textFaint, fontSize: 11 },
  postEdited: { color: theme.textFaint, fontSize: 10, fontStyle: "italic", marginLeft: 4 },
  postMenuBtn: { paddingLeft: 10, paddingVertical: 2 },
  attachMenu: { position: "absolute", left: 10, bottom: 76, backgroundColor: theme.surfaceAlt, borderColor: theme.border, borderWidth: 1, borderRadius: 14, paddingVertical: 6, minWidth: 170, shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  attachItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 16 },
  attachItemText: { color: theme.text, fontSize: 15, fontWeight: "600" },
  postBody: { color: theme.text, fontSize: 15, lineHeight: 21 },
  quote: { borderLeftWidth: 3, borderLeftColor: theme.primary, paddingLeft: 8, marginBottom: 6, backgroundColor: "rgba(80,200,120,0.08)", paddingVertical: 3, borderRadius: 4 },
  quoteName: { color: theme.primary, fontSize: 12, fontWeight: "800" },
  quoteText: { color: theme.textDim, fontSize: 13 },
  rxRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  rxChip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surfaceAlt },
  rxChipMine: { borderColor: theme.primary, backgroundColor: "rgba(80,200,120,0.18)" },
  rxChipText: { color: "#fff", fontSize: 12 },
  // Poll
  pollCard: { backgroundColor: "#0d0d0d", borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: theme.border },
  pollHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  pollQuizBadge: { color: "#22c55e", borderWidth: 1, borderColor: "#22c55e", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, fontSize: 9, fontWeight: "800" },
  pollQ: { color: "#fff", fontSize: 15, fontWeight: "700", flex: 1 },
  pollShareBtn: { padding: 2 },
  likeCount: { color: theme.textDim, fontSize: 12, fontWeight: "700", marginLeft: 3 },
  pollDesc: { color: theme.textDim, fontSize: 12, marginBottom: 6 },
  pollOpt: { position: "relative", borderWidth: 1, borderRadius: 8, marginTop: 6, overflow: "hidden" },
  pollBar: { position: "absolute", top: 0, bottom: 0, left: 0, backgroundColor: "rgba(80,200,120,0.15)" },
  pollOptRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 10, paddingVertical: 9 },
  pollOptText: { color: "#fff", fontSize: 14, flex: 1, paddingRight: 8 },
  pollOptPct: { color: "#888", fontSize: 12 },
  pollExplain: { marginTop: 8, padding: 9, borderRadius: 8, backgroundColor: "rgba(34,197,94,0.1)", borderWidth: 1, borderColor: "rgba(34,197,94,0.3)" },
  pollExplainText: { color: "#bdf0cd", fontSize: 12 },
  quizBar: { flexDirection: "row", alignItems: "center", backgroundColor: "#0b0b0b", borderWidth: 1, borderColor: theme.primary, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12, marginHorizontal: 12, marginTop: 8 },
  quizBarText: { fontSize: 12, color: "#cfe0ff", flexWrap: "wrap" },
  quizBarBtn: { backgroundColor: theme.primary, borderRadius: 16, paddingVertical: 6, paddingHorizontal: 14 },
  quizBarBtnText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  quizResetBtn: { backgroundColor: "#2a1414", borderWidth: 1, borderColor: "#5a2a2a", borderRadius: 16, paddingVertical: 6, paddingHorizontal: 14, alignItems: "center" },
  quizResetBtnText: { color: "#ff8a94", fontSize: 12, fontWeight: "800" },
  pinBar: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(80,200,120,0.10)", borderLeftWidth: 3, borderLeftColor: theme.primary, borderBottomWidth: 1, borderBottomColor: theme.border, paddingVertical: 8, paddingHorizontal: 12 },
  pinBarLabel: { color: theme.primary, fontSize: 11, fontWeight: "700" },
  pinBarText: { color: theme.textDim, fontSize: 12 },
  ripQ: { fontSize: 16, fontWeight: "700", color: theme.text, marginBottom: 12, lineHeight: 22 },
  ripOpt: { borderWidth: 1, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 13, marginVertical: 5 },
  ripOptText: { color: theme.text, fontSize: 14 },
  ripChip: { borderWidth: 1, borderColor: theme.primary, borderRadius: 14, paddingVertical: 5, paddingHorizontal: 13, marginRight: 8 },
  ripChipOn: { backgroundColor: theme.primary },
  ripChipText: { color: "#cfe0ff", fontSize: 12, fontWeight: "700" },
  ripFooter: { borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 10, marginTop: 8 },
  pollFoot: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
  pollFootText: { color: "#888", fontSize: 11 },
  pollAction: { color: theme.textDim, fontSize: 12, fontWeight: "700" },
  pollClosed: { color: "#ff5555", fontSize: 11 },
  // Action sheet
  sheetWrap: { flex: 1, backgroundColor: "#0009", justifyContent: "flex-end" },
  sheet: { backgroundColor: theme.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 14, paddingBottom: 30, borderTopWidth: 1, borderColor: theme.border },
  emojiRow: { flexDirection: "row", justifyContent: "space-around", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border, marginBottom: 6 },
  emojiBtn: { padding: 6 },
  emojiText: { fontSize: 28 },
  sheetItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 6 },
  sheetItemText: { color: theme.text, fontSize: 16, fontWeight: "600" },
  // Poll form extras
  pollOptEdit: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  correctBtn: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: "#22c55e", alignItems: "center", justifyContent: "center" },
  correctBtnOn: { backgroundColor: "#22c55e" },
  quizToggle: { flexDirection: "row", alignItems: "center", marginTop: 14, marginBottom: 8 },
  // Prompt modal
  promptWrap: { flex: 1, backgroundColor: "#0009", alignItems: "center", justifyContent: "center", padding: 24 },
  promptBox: { width: "100%", backgroundColor: theme.surface, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: theme.border },
  promptTitle: { color: theme.text, fontSize: 16, fontWeight: "800", marginBottom: 12 },
  promptBtns: { flexDirection: "row", justifyContent: "flex-end", gap: 22, marginTop: 16 },
  promptCancel: { color: theme.textDim, fontSize: 14, fontWeight: "700" },
  promptOk: { color: theme.primary, fontSize: 14, fontWeight: "800" },
  // Common
  empty: { color: theme.textDim, fontSize: 14, textAlign: "center", marginTop: 40 },
  err: { color: "#FFB3BD", fontSize: 13, paddingHorizontal: 14, paddingVertical: 4 },
  replyBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.surfaceAlt },
  replyBarName: { color: theme.primary, fontSize: 12, fontWeight: "800" },
  replyBarText: { color: theme.textDim, fontSize: 13 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.surface },
  plusBtn: { width: 44, height: 46, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, backgroundColor: theme.surfaceAlt, borderRadius: 12, color: theme.text, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, maxHeight: 120 },
  sendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center" },
  modalWrap: { flex: 1, backgroundColor: "#000A", justifyContent: "flex-end" },
  modal: { backgroundColor: theme.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, borderTopWidth: 1, borderColor: theme.border, maxHeight: "88%" },
  modalHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  modalTitle: { color: theme.text, fontSize: 19, fontWeight: "800" },
  tabs: { flexDirection: "row", gap: 18, borderBottomWidth: 1, borderBottomColor: theme.border, marginBottom: 10 },
  tab: { color: theme.textDim, fontSize: 13, fontWeight: "700", paddingBottom: 8, textTransform: "uppercase" },
  tabOn: { color: theme.primary, borderBottomWidth: 2, borderBottomColor: theme.primary },
  mrow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border },
  mname: { color: theme.text, fontSize: 15, fontWeight: "700" },
  mlns: { color: theme.textFaint, fontSize: 11, marginTop: 1 },
  mrole: { color: theme.textDim, fontSize: 10, fontWeight: "700", textTransform: "uppercase", backgroundColor: theme.surfaceAlt, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  mroleAdmin: { color: "#ffb300", backgroundColor: "rgba(255,179,0,0.15)" },
  addBtn: { backgroundColor: theme.primary, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 12 },
  shareGroupBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: theme.primary, borderRadius: 12, paddingVertical: 13, marginTop: 10 },
  shareGroupTxt: { color: theme.primary, fontSize: 13, fontWeight: "800" },
  addBtnText: { color: "#fff", fontWeight: "700" },
  avatarEdit: { alignSelf: "center", width: 96, height: 96, borderRadius: 48, overflow: "hidden", backgroundColor: "rgba(80,200,120,0.15)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center", marginVertical: 8 },
  avatarImg: { width: "100%", height: "100%" },
  avatarEditTxt: { position: "absolute", bottom: 0, left: 0, right: 0, textAlign: "center", backgroundColor: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 8, paddingVertical: 3, letterSpacing: 1 },
  infoLbl: { color: theme.textFaint, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginTop: 14, marginBottom: 6 },
  infoInput: { backgroundColor: theme.surfaceAlt, borderWidth: 1, borderColor: theme.border, borderRadius: 10, color: theme.text, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15 },
  delBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: "rgba(255,51,51,0.4)", borderRadius: 12, paddingVertical: 13, marginTop: 14 },
  pubRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 },
  delText: { color: theme.danger, fontWeight: "700", textTransform: "uppercase", fontSize: 12 },
  // Cambio/Concorso strutturati
  structBtn: { marginHorizontal: 12, marginBottom: 6, backgroundColor: theme.primary, borderRadius: 10, paddingVertical: 11, alignItems: "center" },
  structBtnText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  structCard: { borderWidth: 1, borderColor: theme.primary, backgroundColor: "#0b0f16", borderRadius: 12, padding: 14, marginBottom: 10 },
  structTitle: { color: theme.primary, fontWeight: "800", fontSize: 14, marginBottom: 8 },
  structSection: { color: "#e7ecf5", fontWeight: "800", fontSize: 12, marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#1c2430", marginBottom: 2 },
  cRow: { color: "#e7ecf5", fontSize: 13, marginVertical: 2, lineHeight: 19 },
  cLabel: { color: "#8a8f99" },
  cAnteprima: { color: "#e7ecf5", fontSize: 13, lineHeight: 20, marginBottom: 8 },
  cBadge: { color: "#fff", fontSize: 11, fontWeight: "800", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3, overflow: "hidden" },
  cLink: { color: "#cfe0ff", backgroundColor: "rgba(80,200,120,0.15)", borderWidth: 1, borderColor: theme.primary, borderRadius: 8, padding: 10, fontWeight: "700", fontSize: 13, marginTop: 4 },
  contactBtn: { marginTop: 12, backgroundColor: "rgba(80,200,120,0.15)", borderWidth: 1, borderColor: theme.primary, borderRadius: 8, paddingVertical: 11, alignItems: "center" },
  contactBtnText: { color: "#cfe0ff", fontWeight: "800", fontSize: 13 },
  pdfBtn: { marginTop: 8, backgroundColor: "rgba(80,200,120,0.12)", borderWidth: 1, borderColor: "rgba(80,200,120,0.5)", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  pdfBtnText: { color: "#ffcf80", fontWeight: "700", fontSize: 13 },
  pdfPick: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, borderWidth: 1, borderStyle: "dashed", borderColor: theme.border, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 12 },
  pdfPickText: { color: theme.textDim, fontSize: 13, fontWeight: "600", flex: 1 },
  formLbl: { color: theme.textFaint, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginTop: 10, marginBottom: 4 },
  regChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surfaceAlt, marginRight: 8 },
  regChipOn: { borderColor: theme.primary, backgroundColor: "rgba(80,200,120,0.2)" },
  regChipText: { color: theme.textDim, fontSize: 12, fontWeight: "700" },
  regChipTextOn: { color: "#fff" },
  swapTypeRow: { flexDirection: "row", marginTop: 10 },
  mFilterBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingTop: 8 },
  mFilterLbl: { color: theme.primary, fontSize: 12, fontWeight: "800" },
  editBtn: { marginTop: 8, backgroundColor: "rgba(80,200,120,0.12)", borderWidth: 1, borderColor: "rgba(80,200,120,0.5)", borderRadius: 8, paddingVertical: 11, alignItems: "center" },
  editBtnText: { color: "#ffcf80", fontWeight: "800", fontSize: 13 },
});

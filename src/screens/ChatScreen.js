import React, { useState, useEffect, useCallback, useRef, useLayoutEffect, useMemo } from "react";
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, Keyboard, Modal, Pressable, InteractionManager,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import * as ImagePicker from "expo-image-picker";
import * as imageOpt from "../lib/imageOpt";
import * as appearance from "../lib/appearance";
import * as DocumentPicker from "expo-document-picker";
import * as bigatt from "../lib/bigatt";
import * as FileSystem from "expo-file-system/legacy";
import { useAudioRecorder, useAudioRecorderState, AudioModule, RecordingPresets, setAudioModeAsync } from "expo-audio";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useAuth } from "../context/AuthContext";
import { useUnread } from "../context/UnreadContext";
import * as api from "../lib/api";
import { decryptAny } from "../lib/devices";
import { buildEnvelopes } from "../lib/send";
import * as msh from "../lib/meshchat";
import * as meshRuntime from "../lib/mesh/runtime";
import ChatConstellation from "../components/ChatConstellation";
import * as decdiag from "../lib/decdiag";
import * as ratchetheal from "../lib/ratchetheal";
import { localPrekeyIds, deviceId as myDeviceId } from "../lib/devices";
import * as mbx from "../lib/mailbox";
import {
  decryptEnvelope, unpackMessage, encryptForRecipients, packMessage, bytesToHex,
  encryptFileBytes, base64ToBytes, verifyMessage, decryptFileBytes,
} from "../lib/crypto";
import EncryptedAttachment from "../components/EncryptedAttachment";
import ThreatBanner from "../components/ThreatBanner";
import SafeText from "../components/SafeText";
import { analyzeMessage } from "../lib/threatEngine";
import { useI18n } from "../lib/i18n";
import { loadAutoTranslate, loadTranslateTarget } from "../lib/store";
import { detectLang, langFlag } from "../lib/detectLang";
import { suppressLock } from "../lib/lockGuard";
import { verifyState } from "../lib/verify";
import { archiveForConv } from "../lib/backup";
import { usePoll } from "../lib/usePoll";
import * as msgCache from "../lib/msgCache";
import * as convCache from "../lib/convCache";
import { flushBlobs } from "../lib/lock";
import { exportConversation } from "../lib/legalExport";
import { useTint } from "../lib/appearance";
import { theme } from "../theme";

// ── ORA E GIORNATA (v2.8.0) ────────────────────────────────────────────────
// Prima le bolle non dicevano quando: si vedeva l'ordine, non l'orario. Da qui l'ora
// sotto ogni messaggio e una riga di separazione quando cambia il giorno.
const DATE_LOCALE = {
  it: "it-IT", en: "en-GB", zh: "zh-CN", hi: "hi-IN", es: "es-ES", pt: "pt-BR",
  ar: "ar-SA", fr: "fr-FR", ru: "ru-RU", de: "de-DE", ja: "ja-JP", tr: "tr-TR",
};

function dayKeyOf(iso) {
  const d = new Date(iso || 0);
  if (isNaN(d)) return "";
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function hhmm(iso) {
  const d = new Date(iso || 0);
  if (isNaN(d)) return "";
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function dayLabelOf(iso, lang, t) {
  const d = new Date(iso || 0);
  if (isNaN(d)) return "";
  const k = dayKeyOf(iso);
  const now = new Date();
  if (k === dayKeyOf(now.toISOString())) return t("chat.today");
  if (k === dayKeyOf(new Date(now.getTime() - 86400000).toISOString())) return t("chat.yesterday");
  try {
    return d.toLocaleDateString(DATE_LOCALE[lang] || "it-IT", { weekday: "long", day: "numeric", month: "long" });
  } catch { return k; }
}

// Il testo che sostituisce una busta che non si apre. Costante e non ripetuta a mano:
// serve sia per disegnarla sia per riconoscerla quando si butta.
const UNDEC = "· messaggio non decifrabile ·";

export default function ChatScreen({ route, navigation }) {
  const tint = useTint();
  const styles = useMemo(() => makeStyles(tint), [tint]);
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const { refresh } = useUnread();
  const insets = useSafeAreaInsets();
  const [convId, setConvId] = useState(route.params?.conv_id || null);
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [others, setOthers] = useState(
    route.params?.others?.length ? route.params.others : (route.params?.title_lns ? [route.params.title_lns] : [])
  );
  const [headerTitle, setHeaderTitle] = useState(
    route.params?.title || (route.params?.title_lns || (route.params?.others?.[0]) || "Chat").split("@")[0]
  );
  const title = headerTitle;
  const [msgs, setMsgs] = useState([]);
  const [purging, setPurging] = useState(false);
  // Quanti messaggi si decifrano e si disegnano: 12 all'apertura, +30 ogni volta che
  // l'utente chiede i precedenti. `total` è quanti ce ne sono in tutto sul server.
  const INITIAL_WIN = 12;
  const PAGE = 30;
  const winRef = useRef(INITIAL_WIN);
  const [win, setWin] = useState(INITIAL_WIN);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // La lista scende in fondo da sola SOLO se l'utente è già in fondo: prima lo faceva ad
  // ogni cambio di contenuto (anche ogni 4 secondi, e al caricamento di ogni immagine) ed
  // era il motivo per cui la chat "ballava".
  const atBottomRef = useRef(true);
  const moreRef = useRef(0);
  // Altezza già misurata di ogni messaggio: il posto resta quello anche quando il testo
  // arriva dopo (decifratura in sottofondo), così la lista non si riassesta sotto le dita.
  const rowH = useRef(new Map());
  // Aspetto scelto dall'utente (colore d'accento e sfondo): si applica qui, dove conta.
  const [look, setLook] = useState(appearance.get());
  useEffect(() => {
    appearance.load().then((v) => setLook({ ...v }));
    return appearance.subscribe((v) => setLook({ ...v }));
  }, []);
  const accent = (appearance.ACCENTS.find((a) => a.id === look.accent) || appearance.ACCENTS[0]).color;
  const chatBg = (appearance.BACKGROUNDS.find((b) => b.id === look.bg) || appearance.BACKGROUNDS[0]).color;
  const [text, setText] = useState("");
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [actionItem, setActionItem] = useState(null);
  const [uploadPct, setUploadPct] = useState(null);
  const [typers, setTypers] = useState([]);
  const [translations, setTranslations] = useState({});
  const typingRef = useRef(0);
  const sendingRef = useRef([]);  // messaggi appena inviati: visibili subito
  const pendingRef = useRef(false);
  const msgsSig = useRef("");
  const netDone = useRef(false);   // la rete ha già risposto per questa chat
  const arcRef = useRef({ cid: null, list: [] });
  const anonRef = useRef({ cid: null, list: [], dirty: true });
  const [baro, setBaro] = useState(null);
  // La Costellazione del messaggio: chiusa di default, si apre toccando il lucchetto.
  const [mapOpen, setMapOpen] = useState(false);
  const [mapRoute, setMapRoute] = useState({ via: null, neighbours: 0, hybrid: 0, pulses: 0 });
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const listRef = useRef(null);
  const mounted = useRef(true);
  const ephemRef = useRef(new Set()); // id già schedulati per autodistruzione
  // Autodistruzione: 0=off, altrimenti secondi (60=1min, 3600=1h, 86400=24h)
  const [ttl, setTtl] = useState(0);
  const TTL_OPTS = [0, 60, 3600, 86400];
  const ttlLabel = (v) => (v === 0 ? "∞" : v === 60 ? "1m" : v === 3600 ? "1h" : "24h");
  const cycleTtl = () => setTtl((v) => TTL_OPTS[(TTL_OPTS.indexOf(v) + 1) % TTL_OPTS.length]);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recState = useAudioRecorderState(recorder);
  useEffect(() => { (async () => { try { await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true }); } catch { /* */ } })(); }, []);
  const mmss = (s) => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const headerHeight = useHeaderHeight();
  const scrollToEnd = useCallback((animated = false) => { listRef.current?.scrollToEnd({ animated }); }, []);

  // Verifica contatto (anti man-in-the-middle): "none" | "ok" | "changed" | "unknown"
  const [vfy, setVfy] = useState("none");
  useEffect(() => {
    if (others.length !== 1) return;
    let alive = true;
    const run = () => { verifyState(others[0]).then((r) => { if (alive) setVfy(r.state); }).catch(() => {}); };
    run();
    const unsub = navigation.addListener("focus", run);
    return () => { alive = false; unsub(); };
  }, [others, navigation]);

  const [exporting, setExporting] = useState(false);
  const exportRef = useRef({});
  exportRef.current = { msgs, others, title, user, lang, t };
  const exportingRef = useRef(false);
  const onExport = useCallback(() => {
    const { msgs, others, title, user, lang, t } = exportRef.current;
    if (exportingRef.current) return;
    const run = async () => {
      exportingRef.current = true; setExporting(true);
      try {
        const parts = Array.from(new Set([user?.lns, ...(others || [])].filter(Boolean)));
        const rows = (msgs || []).map((m) => ({ at: m.at, from: m.mine ? user.lns : (others[0] || title), body: m.body, atts: m.atts }));
        const downloadAttachment = async (a) => { const ct = await api.blobDownload(a.id); return decryptFileBytes(ct, a.key, a.iv); };
        const r = await exportConversation({ title, participants: parts, messages: rows, user, lang, downloadAttachment });
        Alert.alert(lang === "en" ? "Export ready" : "Export pronto", (lang === "en" ? "Signed on device · " : "Firmato sul dispositivo · ") + r.count + (lang === "en" ? " messages" : " messaggi"));
      } catch (e) { Alert.alert("Export", String((e && e.message) || e)); }
      finally { exportingRef.current = false; setExporting(false); }
    };
    Alert.alert(
      lang === "en" ? "Export conversation" : "Esporta conversazione",
      lang === "en" ? "Generate a signed PDF + JSON on your device (server sees nothing)?" : "Generare un PDF + JSON firmati sul tuo dispositivo (il server non vede nulla)?",
      [{ text: t("cancel"), style: "cancel" }, { text: lang === "en" ? "Export" : "Esporta", onPress: run }]
    );
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({
      title,
      headerRight: () => (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          {!!baro && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }} testID="chat-baro">
              <Ionicons name={baro.icon} size={15} color={baro.color} />
              <Text style={{ color: baro.color, fontSize: 10, fontWeight: "700" }}>{baro.label}</Text>
            </View>
          )}
          {others.length === 1 && (
            <>
              <TouchableOpacity onPress={() => navigation.navigate("Call", { to: others[0], to_name: title, video: false })} testID="chat-call-audio" hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}>
                <Ionicons name="call-outline" size={20} color={tint} />
              </TouchableOpacity>
            </>
          )}
          {others.length === 1 && (
            <TouchableOpacity
              onPress={() => navigation.navigate("VerifyContact", { peer: others[0], peer_name: title })}
              testID="chat-verify" hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            >
              <Ionicons
                name={vfy === "ok" ? "shield-checkmark" : vfy === "changed" ? "warning" : "shield-outline"}
                size={19}
                color={vfy === "ok" ? theme.accent : vfy === "changed" ? theme.danger : theme.textDim}
              />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={onExport} testID="chat-export" hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}>
            {exporting ? <ActivityIndicator size="small" color={tint} /> : <Ionicons name="document-text-outline" size={20} color={tint} />}
          </TouchableOpacity>
          {convId ? (
            <TouchableOpacity onPress={onDeleteChat} testID="chat-delete" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={{ color: "#FF6B7A", fontSize: 18 }}>🗑</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ),
    });
  }, [navigation, title, convId, others, exporting, onExport, vfy]);

  const onDeleteChat = () => {
    if (!convId) return;
    Alert.alert(t("chat.deleteChat.title"), t("chat.deleteChat.text"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("delete"), style: "destructive", onPress: async () => {
        try { await api.deleteConversation(convId); navigation.goBack(); }
        catch (e) { setErr(api.apiErr(e)); }
      } },
    ]);
  };

  const [trTarget, setTrTarget] = useState(null);
  const effTarget = trTarget || (lang === "en" ? "en" : "it");
  const onTranslate = async (item) => {
    if (!item?.body) return;
    const target = effTarget;
    try {
      const r = await api.translate(item.body, target);
      const detected = (r?.detected || "").toLowerCase();
      const sameLang = detected && detected === target.toLowerCase();
      setTranslations((m) => ({ ...m, [item.id]: { text: sameLang ? item.body : (r?.translated || ""), detected, show: true, same: sameLang, target } }));
    } catch (e) { setErr(api.apiErr(e)); }
  };
  const toggleTr = (id) => setTranslations((m) => ({ ...m, [id]: { ...m[id], show: !m[id].show } }));

  const autoTrRef = useRef(false);
  useEffect(() => {
    loadAutoTranslate().then((v) => { autoTrRef.current = v; });
    loadTranslateTarget().then((v) => { setTrTarget(v); });
  }, []);
  useEffect(() => {
    if (!autoTrRef.current || !msgs.length) return;
    msgs.filter((m) => !m.mine && m.body && translations[m.id] == null).slice(-40).forEach((m) => { onTranslate(m); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs]);

  const onMessageActions = (item) => setActionItem(item);
  const doReact = async (it, e) => { setActionItem(null); try { await api.pulseReact(it.id, e); await load(convId); } catch (err) { setErr(api.apiErr(err)); } };
  const doDelete = async (it, scope) => { setActionItem(null); try { await api.deleteMessage(it.id, scope); await load(convId); } catch (e) { setErr(api.apiErr(e)); } };
  const startEdit = (it) => { setActionItem(null); if (!it.mine || !it.body) return; setReplyTo(null); setEditing({ id: it.id }); setText(it.body); };
  const doPin = async (it) => { setActionItem(null); try { await api.pinMessage(it.id, !it.pinned); await load(convId); } catch (e) { setErr(api.apiErr(e)); } };
  const doReport = (it) => {
    setActionItem(null);
    Alert.alert(
      lang === "en" ? "Report message" : "Segnala messaggio",
      lang === "en" ? "Report this message to moderators?" : "Segnalare questo messaggio ai moderatori?",
      [{ text: t("cancel"), style: "cancel" }, { text: lang === "en" ? "Report" : "Segnala", style: "destructive", onPress: async () => { try { await api.reportMessage(it.id, ""); Alert.alert("OK", lang === "en" ? "Reported. Thank you." : "Segnalato. Grazie."); } catch (e) { setErr(api.apiErr(e)); } } }]
    );
  };

  // FINESTRA DEI MESSAGGI (caricamento pigro): all'apertura si decifrano e si disegnano solo
  // gli ultimi `INITIAL_WIN`; i più vecchi arrivano SOLO se l'utente li chiede scorrendo in
  // alto. Prima si costruiva l'intera cronologia ad ogni giro, anche di 4 secondi in 4.
  const load = useCallback(async (cid, limit, deepMode, preRaw) => {
    if (!cid) { setMsgs([]); setLoading(false); return; }
    try {
      const t0 = Date.now();
      // Si chiede UNA riga in più della finestra: se arriva, si sa che esiste cronologia
      // più vecchia (e si mostra "Messaggi precedenti") senza scaricarla.
      const want = (typeof limit === "number" ? limit : winRef.current);
      // `preRaw` = pagina già sul telefono: si disegna senza rete. Se la rete ha già
      // risposto la si scarta, per non tornare indietro nel tempo.
      const raw0 = preRaw || await api.messages(cid, want + 1);
      if (preRaw) { if (netDone.current) return; } else { netDone.current = true; convCache.save(cid, raw0); }
      const tNet = Date.now() - t0;
      const more = raw0.length > want;
      const raw = more ? raw0.slice(raw0.length - want) : raw0;
      setHasMore(more);
      const out = [];
      const fast = typeof limit === "number";
      // `deepMode` separa le due cose che prima viaggiavano insieme: quanti messaggi
      // mostrare subito e se fare i tentativi a tentoni. La passata profonda ora gira
      // SOLO in sottofondo (vedi scheduleRepair), a interfaccia libera.
      const deep = deepMode === undefined ? !fast : !!deepMode;
      // La finestra vale SEMPRE, anche per la passata profonda: quella decide solo quanti
      // tentativi di chiave fare, non quanti messaggi disegnare.
      const window = fast ? limit : winRef.current;
      const from = Math.max(0, raw.length - window);
      let heavy = 0;
      let deferred = false;
      for (let mi = 0; mi < raw.length; mi++) {
        const m = raw[mi];
        if (mi < from) continue; // fuori finestra: si vedrà solo se l'utente scorre in alto
        let body = "🔒";
        let atts = [];
        let reply = null;
        let ttlv = 0;
        let signed = null;
        if (m.envelope && user?.kem) {
          // Riuso della decifratura già fatta (in memoria, non sul disco: nessun testo in
          // chiaro in più sul telefono). Prima si ri-decifrava tutta la conversazione ogni
          // 4 secondi, e uscendo dalla chat si ripartiva da zero.
          const e0 = (Array.isArray(m.envelopes) && m.envelopes[0]) || m.envelope || m;
          const ct = typeof e0 === "string" ? e0 : String(e0.ct || e0.c || "");
          const csig = ct.length + ":" + ct.slice(-24);
          const hit = msgCache.get(cid, m.message_id);
          if (hit && hit.csig === csig && !(hit.soft && deep)) {
            if (hit.ctl) continue;
            body = hit.body; atts = hit.atts; reply = hit.reply; ttlv = hit.ttl; signed = hit.signed;
          } else {
            // Ogni 5 decifrature si lascia respirare l'interfaccia.
            if (heavy && heavy % 5 === 0) await new Promise((r) => setTimeout(r, 0));
            heavy++;
            const pt = await decryptAny(m, user, { deep, breathe: deep });
            if (pt == null) {
              body = UNDEC;
              // Perché non si è aperta: forma delle buste, chiavi possedute, dispositivo.
              // Nessun contenuto, nessuna chiave: solo quello che serve a capire.
              try { decdiag.note(m, { dev: await myDeviceId(), pkIds: await localPrekeyIds() }); } catch { /* */ }
              // Catena rotta in un solo senso: se il messaggio è del ratchet e non si apre,
              // si chiede al mittente di ripartire da una radice nuova (una volta ogni 20
              // minuti). Senza questo lui continua per sempre con una catena che io non ho.
              try {
                const envs = Array.isArray(m.envelopes) ? m.envelopes : (m.envelope ? [m.envelope] : []);
                const rat = envs.find((e) => e && e.r && e.h && (!e.for || e.for === user.lns));
                if (rat && !m.mine && others.length === 1) {
                  await ratchetheal.requestReset(others[0], user, rat.h ? rat.h.sdev : "");
                }
              } catch { /* */ }
              // Esito negativo ricordato: senza questo si ritentava a ogni giro.
              msgCache.put(cid, m.message_id, { csig, body, atts: [], reply: null, ttl: 0, signed: null, soft: !deep });
              if (!deep) deferred = true;
            } else {
              const u = unpackMessage(pt); body = u.text; atts = u.atts; reply = u.reply; ttlv = u.ttl || 0;
              if (u.sig && u.sig.s && u.sig.pk) signed = verifyMessage(body, u.sig.s, u.sig.pk);
              // Consegna di gettoni/chiavi per la cassetta anonima: non è un messaggio da mostrare.
              // Richiesta di ripartenza della catena: si azzera e si manda subito un
              // controllo che porta un init nuovo (invisibile per l'utente).
              if (typeof body === "string" && body.startsWith(ratchetheal.CTL_PREFIX)) {
                msgCache.put(cid, m.message_id, { csig, ctl: true });
                if (!m.mine) { try { await ratchetheal.onReset(m.from_lns || "", user); } catch { /* */ } }
                continue;
              }
              // Identità mesh del contatto (chat sulla mesh): controllo invisibile.
              if (typeof body === "string" && body.startsWith(msh.CTL_PREFIX)) {
                msgCache.put(cid, m.message_id, { csig, ctl: true });
                if (!m.mine) { try { await msh.onControl(body, m.from_lns || ""); } catch { /* */ } }
                continue;
              }
              if (typeof body === "string" && body.startsWith(mbx.CTL_PREFIX)) {
                msgCache.put(cid, m.message_id, { csig, ctl: true });
                if (!m.mine) { try { await mbx.onControl(body, m.from_lns || ""); } catch { /* */ } }
                continue;
              }
              // Qualsiasi ALTRO messaggio di controllo (anche di una versione futura) resta
              // invisibile: meglio niente che una riga di caratteri strani in chat.
              if (typeof body === "string" && body.charCodeAt(0) === 1) {
                msgCache.put(cid, m.message_id, { csig, ctl: true });
                continue;
              }
              msgCache.put(cid, m.message_id, { csig, body, atts, reply, ttl: ttlv, signed });
            }
          }
        }
        out.push({ id: m.message_id, mine: !!m.mine, body, atts, reply, signed, reactions: Array.isArray(m.reactions) ? m.reactions : [], ttl: ttlv, at: m.sent_at || m.created_at, delivered: !!m.delivered, read: !!m.read, edited: !!m.edited, pinned: !!m.pinned });
      }
      // Messaggi arrivati per cassetta anonima: vivono solo qui, cifrati sul telefono.
      try {
        // Cassetta anonima: blob cifrato sul telefono. Si rilegge quando cambia, non 15
        // volte al minuto.
        if (anonRef.current.cid !== cid || anonRef.current.dirty) {
          // Cassetta anonima + messaggi arrivati (o in attesa) sulla mesh: entrambi vivono
          // solo qui, nel blob cifrato del telefono.
          const anonList = await mbx.localForConv(cid);
          const meshList = await msh.localForConv(cid);
          anonRef.current = { cid, list: anonList.concat(meshList), dirty: false };
        }
        const anon = anonRef.current.list;
        if (anon.length) {
          out.push(...anon);
          out.sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
        }
      } catch { /* modalità anonima non attiva */ }
      // Messaggi ripristinati da un backup cifrato: restano solo su questo telefono.
      try {
        // Archivio ripristinato da backup: immutabile mentre la chat è aperta.
        if (arcRef.current.cid !== cid) arcRef.current = { cid, list: await archiveForConv(cid) };
        const arc = arcRef.current.list;
        if (arc.length) {
          const have = new Set(out.map((m) => m.id));
          const add = arc.filter((m) => !have.has(m.id));
          if (add.length) {
            out.push(...add);
            out.sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
          }
        }
      } catch { /* nessun archivio */ }
      // Messaggi appena inviati e ancora in viaggio: restano visibili.
      if (sendingRef.current.length) out.push(...sendingRef.current);
      pendingRef.current = deferred;
      // Misura reale: se l'apertura ha superato i 2 s manda al nostro server SOLO i numeri
      // (nessun contenuto, nessun indirizzo). Serve a capire dove va il tempo sul telefono.
      if (fast && !preRaw) {
        const tAll = Date.now() - t0;
        if (tAll > 1500) {
          try {
            fetch(api.getServerUrl() + "/api/public/crash", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ v: "perf", android: "chat-open", trace: "tot=" + tAll + "ms net=" + tNet + "ms messaggi=" + raw.length + " decifrati=" + heavy }),
            }).catch(() => {});
          } catch (e) { /* */ }
        }
      } else if (deep) {
        // Anche la passata di sottofondo si misura: se costa tanto lo sappiamo dai numeri,
        // non dalle impressioni.
        const tAll = Date.now() - t0;
        if (tAll > 2500) {
          try {
            fetch(api.getServerUrl() + "/api/public/crash", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ v: "perf", android: "chat-deep", trace: "tot=" + tAll + "ms net=" + tNet + "ms messaggi=" + raw.length + " decifrati=" + heavy }),
            }).catch(() => {});
          } catch (e) { /* */ }
        }
      }
      // Stato del ratchet e chiavi: su disco una volta, non a ogni messaggio.
      flushBlobs().catch(() => {});
      if (mounted.current) {
        // Se non è cambiato nulla non si ridisegna la chat: ogni setMsgs ricostruiva
        // l'intera lista dei messaggi.
        let vsig = out.length + "#";
        for (const mm of out) vsig += mm.id + (mm.delivered ? "d" : "") + (mm.read ? "r" : "") + (mm.edited ? "e" : "") + (mm.pinned ? "p" : "") + (mm.sendingLocal ? "s" : "") + (mm.sendFailed ? "!" : "") + (mm.pending ? "q" : "") + mm.reactions.length + "." + String(mm.body || "").length + "|";
        if (vsig !== msgsSig.current) { msgsSig.current = vsig; setMsgs(out); }
        setLoading(false);
        // Autodistruzione: pianifica una sola volta l'eliminazione dei messaggi con timer.
        for (const mm of out) {
          if (mm.ttl > 0 && !ephemRef.current.has(mm.id)) {
            ephemRef.current.add(mm.id);
            setTimeout(async () => {
              try { await api.deleteMessage(mm.id, mm.mine ? "all" : "me"); if (mounted.current) await load(cid); } catch { /* */ }
            }, mm.ttl * 1000);
          }
        }
      }
    } catch { if (mounted.current) setLoading(false); }
  }, [user]);

  // Passata profonda (tentativi a tentoni sulle buste ancora chiuse): parte SOLO quando
  // l'utente non sta interagendo, una volta ogni 30 secondi al massimo, e non tocca il
  // percorso di apertura della chat.
  const repairRef = useRef(0);
  const scheduleRepair = useCallback((cid) => {
    if (!cid) return;
    const now = Date.now();
    if (now - repairRef.current < 30000) return;
    repairRef.current = now;
    InteractionManager.runAfterInteractions(() => {
      if (mounted.current) load(cid, undefined, true).catch(() => {});
    });
  }, [load]);

  useEffect(() => {
    mounted.current = true;
    winRef.current = INITIAL_WIN;
    setWin(INITIAL_WIN);
    atBottomRef.current = true;
    // Resolve participants/title when opened from a push (only conv_id known).
    if (convId && others.length === 0) {
      api.convs().then((list) => {
        const conv = (list || []).find((x) => x.conv_id === convId);
        if (conv && mounted.current) {
          setOthers(conv.others || (conv.title_lns ? [conv.title_lns] : []));
          setHeaderTitle(conv.title || (conv.title_lns || "Chat").split("@")[0]);
        }
      }).catch(() => {});
    }
    // CHAT ISTANTANEA: prima si disegna l'ultima pagina già presente sul telefono (buste
    // cifrate dentro un blob a sua volta cifrato con la chiave del dispositivo), senza
    // toccare la rete: con la linea lenta la chat non resta più vuota.
    netDone.current = false;
    convCache.read(convId).then((cached) => {
      if (cached && mounted.current && !netDone.current) load(convId, INITIAL_WIN, false, cached).catch(() => {});
    }).catch(() => {});
    // Apertura rapida: solo gli ultimi messaggi, il resto solo se richiesto.
    load(convId, INITIAL_WIN).then(() => {
      if (pendingRef.current) scheduleRepair(convId);
    });
    if (convId) api.markRead(convId).then(() => refresh()).catch(() => {});
    // Cassetta anonima: consegna i gettoni al contatto e ritira i depositi in arrivo.
    msh.setIdentity(user);
    // Chiave statica del contatto in cassaforte: così la catena che si rigenera parte anche
    // se domani la richiesta al server non riesce.
    try { require("../lib/maintenance").warmStaticKeys(others); } catch { /* */ }
    if (others.length === 1) {
      mbx.publishTo(others[0], user).catch(() => {});
      // Chat sulla mesh: identità mesh e sigillo condiviso, dentro la chat cifrata.
      msh.publishTo(others[0], user).catch(() => {});
    }
    return () => { mounted.current = false; };
  }, [convId, load, refresh, others, user, scheduleRepair]);

  // Aggiornamenti: solo con l'app in primo piano e questa chat davanti agli occhi.
  // Passata leggera: i messaggi già decifrati arrivano dalla memoria, i nuovi si decifrano
  // per la loro strada. Niente tentativi a tentoni qui: quelli vanno in sottofondo.
  usePoll(() => {
    load(convId, winRef.current, false).then(() => { if (pendingRef.current) scheduleRepair(convId); });
  }, 4000, { runOnFocus: false, active: !!convId });
  usePoll(async () => {
    try { const r = await api.pulseTypingGet(convId); if (mounted.current) setTypers(Array.isArray(r?.typing) ? r.typing : []); } catch { /* */ }
    try { await api.presencePing(); } catch { /* */ }
  }, 4000, { runOnFocus: false, active: !!convId });
  usePoll(() => {
    mbx.pickup(user).then((n) => { if (n && mounted.current) { anonRef.current.dirty = true; load(convId, winRef.current, false); } }).catch(() => {});
    // Coda mesh: quello che era in attesa parte da solo appena c'è una via (server o nodo).
    msh.flush(user).catch(() => {});
    // I messaggi arrivati sulla mesh sono già nel blob cifrato: si rilegge e compaiono.
    if (mounted.current) { anonRef.current.dirty = true; load(convId, winRef.current, false); }
  }, 15000, { runOnFocus: false, active: !!convId });

  // BAROMETRO: dice da dove stanno passando i messaggi in questo momento.
  // server (nuvola) · mesh sulla Wi-Fi · Wi-Fi Direct (nessun router) · in attesa.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const q = await msh.status();
        let st = null;
        try { st = await meshRuntime.status(); } catch { /* nodo spento */ }
        if (!alive) return;
        const p2p = st && st.diag ? st.diag.p2p : "off";
        const on = st && st.diag ? st.diag.running : false;
        setMapRoute({
          via: q.lastVia || (on ? "server" : null),
          neighbours: (st && st.neighbours) || 0,
          hybrid: (st && st.hybrid) || 0,
          pulses: (st && st.pulses) || 0,
        });
        if (q.queued > 0) setBaro({ icon: "time-outline", label: q.queued + (lang === "en" ? " waiting" : " in attesa"), color: "#50C878" });
        else if (q.lastVia === "corriere") setBaro({ icon: "walk-outline", label: lang === "en" ? "Courier" : "Corriere", color: "#50C878" });
        else if (q.lastVia === "ponte") setBaro({ icon: "swap-horizontal-outline", label: lang === "en" ? "Bridge" : "Ponte", color: "#50C878" });
        else if (q.lastVia === "mesh" && p2p === "group") setBaro({ icon: "git-network-outline", label: "Wi-Fi Direct", color: "#50C878" });
        else if (q.lastVia === "mesh") setBaro({ icon: "wifi-outline", label: "Mesh", color: "#50C878" });
        else if (on) setBaro({ icon: "cloud-outline", label: lang === "en" ? "Server" : "Server", color: "rgba(255,255,255,0.45)" });
        else setBaro(null);
      } catch { /* il barometro non deve mai disturbare */ }
    };
    tick();
    const id = setInterval(tick, 6000);
    return () => { alive = false; clearInterval(id); };
  }, [lang]);

  const onSend = async (override) => {
    atBottomRef.current = true; // dopo un invio è giusto tornare in fondo
    const body = (typeof override === "string" ? override : text).trim();
    if (!body || others.length === 0 || !user?.kem) return;
    setSending(true); setErr("");
    if (editing) {
      try {
        const payload = packMessage(body, [], null, ttl, null);
        const envelopes = await buildEnvelopes(payload, others, user);
        await api.editMessage(editing.id, envelopes);
        setText(""); setEditing(null); Keyboard.dismiss();
        await load(convId);
      } catch (e) { setErr(api.apiErr(e)); }
      finally { setSending(false); }
      return;
    }
    // Invio ottimistico: il messaggio compare SUBITO, poi proseguono cifratura
    // post-quantistica e rete. Nessun passaggio crittografico viene saltato.
    const myReply = replyTo;
    const tmp = {
      id: "tmp-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7), mine: true, body,
      atts: [], reply: myReply, signed: null, reactions: [], ttl, at: new Date().toISOString(),
      delivered: false, read: false, edited: false, pinned: false, sendingLocal: true,
    };
    sendingRef.current = sendingRef.current.concat([tmp]);
    setMsgs((prev) => prev.concat([tmp]));
    setText(""); setReplyTo(null); Keyboard.dismiss(); setSending(false);
    const done = () => { sendingRef.current = sendingRef.current.filter((x) => x.id !== tmp.id); msgsSig.current = ""; };
    try {
      // CASSETTA ANONIMA: se il contatto ci ha consegnato gettoni e chiavi monouso, il
      // messaggio non passa da /pulse/send: il server non sa nemmeno che ci scriviamo.
      try {
        if (await mbx.trySend(others, { text: body, atts: [], reply: myReply, ttl }, convId, user)) {
          anonRef.current.dirty = true; done();
          await load(convId);
          return;
        }
      } catch { /* si prosegue con l'invio normale */ }
      const payload = packMessage(body, [], myReply, ttl, null);
      const envelopes = await buildEnvelopes(payload, others, user);
      // UNICA VIA D'INVIO: server → mesh → coda. Se il server non risponde e il Nodo
      // Sovrano è acceso, il messaggio parte sulla rete locale; se non c'è percorso resta
      // in attesa e parte da solo. L'utente non deve accorgersi della differenza.
      const r = await msh.sendOrQueue({ to_lns: others, envelopes }, convId, user, { text: body, reply: myReply, ttl });
      if (r?.conv_id && r.conv_id !== convId) setConvId(r.conv_id);
      if (r?.via === "mesh" || r?.queued) anonRef.current.dirty = true;
      done();
      await load(r?.conv_id || convId);
    } catch (e) {
      setErr(api.apiErr(e));
      const mark = (x) => (x.id === tmp.id ? Object.assign({}, x, { sendingLocal: false, sendFailed: true }) : x);
      sendingRef.current = sendingRef.current.map(mark);
      setMsgs((prev) => prev.map(mark));
    }
    finally { setUploadPct(null); }
  };

  // Cifra e invia un asset (foto o video) come allegato E2EE (blob + envelope).
  const sendAsset = async (asset) => {
    if (!asset?.uri || others.length === 0 || !user?.kem) return;
    setSending(true); setErr("");
    try {
      const isVid = asset.type === "video" || (asset.mimeType || "").startsWith("video");
      // FOTO: si riduce sotto i 500 KB e si prepara la micro-anteprima. Una foto da 4 MB
      // impiegava un'eternità a partire e ad aprirsi; la cifratura non cambia di una virgola.
      let b64 = null;
      let prev = null;
      if (!isVid) {
        const small = await imageOpt.shrinkPhoto(asset.uri, 500 * 1024);
        if (small?.base64) b64 = small.base64;
        prev = await imageOpt.microPreview(asset.uri);
      }
      if (!b64) b64 = asset.base64 || await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      const bytes = base64ToBytes(b64);
      const enc = encryptFileBytes(bytes);
      setUploadPct(0);
      const { id } = await api.blobUpload(enc.ciphertext, (p) => { if (mounted.current) setUploadPct(p); }, others);
      const att = {
        id,
        name: asset.fileName || `${isVid ? "video" : "foto"}_${Date.now()}.${isVid ? "mp4" : "jpg"}`,
        mime: isVid ? (asset.mimeType || "video/mp4") : "image/jpeg",
        size: bytes.length, key: enc.key, iv: enc.iv,
        // ~500 byte: viaggia dentro il messaggio cifrato, il server non la vede.
        prev: prev || undefined,
      };
      const payload = packMessage(text.trim(), [att], replyTo, ttl);
      const envelopes = await buildEnvelopes(payload, others, user);
      const res = await api.send({ to_lns: others, envelopes });
      setText(""); setReplyTo(null);
      if (res?.conv_id && res.conv_id !== convId) setConvId(res.conv_id);
      await load(res?.conv_id || convId);
    } catch (e) { setErr(api.apiErr(e)); }
    finally { setSending(false); setUploadPct(null); }
  };

  // Registrazione nota vocale → cifra → blob → invia come allegato E2EE.
  const startRec = async () => {
    if (others.length === 0 || !user?.kem) { setErr(t("chat.attach.noconv")); return; }
    suppressLock();
    try {
      const p = await AudioModule.requestRecordingPermissionsAsync();
      if (!p.granted) { setErr(lang === "en" ? "Microphone permission denied" : "Permesso microfono negato"); return; }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (e) { setErr(api.apiErr(e)); }
  };
  const cancelRec = async () => { try { await recorder.stop(); } catch { /* */ } };
  const stopRecAndSend = async () => {
    let uri;
    try { await recorder.stop(); uri = recorder.uri; } catch { /* */ }
    if (!uri) return;
    const dur = Math.round((recState.durationMillis || 0) / 1000);
    setSending(true); setErr("");
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const bytes = base64ToBytes(b64);
      const enc = encryptFileBytes(bytes);
      setUploadPct(0);
      const { id } = await api.blobUpload(enc.ciphertext, (p) => { if (mounted.current) setUploadPct(p); }, others);
      const att = { id, name: `vocale_${Date.now()}.m4a`, mime: "audio/m4a", size: bytes.length, key: enc.key, iv: enc.iv, kind: "voice", duration: dur };
      const payload = packMessage("", [att], replyTo, ttl);
      const envelopes = await buildEnvelopes(payload, others, user);
      const res = await api.send({ to_lns: others, envelopes });
      setReplyTo(null);
      if (res?.conv_id && res.conv_id !== convId) setConvId(res.conv_id);
      await load(res?.conv_id || convId);
    } catch (e) { setErr(api.apiErr(e)); }
    finally { setSending(false); setUploadPct(null); }
  };

  const takePhoto = async () => {
    suppressLock();
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { setErr(t("chat.attach.denied")); return; }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.6, base64: true });
    if (!r.canceled && r.assets?.[0]) sendAsset(r.assets[0]);
  };
  const recordVideo = async () => {
    suppressLock();
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { setErr(t("chat.attach.denied")); return; }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["videos"], quality: 0.5, videoMaxDuration: 90 });
    if (!r.canceled && r.assets?.[0]) sendAsset(r.assets[0]);
  };
  const pickMedia = async () => {
    suppressLock();
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setErr(t("chat.attach.denied")); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], quality: 0.6 });
    if (!r.canceled && r.assets?.[0]) sendAsset(r.assets[0]);
  };
  // File generico (documenti, qualsiasi tipo) via DocumentPicker, cifrato E2EE come gli altri allegati.
  const attachFile = async () => {
    if (others.length === 0 || !user?.kem) { setErr(t("chat.attach.noconv")); return; }
    suppressLock();
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      if (a.size && a.size > bigatt.MAX_ATT) { setErr(lang === "en" ? "File too large (max 100MB)" : "File troppo grande (max 100MB)"); return; }
      setSending(true); setErr("");
      setUploadPct(0);
      const name = a.name || `file_${Date.now()}`;
      const mime = a.mimeType || "application/octet-stream";
      const onP = (p) => { if (mounted.current) setUploadPct(p); };
      // Oltre i 4 MB si passa al formato a pezzi: si legge dal disco, si cifra e si
      // spedisce un pezzo alla volta, senza mai tenere il file intero in memoria.
      let att;
      if ((a.size || 0) > bigatt.ATT_CHUNK) {
        att = await bigatt.uploadFileChunked({ uri: a.uri, name, mime, size: a.size, allowed: others, onProgress: onP });
      } else {
        const b64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 });
        const bytes = base64ToBytes(b64);
        const enc = encryptFileBytes(bytes);
        const { id } = await api.blobUpload(enc.ciphertext, onP, others);
        att = { id, name, mime, size: bytes.length, key: enc.key, iv: enc.iv };
      }
      const payload = packMessage(text.trim(), [att], replyTo, ttl);
      const envelopes = await buildEnvelopes(payload, others, user);
      const r2 = await api.send({ to_lns: others, envelopes });
      setText(""); setReplyTo(null);
      if (r2?.conv_id && r2.conv_id !== convId) setConvId(r2.conv_id);
      await load(r2?.conv_id || convId);
    } catch (e) { setErr(api.apiErr(e)); }
    finally { setSending(false); setUploadPct(null); }
  };
  // Apri/chiudi il menu allegati (stile identico ai gruppi).
  const toggleAttachMenu = () => {
    if (others.length === 0 || !user?.kem) { setErr(t("chat.attach.noconv")); return; }
    setShowAttachMenu((v) => {
      const next = !v;
      if (next) Keyboard.dismiss();
      return next;
    });
  };
  const runAttach = (fn) => { setShowAttachMenu(false); fn(); };

  const onChangeText = (t) => {
    const now = Date.now();
    if (convId && now - typingRef.current > 2500) { typingRef.current = now; api.pulseTyping(convId).catch(() => {}); }
    // Invio dalla tastiera: il tasto "invio" spedisce il messaggio.
    if (t.endsWith("\n")) { const clean = t.slice(0, -1); setText(clean); setTimeout(() => onSend(clean), 0); return; }
    setText(t);
  };

  // Messaggi precedenti: si allarga la finestra e si decifra SOLO il pezzo nuovo.
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    const now = Date.now();
    if (now - moreRef.current < 700) return;
    moreRef.current = now;
    setLoadingMore(true);
    atBottomRef.current = false;
    winRef.current = winRef.current + PAGE;
    setWin(winRef.current);
    try { await load(convId, winRef.current, false); } catch { /* si riprova */ }
    setLoadingMore(false);
    if (pendingRef.current) scheduleRepair(convId);
  }, [convId, load, loadingMore, hasMore, scheduleRepair]);

  // Stessa cura della lista delle conversazioni: la bolla si ridisegna solo quando cambia
  // qualcosa che la riguarda, non a ogni giro del poll.
  // Le buste che questo telefono non può aprire. Si ricavano da quello che è già a schermo:
  // nessuna interrogazione in più al server per contarle.
  const lockedIds = useMemo(() => msgs.filter((m) => m.body === UNDEC).map((m) => m.id).filter(Boolean), [msgs]);

  const purgeLocked = useCallback(async () => {
    if (!convId || !lockedIds.length || purging) return;
    setPurging(true); setErr("");
    try {
      await api.purgeMessages(convId, lockedIds.slice(0, 500));
      msgCache.clearAll();
      await load(convId, PAGE, false);
    } catch (e) { setErr(api.apiErr(e)); }
    setPurging(false);
  }, [convId, lockedIds, purging, load]);

  const renderItem = useCallback(({ item, index }) => (
    <>
      {(index === 0 || dayKeyOf(item.at) !== dayKeyOf((msgs[index - 1] || {}).at)) && (
        <View style={styles.dayRow} testID={"chat-day-" + dayKeyOf(item.at)}>
          <View style={styles.dayLine} />
          <Text style={styles.dayText}>{dayLabelOf(item.at, lang, t)}</Text>
          <View style={styles.dayLine} />
        </View>
      )}
    <TouchableOpacity
      activeOpacity={0.85}
      onLongPress={() => onMessageActions(item)}
      onLayout={(e) => { const h = e.nativeEvent.layout.height; if (h > 0) rowH.current.set(item.id, h); }}
      style={[styles.bubbleRow, item.mine ? styles.rowMine : styles.rowThem,
        rowH.current.has(item.id) ? { minHeight: rowH.current.get(item.id) } : null]}
    >
      <View style={[styles.bubble, item.mine ? styles.bubbleMe : styles.bubbleThem,
        // Colore d'accento scelto dall'utente, applicato alla bolla dei propri messaggi.
        item.mine ? { backgroundColor: accent + "22", borderColor: accent + "59" } : null]}>
        {item.pinned && (<Text style={styles.pinnedTag} testID="msg-pinned">📌 {lang === "en" ? "Pinned" : "Fissato"}</Text>)}
        {item.reply && (
          <View style={styles.quote}>
            <Text style={styles.quoteName} numberOfLines={1}>{item.reply.name}</Text>
            <Text style={styles.quoteText} numberOfLines={2}>{item.reply.text || "📎"}</Text>
          </View>
        )}
        {!!item.body && <SafeText text={item.body} style={styles.bubbleText} lang={lang} />}
        {!!item.body && <ThreatBanner result={analyzeMessage(item.body, lang)} lang={lang} />}
        {translations[item.id] && (
          <View style={styles.trBox} testID="msg-translated">
            <View style={styles.trRow}>
              <Text style={styles.trLabel}>🌐 {(translations[item.id].detected || "").toUpperCase()} → {((translations[item.id].target) || (lang === "en" ? "en" : "it")).toUpperCase()}</Text>
              <TouchableOpacity onPress={() => toggleTr(item.id)} testID="msg-translate-toggle">
                <Text style={styles.trToggle}>{translations[item.id].show ? (lang === "en" ? "See original" : "Vedi originale") : (lang === "en" ? "See translation" : "Vedi traduzione")}</Text>
              </TouchableOpacity>
            </View>
            {translations[item.id].show && <Text style={styles.trText}>{translations[item.id].text}</Text>}
          </View>
        )}
        {item.atts?.map((a, i) => <EncryptedAttachment key={a.id || i} att={a} />)}
        {item.reactions?.length > 0 && (
          <View style={styles.reactRow} testID="msg-reactions">
            {Object.entries(item.reactions.reduce((m, r) => { m[r.e] = (m[r.e] || 0) + 1; return m; }, {})).map(([e, n]) => (
              <View key={e} style={styles.reactChip}><Text style={styles.reactTxt}>{e}{n > 1 ? ` ${n}` : ""}</Text></View>
            ))}
          </View>
        )}
        {item.signed === true && (<Text style={styles.sigOk} testID="msg-signed">🔏 {lang === "en" ? "Signature verified · ML-DSA-65" : "Firma verificata · ML-DSA-65"}</Text>)}
        {item.signed === false && (<Text style={styles.sigBad}>🔏 {lang === "en" ? "invalid signature" : "firma non valida"}</Text>)}
        {item.ttl > 0 && (<Text style={styles.ttlTag}>⏱️ {item.ttl >= 3600 ? `${Math.round(item.ttl / 3600)}h` : item.ttl >= 60 ? `${Math.round(item.ttl / 60)}m` : `${item.ttl}s`}</Text>)}
        {item.edited && (<Text style={styles.editedTag} testID="msg-edited">{lang === "en" ? "edited" : "modificato"}</Text>)}
        <View style={styles.metaRow}>
          <Text style={styles.metaTime} testID="msg-time">{hhmm(item.at)}</Text>
          {item.mine && (
            <View style={styles.ticks} testID={item.read ? "tick-read" : item.delivered ? "tick-delivered" : "tick-sent"}>
              <Ionicons
                name={item.pending ? "time-outline" : item.delivered || item.read ? "checkmark-done" : "checkmark"}
                size={15}
                color={item.read ? "#50C878" : "rgba(255,255,255,0.55)"}
              />
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
    </>
  ), [styles, onMessageActions, accent, lang, translations, toggleTr, msgs, t]);

  return (
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={headerHeight} style={styles.root}>
      <TouchableOpacity
        activeOpacity={0.75}
        style={styles.e2eeBadge}
        testID="chat-e2ee-badge"
        onPress={() => setMapOpen((v) => !v)}
      >
        <Ionicons name="lock-closed-outline" size={11} color={theme.accent} />
        <Text style={styles.e2eeBadgeText}>{t("chat.e2eeBadge")}</Text>
        <Text style={styles.e2eeBadgeLink}>
          {"  ·  " + (mapOpen ? t("chat.map.close") : t("chat.map.open"))}
        </Text>
      </TouchableOpacity>
      {mapOpen && (
        <ChatConstellation
          via={mapRoute.via}
          neighbours={mapRoute.neighbours}
          hybrid={mapRoute.hybrid}
          pulses={mapRoute.pulses}
          t={t}
          tint={tint}
        />
      )}
      {vfy === "changed" && others.length === 1 && (
        <TouchableOpacity
          style={styles.vfyBar}
          testID="chat-verify-changed"
          onPress={() => navigation.navigate("VerifyContact", { peer: others[0], peer_name: title })}
        >
          <Ionicons name="warning-outline" size={13} color={theme.danger} />
          <Text style={styles.vfyBarTxt}>
            {lang === "en"
              ? "The keys of this contact changed — tap to verify again"
              : "Le chiavi di questo contatto sono cambiate — tocca per verificare di nuovo"}
          </Text>
        </TouchableOpacity>
      )}
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={tint} /></View>
      ) : (
        <FlatList
          ref={listRef}
          style={{ flex: 1, backgroundColor: chatBg }}
          data={msgs}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          initialNumToRender={12}
          maxToRenderPerBatch={8}
          windowSize={7}
          updateCellsBatchingPeriod={80}
          // `removeClippedSubviews` NON si usa: su Android, con righe di altezza variabile,
          // capita che i messaggi appaiano vuoti. Con la finestra da 12 non serve.
          contentContainerStyle={{ padding: 14, paddingBottom: 20 }}
          // Aggiungendo messaggi in cima la lista resta ferma dov'è: senza questo la
          // cronologia più vecchia spingeva via quello che stavi leggendo.
          maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
          onScroll={(e) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            atBottomRef.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 80;
            if (contentOffset.y <= 24 && hasMore) loadMore();
          }}
          scrollEventThrottle={160}
          onContentSizeChange={() => { if (atBottomRef.current) listRef.current?.scrollToEnd({ animated: false }); }}
          ListHeaderComponent={
            <View>
              {lockedIds.length > 0 && (
                <View style={{ marginHorizontal: 16, marginTop: 12, marginBottom: 4, borderWidth: 1, borderStyle: "dashed", borderColor: theme.border, borderRadius: 12, padding: 14 }} testID="chat-locked-note">
                  <Text style={{ color: theme.textDim, fontSize: 12, lineHeight: 18, textAlign: "center" }}>
                    {lang === "en"
                      ? `${lockedIds.length} envelope(s) encrypted for a key that no longer exists. Nobody can open them: not you, not the sender.`
                      : `${lockedIds.length} buste cifrate per una chiave che non esiste più. Non può aprirle nessuno: né tu né chi le ha mandate.`}
                  </Text>
                  <TouchableOpacity onPress={purgeLocked} disabled={purging} testID="chat-purge-locked"
                    style={{ marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: "#ff4d5e66", borderRadius: 10, paddingVertical: 10, opacity: purging ? 0.5 : 1 }}>
                    {purging
                      ? <ActivityIndicator color="#ff9a9a" size="small" />
                      : <Ionicons name="trash-outline" size={16} color="#ff9a9a" />}
                    <Text style={{ color: "#ff9a9a", fontSize: 13, fontWeight: "700" }}>
                      {purging ? (lang === "en" ? "Deleting…" : "Cancellazione…") : (lang === "en" ? "Throw them away" : "Buttale via")}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
              {hasMore ? (
              <TouchableOpacity onPress={loadMore} style={styles.moreBtn} disabled={loadingMore} testID="chat-load-more">
                {loadingMore
                  ? <ActivityIndicator color={tint} />
                  : <Text style={styles.moreText}>{lang === "en" ? "Earlier messages" : "Messaggi precedenti"}</Text>}
                </TouchableOpacity>
              ) : null}
            </View>
          }
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyLock}>🔒</Text>
              <Text style={styles.emptyText}>{t("chat.placeholder")}</Text>
            </View>
          }
        />
      )}

      {!!err && <Text style={styles.err} testID="chat-error">{err}</Text>}

      {editing && (
        <View style={styles.replyBar} testID="chat-editing-bar">
          <View style={{ flex: 1 }}>
            <Text style={styles.replyBarName} numberOfLines={1}>✏️ {lang === "en" ? "Editing message" : "Modifica messaggio"}</Text>
            <Text style={styles.replyBarText} numberOfLines={1}>{lang === "en" ? "Send to save changes" : "Invia per salvare le modifiche"}</Text>
          </View>
          <TouchableOpacity onPress={() => { setEditing(null); setText(""); }} testID="chat-editing-cancel" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close-outline" size={20} color={theme.textDim} />
          </TouchableOpacity>
        </View>
      )}

      {replyTo && (
        <View style={styles.replyBar} testID="chat-reply-bar">
          <View style={{ flex: 1 }}>
            <Text style={styles.replyBarName} numberOfLines={1}>{t("chat.replyingTo")} {replyTo.name}</Text>
            <Text style={styles.replyBarText} numberOfLines={1}>{replyTo.text || "📎"}</Text>
          </View>
          <TouchableOpacity onPress={() => setReplyTo(null)} testID="chat-reply-cancel" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={{ color: theme.textDim, fontSize: 18 }}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {typers.length > 0 && (
        <Text style={styles.typing} testID="chat-typing">✍️ {(typers[0] || "").split("@")[0]} {lang === "en" ? "is typing…" : "sta scrivendo…"}</Text>
      )}
      {uploadPct != null && (
        <View style={styles.uploadBar} testID="chat-upload-progress">
          <Ionicons name="cloud-upload-outline" size={16} color={tint} />
          <View style={styles.uploadTrack}>
            <View style={[styles.uploadFill, { width: `${Math.round(uploadPct * 100)}%` }]} />
          </View>
          <Text style={styles.uploadTxt} testID="chat-upload-pct">{Math.round(uploadPct * 100)}%</Text>
        </View>
      )}
      <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {recState.isRecording ? (
          <View style={styles.recRow} testID="chat-recording">
            <TouchableOpacity onPress={cancelRec} style={styles.recCancel} testID="rec-cancel"><Ionicons name="trash-outline" size={20} color="#FF6B7A" /></TouchableOpacity>
            <View style={styles.recDot} />
            <Text style={styles.recTime}>{mmss((recState.durationMillis || 0) / 1000)}</Text>
            <Text style={styles.recHint}>{lang === "en" ? "Recording…" : "Registrazione…"}</Text>
            <TouchableOpacity onPress={stopRecAndSend} style={styles.sendBtn} disabled={sending} testID="rec-send">
              {sending ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="send-outline" size={18} color="#fff" />}
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <TouchableOpacity style={styles.attachBtn} onPress={toggleAttachMenu} disabled={sending} testID="chat-attach">
              <Ionicons name="add-circle-outline" size={26} color={tint} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.ttlBtn, ttl > 0 && styles.ttlBtnOn]} onPress={cycleTtl} testID="chat-ttl">
              <Ionicons name="timer-outline" size={16} color={ttl > 0 ? "#fff" : theme.textDim} />
              <Text style={[styles.ttlTxt, ttl > 0 && { color: "#fff" }]}>{ttlLabel(ttl)}</Text>
            </TouchableOpacity>
            <TextInput
              style={styles.input}
              placeholder={t("chat.placeholder")}
              placeholderTextColor={theme.textFaint}
              value={text}
              onChangeText={onChangeText}
              onSubmitEditing={() => onSend()}
              onFocus={() => { setShowAttachMenu(false); setTimeout(() => scrollToEnd(true), 250); setTimeout(() => scrollToEnd(false), 550); }}
              selectionColor={tint}
              cursorColor={theme.text}
              keyboardAppearance="dark"
              returnKeyType="send"
              blurOnSubmit={false}
              multiline
              testID="chat-input"
            />
            {text.trim() ? (
              <TouchableOpacity style={[styles.sendBtn, sending && { opacity: 0.5 }]} onPress={() => onSend()} disabled={sending} testID="chat-send">
                {sending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.sendText}>↑</Text>}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.sendBtn, sending && { opacity: 0.5 }]} onPress={startRec} disabled={sending} testID="chat-mic">
                <Ionicons name="mic-outline" size={20} color="#fff" />
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
      {showAttachMenu && (
        <View style={[styles.attachMenu, { bottom: 60 + Math.max(insets.bottom, 10) }]} testID="chat-attach-menu">
          <TouchableOpacity style={styles.attachItem} onPress={() => runAttach(takePhoto)} disabled={sending} testID="chat-attach-photo">
            <Ionicons name="camera-outline" size={20} color={tint} />
            <Text style={styles.attachItemText}>{lang === "en" ? "Camera" : "Fotocamera"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.attachItem} onPress={() => runAttach(recordVideo)} disabled={sending} testID="chat-attach-video">
            <Ionicons name="videocam-outline" size={20} color={tint} />
            <Text style={styles.attachItemText}>{lang === "en" ? "Video" : "Video"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.attachItem} onPress={() => runAttach(pickMedia)} disabled={sending} testID="chat-attach-gallery">
            <Ionicons name="image-outline" size={20} color={tint} />
            <Text style={styles.attachItemText}>{lang === "en" ? "Gallery" : "Galleria"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.attachItem} onPress={() => runAttach(attachFile)} disabled={sending} testID="chat-attach-file">
            <Ionicons name="document-attach-outline" size={20} color={tint} />
            <Text style={styles.attachItemText}>{lang === "en" ? "File" : "File"}</Text>
          </TouchableOpacity>
        </View>
      )}
      {actionItem && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setActionItem(null)}>
          <Pressable style={styles.sheetWrap} onPress={() => setActionItem(null)}>
            <Pressable style={styles.sheet}>
              <View style={styles.emojiRow}>
                {["👍", "❤️", "😂", "😮", "😢", "🙏"].map((em) => (
                  <TouchableOpacity key={em} style={styles.emojiBtn} testID={`chat-react-${em}`} onPress={() => doReact(actionItem, em)}>
                    <Text style={styles.emojiText}>{em}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity style={styles.sheetItem} testID="chat-action-reply" onPress={() => { const it = actionItem; setActionItem(null); setReplyTo({ id: it.id, name: it.mine ? (user?.lns?.split("@")[0] || "?") : title, text: (it.body || "").slice(0, 140) }); }}>
                <Ionicons name="arrow-undo-outline" size={18} color={theme.text} />
                <Text style={styles.sheetItemText}>{t("chat.reply")}</Text>
              </TouchableOpacity>
              {actionItem.mine && !!actionItem.body && (
                <TouchableOpacity style={styles.sheetItem} testID="chat-action-edit" onPress={() => startEdit(actionItem)}>
                  <Ionicons name="create-outline" size={18} color={theme.text} />
                  <Text style={styles.sheetItemText}>{lang === "en" ? "Edit" : "Modifica"}</Text>
                </TouchableOpacity>
              )}
              {!!actionItem.body && (
                <TouchableOpacity style={styles.sheetItem} testID="chat-action-translate" onPress={() => { const it = actionItem; setActionItem(null); onTranslate(it); }}>
                  <Ionicons name="language-outline" size={18} color={theme.text} />
                  <Text style={styles.sheetItemText}>{(lang === "en" ? "Translate text" : "Traduci testo")}{(() => { const dl = detectLang(actionItem.body); return dl ? "  " + langFlag(dl) : ""; })()}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.sheetItem} testID="chat-action-forward" onPress={() => { const it = actionItem; setActionItem(null); navigation.navigate("Forward", { text: it.body || "", atts: it.atts || [] }); }}>
                <Ionicons name="arrow-redo-outline" size={18} color={theme.text} />
                <Text style={styles.sheetItemText}>{lang === "en" ? "Forward" : "Inoltra"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.sheetItem} testID="chat-action-pin" onPress={() => doPin(actionItem)}>
                <Ionicons name={actionItem.pinned ? "bookmark" : "bookmark-outline"} size={18} color={theme.text} />
                <Text style={styles.sheetItemText}>{actionItem.pinned ? (lang === "en" ? "Unpin message" : "Rimuovi da fissati") : (lang === "en" ? "Pin message" : "Fissa messaggio")}</Text>
              </TouchableOpacity>
              {!actionItem.mine && (
                <TouchableOpacity style={styles.sheetItem} testID="chat-action-report" onPress={() => doReport(actionItem)}>
                  <Ionicons name="flag-outline" size={18} color={theme.text} />
                  <Text style={styles.sheetItemText}>{lang === "en" ? "Report" : "Segnala"}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.sheetItem} testID="chat-action-delete-me" onPress={() => doDelete(actionItem, "me")}>
                <Ionicons name="trash-outline" size={18} color={theme.text} />
                <Text style={styles.sheetItemText}>{t("chat.deleteForMe")}</Text>
              </TouchableOpacity>
              {actionItem.mine && (
                <TouchableOpacity style={styles.sheetItem} testID="chat-action-delete-all" onPress={() => doDelete(actionItem, "all")}>
                  <Ionicons name="trash-outline" size={18} color={theme.danger} />
                  <Text style={[styles.sheetItemText, { color: theme.danger }]}>{t("chat.deleteForAll")}</Text>
                </TouchableOpacity>
              )}
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </KeyboardAvoidingView>
  );
}

const makeStyles = (tint) => StyleSheet.create({
  vfyBar: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "#2A1216", borderBottomWidth: 1, borderBottomColor: "#5A2630", paddingHorizontal: 14, paddingVertical: 8 },
  vfyBarTxt: { flex: 1, color: "#FFD9DE", fontSize: 11 },
  root: { flex: 1, backgroundColor: "transparent" },
  e2eeBadge: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 5, backgroundColor: "rgba(80,200,120,0.08)", borderBottomWidth: 1, borderBottomColor: "rgba(80,200,120,0.18)" },
  e2eeBadgeText: { color: theme.accent, fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },
  e2eeBadgeLink: { color: theme.textDim, fontSize: 11, fontWeight: "600" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  emptyLock: { fontSize: 40, marginBottom: 12 },
  emptyText: { color: theme.textDim, textAlign: "center", lineHeight: 20 },
  bubbleRow: { marginVertical: 4, flexDirection: "row" },
  rowMine: { justifyContent: "flex-end" },
  rowThem: { justifyContent: "flex-start" },
  bubble: { maxWidth: "80%", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleMe: { backgroundColor: theme.bubbleMe, borderBottomRightRadius: 5 },
  bubbleThem: { backgroundColor: theme.bubbleThem, borderBottomLeftRadius: 5 },
  bubbleText: { color: "#fff", fontSize: 15, lineHeight: 20 },
  attach: { color: "#D6E4FF", fontSize: 12, marginTop: 5 },
  quote: { borderLeftWidth: 3, borderLeftColor: "rgba(255,255,255,0.5)", paddingLeft: 8, marginBottom: 6, opacity: 0.9 },
  quoteName: { color: "#DCE7FF", fontSize: 12, fontWeight: "800" },
  quoteText: { color: "rgba(255,255,255,0.75)", fontSize: 13 },
  replyBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.surfaceAlt },
  replyBarName: { color: tint, fontSize: 12, fontWeight: "800" },
  replyBarText: { color: theme.textDim, fontSize: 13 },
  ticks: { flexDirection: "row", justifyContent: "flex-end", marginTop: 3, marginRight: -2 },
  attachBtn: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
  attachMenu: { position: "absolute", left: 10, backgroundColor: theme.surfaceAlt, borderColor: theme.border, borderWidth: 1, borderRadius: 14, paddingVertical: 6, minWidth: 180, shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8, zIndex: 20 },
  attachItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 16 },
  attachItemText: { color: theme.text, fontSize: 15, fontWeight: "600" },
  attachIcon: { fontSize: 22 },
  moreBtn: { alignSelf: "center", paddingVertical: 10, paddingHorizontal: 18, marginBottom: 10, borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", minHeight: 40, justifyContent: "center" },
  moreText: { color: tint, fontSize: 12, fontWeight: "800", letterSpacing: 0.4 },
  err: { color: "#FFB3BD", fontSize: 13, paddingHorizontal: 16, paddingBottom: 6 },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.surface },
  input: { flex: 1, backgroundColor: theme.surfaceAlt, borderRadius: 20, color: theme.text, paddingHorizontal: 16, paddingVertical: 10, maxHeight: 120, fontSize: 15 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: tint, alignItems: "center", justifyContent: "center" },
  sendText: { color: "#fff", fontSize: 22, fontWeight: "700" },
  ttlBtn: { flexDirection: "row", alignItems: "center", gap: 3, height: 44, paddingHorizontal: 8, borderRadius: 14 },
  ttlBtnOn: { backgroundColor: tint },
  ttlTxt: { color: theme.textDim, fontSize: 12, fontWeight: "800", minWidth: 16 },
  recRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  recCancel: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
  recDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: "#FF3B44" },
  recTime: { color: theme.text, fontSize: 15, fontWeight: "800", minWidth: 44 },
  recHint: { flex: 1, color: theme.textDim, fontSize: 13 },
  reactRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 5 },
  sheetWrap: { flex: 1, backgroundColor: "#0009", justifyContent: "flex-end" },
  sheet: { backgroundColor: theme.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 14, paddingBottom: 30, borderTopWidth: 1, borderColor: theme.border },
  emojiRow: { flexDirection: "row", justifyContent: "space-around", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border, marginBottom: 6 },
  emojiBtn: { padding: 6 },
  emojiText: { fontSize: 28 },
  sheetItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 6 },
  sheetItemText: { color: theme.text, fontSize: 16, fontWeight: "600" },
  reactChip: { backgroundColor: "rgba(0,0,0,0.25)", borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 },
  reactTxt: { color: "#fff", fontSize: 13, fontWeight: "700" },
  ttlTag: { color: "rgba(255,255,255,0.6)", fontSize: 10, marginTop: 4, fontWeight: "700" },
  editedTag: { color: "rgba(255,255,255,0.5)", fontSize: 10, marginTop: 3, fontStyle: "italic" },
  dayRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 10 },
  dayLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: theme.border },
  dayText: { color: theme.textDim, fontSize: 10.5, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase" },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 5, marginTop: 3 },
  metaTime: { color: theme.textDim, fontSize: 10.5 },
  pinnedTag: { color: theme.accent, fontSize: 10.5, fontWeight: "800", marginBottom: 4 },
  typing: { color: theme.textDim, fontSize: 12, fontStyle: "italic", paddingHorizontal: 16, paddingBottom: 4 },
  uploadBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.surfaceAlt },
  uploadTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.12)", overflow: "hidden" },
  uploadFill: { height: 6, borderRadius: 3, backgroundColor: tint },
  uploadTxt: { color: tint, fontSize: 12, fontWeight: "800", minWidth: 38, textAlign: "right" },
  sigOk: { color: "#4fe0a5", fontSize: 10, marginTop: 4, fontWeight: "800" },
  sigBad: { color: "#ff9a9a", fontSize: 10, marginTop: 4, fontWeight: "800" },
  trBox: { marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.15)" },
  trRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 },
  trToggle: { color: "#9ec5ff", fontSize: 10, fontWeight: "800" },
  trLabel: { color: "rgba(255,255,255,0.6)", fontSize: 10, fontWeight: "800", marginBottom: 2 },
  trText: { color: "#EAF2FF", fontSize: 14, lineHeight: 19, fontStyle: "italic" },
  langBadge: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", marginTop: 6, backgroundColor: "rgba(255,255,255,0.10)", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  langBadgeFlag: { fontSize: 13 },
  langBadgeCode: { color: "rgba(255,255,255,0.9)", fontSize: 10.5, fontWeight: "900", letterSpacing: 0.5 },
  langBadgeTap: { color: "#9ec5ff", fontSize: 10, fontWeight: "700" },
});

import React, { useState, useEffect, useMemo } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Vibration, ActivityIndicator, Alert, Linking, Platform, Modal, TextInput, Share,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as appearance from "../lib/appearance";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Print from "expo-print";
import { Asset } from "expo-asset";
import { useTint } from "../lib/appearance";
import { theme } from "../theme";
import { useI18n } from "../lib/i18n";
import { display as displayInfo, fpsLine } from "../lib/display";
import { useAuth } from "../context/AuthContext";
import { checkUpdate, downloadAndInstall } from "../lib/update";
import { suppressLock } from "../lib/lockGuard";
import * as wake from "../lib/wake";
import * as api from "../lib/api";
import { DEFAULT_SERVER } from "../config";
import { isDeviceSecure, authenticate } from "../lib/biometrics";
import { registerForPush, scheduleDailyQuizReminder, loadReminderTimes } from "../lib/notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as cover from "../lib/cover";
import * as tunnel from "../lib/tunnel";
import * as meshNode from "../lib/mesh";
import MeshConstellation from "../components/MeshConstellation";
import { UI_LANGS } from "../lib/locales";
import * as meshRuntime from "../lib/mesh/runtime";
import * as meshRadio from "../lib/mesh/radio";
import * as meshChat from "../lib/meshchat";
import * as decdiag from "../lib/decdiag";
import { saveAllowDirect, loadAllowDirect, saveAppLock, loadAppLock, saveNotifPref, loadNotifPref, saveAutoTranslate, loadAutoTranslate, saveTranslateTarget, loadTranslateTarget, saveRingtone, loadRingtone, saveRingVolume, loadRingVolume, saveVibMode, loadVibMode } from "../lib/store";
import { createAudioPlayer } from "expo-audio";
const RINGTONES = { classic: require("../../assets/ringtone.wav"), chime: require("../../assets/ring_chime.wav"), beep: require("../../assets/ring_beep.wav"), digital: require("../../assets/ring_digital.wav"), marimba: require("../../assets/ring_marimba.wav"), pulse: require("../../assets/ring_pulse.wav") };
const RINGTONE_OPTS = [["classic", "Classica"], ["chime", "Chime"], ["beep", "Beep"], ["digital", "Digitale"], ["marimba", "Marimba"], ["pulse", "Pulsazione"]];
const VIB_PATTERNS = { standard: [0, 700, 900, 700], short: [0, 400, 300, 400], long: [0, 1200, 600, 1200] };
import { TRANSLATE_LANGS, langName } from "../lib/langs";
import { getThreatLog, clearThreatLog, getThreatCount } from "../lib/threatLog";

const PRIVACY_LNS = "fabioastorino@latticenetwork.lns";

const LEGAL_DOCS = [
  { key: "settings.privacy", path: "/privacy", icon: "shield-checkmark-outline" },
  { key: "settings.terms", path: "/termini", icon: "document-text-outline" },
  { key: "settings.cookie", path: "/cookie", icon: "cafe-outline" },
  { key: "settings.dpa", path: "/dpa", icon: "server-outline" },
  { key: "settings.eula", path: "/licenza", icon: "ribbon-outline" },
  { key: "settings.aup", path: "/uso-accettabile", icon: "checkmark-done-outline" },
  { key: "settings.sla", path: "/sla", icon: "speedometer-outline" },
  { key: "settings.legalIndex", path: "/legale", icon: "library-outline" },
];

function fmtAgo(ts, lang) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  const en = lang === "en";
  if (s < 60) return t("sm.001");
  const m = Math.floor(s / 60); if (m < 60) return t("sm.ago.min", { n: m });
  const h = Math.floor(m / 60); if (h < 24) return t("sm.ago.hour", { n: h });
  const d = Math.floor(h / 24); if (d < 7) return t("sm.ago.day", { n: d });
  try { return new Date(ts).toLocaleDateString(); } catch { return ""; }
}

const LEGAL_IT = `INFORMATIVA SULLA PRIVACY E TERMINI DI SERVIZIO
Ultimo aggiornamento: giugno 2026

1. TITOLARE DEL TRATTAMENTO
Il servizio Lattice Network è gestito dall'organizzazione che lo ospita (self-hosted). Per esercitare i tuoi diritti contatta l'amministratore della tua azienda o il DPO indicato dalla tua organizzazione.

2. PRINCIPIO: CIFRATURA END-TO-END
Messaggi, allegati, note vocali, chiamate/videochiamate e stati sono cifrati end-to-end con crittografia post-quantistica (ML-KEM-768 per lo scambio chiavi, ML-DSA-65 per le firme). Le chiavi private restano solo sul tuo dispositivo, protette dal tuo PIN. Il gestore del servizio NON può leggere i tuoi contenuti.

3. DATI CHE TRATTIAMO (base giuridica: esecuzione del contratto/servizio, art. 6.1.b GDPR)
- Identità di rete (LNS) e appartenenza aziendale, per instradare i messaggi.
- Buste crittografate e metadati minimi di consegna (mittente/destinatario, orario) necessari alla consegna.
- Chiavi pubbliche (ML-KEM, ML-DSA, X25519) per abilitare cifratura, firma e signaling anonimo.
- Token di notifica push (FCM) per avvisarti di nuovi messaggi/chiamate.
- Indirizzo IP di rete delle richieste (log tecnici standard), non collegato al contenuto.

4. COSA NON RACCOGLIAMO / NON VEDIAMO
- Il contenuto in chiaro delle comunicazioni.
- Per le chiamate: chi chiama chi e quando (usiamo un "blind rendezvous" anonimo: solo identificatori casuali temporanei); l'IP tra i peer è nascosto perché l'audio/video passa solo da un relay cifrato.
- Il tuo PIN e le tue chiavi private.

5. CONSERVAZIONE (data retention)
- I dati di signaling delle chiamate scadono automaticamente entro 120 secondi.
- SDP e candidati di rete vengono rimossi al termine della chiamata.
- I messaggi seguono i tempi/impostazioni di conservazione della tua organizzazione (inclusi i messaggi a scadenza, se attivi).

6. I TUOI DIRITTI (GDPR artt. 15-22)
Hai diritto di accesso, rettifica, cancellazione, limitazione, portabilità e opposizione. Puoi eliminare il tuo account dall'app (Impostazioni). Per richieste rivolgiti all'amministratore/DPO della tua organizzazione.

7. SICUREZZA
Crittografia post-quantistica end-to-end, verifica anti-intercettazione (emoji SAS da confrontare a voce durante la chiamata), protezione anti-screenshot, blocco con PIN.

8. USO LECITO
Il servizio è destinato a comunicazioni professionali legittime. La crittografia tutela la tua riservatezza nel rispetto delle leggi vigenti. Sei responsabile di un utilizzo conforme alla legge; è vietato ogni uso illecito.

9. LIMITAZIONI
Nessun sistema garantisce sicurezza assoluta. Consigliamo di verificare le emoji di sicurezza nelle chiamate sensibili. Il gestore non risponde di usi contrari alla legge da parte degli utenti.

Contatto: l'amministratore della tua organizzazione.`;

const LEGAL_EN = `PRIVACY POLICY AND TERMS OF SERVICE
Last updated: June 2026

1. DATA CONTROLLER
Lattice Network is operated by the organization hosting it (self-hosted). To exercise your rights, contact your company administrator or the DPO designated by your organization.

2. PRINCIPLE: END-TO-END ENCRYPTION
Messages, attachments, voice notes, calls/video calls and status are end-to-end encrypted with post-quantum cryptography (ML-KEM-768 for key exchange, ML-DSA-65 for signatures). Private keys stay only on your device, protected by your PIN. The service operator CANNOT read your content.

3. DATA WE PROCESS (legal basis: performance of the contract/service, art. 6.1.b GDPR)
- Network identity (LNS) and company membership, to route messages.
- Encrypted envelopes and minimal delivery metadata (sender/recipient, time) needed for delivery.
- Public keys (ML-KEM, ML-DSA, X25519) to enable encryption, signing and anonymous signaling.
- Push notification tokens (FCM) to alert you of new messages/calls.
- Network IP address of requests (standard technical logs), not linked to content.

4. WHAT WE DO NOT COLLECT / CANNOT SEE
- The plaintext content of communications.
- For calls: who calls whom and when (we use an anonymous "blind rendezvous": only temporary random identifiers); peer IPs are hidden because audio/video only flows through an encrypted relay.
- Your PIN and private keys.

5. DATA RETENTION
- Call signaling data auto-expires within 120 seconds.
- SDP and network candidates are removed when the call ends.
- Messages follow your organization's retention settings (including disappearing messages, if enabled).

6. YOUR RIGHTS (GDPR arts. 15-22)
You have the right to access, rectification, erasure, restriction, portability and objection. You can delete your account from the app (Settings). For requests, contact your organization's administrator/DPO.

7. SECURITY
Post-quantum end-to-end encryption, anti-interception verification (SAS emojis to compare aloud during a call), anti-screenshot protection, PIN lock.

8. LAWFUL USE
The service is intended for legitimate professional communications. Encryption protects your privacy in compliance with applicable laws. You are responsible for lawful use; any unlawful use is prohibited.

9. LIMITATIONS
No system guarantees absolute security. We recommend verifying the security emojis on sensitive calls. The operator is not liable for unlawful use by users.

Contact: your organization's administrator.`;


// Stato della radio in parole, non in sigle.
function radioLabel(v, t) {
  const k = String(v || "off");
  const known = ["off", "perm", "on", "group", "bt-off", "adv+scan", "near"];
  return known.includes(k) ? t("sm.radio." + k) : k;
}

export default function SettingsScreen({ navigation }) {
  const tint = useTint();
  const styles = useMemo(() => makeStyles(tint), [tint]);
  const { t, lang, setLang } = useI18n();
  const [fps, setFps] = useState({ hz: 0, maxHz: 0, modes: 0 });
  const en = lang === "en";
  const { user, signOut, lock } = useAuth();
  const isOss = (user?.lns || "").endsWith("@tuttooss.lns");
  const isOwner = (user?.lns || "").toLowerCase() === "fabioastorino@latticenetwork.lns";
  const [callDirect, setCallDirect] = useState(false);
  const [chaff, setChaff] = useState(true);
  const [darkMesh, setDarkMesh] = useState(false);
  const [meshBusy, setMeshBusy] = useState(false);
  const [sovereign, setSovereign] = useState(false);
  const [netHealth, setNetHealth] = useState(null);
  const [sovBusy, setSovBusy] = useState(false);
  const [probeCode, setProbeCode] = useState("");
  const [meshQ, setMeshQ] = useState(null);
  const [relayCode, setRelayCode] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [wakeOn, setWakeOn] = useState(false);
  const [wakeBusy, setWakeBusy] = useState(false);
  const [upBusy, setUpBusy] = useState(false);
  const [upMsg, setUpMsg] = useState("");
  // Controllo manuale: se c'è una versione più nuova la scarica e apre l'installazione
  // in sovrascrittura (nessuna disinstallazione).
  const doCheckUpdate = async () => {
    setUpBusy(true); setUpMsg("");
    try {
      const r = await checkUpdate();
      if (r.untrusted) {
        setUpMsg(t("sm.002"));
        return;
      }
      if (!r.available) {
        setUpMsg((t("sm.003")) + r.current + ").");
        return;
      }
      setUpMsg((t("sm.004")) + r.version + "…");
      suppressLock();
      await downloadAndInstall(r, (p, phase) => setUpMsg(
        (phase === "verify"
          ? (t("sm.005"))
          : (t("sm.004")) + r.version + "… ") + Math.round(p * 100) + "%"));
      suppressLock();
      setUpMsg(t("sm.006"));
    } catch (e) {
      setUpMsg(String((e && e.message) || (t("sm.007"))));
    } finally { setUpBusy(false); }
  };
  const shareCard = async () => {
    const me = (user?.lns || "").toLowerCase();
    const url = `${api.getServerUrl()}/card.html?u=${encodeURIComponent(me)}`;
    try {
      await Share.share({ message: (t("sm.008")) + url });
    } catch { /* annullato */ }
  };
  const inviteFriend = async () => {
    const me = (user?.lns || "").toLowerCase();
    const url = `${api.getServerUrl()}/signup.html?ref=${encodeURIComponent(me)}`;
    try {
      await Share.share({ message: (t("sm.009")) + url });
    } catch { /* utente ha annullato */ }
  };
  const insets = useSafeAreaInsets();
  const [secure, setSecure] = useState(false);
  const [appLock, setAppLock] = useState(true);
  const [notif, setNotif] = useState(true);
  const [pushOk, setPushOk] = useState(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [ringtone, setRingtone] = useState("classic");
  const [ringVol, setRingVol] = useState(1);
  const [vibMode, setVibMode] = useState("standard");
  const [autoTr, setAutoTr] = useState(false);
  const [trTarget, setTrTarget] = useState(null);
  const [showTrLang, setShowTrLang] = useState(false);
  const [trSearch, setTrSearch] = useState("");
  const [threatLog, setThreatLog] = useState([]);
  const [threatCount, setThreatCount] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showLegal, setShowLegal] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [delText, setDelText] = useState("");
  const [genPdf, setGenPdf] = useState(false);
  const [reminderTimes, setReminderTimes] = useState([{ hour: 19, minute: 0 }]);
  const [pickHour, setPickHour] = useState(19);
  const [pickMinute, setPickMinute] = useState(0);
  useEffect(() => { displayInfo().then(setFps).catch(() => {}); }, []);

  useEffect(() => { loadAllowDirect().then((v) => setCallDirect(!!v)).catch(() => {}); }, []);
  useEffect(() => { wake.isOn().then((v) => setWakeOn(!!v)).catch(() => {}); }, []);

  // Notifiche dal nostro server: il servizio nativo tiene aperta una connessione in attesa
  // e Google viene coinvolto solo se quel servizio non risponde più.
  const toggleWake = async (v) => {
    setWakeBusy(true);
    try {
      if (v) {
        await wake.enable();
        setWakeOn(true);
        Alert.alert(
          t("sm.010"),
          t("sm.011")
        );
      } else {
        await wake.disable();
        setWakeOn(false);
      }
    } catch (e) {
      Alert.alert(t("sm.012"), String((e && e.message) || e));
    } finally { setWakeBusy(false); }
  };

  useEffect(() => { loadReminderTimes().then((ts) => { if (ts?.length) setReminderTimes(ts); }).catch(() => {}); }, []);
  const persistTimes = async (arr) => {
    const norm = arr
      .map((t) => ({ hour: t.hour | 0, minute: t.minute | 0 }))
      .filter((t, i, a) => a.findIndex((x) => x.hour === t.hour && x.minute === t.minute) === i)
      .sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute));
    setReminderTimes(norm);
    try { await AsyncStorage.setItem("reminder_times", JSON.stringify(norm)); await scheduleDailyQuizReminder(norm); } catch { /* */ }
  };
  const addTime = () => persistTimes([...reminderTimes, { hour: pickHour, minute: pickMinute }]);
  const removeTime = (t) => persistTimes(reminderTimes.filter((x) => !(x.hour === t.hour && x.minute === t.minute)));

  const base = user?.server || DEFAULT_SERVER;

  useEffect(() => {
    (async () => {
      setSecure(await isDeviceSecure());
      const al = await loadAppLock(); setAppLock(al !== false);
      const np = await loadNotifPref(); setNotif(np !== false);
      const rk = await loadRingtone(); setRingtone(rk);
      const rv = await loadRingVolume(); setRingVol(rv);
      const vm = await loadVibMode(); setVibMode(vm);
      setAutoTr(await loadAutoTranslate());
      setTrTarget(await loadTranslateTarget());
    })();
  }, []);

  useEffect(() => {
    const load = () => {
      getThreatLog().then((l) => setThreatLog(l.slice()));
      getThreatCount().then(setThreatCount);
    };
    load();
    const unsub = navigation.addListener("focus", load);
    return unsub;
  }, [navigation]);

  const emptyThreatLog = async () => { await clearThreatLog(); setThreatLog([]); };

  // Minacce bloccate negli ultimi 7 giorni (dal registro locale), per il grafico.
  const weekBars = useMemo(() => {
    const days = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      days.push({ start: d.getTime(), end: d.getTime() + 86400000, n: 0, label: d.toLocaleDateString(lang === "en" ? "en-GB" : "it-IT", { weekday: "short" }).slice(0, 2) });
    }
    for (const e of threatLog) {
      for (const day of days) { if (e.at >= day.start && e.at < day.end) { day.n++; break; } }
    }
    return days;
  }, [threatLog, lang]);
  const weekMax = Math.max(1, ...weekBars.map((d) => d.n));

  const toggleLock = async (v) => {
    if (v && !secure) { Alert.alert(t("settings.appLock"), t("settings.appLock.noHw")); return; }
    if (v) { const ok = await authenticate(); if (!ok) return; }
    setAppLock(v); await saveAppLock(v);
  };
  // PROVA FISICA: l'unica che vale. Il pacchetto passa dal mezzo reale (UDP sulla Wi-Fi).
  const runProbe = async () => {
    if (testBusy) return;
    setTestBusy(true);
    try { setProbeCode(await meshRuntime.sendProbe()); }
    catch (e) { Alert.alert(t("sm.013"), String((e && e.message) || e)); }
    finally { setTestBusy(false); }
  };
  const runRelay = async () => {
    if (testBusy) return;
    setTestBusy(true);
    try { setRelayCode(await meshRuntime.startSelfTest()); }
    catch (e) { Alert.alert(t("sm.013"), String((e && e.message) || e)); }
    finally { setTestBusy(false); }
  };
  const chooseSovereign = async (v) => {
    if (sovBusy || v === sovereign) return;
    setSovBusy(true);
    try {
      if (v) {
        // FASE 2: senza questi permessi Android non consente Wi-Fi Direct né BLE.
        if (!(await meshRadio.has())) {
          Alert.alert(t("sm.014"),
            t("sm.015"));
          try { await meshRadio.request(); } catch { /* si procede: la mesh Wi-Fi funziona comunque */ }
        }
        await meshRuntime.start(user, meshChat.onDeliver, () => meshChat.flush(user), require("../lib/bridge").carry);
        setSovereign(true);
        Alert.alert(t("sm.016"),
          t("sm.017"));
      } else {
        await meshRuntime.stop();
        setSovereign(false);
      }
    } catch (e) {
      setSovereign(false);
      Alert.alert(t("sm.018"), String((e && e.message) || e));
    } finally { setSovBusy(false); }
  };
  const toggleMesh = async (v) => {
    if (meshBusy) return;
    if (!tunnel.available()) {
      Alert.alert(t("sm.019"),
        t("sm.020"));
      return;
    }
    setMeshBusy(true);
    try {
      await tunnel.setEnabled(v);
      setDarkMesh(v);
      if (v) Alert.alert(t("sm.021"),
        t("sm.022"));
    } catch (e) {
      setDarkMesh(false);
      Alert.alert(t("sm.023"),
        t("sm.024"));
    } finally { setMeshBusy(false); }
  };
  const toggleNotif = async (v) => {
    setNotif(v); await saveNotifPref(v);
    if (v) { try { const tok = await registerForPush(); if (tok) { await api.registerPushToken(tok, Platform.OS); setPushOk(true); } else setPushOk(false); } catch { setPushOk(false); } }
  };

  // Stato reale delle notifiche su QUESTO dispositivo: permesso concesso + token registrato.
  const checkPush = async () => {
    setPushBusy(true);
    try {
      const tok = await registerForPush();
      if (tok) { await api.registerPushToken(tok, Platform.OS); setPushOk(true); }
      else setPushOk(false);
    } catch { setPushOk(false); }
    finally { setPushBusy(false); }
  };
  useEffect(() => { checkPush(); }, []);
  useEffect(() => { cover.isEnabled().then(setChaff).catch(() => {}); }, []);
  useEffect(() => { tunnel.isEnabled().then(setDarkMesh).catch(() => {}); }, []);
  useEffect(() => { meshNode.getMode().then((m) => setSovereign(m === meshNode.SOVEREIGN)).catch(() => {}); }, []);
  // Barometro: si aggiorna solo mentre la modalità è attiva (nessun consumo altrimenti).
  useEffect(() => {
    if (!sovereign) { setNetHealth(null); return undefined; }
    let alive = true;
    const tick = () => {
      meshRuntime.status().then((st) => { if (alive) setNetHealth(st); }).catch(() => {});
      meshChat.status().then((s) => { if (alive) setMeshQ(s); }).catch(() => {});
    };
    tick();
    const iv = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(iv); };
  }, [sovereign]);

  const doExport = async () => {
    setExporting(true);
    try {
      const data = await api.accountExport();
      const path = FileSystem.cacheDirectory + `lattice-dati-${Date.now()}.json`;
      await FileSystem.writeAsStringAsync(path, JSON.stringify(data, null, 2), { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path, { mimeType: "application/json", dialogTitle: t("settings.export") });
      else Alert.alert(t("settings.export"), t("settings.export.done"));
    } catch (e) { Alert.alert(t("settings.export"), api.apiErr(e)); }
    finally { setExporting(false); }
  };

  const doDelete = () => { setDelText(""); setShowDelete(true); };
  const confirmDelete = async () => {
    setDeleting(true);
    try { await api.accountDelete(); setShowDelete(false); Alert.alert(t("settings.delete"), t("settings.delete.done")); await signOut(); }
    catch (e) { Alert.alert(t("settings.delete"), api.apiErr(e)); }
    finally { setDeleting(false); }
  };

  const openLegal = (doc) => navigation.navigate("Legal", { url: base + doc.path, title: t(doc.key) });

  const doCompliance = async () => {
    setGenPdf(true);
    try {
      const it = lang !== "en";
      const now = new Date().toLocaleString(it ? "it-IT" : "en-US");
      const d = new Date();
      const protocol = `LN-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
      let logo = "";
      try {
        const asset = Asset.fromModule(require("../../assets/lattice-logo.png"));
        await asset.downloadAsync();
        if (asset.localUri) {
          const b64 = await FileSystem.readAsStringAsync(asset.localUri, { encoding: FileSystem.EncodingType.Base64 });
          logo = `data:image/png;base64,${b64}`;
        }
      } catch {}
      const L = it
        ? { title: "Ricevuta di conformità", sub: "Sicurezza & Privacy · Lattice",
            issued: "Rilasciata il", proto: "Protocollo n.", subject: "Identità", controller: "Titolare del trattamento",
            secTitle: "Misure di sicurezza tecniche", privTitle: "Protezione dei dati e GDPR",
            sec: [
              "Cifratura end-to-end di messaggi e allegati sul dispositivo (AES-256-GCM).",
              "Firma digitale post-quantum ML-DSA-65 (resistente ai computer quantistici).",
              "Scambio chiavi post-quantum ML-KEM-768 per ogni destinatario.",
              "Chiave privata custodita solo sul dispositivo dell'utente: mai trasmessa al server.",
              "Notarizzazione delle mail certificate con ancoraggio su blockchain (hash + firma verificabili).",
              "Blocco applicazione con biometria / PIN.",
            ],
            priv: [
              "Consenso esplicito raccolto al primo utilizzo (privacy e termini) e registrato lato server.",
              "Diritto di accesso e portabilità dei dati (esportazione in JSON) — GDPR art. 15 e 20.",
              "Diritto all'oblio: eliminazione definitiva di identità e dati dall'app — GDPR art. 17.",
              "Contenuti illeggibili al fornitore grazie alla cifratura end-to-end (data minimization).",
            ],
            footer: "Documento generato automaticamente dall'app Lattice a fini informativi." }
        : { title: "Compliance certificate", sub: "Security & Privacy · Lattice",
            issued: "Issued on", proto: "Protocol no.", subject: "Identity", controller: "Data controller",
            secTitle: "Technical security measures", privTitle: "Data protection & GDPR",
            sec: [
              "End-to-end encryption of messages and attachments on device (AES-256-GCM).",
              "Post-quantum digital signature ML-DSA-65 (quantum-resistant).",
              "Post-quantum key exchange ML-KEM-768 per recipient.",
              "Private key kept only on the user's device: never sent to the server.",
              "Notarised mail notarization anchored on blockchain (verifiable hash + signature).",
              "App lock with biometrics / PIN.",
            ],
            priv: [
              "Explicit consent collected on first use (privacy & terms) and recorded server-side.",
              "Right of access and data portability (JSON export) — GDPR art. 15 & 20.",
              "Right to erasure: permanent deletion of identity and data from the app — GDPR art. 17.",
              "Content unreadable to the provider thanks to end-to-end encryption (data minimization).",
            ],
            footer: "Document automatically generated by the Lattice app for informational purposes." };
      const li = (arr) => arr.map((x) => `<li>${x}</li>`).join("");
      const html = `<html><head><meta charset="utf-8"><style>
        body{font-family:Georgia,serif;color:#111;padding:44px;max-width:720px;margin:auto}
        .hdr{display:flex;align-items:center;gap:14px;margin-bottom:6px}
        .hdr img{height:44px;width:auto}
        .brand{color:#50C878;font-size:12px;letter-spacing:2px;text-transform:uppercase}
        h1{font-size:24px;margin:6px 0 2px;border-bottom:3px solid #50C878;padding-bottom:10px}
        .sub{color:#555;font-size:13px;margin-bottom:20px}
        .meta{background:#f5f7fb;border:1px solid #e2e8f5;border-radius:8px;padding:14px 16px;font-size:13px;margin-bottom:22px}
        .meta b{color:#50C878}
        h2{font-size:15px;color:#0a2540;margin:22px 0 8px}
        ul{margin:0;padding-left:20px}li{font-size:13px;line-height:1.7}
        .badge{display:inline-block;background:#50C878;color:#063;border-radius:6px;padding:3px 9px;font-size:11px;font-weight:bold;letter-spacing:1px}
        .ft{margin-top:28px;font-size:11px;color:#888;border-top:1px solid #eee;padding-top:12px}
      </style></head><body>
        <div class="hdr">${logo ? `<img src="${logo}"/>` : ""}<div class="brand">Lattice Network</div></div>
        <h1>${L.title}</h1>
        <div class="sub">${L.sub} &nbsp; <span class="badge">GDPR-READY · POST-QUANTUM E2EE</span></div>
        <div class="meta">
          <div><b>${L.proto}</b> ${protocol}</div>
          <div><b>${L.issued}:</b> ${now}</div>
          <div><b>${L.subject}:</b> ${user?.lns || "—"}</div>
          <div><b>${L.controller}:</b> ${t("settings.controllerName")} · ${PRIVACY_LNS}</div>
        </div>
        <h2>${L.secTitle}</h2><ul>${li(L.sec)}</ul>
        <h2>${L.privTitle}</h2><ul>${li(L.priv)}</ul>
        <div class="ft">${L.footer}</div>
      </body></html>`;
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: t("settings.compliance") });
    } catch (e) { Alert.alert(t("settings.compliance"), api.apiErr(e)); }
    finally { setGenPdf(false); }
  };

  const Row = ({ icon, label, hint, right, onPress, danger, testID }) => (
    <TouchableOpacity style={styles.row} onPress={onPress} disabled={!onPress} activeOpacity={onPress ? 0.6 : 1} testID={testID}>
      <Ionicons name={icon} size={20} color={danger ? theme.danger : tint} style={{ width: 26 }} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, danger && { color: theme.danger }]}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      {right}
    </TouchableOpacity>
  );

  const [memberPerm, setMemberPerm] = useState(null);
  useEffect(() => { api.membersPermissions().then(setMemberPerm).catch(() => setMemberPerm(null)); }, []);

  const [look, setLook] = useState(appearance.get());
  useEffect(() => { appearance.load().then((v) => setLook({ ...v })); }, []);

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingTop: insets.top + 14, paddingBottom: 60 }}>
      <Text style={styles.title}>{t("settings.title")}</Text>

      {/* ASPETTO DELLA CHAT — colore d'accento e sfondo, scelti dall'utente */}
      <Text style={styles.section}>{t("sm.025")}</Text>
      <View style={styles.card}>
        <View style={{ padding: 14 }}>
          <Text style={styles.lookLabel}>{t("sm.026")}</Text>
          <View style={styles.lookRow}>
            {appearance.ACCENTS.map((a) => (
              <TouchableOpacity
                key={a.id}
                onPress={() => appearance.set({ accent: a.id }).then((v) => setLook({ ...v }))}
                style={[styles.swatch, { backgroundColor: a.color }, look.accent === a.id && styles.swatchOn]}
                testID={"look-accent-" + a.id}
              >
                {look.accent === a.id ? <Ionicons name="checkmark-outline" size={16} color="#04070E" /> : null}
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[styles.lookLabel, { marginTop: 18 }]}>{t("sm.027")}</Text>
          <View style={styles.lookRow}>
            {appearance.BACKGROUNDS.map((b) => (
              <TouchableOpacity
                key={b.id}
                onPress={() => appearance.set({ bg: b.id }).then((v) => setLook({ ...v }))}
                style={[styles.swatch, { backgroundColor: b.color, borderColor: "rgba(255,255,255,0.25)", borderWidth: 1 }, look.bg === b.id && styles.swatchOn]}
                testID={"look-bg-" + b.id}
              >
                {look.bg === b.id ? <Ionicons name="checkmark-outline" size={16} color="#fff" /> : null}
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.lookHint}>
            {t("sm.028")}
          </Text>
        </View>
      </View>

      {/* ACCOUNT */}
      <View style={styles.card}>
        <Row icon="notifications-outline" label={t("sm.029")} hint={t("sm.030")} onPress={() => navigation.navigate("Notifications")} right={<Ionicons name="chevron-forward-outline" size={18} color={theme.textFaint} />} testID="settings-notifications" />
      </View>

      <Text style={styles.section}>{t("settings.section.account")}</Text>
      <View style={styles.card}>
        <Row icon="person-circle-outline" label={t("settings.profile")} hint={t("settings.profile.hint")} onPress={() => navigation.navigate("Profilo")}
          right={<Ionicons name="chevron-forward-outline" size={18} color={theme.textFaint} />} testID="settings-profile" />
        <View style={styles.divider} />
        <Row icon="finger-print" label={t("settings.identity")} hint={user?.lns} testID="settings-identity" />
        <View style={styles.divider} />
        <Row icon="server-outline" label={t("settings.server")} hint={base} testID="settings-server" />
      </View>

      {/* CONSOLE ADMIN (solo owner) */}
      {user?.lns === "fabioastorino@latticenetwork.lns" && (
        <>
          <Text style={styles.section}>Console Admin</Text>
          <View style={styles.card}>
            <Row icon="mail-unread-outline" label="Richieste ricevute" hint="Lead e richieste dal sito e dai contatti"
              onPress={() => navigation.navigate("Leads")}
              right={<Ionicons name="chevron-forward-outline" size={18} color={theme.textFaint} />} testID="settings-leads" />
            <Row icon="ribbon-outline" label="Licenze / Scadenze" hint="Aziende attive e licenze in scadenza"
              onPress={() => navigation.navigate("Licenses")}
              right={<Ionicons name="chevron-forward-outline" size={18} color={theme.textFaint} />} testID="settings-licenses" />
          </View>
        </>
      )}

      {/* GESTIONE MEMBRI (admin/owner del tenant) */}
      {memberPerm?.can_manage && (
        <>
          <Text style={styles.section}>{t("sm.113")}</Text>
          <View style={styles.card}>
            <Row icon="people-outline" label={t("sm.114")}
              hint={t("sm.115")}
              onPress={() => navigation.navigate("Members")}
              right={<Ionicons name="chevron-forward-outline" size={18} color={theme.textFaint} />} testID="settings-members" />
          </View>
        </>
      )}

      {/* FLUIDITA - v2.5.0. Non c'e' un interruttore da offrire: la frequenza dello
          schermo la decide il telefono. Qui si LEGGE quella concessa e si scrive senza
          abbellirla: 60 Hz dice 60, e se il sistema sta limitando i 120 Hz lo dice. */}
      <View style={styles.card}>
        <Row icon="speedometer-outline" label={t("sm.116")}
          hint={fpsLine(fps, lang !== "en")}
          right={<Text style={styles.langTxt} testID="settings-fps">{fps.hz ? Math.round(fps.hz) + " fps" : "\u2014"}</Text>}
          testID="settings-smoothness" />
      </View>

      {/* LANGUAGE */}
      <View style={styles.card}>
        <Row icon="language-outline" label={t("profile.language")} hint={t("settings.language.hint")} right={
          <Text style={styles.langTxt} testID="settings-lang-current">
            {(UI_LANGS.find((x) => x.code === lang) || UI_LANGS[0]).flag + "  " + (UI_LANGS.find((x) => x.code === lang) || UI_LANGS[0]).native}
          </Text>
        } />
        <View style={styles.langWrap}>
          {UI_LANGS.map((l) => (
            <TouchableOpacity key={l.code} style={[styles.langBtn, lang === l.code && styles.langBtnActive]} onPress={() => setLang(l.code)} testID={`settings-lang-${l.code}`}>
              <Text style={[styles.langTxt, lang === l.code && { color: "#fff" }]}>{l.flag + "  " + l.code.toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.divider} />
        <Row icon="globe-outline" label={t("sm.117")}
          hint={t("sm.118")}
          right={<Switch value={autoTr} onValueChange={async (v) => { setAutoTr(v); await saveAutoTranslate(v); }} trackColor={{ true: tint, false: theme.border }} thumbColor="#fff" testID="settings-autotranslate" />} />
        <View style={styles.divider} />
        <Row icon="swap-horizontal-outline" label={t("sm.119")}
          hint={trTarget ? langName(trTarget) : (t("sm.120"))}
          onPress={() => { setTrSearch(""); setShowTrLang(true); }}
          right={<Ionicons name="chevron-forward-outline" size={18} color={theme.textFaint} />} testID="settings-translate-lang" />
      </View>

      {/* SECURITY */}
      <Text style={styles.section}>{t("settings.section.security")}</Text>
      <View style={styles.privStatus} testID="settings-privacy-status">
        {[
          { on: chaff, label: t("sm.031"), tid: "privstat-noise" },
          { on: darkMesh, label: "Dark Mesh", tid: "privstat-mesh" },
          { on: !callDirect, label: t("sm.032"), tid: "privstat-relay" },
          ...(sovereign ? [{ on: netHealth ? netHealth.key !== "isolated" : false, tid: "privstat-mesh-health",
            label: (t("sm.033")) + meshNode.healthLabel(netHealth ? netHealth.key : "isolated", en) }] : []),
        ].map((it) => (
          <View key={it.tid} style={styles.privPill} testID={it.tid}>
            <View style={[styles.privDot, { backgroundColor: it.on ? "#50C878" : theme.textFaint }]} />
            <Text style={[styles.privPillTxt, { color: it.on ? theme.text : theme.textFaint }]}>{it.label}</Text>
          </View>
        ))}
      </View>
      <View style={styles.card}>
        <Row icon="lock-closed-outline" label={t("settings.appLock")} hint={secure ? t("settings.appLock.hint") : t("settings.appLock.noHw")}
          right={<Switch value={appLock} onValueChange={toggleLock} trackColor={{ true: tint, false: theme.border }} thumbColor="#fff" testID="settings-applock" />} />
        <View style={styles.divider} />
        <Row icon="radio-outline"
          label={t("sm.034")}
          hint={wakeOn
            ? (t("sm.035"))
            : (t("sm.036"))}
          right={wakeBusy
            ? <ActivityIndicator color={tint} />
            : <Switch value={wakeOn} onValueChange={toggleWake} trackColor={{ true: tint, false: theme.border }} thumbColor="#fff" testID="settings-wake" />} />
        <View style={styles.divider} />
        <Row icon="git-network-outline"
          label={t("sm.037")}
          hint={callDirect
            ? (t("sm.038"))
            : (t("sm.039"))}
          right={<Switch value={callDirect} onValueChange={async (v) => { setCallDirect(v); await saveAllowDirect(v); }} trackColor={{ true: "#50C878", false: theme.border }} thumbColor="#fff" testID="settings-call-direct" />} />
        <View style={styles.divider} />
        <Row icon="pulse-outline"
          label={t("sm.040")}
          hint={chaff
            ? (t("sm.041"))
            : (t("sm.042"))}
          right={<Switch value={chaff} onValueChange={async (v) => { setChaff(v); await cover.setEnabled(v); }} trackColor={{ true: tint, false: theme.border }} thumbColor="#fff" testID="settings-chaff" />} />
        <View style={styles.divider} />
        <Row icon="eye-off-outline"
          label={t("sm.043")}
          hint={darkMesh
            ? (t("sm.044"))
            : (t("sm.045"))}
          right={meshBusy
            ? <ActivityIndicator color={tint} />
            : <Switch value={darkMesh} onValueChange={toggleMesh} trackColor={{ true: tint, false: theme.border }} thumbColor="#fff" testID="settings-darkmesh" />} />
        <View style={styles.divider} />
        <View style={styles.modeBox} testID="mesh-mode">
          <Text style={styles.modeTitle}>{t("sm.046")}</Text>
          <Text style={styles.modeHint}>
            {t("sm.047")}
          </Text>
          <View style={styles.modeRow}>
            <TouchableOpacity
              style={[styles.modeBtn, !sovereign && { borderColor: tint, backgroundColor: tint + "1A" }]}
              onPress={() => chooseSovereign(false)}
              disabled={sovBusy}
              testID="mesh-mode-standard"
            >
              <Ionicons name="cloud-outline" size={17} color={!sovereign ? tint : theme.textDim} />
              <Text style={[styles.modeBtnTxt, !sovereign && { color: tint }]}>{t("sm.048")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, sovereign && { borderColor: tint, backgroundColor: tint + "1A" }]}
              onPress={() => chooseSovereign(true)}
              disabled={sovBusy}
              testID="mesh-mode-sovereign"
            >
              {sovBusy ? <ActivityIndicator color={tint} /> : <Ionicons name="git-network-outline" size={17} color={sovereign ? tint : theme.textDim} />}
              <Text style={[styles.modeBtnTxt, sovereign && { color: tint }]}>{t("sm.049")}</Text>
            </TouchableOpacity>
          </View>
          {sovereign && (
            <View style={styles.testBox} testID="mesh-test">
              <MeshConstellation status={netHealth} t={t} tint={tint} details={
                <Text style={styles.modeMeta} testID="mesh-map-raw">
                  {(t("sm.050")) + ((netHealth && netHealth.neighbours) || 0)
                    + (t("sm.051")) + ((netHealth && netHealth.hybrid) || 0)
                    + (t("sm.052")) + ((netHealth && netHealth.mix) || 0)
                    + (t("sm.053")) + ((netHealth && netHealth.pulses) || 0)}
                </Text>
              } />
              <Text style={styles.testTitle}>{t("sm.054")}</Text>
              <Text style={styles.modeHint}>
                {t("sm.055")}
              </Text>
              <TouchableOpacity style={[styles.testBtn, { borderColor: tint }]} onPress={runProbe} disabled={testBusy} testID="mesh-test-probe">
                {testBusy ? <ActivityIndicator color={tint} /> : <Ionicons name="wifi-outline" size={17} color={tint} />}
                <Text style={[styles.testBtnTxt, { color: tint }]}>{t("sm.056")}</Text>
              </TouchableOpacity>
              {!!probeCode && (
                <Text style={styles.testOut} testID="mesh-test-sent">
                  {(t("sm.057")) + probeCode + (t("sm.058"))}
                </Text>
              )}
              <Text style={styles.testOut} testID="mesh-test-recv">
                {(t("sm.059")) + (netHealth ? netHealth.probes || 0 : 0)
                  + (netHealth && netHealth.probeCode ? (t("sm.060")) + netHealth.probeCode : "")}
              </Text>
              <TouchableOpacity style={[styles.testBtn, { borderColor: tint }]} onPress={runRelay} disabled={testBusy} testID="mesh-test-relay">
                <Ionicons name="git-network-outline" size={17} color={tint} />
                <Text style={[styles.testBtnTxt, { color: tint }]}>{t("sm.061")}</Text>
              </TouchableOpacity>
              {!!relayCode && (
                <Text style={styles.testOut} testID="mesh-test-relay-out">
                  {(() => {
                    const st = netHealth && netHealth.self;
                    if (!st) return t("sm.062");
                    if (st.done) return (t("sm.063")) + Math.round(st.ms / 100) / 10 + "s"
                      + (st.net ? (t("sm.064"))
                                : (t("sm.065")));
                    return (t("sm.066")) + st.hops + "/4 · " + Math.round(st.elapsed / 1000) + "s"
                      + (st.elapsed > 90000 ? (t("sm.067")) : "");
                  })()}
                </Text>
              )}
              <Text style={styles.modeMeta} testID="mesh-health-detail">
              {(t("sm.068")) + meshNode.healthLabel(netHealth ? netHealth.key : "isolated", en)
                + (t("sm.053")) + (netHealth ? netHealth.pulses : 0)
                + (t("sm.069"))}
              </Text>
              <Text style={styles.modeMeta} testID="mesh-diag">
              {(() => {
                const d = netHealth && netHealth.diag;
                if (!d) return t("sm.070");
                let l = (t("sm.071")) + (d.running ? (t("sm.072")) : (t("sm.073")))
                  + (d.ip ? " \u00b7 IP " + d.ip : "")
                  + (t("sm.074")) + d.tx
                  + (t("sm.075")) + d.rx
                  + (t("sm.076")) + d.loops
                  + (d.txErr ? (t("sm.077")) + d.txErr : "");
                l += "\n" + "Wi-Fi Direct: " + radioLabel(d.p2p, t)
                  + (t("sm.078")) + (d.p2pFound || 0)
                  + (t("sm.079")) + (d.p2pPeers || 0)
                  + (d.p2pClients ? (t("sm.080")) + d.p2pClients : "");
                l += "\n" + "Bluetooth: " + radioLabel(d.ble, t)
                  + (t("sm.081")) + (d.bleSeen || 0)
                  + (d.bleAt ? (t("sm.082")) + Math.max(0, Math.round((Date.now() - d.bleAt) / 1000)) + (t("sm.083")) : "");
                if (d.radioErr) l += "\n" + (t("sm.084")) + d.radioErr;
                l += "\n" + decdiag.line(en);
                if (meshQ && (meshQ.badSeal || meshQ.unknown || meshQ.delivered || meshQ.sent)) {
                  l += "\n" + (t("sm.085")) + meshQ.sent
                    + (t("sm.075")) + meshQ.delivered
                    + (t("sm.086")) + meshQ.badSeal
                    + (t("sm.087")) + meshQ.unknown;
                }
                l += "\n" + (t("sm.050")) + (netHealth.neighbours || 0)
                  + (t("sm.052")) + (netHealth.mix || 0)
                  + (t("sm.088")) + (meshQ ? meshQ.known : 0)
                  + (t("sm.089")) + (meshQ ? meshQ.queued : 0);
                if (d.targets) l += "\n" + (t("sm.090")) + d.targets;
                if (d.err) l += "\n" + (t("sm.091")) + d.err;
                if (!d.running) l += "\n" + (t("sm.092"));
                else if (d.loops > 0 && !d.probes) l += "\n" + (t("sm.093"));
                else if (d.running && d.tx > 0 && d.rx === 0) l += "\n" + (t("sm.094"));
                return l;
              })()}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.divider} />
        <Row icon="notifications-outline" label={t("settings.notifications")} hint={t("settings.notifications.hint")}
          right={<Switch value={notif} onValueChange={toggleNotif} trackColor={{ true: tint, false: theme.border }} thumbColor="#fff" testID="settings-notif" />} />
        <View style={styles.divider} />
        <Row
          icon={pushOk ? "checkmark-circle-outline" : "alert-circle-outline"}
          label={t("sm.095")}
          hint={pushOk === null || pushBusy
            ? (t("sm.096"))
            : pushOk
              ? (t("sm.097"))
              : (t("sm.098"))}
          onPress={checkPush}
          right={pushBusy ? <ActivityIndicator size="small" color={tint} /> : <Text style={{ color: pushOk ? theme.accent : theme.danger, fontSize: 12, fontWeight: "800" }}>{pushOk ? (t("sm.099")) : (t("sm.100"))}</Text>}
          testID="settings-push-status"
        />
        <View style={styles.divider} />
        <Row icon="shield-checkmark-outline" label={t("sm.121")}
          hint={t("sm.122")}
          onPress={() => navigation.navigate("Security")}
          right={<Ionicons name="chevron-forward-outline" size={18} color={theme.textFaint} />} testID="settings-security-audit" />
        <View style={styles.divider} />
        <Row icon="sync-circle-outline" label={t("sm.123")}
          hint={t("sm.124")}
          onPress={() => navigation.navigate("HandshakeKeys")}
          right={<Ionicons name="chevron-forward-outline" size={18} color={theme.textFaint} />} testID="settings-handshake-keys" />

        <View style={styles.divider} />
        <Row icon="shield-half-outline" label={t("sm.125")}
          hint={t("sm.126")}
          onPress={() => navigation.navigate("AfterBorder")} danger
          right={<Ionicons name="chevron-forward-outline" size={18} color={theme.danger} />} testID="settings-after-border" />
        <View style={styles.divider} />
        <Row icon="ban-outline" label={t("blk.title")}
          hint={t("blk.hint")}
          onPress={() => navigation.navigate("Blocked")}
          right={<Ionicons name="chevron-forward-outline" size={18} color={theme.textFaint} />} testID="settings-blocked" />
        <View style={styles.divider} />
        <Row icon="keypad-outline" label={t("sm.127")}
          hint={t("sm.128")}
          onPress={() => navigation.navigate("PrivacyLock")}
          right={<Ionicons name="chevron-forward-outline" size={18} color={theme.textFaint} />} testID="settings-privacy-lock" />
        <View style={styles.divider} />
        <Row icon="save-outline" label={t("sm.129")}
          hint={t("sm.130")}
          onPress={() => navigation.navigate("Backup")}
          right={<Ionicons name="chevron-forward-outline" size={18} color={theme.textFaint} />} testID="settings-backup" />
        <View style={styles.divider} />
        <Row icon="document-lock-outline" label={t("sm.131")}
          hint={t("sm.132")}
          onPress={() => Linking.openURL(`${DEFAULT_SERVER.replace(/\/$/, "")}/trasparenza.html`)}
          right={<Ionicons name="open-outline" size={18} color={theme.textFaint} />} testID="settings-transparency" />
        <View style={styles.divider} />
        <Row icon="alert-circle-outline" label={t("sm.133")}
          hint={t("sm.134")}
          onPress={() => Linking.openURL(`${DEFAULT_SERVER.replace(/\/$/, "")}/regole.html`)}
          right={<Ionicons name="open-outline" size={18} color={theme.textFaint} />} testID="settings-rules" />
        {isOss && (<>
        <View style={styles.divider} />
        <View style={{ paddingHorizontal: 18, paddingVertical: 12 }}>
          <Text style={{ color: theme.text, fontSize: 15, fontWeight: "600", marginBottom: 2 }}>🎯 {t("sm.135")}</Text>
          <Text style={{ color: theme.textDim, fontSize: 12, marginBottom: 10 }}>{t("sm.136")}</Text>

          <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 4 }}>
            {reminderTimes.map((tm) => (
              <TouchableOpacity key={`${tm.hour}:${tm.minute}`} onPress={() => removeTime(tm)} testID={`reminder-time-${tm.hour}-${tm.minute}`}
                style={{ flexDirection: "row", alignItems: "center", backgroundColor: tint, borderRadius: 14, paddingVertical: 6, paddingHorizontal: 12, marginRight: 8, marginBottom: 8 }}>
                <Text style={{ color: "#fff", fontSize: 13, fontWeight: "800" }}>{String(tm.hour).padStart(2, "0")}:{String(tm.minute).padStart(2, "0")}</Text>
                <Ionicons name="close-outline" size={14} color="#fff" style={{ marginLeft: 6 }} />
              </TouchableOpacity>
            ))}
            {reminderTimes.length === 0 && <Text style={{ color: theme.textFaint, fontSize: 12, marginBottom: 8 }}>{t("sm.137")}</Text>}
          </View>

          <Text style={{ color: theme.textFaint, fontSize: 11, fontWeight: "700", marginTop: 6, marginBottom: 4 }}>{t("sm.138")}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 8 }}>
            {Array.from({ length: 24 }, (_, h) => h).map((h) => (
              <TouchableOpacity key={h} onPress={() => setPickHour(h)} testID={`reminder-pick-hour-${h}`}
                style={{ borderWidth: 1, borderColor: theme.border, backgroundColor: pickHour === h ? tint : "transparent", borderRadius: 10, paddingVertical: 5, paddingHorizontal: 10, marginRight: 6 }}>
                <Text style={{ color: pickHour === h ? "#fff" : "#cfe0ff", fontSize: 12, fontWeight: "700" }}>{String(h).padStart(2, "0")}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={{ color: theme.textFaint, fontSize: 11, fontWeight: "700", marginTop: 10, marginBottom: 4 }}>{t("sm.139")}</Text>
          <View style={{ flexDirection: "row" }}>
            {[0, 15, 30, 45].map((m) => (
              <TouchableOpacity key={m} onPress={() => setPickMinute(m)} testID={`reminder-pick-min-${m}`}
                style={{ borderWidth: 1, borderColor: theme.border, backgroundColor: pickMinute === m ? tint : "transparent", borderRadius: 10, paddingVertical: 5, paddingHorizontal: 12, marginRight: 8 }}>
                <Text style={{ color: pickMinute === m ? "#fff" : "#cfe0ff", fontSize: 12, fontWeight: "700" }}>:{String(m).padStart(2, "0")}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity onPress={addTime} testID="reminder-add"
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 14, backgroundColor: "rgba(80,200,120,0.16)", borderWidth: 1, borderColor: tint, borderRadius: 12, paddingVertical: 10 }}>
            <Ionicons name="add-circle-outline" size={18} color={tint} />
            <Text style={{ color: "#cfe0ff", fontSize: 13, fontWeight: "800" }}>
              {t("sm.140")} {String(pickHour).padStart(2, "0")}:{String(pickMinute).padStart(2, "0")}
            </Text>
          </TouchableOpacity>
        </View>
        </>)}
      </View>

      {/* THREAT SHIELD */}
      <View style={styles.shieldBox} testID="settings-shield">
        <View style={styles.shieldHead}>
          <Ionicons name="shield-checkmark-outline" size={18} color={tint} />
          <Text style={styles.shieldTitle}>{lang !== "en" ? "Scudo Anti-Minacce" : "Threat Shield"}</Text>
          <View style={styles.shieldBadge}><Text style={styles.shieldBadgeTxt}>{lang !== "en" ? "SEMPRE ATTIVO · GRATIS" : "ALWAYS ON · FREE"}</Text></View>
        </View>
        <View style={styles.counterBox} testID="settings-threat-counter">
          <Text style={styles.counterNum}>{threatCount}</Text>
          <Text style={styles.counterLbl}>{lang !== "en" ? "minacce bloccate dallo Scudo" : "threats blocked by the Shield"}</Text>
        </View>
        <View style={styles.weekChart} testID="settings-threat-week">
          <Text style={styles.weekTitle}>{lang !== "en" ? "Ultimi 7 giorni" : "Last 7 days"}</Text>
          <View style={styles.weekBars}>
            {weekBars.map((d, i) => (
              <View key={i} style={styles.weekCol}>
                <Text style={styles.weekVal}>{d.n > 0 ? d.n : ""}</Text>
                <View style={styles.weekTrack}>
                  <View style={[styles.weekFill, { height: `${Math.round((d.n / weekMax) * 100)}%`, backgroundColor: d.n > 0 ? tint : "transparent" }]} />
                </View>
                <Text style={styles.weekLbl}>{d.label}</Text>
              </View>
            ))}
          </View>
        </View>
        <Text style={styles.shieldDesc}>
          {lang !== "en"
            ? "Protezione 100% sul dispositivo su Pulse e Certify. Nulla viene mai caricato: i tuoi messaggi restano privati."
            : "100% on-device protection across Pulse and Certify. Nothing is uploaded — your messages stay private."}
        </Text>
        {(lang !== "en"
          ? [
              "Phishing e truffe nei messaggi e nelle mail certificate (finti login, premi, frodi IBAN/cripto, richieste OTP).",
              "Link malevoli: imitazione marchi, cloni punycode, host solo-IP, accorciatori, domini a rischio, senza HTTPS.",
              "Allegati: eseguibili, doppie estensioni mascherate, macro Office, false immagini, firma magic-bytes.",
              "Blacklist minacce aggiornata ogni 6 ore (feed gratuito URLhaus); euristiche attive anche offline.",
              "Rilevamento firma di test antivirus EICAR.",
            ]
          : [
              "Phishing & scams in messages and notarised mail (fake logins, prizes, IBAN/crypto fraud, OTP requests).",
              "Malicious links: brand impersonation, punycode clones, IP-only hosts, shorteners, risky domains, non-HTTPS.",
              "Attachments: executables, disguised double extensions, Office macros, fake images, magic-byte signature.",
              "Threat blacklist auto-updated every 6h (free URLhaus feed); heuristics active even offline.",
              "EICAR antivirus test signature detection.",
            ]
        ).map((line, i) => (
          <View key={i} style={styles.shieldItem}>
            <View style={styles.shieldDot} />
            <Text style={styles.shieldItemTxt}>{line}</Text>
          </View>
        ))}
      </View>

      {/* PRIVACY & TRASPARENZA */}
      <View style={styles.shieldBox} testID="settings-privacy">
        <View style={styles.shieldHead}>
          <Ionicons name="eye-off-outline" size={18} color={tint} />
          <Text style={styles.shieldTitle}>{lang !== "en" ? "Privacy & Trasparenza" : "Privacy & Transparency"}</Text>
          <View style={styles.shieldBadge}><Text style={styles.shieldBadgeTxt}>E2EE · POST-QUANTUM</Text></View>
        </View>
        <Text style={styles.shieldDesc}>
          {lang !== "en"
            ? "Esattamente cosa resta privato e cosa il server tratta. Nessuna sorpresa."
            : "Exactly what stays private and what the server processes. No surprises."}
        </Text>

        <Text style={styles.privHead}>{lang !== "en" ? "🔒 Il server NON può MAI vedere:" : "🔒 The server can NEVER see:"}</Text>
        {(lang !== "en"
          ? [
              "Il CONTENUTO di messaggi, allegati, chiamate e stati: cifrato end-to-end (ML-KEM-768 + ML-DSA-65). Nemmeno noi possiamo leggerlo.",
              "CHI chiama CHI e QUANDO: le chiamate usano un rendez-vous anonimo, il server vede solo identificatori casuali temporanei.",
              "L'IP dell'altra persona in chiamata: audio/video passano solo dal relay cifrato, nessuna connessione diretta tra voi.",
              "La CRONOLOGIA PASSATA, anche se ottenesse la tua chiave d'identità: ogni messaggio viaggia in una chiave ML-KEM usa-e-getta, consumata e buttata (forward secrecy).",
              "QUANTO È LUNGO un messaggio: la lunghezza è uniformata a blocchi di 512 byte, un \"ok\" e una foto sono indistinguibili.",
              "QUANDO scrivi o chiami: con il Traffico di Rumore l'app invia finto traffico casuale 24 ore su 24 (anche a schermo spento), così i momenti reali si perdono nel rumore.",
              "CHE stai usando Lattice: con Dark Mesh (XTLS-Reality) il traffico si traveste da normale navigazione su grandi siti (Apple, Cloudflare, Microsoft) e cambia vestito da solo se uno è bloccato.",
              "Il FUTURO: la cifratura è a prova di computer quantistici (ML-KEM-768 + ML-DSA-65), resiste anche agli attacchi \"raccogli ora, decifra domani\".",
              "Il tuo INDIRIZZO IP: il web server non scrive log di accesso e il server delle chiamate non scrive log. Dove serve un contatore anti-abuso, l'IP diventa uno pseudonimo giornaliero non reversibile.",
              "Il tuo PIN e le tue chiavi private: restano solo sul tuo dispositivo, cifrate con una chiave derivata dal PIN.",
            ]
          : [
              "The CONTENT of messages, attachments, calls and status: end-to-end encrypted (ML-KEM-768 + ML-DSA-65). Not even we can read it.",
              "WHO calls WHOM and WHEN: calls use an anonymous rendezvous, the server only sees temporary random identifiers.",
              "The other person's IP during a call: audio/video only flow through the encrypted relay, no direct connection between you.",
              "PAST HISTORY, even with your identity key: every message travels inside a single-use ML-KEM key that is consumed and thrown away (forward secrecy).",
              "HOW LONG a message is: length is padded to 512-byte blocks, an \"ok\" and a photo look identical.",
              "WHEN you write or call: with Invisible Traffic the app sends constant random noise 24/7 (even with the screen off), so real moments hide in the noise.",
              "THAT you are using Lattice: with Dark Mesh (XTLS-Reality) your traffic is disguised as ordinary browsing of big sites (Apple, Cloudflare, Microsoft) and switches disguise by itself if one is blocked.",
              "The FUTURE: encryption is quantum-computer resistant (ML-KEM-768 + ML-DSA-65), safe even against \"harvest now, decrypt later\" attacks.",
              "Your IP ADDRESS: the web server writes no access log and the call server writes no log; where an anti-abuse counter is needed the IP becomes a non-reversible daily pseudonym.",
              "Your PIN and private keys: they never leave your device, encrypted with a key derived from the PIN.",
            ]
        ).map((line, i) => (
          <View key={"p" + i} style={styles.shieldItem}><View style={styles.shieldDot} /><Text style={styles.shieldItemTxt}>{line}</Text></View>
        ))}

        <Text style={styles.privHead}>{lang !== "en" ? "ℹ️ Cosa il server tratta (necessario al servizio):" : "ℹ️ What the server processes (needed to run the service):"}</Text>
        {(lang !== "en"
          ? [
              "Il tuo account (LNS) e l'azienda di appartenenza, per consegnarti i messaggi.",
              "Buste cifrate e metadati minimi di consegna dei messaggi, conservati il minimo indispensabile.",
              "Le buste già ritirate vengono cancellate dopo 7 giorni, quelle mai ritirate dopo 30: passata quella data non esistono più per nessuno.",
              "I dati di signaling delle chiamate scadono automaticamente entro 120 secondi; il registro chiamate lato server viene cancellato entro 24 ore.",
              "Per farti squillare il telefono usiamo una notifica push: il servizio di notifica sa che c'è una chiamata o un messaggio per te, mai il contenuto.",
              "Quali dispositivi hai attivi (telefono, browser) e le loro chiavi pubbliche usa-e-getta, per consegnare una busta a ciascuno.",
            ]
          : [
              "Your account (LNS) and your company, to deliver your messages.",
              "Encrypted envelopes and minimal message-delivery metadata, kept to the strict minimum.",
              "Delivered envelopes are deleted after 7 days, never-delivered ones after 30: past that date they exist for nobody.",
              "Call signaling data auto-expires within 120 seconds; server-side call records are deleted within 24 hours.",
              "To ring your phone we use a push notification: the notification service knows there is a call or message for you, never its content.",
              "Which devices you have active (phone, browser) and their one-time public keys, to deliver one envelope to each.",
            ]
        ).map((line, i) => (
          <View key={"q" + i} style={styles.shieldItem}><View style={[styles.shieldDot, { backgroundColor: theme.textDim }]} /><Text style={styles.shieldItemTxt}>{line}</Text></View>
        ))}

        <Text style={styles.privLegal}>
          {lang !== "en"
            ? "Verifica le chiamate confrontando a voce le emoji di sicurezza mostrate durante la chiamata. Uso lecito: questo servizio è destinato a comunicazioni professionali legittime; la cifratura protegge la tua privacy nel rispetto delle leggi vigenti (incl. GDPR). Sei responsabile di un uso conforme alla legge."
            : "Verify calls by reading aloud the security emojis shown during the call. Lawful use: this service is intended for legitimate professional communications; encryption protects your privacy in compliance with applicable laws (incl. GDPR). You are responsible for lawful use."}
        </Text>
        <TouchableOpacity onPress={() => setShowLegal(true)} style={styles.legalLink} testID="settings-open-legal">
          <Ionicons name="document-text-outline" size={16} color={tint} />
          <Text style={styles.legalLinkTxt}>{lang !== "en" ? "Informativa Privacy & Termini completa (GDPR)" : "Full Privacy Policy & Terms (GDPR)"}</Text>
          <Ionicons name="chevron-forward-outline" size={16} color={theme.textDim} />
        </TouchableOpacity>
      </View>


      {/* THREAT LOG */}
      <View style={styles.shieldBox} testID="settings-threat-log">
        <View style={styles.threatLogHead}>
          <View style={styles.shieldHead2}>
            <Ionicons name="alert-circle-outline" size={16} color={tint} />
            <Text style={styles.shieldTitle}>{t("sm.141")}</Text>
          </View>
          {threatLog.length > 0 && (
            <TouchableOpacity onPress={emptyThreatLog} testID="threat-log-clear"><Text style={styles.threatClear}>{t("sm.142")}</Text></TouchableOpacity>
          )}
        </View>
        {threatLog.length === 0 ? (
          <Text style={styles.threatEmpty}>{t("sm.143")}</Text>
        ) : (
          threatLog.slice(0, 15).map((e, i) => (
            <View key={i} style={styles.threatItem}>
              <View style={[styles.threatDot, { backgroundColor: e.level === "danger" ? "#FF4D5E" : "#50C878" }]} />
              <View style={{ flex: 1 }}>
                <View style={styles.threatRow}>
                  <Text style={styles.threatCtx}>{e.context}</Text>
                  <Text style={styles.threatTime}>{fmtAgo(e.at, lang)}</Text>
                </View>
                <Text style={styles.threatReason} numberOfLines={2}>{e.reasons && e.reasons[0]}</Text>
              </View>
            </View>
          ))
        )}
      </View>

      {/* GDPR */}
      <Text style={styles.section}>{t("settings.section.gdpr")}</Text>
      <View style={styles.card}>
        <Row icon="download-outline" label={t("settings.export")} hint={t("settings.export.hint")} onPress={exporting ? null : doExport}
          right={exporting ? <ActivityIndicator size="small" color={tint} /> : <Ionicons name="chevron-forward-outline" size={18} color={theme.textFaint} />} testID="settings-export" />
        <View style={styles.divider} />
        <Row icon="trash-outline" label={t("settings.delete")} hint={t("settings.delete.hint")} onPress={deleting ? null : doDelete} danger
          right={deleting ? <ActivityIndicator size="small" color={theme.danger} /> : <Ionicons name="chevron-forward-outline" size={18} color={theme.danger} />} testID="settings-delete" />
      </View>
      <View style={styles.infoBox}>
        <Ionicons name="lock-closed-outline" size={16} color={theme.accent} />
        <View style={{ flex: 1 }}>
          <Text style={styles.infoTitle}>{t("settings.dataInfoTitle")}</Text>
          <Text style={styles.infoText}>{t("settings.dataInfo")}</Text>
        </View>
      </View>

      <View style={styles.infoBox}>
        <Ionicons name="cloud-download-outline" size={16} color={tint} />
        <View style={{ flex: 1 }}>
          <Text style={styles.infoTitle}>{t("sm.101")}</Text>
          <Text style={styles.infoText} testID="settings-update-info">
            {upMsg || (t("sm.102"))}
          </Text>
          <TouchableOpacity style={styles.updBtn} onPress={doCheckUpdate} disabled={upBusy} testID="settings-check-update">
            {upBusy ? <ActivityIndicator color={tint} /> : (
              <Text style={styles.updBtnTxt}>{t("sm.103")}</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.infoBox}>
        <Ionicons name="people-outline" size={16} color={theme.accent} />
        <View style={{ flex: 1 }}>
          <Text style={styles.infoTitle} testID="settings-contacts-info-title">{t("sm.104")}</Text>
          <Text style={styles.infoText} testID="settings-contacts-info">
            {t("sm.105")}
          </Text>
        </View>
      </View>

      {/* LEGAL */}
      <Text style={styles.section}>{t("settings.section.legal")}</Text>
      <View style={styles.card}>
        {LEGAL_DOCS.map((d, i) => (
          <View key={d.path}>
            {i > 0 && <View style={styles.divider} />}
            <Row icon={d.icon} label={t(d.key)} onPress={() => openLegal(d)} right={<Ionicons name="open-outline" size={17} color={theme.textFaint} />} testID={`settings-legal-${d.path}`} />
          </View>
        ))}
      </View>
      <View style={styles.card}>
        <Row icon="business-outline" label={t("settings.controller")} hint={t("settings.controllerName")} testID="settings-controller" />
        <View style={styles.divider} />
        <Row icon="chatbubble-ellipses-outline" label={t("settings.contact")} hint={PRIVACY_LNS} onPress={() => navigation.navigate("Chat", { conv_id: null, others: [PRIVACY_LNS], title: "Contatto privacy", title_lns: PRIVACY_LNS })}
          right={<Ionicons name="chevron-forward-outline" size={18} color={theme.textFaint} />} testID="settings-contact" />
      </View>

      {/* ABOUT */}
      <Text style={styles.section}>{t("settings.section.about")}</Text>
      <View style={styles.card}>
        <Row icon="shield-outline" label={t("settings.encryption")} hint={t("settings.encryptionVal")} testID="settings-encryption" />
        <View style={styles.divider} />
        <Row icon="information-circle-outline" label={t("settings.version")} hint={`${Constants.expoConfig?.version || "1.0.0"} · Versione Zero (${Constants.expoConfig?.android?.versionCode || "1"})`} testID="settings-version" />
        <View style={styles.divider} />
        {isOwner && (
          <>
            <Row icon="flag-outline" label={t("sm.106")}
              hint={t("sm.107")}
              onPress={() => navigation.navigate("Reports")}
              right={<Ionicons name="chevron-forward-outline" size={18} color={theme.textFaint} />} testID="settings-reports" />
            <View style={styles.divider} />
          </>
        )}
        <Row icon="id-card-outline" label={t("sm.108")}
          hint={t("sm.109")}
          onPress={shareCard}
          right={<Ionicons name="share-social-outline" size={18} color={tint} />} testID="settings-card" />
        <View style={styles.divider} />
        <Row icon="person-add-outline" label={t("sm.110")}
          hint={t("sm.111")}
          onPress={inviteFriend}
          right={<Ionicons name="share-social-outline" size={18} color={tint} />} testID="settings-invite" />
        <View style={styles.divider} />
        <View style={styles.divider} />
        <Row icon="ribbon-outline" label={t("settings.compliance")} hint={t("settings.compliance.hint")} onPress={genPdf ? null : doCompliance}
          right={genPdf ? <ActivityIndicator size="small" color={tint} /> : <Ionicons name="download-outline" size={18} color={theme.textFaint} />} testID="settings-compliance" />
      </View>

      <TouchableOpacity onPress={signOut} style={styles.signout} testID="settings-signout">
        <Ionicons name="log-out-outline" size={18} color={theme.danger} />
        <Text style={styles.signoutText}>{t("signout")}</Text>
      </TouchableOpacity>

      <Modal visible={showDelete} transparent animationType="fade" onRequestClose={() => setShowDelete(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalIcon}><Ionicons name="warning-outline" size={26} color={theme.danger} /></View>
            <Text style={styles.modalTitle}>{t("settings.delete.title")}</Text>
            <Text style={styles.modalText}>{t("settings.delete.confirm")}</Text>
            <Text style={styles.modalHint}>{t("delete.typeToConfirm", { word: t("delete.word") })}</Text>
            <TextInput
              style={styles.modalInput}
              value={delText}
              onChangeText={setDelText}
              placeholder={t("delete.placeholder")}
              placeholderTextColor={theme.textFaint}
              autoCapitalize="characters"
              autoCorrect={false}
              testID="settings-delete-input"
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setShowDelete(false)} disabled={deleting} testID="settings-delete-cancel">
                <Text style={styles.modalCancelTxt}>{t("cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalDelete, (delText.trim().toUpperCase() !== t("delete.word") || deleting) && styles.modalDeleteDisabled]}
                disabled={delText.trim().toUpperCase() !== t("delete.word") || deleting}
                onPress={confirmDelete}
                testID="settings-delete-confirm"
              >
                {deleting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.modalDeleteTxt}>{t("delete.confirmBtn")}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showLegal} transparent animationType="slide" onRequestClose={() => setShowLegal(false)}>
        <View style={styles.legalWrap}>
          <View style={styles.legalCard}>
            <View style={styles.legalHead}>
              <Text style={styles.legalTitle}>{lang !== "en" ? "Informativa Privacy & Termini" : "Privacy Policy & Terms"}</Text>
              <TouchableOpacity onPress={() => setShowLegal(false)} testID="settings-legal-close"><Ionicons name="close-outline" size={24} color={theme.text} /></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: "82%" }} contentContainerStyle={{ paddingBottom: 24 }}>
              <Text style={styles.legalBody}>{lang !== "en" ? LEGAL_IT : LEGAL_EN}</Text>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showTrLang} transparent animationType="slide" onRequestClose={() => setShowTrLang(false)}>
        <View style={styles.legalWrap}>
          <View style={styles.legalCard}>
            <View style={styles.legalHead}>
              <Text style={styles.legalTitle}>{t("sm.119")}</Text>
              <TouchableOpacity onPress={() => setShowTrLang(false)} testID="settings-trlang-close"><Ionicons name="close-outline" size={24} color={theme.text} /></TouchableOpacity>
            </View>
            <TextInput
              style={styles.trSearch}
              value={trSearch}
              onChangeText={setTrSearch}
              placeholder={t("sm.144")}
              placeholderTextColor={theme.textFaint}
              autoCorrect={false}
              testID="settings-trlang-search"
            />
            <ScrollView style={{ maxHeight: "72%" }} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
              {!trSearch.trim() && (
                <TouchableOpacity style={styles.trItem} onPress={async () => { setTrTarget(null); await saveTranslateTarget(""); setShowTrLang(false); }} testID="settings-trlang-auto">
                  <Text style={[styles.trItemTxt, !trTarget && { color: tint, fontWeight: "800" }]}>{t("sm.120")}</Text>
                  {!trTarget && <Ionicons name="checkmark-outline" size={18} color={tint} />}
                </TouchableOpacity>
              )}
              {TRANSLATE_LANGS.filter((l) => { const q = trSearch.trim().toLowerCase(); return !q || l.name.toLowerCase().includes(q) || l.code.toLowerCase().includes(q); }).map((l) => (
                <TouchableOpacity key={l.code} style={styles.trItem} onPress={async () => { setTrTarget(l.code); await saveTranslateTarget(l.code); setShowTrLang(false); }} testID={`settings-trlang-${l.code}`}>
                  <Text style={[styles.trItemTxt, trTarget === l.code && { color: tint, fontWeight: "800" }]}>{l.name}</Text>
                  {trTarget === l.code && <Ionicons name="checkmark-outline" size={18} color={tint} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

    </ScrollView>
  );
}

const makeStyles = (tint) => StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  title: { color: theme.text, fontSize: 26, fontWeight: "800", paddingHorizontal: 18, marginBottom: 6 },
  section: { color: theme.textFaint, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginTop: 22, marginBottom: 8, paddingHorizontal: 18 },
  privStatus: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 18, marginBottom: 10 },
  privPill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  privDot: { width: 9, height: 9, borderRadius: 5 },
  privPillTxt: { fontSize: 12, fontWeight: "600" },
  modeBox: { paddingHorizontal: 16, paddingVertical: 14 },
  modeTitle: { color: theme.text, fontSize: 15, fontWeight: "700" },
  modeHint: { color: theme.textDim, fontSize: 12, lineHeight: 17, marginTop: 4 },
  modeRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  modeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingVertical: 11 },
  modeBtnTxt: { color: theme.textDim, fontSize: 13, fontWeight: "700" },
  modeMeta: { color: theme.textFaint, fontSize: 11, lineHeight: 16, marginTop: 10 },
  testBox: { marginTop: 14, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 14 },
  testTitle: { color: theme.text, fontSize: 14, fontWeight: "700", marginBottom: 2 },
  testBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingVertical: 11, marginTop: 10 },
  testBtnTxt: { fontSize: 13, fontWeight: "700" },
  testOut: { color: theme.textDim, fontSize: 11, lineHeight: 16, marginTop: 8 },
  card: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 14, marginHorizontal: 14, marginBottom: 10, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 14 },
  rowLabel: { color: theme.text, fontSize: 15, fontWeight: "600" },
  lookLabel: { color: theme.textDim, fontSize: 11, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },
  lookRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 12 },
  swatch: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  swatchOn: { borderWidth: 2, borderColor: "#fff" },
  lookHint: { color: theme.textFaint, fontSize: 12, lineHeight: 18, marginTop: 16 },
  rowHint: { color: theme.textDim, fontSize: 12, marginTop: 2 },
  divider: { height: 1, backgroundColor: theme.border, marginLeft: 52 },
  langWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 14, paddingBottom: 12 },
  langBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: theme.border },
  langBtnActive: { backgroundColor: tint, borderColor: tint },
  langTxt: { color: theme.textDim, fontSize: 12, fontWeight: "700" },
  infoBox: { flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: "rgba(80,200,120,0.07)", borderWidth: 1, borderColor: "rgba(80,200,120,0.25)", borderRadius: 12, padding: 14, marginHorizontal: 14 },
  infoTitle: { color: theme.accent, fontSize: 13, fontWeight: "700", marginBottom: 4 },
  infoText: { color: theme.textDim, fontSize: 12, lineHeight: 18 },
  updBtn: { alignSelf: "flex-start", marginTop: 10, borderWidth: 1, borderColor: tint, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  updBtnTxt: { color: tint, fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  shieldBox: { backgroundColor: "rgba(80,200,120,0.06)", borderWidth: 1, borderColor: "rgba(80,200,120,0.28)", borderRadius: 14, padding: 14, marginHorizontal: 14, marginBottom: 10 },
  legalLink: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.border },
  legalLinkTxt: { color: tint, fontSize: 13, fontWeight: "700", flex: 1 },
  legalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  legalCard: { backgroundColor: theme.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, maxHeight: "90%" },
  legalHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  legalTitle: { color: theme.text, fontSize: 18, fontWeight: "800" },
  legalBody: { color: theme.text, fontSize: 12.5, lineHeight: 19 },
  trSearch: { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.border, borderRadius: 10, color: theme.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginBottom: 8 },
  trItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: theme.border },
  trItemTxt: { color: theme.text, fontSize: 15, flex: 1 },
  counterBox: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 12, marginBottom: 4, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: "rgba(80,200,120,0.10)", borderRadius: 10, borderWidth: 1, borderColor: "rgba(80,200,120,0.25)" },
  counterNum: { color: tint, fontSize: 26, fontWeight: "900" },
  counterLbl: { color: theme.textDim, fontSize: 12, fontWeight: "600", flex: 1 },
  weekChart: { marginBottom: 6, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: "rgba(80,200,120,0.06)", borderRadius: 10, borderWidth: 1, borderColor: "rgba(80,200,120,0.18)" },
  weekTitle: { color: theme.textFaint, fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 },
  weekBars: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", height: 72 },
  weekCol: { flex: 1, alignItems: "center", gap: 3 },
  weekVal: { color: tint, fontSize: 10, fontWeight: "800", height: 12 },
  weekTrack: { width: 14, height: 40, backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 4, justifyContent: "flex-end", overflow: "hidden" },
  weekFill: { width: "100%", borderRadius: 4, minHeight: 2 },
  weekLbl: { color: theme.textFaint, fontSize: 9, fontWeight: "600", textTransform: "capitalize" },
  shieldHead: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  shieldTitle: { color: theme.text, fontSize: 15, fontWeight: "800" },
  shieldBadge: { backgroundColor: "rgba(80,200,120,0.14)", borderWidth: 1, borderColor: "rgba(80,200,120,0.35)", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  shieldBadgeTxt: { color: theme.accent, fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  shieldDesc: { color: theme.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 8, marginBottom: 8 },
  shieldItem: { flexDirection: "row", gap: 8, alignItems: "flex-start", marginTop: 6 },
  shieldDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: tint, marginTop: 6 },
  shieldItemTxt: { color: theme.text, fontSize: 12.5, lineHeight: 18, flex: 1 },
  privHead: { color: theme.text, fontSize: 13.5, fontWeight: "800", marginTop: 14, marginBottom: 8 },
  privLegal: { color: theme.textFaint, fontSize: 11.5, lineHeight: 17, marginTop: 14, fontStyle: "italic", borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 12 },
  threatLogHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  shieldHead2: { flexDirection: "row", alignItems: "center", gap: 8 },
  threatClear: { color: tint, fontSize: 12, fontWeight: "700" },
  threatEmpty: { color: theme.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 8 },
  threatItem: { flexDirection: "row", gap: 10, alignItems: "flex-start", marginTop: 10 },
  threatDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  threatRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  threatCtx: { color: theme.text, fontSize: 12.5, fontWeight: "800" },
  threatTime: { color: theme.textDim, fontSize: 10.5 },
  threatReason: { color: theme.textDim, fontSize: 12, lineHeight: 16, marginTop: 1 },
  signout: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 26, paddingVertical: 12 },
  signoutText: { color: theme.danger, fontSize: 14, fontWeight: "700" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard: { width: "100%", backgroundColor: theme.surfaceAlt, borderRadius: 18, borderWidth: 1, borderColor: theme.border, padding: 22 },
  modalIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(242,244,243,0.12)", alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 14 },
  modalTitle: { color: theme.text, fontSize: 19, fontWeight: "800", textAlign: "center" },
  modalText: { color: theme.textDim, fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 10 },
  modalHint: { color: theme.textFaint, fontSize: 12, textAlign: "center", marginTop: 14 },
  modalInput: { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: theme.text, fontSize: 16, fontWeight: "700", letterSpacing: 2, textAlign: "center", marginTop: 8 },
  modalBtns: { flexDirection: "row", gap: 12, marginTop: 18 },
  modalCancel: { flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  modalCancelTxt: { color: theme.textDim, fontWeight: "700" },
  modalDelete: { flex: 1, backgroundColor: theme.danger, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  modalDeleteDisabled: { opacity: 0.4 },
  modalDeleteTxt: { color: "#fff", fontWeight: "800" },
});

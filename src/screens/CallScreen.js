import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Vibration, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { RTCPeerConnection, RTCIceCandidate, RTCSessionDescription, mediaDevices } from "react-native-webrtc";
import { useAudioPlayer } from "expo-audio";
import { setAudioModeAsync } from "expo-audio";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../lib/i18n";
import * as api from "../lib/api";
import { signMessage, verifyMessage, bytesToHex, anonSharedSecret, encryptForRecipients, decryptEnvelope, computeSAS } from "../lib/crypto";
import { newChan, discRid, anonEpoch, anonEpochs, sealInvite, openInvite } from "../lib/anonCall";
import { addCallLog } from "../lib/store";
import { suppressLock } from "../lib/lockGuard";
import { ensureCallPermissions } from "../lib/callPerms";
import { saveVerifiedSas, loadVerifiedSas } from "../lib/store";
import { loadRingtone, loadRingVolume, loadVibMode } from "../lib/store";
const VIB_PATTERNS = { standard: [0, 700, 900, 700], short: [0, 400, 300, 400], long: [0, 1200, 600, 1200] };
const RINGTONES = { classic: require("../../assets/ringtone.wav"), chime: require("../../assets/ring_chime.wav"), beep: require("../../assets/ring_beep.wav"), digital: require("../../assets/ring_digital.wav"), marimba: require("../../assets/ring_marimba.wav"), pulse: require("../../assets/ring_pulse.wav") };
import { iceConfig } from "../config";
import { loadAllowDirect } from "../lib/store";
import { useTint } from "../lib/appearance";
import { theme } from "../theme";
import { MEDIA_CONSTRAINTS, tuneSdp } from "../lib/audioTune";
import * as telecom from "../lib/telecom";

// Chiamata WebRTC 1:1 con SIGNALING ANONIMO (blind rendezvous): il server non sa chi chiama chi.
// Offer/answer cifrati E2E (ML-KEM), media solo via TURN self-hosted (relay-only → nessun IP tra peer).
export default function CallScreen({ route, navigation }) {
  const tint = useTint();
  const styles = useMemo(() => makeStyles(tint), [tint]);
  const { user } = useAuth();
  const { lang } = useI18n();
  const incoming = !!route.params?.incoming;
  // I dati che arrivano dalla push FCM sono STRINGHE ("true"/"false"): senza questa
  // normalizzazione ogni chiamata audio veniva aperta come videochiamata.
  // v2.5.0 — SOLO VOCE. Le videochiamate sono state rimosse su richiesta: una voce
  // impeccabile su qualunque rete vale piu di un video mediocre, e la fotocamera era
  // l'unica parte dell'app che chiedeva un permesso capace di identificare una stanza.
  // Un vecchio client che offre ancora un flusso video viene accolto in sola voce:
  // rispondiamo `offerToReceiveVideo: false` e la sua traccia video non viene mai chiesta.
  const videoParam = false;
  const to = (route.params?.to || "").toLowerCase();
  const peerName = (route.params?.to_name || route.params?.from || route.params?.to || "").split("@")[0];

  const [status, setStatus] = useState(incoming ? "answering" : "calling");
  const [video, setVideo] = useState(false);
  const [held, setHeld] = useState(false);
  const [warn, setWarn] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [accepted, setAccepted] = useState(!incoming);
  const [verified, setVerified] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [remoteRev, setRemoteRev] = useState(0);
  const [pushInv, setPushInv] = useState(null);
  const [muted, setMuted] = useState(false);
  const [sas, setSas] = useState(null);
  const [sasVerified, setSasVerified] = useState(false);
  const peerLns = (to || route.params?.from || "").toLowerCase();

  const pc = useRef(null);
  const poll = useRef(null);
  const remoteSet = useRef(false);
  const ended = useRef(false);
  const pushResolved = useRef(false);
  const fromPush = !!route.params?.fromPush;
  // Signaling anonimo
  const chan = useRef(route.params?.chan || null);
  const localIce = useRef(incoming ? "ice_e" : "ice_c");
  const remoteIce = useRef(incoming ? "ice_c" : "ice_e");
  const iceCFrom = useRef(0);
  const iceEFrom = useRef(0);
  const peerKem = useRef(route.params?.from_kem || null); // KEM pk dell'altro (per cifrare l'answer)

  const myLns = user?.lns || "";
  const myPk = user?.pk || (user?.kem ? bytesToHex(user.kem.publicKey) : "");
  const myKem = user?.kem ? bytesToHex(user.kem.publicKey) : "";

  const logMissedIn = useCallback(() => {
    try { addCallLog({ call_id: chan.current || route.params?.call_id || ("m-" + Date.now()), peer: route.params?.from || peerLns || "", direction: "in", video: !!video, created_at: new Date().toISOString(), answered_at: "", ended_at: new Date().toISOString(), missed: true }); } catch {}
  }, [video, peerLns]);
  const [rtSrc, setRtSrc] = useState(RINGTONES.classic);
  const [systemRing, setSystemRing] = useState(false);
  useEffect(() => { loadRingtone().then((k) => { setRtSrc(RINGTONES[k] || RINGTONES.classic); setSystemRing(k === "system"); }).catch(() => {}); }, []);
  const ring = useAudioPlayer(rtSrc);
  const [ringVol, setRingVol] = useState(1);
  useEffect(() => { loadRingVolume().then((v) => setRingVol(v)).catch(() => {}); }, []);
  useEffect(() => { try { ring.volume = ringVol; } catch (e) {} }, [ringVol, ring]);
  const [vibMode, setVibMode] = useState("standard");
  useEffect(() => { loadVibMode().then((m) => setVibMode(m)).catch(() => {}); }, []);
  useEffect(() => {
    if (!incoming || accepted || ended.current) return;
    let alive = true;
    (async () => {
      try { await setAudioModeAsync({ playsInSilentMode: true }); } catch {}
      try { if (!systemRing) { ring.loop = true; ring.seekTo(0); ring.play(); } } catch {}
    })();
    try { if (vibMode !== "off") Vibration.vibrate(VIB_PATTERNS[vibMode] || VIB_PATTERNS.standard, true); } catch {}
    const t = setTimeout(() => { if (alive) { logMissedIn(); dismiss(); } }, 30000);
    return () => { alive = false; try { ring.pause(); } catch {} try { Vibration.cancel(); } catch {} clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming, accepted, systemRing]);

  const stopRing = useCallback(() => { try { ring.pause(); } catch {} try { Vibration.cancel(); } catch {} }, [ring]);

  // Tono di libero per CHI CHIAMA: prima non si sentiva nulla mentre squillava.
  const ringback = useAudioPlayer(RINGTONES.pulse);
  useEffect(() => {
    if (incoming || status !== "calling" || ended.current) return;
    let alive = true;
    (async () => {
      try { await setAudioModeAsync({ playsInSilentMode: true }); } catch {}
      if (!alive) return;
      try { ringback.volume = 0.5; ringback.loop = true; ringback.seekTo(0); ringback.play(); } catch {}
    })();
    return () => { alive = false; try { ringback.pause(); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming, status]);

  const cleanup = useCallback(() => {
    ended.current = true;
    if (poll.current) { clearInterval(poll.current); poll.current = null; }
    try { pc.current && pc.current.close(); } catch {}
    try { localStream && localStream.getTracks().forEach((t) => t.stop()); } catch {}
  }, [localStream]);

  const bye = useCallback(async () => { if (chan.current) { try { await api.anonPut(chan.current, "bye", { t: Date.now() }); } catch {} } }, []);

  const accept = useCallback(() => { suppressLock(); stopRing(); setAccepted(true); }, [stopRing]);
  const dismiss = useCallback(async () => { stopRing(); await bye(); cleanup(); navigation.goBack(); }, [stopRing, bye, cleanup, navigation]);
  const reject = useCallback(async () => { stopRing(); try { if (chan.current) await api.callReject(chan.current); } catch {} await bye(); cleanup(); navigation.goBack(); }, [stopRing, bye, cleanup, navigation]);
  const hangup = useCallback(async () => {
    try { if (chan.current) await api.callEnded(chan.current); } catch {}
    await bye(); cleanup(); navigation.goBack();
  }, [bye, cleanup, navigation]);

  // Aperta dal PUSH: recupera l'offerta E2EE reale dal rendezvous anonimo (il push non la trasporta).
  useEffect(() => {
    if (!incoming || !fromPush || route.params?.offer || pushResolved.current) return;
    pushResolved.current = true;
    (async () => {
      try {
        const from = (route.params?.from || "").toLowerCase();
        if (!from || !user?.dh || !user?.kem) return;
        const dhMap = await api.pulseDhKeys([from]);
        const dh = dhMap && dhMap[from];
        if (!dh) return;
        const shared = anonSharedSecret(user.dh.secretKey, dh);
        let inv = null;
        for (const ep of anonEpochs()) {
          const rid = discRid(shared, from, myLns, ep);
          let g; try { g = await api.anonGet(rid, 0, 0); } catch { g = null; }
          if (g && g.found && g.ping) { try { inv = openInvite(g.ping, user.kem.secretKey); } catch {} if (inv && inv.offer) break; }
        }
        if (inv && inv.chan && inv.offer) { chan.current = inv.chan; peerKem.current = inv.from_kem; setPushInv(inv); }
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming, fromPush]);

  // Auto-risposta quando aperta dal pulsante "Rispondi" della notifica.
  const autoAnswered = useRef(false);
  useEffect(() => {
    if (autoAnswered.current || !route.params?.autoAnswer || accepted || ended.current) return;
    if (route.params?.offer || pushInv) { autoAnswered.current = true; accept(); }
  }, [pushInv, accepted, accept]);

  // Rifiuto dalla notifica: avvisa il chiamante (bye) appena il canale rendezvous e' pronto, poi esce.
  const declined = useRef(false);
  useEffect(() => {
    if (declined.current || !route.params?.decline || ended.current) return;
    if (route.params?.chan || route.params?.offer || pushInv) { declined.current = true; reject(); }
  }, [pushInv, reject]);

  const allowDirect = useRef(false);
  useEffect(() => { loadAllowDirect().then((v) => { allowDirect.current = !!v; }).catch(() => {}); }, []);

  const makePc = useCallback(() => {
    // relay-only: media SOLO via TURN self-hosted → nessun peer conosce l'IP dell'altro.
    // "relay": TUTTO il media passa dal TURN coturn. È la sola configurazione che dà un
    // percorso audio SIMMETRICO su qualsiasi rete (con "all" si otteneva audio in un solo
    // verso su reti dietro NAT) e non espone l'IP. Non toccare senza test su rete reale.
    const p = new RTCPeerConnection(iceConfig(allowDirect.current));
    p.addEventListener("icecandidate", (e) => {
      if (e.candidate && chan.current) {
        const c = e.candidate.toJSON ? e.candidate.toJSON() : e.candidate;
        api.anonPut(chan.current, localIce.current, c).catch(() => {});
      }
    });
    p.addEventListener("track", (e) => {
      const st = (e.streams && e.streams[0]) || null;
      try { if (e.track) e.track.enabled = true; } catch {}
      if (st) { setRemoteStream(st); setRemoteRev((n) => n + 1); }
    });
    return p;
  }, []);

  const applyRemoteIce = useCallback((list) => {
    if (!Array.isArray(list) || !pc.current) return;
    for (const cand of list) { try { pc.current.addIceCandidate(new RTCIceCandidate(cand)); } catch {} }
  }, []);

  // Calcola il SAS (emoji di verifica) dai fingerprint DTLS di entrambi i peer, appena disponibili.
  const trySas = useCallback(() => {
    try {
      const l = pc.current?.localDescription?.sdp, r = pc.current?.remoteDescription?.sdp;
      const s = computeSAS(l, r);
      if (s) { setSas(s); if (peerLns) loadVerifiedSas(peerLns).then((v) => { if (v && v === s) setSasVerified(true); }).catch(() => {}); }
    } catch {}
  }, [peerLns]);

  const markVerified = useCallback(() => {
    if (sas && peerLns) { saveVerifiedSas(peerLns, sas); setSasVerified(true); }
  }, [sas, peerLns]);

  useEffect(() => {
    if (!accepted) return;
    let mounted = true;
    (async () => {
      try {
        suppressLock();
        // Se l'offer del chiamante contiene un flusso video, la chiamata è una
        // videochiamata anche se il flag della push dice il contrario.
        const wantsVideo = false;
        const okPerm = await ensureCallPermissions(false);
        if (!okPerm) { if (mounted) { setErrMsg(lang === "en" ? "Microphone/camera permission denied" : "Permesso microfono/fotocamera negato"); setStatus("error"); setTimeout(() => hangup(), 6000); } return; }
        // La chiamata viene DICHIARATA al sistema prima di aprire il microfono: da qui in
        // poi, per Android, e' una telefonata vera e non gliela si puo togliere di mano.
        try { await telecom.declare(incoming ? "in" : "out", peerName || "lattice"); } catch { /* si prosegue senza telecom */ }
        let stream;
        try {
          stream = await mediaDevices.getUserMedia(MEDIA_CONSTRAINTS);
        } catch (e) {
          // Secondo tentativo senza vincoli: alcuni telefoni rifiutano `sampleRate`.
          stream = await mediaDevices.getUserMedia({ audio: true, video: false });
        }
        if (!mounted) { stream.getTracks().forEach((t) => t.stop()); return; }
        setLocalStream(stream);
        pc.current = makePc();
        stream.getTracks().forEach((t) => pc.current.addTrack(t, stream));

        if (!incoming) {
          // CHIAMANTE: chiavi del ricevente (KEM per cifrare, DH per il rid), offer firmata, invito cifrato.
          const [kemMap, dhMap] = await Promise.all([api.pulseKeys([to]), api.pulseDhKeys([to])]);
          const calleeKem = kemMap && kemMap[to];
          const calleeDh = dhMap && dhMap[to];
          if (!calleeKem || !calleeDh) throw new Error("no-keys");
          chan.current = newChan();
          const offer0 = await pc.current.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
          // Il ritocco si applica PRIMA di firmare e PRIMA di setLocalDescription:
          // l'SDP che firmiamo deve essere byte per byte quello che l'altro riceve,
          // altrimenti la verifica della firma fallisce.
          const offer = { type: offer0.type, sdp: tuneSdp(offer0.sdp) };
          await pc.current.setLocalDescription(new RTCSessionDescription(offer));
          const sig = user?.sk ? signMessage(offer.sdp, user.sk) : "";
          const invite = { from: myLns, from_pk: myPk, from_kem: myKem, video: false, chan: chan.current, offer: { type: offer.type, sdp: offer.sdp }, offer_sig: sig };
          const ping = sealInvite(invite, calleeKem);
          const shared = anonSharedSecret(user.dh.secretKey, calleeDh);
          await api.anonPut(discRid(shared, myLns, to, anonEpoch()), "ping", ping);
          // Squillo via notifica: se il destinatario non ha dispositivi registrati non
          // può squillare ad app chiusa, e lo diciamo subito a chi chiama.
          api.callRing({ to, video: false, call_id: chan.current }).then((r) => {
            if (mounted && r && r.devices === 0) {
              setWarn(lang === "en"
                ? "The recipient has no registered device: they will only ring with the app open."
                : "Il destinatario non ha dispositivi registrati: squillerà solo con l'app aperta.");
            }
          }).catch(() => {});
          addCallLog({ call_id: chan.current, peer: to, direction: "out", video: !!video, created_at: new Date().toISOString(), answered_at: "", ended_at: "" });
          setStatus("calling");
          setTimeout(() => { if (!ended.current && !remoteSet.current) { try { hangup(); } catch {} } }, 35000);
        } else {
          // RICEVENTE: applica l'offer ricevuto (verifica firma), crea l'answer cifrato verso il chiamante.
          const off = route.params?.offer || pushInv?.offer;
          if (off && off.sdp) {
            remoteSet.current = true;
            const _sig = route.params?.offer_sig || pushInv?.offer_sig; const _fpk = route.params?.from_pk || pushInv?.from_pk;
            const ok = _sig && _fpk ? verifyMessage(off.sdp, _sig, _fpk) : false;
            setVerified(ok);
            await pc.current.setRemoteDescription(new RTCSessionDescription(off));
            const answer0 = await pc.current.createAnswer();
            // Stesso ritocco dell'offer: Opus per primo, FEC acceso, portata costante.
            const answer = { type: answer0.type, sdp: tuneSdp(answer0.sdp) };
            await pc.current.setLocalDescription(answer);
            const sig = user?.sk ? signMessage(answer.sdp, user.sk) : "";
            const ansObj = { answer: { type: answer.type, sdp: answer.sdp }, answer_sig: sig, to_pk: myPk };
            const sealed = peerKem.current ? encryptForRecipients(JSON.stringify(ansObj), { c: peerKem.current })[0] : ansObj;
            await api.anonPut(chan.current, "answer", sealed);
            addCallLog({ call_id: chan.current, peer: route.params?.from || "", direction: "in", video: !!video, created_at: new Date().toISOString(), answered_at: new Date().toISOString(), ended_at: "" });
            setStatus("connected");
            try { if (chan.current) api.callAnswered(chan.current); } catch {}
            trySas();
          }
        }
        startPolling();
      } catch (e) {
        if (mounted) { setErrMsg(String(e?.message || e || "errore")); setStatus("error"); }
        setTimeout(() => { if (mounted) hangup(); }, 6000);
      }
    })();
    return () => { mounted = false; cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accepted]);

  const startPolling = useCallback(() => {
    if (poll.current) clearInterval(poll.current);
    poll.current = setInterval(async () => {
      if (ended.current || !chan.current) return;
      let g;
      try { g = await api.anonGet(chan.current, iceCFrom.current, iceEFrom.current); } catch { return; }
      if (!g || !g.found) return;
      if (g.bye) { cleanup(); navigation.goBack(); return; }
      if (!incoming && !remoteSet.current && g.answer) {
        remoteSet.current = true;
        let ans = g.answer;
        if (ans && ans.ct) { try { const pt = decryptEnvelope(ans, user.kem.secretKey); ans = pt ? JSON.parse(pt) : null; } catch { ans = null; } }
        if (ans && ans.answer && ans.answer.sdp) {
          const ok = ans.answer_sig && ans.to_pk ? verifyMessage(ans.answer.sdp, ans.answer_sig, ans.to_pk) : false;
          setVerified(ok);
          try { await pc.current.setRemoteDescription(new RTCSessionDescription(ans.answer)); setStatus("connected"); try { if (chan.current) api.callAnswered(chan.current); } catch {} trySas(); } catch {}
        }
      }
      if (incoming) { const l = g.ice_c || []; applyRemoteIce(l); iceCFrom.current += l.length; }
      else { const l = g.ice_e || []; applyRemoteIce(l); iceEFrom.current += l.length; }
    // 800 ms: è il ritmo con cui si scambiano risposta e candidati ICE. A 1,5 s la
    // connessione partiva con un secondo di ritardo secco.
    }, 800);
  }, [incoming, applyRemoteIce, cleanup, navigation, user]);

  const toggleMute = () => { const a = localStream?.getAudioTracks?.()[0]; if (a) { a.enabled = muted; setMuted(!muted); } };

  // IL PEZZO CHE MANCAVA: quando arriva una chiamata esterna il telecom mette la nostra in
  // pausa (`hold`) invece di strapparci l'audio. Chiudiamo il microfono e lo riapriamo a
  // `unhold`, senza toccare la sessione crittografica: la chiamata NON cade.
  useEffect(() => {
    const off = telecom.onAction((action) => {
      if (action === "hold") {
        setHeld(true);
        try { localStream?.getAudioTracks?.().forEach((t) => { t.enabled = false; }); } catch { /* niente */ }
      } else if (action === "unhold") {
        setHeld(false);
        try { localStream?.getAudioTracks?.().forEach((t) => { t.enabled = !muted; }); } catch { /* niente */ }
      } else if (action === "reject" || action === "end") {
        try { hangup(); } catch { /* niente */ }
      }
    });
    return off;
  }, [localStream, muted, hangup]);

  // A chiamata connessa lo si dice al sistema: da quel momento la nostra e' la chiamata
  // "attiva" del telefono e ha la priorita sull'audio.
  useEffect(() => {
    if (status === "connected") { telecom.setActive(); }
  }, [status]);

  const statusLabel = status === "calling" ? (lang === "en" ? "Calling…" : "Chiamata in corso…")
    : status === "answering" ? (lang === "en" ? "Connecting…" : "Connessione…")
    : status === "connected" ? (lang === "en" ? "Connected" : "Connesso")
    : status === "error" ? (lang === "en" ? "Call failed" : "Chiamata non riuscita") : status;

  const showE2eeInfo = useCallback(() => {
    Alert.alert(
      lang === "en" ? "🔒 End-to-end encrypted call" : "🔒 Chiamata cifrata E2EE",
      lang === "en"
        ? "The voice travels only through an anonymous relay (no one learns your IP), is protected by DTLS-SRTP, keeps a constant bitrate (so no one can read the pauses of the conversation), and the emoji SAS check blocks any interception — not even we can listen."
        : "La voce passa solo tramite relay anonimo (nessuno conosce il tuo IP), è protetta da DTLS-SRTP, viaggia a portata costante (quindi nessuno può leggere le pause della conversazione) e la verifica SAS a emoji blocca ogni intercettazione — nemmeno noi possiamo ascoltare.",
      [{ text: "OK" }]
    );
  }, [lang]);

  if (incoming && !accepted) {
    return (
      <View style={styles.root} testID="call-incoming">
        <View style={styles.audioBg}><View style={styles.avatar}><Text style={styles.avatarTxt}>{(peerName || "?").slice(0, 1).toUpperCase()}</Text></View></View>
        <View style={styles.ringTop}>
          <Text style={styles.peer} testID="call-incoming-name">{peerName}</Text>
          <Text style={styles.status}>{lang === "en" ? "Incoming call…" : "Chiamata in arrivo…"}</Text>
          <TouchableOpacity style={styles.ringE2ee} onPress={showE2eeInfo} testID="call-e2ee-badge-incoming" activeOpacity={0.7}>
            <Ionicons name="lock-closed-outline" size={12} color={theme.accent} />
            <Text style={styles.ringE2eeTxt}>E2EE · anonimo · ML-DSA-65</Text>
            <Ionicons name="information-circle-outline" size={13} color={theme.accent} />
          </TouchableOpacity>
        </View>
        <View style={styles.ringControls}>
          <View style={styles.ringBtnWrap}>
            <TouchableOpacity style={[styles.ringBtn, styles.rejectBtn]} onPress={reject} testID="call-reject"><Ionicons name="call-outline" size={30} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} /></TouchableOpacity>
            <Text style={styles.ringLbl}>{lang === "en" ? "Decline" : "Rifiuta"}</Text>
          </View>
          <View style={styles.ringBtnWrap}>
            <TouchableOpacity style={[styles.ringBtn, styles.acceptBtn]} onPress={accept} testID="call-accept"><Ionicons name="call" size={30} color="#fff" /></TouchableOpacity>
            <Text style={styles.ringLbl}>{lang === "en" ? "Accept" : "Accetta"}</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root} testID="call-screen">
      {/* Solo voce: al posto del riquadro video c'e' l'iniziale del contatto. */}
      <View style={styles.audioBg}><View style={styles.avatar}><Text style={styles.avatarTxt}>{(peerName || "?").slice(0, 1).toUpperCase()}</Text></View></View>

      <View style={styles.topBar}>
        <Text style={styles.peer} testID="call-peer">{peerName}</Text>
        <Text style={styles.status} testID="call-status">{held ? (lang === "en" ? "On hold · another call" : "In pausa · altra chiamata") : statusLabel}</Text>
        {status === "error" && !!errMsg && (<Text style={{ color: "#ff6b6b", fontSize: 12, marginTop: 6, textAlign: "center", paddingHorizontal: 20 }} testID="call-error-detail">{errMsg}</Text>)}
        {!!warn && (<Text style={{ color: "#50C878", fontSize: 12, marginTop: 6, textAlign: "center", paddingHorizontal: 20 }} testID="call-warning">{warn}</Text>)}
        <Text style={{ color: allowDirect.current ? "#50C878" : "#8ea2c0", fontSize: 11, marginTop: 6, textAlign: "center" }} testID="call-ip-badge">
          {allowDirect.current
            ? (lang === "en" ? "Direct connection: the other side can see your IP" : "Connessione diretta: l'altra persona può vedere il tuo IP")
            : (lang === "en" ? "Routed through our relay · your IP stays hidden" : "Instradata dal nostro relay · il tuo IP resta nascosto")}
        </Text>
        <TouchableOpacity style={styles.e2eeBadge} onPress={showE2eeInfo} testID="call-e2ee-badge" activeOpacity={0.75}>
          <Ionicons name="lock-closed-outline" size={14} color="#04120a" />
          <Text style={styles.e2eeBadgeTxt}>{lang === "en" ? "End-to-end encrypted" : "Cifrata end-to-end"}</Text>
          <Ionicons name="information-circle-outline" size={15} color="#04120a" />
        </TouchableOpacity>
        {verified === true && <View style={styles.verBadge} testID="call-verified"><Ionicons name="shield-checkmark-outline" size={13} color="#04120a" /><Text style={styles.verTxt}>{lang === "en" ? "Identity verified · ML-DSA-65" : "Identità verificata · ML-DSA-65"}</Text></View>}
        {verified === false && <View style={[styles.verBadge, styles.verBad]} testID="call-unverified"><Ionicons name="warning-outline" size={13} color="#fff" /><Text style={[styles.verTxt, { color: "#fff" }]}>{lang === "en" ? "Signature NOT verified" : "Firma NON verificata"}</Text></View>}
        {sas && (
          <View style={styles.sasBox} testID="call-sas">
            {sasVerified ? (
              <View style={styles.sasVerRow}><Ionicons name="checkmark-circle-outline" size={16} color="#22c55e" /><Text style={styles.sasVerTxt}>{lang === "en" ? "Already verified with this contact" : "Già verificato con questo contatto"}</Text></View>
            ) : (
              <Text style={styles.sasLabel}>{lang === "en" ? "Verify aloud:" : "Verifica a voce:"}</Text>
            )}
            <Text style={styles.sasCode} testID="call-sas-code">{sas}</Text>
            {!sasVerified && (
              <TouchableOpacity onPress={markVerified} style={styles.sasBtn} testID="call-sas-verify"><Ionicons name="checkmark-done-outline" size={14} color="#04120a" /><Text style={styles.sasBtnTxt}>{lang === "en" ? "Mark verified" : "Segna verificato"}</Text></TouchableOpacity>
            )}
          </View>
        )}
      </View>

      <View style={styles.controls}>
        <TouchableOpacity style={[styles.ctrl, muted && styles.ctrlOn]} onPress={toggleMute} testID="call-mute"><Ionicons name={muted ? "mic-off" : "mic"} size={24} color="#fff" /></TouchableOpacity>

        <TouchableOpacity style={[styles.ctrl, styles.hang]} onPress={hangup} testID="call-hangup"><Ionicons name="call-outline" size={26} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} /></TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (tint) => StyleSheet.create({
  root: { flex: 1, backgroundColor: "#05070d" },
  remoteVideo: { ...StyleSheet.absoluteFillObject, backgroundColor: "#000" },
  audioBg: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "#0a0f1c" },
  avatar: { width: 120, height: 120, borderRadius: 60, backgroundColor: tint, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: "#fff", fontSize: 52, fontWeight: "800" },
  localVideo: { position: "absolute", top: 60, right: 16, width: 108, height: 156, borderRadius: 12, backgroundColor: "#111", borderWidth: 2, borderColor: tint + "AA" },
  topBar: { position: "absolute", top: 70, left: 0, right: 0, alignItems: "center", gap: 6 },
  peer: { color: "#fff", fontSize: 24, fontWeight: "800" },
  status: { color: "rgba(255,255,255,0.75)", fontSize: 14 },
  verBadge: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#22c55e", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, marginTop: 4 },
  verBad: { backgroundColor: "#c0392b" },
  verTxt: { color: "#04120a", fontSize: 11, fontWeight: "800" },
  controls: { position: "absolute", bottom: 48, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 18 },
  ctrl: { width: 60, height: 60, borderRadius: 30, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  ctrlOn: { backgroundColor: tint, borderWidth: 1, borderColor: "rgba(255,255,255,0.35)" },
  hang: { backgroundColor: "#e0364f" },
  ringTop: { position: "absolute", top: 110, left: 0, right: 0, alignItems: "center", gap: 8 },
  ringE2ee: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6, backgroundColor: "rgba(80,200,120,0.12)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  ringE2eeTxt: { color: theme.accent, fontSize: 11, fontWeight: "800" },
  e2eeBadge: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center", marginTop: 8, backgroundColor: theme.accent, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  e2eeBadgeTxt: { color: "#04120a", fontSize: 12.5, fontWeight: "900", letterSpacing: 0.3 },
  ringControls: { position: "absolute", bottom: 70, left: 0, right: 0, flexDirection: "row", justifyContent: "space-evenly", alignItems: "center" },
  ringBtnWrap: { alignItems: "center", gap: 10 },
  ringBtn: { width: 74, height: 74, borderRadius: 37, alignItems: "center", justifyContent: "center" },
  rejectBtn: { backgroundColor: "#e0364f" },
  acceptBtn: { backgroundColor: "#22c55e" },
  ringLbl: { color: "#fff", fontSize: 13, fontWeight: "700" },
  sasBox: { alignItems: "center", marginTop: 10, backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 14, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderColor: tint + "66" },
  sasLabel: { color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: "700" },
  sasCode: { fontSize: 26, letterSpacing: 4, marginTop: 2 },
  sasVerRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  sasVerTxt: { color: "#22c55e", fontSize: 12, fontWeight: "800" },
  sasBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#22c55e", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 5, marginTop: 8 },
  sasBtnTxt: { color: "#04120a", fontSize: 12, fontWeight: "800" },
});

import React, { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { RTCPeerConnection, RTCIceCandidate, RTCSessionDescription, mediaDevices, RTCView } from "react-native-webrtc";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../lib/i18n";
import * as api from "../lib/api";
import { signMessage, verifyMessage, bytesToHex } from "../lib/crypto";
import { ensureCallPermissions } from "../lib/callPerms";
import { suppressLock } from "../lib/lockGuard";
import { iceConfig } from "../config";
import { theme } from "../theme";

// Chiamata di gruppo mesh (max 4). Ogni coppia negozia un PeerConnection P2P; l'SDP è
// firmato ML-DSA-65 e verificato dal peer. L'iniziatore della coppia è chi ha l'LNS minore.
export default function GroupCallScreen({ route, navigation }) {
  const { user } = useAuth();
  const { lang } = useI18n();
  const video = !!route.params?.video;
  const chanName = route.params?.chan_name || (lang === "en" ? "Group call" : "Chiamata di gruppo");
  const me = (user?.lns || "").toLowerCase();
  const myPk = user?.pk || (user?.kem ? bytesToHex(user.kem.publicKey) : "");

  const [roomId, setRoomId] = useState(route.params?.room_id || null);
  const [remoteStreams, setRemoteStreams] = useState({}); // lns -> stream
  const [verifiedMap, setVerifiedMap] = useState({}); // lns -> bool
  const [localStream, setLocalStream] = useState(null);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [count, setCount] = useState(1);

  const pcs = useRef({}); // lns -> RTCPeerConnection
  const remoteSet = useRef({}); // lns -> bool
  const iceApplied = useRef({}); // lns -> number
  const localRef = useRef(null);
  const roomRef = useRef(route.params?.room_id || null);
  const pollRoom = useRef(null);
  const pollSig = useRef(null);
  const ended = useRef(false);

  const makePc = useCallback((peer) => {
    const p = new RTCPeerConnection(iceConfig(false)); // gruppi: sempre dal relay
    p.addEventListener("icecandidate", (e) => {
      if (e.candidate && roomRef.current) {
        const c = e.candidate.toJSON ? e.candidate.toJSON() : e.candidate;
        api.gcallIce({ room_id: roomRef.current, peer, cand: c }).catch(() => {});
      }
    });
    p.addEventListener("track", (e) => { if (e.streams && e.streams[0]) setRemoteStreams((m) => ({ ...m, [peer]: e.streams[0] })); });
    if (localRef.current) localRef.current.getTracks().forEach((t) => p.addTrack(t, localRef.current));
    return p;
  }, []);

  const applyIce = useCallback((peer, list) => {
    if (!Array.isArray(list) || !pcs.current[peer]) return;
    const start = iceApplied.current[peer] || 0;
    for (let i = start; i < list.length; i++) { try { pcs.current[peer].addIceCandidate(new RTCIceCandidate(list[i])); } catch {} }
    iceApplied.current[peer] = list.length;
  }, []);

  const ensureOffer = useCallback(async (peer) => {
    if (pcs.current[peer]) return;
    const p = makePc(peer); pcs.current[peer] = p;
    try {
      const offer = await p.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: video });
      await p.setLocalDescription(offer);
      const sig = user?.sk ? signMessage(offer.sdp, user.sk) : "";
      await api.gcallSignal({ room_id: roomRef.current, to: peer, kind: "offer", sdp: offer.sdp, sig, pk: myPk });
    } catch {}
  }, [makePc, myPk, user, video]);

  const handleSignal = useCallback(async (sig) => {
    const peer = sig.peer;
    if (!peer || peer === me) return;
    if (sig.iam_offerer) {
      // io ho offerto: applica la risposta del peer
      if (sig.answer && sig.answer.sdp && pcs.current[peer] && !remoteSet.current[peer]) {
        remoteSet.current[peer] = true;
        const ok = sig.answer_sig && sig.to_pk ? verifyMessage(sig.answer.sdp, sig.answer_sig, sig.to_pk) : false;
        setVerifiedMap((m) => ({ ...m, [peer]: ok }));
        try { await pcs.current[peer].setRemoteDescription(new RTCSessionDescription(sig.answer)); } catch {}
      }
    } else {
      // il peer ha offerto a me: rispondo
      if (sig.offer && sig.offer.sdp && !pcs.current[peer]) {
        const p = makePc(peer); pcs.current[peer] = p;
        remoteSet.current[peer] = true;
        const ok = sig.offer_sig && sig.from_pk ? verifyMessage(sig.offer.sdp, sig.offer_sig, sig.from_pk) : false;
        setVerifiedMap((m) => ({ ...m, [peer]: ok }));
        try {
          await p.setRemoteDescription(new RTCSessionDescription(sig.offer));
          const answer = await p.createAnswer({});
          await p.setLocalDescription(answer);
          const asig = user?.sk ? signMessage(answer.sdp, user.sk) : "";
          await api.gcallSignal({ room_id: roomRef.current, to: peer, kind: "answer", sdp: answer.sdp, sig: asig, pk: myPk });
        } catch {}
      }
    }
    applyIce(peer, sig.remote_ice);
  }, [applyIce, makePc, me, myPk, user]);

  const leave = useCallback(async () => {
    ended.current = true;
    if (pollRoom.current) clearInterval(pollRoom.current);
    if (pollSig.current) clearInterval(pollSig.current);
    if (roomRef.current) { try { await api.gcallLeave(roomRef.current); } catch {} }
    Object.values(pcs.current).forEach((p) => { try { p.close(); } catch {} });
    try { localRef.current && localRef.current.getTracks().forEach((t) => t.stop()); } catch {}
    navigation.goBack();
  }, [navigation]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        suppressLock();
        const okPerm = await ensureCallPermissions(video);
        if (!okPerm) { if (mounted) { setTimeout(() => leave(), 800); } return; }
        const stream = await mediaDevices.getUserMedia({ audio: true, video: video ? { facingMode: "user" } : false });
        if (!mounted) { stream.getTracks().forEach((t) => t.stop()); return; }
        localRef.current = stream; setLocalStream(stream);
        // assicura iscrizione alla stanza
        try { const r = await api.gcallJoin(roomRef.current); if (r?.room_id) { roomRef.current = r.room_id; setRoomId(r.room_id); } } catch {}
        // poll partecipanti → apri offerte verso i peer con LNS maggiore del mio
        pollRoom.current = setInterval(async () => {
          if (ended.current || !roomRef.current) return;
          try {
            const room = await api.gcallRoom(roomRef.current);
            const parts = (room.participants || []).map((x) => (x || "").toLowerCase());
            setCount(parts.length || 1);
            if (room.status === "ended") { leave(); return; }
            parts.filter((peer) => peer !== me && me < peer).forEach((peer) => ensureOffer(peer));
          } catch {}
        }, 2200);
        // poll signaling
        pollSig.current = setInterval(async () => {
          if (ended.current || !roomRef.current) return;
          try { const sigs = await api.gcallSignals(roomRef.current); (Array.isArray(sigs) ? sigs : []).forEach((sg) => handleSignal(sg)); } catch {}
        }, 1800);
      } catch { leave(); }
    })();
    return () => { mounted = false; ended.current = true; if (pollRoom.current) clearInterval(pollRoom.current); if (pollSig.current) clearInterval(pollSig.current); Object.values(pcs.current).forEach((p) => { try { p.close(); } catch {} }); try { localRef.current && localRef.current.getTracks().forEach((t) => t.stop()); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMute = () => { const a = localRef.current?.getAudioTracks?.()[0]; if (a) { a.enabled = muted; setMuted(!muted); } };
  const toggleCam = () => { const v = localRef.current?.getVideoTracks?.()[0]; if (v) { v.enabled = camOff; setCamOff(!camOff); } };
  const switchCam = () => { try { localRef.current?.getVideoTracks?.()[0]?._switchCamera?.(); } catch {} };

  const remotes = Object.keys(remoteStreams);
  const allVerified = remotes.length > 0 && remotes.every((r) => verifiedMap[r] === true);

  return (
    <View style={styles.root} testID="gcall-screen">
      <View style={styles.grid}>
        {video && localStream && !camOff && (
          <RTCView streamURL={localStream.toURL()} style={styles.tile} objectFit="cover" mirror />
        )}
        {remotes.map((r) => (
          <View key={r} style={styles.tile} testID="gcall-remote">
            {video && remoteStreams[r] ? (
              <RTCView streamURL={remoteStreams[r].toURL()} style={StyleSheet.absoluteFill} objectFit="cover" />
            ) : (
              <View style={styles.audioTile}><View style={styles.avatar}><Text style={styles.avatarTxt}>{(r || "?").slice(0, 1).toUpperCase()}</Text></View></View>
            )}
            <View style={styles.tileTag}>
              <Ionicons name={verifiedMap[r] === true ? "shield-checkmark" : "shield-outline"} size={11} color={verifiedMap[r] === true ? "#22c55e" : "#ffd166"} />
              <Text style={styles.tileName} numberOfLines={1}>{(r || "").split("@")[0]}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.topBar}>
        <Text style={styles.peer}>{chanName}</Text>
        <Text style={styles.status} testID="gcall-count">{count} {lang === "en" ? "in call" : "in chiamata"}{remotes.length ? (allVerified ? " · " + (lang === "en" ? "all verified ML-DSA-65" : "tutti verificati ML-DSA-65") : "") : " · " + (lang === "en" ? "waiting…" : "in attesa…")}</Text>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity style={[styles.ctrl, muted && styles.ctrlOn]} onPress={toggleMute} testID="gcall-mute"><Ionicons name={muted ? "mic-off" : "mic"} size={24} color="#fff" /></TouchableOpacity>
        {video && <TouchableOpacity style={[styles.ctrl, camOff && styles.ctrlOn]} onPress={toggleCam} testID="gcall-cam"><Ionicons name={camOff ? "videocam-off" : "videocam"} size={24} color="#fff" /></TouchableOpacity>}
        {video && <TouchableOpacity style={styles.ctrl} onPress={switchCam} testID="gcall-switch"><Ionicons name="camera-reverse-outline" size={24} color="#fff" /></TouchableOpacity>}
        <TouchableOpacity style={[styles.ctrl, styles.hang]} onPress={leave} testID="gcall-leave"><Ionicons name="call-outline" size={26} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} /></TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#05070d" },
  grid: { ...StyleSheet.absoluteFillObject, flexDirection: "row", flexWrap: "wrap" },
  tile: { width: "50%", height: "50%", backgroundColor: "#0a0f1c", borderWidth: 1, borderColor: "#05070d", overflow: "hidden" },
  audioTile: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  avatar: { width: 74, height: 74, borderRadius: 37, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: "#fff", fontSize: 30, fontWeight: "800" },
  tileTag: { position: "absolute", bottom: 8, left: 8, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, maxWidth: "80%" },
  tileName: { color: "#fff", fontSize: 11, fontWeight: "700" },
  topBar: { position: "absolute", top: 60, left: 0, right: 0, alignItems: "center", gap: 4 },
  peer: { color: "#fff", fontSize: 20, fontWeight: "800" },
  status: { color: "rgba(255,255,255,0.8)", fontSize: 13 },
  controls: { position: "absolute", bottom: 48, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 16 },
  ctrl: { width: 58, height: 58, borderRadius: 29, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  ctrlOn: { backgroundColor: "rgba(255,255,255,0.35)" },
  hang: { backgroundColor: "#e0364f" },
});

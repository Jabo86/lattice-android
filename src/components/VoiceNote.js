import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { theme } from "../theme";

function mmss(s) {
  s = Math.max(0, Math.round(s || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

// Nota audio E2EE: player + onda sonora (pseudo, deterministica) + durata.
export default function VoiceNote({ uri, duration }) {
  const player = useAudioPlayer(uri ? { uri } : null);
  const status = useAudioPlayerStatus(player);
  const playing = !!status?.playing;
  const bars = React.useMemo(
    () => Array.from({ length: 24 }, (_, i) => 5 + ((i * 7 + Math.round((duration || 3) * 3)) % 17)),
    [duration]
  );
  const prog = status?.duration ? (status.currentTime || 0) / status.duration : 0;
  const toggle = () => {
    if (!uri) return;
    if (playing) { player.pause(); return; }
    if (status?.didJustFinish || (status?.duration && (status.currentTime || 0) >= status.duration)) player.seekTo(0);
    player.play();
  };
  const shown = playing || (status?.currentTime > 0) ? status.currentTime : (duration || 0);
  return (
    <View style={s.wrap} testID="voice-note">
      <TouchableOpacity onPress={toggle} style={s.btn} testID="voice-play">
        <Ionicons name={playing ? "pause" : "play"} size={18} color="#fff" />
      </TouchableOpacity>
      <View style={s.waveRow}>
        {bars.map((h, i) => (
          <View key={i} style={[s.bar, { height: h, backgroundColor: (i / bars.length) <= prog ? theme.accent : "rgba(255,255,255,0.35)" }]} />
        ))}
      </View>
      <Text style={s.time}>{mmss(shown)}</Text>
    </View>
  );
}
const s = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6, minWidth: 210 },
  btn: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center" },
  waveRow: { flexDirection: "row", alignItems: "center", gap: 2, flex: 1, height: 28 },
  bar: { width: 3, borderRadius: 2 },
  time: { color: "#DCE7FF", fontSize: 11, fontWeight: "700", minWidth: 34, textAlign: "right" },
});

import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Vibration } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { createAudioPlayer } from "expo-audio";
import { theme } from "../theme";
import { useI18n } from "../lib/i18n";
import { saveRingtone, loadRingtone, saveRingVolume, loadRingVolume, saveVibMode, loadVibMode } from "../lib/store";
import * as api from "../lib/api";

const RINGTONES = { classic: require("../../assets/ringtone.wav"), chime: require("../../assets/ring_chime.wav"), beep: require("../../assets/ring_beep.wav"), digital: require("../../assets/ring_digital.wav"), marimba: require("../../assets/ring_marimba.wav"), pulse: require("../../assets/ring_pulse.wav") };
const RINGTONE_OPTS = [["system", "Suoneria del telefono"], ["classic", "Classica"], ["chime", "Chime"], ["beep", "Beep"], ["digital", "Digitale"], ["marimba", "Marimba"], ["pulse", "Pulsazione"]];
const VIB_PATTERNS = { standard: [0, 700, 900, 700], short: [0, 400, 300, 400], long: [0, 1200, 600, 1200] };

export default function NotificationsScreen({ navigation }) {
  const { lang } = useI18n();
  const en = lang === "en";
  const [ringtone, setRingtone] = useState("classic");
  const [ringVol, setRingVol] = useState(1);
  const [vibMode, setVibMode] = useState("standard");
  const [testBusy, setTestBusy] = useState(false);
  const [testRes, setTestRes] = useState(null);
  const [testErr, setTestErr] = useState("");

  // AVVISO DI PROVA. Senza freno e senza fascia di silenzio: serve a capire in tre secondi
  // se il telefono è a posto, non a rispettare la buona educazione.
  const runTest = async () => {
    setTestBusy(true); setTestErr(""); setTestRes(null);
    try { setTestRes(await api.testNotify()); }
    catch (e) { setTestErr(String(e?.response?.data?.detail || e?.message || e)); }
    setTestBusy(false);
  };

  useEffect(() => {
    (async () => {
      try { setRingtone(await loadRingtone()); } catch (e) {}
      try { setRingVol(await loadRingVolume()); } catch (e) {}
      try { setVibMode(await loadVibMode()); } catch (e) {}
    })();
  }, []);

  const previewRing = (key, vol) => {
    if (key === "system") return; // usa la suoneria di sistema del telefono
    try {
      const pl = createAudioPlayer(RINGTONES[key] || RINGTONES.classic);
      try { pl.volume = vol; } catch (e2) {}
      pl.play();
      setTimeout(() => { try { pl.remove(); } catch (e) {} }, 2600);
    } catch (e) {}
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} testID="notif-back" style={{ padding: 4 }}>
          <Ionicons name="chevron-back-outline" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.hTitle}>{en ? "Notifications" : "Notifiche"}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} testID="notif-screen">
        <Text style={styles.hint}>
          {en ? "Ringtone, volume and vibration for incoming calls and message alerts." : "Suoneria, volume e vibrazione per le chiamate in arrivo e gli avvisi dei messaggi."}
        </Text>

        <Text style={styles.section}>{en ? "Is it working?" : "Funziona?"}</Text>
        <TouchableOpacity onPress={runTest} disabled={testBusy} testID="notif-test-btn"
          style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.card, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16, opacity: testBusy ? 0.5 : 1 }}>
          <Ionicons name="notifications-outline" size={20} color={theme.primary} />
          <Text style={{ color: theme.text, fontWeight: "700", fontSize: 15 }}>
            {testBusy ? (en ? "Sending…" : "Invio…") : (en ? "Send me a test alert" : "Mandami un avviso di prova")}
          </Text>
        </TouchableOpacity>
        {!!testRes && (
          <View testID="notif-test-result" style={{ marginTop: 12, backgroundColor: theme.card, borderRadius: 12, padding: 14 }}>
            {[[en ? "Our own channel" : "Canale nostro",
               testRes.wake?.alive
                 ? (en ? "listening now" : "in ascolto adesso")
                 : (en ? "not listening" : "non in ascolto")],
              ["Firebase", (testRes.firebase?.tokens ?? 0) + (en ? " token(s) · " : " gettoni · ") + (testRes.firebase?.ms ?? 0) + " ms"],
              [en ? "Browser" : "Browser", (testRes.browser?.sent ?? 0) + "/" + (testRes.browser?.subs ?? 0) + " · " + (testRes.browser?.ms ?? 0) + " ms"],
              [en ? "Total" : "Totale", (testRes.total_ms ?? 0) + " ms"]].map(([k, v]) => (
              <View key={k} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 }}>
                <Text style={{ color: theme.textDim, fontSize: 13 }}>{k}</Text>
                <Text style={{ color: theme.text, fontSize: 13, fontWeight: "700" }}>{v}</Text>
              </View>
            ))}
            <Text style={{ color: theme.textDim, fontSize: 12, marginTop: 8, lineHeight: 17 }}>
              {en
                ? "If the alert does not appear on screen, Lattice does not have permission to show notifications: check it in the Android settings."
                : "Se l'avviso non compare a schermo, Lattice non ha il permesso di mostrare notifiche: controllalo nelle impostazioni di Android."}
            </Text>
          </View>
        )}
        {!!testErr && <Text testID="notif-test-error" style={{ color: "#ff9a9a", fontSize: 13, marginTop: 10 }}>{testErr}</Text>}

        <Text style={styles.section}>{en ? "Call ringtone" : "Suoneria chiamate"}</Text>
        <View style={styles.card}>
          {RINGTONE_OPTS.map(([k, label]) => (
            <TouchableOpacity key={k} testID={"ringtone-" + k} onPress={async () => { setRingtone(k); await saveRingtone(k); previewRing(k, ringVol); }} style={styles.row}>
              <Ionicons name={ringtone === k ? "radio-button-on" : "radio-button-off"} size={20} color={ringtone === k ? theme.primary : theme.textDim} />
              <Text style={styles.rowLabel}>{label}</Text>
              <Ionicons name={k === "system" ? "phone-portrait-outline" : "play-circle-outline"} size={22} color={theme.textDim} />
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.volRow}>
          <Ionicons name="volume-medium-outline" size={18} color={theme.textDim} />
          <Text style={{ color: theme.textDim, fontSize: 13, marginRight: 2 }}>Volume</Text>
          {[0.25, 0.5, 0.75, 1].map((v) => (
            <TouchableOpacity key={v} testID={"ringvol-" + Math.round(v * 100)} onPress={async () => { setRingVol(v); await saveRingVolume(v); previewRing(ringtone, v); }} style={{ paddingVertical: 6, paddingHorizontal: 14, borderRadius: 10, backgroundColor: Math.abs(ringVol - v) < 0.01 ? theme.primary : theme.card }}>
              <Text style={{ color: Math.abs(ringVol - v) < 0.01 ? "#fff" : theme.text, fontWeight: "700", fontSize: 13 }}>{Math.round(v * 100)}%</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.section}>{en ? "Vibration" : "Vibrazione"}</Text>
        <View style={styles.card}>
          {[["off", en ? "Off" : "Disattivata"], ["standard", "Standard"], ["short", en ? "Short" : "Breve"], ["long", en ? "Long" : "Lunga"]].map(([k, label]) => (
            <TouchableOpacity key={k} testID={"vib-" + k} onPress={async () => { setVibMode(k); await saveVibMode(k); if (k !== "off") { try { Vibration.vibrate(VIB_PATTERNS[k] || VIB_PATTERNS.standard); } catch (e) {} } }} style={styles.row}>
              <Ionicons name={vibMode === k ? "radio-button-on" : "radio-button-off"} size={20} color={vibMode === k ? theme.primary : theme.textDim} />
              <Text style={styles.rowLabel}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border },
  hTitle: { color: theme.text, fontSize: 20, fontWeight: "800", marginLeft: 4 },
  hint: { color: theme.textDim, fontSize: 13, lineHeight: 19, marginBottom: 14 },
  section: { color: theme.textFaint, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8, marginTop: 6 },
  card: { backgroundColor: theme.card, borderRadius: 14, overflow: "hidden", marginBottom: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.bg },
  rowLabel: { color: theme.text, fontSize: 15, fontWeight: "600", flex: 1 },
  volRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4, paddingBottom: 14, flexWrap: "wrap" },
});

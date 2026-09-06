import React, { useEffect } from "react";
import { View, Text, StyleSheet, Vibration } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { recordThreat } from "../lib/threatLog";

// Banner rosso (pericolo) / ambra (attenzione) mostrato quando il motore
// anti-minacce rileva un rischio in un messaggio o allegato.
export default function ThreatBanner({ result, lang = "it", style, context = "Pulse" }) {
  const active = result && result.level !== "safe" && result.reasons?.length;
  useEffect(() => {
    if (active) {
      recordThreat({ level: result.level, reasons: result.reasons, context });
      // Vibrazione di allerta quando lo Scudo blocca una minaccia grave.
      if (result.level === "danger") { try { Vibration.vibrate([0, 220, 90, 220]); } catch { /* ignore */ } }
    }
  }, [active, result?.level, (result?.reasons || []).join("|"), context]);
  if (!active) return null;
  const danger = result.level === "danger";
  const c = danger ? "#FF4D5E" : "#50C878";
  const bg = danger ? "rgba(255,77,94,0.12)" : "rgba(80,200,120,0.12)";
  const title = danger
    ? (lang === "en" ? "Danger — threat blocked" : "Pericolo — minaccia bloccata")
    : (lang === "en" ? "Warning — suspicious content" : "Attenzione — contenuto sospetto");
  return (
    <View style={[styles.wrap, { borderColor: c, backgroundColor: bg }, style]} testID={danger ? "threat-danger" : "threat-warn"}>
      <View style={styles.head}>
        <Ionicons name={danger ? "warning" : "alert-circle"} size={16} color={c} />
        <Text style={[styles.title, { color: c }]}>{title}</Text>
      </View>
      {result.reasons.slice(0, 4).map((r, i) => (
        <Text key={i} style={styles.reason}>• {r}</Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8, borderWidth: 1, borderRadius: 10, padding: 9 },
  head: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 },
  title: { fontSize: 12, fontWeight: "800" },
  reason: { color: "#E7ECF5", fontSize: 11.5, lineHeight: 16 },
});

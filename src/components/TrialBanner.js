import React, { useEffect, useState } from "react";
import { AppState, View, Text, StyleSheet } from "react-native";
import * as api from "../lib/api";
import { theme } from "../theme";

// Shown only for hosted free-trial tenants: daily message counter + 24h
// auto-delete notice + upgrade nudge. Hidden for licensed / on-prem servers.
export default function TrialBanner() {
  const [st, setSt] = useState(null);
  useEffect(() => {
    let on = true;
    const load = () => api.trialStatus().then((d) => on && setSt(d)).catch(() => {});
    load();
    const id = setInterval(() => { if (AppState.currentState === "active") load(); }, 60000);
    return () => { on = false; clearInterval(id); };
  }, []);
  if (!st || !st.is_trial) return null;
  const low = (st.remaining ?? 0) <= 2;
  return (
    <View style={[styles.wrap, low && styles.wrapLow]} testID="trial-banner">
      <Text style={[styles.tag, low && styles.tagLow]}>
        PROVA GRATUITA · {st.used_today}/{st.daily_limit} messaggi oggi
      </Text>
      <Text style={styles.body}>
        I messaggi si cancellano dopo {st.data_ttl_hours}h. Passa al tuo server aziendale
        per messaggi illimitati e cronologia permanente.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: "rgba(80,200,120,0.10)",
    borderColor: "rgba(80,200,120,0.35)",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: 14,
    marginTop: 10,
  },
  wrapLow: {
    backgroundColor: "rgba(255,145,0,0.12)",
    borderColor: "rgba(255,145,0,0.5)",
  },
  tag: { color: "#9dc0ff", fontSize: 12, fontWeight: "800", letterSpacing: 0.5 },
  tagLow: { color: "#ffcc80" },
  body: { color: theme.textDim, fontSize: 12, lineHeight: 17, marginTop: 3 },
});

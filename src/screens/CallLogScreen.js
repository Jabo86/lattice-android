import React, { useState, useCallback, useMemo } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../lib/i18n";
import * as api from "../lib/api";
import { loadCallLog, markCallLogSeen } from "../lib/store";
import { useTint } from "../lib/appearance";
import { theme } from "../theme";

// Registro chiamate: effettuate / ricevute / perse, con durata e tasto richiama.
export default function CallLogScreen({ navigation }) {
  const tint = useTint();
  const styles = useMemo(() => makeStyles(tint), [tint]);
  const { lang } = useI18n();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    try { const r = await loadCallLog(); setItems(Array.isArray(r) ? r : []); } catch {}
    try { await markCallLogSeen(); } catch {}
    setLoading(false); setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const duration = (a, e) => {
    if (!a || !e) return null;
    const s = Math.max(0, Math.round((new Date(e).getTime() - new Date(a).getTime()) / 1000));
    const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, "0")}`;
  };
  const when = (iso) => { try { const d = new Date(iso); const t = d.toLocaleTimeString(lang === "en" ? "en-US" : "it-IT", { hour: "2-digit", minute: "2-digit" }); const day = d.toLocaleDateString(lang === "en" ? "en-US" : "it-IT", { day: "2-digit", month: "short" }); return `${day} · ${t}`; } catch { return ""; } };

  const missedCount = items.filter((i) => i.missed).length;
  const outCount = items.filter((i) => i.direction === "out" && !i.missed).length;
  const inCount = items.filter((i) => i.direction === "in" && !i.missed).length;
  const shown = items.filter((i) =>
    filter === "all" || (filter === "missed" && i.missed) ||
    (filter === "out" && i.direction === "out" && !i.missed) ||
    (filter === "in" && i.direction === "in" && !i.missed));

  const Chip = ({ id, label, n, color }) => (
    <TouchableOpacity
      onPress={() => setFilter(id)}
      style={[styles.chip, { borderColor: color + "66" }, filter === id && { backgroundColor: color + "22" }]}
      testID={`calllog-filter-${id}`}
    >
      <Text style={[styles.chipTxt, { color }]}>{label} · {n}</Text>
    </TouchableOpacity>
  );

  const renderItem = ({ item }) => {
    const missed = item.missed;
    const out = item.direction === "out";
    const icon = missed ? "call-outline" : out ? "arrow-up-outline" : "arrow-down-outline";
    const color = missed ? "#e0364f" : out ? theme.textDim : "#22c55e";
    const dur = duration(item.answered_at, item.ended_at);
    return (
      <TouchableOpacity activeOpacity={0.7} style={styles.row} testID="calllog-item" onPress={() => navigation.navigate("Call", { to: item.peer, to_name: (item.peer || "").split("@")[0], video: item.video })}>
        <View style={[styles.iconWrap, item.video && styles.videoWrap]}>
          <Ionicons name={item.video ? "videocam" : "call"} size={18} color={tint} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.peer, missed && { color: "#e0364f" }]} numberOfLines={1}>{(item.peer || "").split("@")[0]}</Text>
          <View style={styles.metaRow}>
            <Ionicons name={icon} size={13} color={color} />
            <Text style={styles.meta}>{missed ? (lang === "en" ? "Missed" : "Persa") : out ? (lang === "en" ? "Outgoing" : "Effettuata") : (lang === "en" ? "Incoming" : "Ricevuta")}{dur ? ` · ${dur}` : ""} · {when(item.created_at)}</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.recall} onPress={() => navigation.navigate("Call", { to: item.peer, to_name: (item.peer || "").split("@")[0], video: item.video })} testID="calllog-recall">
          <Ionicons name={item.video ? "videocam" : "call"} size={20} color="#fff" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} testID="calllog-back"><Ionicons name="chevron-back-outline" size={26} color={theme.text} /></TouchableOpacity>
        <Text style={styles.title}>{lang === "en" ? "Call log" : "Registro chiamate"}</Text>
        <View style={{ width: 26 }} />
      </View>
      {loading ? <View style={styles.center}><ActivityIndicator color={tint} /></View> : (
        <FlatList data={shown}
          ListHeaderComponent={
            <View style={styles.chips}>
              <Chip id="all" label={lang === "en" ? "ALL" : "TUTTE"} n={items.length} color={theme.textDim} />
              <Chip id="missed" label={lang === "en" ? "MISSED" : "PERSE"} n={missedCount} color="#e0364f" />
              <Chip id="out" label={lang === "en" ? "OUTGOING" : "EFFETTUATE"} n={outCount} color={tint} />
              <Chip id="in" label={lang === "en" ? "INCOMING" : "RICEVUTE"} n={inCount} color="#22c55e" />
            </View>
          } keyExtractor={(i) => i.call_id} renderItem={renderItem}
          ListEmptyComponent={<Text style={styles.empty}>{lang === "en" ? "No calls yet." : "Nessuna chiamata."}</Text>}
          contentContainerStyle={items.length ? { padding: 8 } : { flex: 1, justifyContent: "center" }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={tint} />} />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (tint) => StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 14, paddingVertical: 12 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 11, paddingVertical: 6 },
  chipTxt: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border },
  title: { color: theme.text, fontSize: 20, fontWeight: "800" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { color: theme.textDim, textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, backgroundColor: theme.surface, borderRadius: 12, marginBottom: 8 },
  iconWrap: { width: 42, height: 42, borderRadius: 21, backgroundColor: theme.surfaceAlt, alignItems: "center", justifyContent: "center" },
  videoWrap: { backgroundColor: theme.surfaceAlt },
  peer: { color: theme.text, fontSize: 15, fontWeight: "700" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 },
  meta: { color: theme.textDim, fontSize: 12 },
  recall: { width: 42, height: 42, borderRadius: 21, backgroundColor: tint, alignItems: "center", justifyContent: "center" },
});

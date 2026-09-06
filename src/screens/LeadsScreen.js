import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
  ActivityIndicator, Alert, Linking, ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";
import * as api from "../lib/api";

const SOURCE_LABEL = {
  license: "Licenza",
  contact: "Contatto",
  "trial-signup": "Prova gratuita",
  trial: "Prova gratuita",
};

const FILTERS = [
  { key: "all", label: "Tutte" },
  { key: "unread", label: "Non lette" },
  { key: "open", label: "Da gestire" },
  { key: "license", label: "Licenza" },
  { key: "contact", label: "Contatto" },
  { key: "trial", label: "Prove" },
];

function fmtDate(s) {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " + d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

function matchFilter(l, f) {
  if (f === "all") return true;
  if (f === "unread") return !l.read;
  if (f === "open") return !l.managed;
  if (f === "license") return l.source === "license";
  if (f === "contact") return l.source === "contact";
  if (f === "trial") return l.source === "trial-signup" || l.source === "trial";
  return true;
}

function matchPeriod(l, p) {
  if (p === "all") return true;
  const d = new Date(l.created_at);
  if (isNaN(d.getTime())) return true;
  const days = (Date.now() - d.getTime()) / 86400000;
  if (p === "today") return days <= 1;
  if (p === "week") return days <= 7;
  if (p === "month") return days <= 31;
  return true;
}

const PERIODS = [
  { key: "all", label: "Sempre" },
  { key: "today", label: "Oggi" },
  { key: "week", label: "7 giorni" },
  { key: "month", label: "30 giorni" },
];

export default function LeadsScreen({ navigation, route }) {
  const focusId = route?.params?.focusId || null;
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState("");
  const [expanded, setExpanded] = useState({});
  const [filter, setFilter] = useState("all");
  const [period, setPeriod] = useState("all");
  const [highlightId, setHighlightId] = useState(null);
  const listRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setErr("");
      const data = await api.consoleLeads();
      setLeads(Array.isArray(data) ? data : []);
    } catch (e) {
      setErr(api.apiErr(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  // Notifica toccata su un lead specifico → apri, evidenzia, segna letto e scorri.
  useEffect(() => {
    if (!focusId || loading) return;
    const idx = leads.findIndex((l) => l.id === focusId);
    if (idx < 0) return;
    setFilter("all");
    setExpanded((p) => ({ ...p, [focusId]: true }));
    setHighlightId(focusId);
    const lead = leads[idx];
    if (lead && !lead.read) {
      api.consoleLeadRead(focusId).catch(() => {});
      setLeads((p) => p.map((l) => (l.id === focusId ? { ...l, read: true } : l)));
    }
    const st = setTimeout(() => { try { listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.25 }); } catch (e) {} }, 450);
    const ht = setTimeout(() => setHighlightId(null), 3200);
    return () => { clearTimeout(st); clearTimeout(ht); };
  }, [focusId, loading, leads.length]);

  const onTap = async (item) => {
    setExpanded((p) => ({ ...p, [item.id]: !p[item.id] }));
    if (!item.read) {
      try {
        await api.consoleLeadRead(item.id);
        setLeads((p) => p.map((l) => (l.id === item.id ? { ...l, read: true } : l)));
      } catch (e) {}
    }
  };

  const toggleManaged = async (item) => {
    const next = !item.managed;
    setLeads((p) => p.map((l) => (l.id === item.id ? { ...l, managed: next, read: true } : l)));
    try {
      await api.consoleLeadManage(item.id, next);
    } catch (e) {
      setLeads((p) => p.map((l) => (l.id === item.id ? { ...l, managed: !next } : l)));
      Alert.alert("Errore", api.apiErr(e));
    }
  };

  const onDelete = (item) => {
    Alert.alert("Elimina richiesta", "Vuoi eliminare definitivamente questa richiesta?", [
      { text: "Annulla", style: "cancel" },
      {
        text: "Elimina", style: "destructive", onPress: async () => {
          try {
            await api.consoleLeadDelete(item.id);
            setLeads((p) => p.filter((l) => l.id !== item.id));
          } catch (e) { Alert.alert("Errore", api.apiErr(e)); }
        },
      },
    ]);
  };

  const counts = useMemo(() => {
    const c = {};
    FILTERS.forEach((f) => { c[f.key] = leads.filter((l) => matchFilter(l, f.key)).length; });
    return c;
  }, [leads]);

  const visible = useMemo(() => leads.filter((l) => matchFilter(l, filter) && matchPeriod(l, period)), [leads, filter, period]);
  const unread = counts.unread || 0;
  const managedCount = useMemo(() => leads.filter((l) => l.managed).length, [leads]);

  const renderItem = ({ item }) => {
    const open = !!expanded[item.id];
    const title = item.company || item.name || "(senza nome)";
    return (
      <TouchableOpacity
        style={[styles.card, !item.read && styles.cardUnread, item.managed && styles.cardManaged, highlightId === item.id && styles.cardHighlight]}
        onPress={() => onTap(item)}
        activeOpacity={0.7}
        testID={`lead-item-${item.id}`}
      >
        <View style={styles.cardHead}>
          {!item.read && <View style={styles.dot} testID={`lead-unread-${item.id}`} />}
          <Text style={styles.cardTitle} numberOfLines={1}>{title}</Text>
          {item.managed && (
            <View style={styles.managedBadge} testID={`lead-managed-${item.id}`}>
              <Ionicons name="checkmark-done-outline" size={12} color={theme.accent} />
              <Text style={styles.managedTxt}>Gestito</Text>
            </View>
          )}
          <View style={styles.srcBadge}>
            <Text style={styles.srcText}>{SOURCE_LABEL[item.source] || item.source || "—"}</Text>
          </View>
        </View>
        {!!item.name && !!item.company && <Text style={styles.sub}>{item.name}</Text>}
        {!!item.package && (
          <Text style={styles.pkg}>
            {String(item.package).toUpperCase()}{item.plan ? ` · ${item.plan === "subscription" ? "Abbonamento" : "Una tantum"}` : ""}
          </Text>
        )}
        <Text style={styles.date}>{fmtDate(item.created_at)}</Text>

        {open && (
          <View style={styles.details} testID={`lead-details-${item.id}`}>
            {!!item.email && (
              <TouchableOpacity style={styles.line} onPress={() => Linking.openURL(`mailto:${item.email}`)}>
                <Ionicons name="mail-outline" size={16} color={theme.primary} />
                <Text style={styles.lineTxt}>{item.email}</Text>
              </TouchableOpacity>
            )}
            {!!item.phone && (
              <TouchableOpacity style={styles.line} onPress={() => Linking.openURL(`tel:${item.phone}`)}>
                <Ionicons name="call-outline" size={16} color={theme.primary} />
                <Text style={styles.lineTxt}>{item.phone}</Text>
              </TouchableOpacity>
            )}
            {!!item.domain && (
              <View style={styles.line}>
                <Ionicons name="globe-outline" size={16} color={theme.textDim} />
                <Text style={styles.lineTxt}>{item.domain}</Text>
              </View>
            )}
            {!!item.message && (
              <View style={styles.msgBox}>
                <Text style={styles.msgTxt}>{item.message}</Text>
              </View>
            )}
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.manageBtn, item.managed && styles.manageBtnActive]}
                onPress={() => toggleManaged(item)}
                testID={`lead-manage-${item.id}`}
              >
                <Ionicons name={item.managed ? "refresh-outline" : "checkmark-done-outline"} size={16} color={item.managed ? theme.textDim : theme.accent} />
                <Text style={[styles.manageTxt, item.managed && { color: theme.textDim }]}>
                  {item.managed ? "Riapri" : "Segna gestito"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.delBtn} onPress={() => onDelete(item)} testID={`lead-delete-${item.id}`}>
                <Ionicons name="trash-outline" size={16} color={theme.danger} />
                <Text style={styles.delTxt}>Elimina</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} testID="leads-back" style={styles.backBtn}>
          <Ionicons name="chevron-back-outline" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.hTitle}>Richieste</Text>
        {unread > 0 && (
          <View style={styles.hBadge}><Text style={styles.hBadgeTxt}>{unread}</Text></View>
        )}
      </View>

      <View style={styles.filterWrap}>
        {!loading && !err && (
          <View style={styles.summary} testID="leads-summary">
            <Text style={styles.summaryTxt}>
              <Text style={styles.summaryNew}>{unread}</Text> nuove  ·  <Text style={styles.summaryDone}>{managedCount}</Text> gestite  ·  {leads.length} totali
            </Text>
          </View>
        )}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <TouchableOpacity
                key={f.key}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setFilter(f.key)}
                testID={`lead-filter-${f.key}`}
              >
                <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>
                  {f.label}{counts[f.key] ? ` (${counts[f.key]})` : ""}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.filterRow, { paddingTop: 0 }]}>
          {PERIODS.map((p) => {
            const active = period === p.key;
            return (
              <TouchableOpacity
                key={p.key}
                style={[styles.chipSm, active && styles.chipSmActive]}
                onPress={() => setPeriod(p.key)}
                testID={`lead-period-${p.key}`}
              >
                <Text style={[styles.chipSmTxt, active && styles.chipSmTxtActive]}>{p.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <ActivityIndicator color={theme.primary} style={{ marginTop: 40 }} />
      ) : err ? (
        <View style={styles.empty}>
          <Ionicons name="alert-circle-outline" size={40} color={theme.danger} />
          <Text style={styles.emptyTxt}>{err}</Text>
          <TouchableOpacity style={styles.retry} onPress={load}><Text style={styles.retryTxt}>Riprova</Text></TouchableOpacity>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={visible}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          onScrollToIndexFailed={(info) => { setTimeout(() => { try { listRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.25 }); } catch (e) {} }, 350); }}
          contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="mail-open-outline" size={44} color={theme.textFaint} />
              <Text style={styles.emptyTxt}>Nessuna richiesta in questo filtro</Text>
            </View>
          }
          testID="leads-list"
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border },
  backBtn: { padding: 4 },
  hTitle: { color: theme.text, fontSize: 22, fontWeight: "800", marginLeft: 4 },
  hBadge: { marginLeft: 10, backgroundColor: theme.primary, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 },
  hBadgeTxt: { color: "#fff", fontSize: 12, fontWeight: "800" },
  filterWrap: { borderBottomWidth: 1, borderBottomColor: theme.border },
  summary: { paddingHorizontal: 14, paddingTop: 10 },
  summaryTxt: { color: theme.textDim, fontSize: 13, fontWeight: "600" },
  summaryNew: { color: theme.primary, fontWeight: "800" },
  summaryDone: { color: theme.accent, fontWeight: "800" },
  filterRow: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  chip: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, marginRight: 8 },
  chipActive: { backgroundColor: theme.primary, borderColor: theme.primary },
  chipTxt: { color: theme.textDim, fontSize: 13, fontWeight: "700" },
  chipTxtActive: { color: "#fff" },
  chipSm: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999, backgroundColor: "transparent", borderWidth: 1, borderColor: theme.border, marginRight: 7 },
  chipSmActive: { borderColor: theme.accent, backgroundColor: "rgba(0,180,120,.14)" },
  chipSmTxt: { color: theme.textFaint, fontSize: 12, fontWeight: "700" },
  chipSmTxtActive: { color: theme.accent },
  card: { backgroundColor: theme.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: theme.border },
  cardUnread: { borderColor: theme.primary, backgroundColor: theme.surfaceAlt },
  cardManaged: { opacity: 0.78 },
  cardHighlight: { borderColor: theme.accent, borderWidth: 2, shadowColor: theme.accent, shadowOpacity: 0.5, shadowRadius: 10, elevation: 6 },
  cardHead: { flexDirection: "row", alignItems: "center" },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: theme.primary, marginRight: 8 },
  cardTitle: { color: theme.text, fontSize: 16, fontWeight: "800", flex: 1 },
  managedBadge: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(80,200,120,0.12)", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, marginLeft: 6 },
  managedTxt: { color: theme.accent, fontSize: 11, fontWeight: "700", marginLeft: 3 },
  srcBadge: { backgroundColor: theme.primaryDeep, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginLeft: 8 },
  srcText: { color: "#cfe0ff", fontSize: 11, fontWeight: "700" },
  sub: { color: theme.textDim, fontSize: 13, marginTop: 4 },
  pkg: { color: theme.accent, fontSize: 12, fontWeight: "700", marginTop: 4 },
  date: { color: theme.textFaint, fontSize: 12, marginTop: 6 },
  details: { marginTop: 12, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 12 },
  line: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  lineTxt: { color: theme.text, fontSize: 14, marginLeft: 8 },
  msgBox: { backgroundColor: "transparent", borderRadius: 10, padding: 10, marginTop: 2, marginBottom: 8 },
  msgTxt: { color: theme.text, fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  manageBtn: { flexDirection: "row", alignItems: "center", paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.accent, marginRight: 10 },
  manageBtnActive: { borderColor: theme.border },
  manageTxt: { color: theme.accent, fontSize: 13, fontWeight: "700", marginLeft: 6 },
  delBtn: { flexDirection: "row", alignItems: "center", paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.danger },
  delTxt: { color: theme.danger, fontSize: 13, fontWeight: "700", marginLeft: 6 },
  empty: { alignItems: "center", justifyContent: "center", padding: 40, marginTop: 40 },
  emptyTxt: { color: theme.textDim, fontSize: 15, marginTop: 12, textAlign: "center" },
  retry: { marginTop: 14, backgroundColor: theme.primary, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  retryTxt: { color: "#fff", fontWeight: "700" },
});

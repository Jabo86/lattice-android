import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
  ActivityIndicator, ScrollView, Modal, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";
import * as api from "../lib/api";

const FILTERS = [
  { key: "all", label: "Tutte" },
  { key: "expiring", label: "⏳ In scadenza" },
  { key: "trial", label: "🧪 In prova" },
  { key: "hosted", label: "🏠 Ospitate" },
  { key: "onprem", label: "🖥️ On-premise" },
];

const PACKAGES = [
  { key: "starter", label: "Starter" },
  { key: "business", label: "Business" },
  { key: "enterprise", label: "Enterprise" },
];
const DURATIONS = [
  { key: 1, label: "+1 mese" },
  { key: 3, label: "+3 mesi" },
  { key: 6, label: "+6 mesi" },
  { key: 12, label: "+12 mesi" },
  { key: 0, label: "Perpetua" },
];

function isTrialT(t) { return t.is_trial === true || t.status === "trial"; }
function isPerpetualT(t) { return !isTrialT(t) && (t.perpetual === true || t.billing === "perpetual" || !t.expires_at); }
function isExpiring(t) { return !isPerpetualT(t) && t.days_left != null && t.days_left > 0 && t.days_left <= 7; }
function isExpired(t) { return !isPerpetualT(t) && t.days_left != null && t.days_left <= 0; }

function expiryInfo(t) {
  if (isTrialT(t)) {
    if (t.days_left == null) return { label: "🧪 In prova", color: theme.primary };
    if (t.days_left <= 0) return { label: "🧪 Prova scaduta", color: theme.danger };
    return { label: `🧪 In prova · ${t.days_left} gg`, color: t.days_left <= 7 ? "#50C878" : theme.primary };
  }
  if (isPerpetualT(t)) return { label: "Perpetua", color: theme.textDim };
  if (t.days_left <= 0) return { label: "⛔ Scaduta", color: theme.danger };
  if (t.days_left <= 7) return { label: `⏳ Scade tra ${t.days_left} gg`, color: "#50C878" };
  return { label: `${t.days_left} giorni`, color: theme.textDim };
}
function sortKey(t) {
  if (isPerpetualT(t)) return 900000;
  return t.days_left != null ? t.days_left : 800000;
}
function tierFromLabel(label) {
  const l = (label || "").toLowerCase();
  if (l.indexOf("starter") >= 0) return "starter";
  if (l.indexOf("business") >= 0) return "business";
  if (l.indexOf("enterprise") >= 0) return "enterprise";
  return null;
}

export default function LicensesScreen({ navigation }) {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("all");
  // modale gestione
  const [modalItem, setModalItem] = useState(null);
  const [selPkg, setSelPkg] = useState("starter");
  const [selDur, setSelDur] = useState(3);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setErr("");
      const data = await api.consoleTenants();
      setTenants(Array.isArray(data) ? data : []);
    } catch (e) {
      setErr(api.apiErr(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  const onRefresh = () => { setRefreshing(true); load(); };

  const counts = useMemo(() => ({
    expiring: tenants.filter((t) => isExpiring(t) || isExpired(t)).length,
    trial: tenants.filter(isTrialT).length,
  }), [tenants]);

  const visible = useMemo(() => {
    const arr = tenants.slice().sort((a, b) => sortKey(a) - sortKey(b));
    return arr.filter((t) => {
      if (filter === "expiring") return isExpiring(t) || isExpired(t);
      if (filter === "trial") return isTrialT(t);
      if (filter === "hosted") return t.onprem !== true;
      if (filter === "onprem") return t.onprem === true;
      return true;
    });
  }, [tenants, filter]);

  const openManage = (item) => {
    setModalItem(item);
    setSelPkg(tierFromLabel(item.package_label) || "starter");
    setSelDur(isPerpetualT(item) ? 0 : 3);
  };

  const submitManage = async () => {
    const item = modalItem;
    if (!item) return;
    setSaving(true);
    try {
      const paidTerm = !isTrialT(item) && !isPerpetualT(item) && !!tierFromLabel(item.package_label);
      const samePkg = tierFromLabel(item.package_label) === selPkg;
      let res;
      if (selDur > 0 && paidTerm && samePkg) {
        res = await api.consoleRenewLicense({ tenant_id: item.tenant_id, months: selDur });
      } else {
        res = await api.consoleActivateLicense({ tenant_id: item.tenant_id, pkg: selPkg, duration_months: selDur });
      }
      setModalItem(null);
      const when = selDur > 0 ? `scade tra ~${selDur * 30} giorni` : "perpetua";
      Alert.alert("✓ Fatto", `Licenza ${selPkg} attivata per ${item.company_name || item.tenant_id} (${when}).`);
      load();
    } catch (e) {
      Alert.alert("Errore", api.apiErr(e));
    } finally {
      setSaving(false);
    }
  };

  const renderItem = ({ item }) => {
    const ex = expiryInfo(item);
    const hosted = item.onprem !== true;
    const dateStr = isTrialT(item) ? item.trial_expires_at : item.expires_at;
    return (
      <TouchableOpacity style={styles.card} onPress={() => openManage(item)} activeOpacity={0.7} testID={`license-item-${item.tenant_id}`}>
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.company_name || item.tenant_id}</Text>
          <View style={[styles.typeBadge, hosted ? styles.typeHosted : styles.typeOnprem]} testID={`license-type-${item.tenant_id}`}>
            <Text style={[styles.typeTxt, { color: hosted ? theme.accent : "#50C878" }]}>
              {hosted ? "🏠 Ospitata" : "🖥️ On-premise"}
            </Text>
          </View>
        </View>
        <View style={styles.cardRow}>
          <Text style={styles.pkg}>{item.package_label && item.package_label !== "Licenza" ? item.package_label : (isTrialT(item) ? "Prova gratuita" : "—")}</Text>
          <Text style={[styles.expiry, { color: ex.color }]}>{ex.label}</Text>
        </View>
        {!!dateStr && !isPerpetualT(item) && (
          <Text style={styles.date}>{isTrialT(item) ? "Prova fino al" : "Scadenza"}: {String(dateStr).slice(0, 10)}</Text>
        )}
        <View style={styles.manageHint}>
          <Ionicons name="create-outline" size={13} color={theme.primary} />
          <Text style={styles.manageHintTxt}>Tocca per attivare / rinnovare</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} testID="licenses-back" style={styles.backBtn}>
          <Ionicons name="chevron-back-outline" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.hTitle}>Licenze</Text>
      </View>

      {!loading && !err && counts.expiring > 0 && (
        <TouchableOpacity style={styles.banner} onPress={() => setFilter("expiring")} testID="licenses-expiry-banner">
          <Ionicons name="alert-circle-outline" size={18} color="#50C878" />
          <Text style={styles.bannerTxt}>
            {counts.expiring} licenz{counts.expiring === 1 ? "a" : "e"} in scadenza/scadute — tocca per vederle
          </Text>
        </TouchableOpacity>
      )}

      <View style={styles.filterWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            const n = f.key === "expiring" ? counts.expiring : f.key === "trial" ? counts.trial : 0;
            return (
              <TouchableOpacity key={f.key} style={[styles.chip, active && styles.chipActive]} onPress={() => setFilter(f.key)} testID={`license-filter-${f.key}`}>
                <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{f.label}{n ? ` (${n})` : ""}</Text>
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
          data={visible}
          keyExtractor={(i) => i.tenant_id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="business-outline" size={44} color={theme.textFaint} />
              <Text style={styles.emptyTxt}>Nessuna azienda in questo filtro</Text>
            </View>
          }
          testID="licenses-list"
        />
      )}

      {/* MODALE ATTIVA/RINNOVA */}
      <Modal visible={!!modalItem} transparent animationType="slide" onRequestClose={() => setModalItem(null)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard} testID="license-manage-modal">
            <Text style={styles.modalTitle}>Gestisci licenza</Text>
            <Text style={styles.modalSub}>{modalItem?.company_name || modalItem?.tenant_id}</Text>

            <Text style={styles.modalLabel}>Pacchetto</Text>
            <View style={styles.optRow}>
              {PACKAGES.map((p) => {
                const on = selPkg === p.key;
                return (
                  <TouchableOpacity key={p.key} style={[styles.opt, on && styles.optOn]} onPress={() => setSelPkg(p.key)} testID={`license-pkg-${p.key}`}>
                    <Text style={[styles.optTxt, on && styles.optTxtOn]}>{p.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.modalLabel}>Durata</Text>
            <View style={styles.optRow}>
              {DURATIONS.map((d) => {
                const on = selDur === d.key;
                return (
                  <TouchableOpacity key={d.key} style={[styles.opt, on && styles.optOn]} onPress={() => setSelDur(d.key)} testID={`license-dur-${d.key}`}>
                    <Text style={[styles.optTxt, on && styles.optTxtOn]}>{d.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.modalNote}>🏠 La licenza resta ospitata sul server centrale (nessuna installazione lato cliente).</Text>

            <View style={styles.summaryBox} testID="license-summary">
              <Text style={styles.summaryLbl}>Riepilogo</Text>
              <Text style={styles.summaryVal}>
                {(PACKAGES.find((p) => p.key === selPkg) || {}).label} · {selDur > 0 ? `${selDur} mes${selDur === 1 ? "e" : "i"}` : "Perpetua"}
                {selDur > 0 ? ` · scade il ${new Date(Date.now() + selDur * 2592000000).toLocaleDateString("it-IT")}` : " · nessuna scadenza"}
              </Text>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalItem(null)} disabled={saving} testID="license-cancel">
                <Text style={styles.cancelTxt}>Annulla</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.okBtn, saving && { opacity: 0.6 }]} onPress={submitManage} disabled={saving} testID="license-submit">
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.okTxt}>Conferma</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border },
  backBtn: { padding: 4 },
  hTitle: { color: theme.text, fontSize: 22, fontWeight: "800", marginLeft: 4 },
  banner: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 14, marginTop: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: "rgba(80,200,120,0.12)", borderWidth: 1, borderColor: "rgba(80,200,120,0.4)" },
  bannerTxt: { color: "#ffcf7a", fontSize: 13, fontWeight: "700", flex: 1 },
  filterWrap: { borderBottomWidth: 1, borderBottomColor: theme.border },
  filterRow: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  chip: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, marginRight: 8 },
  chipActive: { backgroundColor: theme.primary, borderColor: theme.primary },
  chipTxt: { color: theme.textDim, fontSize: 13, fontWeight: "700" },
  chipTxtActive: { color: "#fff" },
  card: { backgroundColor: theme.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: theme.border },
  cardHead: { flexDirection: "row", alignItems: "center" },
  cardTitle: { color: theme.text, fontSize: 16, fontWeight: "800", flex: 1 },
  typeBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginLeft: 8, borderWidth: 1 },
  typeHosted: { backgroundColor: "rgba(80,200,120,0.10)", borderColor: "rgba(80,200,120,0.35)" },
  typeOnprem: { backgroundColor: "rgba(80,200,120,0.10)", borderColor: "rgba(80,200,120,0.35)" },
  typeTxt: { fontSize: 11, fontWeight: "800" },
  cardRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
  pkg: { color: theme.accent, fontSize: 12, fontWeight: "700" },
  expiry: { fontSize: 13, fontWeight: "800" },
  date: { color: theme.textFaint, fontSize: 12, marginTop: 6 },
  manageHint: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 },
  manageHintTxt: { color: theme.primary, fontSize: 11, fontWeight: "700" },
  empty: { alignItems: "center", justifyContent: "center", padding: 40, marginTop: 40 },
  emptyTxt: { color: theme.textDim, fontSize: 15, marginTop: 12, textAlign: "center" },
  retry: { marginTop: 14, backgroundColor: theme.primary, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  retryTxt: { color: "#fff", fontWeight: "700" },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: theme.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 34, borderTopWidth: 1, borderColor: theme.border },
  modalTitle: { color: theme.text, fontSize: 18, fontWeight: "800" },
  modalSub: { color: theme.textDim, fontSize: 14, marginTop: 2, marginBottom: 12 },
  modalLabel: { color: theme.textDim, fontSize: 12, fontWeight: "700", marginTop: 10, marginBottom: 6 },
  optRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  opt: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: theme.border, backgroundColor: "transparent", marginRight: 8, marginBottom: 8 },
  optOn: { borderColor: theme.primary, backgroundColor: "rgba(80,200,120,0.16)" },
  optTxt: { color: theme.textDim, fontSize: 13, fontWeight: "700" },
  optTxtOn: { color: "#fff" },
  modalNote: { color: theme.textFaint, fontSize: 12, marginTop: 12, lineHeight: 17 },
  summaryBox: { marginTop: 14, padding: 12, borderRadius: 12, backgroundColor: "rgba(80,200,120,0.08)", borderWidth: 1, borderColor: "rgba(80,200,120,0.3)" },
  summaryLbl: { color: theme.textFaint, fontSize: 11, fontWeight: "700", marginBottom: 3 },
  summaryVal: { color: theme.accent, fontSize: 14, fontWeight: "800" },
  modalActions: { flexDirection: "row", gap: 12, marginTop: 18 },
  cancelBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: theme.border, alignItems: "center" },
  cancelTxt: { color: theme.textDim, fontSize: 15, fontWeight: "700" },
  okBtn: { flex: 2, paddingVertical: 13, borderRadius: 12, backgroundColor: "#0a7d3a", alignItems: "center" },
  okTxt: { color: "#fff", fontSize: 15, fontWeight: "800" },
});

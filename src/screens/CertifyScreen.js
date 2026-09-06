import React, { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, ScrollView,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";
import { useI18n } from "../lib/i18n";
import { SkeletonList } from "../components/Skeleton";
import { useAuth } from "../context/AuthContext";
import * as api from "../lib/api";

const BOXES = ["inbox", "sent", "drafts", "scheduled", "trash"];
const CLASS_COLOR = { INTERNAL: "#7fb0ff", CONFIDENTIAL: "#ffcf5c", RESTRICTED: "#ff9d5c", "LEGAL-HOLD": "#F2F4F3" };

function fmt(ts) {
  if (!ts) return "";
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}
function fmtShort(ts) {
  if (!ts) return "";
  try { return new Date(ts).toLocaleDateString(); } catch { return ts; }
}
function fmtBytes(n) {
  if (!n) return "0";
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export default function CertifyScreen({ navigation }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [box, setBox] = useState("inbox");
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loader = useCallback((b) => {
    if (b === "drafts") return api.certifyDrafts();
    if (b === "scheduled") return api.certifyScheduled();
    return api.certifyInbox(b);
  }, []);

  const load = useCallback(async (b = box) => {
    try {
      const d = await loader(b);
      setItems(Array.isArray(d) ? d : []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, [box, loader]);

  useFocusEffect(useCallback(() => {
    setLoading(true); load(box);
    api.certifyStats().then(setStats).catch(() => {});
  }, [box]));

  const onRefresh = async () => { setRefreshing(true); await load(box); await api.certifyStats().then(setStats).catch(() => {}); setRefreshing(false); };

  const delDraft = async (m) => { try { await api.certifyDelDraft(m.draft_id); load(box); } catch {} };
  const cancelSched = async (m) => { try { await api.certifyCancelScheduled(m.scheduled_id); load(box); } catch {} };
  const restore = async (m) => { try { await api.certifyRestore(m.mail_id); load(box); } catch {} };
  const del = async (m) => { try { await api.certifyDelete(m.mail_id); load(box); } catch {} };

  const openRow = (item) => {
    if (box === "drafts") { navigation.navigate("CertifyCompose", { draft: item }); return; }
    if (box === "scheduled") return;
    navigation.navigate("CertifyDetail", { mail_id: item.mail_id, box });
  };

  const renderItem = ({ item }) => {
    const mine = item.sender_lns === user?.lns;
    const who = (box === "sent" || box === "drafts" || box === "scheduled") ? (item.recipient_lns || "—") : item.sender_lns;
    const unread = box === "inbox" && !item.read_at;
    const cc = CLASS_COLOR[item.classification] || theme.textDim;
    const stColor = item.status === "failed" ? theme.danger : item.status === "sent" ? theme.accent : "#ff9100";
    return (
      <TouchableOpacity style={styles.row} onPress={() => openRow(item)} testID="certify-mail-row" activeOpacity={box === "scheduled" ? 1 : 0.6}>
        {box === "scheduled" ? <View style={[styles.unreadDot, { backgroundColor: stColor }]} />
          : box === "drafts" ? <View style={[styles.unreadDot, { backgroundColor: "#ff9100" }]} />
          : unread ? <View style={styles.unreadDot} /> : <View style={{ width: 8 }} />}
        <View style={{ flex: 1 }}>
          <View style={styles.rowTop}>
            <Text style={[styles.subject, unread && { fontWeight: "800", color: theme.text }]} numberOfLines={1}>
              {item.subject || "—"}
            </Text>
            <Text style={styles.time}>{fmtShort(box === "scheduled" ? item.send_at : item.sealed_at)}</Text>
          </View>
          <Text style={styles.who} numberOfLines={1}>
            {(box === "sent" || box === "drafts" || box === "scheduled") ? `${t("certify.to")} ` : `${t("certify.from")} `}{who}
          </Text>
          <View style={styles.tags}>
            <View style={[styles.tag, { borderColor: cc }]}><Text style={[styles.tagTxt, { color: cc }]}>{item.classification || "INTERNAL"}</Text></View>
            {box === "scheduled" && (
              <Text style={[styles.readTxt, { color: stColor }]}>
                {item.status === "pending" ? t("certify.schedPending") : item.status === "sent" ? t("certify.schedSent") : item.status === "sending" ? t("certify.schedSending") : t("certify.schedFailed")}
              </Text>
            )}
            {box === "sent" && (item.read_at ? <Text style={styles.readTxt}>✓✓ {t("certify.read")}</Text> : item.delivered_at ? <Text style={styles.readTxt}>✓✓ {t("certify.delivered")}</Text> : <Text style={styles.readTxt}>✓ {t("certify.sent")}</Text>)}
          </View>
        </View>
        {box === "drafts" ? (
          <TouchableOpacity onPress={() => delDraft(item)} testID="certify-draft-del" hitSlop={10}><Ionicons name="trash-outline" size={18} color={theme.textFaint} /></TouchableOpacity>
        ) : box === "scheduled" ? (
          item.status === "pending" ? <TouchableOpacity onPress={() => cancelSched(item)} testID="certify-sched-cancel" hitSlop={10}><Ionicons name="close-outline" size={18} color={theme.textFaint} /></TouchableOpacity> : <View style={{ width: 18 }} />
        ) : box === "trash" ? (
          <View style={styles.trashActions}>
            <TouchableOpacity onPress={() => restore(item)} testID="certify-row-restore" hitSlop={8}><Ionicons name="refresh-outline" size={18} color={theme.accent} /></TouchableOpacity>
            <TouchableOpacity onPress={() => del(item)} testID="certify-row-delete" hitSlop={8}><Ionicons name="trash-outline" size={18} color={theme.danger} /></TouchableOpacity>
          </View>
        ) : <Ionicons name="chevron-forward-outline" size={18} color={theme.textFaint} />}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Certify</Text>
          <Text style={styles.sub} numberOfLines={1}>{t("certify.subtitle")}</Text>
        </View>
        <TouchableOpacity style={styles.calBtn} onPress={() => navigation.navigate("GlobalSearch")} testID="global-search-btn">
          <Ionicons name="search-outline" size={18} color={theme.primary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.calBtn} onPress={() => navigation.navigate("CertifyCalendar")} testID="certify-calendar-btn">
          <Ionicons name="calendar-outline" size={18} color={theme.primary} />
        </TouchableOpacity>
      </View>

      {stats && (
        <View style={styles.statsRow} testID="certify-stats">
          {[
            { l: t("certify.stats.notarized"), v: stats.total_notarized },
            { l: t("certify.stats.24h"), v: stats.last_24h },
            { l: t("certify.stats.7d"), v: stats.last_7d },
            { l: t("certify.stats.bytes"), v: fmtBytes(stats.bytes_sealed) },
          ].map((s) => (
            <View key={s.l} style={styles.statCard}>
              <Text style={styles.statVal} numberOfLines={1}>{s.v ?? "—"}</Text>
              <Text style={styles.statLbl} numberOfLines={1}>{s.l}</Text>
            </View>
          ))}
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.segScroll} contentContainerStyle={styles.segment}>
        {BOXES.map((b) => (
          <TouchableOpacity key={b} style={[styles.segBtn, box === b && styles.segBtnActive]} onPress={() => setBox(b)} testID={`certify-box-${b}`}>
            <Text style={[styles.segTxt, box === b && styles.segTxtActive]} numberOfLines={1} allowFontScaling={false}>{t(`certify.box.${b}`)}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <SkeletonList count={7} testID="certify-skeleton" />
      ) : (
        <FlatList
          data={items}
          style={styles.list}
          keyExtractor={(m) => m.mail_id || m.draft_id || m.scheduled_id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 110 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
          ListEmptyComponent={<View style={styles.center}><Ionicons name="shield-checkmark-outline" size={40} color={theme.textFaint} /><Text style={styles.empty}>{t("certify.empty")}</Text></View>}
        />
      )}

      <TouchableOpacity style={styles.fab} onPress={() => navigation.navigate("CertifyCompose")} testID="certify-compose-fab">
        <Ionicons name="create-outline" size={24} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 18, paddingTop: 16, paddingBottom: 8, gap: 12 },
  title: { color: theme.text, fontSize: 26, fontWeight: "800" },
  sub: { color: theme.textDim, fontSize: 13, marginTop: 2 },
  calBtn: { width: 42, height: 42, borderRadius: 12, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center", backgroundColor: theme.surface },
  statsRow: { flexDirection: "row", gap: 8, paddingHorizontal: 14, marginBottom: 10, flexShrink: 0 },
  statCard: { flex: 1, backgroundColor: theme.surface, borderRadius: 10, borderWidth: 1, borderColor: theme.border, paddingVertical: 8, paddingHorizontal: 6, alignItems: "center" },
  statVal: { color: theme.text, fontSize: 15, fontWeight: "800" },
  statLbl: { color: theme.textFaint, fontSize: 9, marginTop: 2, textTransform: "uppercase", letterSpacing: 0.5, textAlign: "center" },
  segScroll: { flexGrow: 0, flexShrink: 0, height: 60 },
  list: { flex: 1 },
  segment: { flexDirection: "row", paddingHorizontal: 14, paddingVertical: 10, gap: 8, alignItems: "center" },
  segBtn: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, justifyContent: "center" },
  segBtnActive: { backgroundColor: theme.primary, borderColor: theme.primary },
  segTxt: { color: theme.textDim, fontWeight: "700", fontSize: 13, lineHeight: 18, includeFontPadding: false, textAlignVertical: "center" },
  segTxtActive: { color: "#fff" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: theme.border },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.primary },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  subject: { color: theme.textDim, fontSize: 15, flex: 1, marginRight: 8 },
  time: { color: theme.textFaint, fontSize: 11 },
  who: { color: theme.accent, fontSize: 12, marginTop: 2 },
  tags: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap" },
  tag: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  tagTxt: { fontSize: 10, fontWeight: "700" },
  readTxt: { color: theme.textFaint, fontSize: 11 },
  trashActions: { flexDirection: "row", gap: 14, alignItems: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60, gap: 10 },
  empty: { color: theme.textFaint, fontSize: 14 },
  fab: { position: "absolute", right: 20, bottom: 28, width: 56, height: 56, borderRadius: 28, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center", elevation: 6, shadowColor: theme.primary, shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
});

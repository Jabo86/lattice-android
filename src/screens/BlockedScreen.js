// CONTATTI IGNORATI — chi hai bloccato, con lo sblocco in un tocco.
// Gli indirizzi arrivano dalla rubrica di questo telefono e dall'elenco dei blocchi in
// chiaro sul server: i blocchi della rubrica cieca restano anonimi per progetto.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../lib/i18n";
import { useTint } from "../lib/appearance";
import { theme } from "../theme";
import * as api from "../lib/api";
import * as book from "../lib/book";
import Avatar from "../components/Avatar";

export default function BlockedScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const tint = useTint();
  const styles = React.useMemo(() => makeStyles(tint), [tint]);
  const { t } = useI18n();
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    const map = new Map();
    try {
      const local = await book.list();
      (local || []).filter((e) => e.blocked).forEach((e) => {
        map.set(e.lns, { lns: e.lns, display_name: e.name || e.display_name || "", avatar: e.avatar || null });
      });
    } catch { /* la rubrica locale può essere vuota */ }
    try {
      const d = await api.blocksList();
      const list = Array.isArray(d && d.blocked) ? d.blocked : [];
      const missing = list.filter((l) => !map.has(l));
      let names = [];
      if (missing.length) {
        try { names = await api.directoryResolve(missing); } catch { /* si mostra il solo indirizzo */ }
      }
      missing.forEach((lns, i) => {
        map.set(lns, { lns, display_name: (names[i] && names[i].display_name) || "", avatar: (names[i] && names[i].avatar) || null });
      });
    } catch { /* offline: resta la lista locale */ }
    setRows(Array.from(map.values()).sort((a, b) => a.lns.localeCompare(b.lns)));
  }, []);
  useEffect(() => { load(); }, [load]);

  const unblock = async (r) => {
    setBusy(r.lns);
    try { await api.blockContact(r.lns, false); await load(); }
    catch (e) { Alert.alert("Errore", api.apiErr(e)); }
    finally { setBusy(null); }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} testID="blocked-back" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back-outline" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.title}>{t("blk.title")}</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}>
        <Text style={styles.hint}>{t("blk.hint")}</Text>

        {rows === null ? (
          <ActivityIndicator color={tint} style={{ marginTop: 24 }} />
        ) : rows.length === 0 ? (
          <Text style={styles.empty} testID="blocked-empty">{t("blk.empty")}</Text>
        ) : rows.map((r) => (
          <View key={r.lns} style={styles.row} testID="blocked-row">
            <Avatar seed={r.lns} label={r.display_name || r.lns} uri={r.avatar || undefined} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.name} numberOfLines={1}>{r.display_name || r.lns.split("@")[0]}</Text>
              <Text style={styles.lns} numberOfLines={1}>{r.lns}</Text>
            </View>
            {busy === r.lns ? <ActivityIndicator color={tint} /> : (
              <TouchableOpacity style={styles.btn} onPress={() => unblock(r)} testID="blocked-unblock-btn">
                <Ionicons name="lock-open-outline" size={16} color={tint} />
                <Text style={styles.btnTxt}>{t("blk.unblock")}</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}

        <Text style={styles.note}>{t("blk.blindNote")}</Text>
      </ScrollView>
    </View>
  );
}

const makeStyles = (tint) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  title: { color: theme.text, fontSize: 17, fontWeight: "800" },
  hint: { color: theme.textDim, fontSize: 13, lineHeight: 19, marginBottom: 14 },
  empty: { color: theme.textFaint, fontSize: 13, textAlign: "center", marginTop: 26, marginBottom: 26 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 10, marginBottom: 8 },
  name: { color: theme.text, fontSize: 14, fontWeight: "700" },
  lns: { color: theme.textFaint, fontSize: 11, marginTop: 1 },
  btn: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: tint + "66", borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8 },
  btnTxt: { color: tint, fontSize: 12, fontWeight: "800" },
  note: { color: theme.textFaint, fontSize: 11, lineHeight: 16, marginTop: 18 },
});

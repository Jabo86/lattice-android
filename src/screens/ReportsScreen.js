import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert, RefreshControl, Modal, TextInput } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import * as api from "../lib/api";
import { theme } from "../theme";

export default function ReportsScreen() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(0);
  const [all, setAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [reasonFor, setReasonFor] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (showAll) => {
    setLoading(true); setErr("");
    try {
      const r = await api.consoleReports(showAll ? "all" : "open");
      setItems(r?.items || []);
      setOpen(r?.open || 0);
    } catch (e) { setErr(api.apiErr(e)); setItems([]); }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(all); }, [load, all]));

  const close = async (it) => {
    try {
      await api.consoleReportStatus(it.id, it.status === "closed" ? "open" : "closed");
      load(all);
    } catch (e) { Alert.alert("Errore", api.apiErr(e)); }
  };

  const del = (it) => Alert.alert("Elimina segnalazione", "Eliminare definitivamente questa segnalazione?", [
    { text: "Annulla", style: "cancel" },
    {
      text: "Elimina", style: "destructive",
      onPress: async () => {
        try { await api.consoleReportDelete(it.id); load(all); }
        catch (e) { Alert.alert("Errore", api.apiErr(e)); }
      },
    },
  ]);

  const userAction = (it, action) => {
    if (action === "suspend" || action === "revoke") {
      setReasonFor({ lns: it.reported_lns, action });
      setReason("");
      return;
    }
    Alert.alert("Riattiva account", `Riattivare ${it.reported_lns}?`, [
      { text: "Annulla", style: "cancel" },
      {
        text: "Riattiva",
        onPress: async () => {
          try { await api.consoleUserStatus(it.reported_lns, "activate"); load(all); }
          catch (e) { Alert.alert("Errore", api.apiErr(e)); }
        },
      },
    ]);
  };

  const submitReason = async () => {
    const motivo = reason.trim();
    if (motivo.length < 3) { Alert.alert("Motivo mancante", "Scrivi almeno 3 caratteri: l'utente vedrà questo motivo."); return; }
    const { lns, action } = reasonFor;
    setBusy(true);
    try {
      await api.consoleUserStatus(lns, action, motivo);
      setReasonFor(null); setReason("");
      load(all);
    } catch (e) { Alert.alert("Errore", api.apiErr(e)); }
    finally { setBusy(false); }
  };

  const toggleBlock = (it) => {
    const on = !it.admin_blocked;
    Alert.alert(on ? "Blocca utente" : "Sblocca utente",
      on ? `Bloccare ${it.reported_lns}? Non sarà più ricercabile e non potrà scriverti. L'account resta attivo.` : `Sbloccare ${it.reported_lns}?`, [
        { text: "Annulla", style: "cancel" },
        {
          text: on ? "Blocca" : "Sblocca",
          onPress: async () => {
            try { await api.consoleUserBlock(it.reported_lns, on); load(all); }
            catch (e) { Alert.alert("Errore", api.apiErr(e)); }
          },
        },
      ]);
  };

  const deleteAccount = (it) => Alert.alert("Elimina account",
    `Eliminare DEFINITIVAMENTE ${it.reported_lns}?\n\nVerranno cancellati identità, chiavi, profilo, contatti, messaggi e appartenenze ai gruppi. Irreversibile.`, [
      { text: "Annulla", style: "cancel" },
      {
        text: "Elimina", style: "destructive",
        onPress: () => Alert.alert("Confermi?", "Ultima conferma: l'account e i suoi dati saranno cancellati per sempre.", [
          { text: "Annulla", style: "cancel" },
          {
            text: "Sì, elimina", style: "destructive",
            onPress: async () => {
              try { await api.consoleUserDelete(it.reported_lns); load(all); }
              catch (e) { Alert.alert("Errore", api.apiErr(e)); }
            },
          },
        ]),
      },
    ]);

  const renderItem = ({ item }) => (
    <View style={styles.card} testID="report-card">
      <View style={styles.rowTop}>
        <Text style={[styles.pill, item.kind === "user" ? styles.pillUser : styles.pillMsg]}>
          {item.kind === "user" ? "PROFILO" : "MESSAGGIO"}
        </Text>
        <Text style={[styles.pill, item.status === "closed" ? styles.pillClosed : styles.pillOpen]}>
          {item.status === "closed" ? "GESTITA" : "APERTA"}
        </Text>
      </View>
      <Text style={styles.target} numberOfLines={1}>{item.reported_lns || item.message_id}</Text>
      {!!item.user_status && item.user_status !== "ACTIVE" && (
        <Text style={[styles.pill, styles.pillUser, { alignSelf: "flex-start", marginTop: 6 }]}>{item.user_status}</Text>
      )}
      {!!item.admin_blocked && (
        <Text style={[styles.pill, styles.pillUser, { alignSelf: "flex-start", marginTop: 6 }]}>BLOCCATO</Text>
      )}
      {!!item.status_reason && <Text style={styles.meta}>motivo: {item.status_reason}</Text>}
      <Text style={styles.meta}>da {item.reporter}</Text>
      {!!item.reason && <Text style={styles.reason}>{item.reason}</Text>}
      <Text style={styles.when}>{(item.created_at || "").replace("T", " ").slice(0, 16)}</Text>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.act} onPress={() => close(item)} testID="report-toggle">
          <Ionicons name={item.status === "closed" ? "refresh-outline" : "checkmark-done-outline"} size={15} color={theme.primary} />
          <Text style={styles.actTxt}>{item.status === "closed" ? "Riapri" : "Gestita"}</Text>
        </TouchableOpacity>
        {!!item.reported_lns && (
          <TouchableOpacity style={styles.act} onPress={() => userAction(item, item.user_status === "ACTIVE" ? "suspend" : "activate")} testID="report-suspend">
            <Ionicons name={item.user_status === "ACTIVE" ? "pause-circle-outline" : "play-circle-outline"} size={15} color="#50C878" />
            <Text style={[styles.actTxt, { color: "#50C878" }]}>{item.user_status === "ACTIVE" ? "Sospendi" : "Riattiva"}</Text>
          </TouchableOpacity>
        )}
        {!!item.reported_lns && item.user_status !== "REVOKED" && (
          <TouchableOpacity style={styles.act} onPress={() => userAction(item, "revoke")} testID="report-revoke">
            <Ionicons name="close-circle-outline" size={15} color={theme.danger} />
            <Text style={[styles.actTxt, { color: theme.danger }]}>Revoca</Text>
          </TouchableOpacity>
        )}
        {!!item.reported_lns && (
          <TouchableOpacity style={styles.act} onPress={() => toggleBlock(item)} testID="report-block">
            <Ionicons name={item.admin_blocked ? "eye-outline" : "ban-outline"} size={15} color={theme.textDim} />
            <Text style={[styles.actTxt, { color: theme.textDim }]}>{item.admin_blocked ? "Sblocca" : "Blocca"}</Text>
          </TouchableOpacity>
        )}
        {!!item.reported_lns && (
          <TouchableOpacity style={styles.act} onPress={() => deleteAccount(item)} testID="report-delete-account">
            <Ionicons name="person-remove-outline" size={15} color={theme.danger} />
            <Text style={[styles.actTxt, { color: theme.danger }]}>Elimina account</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.act} onPress={() => del(item)} testID="report-delete">
          <Ionicons name="trash-outline" size={15} color={theme.textFaint} />
          <Text style={[styles.actTxt, { color: theme.textFaint }]}>Elimina</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.root} testID="reports-screen">
      <View style={styles.head}>
        <Text style={styles.count}>{open > 0 ? `${open} da gestire` : "nessuna segnalazione aperta"}</Text>
        <TouchableOpacity onPress={() => setAll((v) => !v)} style={styles.tab} testID="reports-toggle-all">
          <Text style={styles.tabTxt}>{all ? "SOLO DA GESTIRE" : "MOSTRA TUTTE"}</Text>
        </TouchableOpacity>
      </View>
      {!!err && <Text style={styles.err} testID="reports-error">{err}</Text>}
      {loading && items.length === 0 ? (
        <ActivityIndicator color={theme.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(x) => x.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(all)} tintColor={theme.primary} />}
          ListEmptyComponent={!err ? <Text style={styles.empty}>Nessuna segnalazione.</Text> : null}
        />
      )}
      <Modal visible={!!reasonFor} transparent animationType="fade" onRequestClose={() => setReasonFor(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet} testID="report-reason-modal">
            <Text style={styles.sheetTitle}>
              {reasonFor?.action === "revoke" ? "Revoca definitiva" : "Sospendi account"}
            </Text>
            <Text style={styles.sheetSub}>{reasonFor?.lns}</Text>
            <TextInput
              style={styles.sheetInput}
              value={reason}
              onChangeText={setReason}
              placeholder="Motivo (l'utente lo vedrà nella notifica e al login)"
              placeholderTextColor={theme.textFaint}
              multiline
              testID="report-reason-input"
            />
            <View style={styles.sheetActions}>
              <TouchableOpacity onPress={() => setReasonFor(null)} testID="report-reason-cancel">
                <Text style={[styles.actTxt, { color: theme.textDim }]}>Annulla</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={submitReason} disabled={busy} testID="report-reason-confirm">
                <Text style={[styles.actTxt, { color: theme.danger }]}>
                  {busy ? "Attendi…" : reasonFor?.action === "revoke" ? "Revoca" : "Sospendi"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  count: { color: "#50C878", fontSize: 12, fontWeight: "700" },
  tab: { borderWidth: 1, borderColor: theme.border, paddingHorizontal: 10, paddingVertical: 6 },
  tabTxt: { color: theme.textDim, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  card: { borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, borderRadius: 12, padding: 14, marginBottom: 12 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  pill: { fontSize: 9, fontWeight: "800", letterSpacing: 1, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 3, overflow: "hidden" },
  pillUser: { color: theme.danger, borderColor: theme.danger + "66" },
  pillMsg: { color: theme.primary, borderColor: theme.primary + "66" },
  pillOpen: { color: theme.textDim, borderColor: theme.border },
  pillClosed: { color: theme.accent, borderColor: theme.accent + "66" },
  target: { color: theme.text, fontSize: 14, fontWeight: "700" },
  meta: { color: theme.textFaint, fontSize: 12, marginTop: 2 },
  reason: { color: theme.textDim, fontSize: 13, marginTop: 8, lineHeight: 18 },
  when: { color: theme.textFaint, fontSize: 11, marginTop: 8 },
  actions: { flexDirection: "row", gap: 16, marginTop: 12, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 10 },
  act: { flexDirection: "row", alignItems: "center", gap: 6 },
  actTxt: { color: theme.primary, fontSize: 12, fontWeight: "700" },
  empty: { color: theme.textFaint, fontSize: 13, textAlign: "center", marginTop: 40 },
  err: { color: "#FFB3BD", fontSize: 13, margin: 16 },
  backdrop: { flex: 1, backgroundColor: "#000000CC", justifyContent: "center", padding: 24 },
  sheet: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 14, padding: 18 },
  sheetTitle: { color: theme.text, fontSize: 16, fontWeight: "800" },
  sheetSub: { color: theme.textFaint, fontSize: 12, marginTop: 2 },
  sheetInput: { color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, marginTop: 14, minHeight: 78, textAlignVertical: "top", fontSize: 14 },
  sheetActions: { flexDirection: "row", justifyContent: "flex-end", gap: 24, marginTop: 16 },
});

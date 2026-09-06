import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../lib/i18n";
import * as api from "../lib/api";
import { theme } from "../theme";

export default function MembersScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { lang } = useI18n();
  const it = lang !== "en";
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState([]);
  const [ownerLns, setOwnerLns] = useState("");
  const [domain, setDomain] = useState("");
  const [err, setErr] = useState("");
  // form
  const [name, setName] = useState("");
  const [display, setDisplay] = useState("");
  const [dept, setDept] = useState("");
  const [role, setRole] = useState("member");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(null); // { lns_name, keyfile, keyfile_filename }

  const load = useCallback(async () => {
    try {
      const r = await api.membersList();
      setMembers(Array.isArray(r?.members) ? r.members : []);
      setOwnerLns((r?.admin_lns || "").toLowerCase());
      setLoading(false);
    } catch (e) { setErr(api.apiErr(e)); setLoading(false); }
  }, []);
  useEffect(() => {
    api.membersPermissions().then((p) => setDomain(p?.domain || "")).catch(() => {});
    load();
  }, [load]);

  const doCreate = async () => {
    if (!name.trim() || creating) return;
    setCreating(true); setErr("");
    try {
      const r = await api.membersCreate({ name: name.trim(), display_name: display.trim() || undefined, department: dept.trim() || undefined, role });
      setCreated(r);
      setName(""); setDisplay(""); setDept(""); setRole("member");
      load();
    } catch (e) { setErr(api.apiErr(e)); }
    finally { setCreating(false); }
  };

  const shareKeyfile = async () => {
    if (!created?.keyfile) return;
    try {
      const fn = (created.keyfile_filename || `lattice-key-${created.lns_name}.json`).replace(/[^\w.\-]/g, "_");
      const uri = FileSystem.cacheDirectory + fn;
      await FileSystem.writeAsStringAsync(uri, JSON.stringify(created.keyfile, null, 2), { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/json", dialogTitle: it ? "Consegna il file chiave" : "Deliver the keyfile" });
      else Alert.alert(it ? "File salvato" : "File saved", uri);
    } catch (e) { Alert.alert("Keyfile", String((e && e.message) || e)); }
  };

  const toggleRevoke = (m) => {
    const reactivate = m.status === "REVOKED";
    Alert.alert(
      reactivate ? (it ? "Riattiva membro" : "Reactivate member") : (it ? "Revoca membro" : "Revoke member"),
      m.lns_name,
      [
        { text: it ? "Annulla" : "Cancel", style: "cancel" },
        {
          text: reactivate ? (it ? "Riattiva" : "Reactivate") : (it ? "Revoca" : "Revoke"),
          style: reactivate ? "default" : "destructive",
          onPress: async () => { try { await api.membersRevoke(m.lns_name, reactivate); load(); } catch (e) { Alert.alert("Errore", api.apiErr(e)); } },
        },
      ]
    );
  };

  return (
    <View style={[st.root, { paddingTop: insets.top }]}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} testID="members-back" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back-outline" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={st.title}>{it ? "Iscrizioni / Membri" : "Members"}</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* FORM NUOVO MEMBRO */}
        <Text style={st.section}>{it ? "Nuovo membro" : "New member"}</Text>
        <View style={st.card}>
          <Text style={st.lbl}>{it ? "Nome (parte prima di @)" : "Name (local part)"}</Text>
          <View style={st.inputRow}>
            <TextInput value={name} onChangeText={setName} placeholder={it ? "es. mario.rossi" : "e.g. john.doe"} placeholderTextColor={theme.textFaint}
              autoCapitalize="none" style={st.input} testID="members-name-input" />
            {!!domain && <Text style={st.domain}>@{domain}</Text>}
          </View>
          <Text style={st.lbl}>{it ? "Nome visualizzato (opzionale)" : "Display name (optional)"}</Text>
          <TextInput value={display} onChangeText={setDisplay} placeholder={it ? "Mario Rossi" : "John Doe"} placeholderTextColor={theme.textFaint} style={st.input} testID="members-display-input" />
          <Text style={st.lbl}>{it ? "Reparto (opzionale)" : "Department (optional)"}</Text>
          <TextInput value={dept} onChangeText={setDept} placeholder="Operations" placeholderTextColor={theme.textFaint} style={st.input} testID="members-dept-input" />
          <Text style={st.lbl}>{it ? "Ruolo" : "Role"}</Text>
          <View style={st.roleRow}>
            {["member", "admin"].map((r) => (
              <TouchableOpacity key={r} onPress={() => setRole(r)} style={[st.roleChip, role === r && st.roleChipOn]} testID={`members-role-${r}`}>
                <Text style={[st.roleTxt, role === r && st.roleTxtOn]}>{r === "admin" ? "Admin" : (it ? "Membro" : "Member")}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {!!err && <Text style={st.err} testID="members-error">{err}</Text>}
          <TouchableOpacity style={[st.createBtn, (!name.trim() || creating) && { opacity: 0.5 }]} disabled={!name.trim() || creating} onPress={doCreate} testID="members-create-btn">
            {creating ? <ActivityIndicator color="#fff" /> : <Text style={st.createTxt}>{it ? "Crea e genera chiave" : "Create & generate key"}</Text>}
          </TouchableOpacity>
          <Text style={st.note}>{it ? "🔐 La chiave è temporanea: il nuovo membro dovrà crearne una definitiva al primo accesso." : "🔐 The key is temporary: the new member must create a definitive one on first login."}</Text>
        </View>

        {/* ELENCO MEMBRI */}
        <Text style={[st.section, { marginTop: 22 }]}>{it ? `Iscritti (${members.length})` : `Members (${members.length})`}</Text>
        {loading ? <ActivityIndicator color={theme.primary} style={{ marginTop: 20 }} /> : (
          <View style={st.card}>
            {members.length === 0 && <Text style={st.empty}>{it ? "Nessun membro." : "No members."}</Text>}
            {members.map((m, i) => (
              <View key={m.lns_name} style={[st.mRow, i > 0 && st.mDivider]} testID={`member-row-${m.lns_name}`}>
                <View style={{ flex: 1 }}>
                  <Text style={st.mName} numberOfLines={1}>{m.display_name || m.lns_name.split("@")[0]}</Text>
                  <Text style={st.mLns} numberOfLines={1}>{m.lns_name}</Text>
                  <View style={st.badges}>
                    {m.is_owner && <Text style={[st.badge, st.bOwner]}>{it ? "Owner" : "Owner"}</Text>}
                    {m.role === "admin" && !m.is_owner && <Text style={[st.badge, st.bAdmin]}>Admin</Text>}
                    <Text style={[st.badge, m.status === "REVOKED" ? st.bRevoked : st.bActive]}>{m.status === "REVOKED" ? (it ? "Revocato" : "Revoked") : (it ? "Attivo" : "Active")}</Text>
                    {m.must_rotate && m.status !== "REVOKED" && <Text style={[st.badge, st.bPending]}>{it ? "Chiave temp." : "Temp key"}</Text>}
                  </View>
                </View>
                {!m.is_owner && m.lns_name.toLowerCase() !== (user?.lns || "").toLowerCase() && (
                  <TouchableOpacity onPress={() => toggleRevoke(m)} style={st.revBtn} testID={`member-revoke-${m.lns_name}`}>
                    <Ionicons name={m.status === "REVOKED" ? "refresh" : "ban"} size={20} color={m.status === "REVOKED" ? theme.primary : theme.danger} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* MODALE KEYFILE (consegna una-tantum) */}
      <Modal visible={!!created} transparent animationType="fade" onRequestClose={() => setCreated(null)}>
        <View style={st.mask}>
          <View style={st.sheet}>
            <Ionicons name="key-outline" size={34} color={theme.primary} style={{ alignSelf: "center" }} />
            <Text style={st.sheetTitle}>{it ? "Identità creata" : "Identity created"}</Text>
            <Text style={st.sheetLns}>{created?.lns_name}</Text>
            <Text style={st.sheetWarn}>{it
              ? "⚠️ Consegna questo file chiave al nuovo membro ORA. Non sarà più recuperabile: si vede una sola volta."
              : "⚠️ Deliver this keyfile to the new member NOW. It cannot be retrieved again: shown only once."}</Text>
            <TouchableOpacity style={st.shareBtn} onPress={shareKeyfile} testID="members-share-keyfile">
              <Ionicons name="share-outline" size={18} color="#fff" />
              <Text style={st.shareTxt}>{it ? "Condividi / Salva file chiave" : "Share / Save keyfile"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.doneBtn} onPress={() => setCreated(null)} testID="members-keyfile-done">
              <Text style={st.doneTxt}>{it ? "Ho consegnato la chiave" : "I delivered the key"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 10, borderBottomColor: theme.border, borderBottomWidth: 1 },
  title: { color: theme.text, fontSize: 18, fontWeight: "800" },
  section: { color: theme.textDim, fontSize: 13, fontWeight: "700", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 },
  card: { backgroundColor: theme.surface, borderRadius: 14, padding: 14, borderColor: theme.border, borderWidth: 1 },
  lbl: { color: theme.textDim, fontSize: 12, fontWeight: "600", marginBottom: 5, marginTop: 8 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  input: { flex: 1, backgroundColor: "transparent", borderRadius: 10, borderColor: theme.border, borderWidth: 1, color: theme.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  domain: { color: theme.textDim, fontSize: 14, fontWeight: "600" },
  roleRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  roleChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderColor: theme.border, borderWidth: 1, backgroundColor: "transparent" },
  roleChipOn: { backgroundColor: theme.primary, borderColor: theme.primary },
  roleTxt: { color: theme.textDim, fontWeight: "700", fontSize: 13 },
  roleTxtOn: { color: "#fff" },
  createBtn: { backgroundColor: theme.primary, borderRadius: 12, paddingVertical: 13, alignItems: "center", marginTop: 16 },
  createTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },
  note: { color: theme.textFaint, fontSize: 11, marginTop: 10, lineHeight: 16 },
  err: { color: theme.danger, fontSize: 13, marginTop: 10 },
  empty: { color: theme.textFaint, fontSize: 14, textAlign: "center", paddingVertical: 16 },
  mRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, gap: 10 },
  mDivider: { borderTopColor: theme.border, borderTopWidth: 1 },
  mName: { color: theme.text, fontSize: 15, fontWeight: "700" },
  mLns: { color: theme.textFaint, fontSize: 12, marginTop: 1 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  badge: { fontSize: 10, fontWeight: "800", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: "hidden" },
  bOwner: { backgroundColor: "#7c3aed", color: "#fff" },
  bAdmin: { backgroundColor: "#0b3a66", color: "#cfe4ff" },
  bActive: { backgroundColor: "#123a24", color: "#7ee2a8" },
  bRevoked: { backgroundColor: "#4a1520", color: "#ff9aa8" },
  bPending: { backgroundColor: "#3a2f0b", color: "#ffcf6a" },
  revBtn: { padding: 8 },
  mask: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 24 },
  sheet: { backgroundColor: theme.surface, borderRadius: 18, padding: 20, borderColor: theme.border, borderWidth: 1 },
  sheetTitle: { color: theme.text, fontSize: 18, fontWeight: "800", textAlign: "center", marginTop: 8 },
  sheetLns: { color: theme.primary, fontSize: 14, fontWeight: "700", textAlign: "center", marginTop: 4 },
  sheetWarn: { color: theme.textDim, fontSize: 13, lineHeight: 19, marginTop: 14, textAlign: "center" },
  shareBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: theme.primary, borderRadius: 12, paddingVertical: 13, marginTop: 18 },
  shareTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },
  doneBtn: { paddingVertical: 12, alignItems: "center", marginTop: 6 },
  doneTxt: { color: theme.textDim, fontWeight: "700", fontSize: 14 },
});

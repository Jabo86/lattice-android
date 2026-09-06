import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";
import { useAuth } from "../context/AuthContext";
import * as api from "../lib/api";
import { addSelfKeys, decryptAny } from "../lib/devices";
import { packMessage, encryptForRecipients, bytesToHex } from "../lib/crypto";

export default function ForwardScreen({ route, navigation }) {
  const { user } = useAuth();
  const { text = "", atts = [] } = route.params || {};
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sendingTo, setSendingTo] = useState(null);

  useEffect(() => {
    (async () => {
      try { const c = await api.contacts(); setList(Array.isArray(c) ? c : []); }
      catch { setList([]); }
      finally { setLoading(false); }
    })();
  }, []);

  const forwardTo = async (lns) => {
    if (!user?.kem || sendingTo) return;
    setSendingTo(lns);
    try {
      const keyMap = await api.pulseKeys([lns]);
      await addSelfKeys(keyMap, user); // BLOCCO A: usa-e-getta anche per le mie copie
      if (!keyMap[lns]) throw new Error("Chiave destinatario non trovata");
      const payload = packMessage(text || "", atts || [], null, 0);
      const envelopes = encryptForRecipients(payload, keyMap);
      await api.send({ to_lns: [lns], envelopes });
      Alert.alert("✓", `Inoltrato a ${lns.split("@")[0]}`, [{ text: "OK", onPress: () => navigation.goBack() }]);
    } catch (e) { Alert.alert("Errore", api.apiErr(e)); setSendingTo(null); }
  };

  const renderItem = ({ item }) => {
    const lns = item.lns || item.contact_lns || item.name;
    const disp = (item.display_name || item.name || lns || "").split("@")[0];
    return (
      <TouchableOpacity style={styles.row} onPress={() => forwardTo(lns)} disabled={!!sendingTo} testID={`forward-to-${lns}`}>
        <View style={styles.avatar}><Text style={styles.avatarTxt}>{(disp[0] || "?").toUpperCase()}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{disp}</Text>
          <Text style={styles.lns} numberOfLines={1}>{lns}</Text>
        </View>
        {sendingTo === lns ? <ActivityIndicator color={theme.primary} /> : <Ionicons name="send-outline" size={18} color={theme.primary} />}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} testID="forward-back" style={{ padding: 4 }}><Ionicons name="chevron-back-outline" size={26} color={theme.text} /></TouchableOpacity>
        <Text style={styles.hTitle}>Inoltra a…</Text>
      </View>
      <View style={styles.preview}><Text style={styles.previewTxt} numberOfLines={2}>{text ? text : (atts?.length ? `📎 ${atts.length} allegato/i` : "Messaggio")}</Text></View>
      {loading ? <ActivityIndicator color={theme.primary} style={{ marginTop: 30 }} /> : (
        <FlatList
          data={list}
          keyExtractor={(i, idx) => (i.lns || i.name || String(idx))}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 12 }}
          ListEmptyComponent={<Text style={styles.empty}>Nessun contatto</Text>}
          testID="forward-list"
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border },
  hTitle: { color: theme.text, fontSize: 20, fontWeight: "800", marginLeft: 4 },
  preview: { padding: 12, backgroundColor: theme.surface, borderBottomWidth: 1, borderBottomColor: theme.border },
  previewTxt: { color: theme.textDim, fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, backgroundColor: theme.surface, marginBottom: 8, borderWidth: 1, borderColor: theme.border },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: "#fff", fontWeight: "800", fontSize: 16 },
  name: { color: theme.text, fontSize: 15, fontWeight: "700" },
  lns: { color: theme.textFaint, fontSize: 12, marginTop: 1 },
  empty: { color: theme.textDim, textAlign: "center", marginTop: 40 },
});

// IL MIO QR — il codice da far inquadrare per aggiungersi a vicenda, e il lettore che
// aggiunge il contatto e lo segna verificato quando l'impronta combacia.
// La foto la scatta la fotocamera di sistema e viene letta e buttata qui sul telefono.
import React, { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, TextInput, InteractionManager,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../lib/i18n";
import { useTint } from "../lib/appearance";
import { theme } from "../theme";
import QrCode from "../components/QrCode";
import QrScanner from "../components/QrScanner";
import * as api from "../lib/api";
import { myFingerprint, peerFingerprint, parseQr, qrPayload, setVerified } from "../lib/verify";

export default function MyQrScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const tint = useTint();
  const styles = React.useMemo(() => makeStyles(tint), [tint]);
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const en = lang === "en";
  const [myFp, setMyFp] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      try { setMyFp(myFingerprint(user)); } catch { /* si vede il posto vuoto del QR */ }
    });
    return () => { try { task && task.cancel && task.cancel(); } catch { /* niente */ } };
  }, [user]);

  const handle = async (raw) => {
    const parsed = parseQr(raw);
    if (!parsed) { Alert.alert(t("qr.bad")); return; }
    if (parsed.lns === String(user?.lns || "").toLowerCase()) { Alert.alert(t("qr.self")); return; }
    setBusy(true);
    try {
      await api.addContact(parsed.lns);
      let ok = false;
      try {
        const p = await peerFingerprint(parsed.lns);
        ok = p.fp.slice(0, 40) === parsed.fp40;
        if (ok) await setVerified(parsed.lns, p.fp, "qr");
      } catch { /* chiavi non disponibili adesso: verifica da rifare a voce */ }
      const name = parsed.lns.split("@")[0];
      setCode("");
      Alert.alert(
        ok ? t("vfy.done") : t("vfy.title"),
        ok ? t("qr.added", { name }) : t("qr.addedUnverified", { name }),
        ok ? [{ text: "OK" }] : [
          { text: t("vfy.later"), style: "cancel" },
          { text: t("vfy.now"), onPress: () => navigation.navigate("VerifyContact", { peer: parsed.lns, peer_name: name }) },
        ],
      );
    } catch (e) { Alert.alert("Errore", api.apiErr(e)); }
    finally { setBusy(false); }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} testID="myqr-back" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back-outline" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.title}>{t("qr.mine")}</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}>
        <View style={styles.qrBox}>
          <QrCode value={myFp ? qrPayload(user?.lns, myFp) : ""} size={236} testID="myqr-code" />
          <Text style={styles.lns}>{user?.lns}</Text>
          <Text style={styles.hint}>{t("qr.mineHint")}</Text>
        </View>

        <Text style={styles.sect}>{t("qr.scan")}</Text>
        <Text style={styles.hint}>{t("qr.scanHint")}</Text>

        <View style={{ marginTop: 12 }}>
          <QrScanner
            tint={tint}
            label={t("qr.scan")}
            hint={en ? "Camera → add and verify" : "Fotocamera → aggiunge e verifica"}
            onCode={handle}
            onFail={(why) => Alert.alert(why === "perm" ? (en ? "Camera permission denied" : "Permesso fotocamera negato") : t("qr.bad"))}
            testID="myqr-scan"
          />
        </View>

        <View style={styles.pasteRow}>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            placeholder={t("qr.paste")}
            placeholderTextColor={theme.textFaint}
            autoCapitalize="none"
            selectionColor={tint}
            testID="myqr-paste"
          />
          <TouchableOpacity style={styles.checkBtn} onPress={() => handle(code)} disabled={busy || !code.trim()} testID="myqr-check">
            {busy ? <ActivityIndicator color="#04150B" /> : <Text style={styles.checkTxt}>{t("qr.check")}</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (tint) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  title: { color: theme.text, fontSize: 17, fontWeight: "800" },
  qrBox: { alignItems: "center", borderWidth: 1, borderColor: theme.border, borderRadius: 16, paddingVertical: 20, paddingHorizontal: 16, marginBottom: 22 },
  lns: { color: tint, fontSize: 13, fontWeight: "700", marginTop: 14 },
  hint: { color: theme.textDim, fontSize: 12, lineHeight: 18, marginTop: 6, textAlign: "center" },
  sect: { color: theme.text, fontSize: 13, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" },
  pasteRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, color: theme.text, fontSize: 13 },
  checkBtn: { backgroundColor: "#50C878", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12 },
  checkTxt: { color: "#04150B", fontSize: 13, fontWeight: "800" },
});

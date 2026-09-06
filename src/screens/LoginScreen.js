import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView, Alert, Image,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../lib/i18n";
import { UI_LANGS } from "../lib/locales";
import * as api from "../lib/api";
import { loadServer } from "../lib/store";
import { theme } from "../theme";

export default function LoginScreen({ navigation }) {
  const { signIn } = useAuth();
  const { t, lang, setLang } = useI18n();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [pasted, setPasted] = useState("");
  const [showServer, setShowServer] = useState(false);
  const [server, setServer] = useState(api.getServerUrl());

  useEffect(() => { loadServer().then((s) => { if (s) setServer(s); }); }, []);

  const doSignIn = async (obj) => {
    setBusy(true); setErr("");
    try { await signIn(obj, { server }); }
    catch (e) { setErr(e?.message || t("login.failed")); }
    finally { setBusy(false); }
  };

  const pickFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ["application/json", "*/*"], copyToCacheDirectory: true });
      if (res.canceled) return;
      const uri = res.assets?.[0]?.uri;
      if (!uri) return;
      let content;
      try { content = await (await fetch(uri)).text(); }
      catch { const FileSystem = await import("expo-file-system/legacy"); content = await FileSystem.readAsStringAsync(uri); }
      await doSignIn(JSON.parse(content));
    } catch {
      Alert.alert(t("login.error"), t("login.readfail"));
    }
  };

  const usePasted = async () => {
    try { await doSignIn(JSON.parse(pasted.trim())); }
    catch { setErr(t("login.badjson")); }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.langTop}>
          {UI_LANGS.map((l) => (
            <TouchableOpacity key={l.code} onPress={() => setLang(l.code)} testID={`login-lang-${l.code}`} style={[styles.langChip, lang === l.code && styles.langChipActive]}>
              <Text style={[styles.langChipText, lang === l.code && styles.langChipTextActive]}>{l.code.toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.brand}>
          <Image source={require("../../assets/lattice-logo.png")} style={styles.logo} resizeMode="contain" />
          <Text style={styles.brandTitle}>Lattice</Text>
          <Text style={styles.brandSub}>SOVEREIGN MESSAGING</Text>
        </View>

        <Text style={styles.subtitle}>{t("login.subtitle")}</Text>

        {!!err && <View style={styles.errBox}><Text style={styles.errText} testID="login-error">{err}</Text></View>}

        <TouchableOpacity style={styles.primaryBtn} onPress={pickFile} disabled={busy} testID="login-import-key">
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>{t("login.import")}</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setShowPaste((v) => !v)} testID="login-toggle-paste">
          <Text style={styles.linkText}>{showPaste ? t("login.hide") : t("login.paste")}</Text>
        </TouchableOpacity>

        {showPaste && (
          <View style={{ width: "100%" }}>
            <TextInput
              style={styles.paste}
              placeholder='{ "lns_name": "...", "secret_key_hex": "..." }'
              placeholderTextColor={theme.textFaint}
              multiline value={pasted} onChangeText={setPasted}
              testID="login-paste-input" autoCapitalize="none" autoCorrect={false}
            />
            <TouchableOpacity style={styles.secondaryBtn} onPress={usePasted} disabled={busy} testID="login-paste-submit">
              <Text style={styles.secondaryBtnText}>{t("login.signin")}</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.sep}><View style={styles.sepLine} /><Text style={styles.sepTxt}>{lang === "en" ? "OR" : "OPPURE"}</Text><View style={styles.sepLine} /></View>

        <TouchableOpacity style={styles.secondaryBtn} onPress={() => navigation.navigate("Signup")} disabled={busy} testID="login-create-personal">
          <Text style={styles.secondaryBtnText}>{lang === "en" ? "Create a personal account" : "Crea un account personale"}</Text>
        </TouchableOpacity>
        <Text style={styles.personalHint}>
          {lang === "en" ? "username@lattice.lns · keys generated on this device" : "username@lattice.lns · chiavi generate su questo dispositivo"}
        </Text>

        <TouchableOpacity style={styles.secondaryBtn} onPress={() => navigation.navigate("Backup")} disabled={busy} testID="login-restore-backup">
          <Text style={styles.secondaryBtnText}>{lang === "en" ? "Restore from an encrypted backup" : "Ripristina da un backup cifrato"}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setShowServer((v) => !v)} testID="login-toggle-server" style={{ marginTop: 6 }}>
          <Text style={styles.serverLink}>{t("login.server")}</Text>
        </TouchableOpacity>
        {showServer && (
          <View style={{ width: "100%" }}>
            <TextInput
              style={styles.serverInput}
              placeholder="https://server.tuazienda.it"
              placeholderTextColor={theme.textFaint}
              value={server}
              onChangeText={(tx) => { setServer(tx); api.setServerUrl(tx); }}
              autoCapitalize="none" autoCorrect={false} keyboardType="url"
              testID="login-server-input"
            />
            <Text style={styles.serverHint}>{t("login.server.hint")}</Text>
          </View>
        )}

        <View style={styles.footer}>
          <Text style={styles.footerText}>🔒 NIST FIPS 203/204 · Post-Quantum E2EE</Text>
          <Text style={styles.footerServer} numberOfLines={1}>{server}</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  scroll: { flexGrow: 1, padding: 28, justifyContent: "center" },
  langTop: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8, marginBottom: 4 },
  langChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: theme.border },
  langChipActive: { borderColor: theme.primary, backgroundColor: "rgba(80,200,120,0.15)" },
  langChipText: { color: theme.textDim, fontSize: 12, fontWeight: "800" },
  langChipTextActive: { color: theme.text },
  brand: { alignItems: "center", marginBottom: 26 },
  logo: { width: 92, height: 92, marginBottom: 14 },
  brandTitle: { color: theme.text, fontSize: 40, fontWeight: "900", letterSpacing: 0.5 },
  brandSub: { color: theme.textDim, fontSize: 11, letterSpacing: 3, fontWeight: "700", marginTop: 4 },
  subtitle: { color: theme.textDim, fontSize: 15, lineHeight: 22, marginBottom: 28, textAlign: "center" },
  errBox: { backgroundColor: "#3A1420", borderColor: theme.danger, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 16 },
  errText: { color: "#FFB3BD", fontSize: 13, textAlign: "center" },
  primaryBtn: { backgroundColor: theme.primary, borderRadius: 14, paddingVertical: 17, alignItems: "center", marginBottom: 16 },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  linkText: { color: theme.primary, fontSize: 14, textAlign: "center", fontWeight: "600", marginBottom: 12 },
  paste: { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 12, color: theme.text, padding: 14, minHeight: 110, textAlignVertical: "top", fontSize: 12, marginBottom: 12 },
  secondaryBtn: { backgroundColor: theme.surfaceAlt, borderColor: theme.border, borderWidth: 1, borderRadius: 14, paddingVertical: 15, alignItems: "center", marginBottom: 6 },
  secondaryBtnText: { color: theme.text, fontSize: 15, fontWeight: "700" },
  serverLink: { color: theme.textDim, fontSize: 13, textAlign: "center", fontWeight: "600" },
  sep: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 14 },
  sepLine: { flex: 1, height: 1, backgroundColor: theme.border },
  sepTxt: { color: theme.textFaint, fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  personalHint: { color: theme.textFaint, fontSize: 11, textAlign: "center", marginBottom: 12 },
  serverInput: { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 12, color: theme.text, paddingHorizontal: 14, paddingVertical: 13, fontSize: 14, marginTop: 10 },
  serverHint: { color: theme.textFaint, fontSize: 12, lineHeight: 17, marginTop: 8 },
  footer: { marginTop: 40, alignItems: "center" },
  footerText: { color: theme.textFaint, fontSize: 12 },
  footerServer: { color: theme.textFaint, fontSize: 11, marginTop: 6, maxWidth: 280 },
});

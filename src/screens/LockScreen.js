import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator } from "react-native";
import { authenticate } from "../lib/biometrics";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../lib/i18n";
import { theme } from "../theme";

export default function LockScreen() {
  const { unlock, signOut } = useAuth();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const tryUnlock = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    const ok = await authenticate(t("lock.prompt"));
    if (ok) unlock();
    else setFailed(true);
    setBusy(false);
  }, [unlock, t]);

  useEffect(() => { tryUnlock(); }, [tryUnlock]);

  return (
    <View style={styles.root} testID="lock-screen">
      <Image source={require("../../assets/lattice-logo.png")} style={styles.logo} resizeMode="contain" />
      <Text style={styles.title}>{t("lock.title")}</Text>
      <Text style={styles.sub}>{t("lock.sub")}</Text>

      {busy ? (
        <ActivityIndicator color={theme.primary} size="large" style={{ marginTop: 28 }} />
      ) : (
        <TouchableOpacity style={styles.btn} onPress={tryUnlock} testID="lock-unlock-btn">
          <Text style={styles.btnText}>{failed ? t("lock.retry") : t("lock.unlock")}</Text>
        </TouchableOpacity>
      )}

      {failed && (
        <TouchableOpacity onPress={signOut} style={{ marginTop: 18 }} testID="lock-signout-btn">
          <Text style={styles.link}>{t("lock.signout")}</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.footer}>🔒 NIST FIPS 203/204 · Post-Quantum E2EE</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent", alignItems: "center", justifyContent: "center", padding: 32 },
  logo: { width: 88, height: 88, marginBottom: 22 },
  title: { color: theme.text, fontSize: 24, fontWeight: "900", marginBottom: 8 },
  sub: { color: theme.textDim, fontSize: 14, lineHeight: 20, textAlign: "center", maxWidth: 300 },
  btn: { backgroundColor: theme.primary, borderRadius: 14, paddingVertical: 15, paddingHorizontal: 40, marginTop: 30 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  link: { color: theme.textDim, fontSize: 13, fontWeight: "600" },
  footer: { position: "absolute", bottom: 40, color: theme.textFaint, fontSize: 12 },
});

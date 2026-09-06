// Banner di aggiornamento: appare in alto quando sul server c'è una versione più nuova.
import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { theme } from "../theme";
import { useI18n } from "../lib/i18n";
import { checkUpdate, downloadAndInstall } from "../lib/update";
import { suppressLock } from "../lib/lockGuard";

const LAST_KEY = "lattice.update.lastcheck.v1";

export const UpdateBanner = () => {  const { lang } = useI18n();
  const en = lang === "en";
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState("");
  const [hidden, setHidden] = useState(false);
  // ATTENZIONE: TUTTI gli hook stanno QUI, prima di qualsiasi return.
  // Questo useState era sotto il `return null` e faceva crashare l'intera app appena il
  // server segnalava un aggiornamento ("Rendered more hooks than during the previous
  // render"): React vietava la chiamata in più. Controllato da qa_hooks_check.js.
  const [phase, setPhase] = useState("download");

  useEffect(() => {
    let alive = true;
    // Un solo controllo all'ora: il banner si monta a ogni ritorno all'elenco chat.
    AsyncStorage.getItem(LAST_KEY).then((v) => {
      if (!alive) return;
      if (v && Date.now() - Number(v) < 3600000) return;
      AsyncStorage.setItem(LAST_KEY, String(Date.now())).catch(() => {});
      checkUpdate().then((r) => { if (alive && r.available) setInfo(r); }).catch(() => {});
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const install = async () => {
    if (!info || hidden) return;
    setPhase("download");
    setBusy(true); setErr(""); setPct(0);
    suppressLock();
    try {
      await downloadAndInstall(info, (p, phase) => { setPct(p); setPhase(phase || "download"); });
      suppressLock();
    } catch (e) {
      setErr(en ? "Update failed: open lattice-network.it/downloads to install it manually." : "Aggiornamento non riuscito: apri lattice-network.it/downloads per installarlo a mano.");
    } finally { setBusy(false); }
  };

  // Nessun hook sotto questa riga.
  if (!info || hidden) return null;

  return (
    <View style={s.wrap} testID="update-banner">
      <Ionicons name="cloud-download-outline" size={20} color={theme.primary} />
      <View style={{ flex: 1 }}>
        <Text style={s.title}>
          {(en ? "Update available: " : "Aggiornamento disponibile: ") + "v" + info.version}
        </Text>
        <Text style={s.sub} numberOfLines={2}>
          {busy
            ? (phase === "verify"
                ? (en ? "Verifying signature… " : "Verifica della firma… ")
                : (en ? "Downloading… " : "Scarico… ")) + Math.round(pct * 100) + "%"
            : err || (en ? "Installs over the current app, nothing to uninstall." : "Si installa sopra l'app attuale, non devi disinstallare niente.")}
        </Text>
      </View>
      {busy ? (
        <ActivityIndicator color={theme.primary} />
      ) : (
        <>
          <TouchableOpacity style={s.btn} onPress={install} testID="update-now-btn">
            <Text style={s.btnTxt}>{en ? "UPDATE" : "AGGIORNA"}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setHidden(true)} testID="update-dismiss-btn" hitSlop={8}>
            <Ionicons name="close-outline" size={18} color={theme.textFaint} />
          </TouchableOpacity>
        </>
      )}
    </View>
  );
};

const s = StyleSheet.create({
  wrap: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: theme.surface, borderBottomWidth: 1, borderBottomColor: theme.border,
    paddingHorizontal: 14, paddingVertical: 11,
  },
  title: { color: theme.text, fontSize: 13, fontWeight: "800" },
  sub: { color: theme.textFaint, fontSize: 11, marginTop: 2, lineHeight: 15 },
  btn: { borderWidth: 1, borderColor: theme.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  btnTxt: { color: theme.primary, fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
});

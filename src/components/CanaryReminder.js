import React, { useEffect, useState, useCallback } from "react";
import { View, Text, Animated, Easing, StyleSheet, Platform, Pressable, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";
import { alpha } from "./Surface";
import { useI18n } from "../lib/i18n";
import * as canary from "../lib/canary";

// Promemoria del canarino, visibile SOLO all'owner.
//
// Perche in v2.3.3 non si vedeva: non era questo file. `isOwner()` confrontava l'indirizzo
// con `OWNER_LNS`, che puntava a un account non piu in uso: sempre falso, quindi la striscia
// si toglieva da se e nessuna notifica di scadenza e' mai partita. Ora l'owner e' un elenco
// (`OWNER_LNS_LIST` in config.js).
//
// SMERALDO SEMPRE. Non segue il colore d'accento scelto: il canarino e' l'unico posto
// dell'app dove il colore e' informazione e non gusto. Se l'owner mette l'app in rosso
// rubino, un avviso rubino si perde nel resto; smeraldo su nero e' la cosa piu forte che
// esista nel tema, e resta riconoscibile qualunque tinta sia attiva.
const SMERALDO = "#50C878";

export default function CanaryReminder({ user, t }) {
  const { lang } = useI18n();
  const [s, setS] = useState(null);
  const [mode, setMode] = useState("always");
  const pulse = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let alive = true;
    if (!canary.isOwner(user)) return undefined;
    canary.stripMode().then((m) => alive && setMode(m)).catch(() => {});
    canary.status().then((r) => alive && setS(r)).catch(() => {});
    return () => { alive = false; };
  }, [user]);

  const urgente = !!s && (s.state === "alarm" || (s.daysLeft != null && s.daysLeft <= 3));
  const mostra = canary.isOwner(user) && canary.shouldShow(s, mode);

  useEffect(() => {
    if (!mostra) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [mostra, pulse]);

  // Toccandola si scegli come deve comportarsi: nessuna costante da ricompilare.
  const scegliModo = useCallback(() => {
    const it = lang !== "en";
    Alert.alert(
      it ? "Striscia del canarino" : "Canary strip",
      it
        ? "Adesso e' SEMPRE visibile, cosi puoi giudicarla. Vuoi che compaia da sola solo quando serve (14, 10, 7, 5, 3, 2, 1 e 0 giorni dalla scadenza, e subito in caso di allarme)?"
        : "It is currently ALWAYS visible so you can judge it. Do you want it to appear on its own only when needed (14, 10, 7, 5, 3, 2, 1 and 0 days before expiry, and immediately on alarm)?",
      [
        { text: it ? "Lasciala sempre" : "Keep it always", style: "cancel", onPress: () => canary.setStripMode("always").then(setMode) },
        { text: it ? "A comparsa automatica" : "Automatic", onPress: () => canary.setStripMode("auto").then(setMode) },
      ]
    );
  }, [lang]);

  if (!mostra) return null;

  return (
    <Animated.View
      style={[
        styles.wrap,
        urgente
          ? { backgroundColor: SMERALDO, ...(Platform.OS === "android" ? { elevation: 4 } : {}) }
          : { borderWidth: 1, borderColor: alpha(SMERALDO, 0.55), backgroundColor: alpha(SMERALDO, 0.1) },
        { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, urgente ? 0.8 : 0.94] }) },
      ]}
      testID="canary-reminder"
    >
      <Pressable style={styles.press} onPress={scegliModo} testID="canary-reminder-mode">
        <Ionicons
          name={urgente ? "alert-circle-outline" : "time-outline"}
          size={18}
          color={urgente ? "#000" : SMERALDO}
        />
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, urgente && styles.onFill]} testID="canary-reminder-title">
            {s.state === "alarm" ? t("canary.remind.alarm") : t("canary.remind.title")}
          </Text>
          <Text style={[styles.body, urgente && styles.onFillDim]} testID="canary-reminder-body">
            {s.state === "alarm"
              ? (s.reason || "")
              : t("canary.remind.body", { date: s.expiresAt, n: s.daysLeft })}
          </Text>
          <Text selectable style={[styles.how, { color: SMERALDO }, urgente && styles.onFillDim]} testID="canary-reminder-how">
            {t("canary.remind.how")}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: 14, marginTop: 10, borderRadius: 14, overflow: "hidden" },
  press: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 13 },
  title: { color: theme.text, fontSize: 13.5, fontWeight: "800" },
  body: { color: theme.textDim, fontSize: 12, marginTop: 3 },
  how: { fontSize: 11.5, fontWeight: "700", marginTop: 7, textDecorationLine: "underline" },
  onFill: { color: "#000" },
  onFillDim: { color: "#062012" },
});

// FORZA DEL PIN (app) — la stessa aritmetica della versione web, con i numeri del
// rapporto Red Team: 353 ms per tentativo misurati sulla derivazione vera dell'app.
// Nessuna stellina: il tempo che serve a indovinarlo, scritto.
import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLook } from "../lib/appearance";
import { useI18n } from "../lib/i18n";

export const SEC_PER_TRY = 0.353;

export function crackSeconds(digits, cores) {
  if (!digits) return 0;
  return (Math.pow(10, digits) * SEC_PER_TRY) / cores;
}

export function humanTime(s, en) {
  if (!isFinite(s) || s <= 0) return t("pin.instant");
  const U = en
    ? [[31557600, "year", "years"], [2629800, "month", "months"], [86400, "day", "days"], [3600, "hour", "hours"], [60, "minute", "minutes"], [1, "second", "seconds"]]
    : [[31557600, "anno", "anni"], [2629800, "mese", "mesi"], [86400, "giorno", "giorni"], [3600, "ora", "ore"], [60, "minuto", "minuti"], [1, "secondo", "secondi"]];
  for (const [size, one, many] of U) {
    if (s >= size) {
      const n = s / size;
      const v = n >= 100 ? Math.round(n) : n >= 10 ? Math.round(n * 10) / 10 : Math.round(n * 100) / 100;
      if (v >= 1e6) return (t("pin.overMillion")) + many;
      const num = en ? String(v) : String(v).replace(".", ",");
      return `${num} ${v === 1 ? one : many}`;
    }
  }
  return t("pin.underSecond");
}

export function pinVerdict(d) {
  if (d < 4) return "short";
  if (d <= 5) return "weak";
  if (d <= 7) return "fair";
  if (d <= 9) return "good";
  return "strong";
}

export default function PinStrength({ pin = "" }) {
  const look = useLook();
  const { t, lang } = useI18n();
  const en = lang === "en";
  const digits = String(pin || "").replace(/\D/g, "").length;
  const verdict = pinVerdict(digits);

  const rows = useMemo(() => ([
    { k: "1 core", s: crackSeconds(digits, 1) },
    { k: "64 " + (t("pin.digits") === "digits" ? "cores" : "core"), s: crackSeconds(digits, 64) },
    { k: t("pin.lab"), s: crackSeconds(digits, 10000) },
  ]), [digits, en]);

  const COPY = {
    short: [t("pin.v.short"), t("pin.v.short2"), "bad"],
    weak: [t("pin.v.weak"), t("pin.v.weak2"), "bad"],
    fair: [t("pin.v.fair"), t("pin.v.fair2"), "warn"],
    good: [t("pin.v.good"), t("pin.v.good2"), "ok"],
    strong: [t("pin.v.strong"), t("pin.v.strong2"), "ok"],
  }[verdict];

  const color = COPY[2] === "ok" ? look.tint : COPY[2] === "warn" ? "#FF9100" : "#F2F4F3";
  const filled = Math.min(12, digits);

  const st = StyleSheet.create({
    box: { borderWidth: 1, borderColor: look.border, backgroundColor: look.surface, padding: 14, marginTop: 12 },
    head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    label: { color: "#8B928E", fontSize: 10, letterSpacing: 1.6, textTransform: "uppercase" },
    verdict: { color, fontSize: 11, letterSpacing: 0.8, fontWeight: "600", flexShrink: 1, textAlign: "right" },
    bar: { flexDirection: "row", gap: 3, marginTop: 12 },
    seg: { flex: 1, height: 5 },
    meta: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
    metaTxt: { color: "#565C59", fontSize: 10 },
    row: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", borderTopWidth: 1, borderTopColor: look.border, paddingVertical: 9, marginTop: 0 },
    rowK: { color: "#8B928E", fontSize: 11, letterSpacing: 0.6 },
    rowV: { color: "#F2F4F3", fontSize: 13, fontWeight: "600" },
    note: { color: "#565C59", fontSize: 11, lineHeight: 16, marginTop: 12 },
  });

  return (
    <View style={st.box} testID="pin-strength">
      <View style={st.head}>
        <Text style={st.label}>{t("pin.time")}</Text>
        <Text style={st.verdict}>
          <Ionicons name={COPY[2] === "ok" ? "shield-checkmark" : "warning"} size={12} color={color} />{"  "}{COPY[0]}
        </Text>
      </View>

      <View style={st.bar}>
        {Array.from({ length: 12 }).map((_, i) => (
          <View key={i} style={[st.seg, { backgroundColor: i < filled ? color : look.border }]} />
        ))}
      </View>
      <View style={st.meta}>
        <Text style={st.metaTxt}>{digits} {t("pin.digits")}</Text>
        <Text style={st.metaTxt}>{t("pin.recommended")}</Text>
      </View>

      <View style={{ marginTop: 10 }}>
        {rows.map((r) => (
          <View key={r.k} style={st.row} testID={`pin-strength-${r.k}`}>
            <Text style={st.rowK}>{r.k}</Text>
            <Text style={st.rowV}>{humanTime(r.s, en)}</Text>
          </View>
        ))}
      </View>

      <Text style={st.note}>
        {COPY[1]}{" "}
        {t("pin.measured")}
      </Text>
    </View>
  );
}

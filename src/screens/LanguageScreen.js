import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Animated, Easing, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";
import { UI_LANGS, NEW_KEYS } from "../lib/locales";

// Prima schermata assoluta, al primissimo avvio: nessuna rete, nessuna identità, nessun
// consenso ancora. Solo la lingua, perché tutto il resto va letto per essere accettato.
function Row({ item, index, selected, onPress }) {
  const enter = useRef(new Animated.Value(0)).current;
  const press = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1, duration: 520, delay: 90 + index * 70,
      easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: true,
    }).start();
  }, [enter, index]);
  useEffect(() => {
    Animated.spring(press, { toValue: selected ? 1 : 0, friction: 6, tension: 140, useNativeDriver: true }).start();
  }, [selected, press]);
  const rtl = item.rtl;
  return (
    <Animated.View
      style={{
        opacity: enter,
        transform: [
          { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) },
          { scale: press.interpolate({ inputRange: [0, 1], outputRange: [1, 1.025] }) },
        ],
      }}
    >
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={onPress}
        testID={`lang-option-${item.code}`}
        style={[
          styles.row,
          { flexDirection: rtl ? "row-reverse" : "row" },
          selected && styles.rowOn,
        ]}
      >
        <Text style={styles.flag}>{item.flag}</Text>
        <View style={{ flex: 1, alignItems: rtl ? "flex-end" : "flex-start" }}>
          <Text style={[styles.native, selected && { color: theme.text }]}>{item.native}</Text>
          <Text style={styles.english}>{item.english}</Text>
        </View>
        <View style={[styles.tick, selected && styles.tickOn]}>
          {selected ? <Ionicons name="checkmark-outline" size={15} color="#04070D" /> : null}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function LanguageScreen({ onPick }) {
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState("it");
  const glow = useRef(new Animated.Value(0)).current;
  const head = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(head, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 4200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 4200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    ).start();
  }, [glow, head]);

  const item = useMemo(() => UI_LANGS.find((l) => l.code === code) || UI_LANGS[0], [code]);
  const L = NEW_KEYS[code] || NEW_KEYS.it;
  const rtl = item.rtl;

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 18 }]} testID="language-screen">
      <Animated.View
        pointerEvents="none"
        style={[
          styles.aura,
          {
            opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.28, 0.55] }),
            transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) }],
          },
        ]}
      />
      <Animated.View
        style={{
          opacity: head,
          transform: [{ translateY: head.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) }],
          alignItems: rtl ? "flex-end" : "flex-start",
          paddingHorizontal: 26,
        }}
      >
        <Text style={styles.brand}>{L["lang.brand"]}</Text>
        <Text style={[styles.title, rtl && { textAlign: "right", writingDirection: "rtl" }]}>{L["lang.title"]}</Text>
        <Text style={[styles.sub, rtl && { textAlign: "right", writingDirection: "rtl" }]}>{L["lang.sub"]}</Text>
      </Animated.View>

      <ScrollView
        style={{ flex: 1, marginTop: 26 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        {UI_LANGS.map((l, i) => (
          <Row key={l.code} item={l} index={i} selected={l.code === code} onPress={() => setCode(l.code)} />
        ))}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 18 }]}>
        <Text style={[styles.foot, rtl && { textAlign: "right", writingDirection: "rtl" }]}>{L["lang.foot"]}</Text>
        <TouchableOpacity
          activeOpacity={0.9}
          style={styles.cta}
          onPress={() => onPick(code)}
          testID="lang-continue-btn"
        >
          <Text style={styles.ctaTxt}>{L["lang.continue"]}</Text>
          <Ionicons name={rtl ? "arrow-back" : "arrow-forward"} size={18} color="#04070D" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "transparent" },
  aura: {
    position: "absolute", top: -180, left: -120, width: 460, height: 460, borderRadius: 230,
    backgroundColor: theme.primary,
    ...(Platform.OS === "android" ? { opacity: 0.3 } : {}),
  },
  brand: { color: theme.primary, fontSize: 11, fontWeight: "900", letterSpacing: 2.4, textTransform: "uppercase", marginBottom: 14 },
  title: { color: theme.text, fontSize: 34, lineHeight: 39, fontWeight: "800", letterSpacing: -0.6 },
  sub: { color: theme.textDim, fontSize: 14, lineHeight: 20, marginTop: 10, maxWidth: 320 },
  row: {
    alignItems: "center", gap: 14, paddingVertical: 15, paddingHorizontal: 16,
    borderRadius: 18, borderWidth: 1, borderColor: theme.border,
    backgroundColor: theme.surface, marginBottom: 10,
  },
  rowOn: { borderColor: theme.primary, backgroundColor: theme.surfaceAlt },
  flag: { fontSize: 26 },
  native: { color: theme.text, fontSize: 17, fontWeight: "700" },
  english: { color: theme.textFaint, fontSize: 12, marginTop: 2 },
  tick: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: theme.border,
    alignItems: "center", justifyContent: "center",
  },
  tickOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  footer: { paddingHorizontal: 24, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 16, backgroundColor: "transparent" },
  foot: { color: theme.textFaint, fontSize: 11.5, marginBottom: 14 },
  cta: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    height: 54, borderRadius: 27, backgroundColor: theme.accent,
  },
  ctaTxt: { color: "#04070D", fontSize: 16, fontWeight: "900", letterSpacing: 0.2 },
});

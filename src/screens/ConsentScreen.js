import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";
import { useI18n } from "../lib/i18n";
import { DEFAULT_SERVER } from "../config";

export default function ConsentScreen({ onAccept }) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [privacy, setPrivacy] = useState(false);
  const [terms, setTerms] = useState(false);
  const ready = privacy && terms;

  const open = (path) => Linking.openURL(DEFAULT_SERVER + path).catch(() => {});

  const Check = ({ value, onToggle, label, testID }) => (
    <TouchableOpacity style={styles.checkRow} onPress={() => onToggle(!value)} activeOpacity={0.7} testID={testID}>
      <Ionicons name={value ? "checkbox" : "square-outline"} size={22} color={value ? theme.primary : theme.textFaint} />
      <Text style={styles.checkLabel}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.logo}><Ionicons name="shield-checkmark-outline" size={34} color={theme.primary} /></View>
        <Text style={styles.title}>{t("consent.title")}</Text>
        <Text style={styles.intro}>{t("consent.intro")}</Text>

        <TouchableOpacity style={styles.link} onPress={() => open("/privacy")} testID="consent-open-privacy">
          <Ionicons name="shield-checkmark-outline" size={18} color={theme.primary} />
          <Text style={styles.linkTxt}>{t("consent.readPrivacy")}</Text>
          <Ionicons name="open-outline" size={16} color={theme.textFaint} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.link} onPress={() => open("/termini")} testID="consent-open-terms">
          <Ionicons name="document-text-outline" size={18} color={theme.primary} />
          <Text style={styles.linkTxt}>{t("consent.readTerms")}</Text>
          <Ionicons name="open-outline" size={16} color={theme.textFaint} />
        </TouchableOpacity>

        <View style={styles.divider} />
        <Check value={privacy} onToggle={setPrivacy} label={t("consent.acceptPrivacy")} testID="consent-check-privacy" />
        <Check value={terms} onToggle={setTerms} label={t("consent.acceptTerms")} testID="consent-check-terms" />
        <Text style={styles.controller}>{t("consent.controller")}</Text>
      </ScrollView>

      <TouchableOpacity
        style={[styles.cta, !ready && styles.ctaDisabled]}
        disabled={!ready}
        onPress={onAccept}
        testID="consent-continue"
      >
        <Text style={styles.ctaTxt}>{t("consent.continue")}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent", paddingHorizontal: 22 },
  scroll: { paddingBottom: 20 },
  logo: { width: 64, height: 64, borderRadius: 18, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center", marginBottom: 18 },
  title: { color: theme.text, fontSize: 26, fontWeight: "800" },
  intro: { color: theme.textDim, fontSize: 14, lineHeight: 21, marginTop: 12 },
  link: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 14, marginTop: 12 },
  linkTxt: { color: theme.text, fontSize: 14, fontWeight: "600", flex: 1 },
  divider: { height: 1, backgroundColor: theme.border, marginVertical: 20 },
  checkRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 10 },
  checkLabel: { color: theme.text, fontSize: 14, flex: 1, lineHeight: 20 },
  controller: { color: theme.textFaint, fontSize: 12, marginTop: 16 },
  cta: { backgroundColor: theme.primary, borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 12 },
  ctaDisabled: { opacity: 0.4 },
  ctaTxt: { color: "#fff", fontSize: 16, fontWeight: "800" },
});

import React from "react";
import { Text, Alert, Linking, StyleSheet } from "react-native";
import { URL_RE, scanUrl } from "../lib/threatEngine";
import { theme } from "../theme";

// Rende il testo di un messaggio evidenziando i link.
// - Link sicuri: cliccabili (aprono nel browser).
// - Link sospetti/pericolosi: BLOCCATI. Il tocco mostra un avviso dello Scudo.
//   I link "danger" (virus/malware/phishing) non si possono aprire in alcun modo.
export default function SafeText({ text = "", style, lang = "it" }) {
  if (!text) return null;
  const parts = [];
  let last = 0;
  const re = new RegExp(URL_RE.source, "gi");
  let m;
  while ((m = re.exec(text)) !== null) {
    const url = m[0];
    if (m.index > last) parts.push({ t: text.slice(last, m.index) });
    parts.push({ t: url, url });
    last = m.index + url.length;
  }
  if (last < text.length) parts.push({ t: text.slice(last) });

  const openSafe = (url) => {
    const full = /^https?:\/\//i.test(url) ? url : "https://" + url;
    Linking.openURL(full).catch(() => {});
  };
  const onBlocked = (url, res) => {
    const reasons = (res.reasons || []).slice(0, 4).map((r) => "• " + r).join("\n");
    if (res.level === "danger") {
      Alert.alert(
        lang === "en" ? "🛡️ Link blocked by the Shield" : "🛡️ Link bloccato dallo Scudo",
        (lang === "en" ? "This link is dangerous and was blocked. It cannot be opened.\n\n" : "Questo link è pericoloso ed è stato bloccato. Non può essere aperto.\n\n") + reasons,
        [{ text: "OK", style: "cancel" }]
      );
    } else {
      Alert.alert(
        lang === "en" ? "⚠️ Suspicious link" : "⚠️ Link sospetto",
        (lang === "en" ? "The Shield flagged this link as suspicious.\n\n" : "Lo Scudo ha segnalato questo link come sospetto.\n\n") + reasons,
        [
          { text: lang === "en" ? "Don't open" : "Non aprire", style: "cancel" },
          { text: lang === "en" ? "Open anyway" : "Apri comunque", style: "destructive", onPress: () => openSafe(url) },
        ]
      );
    }
  };

  return (
    <Text style={style}>
      {parts.map((p, i) => {
        if (!p.url) return <Text key={i}>{p.t}</Text>;
        const res = scanUrl(p.url, lang);
        if (res.level === "safe") {
          return <Text key={i} style={styles.linkSafe} onPress={() => openSafe(p.url)} testID="safe-link">{p.t}</Text>;
        }
        const danger = res.level === "danger";
        return (
          <Text
            key={i}
            style={[styles.linkBlocked, danger ? styles.linkDanger : styles.linkWarn]}
            onPress={() => onBlocked(p.url, res)}
            testID={danger ? "blocked-link-danger" : "blocked-link-warn"}
          >
            {danger ? "🔒 " : "⚠️ "}{p.t}
          </Text>
        );
      })}
    </Text>
  );
}

const styles = StyleSheet.create({
  linkSafe: { color: "#7fb0ff", textDecorationLine: "underline" },
  linkBlocked: { fontWeight: "700", textDecorationLine: "line-through" },
  linkDanger: { color: "#FF6B7A" },
  linkWarn: { color: "#50C878" },
});

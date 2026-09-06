import React, { useEffect, useState, useMemo } from "react";
import { View, Text, Image, TouchableOpacity, Linking, StyleSheet } from "react-native";
import { URL_RE, scanUrl } from "../lib/threatEngine";
import * as api from "../lib/api";
import { theme } from "../theme";

// Anteprima Sicura Link (mobile): mostra una card per i link "sicuri" dentro la bolla.
// I metadati arrivano dall'unfurl lato server (SSRF-safe). I link sospetti/pericolosi
// restano gestiti da SafeText e NON ricevono anteprima.
const cache = {}; // url -> object | "none"

function safeUrls(text, lang) {
  const out = [];
  const re = new RegExp(URL_RE.source, "gi");
  let m;
  while ((m = re.exec(text)) !== null) {
    const u = m[0];
    try { if (scanUrl(u, lang).level === "safe" && out.indexOf(u) < 0) out.push(u); } catch (e) { /* */ }
    if (out.length >= 2) break;
  }
  return out;
}
function domainOf(u) {
  try { return String(u).replace(/^https?:\/\//i, "").split(/[/?#]/)[0].replace(/^www\./i, ""); } catch (e) { return ""; }
}

export default function LinkPreview({ text = "", lang = "it" }) {
  const urls = useMemo(() => (text ? safeUrls(text, lang) : []), [text, lang]);
  if (!urls.length) return null;
  return (
    <View>
      {urls.map((u) => <PreviewCard key={u} url={u} lang={lang} />)}
    </View>
  );
}

function PreviewCard({ url }) {
  const [d, setD] = useState(() => (cache[url] && cache[url] !== "none" ? cache[url] : null));
  useEffect(() => {
    let alive = true;
    if (cache[url] === "none") return;
    if (cache[url]) { setD(cache[url]); return; }
    api.linkPreview(url).then((r) => {
      if (!r || r.none || (!r.title && !r.description && !r.image)) { cache[url] = "none"; return; }
      cache[url] = r; if (alive) setD(r);
    }).catch(() => { cache[url] = "none"; });
    return () => { alive = false; };
  }, [url]);
  if (!d) return null;
  const href = /^https?:\/\//i.test(url) ? url : "https://" + url;
  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={() => Linking.openURL(href).catch(() => {})} testID="link-preview">
      {!!d.image && <Image source={{ uri: d.image }} style={styles.img} resizeMode="cover" />}
      <View style={styles.body}>
        {!!d.title && <Text style={styles.title} numberOfLines={2}>{d.title}</Text>}
        {!!d.description && <Text style={styles.desc} numberOfLines={2}>{d.description}</Text>}
        <Text style={styles.dom} numberOfLines={1}>🔗 {domainOf(url)}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 8, borderRadius: 10, overflow: "hidden", backgroundColor: "#0B0F16", borderWidth: 1, borderColor: "#23324A", borderLeftWidth: 3, borderLeftColor: theme.primary },
  img: { width: "100%", height: 150, backgroundColor: "#0B0F16" },
  body: { padding: 10 },
  title: { color: "#E7ECF5", fontWeight: "700", fontSize: 13, lineHeight: 17, marginBottom: 3 },
  desc: { color: "#9AA4B2", fontSize: 12, lineHeight: 16 },
  dom: { color: theme.primary, fontSize: 11, fontWeight: "700", marginTop: 5 },
});

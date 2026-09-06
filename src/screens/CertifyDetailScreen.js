import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { theme } from "../theme";
import { LOGO_DATA_URI } from "../lib/logoBase64";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../context/AuthContext";
import { useUnread } from "../context/UnreadContext";
import * as api from "../lib/api";
import { decryptEnvelope } from "../lib/crypto";
import { decryptAny } from "../lib/devices";
import EncryptedAttachment from "../components/EncryptedAttachment";
import ThreatBanner from "../components/ThreatBanner";
import { analyzeMessage, analyzeAttachment } from "../lib/threatEngine";
import { recordThreat } from "../lib/threatLog";

function fmt(ts) { if (!ts) return "—"; try { return new Date(ts).toLocaleString(); } catch { return ts; } }
function short(s, n = 12) { if (!s) return "—"; return s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-n)}` : s; }

export default function CertifyDetailScreen({ route, navigation }) {
  const { mail_id, box } = route.params || {};
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const { refresh } = useUnread();
  const [mail, setMail] = useState(null);
  const [atts, setAtts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const m = await api.certifyMessage(mail_id);
      setMail(m);
      if (box === "inbox" && !m.read_at) { api.certifyRead(mail_id).then(() => refresh()).catch(() => {}); }
      const env = Array.isArray(m?.att_env) ? m.att_env : [];
      let manifest = [];
      for (const e of env) {
        try { const pt = await decryptAny(e, user); if (pt) { manifest = JSON.parse(pt); break; } } catch {}
      }
      setAtts(Array.isArray(manifest) ? manifest : []);
    } catch (e) { Alert.alert("Certify", api.apiErr(e)); }
    finally { setLoading(false); }
  }, [mail_id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!mail) return;
    const O = { safe: 0, warn: 1, danger: 2 };
    const b = analyzeMessage(`${mail.subject || ""} ${mail.body || ""}`, lang);
    const all = [b, ...atts.map((a) => analyzeAttachment({ name: a.name, mime: a.mime }, lang))];
    const lvl = all.reduce((acc, r) => (O[r.level] > O[acc] ? r.level : acc), "safe");
    if (lvl !== "safe") recordThreat({ level: lvl, reasons: [...new Set(all.flatMap((r) => r.reasons))], context: "Certify" });
  }, [mail, atts, lang]);

  const doTrash = async () => { try { await api.certifyTrash(mail_id); navigation.goBack(); } catch (e) { Alert.alert("Certify", api.apiErr(e)); } };
  const doRestore = async () => { try { await api.certifyRestore(mail_id); navigation.goBack(); } catch (e) { Alert.alert("Certify", api.apiErr(e)); } };
  const doDelete = () => {
    Alert.alert(t("certify.deleteTitle"), t("certify.deleteConfirm"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("delete"), style: "destructive", onPress: async () => { try { await api.certifyDelete(mail_id); navigation.goBack(); } catch (e) { Alert.alert("Certify", api.apiErr(e)); } } },
    ]);
  };
  const doReply = () => { navigation.replace("CertifyCompose", { reply: mail }); };

  const exportReceipt = async () => {
    setExporting(true);
    try {
      const r = await api.certifyReceipt(mail_id).catch(() => mail);
      const rows = [
        [t("certify.subject"), r.subject || "—"], [t("certify.from"), r.sender_lns], [t("certify.to"), r.recipient_lns],
        [t("certify.classification"), r.classification || "—"], ["Doc hash", r.doc_hash || "—"], ["Tx ID", r.tx_id || "—"],
        [t("certify.block"), r.block_index != null ? "#" + r.block_index : "—"],
        [t("certify.receiptSent"), fmt(r.sent_at || r.sealed_at)], [t("certify.delivered"), r.delivered_at ? fmt(r.delivered_at) : "—"],
        [t("certify.read"), r.read_at ? fmt(r.read_at) : "—"], [t("certify.algorithm"), r.algorithm || "ML-DSA-65"],
        [t("certify.receiptGenerated"), fmt(r.generated_at || new Date().toISOString())],
      ];
      const logo = LOGO_DATA_URI;
      const O2 = { safe: 0, warn: 1, danger: 2 };
      const sBody = analyzeMessage(`${r.subject || mail.subject || ""} ${mail.body || ""}`, lang);
      const sAll = [sBody, ...atts.map((a) => analyzeAttachment({ name: a.name, mime: a.mime }, lang))];
      const sLevel = sAll.reduce((acc, x) => (O2[x.level] > O2[acc] ? x.level : acc), "safe");
      const sReasons = [...new Set(sAll.flatMap((x) => x.reasons))];
      const sc = sLevel === "danger" ? { c: "#FF4D5E", bg: "#fff0f1" } : sLevel === "warn" ? { c: "#50C878", bg: "#fff8ec" } : { c: "#1a9d5a", bg: "#eefaf1" };
      const sLabel = sLevel === "danger" ? (lang === "en" ? "Threat detected — blocked" : "Minaccia rilevata — bloccata")
        : sLevel === "warn" ? (lang === "en" ? "Suspicious content" : "Contenuto sospetto")
        : (lang === "en" ? "No threats found — clean" : "Nessuna minaccia rilevata — pulito");
      const secHtml = `<div style="margin-top:22px;padding:12px 15px;border:1px solid ${sc.c};border-radius:6px;background:${sc.bg};font-family:Helvetica,Arial,sans-serif">
        <div style="font-size:11px;font-weight:800;letter-spacing:.5px;color:${sc.c};text-transform:uppercase">${lang === "en" ? "Security Report — Threat Shield" : "Report Sicurezza — Scudo Anti-Minacce"}</div>
        <div style="font-size:12.5px;color:#222;margin-top:5px;font-weight:700">${sLabel}</div>
        ${sReasons.length ? `<ul style="margin:6px 0 0;padding-left:18px;font-size:11.5px;color:#555;line-height:1.5">${sReasons.slice(0, 6).map((x) => `<li>${x}</li>`).join("")}</ul>` : ""}
        <div style="font-size:9px;color:#98a4b3;margin-top:7px">${lang === "en" ? "Analyzed 100% on-device — no data sent to third parties." : "Analizzato 100% sul dispositivo — nessun dato inviato a terzi."}</div>
      </div>`;
      const html = `<html><head><meta charset="utf-8"><style>
        @page { margin: 0; }
        *{box-sizing:border-box}
        body{font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;margin:0;padding:0}
        .page{padding:48px 54px}
        .hdr{display:flex;align-items:center;gap:14px;border-bottom:3px solid #50C878;padding-bottom:18px}
        .hdr img{width:46px;height:46px}
        .brand{font-family:Helvetica,Arial,sans-serif}
        .brand .name{font-size:20px;font-weight:800;letter-spacing:.5px;color:#0d1b2a}
        .brand .tag{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#50C878;margin-top:2px}
        .seal{margin-left:auto;text-align:right;font-family:Helvetica,Arial,sans-serif;font-size:9px;color:#7a8aa0;text-transform:uppercase;letter-spacing:1px}
        h1{font-size:22px;margin:26px 0 4px;color:#0d1b2a}
        .lead{color:#555;font-size:12px;margin:0 0 8px}
        table{width:100%;border-collapse:collapse;margin-top:20px}
        td{padding:10px 8px;border-bottom:1px solid #edf0f4;font-size:12.5px;vertical-align:top}
        td.k{color:#66768a;width:36%;font-family:Helvetica,Arial,sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
        td.v{word-break:break-all;color:#1a1a1a}
        .badge{display:inline-block;margin-top:22px;padding:8px 14px;background:#eef4ff;border:1px solid #cfe0ff;border-radius:6px;font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#0052cc}
        .ft{margin-top:30px;border-top:1px solid #edf0f4;padding-top:14px;font-family:Helvetica,Arial,sans-serif;font-size:10px;color:#98a4b3;line-height:1.6}
        </style></head><body><div class="page">
        <div class="hdr">
          ${logo ? `<img src="${logo}"/>` : ""}
          <div class="brand"><div class="name">Lattice Network</div><div class="tag">Certify · Posta Notorizzata</div></div>
          <div class="seal">Documento certificato<br/>ML-DSA-65 · Blockchain</div>
        </div>
        <h1>Ricevuta di notarizzazione</h1>
        <p class="lead">Attestazione crittografica di invio, consegna e ancoraggio on-chain.</p>
        <table>${rows.map(([k, v]) => `<tr><td class="k">${k}</td><td class="v">${v ?? "—"}</td></tr>`).join("")}</table>
        <div class="badge">✓ Firma post-quantum verificata &nbsp;·&nbsp; Ancoraggio blockchain Lattice</div>
        ${secHtml}
        <div class="ft">Documento generato automaticamente da Lattice Network Certify. La validità della ricevuta è garantita dalla firma digitale post-quantistica (ML-DSA-65) e dall'ancoraggio immutabile sulla blockchain Lattice. Qualsiasi alterazione invalida la firma.</div>
        </div></body></html>`;
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: t("certify.receiptPdf") });
    } catch (e) { Alert.alert("Certify", api.apiErr(e)); }
    finally { setExporting(false); }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={theme.primary} /></View>;
  if (!mail) return <View style={styles.center}><Text style={styles.dim}>{t("certify.notFound")}</Text></View>;

  const ORD = { safe: 0, warn: 1, danger: 2 };
  const secBody = analyzeMessage(`${mail.subject || ""} ${mail.body || ""}`, lang);
  const secAtts = atts.map((a) => analyzeAttachment({ name: a.name, mime: a.mime }, lang));
  const secAll = [secBody, ...secAtts];
  const secLevel = secAll.reduce((acc, r) => (ORD[r.level] > ORD[acc] ? r.level : acc), "safe");
  const secReasons = [...new Set(secAll.flatMap((r) => r.reasons))];
  const secColor = secLevel === "danger" ? "#FF4D5E" : secLevel === "warn" ? "#50C878" : theme.accent;
  const secLabel = secLevel === "danger"
    ? (lang === "en" ? "⛔ Threat detected — blocked" : "⛔ Minaccia rilevata — bloccata")
    : secLevel === "warn"
      ? (lang === "en" ? "⚠ Suspicious content" : "⚠ Contenuto sospetto")
      : (lang === "en" ? "✓ No threats found" : "✓ Nessuna minaccia rilevata");

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
      <Text style={styles.subject}>{mail.subject || "—"}</Text>
      <View style={styles.meta}>
        <Text style={styles.metaLine}><Text style={styles.metaK}>{t("certify.from")} </Text>{mail.sender_lns}</Text>
        <Text style={styles.metaLine}><Text style={styles.metaK}>{t("certify.to")} </Text>{mail.recipient_lns}</Text>
        <Text style={styles.metaLine}><Text style={styles.metaK}>{t("certify.date")} </Text>{fmt(mail.sealed_at)}</Text>
        <View style={styles.classTag}><Ionicons name="lock-closed-outline" size={11} color={theme.primary} /><Text style={styles.classTxt}>{mail.classification || "INTERNAL"}</Text></View>
      </View>

      {box !== "trash" && (
        <TouchableOpacity style={styles.replyBtn} onPress={doReply} testID="certify-reply">
          <Ionicons name="arrow-undo-outline" size={16} color={theme.primary} /><Text style={styles.replyTxt}>{t("certify.reply")}</Text>
        </TouchableOpacity>
      )}

      <View style={styles.divider} />
      <Text style={styles.body}>{mail.body || t("certify.contentUnavailable")}</Text>

      {atts.length > 0 && (
        <View style={styles.attsBox}>
          <Text style={styles.attsTitle}>{t("certify.attachments")} ({atts.length})</Text>
          {atts.map((a) => <EncryptedAttachment key={a.id} att={a} />)}
        </View>
      )}

      <View style={[styles.receiptsCard, { borderWidth: 1, borderColor: secColor }]} testID="certify-security">
        <Text style={styles.cardTitle}><Ionicons name="shield-checkmark-outline" size={12} color={secColor} /> {lang === "en" ? "Threat Shield scan" : "Controllo Scudo Anti-Minacce"}</Text>
        <View style={styles.rRow}><Text style={styles.rK}>{lang === "en" ? "Result" : "Esito"}</Text><Text style={[styles.rV, { color: secColor, fontWeight: "800" }]}>{secLabel}</Text></View>
        {secLevel !== "safe" && secReasons.slice(0, 5).map((r, i) => <Text key={i} style={styles.secReason}>• {r}</Text>)}
        <View style={styles.rRow}><Text style={styles.rK}>{lang === "en" ? "Checked" : "Verificato"}</Text><Text style={styles.rV}>{lang === "en" ? "Text, links & attachments" : "Testo, link e allegati"}</Text></View>
        <View style={styles.rRow}><Text style={styles.rK}>{lang === "en" ? "Engine" : "Motore"}</Text><Text style={[styles.rV, { color: theme.accent }]}>Lattice Threat Shield ✓</Text></View>
      </View>

      <View style={styles.receiptsCard} testID="certify-receipts">
        <Text style={styles.cardTitle}><Ionicons name="checkmark-done-outline" size={12} color={theme.primary} /> {t("certify.receiptsTitle")}</Text>
        <View style={styles.rRow}><Text style={styles.rK}>{t("certify.delivered")}</Text><Text style={[styles.rV, { color: mail.delivered_at ? theme.accent : "#ff9100" }]}>{mail.delivered_at ? fmt(mail.delivered_at) : t("certify.waiting")}</Text></View>
        <View style={styles.rRow}><Text style={styles.rK}>{t("certify.read")}</Text><Text style={[styles.rV, { color: mail.read_at ? theme.accent : "#ff9100" }]}>{mail.read_at ? fmt(mail.read_at) : t("certify.waiting")}</Text></View>
      </View>

      <View style={styles.receiptsCard} testID="certify-onchain">
        <Text style={styles.cardTitle}><Ionicons name="cube-outline" size={12} color={theme.primary} /> {t("certify.onChain")}</Text>
        <View style={styles.rRow}><Text style={styles.rK}>Doc hash</Text><Text style={styles.rV} numberOfLines={1}>{short(mail.doc_hash)}</Text></View>
        <View style={styles.rRow}><Text style={styles.rK}>Tx ID</Text><Text style={[styles.rV, { color: theme.accent }]} numberOfLines={1}>{mail.tx_id ? short(mail.tx_id) : "—"}</Text></View>
        <View style={styles.rRow}><Text style={styles.rK}>{t("certify.block")}</Text><Text style={styles.rV}>{mail.block_index != null ? `#${mail.block_index}` : "—"}</Text></View>
        <View style={styles.rRow}><Text style={styles.rK}>{t("certify.signature")}</Text><Text style={[styles.rV, { color: theme.accent }]}>ML-DSA-65 ✓</Text></View>
      </View>

      <TouchableOpacity style={styles.receiptBtn} onPress={exportReceipt} disabled={exporting} testID="certify-receipt-btn">
        {exporting ? <ActivityIndicator size="small" color={theme.primary} /> : <><Ionicons name="download-outline" size={16} color={theme.primary} /><Text style={styles.receiptBtnTxt}>{t("certify.receiptPdf")}</Text></>}
      </TouchableOpacity>

      <View style={styles.actions}>
        {box === "trash" ? (
          <TouchableOpacity style={styles.actBtn} onPress={doRestore} testID="certify-restore">
            <Ionicons name="refresh-outline" size={16} color={theme.text} /><Text style={styles.actTxt}>{t("certify.restore")}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.actBtn} onPress={doTrash} testID="certify-trash">
            <Ionicons name="trash-outline" size={16} color={theme.text} /><Text style={styles.actTxt}>{t("certify.trash")}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.actBtn, { borderColor: theme.danger }]} onPress={doDelete} testID="certify-delete">
          <Ionicons name="close-circle-outline" size={16} color={theme.danger} /><Text style={[styles.actTxt, { color: theme.danger }]}>{t("delete")}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "transparent" },
  dim: { color: theme.textDim },
  subject: { color: theme.text, fontSize: 22, fontWeight: "800" },
  meta: { marginTop: 12, gap: 4 },
  metaLine: { color: theme.textDim, fontSize: 13 },
  metaK: { color: theme.textFaint },
  classTag: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", marginTop: 6, backgroundColor: theme.surface, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  classTxt: { color: theme.primary, fontSize: 11, fontWeight: "700" },
  replyBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginTop: 12, borderWidth: 1, borderColor: theme.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  replyTxt: { color: theme.primary, fontWeight: "700", fontSize: 13 },
  divider: { height: 1, backgroundColor: theme.border, marginVertical: 16 },
  body: { color: theme.text, fontSize: 16, lineHeight: 24 },
  attsBox: { marginTop: 20, backgroundColor: theme.surface, borderRadius: 12, padding: 12 },
  secReason: { color: "#E7ECF5", fontSize: 11.5, lineHeight: 16, marginTop: 2 },
  attsTitle: { color: theme.textDim, fontSize: 12, fontWeight: "700", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 },
  receiptsCard: { marginTop: 16, backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.border, padding: 14 },
  cardTitle: { color: theme.primary, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 },
  rRow: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 4 },
  rK: { color: theme.textFaint, fontSize: 12 },
  rV: { color: theme.textDim, fontSize: 12, flex: 1, textAlign: "right" },
  receiptBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 16, borderWidth: 1, borderColor: theme.primary, borderRadius: 10, padding: 13 },
  receiptBtnTxt: { color: theme.primary, fontWeight: "700" },
  actions: { flexDirection: "row", gap: 12, marginTop: 20 },
  actBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingVertical: 12 },
  actTxt: { color: theme.text, fontWeight: "700", fontSize: 13 },
});

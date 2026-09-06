// Export "Valore Legale" — 100% ON-DEVICE, zero-knowledge (il server non vede nulla).
// Genera una trascrizione della conversazione (testo + mittente + data/ora), calcola l'hash
// SHA-256 di un canonicale stabile e lo FIRMA con la chiave privata ML-DSA-65 dell'utente.
// Produce DUE file: un PDF leggibile (uso probatorio) e un .json firmato (verificabile da terzi).
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import { sha256 } from "@noble/hashes/sha2.js";
import { signMessage, sha256Hex, bytesToHex } from "./crypto";

const ALGO = "ML-DSA-65 (FIPS 204)";

// Canonicale stabile e deterministico su cui si calcolano hash e firma.
// NB: qualsiasi client può ricostruirlo dai campi del .json e verificare la firma.
function canonical(meta, msgs) {
  const head =
    "LATTICE-LEGAL-EXPORT-v1\n" +
    "conversation:" + meta.conversation + "\n" +
    "participants:" + (meta.participants || []).join(",") + "\n" +
    "exported_at:" + meta.exported_at + "\n" +
    "count:" + msgs.length;
  const lines = msgs.map((m, i) => {
    let line = i + "\t" + (m.at || "") + "\t" + (m.from || "") + "\t" + (m.body || "");
    const atts = m.attachments || [];
    for (const a of atts) line += "\tATT:" + (a.name || "") + ":" + (a.mime || "") + ":" + (a.sha256 || "");
    return line;
  });
  return head + "\n" + lines.join("\n");
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtDate(iso) {
  try { const d = new Date(iso); if (!isNaN(d.getTime())) return d.toLocaleString(); } catch { /* */ }
  return iso || "";
}

function wrapHex(hex, n) {
  const s = String(hex || "");
  let out = "";
  for (let i = 0; i < s.length; i += n) out += s.slice(i, i + n) + "\n";
  return out.trim();
}

function buildHtml(meta, msgs, digest, sig, signer, lang) {
  const it = lang !== "en";
  const T = it
    ? { title: "Lattice Network — Esportazione conversazione", sub: "Documento a valore probatorio · firmato end-to-end sul dispositivo",
        conv: "Conversazione", parts: "Partecipanti", when: "Esportato il", count: "Messaggi", algo: "Algoritmo di firma",
        thNo: "#", thWhen: "Data/ora", thFrom: "Mittente", thBody: "Messaggio",
        sigTitle: "Firma crittografica", sha: "SHA-256 della trascrizione", sigLbl: "Firma (ML-DSA-65, hex)", pk: "Chiave pubblica del firmatario", who: "Firmatario (LNS)",
        howTitle: "Come verificare", how: "Questo documento è stato generato e firmato interamente sul dispositivo del firmatario con la sua chiave privata post-quantum ML-DSA-65. Il server non ha mai avuto accesso ai contenuti. Per verificare l'autenticità: ricostruire il canonicale dai campi del file .json allegato e verificare la firma con la chiave pubblica indicata (ml_dsa65.verify). Qualsiasi modifica al testo invalida la firma." }
    : { title: "Lattice Network — Conversation export", sub: "Legally-probative document · signed end-to-end on the device",
        conv: "Conversation", parts: "Participants", when: "Exported at", count: "Messages", algo: "Signature algorithm",
        thNo: "#", thWhen: "Date/time", thFrom: "Sender", thBody: "Message",
        sigTitle: "Cryptographic signature", sha: "SHA-256 of transcript", sigLbl: "Signature (ML-DSA-65, hex)", pk: "Signer public key", who: "Signer (LNS)",
        howTitle: "How to verify", how: "This document was generated and signed entirely on the signer's device with their post-quantum ML-DSA-65 private key. The server never had access to the contents. To verify: rebuild the canonical string from the attached .json fields and verify the signature with the given public key (ml_dsa65.verify). Any change to the text invalidates the signature." };

  const rows = msgs.map((m, i) => {
    let cell = esc(m.body);
    const atts = m.attachments || [];
    for (const a of atts) {
      const h = a.sha256 ? (a.sha256.slice(0, 24) + "…") : (it ? "non calcolato" : "not computed");
      cell += "<div class=att>📎 " + esc(a.name || "file") + " · " + esc(a.mime || "") + " · SHA-256 " + esc(h) + "</div>";
    }
    return "<tr><td class=n>" + (i + 1) + "</td><td class=w>" + esc(fmtDate(m.at)) + "</td><td class=f>" + esc((m.from || "").split("@")[0]) + "</td><td>" + cell + "</td></tr>";
  }).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { font-family: 'Georgia','Times New Roman',serif; color:#12161c; margin:28px; font-size:12px; }
    h1 { font-size:19px; margin:0 0 2px; color:#0b2340; }
    .sub { color:#5a6472; font-size:11px; margin:0 0 16px; }
    .meta { border:1px solid #d7dde6; border-radius:8px; padding:12px 14px; margin-bottom:16px; background:#f7f9fc; }
    .meta div { margin:2px 0; }
    .meta b { display:inline-block; min-width:150px; color:#33405a; }
    table { width:100%; border-collapse:collapse; margin-top:4px; }
    th { text-align:left; background:#0b2340; color:#fff; padding:6px 8px; font-size:11px; }
    td { border-bottom:1px solid #e6eaf0; padding:6px 8px; vertical-align:top; word-break:break-word; }
    td.n { color:#8892a3; width:34px; } td.w { color:#5a6472; width:130px; white-space:nowrap; } td.f { color:#0b2340; font-weight:bold; width:120px; }
    .sig { margin-top:20px; border:1px solid #d7dde6; border-radius:8px; padding:12px 14px; background:#fbfcfe; page-break-inside:avoid; }
    .sig h3 { margin:0 0 8px; font-size:13px; color:#0b2340; }
    .mono { font-family:'Courier New',monospace; font-size:9px; white-space:pre-wrap; word-break:break-all; background:#fff; border:1px solid #e6eaf0; border-radius:6px; padding:6px 8px; }
    .att { font-size:9px; color:#5a6472; margin-top:3px; font-family:'Courier New',monospace; word-break:break-all; }
    .lbl { color:#33405a; font-weight:bold; margin:8px 0 3px; font-size:11px; }
    .how { margin-top:14px; font-size:10px; color:#4a5568; line-height:1.5; }
  </style></head><body>
    <h1>${esc(T.title)}</h1>
    <p class="sub">${esc(T.sub)}</p>
    <div class="meta">
      <div><b>${esc(T.conv)}:</b> ${esc(meta.conversation)}</div>
      <div><b>${esc(T.parts)}:</b> ${esc((meta.participants || []).join(", "))}</div>
      <div><b>${esc(T.when)}:</b> ${esc(fmtDate(meta.exported_at))}</div>
      <div><b>${esc(T.count)}:</b> ${msgs.length}</div>
      <div><b>${esc(T.algo)}:</b> ${esc(ALGO)}</div>
    </div>
    <table><thead><tr><th>${esc(T.thNo)}</th><th>${esc(T.thWhen)}</th><th>${esc(T.thFrom)}</th><th>${esc(T.thBody)}</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="sig">
      <h3>${esc(T.sigTitle)}</h3>
      <div class="lbl">${esc(T.who)}</div><div class="mono">${esc(signer.lns)}</div>
      <div class="lbl">${esc(T.sha)}</div><div class="mono">${esc(wrapHex(digest, 64))}</div>
      <div class="lbl">${esc(T.pk)}</div><div class="mono">${esc(wrapHex(signer.public_key_hex, 96))}</div>
      <div class="lbl">${esc(T.sigLbl)}</div><div class="mono">${esc(wrapHex(sig, 96))}</div>
      <div class="how"><b>${esc(T.howTitle)}.</b> ${esc(T.how)}</div>
    </div>
  </body></html>`;
}

// messages: [{ at, from, body, atts? }] — atts: [{name, mime, id, key, iv}] (opzionale).
// downloadAttachment(att) -> Uint8Array dei byte in chiaro (o null) per calcolare l'hash on-device.
export async function exportConversation({ title, participants, messages, user, lang, downloadAttachment }) {
  const src = (messages || []).filter((m) => m && ((m.body != null && String(m.body).trim() !== "" && m.body !== "🔒") || (Array.isArray(m.atts) && m.atts.length)));
  if (!src.length) { throw new Error(lang === "en" ? "No messages to export." : "Nessun messaggio da esportare."); }

  const norm = [];
  for (const m of src) {
    const attachments = [];
    if (Array.isArray(m.atts) && typeof downloadAttachment === "function") {
      for (const a of m.atts) {
        let hashHex = null;
        try {
          const bytes = await downloadAttachment(a);
          if (bytes && bytes.length) hashHex = bytesToHex(sha256(bytes));
        } catch { /* allegato non hashabile */ }
        attachments.push({ name: a.name || "file", mime: a.mime || "", sha256: hashHex });
      }
    }
    norm.push({ at: m.at || "", from: m.from || "", body: m.body != null ? String(m.body) : "", attachments });
  }

  const meta = { conversation: title || "chat", participants: participants || [], exported_at: new Date().toISOString() };
  const canon = canonical(meta, norm);
  const digest = sha256Hex(canon);
  const sig = signMessage(canon, user.sk);
  const signer = { lns: user.lns, public_key_hex: user.pk };

  const payload = {
    format: "lattice-legal-export", version: 1, algorithm: ALGO,
    conversation: meta, sha256: digest, signer, signature_hex: sig, messages: norm,
  };
  const jsonStr = JSON.stringify(payload, null, 2);

  const safe = String(title || "chat").replace(/[^\w.\-]/g, "_").slice(0, 40) || "chat";
  const stamp = meta.exported_at.replace(/[:.]/g, "-");
  const jsonUri = FileSystem.cacheDirectory + `lattice-export-${safe}-${stamp}.json`;
  await FileSystem.writeAsStringAsync(jsonUri, jsonStr, { encoding: FileSystem.EncodingType.UTF8 });

  const html = buildHtml(meta, norm, digest, sig, signer, lang);
  const printed = await Print.printToFileAsync({ html });
  const pdfUri = printed.uri;

  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(pdfUri, { mimeType: "application/pdf", dialogTitle: lang === "en" ? "Signed PDF export" : "Export PDF firmato" });
    await Sharing.shareAsync(jsonUri, { mimeType: "application/json", dialogTitle: lang === "en" ? "Signed JSON export" : "Export JSON firmato" });
  }
  return { pdfUri, jsonUri, sig, digest, count: norm.length, shared: canShare };
}

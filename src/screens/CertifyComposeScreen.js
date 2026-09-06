import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, FlatList, Platform,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import DateTimePicker from "@react-native-community/datetimepicker";
import { theme } from "../theme";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../context/AuthContext";
import * as api from "../lib/api";
import { addSelfKeys, decryptAny } from "../lib/devices";
import { encryptFileBytes, base64ToBytes, bytesToHex, encryptForRecipients } from "../lib/crypto";
import Avatar from "../components/Avatar";

const CLASSES = ["INTERNAL", "CONFIDENTIAL", "RESTRICTED", "LEGAL-HOLD"];
const MAX_FILE = 100 * 1024 * 1024;

export default function CertifyComposeScreen({ navigation, route }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const draft = route.params?.draft || null;
  const replyTo = route.params?.reply || null;

  const [tos, setTos] = useState(draft?.recipients || (replyTo ? [replyTo.sender_lns] : []));
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState(draft?.subject || (replyTo ? `${t("certify.replyPrefix")}${(replyTo.subject || "").replace(/^Re:\s*/i, "")}` : ""));
  const [body, setBody] = useState(draft?.body || (replyTo ? `\n\n———— ${replyTo.sender_lns} ————\n${replyTo.body || ""}` : ""));
  const [classification, setClassification] = useState(draft?.classification || replyTo?.classification || "INTERNAL");
  const [atts, setAtts] = useState([]); // {id,name,mime,size,key,iv}
  const [contacts, setContacts] = useState([]);
  const [resolved, setResolved] = useState({});
  const [showBook, setShowBook] = useState(false);
  const [search, setSearch] = useState("");
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [addingContact, setAddingContact] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [upInfo, setUpInfo] = useState("");
  const [err, setErr] = useState("");
  const [schedAt, setSchedAt] = useState(null);
  const [showPicker, setShowPicker] = useState(false);

  const loadContacts = useCallback(() => {
    setLoadingContacts(true);
    api.certifyContacts().then((d) => setContacts(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoadingContacts(false));
  }, []);
  useEffect(() => { loadContacts(); }, [loadContacts]);

  // Resolve recipient badges (company / external).
  useEffect(() => {
    const missing = tos.filter((x) => !resolved[x]);
    if (!missing.length) return;
    api.directoryResolve(missing).then((rows) => {
      setResolved((prev) => { const next = { ...prev }; (rows || []).forEach((r) => { next[r.lns] = r; }); return next; });
    }).catch(() => {});
  }, [tos]); // eslint-disable-line react-hooks/exhaustive-deps

  const addRecipient = () => {
    const v = api.normalizeLns(to);
    if (v && !tos.includes(v)) setTos((x) => [...x, v]);
    setTo("");
  };
  const toggleContact = (lns) => setTos((x) => (x.includes(lns) ? x.filter((y) => y !== lns) : [...x, lns]));

  const filtered = useMemo(() => contacts.filter((c) => {
    const q = search.toLowerCase();
    return !q || (c.display_name || "").toLowerCase().includes(q) || (c.lns || "").toLowerCase().includes(q);
  }), [contacts, search]);
  const candidate = api.normalizeLns(search);
  const canAdd = candidate.includes("@") && candidate.endsWith(".lns") && !contacts.some((c) => c.lns === candidate);
  const allSelected = filtered.length > 0 && filtered.every((c) => tos.includes(c.lns));
  const toggleAll = () => setTos((x) => (allSelected ? x.filter((y) => !filtered.some((c) => c.lns === y)) : [...new Set([...x, ...filtered.map((c) => c.lns)])]));

  const addExternal = async () => {
    if (!candidate) return;
    setAddingContact(true);
    try { await api.addContact(candidate); setSearch(""); loadContacts(); }
    catch (e) { setErr(api.apiErr(e)); } finally { setAddingContact(false); }
  };

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setErr(t("chat.attach.denied")); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7, base64: true });
    if (r.canceled || !r.assets?.[0]?.base64) return;
    const a = r.assets[0];
    await encryptAndUpload(base64ToBytes(a.base64), a.fileName || `foto_${Date.now()}.jpg`, a.mimeType || "image/jpeg");
  };
  const pickDoc = async () => {
    const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    if (a.size && a.size > MAX_FILE) { setErr(t("certify.filesTooBig")); return; }
    const b64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 });
    await encryptAndUpload(base64ToBytes(b64), a.name || `file_${Date.now()}`, a.mimeType || "application/octet-stream");
  };
  const encryptAndUpload = async (bytes, name, mime) => {
    setBusy(true); setErr("");
    try {
      const enc = encryptFileBytes(bytes);
      const { id } = await api.blobUpload(enc.ciphertext, (p) => setUpInfo(t("certify.encrypting", { i: 1, total: 1, p: Math.round(p * 100) })));
      setUpInfo("");
      setAtts((prev) => [...prev, { id, name, mime, size: bytes.length, key: enc.key, iv: enc.iv }]);
    } catch (e) { setErr(api.apiErr(e)); }
    finally { setBusy(false); setUpInfo(""); }
  };

  const recipients = () => {
    const list = [...tos];
    const pending = api.normalizeLns(to);
    if (pending && !list.includes(pending)) list.push(pending);
    return list;
  };

  const buildAttEnv = async (rec) => {
    if (!atts.length) return [];
    if (!user?.kem) throw new Error(t("certify.keyUnavailable"));
    const keyMap = await api.pulseKeys(rec);
    await addSelfKeys(keyMap, user); // BLOCCO A: usa-e-getta anche per le mie copie
    const missing = rec.filter((r) => !keyMap[r]);
    if (missing.length) throw new Error(t("certify.attsNotSendable", { list: missing.join(", ") }));
    return encryptForRecipients(JSON.stringify(atts), keyMap);
  };

  const send = async () => {
    const rec = recipients();
    if (!rec.length) { setErr(t("certify.needRecipient")); return; }
    if (!subject.trim() || !body.trim()) { setErr(t("certify.subjectBodyRequired")); return; }
    setSending(true); setErr("");
    try {
      const att_env = await buildAttEnv(rec);
      await api.certifySend({ sender_lns: user.lns, recipients_lns: rec, subject: subject.trim(), body, classification, attachment_ids: [], att_env });
      if (draft?.draft_id) { try { await api.certifyDelDraft(draft.draft_id); } catch {} }
      navigation.goBack();
    } catch (e) { setErr(api.apiErr(e)); }
    finally { setSending(false); }
  };

  const scheduleSend = async () => {
    const rec = recipients();
    if (!rec.length) { setErr(t("certify.needRecipient")); return; }
    if (!subject.trim() || !body.trim()) { setErr(t("certify.subjectBodyRequired")); return; }
    if (!schedAt) { setErr(t("certify.pickDateTime")); return; }
    if (schedAt <= new Date()) { setErr(t("certify.futureTime")); return; }
    setSending(true); setErr("");
    try {
      const att_env = await buildAttEnv(rec);
      await api.certifySchedule({ recipients: rec, subject: subject.trim(), body, classification, attachment_ids: [], att_env, send_at: schedAt.toISOString() });
      if (draft?.draft_id) { try { await api.certifyDelDraft(draft.draft_id); } catch {} }
      navigation.goBack();
    } catch (e) { setErr(api.apiErr(e)); }
    finally { setSending(false); }
  };

  const saveDraft = async () => {
    setSavingDraft(true); setErr("");
    try {
      await api.certifySaveDraft({ draft_id: draft?.draft_id, recipients: recipients(), subject, body, classification, attachment_ids: [] });
      navigation.goBack();
    } catch (e) { setErr(api.apiErr(e)); }
    finally { setSavingDraft(false); }
  };

  return (
    <KeyboardAwareScrollView style={styles.root} contentContainerStyle={{ padding: 16, paddingBottom: 60 }} bottomOffset={20}>
      {!!err && <View style={styles.errBox}><Ionicons name="alert-circle-outline" size={16} color={theme.danger} /><Text style={styles.err} testID="certify-error">{err}</Text></View>}

      <Text style={styles.label}>{t("certify.recipients")}</Text>
      {tos.length > 0 && (
        <View style={styles.chipWrap}>
          {tos.map((x) => {
            const r = resolved[x];
            const external = r && r.known && r.same_company === false;
            return (
              <View key={x} style={[styles.recChip, external && styles.recChipExt]} testID="certify-recipient-chip">
                <Text style={[styles.recChipTxt, external && { color: "#ffb958" }]} numberOfLines={1}>{x}{external ? t("certify.externalParen") : ""}</Text>
                <TouchableOpacity onPress={() => setTos((v) => v.filter((y) => y !== x))} hitSlop={8}><Ionicons name="close-outline" size={13} color={external ? "#ffb958" : theme.primary} /></TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}
      <View style={styles.recRow}>
        <TextInput style={[styles.input, { flex: 1 }]} placeholder={t("certify.recipientsPlaceholder")} placeholderTextColor={theme.textFaint}
          value={to} onChangeText={setTo} onSubmitEditing={addRecipient} autoCapitalize="none" autoCorrect={false} testID="certify-recipient" />
        <TouchableOpacity style={[styles.bookBtn, showBook && styles.bookBtnActive]} onPress={() => setShowBook((v) => !v)} testID="certify-addressbook">
          <Ionicons name="people-outline" size={18} color={showBook ? theme.primary : theme.textDim} />
        </TouchableOpacity>
      </View>

      {showBook && (
        <View style={styles.book} testID="certify-book">
          <View style={styles.bookSearch}>
            <Ionicons name="search-outline" size={14} color={theme.textFaint} />
            <TextInput style={styles.bookSearchInput} placeholder={t("certify.searchAddLns")} placeholderTextColor={theme.textFaint} selectionColor={theme.primary} cursorColor={theme.text} keyboardAppearance="dark" underlineColorAndroid="transparent" value={search} onChangeText={setSearch} autoCapitalize="none" />
            <TouchableOpacity onPress={toggleAll} disabled={!filtered.length}><Text style={styles.selectAll}>{t("certify.selectAll")}</Text></TouchableOpacity>
          </View>
          {canAdd && (
            <TouchableOpacity style={styles.addExt} onPress={addExternal} disabled={addingContact} testID="certify-add-contact">
              {addingContact ? <ActivityIndicator size="small" color={theme.accent} /> : <><Ionicons name="add-outline" size={14} color={theme.accent} /><Text style={styles.addExtTxt}>{t("certify.addToAddressBook", { lns: candidate })}</Text></>}
            </TouchableOpacity>
          )}
          {loadingContacts ? (
            <View style={styles.bookLoad}><ActivityIndicator size="small" color={theme.primary} /><Text style={styles.bookLoadTxt}>{t("certify.loadingAddressBook")}</Text></View>
          ) : filtered.length === 0 ? (
            <Text style={styles.bookEmpty}>{t("certify.noContact")}</Text>
          ) : (
            <FlatList
              data={filtered} keyExtractor={(c) => c.lns} style={{ maxHeight: 220 }} nestedScrollEnabled
              renderItem={({ item }) => {
                const checked = tos.includes(item.lns);
                return (
                  <TouchableOpacity style={styles.bookRow} onPress={() => toggleContact(item.lns)} testID="certify-contact-row">
                    <Ionicons name={checked ? "checkbox" : "square-outline"} size={18} color={checked ? theme.primary : theme.textFaint} />
                    <Avatar seed={item.lns} label={item.display_name || item.lns} online={!!item.online} uri={item.avatar || undefined} size={28} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.bookName} numberOfLines={1}>{item.display_name || item.lns}</Text>
                      <Text style={styles.bookLns} numberOfLines={1}>{item.lns}</Text>
                    </View>
                    {item.same_company === false && <Text style={styles.extTag}>{item.company_name || t("certify.external")}</Text>}
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      )}

      <Text style={styles.label}>{t("certify.classification")}</Text>
      <View style={styles.classRow}>
        {CLASSES.map((c) => (
          <TouchableOpacity key={c} style={[styles.classBtn, classification === c && styles.classBtnActive]} onPress={() => setClassification(c)} testID={`certify-class-${c}`}>
            <Text style={[styles.classBtnTxt, classification === c && { color: "#fff" }]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>{t("certify.subject")}</Text>
      <TextInput style={styles.input} placeholder={t("certify.subject")} placeholderTextColor={theme.textFaint} value={subject} onChangeText={setSubject} testID="certify-subject" />

      <Text style={styles.label}>{t("certify.body")}</Text>
      <TextInput style={[styles.input, styles.bodyInput]} placeholder={t("certify.bodyPlaceholder")} placeholderTextColor={theme.textFaint} value={body} onChangeText={setBody} multiline testID="certify-body" />

      <View style={styles.attachRow}>
        <TouchableOpacity style={styles.attachBtn} onPress={pickImage} disabled={busy} testID="certify-attach-image">
          <Ionicons name="image-outline" size={18} color={theme.primary} /><Text style={styles.attachTxt}>Foto</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.attachBtn} onPress={pickDoc} disabled={busy} testID="certify-attach-doc">
          <Ionicons name="document-outline" size={18} color={theme.primary} /><Text style={styles.attachTxt}>File</Text>
        </TouchableOpacity>
      </View>
      {busy && <View style={styles.uploading}><ActivityIndicator size="small" color={theme.primary} /><Text style={styles.uploadingTxt}>{upInfo || "…"}</Text></View>}
      {atts.map((a, i) => (
        <View key={a.id} style={styles.attRow}>
          <Ionicons name="lock-closed-outline" size={14} color={theme.accent} />
          <Text style={styles.attName} numberOfLines={1}>{a.name}</Text>
          <TouchableOpacity onPress={() => setAtts((p) => p.filter((_, j) => j !== i))} hitSlop={8}><Ionicons name="close-outline" size={16} color={theme.textFaint} /></TouchableOpacity>
        </View>
      ))}

      <TouchableOpacity style={styles.schedRow} onPress={() => setShowPicker(true)} testID="certify-schedule-toggle">
        <Ionicons name="time-outline" size={16} color={theme.primary} />
        <Text style={styles.schedTxt}>{schedAt ? schedAt.toLocaleString() : t("certify.schedule")}</Text>
        {schedAt && <TouchableOpacity onPress={() => setSchedAt(null)} hitSlop={8}><Ionicons name="close-outline" size={16} color={theme.textFaint} /></TouchableOpacity>}
      </TouchableOpacity>
      {showPicker && (
        <DateTimePicker
          value={schedAt || new Date(Date.now() + 3600000)}
          mode="datetime"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={(e, d) => { setShowPicker(false); if (e.type !== "dismissed" && d) setSchedAt(d); }}
        />
      )}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.draftBtn} onPress={saveDraft} disabled={savingDraft || sending} testID="certify-save-draft">
          {savingDraft ? <ActivityIndicator size="small" color={theme.textDim} /> : <><Ionicons name="save-outline" size={16} color={theme.textDim} /><Text style={styles.draftTxt}>{t("certify.saveDraft")}</Text></>}
        </TouchableOpacity>
        {schedAt ? (
          <TouchableOpacity style={[styles.sendBtn, { backgroundColor: "#ff9100" }, sending && { opacity: 0.6 }]} onPress={scheduleSend} disabled={sending} testID="certify-schedule-send">
            {sending ? <ActivityIndicator color="#fff" /> : <><Ionicons name="calendar-outline" size={18} color="#fff" /><Text style={styles.sendTxt}>{t("certify.scheduleSend")}</Text></>}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[styles.sendBtn, sending && { opacity: 0.6 }]} onPress={send} disabled={sending} testID="certify-send">
            {sending ? <ActivityIndicator color="#fff" /> : <><Ionicons name="shield-checkmark-outline" size={18} color="#fff" /><Text style={styles.sendTxt}>{t("certify.send")}</Text></>}
          </TouchableOpacity>
        )}
      </View>
      <Text style={styles.note}>{t("certify.e2eNote")}</Text>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  errBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(242,244,243,0.1)", borderWidth: 1, borderColor: "rgba(242,244,243,0.4)", borderRadius: 8, padding: 10, marginBottom: 6 },
  err: { color: theme.danger, fontSize: 13, flex: 1 },
  label: { color: theme.textDim, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginTop: 18, marginBottom: 8 },
  input: { backgroundColor: theme.surface, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: theme.text, fontSize: 15, borderWidth: 1, borderColor: theme.border },
  bodyInput: { minHeight: 140, textAlignVertical: "top" },
  recRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  bookBtn: { width: 46, height: 46, borderRadius: 10, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, alignItems: "center", justifyContent: "center" },
  bookBtnActive: { borderColor: theme.primary, backgroundColor: theme.surfaceAlt },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  recChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(80,200,120,0.1)", borderWidth: 1, borderColor: "rgba(80,200,120,0.4)", borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5, maxWidth: 240 },
  recChipExt: { backgroundColor: "rgba(255,145,0,0.1)", borderColor: "rgba(255,145,0,0.5)" },
  recChipTxt: { color: theme.primary, fontSize: 12, fontWeight: "600" },
  book: { marginTop: 10, backgroundColor: theme.surface, borderRadius: 10, borderWidth: 1, borderColor: theme.border, overflow: "hidden" },
  bookSearch: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border },
  bookSearchInput: { flex: 1, color: theme.text, fontSize: 13, includeFontPadding: false },
  selectAll: { color: theme.primary, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  addExt: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, backgroundColor: "rgba(80,200,120,0.1)", borderBottomWidth: 1, borderBottomColor: theme.border },
  addExtTxt: { color: theme.accent, fontSize: 12, fontWeight: "700" },
  bookLoad: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 20 },
  bookLoadTxt: { color: theme.textFaint, fontSize: 12 },
  bookEmpty: { color: theme.textFaint, fontSize: 12, textAlign: "center", paddingVertical: 20 },
  bookRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: theme.border },
  bookName: { color: theme.text, fontSize: 13, fontWeight: "600" },
  bookLns: { color: theme.accent, fontSize: 11 },
  extTag: { color: "#ffb958", fontSize: 9, fontWeight: "700", borderWidth: 1, borderColor: "rgba(255,145,0,0.5)", borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 },
  classRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  classBtn: { borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  classBtnActive: { backgroundColor: theme.primary, borderColor: theme.primary },
  classBtnTxt: { color: theme.textDim, fontSize: 11, fontWeight: "700" },
  attachRow: { flexDirection: "row", gap: 10, marginTop: 20 },
  attachBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: theme.border, borderStyle: "dashed", borderRadius: 10, paddingVertical: 12 },
  attachTxt: { color: theme.primary, fontWeight: "700" },
  uploading: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  uploadingTxt: { color: theme.primary, fontSize: 12 },
  attRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.surface, borderRadius: 8, padding: 10, marginTop: 8 },
  attName: { color: theme.textDim, flex: 1, fontSize: 13 },
  schedRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 20, backgroundColor: theme.surface, borderRadius: 10, borderWidth: 1, borderColor: theme.border, padding: 12 },
  schedTxt: { color: theme.text, fontSize: 13, flex: 1 },
  actions: { flexDirection: "row", gap: 10, marginTop: 20 },
  draftBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingVertical: 15, paddingHorizontal: 16 },
  draftTxt: { color: theme.textDim, fontWeight: "700", fontSize: 13 },
  sendBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: theme.primary, borderRadius: 12, paddingVertical: 15 },
  sendTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },
  note: { color: theme.textFaint, fontSize: 11, textAlign: "center", marginTop: 12 },
});

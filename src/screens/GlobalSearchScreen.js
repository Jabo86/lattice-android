import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, FlatList, ActivityIndicator, Keyboard, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../lib/i18n";
import * as api from "../lib/api";
import { theme } from "../theme";
import Avatar from "../components/Avatar";
import { useAuth } from "../context/AuthContext";
import { decryptEnvelope, unpackMessage } from "../lib/crypto";
import { decryptAny } from "../lib/devices";

export default function GlobalSearchScreen({ navigation }) {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [contacts, setContacts] = useState([]);
  const [mails, setMails] = useState([]);
  const [groups, setGroups] = useState([]);
  const [msgHits, setMsgHits] = useState([]);
  const [msgBusy, setMsgBusy] = useState(false);
  const [msgDone, setMsgDone] = useState("");
  const [joining, setJoining] = useState("");
  const [loading, setLoading] = useState(true);
  const inputRef = useRef(null);

  useEffect(() => { const id = setTimeout(() => setDq(q), 120); return () => clearTimeout(id); }, [q]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [c, m] = await Promise.all([
        api.contacts().catch(() => []),
        api.certifyInbox("inbox").catch(() => []),
      ]);
      if (!alive) return;
      setContacts(Array.isArray(c) ? c : []);
      setMails(Array.isArray(m) ? m : []);
      setLoading(false);
    })();
    const to = setTimeout(() => inputRef.current?.focus(), 350);
    return () => { alive = false; clearTimeout(to); };
  }, []);

  const sq = dq.trim().toLowerCase();
  const foundContacts = useMemo(() => (sq
    ? contacts.filter((c) => c.lns.includes(sq) || (c.display_name || "").toLowerCase().includes(sq) || (c.department || "").toLowerCase().includes(sq))
    : []), [contacts, sq]);
  const foundMails = useMemo(() => (sq
    ? mails.filter((m) => (m.subject || "").toLowerCase().includes(sq) || (m.sender_lns || "").toLowerCase().includes(sq))
    : []), [mails, sq]);

  const openChat = useCallback((c) => { Keyboard.dismiss(); navigation.replace("Chat", { conv_id: null, others: [c.lns], title: c.display_name || c.lns.split("@")[0], title_lns: c.lns }); }, [navigation]);
  const openMail = useCallback((c) => { Keyboard.dismiss(); navigation.replace("CertifyCompose", { draft: { recipients: [c.lns] } }); }, [navigation]);
  const openMailDetail = useCallback((m) => { Keyboard.dismiss(); navigation.replace("CertifyDetail", { mail_id: m.mail_id, box: "inbox" }); }, [navigation]);

  // Ricerca gruppi pubblici (ingresso su richiesta, approvata dagli admin del gruppo).
  useEffect(() => {
    let alive = true;
    const term = dq.trim();
    if (term.length < 2) { setGroups([]); return; }
    api.groupsSearch(term).then((r) => { if (alive) setGroups(Array.isArray(r?.results) ? r.results : []); }).catch(() => { if (alive) setGroups([]); });
    return () => { alive = false; };
  }, [dq]);

  const askJoin = useCallback((g) => {
    Alert.alert("Chiedi di entrare", `Inviare la richiesta di ingresso a «${g.name}»?\n\nGli amministratori del gruppo la vedranno e potranno accettarla.`, [
      { text: "Annulla", style: "cancel" },
      {
        text: "Invia richiesta",
        onPress: async () => {
          setJoining(g.chan_id);
          try {
            await api.groupJoinRequest(g.chan_id, "");
            setGroups((prev) => prev.map((x) => (x.chan_id === g.chan_id ? { ...x, my_state: "pending" } : x)));
            Alert.alert("Richiesta inviata", "Riceverai una notifica quando gli amministratori risponderanno.");
          } catch (e) { Alert.alert("Errore", api.apiErr ? api.apiErr(e) : "Richiesta non inviata"); }
          finally { setJoining(""); }
        },
      },
    ]);
  }, []);

  const openGroup = useCallback((g) => { Keyboard.dismiss(); navigation.replace("ChannelDetail", { chan_id: g.chan_id }); }, [navigation]);

  // Ricerca dentro le chat: i messaggi sono E2EE, quindi vengono scaricati e
  // decifrati qui sul telefono (nessun testo in chiaro lascia il dispositivo).
  const searchMessages = useCallback(async () => {
    const term = dq.trim().toLowerCase();
    if (term.length < 2 || !user?.kem) return;
    setMsgBusy(true); setMsgHits([]); setMsgDone("");
    try {
      const convs = await api.convs();
      const hits = [];
      for (const c of (convs || []).slice(0, 25)) {
        let raw = [];
        try { raw = await api.messages(c.conv_id); } catch { continue; }
        for (const m of raw || []) {
          if (!m.envelope) continue;
          let text = "";
          try {
            const pt = await decryptAny(m, user);
            if (pt == null) continue;
            text = unpackMessage(pt).text || "";
          } catch { continue; }
          if (text.toLowerCase().indexOf(term) >= 0) {
            hits.push({
              id: m.message_id, conv_id: c.conv_id,
              title: c.title || (c.title_lns || "Chat").split("@")[0],
              others: c.others || (c.title_lns ? [c.title_lns] : []),
              text, at: m.sent_at || m.created_at, mine: !!m.mine,
            });
          }
          if (hits.length >= 60) break;
        }
        if (hits.length >= 60) break;
      }
      setMsgHits(hits);
      setMsgDone(hits.length ? "" : (lang === "en" ? "No message found." : "Nessun messaggio trovato."));
    } catch (e) {
      setMsgDone(lang === "en" ? "Search failed." : "Ricerca non riuscita.");
    } finally { setMsgBusy(false); }
  }, [dq, user, lang]);

  useEffect(() => { setMsgHits([]); setMsgDone(""); }, [dq]);

  const openMsg = useCallback((h) => {
    Keyboard.dismiss();
    navigation.replace("Chat", { conv_id: h.conv_id, others: h.others, title: h.title, title_lns: h.others[0] });
  }, [navigation]);

  const sections = [];
  if (foundContacts.length) sections.push({ type: "header", key: "h-c", label: t("search.colleagues") });
  foundContacts.forEach((c) => sections.push({ type: "contact", key: "c-" + c.lns, c }));
  if (foundMails.length) sections.push({ type: "header", key: "h-m", label: t("search.mails") });
  foundMails.forEach((m) => sections.push({ type: "mail", key: "m-" + m.mail_id, m }));
  if (groups.length) sections.push({ type: "header", key: "h-g", label: "GRUPPI PUBBLICI" });
  groups.forEach((g) => sections.push({ type: "group", key: "g-" + g.chan_id, g }));
  if (dq.trim().length >= 2) {
    sections.push({ type: "header", key: "h-msg", label: lang === "en" ? "MESSAGES" : "MESSAGGI" });
    if (!msgHits.length) sections.push({ type: "msgcta", key: "msg-cta" });
    msgHits.forEach((h) => sections.push({ type: "msg", key: "mh-" + h.id, h }));
  }

  const renderItem = ({ item }) => {
    if (item.type === "header") return <Text style={styles.sectionLabel}>{item.label}</Text>;
    if (item.type === "contact") {
      const c = item.c;
      return (
        <View style={styles.row} testID="search-contact-row">
          <Avatar seed={c.lns} label={c.display_name || c.lns} online={!!c.online} uri={c.avatar || undefined} />
          <View style={styles.info}>
            <Text style={styles.name} numberOfLines={1}>{c.display_name || c.lns.split("@")[0]}</Text>
            <Text style={styles.sub} numberOfLines={1}>{c.lns}{c.department ? "  ·  " + c.department : ""}</Text>
          </View>
          <TouchableOpacity style={[styles.action, { borderColor: theme.accent + "66" }]} onPress={() => openChat(c)} testID="search-chat-btn">
            <Ionicons name="chatbubble-ellipses-outline" size={17} color={theme.accent} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.action, { borderColor: theme.primary + "66" }]} onPress={() => openMail(c)} testID="search-mail-btn">
            <Ionicons name="mail-outline" size={17} color={theme.primary} />
          </TouchableOpacity>
        </View>
      );
    }
    if (item.type === "msgcta") {
      return (
        <TouchableOpacity style={styles.row} onPress={searchMessages} disabled={msgBusy} testID="search-messages-cta">
          <View style={styles.mailIcon}>
            {msgBusy ? <ActivityIndicator size="small" color={theme.primary} /> : <Ionicons name="chatbubbles-outline" size={18} color={theme.primary} />}
          </View>
          <View style={styles.info}>
            <Text style={styles.name}>
              {msgBusy ? (lang === "en" ? "Searching in chats…" : "Cerco nelle chat…") : (lang === "en" ? "Search inside chats" : "Cerca dentro le chat")}
            </Text>
            <Text style={styles.sub} numberOfLines={2}>
              {msgDone || (lang === "en" ? "Messages are encrypted: they are decrypted here on your phone." : "I messaggi sono cifrati: vengono decifrati qui sul telefono.")}
            </Text>
          </View>
        </TouchableOpacity>
      );
    }
    if (item.type === "msg") {
      const h = item.h;
      return (
        <TouchableOpacity style={styles.row} onPress={() => openMsg(h)} testID="search-message-row">
          <View style={styles.mailIcon}><Ionicons name="chatbubble-ellipses-outline" size={18} color={theme.accent} /></View>
          <View style={styles.info}>
            <Text style={styles.name} numberOfLines={1}>{h.title}</Text>
            <Text style={styles.sub} numberOfLines={2}>{(h.mine ? (lang === "en" ? "You: " : "Tu: ") : "") + h.text}</Text>
          </View>
        </TouchableOpacity>
      );
    }
    if (item.type === "group") {
      const g = item.g;
      const state = g.my_state || "none";
      return (
        <View style={styles.row} testID="search-group-row">
          <View style={styles.mailIcon}><Ionicons name="people-outline" size={18} color={theme.accent} /></View>
          <View style={styles.info}>
            <Text style={styles.name} numberOfLines={1}>{g.name}</Text>
            <Text style={styles.sub} numberOfLines={1}>
              {g.member_count} membri  ·  admin {g.owner_name || g.owner_lns}
            </Text>
          </View>
          {state === "member" ? (
            <TouchableOpacity style={[styles.action, { borderColor: theme.accent + "66" }]} onPress={() => openGroup(g)} testID="search-group-open">
              <Ionicons name="arrow-forward-outline" size={17} color={theme.accent} />
            </TouchableOpacity>
          ) : state === "pending" ? (
            <Text style={[styles.sub, { color: "#50C878", fontWeight: "700" }]} testID="search-group-pending">IN ATTESA</Text>
          ) : (
            <TouchableOpacity style={styles.joinBtn} onPress={() => askJoin(g)} disabled={joining === g.chan_id} testID="search-group-join">
              <Text style={styles.joinTxt}>{joining === g.chan_id ? "…" : "Chiedi di entrare"}</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }
    const m = item.m;
    return (
      <TouchableOpacity style={styles.row} onPress={() => openMailDetail(m)} testID="search-mail-row">
        <View style={styles.mailIcon}><Ionicons name="shield-checkmark-outline" size={18} color={theme.primary} /></View>
        <View style={styles.info}>
          <Text style={[styles.name, !m.read_at && { fontWeight: "800" }]} numberOfLines={1}>{m.subject || "—"}</Text>
          <Text style={styles.sub} numberOfLines={1}>{m.sender_lns}</Text>
        </View>
        <Ionicons name="chevron-forward-outline" size={18} color={theme.textFaint} />
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.searchBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} testID="search-back">
          <Ionicons name="arrow-back-outline" size={22} color={theme.text} />
        </TouchableOpacity>
        <Ionicons name="search-outline" size={18} color={theme.textFaint} />
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={q}
          onChangeText={setQ}
          placeholder={t("search.placeholder")}
          placeholderTextColor={theme.textFaint}
          selectionColor={theme.primary}
          cursorColor={theme.text}
          keyboardAppearance="dark"
          underlineColorAndroid="transparent"
          autoCapitalize="none"
          autoCorrect={false}
          testID="global-search-input"
        />
        {q ? <TouchableOpacity onPress={() => setQ("")} hitSlop={10}><Ionicons name="close-outline" size={18} color={theme.textFaint} /></TouchableOpacity> : null}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.primary} /></View>
      ) : (
        <FlatList
          data={sections}
          keyExtractor={(i) => i.key}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          contentContainerStyle={sections.length === 0 ? { flexGrow: 1 } : { paddingBottom: 30 }}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="search-outline" size={34} color={theme.border} />
              <Text style={styles.hint}>{sq ? t("search.empty") : t("search.hint")}</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  searchBar: {
    flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 14, marginTop: 8,
    backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingHorizontal: 12,
  },
  input: { flex: 1, color: theme.text, fontSize: 15, paddingVertical: 11 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 30 },
  hint: { color: theme.textFaint, fontSize: 14, textAlign: "center" },
  sectionLabel: { color: theme.textFaint, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 11 },
  info: { flex: 1, minWidth: 0 },
  name: { color: theme.text, fontSize: 15, fontWeight: "600" },
  sub: { color: theme.textFaint, fontSize: 12, marginTop: 1 },
  action: { width: 38, height: 38, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  mailIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.primary + "1A", alignItems: "center", justifyContent: "center" },
  joinBtn: { borderWidth: 1, borderColor: theme.primary + "88", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 },
  joinTxt: { color: theme.primary, fontSize: 12, fontWeight: "700" },
});

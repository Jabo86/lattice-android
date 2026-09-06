import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
  Modal, TextInput, ActivityIndicator, Alert, Image,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { pickAvatarDataUrl } from "../lib/avatar";
import { UpdateBanner } from "../components/UpdateBanner";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../lib/i18n";
import * as api from "../lib/api";
import { SkeletonList } from "../components/Skeleton";
import CanaryReminder from "../components/CanaryReminder";
import { useTint } from "../lib/appearance";
import { theme } from "../theme";
import Avatar from "../components/Avatar";
import TrialBanner from "../components/TrialBanner";
import * as Notifications from "expo-notifications";
import { generateGroupKey, wrapGroupKeyFor, bytesToHex, anonSharedSecret } from "../lib/crypto";
import { discRid, anonEpochs, openInvite } from "../lib/anonCall";
import { missedCallCount } from "../lib/store";
import { usePoll, useActivePoll } from "../lib/usePoll";

export default function ConversationsScreen({ navigation }) {
  const tint = useTint();
  const styles = useMemo(() => makeStyles(tint), [tint]);
  const { user, signOut } = useAuth();
  const { t, lang } = useI18n();
  const insets = useSafeAreaInsets();
  const [convs, setConvs] = useState([]);
  const [booted, setBooted] = useState(false);
  const [totalUnread, setTotalUnread] = useState(0);
  const [missedCalls, setMissedCalls] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [lns, setLns] = useState("");
  const [adding, setAdding] = useState(false);
  const [addErr, setAddErr] = useState("");
  const [contacts, setContacts] = useState([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [showGroup, setShowGroup] = useState(false);
  const [gName, setGName] = useState("");
  const [gDesc, setGDesc] = useState("");
  const [gAvatar, setGAvatar] = useState("");
  const [gSel, setGSel] = useState({});
  const [gBusy, setGBusy] = useState(false);
  const [gErr, setGErr] = useState("");
  const mounted = useRef(true);

  const timeAgo = useCallback((iso) => {
    if (!iso) return "";
    const d = new Date(iso).getTime();
    if (isNaN(d)) return "";
    const sec = Math.floor((Date.now() - d) / 1000);
    if (sec < 60) return t("conv.now");
    if (sec < 3600) return `${Math.floor(sec / 60)} ${t("conv.min")}`;
    if (sec < 86400) return `${Math.floor(sec / 3600)} ${t("conv.hour")}`;
    return new Date(d).toLocaleDateString(lang === "en" ? "en-GB" : "it-IT", { day: "2-digit", month: "2-digit" });
  }, [t, lang]);

  const load = useCallback(async () => {
    try {
      const [cs, gs] = await Promise.all([api.convs().catch(() => []), api.channels().catch(() => [])]);
      // Rubrica cieca: i nomi si imparano da qui, senza chiedere niente al server.
      try {
        const book = require("../lib/book");
        for (const c of Array.isArray(cs) ? cs : []) {
          if (c && Array.isArray(c.others) && c.others.length === 1 && c.title) book.learnName(c.others[0], c.title);
        }
      } catch { /* rubrica non disponibile */ }
      const groups = (Array.isArray(gs) ? gs : []).map((g) => ({
        conv_id: g.chan_id, title: g.name, title_lns: g.name, is_group: true, avatar: g.avatar || null,
        unread: g.unread || 0, unread_by: Array.isArray(g.unread_by) ? g.unread_by : [], last_from: g.last_from || null,
        member_count: g.member_count, is_admin: g.is_admin, last_at: g.last_post_at,
      }));
      const list = [...(Array.isArray(cs) ? cs : []), ...groups];
      list.sort((a, b) => String(b.last_at || "").localeCompare(String(a.last_at || "")));
      if (mounted.current) setConvs(list);
      const total = list.reduce((n, c) => n + (c.unread || 0), 0);
      if (mounted.current) setTotalUnread(total);
      try { await Notifications.setBadgeCountAsync(total); } catch {}
      try { const mc = await missedCallCount(); if (mounted.current) setMissedCalls(mc); } catch {}
    } catch { /* keep last */ }
    finally { if (mounted.current) setBooted(true); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    load();
    const unsub = navigation.addListener("focus", load);
    return () => { mounted.current = false; unsub(); };
  }, [load, navigation]);

  // Lista conversazioni: aggiornata solo quando la stai guardando.
  usePoll(load, 8000, { runOnFocus: false });

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  // Poller chiamate in arrivo BLIND (foreground): il server NON sa chi chiama chi.
  // Deriviamo per ogni contatto le caselle anonime (rid) dal segreto condiviso e le interroghiamo.
  const lastCall = useRef(null);
  const dhCache = useRef({});
  // I segreti pairwise (X25519) si calcolano UNA volta per contatto, i rid una volta per
  // finestra di 30 s: privacy identica, una frazione del lavoro di prima.
  const sharedCache = useRef({});
  const ridCache = useRef({ key: "", map: {} });
  useActivePoll(async () => {
      try {
        if (!user?.dh?.secretKey || !user?.kem?.secretKey || !user?.lns || !contacts.length) return;
        const need = contacts.map((c) => c.lns).filter((l) => l && !dhCache.current[l]);
        if (need.length) { const m = await api.pulseDhKeys(need); Object.assign(dhCache.current, m || {}); }
        const eps = anonEpochs();
        const ckey = eps.join(",") + "|" + contacts.map((c) => c.lns).join(",");
        if (ridCache.current.key !== ckey) {
          const map = {};
          for (const c of contacts) {
            const dh = dhCache.current[c.lns]; if (!dh) continue;
            let shared = sharedCache.current[c.lns];
            if (!shared) { shared = anonSharedSecret(user.dh.secretKey, dh); sharedCache.current[c.lns] = shared; }
            for (const e of eps) map[discRid(shared, c.lns, user.lns, e)] = c.lns;
          }
          ridCache.current = { key: ckey, map };
        }
        const ridToShared = ridCache.current.map;
        const rids = Object.keys(ridToShared); if (!rids.length) return;
        const res = await api.anonPoll(rids);
        const hits = Array.isArray(res?.hits) ? res.hits : (Array.isArray(res) ? res : []);
        for (const rid of hits) {
          let got; try { got = await api.anonGet(rid, 0, 0); } catch { continue; }
          const env = got && (got.ping || got.data || got.slot);
          if (!env) continue;
          let inv = null; try { inv = openInvite(env, user.kem.secretKey); } catch {}
          if (inv && inv.chan && inv.chan !== lastCall.current && inv.offer) {
            lastCall.current = inv.chan;
            navigation.navigate("Call", { incoming: true, from: inv.from, to_name: (inv.from || "").split("@")[0], video: !!inv.video, chan: inv.chan, offer: inv.offer, offer_sig: inv.offer_sig, from_pk: inv.from_pk, from_kem: inv.from_kem });
            break;
          }
        }
      } catch {}
    // 1,5 secondi: è il ritardo massimo dello squillo. Con 4 secondi la chiamata poteva
    // arrivare quando l'altro aveva già riagganciato. Il giro è una sola richiesta con i
    // rid già in cache, quindi costa poco.
  }, 1500);

  // Riepilogo "chi ha scritto + quanti non letti" per ogni profilo/gruppo.
  const unreadSummary = useCallback((item) => {
    if (!item?.unread) return "";
    if (item.is_group && Array.isArray(item.unread_by) && item.unread_by.length) {
      const parts = item.unread_by.slice(0, 3).map((u) => `${u.name} ${u.count}`);
      if (item.unread_by.length > 3) parts.push("…");
      return parts.join(" · ");
    }
    const one = item.unread === 1;
    return `${item.unread} ${lang === "en" ? (one ? "new message" : "new messages") : (one ? "nuovo messaggio" : "nuovi messaggi")}`;
  }, [lang]);

  const openNew = useCallback(async () => {
    setShowNew(true); setAddErr(""); setLns(""); setLoadingContacts(true);
    try {
      const d = await api.contacts();
      if (mounted.current) setContacts(Array.isArray(d) ? d : []);
    } catch { /* keep */ }
    finally { if (mounted.current) setLoadingContacts(false); }
  }, []);

  const startWithContact = (c) => {
    setShowNew(false); setLns("");
    navigation.navigate("Chat", { conv_id: null, others: [c.lns], title: c.display_name || c.lns.split("@")[0], title_lns: c.lns });
  };

  const startChat = async () => {
    const target = api.normalizeLns(lns);
    if (!target || !target.includes("@")) { setAddErr(t("conv.new.invalid")); return; }
    setAdding(true); setAddErr("");
    try {
      const r = await api.addContact(target);
      const tt = r?.contact?.lns || target;
      setShowNew(false); setLns("");
      navigation.navigate("Chat", { conv_id: null, others: [tt], title: tt.split("@")[0], title_lns: tt });
    } catch (e) { setAddErr(api.apiErr(e)); }
    finally { setAdding(false); }
  };

  const openConv = (c) => {
    if (c.is_group) { navigation.navigate("ChannelDetail", { chan_id: c.conv_id, name: c.title }); return; }
    navigation.navigate("Chat", {
      conv_id: c.conv_id,
      others: c.others || (c.title_lns ? [c.title_lns] : []),
      title: c.title || (c.title_lns || "").split("@")[0],
      title_lns: c.title_lns,
    });
  };

  const openGroup = useCallback(async () => {
    setShowGroup(true); setGErr(""); setGName(""); setGDesc(""); setGAvatar(""); setGSel({}); setLoadingContacts(true);
    try { const d = await api.contacts(); if (mounted.current) setContacts((Array.isArray(d) ? d : []).filter((c) => c.has_key)); }
    catch { /* */ } finally { if (mounted.current) setLoadingContacts(false); }
  }, []);
  const toggleG = (lns) => setGSel((s) => ({ ...s, [lns]: !s[lns] }));
  const gChosen = Object.keys(gSel).filter((k) => gSel[k]);
  const pickGroupAvatar = async () => {
    const { dataUrl } = await pickAvatarDataUrl();
    if (dataUrl) setGAvatar(dataUrl);
  };

  const createGroup = async () => {
    if (!gName.trim()) { setGErr(t("groups.nameRequired")); return; }
    if (gChosen.length === 0) { setGErr(t("groups.pickAtLeastOne")); return; }
    if (!user?.kem) { setGErr(t("channels.cannotDecrypt")); return; }
    setGBusy(true); setGErr("");
    try {
      const gk = generateGroupKey();
      const keyMap = await api.pulseKeys(gChosen);
      keyMap[user.lns] = bytesToHex(user.kem.publicKey);
      const members = [{ lns: user.lns, role: "admin", key_env: wrapGroupKeyFor(gk, keyMap[user.lns]) }];
      for (const lns of gChosen) { if (keyMap[lns]) members.push({ lns, role: "member", key_env: wrapGroupKeyFor(gk, keyMap[lns]) }); }
      // Il nome vero è cifrato con la chiave di gruppo: al server arriva solo un'etichetta
      // fissa, uguale per tutti i gruppi.
      const gnameLib = require("../lib/gname");
      const r = await api.channelCreate({
        name: gnameLib.PLACEHOLDER, name_enc: gnameLib.sealName(gName.trim(), gk),
        description: gDesc.trim(), avatar: gAvatar, key_version: 1, members,
      });
      setShowGroup(false); await load();
      navigation.navigate("ChannelDetail", { chan_id: r.chan_id, name: gName.trim() });
    } catch (e) { setGErr(api.apiErr(e)); } finally { setGBusy(false); }
  };

  // `renderItem` era una funzione NUOVA a ogni disegno: VirtualizedList la confronta per
  // identita, quindi ogni battito del poll (4 s) ridisegnava TUTTE le righe visibili anche
  // se non era cambiato niente. Con `useCallback` le righe restano ferme finche non cambia
  // davvero qualcosa che le riguarda: e' la differenza fra scorrere liscio e scorrere a scatti.
  const renderItem = useCallback(({ item }) => (
    <TouchableOpacity style={styles.row} onPress={() => openConv(item)} testID="conv-row">
      {item.is_group ? (
        item.avatar ? (
          <Image source={{ uri: item.avatar }} style={styles.groupAvatarImg} />
        ) : (
          <View style={styles.groupAvatar}><Ionicons name="people-outline" size={22} color={tint} /></View>
        )
      ) : (
        <Avatar seed={item.title_lns} label={item.title} online={!!item.online} uri={item.avatar || undefined} />
      )}
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.rowTitle} numberOfLines={1}>{item.title || item.title_lns}</Text>
          <Text style={styles.rowTime}>{timeAgo(item.last_at)}</Text>
        </View>
        <View style={styles.rowTop}>
          {item.unread > 0 ? (
            <Text style={styles.rowUnreadSub} numberOfLines={1} testID="conv-unread-summary">{unreadSummary(item)}</Text>
          ) : (
            <Text style={styles.rowSub} numberOfLines={1}>{item.is_group ? `${item.member_count} ${t("groups.membersCount")}` : (item.company_name || item.title_lns)}</Text>
          )}
          {item.unread > 0 && (
            <View style={styles.badge}><Text style={styles.badgeText}>{item.unread}</Text></View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  ), [styles, openConv, timeAgo, unreadSummary, tint, t]);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <UpdateBanner />
      <CanaryReminder user={user} t={t} />
      <View style={styles.header}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Image source={require("../../assets/lattice-logo.png")} style={styles.logo} resizeMode="contain" />
          <View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={styles.hTitle}>Lattice</Text>
              {totalUnread > 0 && (
                <View style={styles.totalBadge} testID="conv-total-unread"><Text style={styles.totalBadgeTxt}>{totalUnread}</Text></View>
              )}
            </View>
            <Text style={styles.hSub} numberOfLines={1}>{user?.lns}</Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
          <TouchableOpacity onPress={() => navigation.navigate("CallLog")} testID="calllog-btn" hitSlop={8}>
            <Ionicons name="call-outline" size={22} color={tint} />
            {missedCalls > 0 && (
              <View style={styles.callBadge} testID="calllog-missed-badge">
                <Text style={styles.callBadgeTxt}>{missedCalls > 9 ? "9+" : missedCalls}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate("Status")} testID="status-btn" hitSlop={8}>
            <Ionicons name="aperture-outline" size={22} color={tint} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate("GlobalSearch")} testID="global-search-btn" hitSlop={8}>
            <Ionicons name="search-outline" size={22} color={tint} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => Alert.alert(t("signout.confirm.title"), t("signout.confirm.text"), [
            { text: t("cancel"), style: "cancel" },
            { text: t("signout"), style: "destructive", onPress: signOut },
          ])} testID="signout-btn">
            <Text style={styles.signout}>{t("signout")}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <TrialBanner />

      <FlatList
        data={convs}
        keyExtractor={(c) => c.conv_id}
        renderItem={renderItem}
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={9}
        removeClippedSubviews
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tint} />}
        ListEmptyComponent={
          !booted ? (
            <SkeletonList count={7} testID="conv-skeleton" />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{t("conv.empty.title")}</Text>
              <Text style={styles.emptyText}>{t("conv.empty.text")}</Text>
            </View>
          )
        }
        contentContainerStyle={convs.length === 0 && booted ? { flex: 1 } : { paddingBottom: 100 }}
      />

      <TouchableOpacity style={styles.fabGroup} onPress={openGroup} testID="new-group-fab">
        <Ionicons name="people-outline" size={24} color="#fff" />
      </TouchableOpacity>
      <TouchableOpacity style={styles.fab} onPress={openNew} testID="new-chat-fab">
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      <Modal visible={showNew} transparent animationType="slide" onRequestClose={() => setShowNew(false)}>
        <KeyboardAvoidingView style={styles.modalWrap} behavior="padding">
          <View style={[styles.modal, { paddingBottom: Math.max(insets.bottom, 14) + 14 }]}>
            <Text style={styles.modalTitle}>{t("conv.new.title")}</Text>

            <Text style={styles.sectionLabel}>{t("conv.new.colleagues")}</Text>
            {loadingContacts ? (
              <SkeletonList count={5} testID="contacts-skeleton" />
            ) : contacts.length === 0 ? (
              <Text style={styles.contactsEmpty}>{t("conv.new.noColleagues")}</Text>
            ) : (
              <FlatList
                data={contacts}
                keyExtractor={(c) => c.lns}
                style={styles.contactsList}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.contactRow} onPress={() => startWithContact(item)} testID="new-chat-colleague">
                    <Avatar seed={item.lns} label={item.display_name || item.lns} online={!!item.online} uri={item.avatar || undefined} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.contactName} numberOfLines={1}>{item.display_name || item.lns.split("@")[0]}</Text>
                      <Text style={styles.contactLns} numberOfLines={1}>{item.lns}</Text>
                    </View>
                  </TouchableOpacity>
                )}
              />
            )}

            <Text style={styles.sectionLabel}>{t("conv.new.orExternal")}</Text>
            <TextInput
              style={styles.input}
              placeholder="mario@azienda.lns"
              placeholderTextColor={theme.textFaint}
              value={lns}
              onChangeText={setLns}
              selectionColor={tint}
              cursorColor={theme.text}
              keyboardAppearance="dark"
              underlineColorAndroid="transparent"
              autoCapitalize="none"
              autoCorrect={false}
              testID="new-chat-lns"
            />
            {!!addErr && <Text style={styles.modalErr} testID="new-chat-error">{addErr}</Text>}
            <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setShowNew(false)}>
                <Text style={styles.modalCancelText}>{t("cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalOk} onPress={startChat} disabled={adding} testID="new-chat-start">
                {adding ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalOkText}>{t("start")}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showGroup} transparent animationType="slide" onRequestClose={() => setShowGroup(false)}>
        <KeyboardAvoidingView style={styles.modalWrap} behavior="padding">
          <View style={[styles.modal, { paddingBottom: Math.max(insets.bottom, 14) + 14 }]}>
            <Text style={styles.modalTitle}>{t("groups.new")}</Text>
            <Text style={styles.modalSub}>{t("groups.subtitle")}</Text>
            <TouchableOpacity style={styles.gAvatarBtn} onPress={pickGroupAvatar} testID="group-avatar-btn">
              {gAvatar ? <Image source={{ uri: gAvatar }} style={styles.gAvatarImg} /> : <Ionicons name="people-outline" size={30} color={tint} />}
              <Text style={styles.gAvatarTxt}>{lang === "en" ? "PHOTO" : "FOTO"}</Text>
            </TouchableOpacity>
            <TextInput style={styles.input} placeholder={t("groups.name")} placeholderTextColor={theme.textFaint} selectionColor={tint} cursorColor={theme.text} keyboardAppearance="dark" underlineColorAndroid="transparent" value={gName} onChangeText={setGName} testID="group-name-input" />
            <TextInput style={[styles.input, { marginTop: 10 }]} placeholder={lang === "en" ? "Description (optional)" : "Descrizione (facoltativa)"} placeholderTextColor={theme.textFaint} selectionColor={tint} cursorColor={theme.text} keyboardAppearance="dark" underlineColorAndroid="transparent" value={gDesc} onChangeText={setGDesc} testID="group-desc-input" />
            <Text style={styles.sectionLabel}>{t("groups.selectMembers")} ({gChosen.length})</Text>
            {loadingContacts ? (
              <SkeletonList count={5} testID="gcontacts-skeleton" />
            ) : (
              <FlatList
                data={contacts}
                keyExtractor={(c) => c.lns}
                style={styles.contactsList}
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={<Text style={styles.contactsEmpty}>{t("groups.noMembers")}</Text>}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.contactRow} onPress={() => toggleG(item.lns)} testID="group-member-option">
                    <Ionicons name={gSel[item.lns] ? "checkbox" : "square-outline"} size={22} color={gSel[item.lns] ? tint : theme.textFaint} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.contactName} numberOfLines={1}>{item.display_name || item.lns.split("@")[0]}</Text>
                      <Text style={styles.contactLns} numberOfLines={1}>{item.lns}{item.same_company ? "" : (lang === "en" ? "  · external" : "  · esterno")}</Text>
                    </View>
                  </TouchableOpacity>
                )}
              />
            )}
            {!!gErr && <Text style={styles.modalErr}>{gErr}</Text>}
            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setShowGroup(false)}><Text style={styles.modalCancelText}>{t("cancel")}</Text></TouchableOpacity>
              <TouchableOpacity style={styles.modalOk} onPress={createGroup} disabled={gBusy} testID="group-create-submit">
                {gBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalOkText}>{t("groups.create")}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (tint) => StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.border },
  logo: { width: 38, height: 38, borderRadius: 10 },
  hTitle: { color: theme.text, fontSize: 20, fontWeight: "800" },
  hSub: { color: theme.textDim, fontSize: 11, maxWidth: 200 },
  signout: { color: theme.danger, fontSize: 14, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.surface },
  rowBody: { flex: 1 },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rowTitle: { color: theme.text, fontSize: 16, fontWeight: "700", flex: 1 },
  rowTime: { color: theme.textFaint, fontSize: 12 },
  rowSub: { color: theme.textDim, fontSize: 12, flex: 1, marginTop: 3 },
  rowUnreadSub: { color: theme.accent, fontSize: 12.5, flex: 1, marginTop: 3, fontWeight: "800" },
  badge: { backgroundColor: theme.accent, minWidth: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  badgeText: { color: "#03120A", fontSize: 11, fontWeight: "800" },
  totalBadge: { backgroundColor: "#e0364f", minWidth: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", paddingHorizontal: 7 },
  callBadge: { position: "absolute", top: -6, right: -8, backgroundColor: "#e0364f", minWidth: 17, height: 17, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 4, borderWidth: 1.5, borderColor: theme.bg },
  callBadgeTxt: { color: "#fff", fontSize: 10, fontWeight: "900" },
  totalBadgeTxt: { color: "#fff", fontSize: 12, fontWeight: "900" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  emptyTitle: { color: theme.text, fontSize: 18, fontWeight: "700", marginBottom: 8 },
  emptyText: { color: theme.textDim, fontSize: 14, textAlign: "center", lineHeight: 20 },
  fab: { position: "absolute", right: 22, bottom: 30, width: 58, height: 58, borderRadius: 29, backgroundColor: tint, alignItems: "center", justifyContent: "center", shadowColor: tint, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  fabGroup: { position: "absolute", right: 22, bottom: 98, width: 52, height: 52, borderRadius: 26, backgroundColor: theme.surfaceAlt, borderWidth: 1, borderColor: tint, alignItems: "center", justifyContent: "center", elevation: 6 },
  fabText: { color: "#fff", fontSize: 32, fontWeight: "300", marginTop: -2 },
  groupAvatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: "rgba(80,200,120,0.15)", alignItems: "center", justifyContent: "center" },
  groupAvatarImg: { width: 46, height: 46, borderRadius: 23, backgroundColor: theme.surfaceAlt },
  gAvatarBtn: { alignSelf: "center", width: 84, height: 84, borderRadius: 42, overflow: "hidden", backgroundColor: "rgba(80,200,120,0.15)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  gAvatarImg: { width: "100%", height: "100%" },
  gAvatarTxt: { position: "absolute", bottom: 0, left: 0, right: 0, textAlign: "center", backgroundColor: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 8, paddingVertical: 2, letterSpacing: 1 },
  modalWrap: { flex: 1, backgroundColor: "#000A", justifyContent: "flex-end" },
  modal: { backgroundColor: theme.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 24, borderTopWidth: 1, borderColor: theme.border },
  modalTitle: { color: theme.text, fontSize: 20, fontWeight: "800", marginBottom: 6 },
  modalSub: { color: theme.textDim, fontSize: 13, marginBottom: 16 },
  sectionLabel: { color: theme.textDim, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginTop: 14, marginBottom: 8 },
  contactsList: { maxHeight: 260 },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 9 },
  contactName: { color: theme.text, fontSize: 15, fontWeight: "700" },
  contactLns: { color: theme.accent, fontSize: 11, marginTop: 1 },
  contactsLoading: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 14 },
  contactsLoadingText: { color: theme.textDim, fontSize: 13 },
  contactsEmpty: { color: theme.textFaint, fontSize: 13, paddingVertical: 14 },
  input: { backgroundColor: theme.surfaceAlt, borderColor: theme.border, borderWidth: 1, borderRadius: 12, color: theme.text, paddingHorizontal: 14, paddingVertical: 14, fontSize: 15, includeFontPadding: false },
  modalErr: { color: "#FFB3BD", fontSize: 13, marginTop: 10 },
  modalCancel: { flex: 1, paddingVertical: 15, borderRadius: 12, alignItems: "center", backgroundColor: theme.surfaceAlt },
  modalCancelText: { color: theme.textDim, fontWeight: "700" },
  modalOk: { flex: 1, paddingVertical: 15, borderRadius: 12, alignItems: "center", backgroundColor: tint },
  modalOkText: { color: "#fff", fontWeight: "700" },
});

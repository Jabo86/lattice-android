import React, { useState, useCallback, useRef, useMemo, useEffect } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
  TextInput, ActivityIndicator, Alert, Modal, Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../lib/i18n";
import { useFocusEffect } from "@react-navigation/native";
import * as api from "../lib/api";
import { useTint } from "../lib/appearance";
import { theme } from "../theme";
import Avatar from "../components/Avatar";
import { useUnread } from "../context/UnreadContext";
import { getVerified } from "../lib/verify";

export default function AddressBookScreen({ navigation, route }) {
  const tint = useTint();
  const styles = useMemo(() => makeStyles(tint), [tint]);
  const { t, lang } = useI18n();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [menuFor, setMenuFor] = useState(null);
  const [reqBusy, setReqBusy] = useState(null);
  const { refresh: refreshBadges } = useUnread();
  const [dirResults, setDirResults] = useState([]);
  const [dirBusy, setDirBusy] = useState(false);
  const dirTimer = useRef(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      // RUBRICA ISTANTANEA: prima si disegna quella che è già sul telefono (cifrata, nessuna
      // rete), poi si completa con quello che il server aggiunge (colleghi d'azienda, stato).
      try {
        const book = require("../lib/book");
        const local = await book.list();
        if (mounted.current && local.length) {
          setContacts(local.map((e) => ({
            lns: e.lns, display_name: e.name || String(e.lns).split("@")[0], avatar: e.avatar || null,
            role: null, department: null, company_name: null, online: false,
            has_key: e.has_key !== false, same_company: false, blind: true,
            favorite: !!e.favorite, blocked: !!e.blocked, in_my_book: true, they_have_me: true, mutual: true,
          })).sort((a, b) => a.display_name.toLowerCase().localeCompare(b.display_name.toLowerCase())));
          setLoading(false);
        }
      } catch { /* si aspetta il server */ }
      const d = await api.contacts();
      if (mounted.current) setContacts(Array.isArray(d) ? d : []);
    } catch (e) {
      if (mounted.current) Alert.alert("Errore", api.apiErr(e));
    } finally {
      if (mounted.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  useFocusEffect(useCallback(() => {
    mounted.current = true;
    load();
    return () => { mounted.current = false; };
  }, [load]));

  const sq = q.trim().toLowerCase();
  // Richiesta in arrivo = chi mi ha in rubrica ma che io non ho ancora aggiunto.
  const incoming = useMemo(
    () => contacts.filter((c) => c.they_have_me && c.in_my_book === false && !c.blocked && !c.blind),
    [contacts]);
  const base = useMemo(() => {
    const pend = new Set(incoming.map((c) => c.lns));
    return contacts.filter((c) => !pend.has(c.lns));
  }, [contacts, incoming]);
  const filtered = useMemo(() => (sq
    ? base.filter((c) => c.lns.includes(sq) || (c.display_name || "").toLowerCase().includes(sq) || (c.company_name || "").toLowerCase().includes(sq))
    : base), [base, sq]);

  const candidate = api.normalizeLns(q);
  const canAdd = candidate.includes("@") && candidate.endsWith(".lns") && !contacts.some((c) => c.lns === candidate);

  // Directory pubblica: cerca gli utenti personali @lattice.lns che si sono resi ricercabili.
  useEffect(() => {
    const term = sq.replace(/[^a-z0-9._-]/g, "");
    if (term.length < 2) { setDirResults([]); return; }
    if (dirTimer.current) clearTimeout(dirTimer.current);
    dirTimer.current = setTimeout(async () => {
      setDirBusy(true);
      try {
        const r = await api.directorySearch(term);
        const known = new Set(contacts.map((c) => c.lns));
        setDirResults((r?.results || []).filter((x) => !known.has(x.lns)));
      } catch { setDirResults([]); }
      finally { setDirBusy(false); }
    }, 450);
    return () => dirTimer.current && clearTimeout(dirTimer.current);
  }, [sq, contacts]);

  const addFromDirectory = async (lns) => {
    setAdding(true);
    try { await api.addContact(lns); setQ(""); setDirResults([]); load(); }
    catch (e) { Alert.alert("Errore", api.apiErr(e)); }
    finally { setAdding(false); }
  };

  const acceptRequest = async (c) => {
    setReqBusy(c.lns);
    try {
      await api.addContact(c.lns, { name: c.display_name || undefined, avatar: c.avatar || undefined });
      await load(); refreshBadges?.();
      // Appena c'è reciprocità conviene confrontare il numero di sicurezza.
      const already = await getVerified(c.lns);
      if (!already) {
        const name = c.display_name || c.lns.split("@")[0];
        Alert.alert(t("vfy.title"), t("vfy.askBody", { name }), [
          { text: t("vfy.later"), style: "cancel" },
          { text: t("vfy.now"), onPress: () => navigation.navigate("VerifyContact", { peer: c.lns, peer_name: name }) },
        ]);
      }
    }
    catch (e) { Alert.alert("Errore", api.apiErr(e)); }
    finally { setReqBusy(null); }
  };
  const ignoreRequest = (c) => {
    const name = c.display_name || c.lns;
    Alert.alert(t("book.ignoreTitle"), t("book.ignoreAsk", { name }), [
      { text: t("book.cancel"), style: "cancel" },
      {
        text: t("book.ignore"), style: "destructive",
        onPress: async () => {
          setReqBusy(c.lns);
          try { await api.blockContact(c.lns, true); await load(); refreshBadges?.(); }
          catch (e) { Alert.alert("Errore", api.apiErr(e)); }
          finally { setReqBusy(null); }
        },
      },
    ]);
  };

  // Arrivo dalla notifica "ti hanno aggiunto in rubrica": proponiamo l'aggiunta reciproca.
  const focusLns = route?.params?.focusLns || null;
  useEffect(() => {
    if (!focusLns || loading) return;
    const already = contacts.some((c) => (c.lns || "").toLowerCase() === String(focusLns).toLowerCase());
    navigation.setParams?.({ focusLns: null });
    if (already) return;
    const who = String(focusLns).split("@")[0];
    Alert.alert(
      lang === "en" ? "New contact" : "Nuovo contatto",
      who + (lang === "en"
        ? " has added you to their address book. Add them too so you can write to each other."
        : " ti ha aggiunto in rubrica. Aggiungilo anche tu per potervi scrivere."),
      [
        { text: lang === "en" ? "Later" : "Più tardi", style: "cancel" },
        { text: lang === "en" ? "Add" : "Aggiungi", onPress: () => addFromDirectory(focusLns) },
      ],
    );
  }, [focusLns, loading, contacts]);

  const addExternal = async () => {
    if (!candidate) return;
    setAdding(true);
    try { await api.addContact(candidate); setQ(""); load(); }
    catch (e) { Alert.alert("Errore", api.apiErr(e)); }
    finally { setAdding(false); }
  };

  const startChat = (c) => navigation.navigate("Chat", {
    conv_id: null, others: [c.lns], title: c.display_name || c.lns.split("@")[0], title_lns: c.lns,
  });
  const startMail = (c) => navigation.navigate("CertifyCompose", { draft: { recipients: [c.lns] } });

  const toggleFav = async (c) => {
    setContacts((xs) => xs.map((x) => (x.lns === c.lns ? { ...x, favorite: !x.favorite } : x)));
    try { await api.favoriteContact(c.lns, !c.favorite); } catch { load(); }
  };

  // MENU DEL CONTATTO — un pannello vero, non più un avviso di sistema.
  // Su Android un avviso con più di tre pulsanti perde quelli in eccesso (compreso
  // "Annulla") e non risponde al tasto Indietro: sembrava che l'app si fosse piantata.
  // Questo pannello si chiude col tasto Indietro, toccando fuori o con "Chiudi".
  const moreActions = (c) => setMenuFor(c);

  const doBlock = async (c) => {
    setMenuFor(null);
    setContacts((xs) => xs.map((x) => (x.lns === c.lns ? { ...x, blocked: !c.blocked } : x)));
    try { await api.blockContact(c.lns, !c.blocked); } catch (e) { Alert.alert("Errore", api.apiErr(e)); load(); }
  };

  const doReportBlock = (c) => {
    const label = c.display_name || c.lns;
    setMenuFor(null);
    Alert.alert(
      "Segnala utente",
      `Segnalare ${label} agli amministratori? L'utente verrà anche bloccato.`,
      [
        { text: "Annulla", style: "cancel" },
        {
          text: "Segnala", style: "destructive",
          onPress: async () => {
            try {
              await api.reportUser(c.lns, "Segnalato dalla rubrica", true);
              setContacts((xs) => xs.map((x) => (x.lns === c.lns ? { ...x, blocked: true } : x)));
              Alert.alert("Segnalazione inviata", "Grazie: gli amministratori la esamineranno.");
            } catch (e) { Alert.alert("Errore", api.apiErr(e)); }
          },
        },
      ],
    );
  };

  const removeContact = (c) => {
    const label = c.display_name || c.lns;
    const colleague = !!c.same_company;
    Alert.alert(
      colleague ? "Togli dalla rubrica" : "Elimina contatto",
      colleague
        ? `Togliere ${label} dalla tua rubrica? Resta nell'azienda ma non lo vedrai più qui (puoi rimetterlo cercandolo).`
        : `Eliminare ${label} dalla rubrica?`,
      [
        { text: "Annulla", style: "cancel" },
        {
          text: colleague ? "Togli" : "Elimina", style: "destructive",
          onPress: async () => {
            setContacts((xs) => xs.filter((x) => x.lns !== c.lns));
            try {
              await api.removeContact(c.lns);
              // In rubrica cieca il contatto sta solo sul telefono: non c'è niente da
              // nascondere sul server (e chiederlo rivelerebbe l'indirizzo).
              if (!c.blind) await api.hideContact(c.lns, true);
            } catch (e) { Alert.alert("Errore", api.apiErr(e)); load(); }
          },
        },
      ],
    );
  };

  const requestsBlock = incoming.length > 0 ? (
    <View style={styles.reqBox} testID="rubrica-incoming">
      <Text style={styles.reqTitle}>{t("book.incoming") + " · " + incoming.length}</Text>
      {incoming.map((c) => (
        <View key={c.lns} style={styles.reqRow} testID="rubrica-incoming-row">
          <Avatar seed={c.lns} label={c.display_name || c.lns} uri={c.avatar || undefined} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.name} numberOfLines={1}>{t("book.incomingFrom", { name: c.display_name || c.lns.split("@")[0] })}</Text>
            <Text style={styles.lns} numberOfLines={1}>{c.lns}</Text>
          </View>
          {reqBusy === c.lns ? <ActivityIndicator color={theme.accent} /> : (
            <>
              <TouchableOpacity style={styles.reqAccept} onPress={() => acceptRequest(c)} testID="rubrica-accept-btn">
                <Ionicons name="checkmark-outline" size={16} color="#04150B" />
                <Text style={styles.reqAcceptTxt}>{t("book.accept")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.reqIgnore} onPress={() => ignoreRequest(c)} testID="rubrica-ignore-btn">
                <Ionicons name="ban-outline" size={16} color={theme.danger} />
              </TouchableOpacity>
            </>
          )}
        </View>
      ))}
    </View>
  ) : null;

  const renderItem = ({ item }) => (
    <View style={styles.row} testID="rubrica-contact-row">
      <TouchableOpacity onPress={() => toggleFav(item)} testID="rubrica-fav-btn" hitSlop={8} style={styles.starBtn}>
        <Ionicons name={item.favorite ? "star" : "star-outline"} size={18} color={item.favorite ? "#50C878" : theme.textFaint} />
      </TouchableOpacity>
      <Avatar seed={item.lns} label={item.display_name || item.lns} online={!!item.online} uri={item.avatar || undefined} />
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{item.display_name || item.lns.split("@")[0]}</Text>
          {!item.same_company && !item.blind && <View style={styles.extTag}><Text style={styles.extTagTxt}>{item.company_name || t("rubrica.external")}</Text></View>}
        </View>
        <Text style={styles.lns} numberOfLines={1}>
          {item.lns}
          {item.department ? <Text style={styles.dept}>{"  ·  " + item.department}</Text> : null}
        </Text>
        {item.mutual === false && (
          <Text style={styles.mutualHint} numberOfLines={2} testID="rubrica-mutual-hint">
            {item.in_my_book === false
              ? (lang === "en" ? "Not in your address book — add to write" : "Non è in rubrica: aggiungilo per scrivere")
              : (lang === "en" ? "Waiting for them to add you back: messages are blocked until then" : "In attesa che ti aggiunga: fino ad allora i messaggi sono bloccati")}
          </Text>
        )}
      </View>
      {item.in_my_book === false ? (
        <TouchableOpacity style={[styles.action, { borderColor: theme.accent }]} onPress={() => addFromDirectory(item.lns)} disabled={adding} testID="rubrica-add-btn">
          <Ionicons name="person-add-outline" size={18} color={theme.accent} />
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity style={[styles.action, { borderColor: theme.accent + "66" }]} onPress={() => startChat(item)} testID="rubrica-chat-btn">
        <Ionicons name="chatbubble-ellipses-outline" size={18} color={theme.accent} />
      </TouchableOpacity>
      <TouchableOpacity style={[styles.action, { borderColor: tint + "66" }]} onPress={() => startMail(item)} testID="rubrica-mail-btn">
        <Ionicons name="mail-outline" size={18} color={tint} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.delBtn} onPress={() => moreActions(item)} testID="rubrica-more-btn" hitSlop={8}>
        <Ionicons name={item.blocked ? "ban" : "ellipsis-vertical"} size={17} color={item.blocked ? theme.danger : theme.textDim} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.delBtn} onPress={() => removeContact(item)} testID="rubrica-delete-btn" hitSlop={8}>
        <Ionicons name="trash-outline" size={17} color={theme.danger} />
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t("rubrica.title")}</Text>
          <Text style={styles.subtitle}>{t("rubrica.subtitle")}</Text>
        </View>
        <TouchableOpacity onPress={() => navigation.navigate("MyQr")} testID="rubrica-myqr-btn" hitSlop={8} style={styles.searchIconBtn}>
          <Ionicons name="qr-code-outline" size={22} color={tint} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate("GlobalSearch")} testID="global-search-btn" hitSlop={8} style={styles.searchIconBtn}>
          <Ionicons name="search-outline" size={22} color={tint} />
        </TouchableOpacity>
      </View>

      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={18} color={theme.textFaint} />
        <TextInput
          style={styles.searchInput}
          value={q}
          onChangeText={setQ}
          placeholder={t("rubrica.searchPlaceholder")}
          placeholderTextColor={theme.textFaint}
          selectionColor={tint}
          cursorColor={theme.text}
          keyboardAppearance="dark"
          underlineColorAndroid="transparent"
          autoCapitalize="none"
          testID="rubrica-search"
        />
        {q ? <TouchableOpacity onPress={() => setQ("")}><Ionicons name="close-outline" size={18} color={theme.textFaint} /></TouchableOpacity> : null}
      </View>

      {canAdd && (
        <TouchableOpacity style={styles.addExt} onPress={addExternal} disabled={adding} testID="rubrica-add-external">
          {adding ? <ActivityIndicator color={theme.accent} /> : <Ionicons name="add-outline" size={18} color={theme.accent} />}
          <Text style={styles.addExtTxt}>{t("rubrica.addExternal", { lns: candidate })}</Text>
        </TouchableOpacity>
      )}

      {dirResults.length > 0 && (
        <View style={styles.dirBox}>
          <Text style={styles.dirTitle} testID="rubrica-directory-title">
            {"DIRECTORY LATTICE" + (dirBusy ? " …" : "")}
          </Text>
          {dirResults.slice(0, 8).map((d) => (
            <TouchableOpacity key={d.lns} style={styles.dirRow} onPress={() => addFromDirectory(d.lns)} disabled={adding} testID="rubrica-directory-row">
              <Avatar seed={d.lns} label={d.display_name || d.lns} uri={d.avatar || undefined} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{d.display_name || d.lns.split("@")[0]}</Text>
                <Text style={styles.lns} numberOfLines={1}>{d.lns}</Text>
                {!!(d.headline || d.bio) && <Text style={styles.dirBio} numberOfLines={1}>{d.headline || d.bio}</Text>}
              </View>
              <Ionicons name="person-add-outline" size={18} color={theme.accent} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={tint} /></View>
      ) : (
        <FlatList
          ListHeaderComponent={requestsBlock}
          data={filtered}
          keyExtractor={(c) => c.lns}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 24 }}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={tint} />}
          ListEmptyComponent={<View style={styles.center}><Text style={styles.empty}>{t("rubrica.empty")}</Text></View>}
        />
      )}
      {menuFor && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setMenuFor(null)}>
          <Pressable style={styles.sheetWrap} onPress={() => setMenuFor(null)} testID="rubrica-menu-backdrop">
            <Pressable style={styles.sheet} testID="rubrica-menu">
              <Text style={styles.sheetTitle} numberOfLines={1}>{menuFor.display_name || menuFor.lns}</Text>
              <Text style={styles.sheetSub} numberOfLines={1}>{menuFor.lns}</Text>
              <TouchableOpacity
                style={styles.sheetItem}
                testID="rubrica-menu-verify"
                onPress={() => { const c = menuFor; setMenuFor(null); navigation.navigate("VerifyContact", { peer: c.lns, peer_name: c.display_name || c.lns }); }}
              >
                <Ionicons name="qr-code-outline" size={19} color={tint} />
                <Text style={styles.sheetItemTxt}>{lang === "en" ? "Verify contact (QR)" : "Verifica contatto (QR)"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.sheetItem} testID="rubrica-menu-block" onPress={() => doBlock(menuFor)}>
                <Ionicons name={menuFor.blocked ? "lock-open-outline" : "ban-outline"} size={19} color={theme.text} />
                <Text style={styles.sheetItemTxt}>{(menuFor.blocked ? "Sblocca " : "Blocca ") + (menuFor.display_name || menuFor.lns)}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.sheetItem} testID="rubrica-menu-report" onPress={() => doReportBlock(menuFor)}>
                <Ionicons name="flag-outline" size={19} color={theme.danger} />
                <Text style={[styles.sheetItemTxt, { color: theme.danger }]}>Segnala e blocca</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.sheetClose} testID="rubrica-menu-close" onPress={() => setMenuFor(null)}>
                <Text style={styles.sheetCloseTxt}>{lang === "en" ? "Close" : "Chiudi"}</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (tint) => StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 4 },
  searchIconBtn: { padding: 6 },
  title: { color: theme.text, fontSize: 26, fontWeight: "800" },
  subtitle: { color: theme.textDim, fontSize: 13, marginTop: 2 },
  starBtn: { padding: 2 },
  searchBox: {
    flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 18, marginTop: 12,
    backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingHorizontal: 12,
  },
  searchInput: { flex: 1, color: theme.text, fontSize: 15, paddingVertical: 10, includeFontPadding: false },
  addExt: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginHorizontal: 18, marginTop: 8, paddingVertical: 11, borderRadius: 12,
    backgroundColor: theme.accent + "1A", borderWidth: 1, borderColor: theme.accent + "55",
  },
  addExtTxt: { color: theme.accent, fontSize: 13, fontWeight: "700" },
  dirBox: { marginHorizontal: 16, marginBottom: 8, borderRadius: 12, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, paddingVertical: 8 },
  dirTitle: { color: theme.textFaint, fontSize: 11, fontWeight: "800", letterSpacing: 1, paddingHorizontal: 12, paddingBottom: 6 },
  dirRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
  dirBio: { color: theme.textDim, fontSize: 11, marginTop: 2 },
  reqBox: { marginHorizontal: 16, marginTop: 10, marginBottom: 6, borderRadius: 12, borderWidth: 1, borderColor: tint + "59", backgroundColor: tint + "12", paddingVertical: 10, paddingHorizontal: 12 },
  reqTitle: { color: tint, fontSize: 11, fontWeight: "800", letterSpacing: 1, marginBottom: 8, textTransform: "uppercase" },
  reqRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 },
  reqAccept: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#50C878", borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8 },
  reqAcceptTxt: { color: "#04150B", fontSize: 12, fontWeight: "800" },
  reqIgnore: { borderWidth: 1, borderColor: theme.danger + "66", borderRadius: 9, paddingHorizontal: 9, paddingVertical: 7 },
  delBtn: { paddingHorizontal: 6, paddingVertical: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 12 },
  info: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { color: theme.text, fontSize: 15, fontWeight: "600", flexShrink: 1 },
  lns: { color: theme.textFaint, fontSize: 12, marginTop: 1 },
  dept: { color: "#50C878", fontSize: 12, fontWeight: "600" },
  mutualHint: { color: "#50C878", fontSize: 11, marginTop: 3, lineHeight: 15 },
  extTag: { backgroundColor: "#FF910022", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  extTagTxt: { color: "#FF9100", fontSize: 10, fontWeight: "700" },
  action: {
    width: 40, height: 40, borderRadius: 10, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  sep: { height: 1, backgroundColor: theme.border, marginLeft: 74 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 40 },
  empty: { color: theme.textFaint, fontSize: 14 },
  sheetWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: theme.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: tint + "40", padding: 16, paddingBottom: 30 },
  sheetTitle: { color: theme.text, fontSize: 17, fontWeight: "800" },
  sheetSub: { color: theme.textFaint, fontSize: 12, marginTop: 2, marginBottom: 10 },
  sheetItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, borderTopWidth: 1, borderTopColor: theme.border },
  sheetItemTxt: { color: theme.text, fontSize: 15, fontWeight: "600", flex: 1 },
  sheetClose: { marginTop: 14, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: tint + "4D", borderRadius: 14, paddingVertical: 13 },
  sheetCloseTxt: { color: theme.text, fontSize: 14, fontWeight: "700" },
});

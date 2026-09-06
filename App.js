import React, { useEffect, useRef, useState, useCallback } from "react";
import { View, ActivityIndicator, AppState as RNAppState, Platform } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import notifee, { EventType } from "react-native-notify-kit";
import { getApp as fbApp } from "@react-native-firebase/app";
import { getMessaging as fbMessaging, getInitialNotification as fbGetInitial, onNotificationOpenedApp as fbOnOpened, onMessage as fbOnMessage } from "@react-native-firebase/messaging";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { NavigationContainer, DarkTheme, createNavigationContainerRef } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import TamperGate from "./src/components/TamperGate";
import { UnreadProvider, useUnread } from "./src/context/UnreadContext";
import LoginScreen from "./src/screens/LoginScreen";

import LockScreen from "./src/screens/LockScreen";
import PinLockScreen from "./src/screens/PinLockScreen";

import ConversationsScreen from "./src/screens/ConversationsScreen";
import AddressBookScreen from "./src/screens/AddressBookScreen";

import ChatScreen from "./src/screens/ChatScreen";

import CertifyScreen from "./src/screens/CertifyScreen";





// Schermate che usano react-native-webrtc: caricate lazy per non inizializzare il
// modulo nativo all'avvio dell'app (evita crash al lancio).
function CallScreen(props) { const C = require("./src/screens/CallScreen").default; return <C {...props} />; }
function GroupCallScreen(props) { const C = require("./src/screens/GroupCallScreen").default; return <C {...props} />; }
import ProfileScreen from "./src/screens/ProfileScreen";




import HandshakeKeysScreen from "./src/screens/HandshakeKeysScreen";

import { lazyScreen } from "./src/components/LazyScreen";
// Caricate solo quando servono: tirano dentro fotocamera / selettore file / QR.
const VerifyContactScreen = lazyScreen(() => require("./src/screens/VerifyContactScreen"), "Verifica contatto");
const BlockedScreen = lazyScreen(() => require("./src/screens/BlockedScreen"), "Contatti ignorati");
const MyQrScreen = lazyScreen(() => require("./src/screens/MyQrScreen"), "Il mio QR");
const BackupScreen = lazyScreen(() => require("./src/screens/BackupScreen"), "Backup cifrato");
// v2.5.0 avvio pigro: le secondarie si costruiscono quando servono, non all'avvio.
const ReportsScreen = lazyScreen(() => require("./src/screens/ReportsScreen"), "Segnalazioni");
const RotateKeyScreen = lazyScreen(() => require("./src/screens/RotateKeyScreen"), "Ricambio chiavi");
const ForwardScreen = lazyScreen(() => require("./src/screens/ForwardScreen"), "Inoltra");
const ChannelDetailScreen = lazyScreen(() => require("./src/screens/ChannelDetailScreen"), "Gruppo");
const CertifyComposeScreen = lazyScreen(() => require("./src/screens/CertifyComposeScreen"), "Nuova raccomandata");
const CertifyDetailScreen = lazyScreen(() => require("./src/screens/CertifyDetailScreen"), "Raccomandata");
const CertifyCalendarScreen = lazyScreen(() => require("./src/screens/CertifyCalendarScreen"), "Calendario");
const StatusScreen = lazyScreen(() => require("./src/screens/StatusScreen"), "Stato");
const CallLogScreen = lazyScreen(() => require("./src/screens/CallLogScreen"), "Registro chiamate");
const LeadsScreen = lazyScreen(() => require("./src/screens/LeadsScreen"), "Concorsi");
const LicensesScreen = lazyScreen(() => require("./src/screens/LicensesScreen"), "Licenze");
const MembersScreen = lazyScreen(() => require("./src/screens/MembersScreen"), "Membri");
const SecurityScreen = lazyScreen(() => require("./src/screens/SecurityScreen"), "Sicurezza");
const PrivacyLockScreen = lazyScreen(() => require("./src/screens/PrivacyLockScreen"), "Blocco e autodistruzione");
const GlobalSearchScreen = lazyScreen(() => require("./src/screens/GlobalSearchScreen"), "Ricerca");
const AfterBorderScreen = lazyScreen(() => require("./src/screens/AfterBorderScreen"), "Oltre confine");
const WhatsNewScreen = lazyScreen(() => require("./src/screens/WhatsNewScreen"), "Novita");
const SignupScreen = lazyScreen(() => require("./src/screens/SignupScreen"), "Registrazione");
import * as wake from "./src/lib/wake";
import { reportPendingCrash } from "./src/lib/crashlog";
import { flushBlobs } from "./src/lib/lock";
import * as cover from "./src/lib/cover";
import * as tunnel from "./src/lib/tunnel";
import { initNotificationHandler } from "./src/lib/notifications";
import SettingsScreen from "./src/screens/SettingsScreen";

import NotificationsScreen from "./src/screens/NotificationsScreen";
import LegalScreen from "./src/screens/LegalScreen";
import ConsentScreen from "./src/screens/ConsentScreen";
import LanguageScreen from "./src/screens/LanguageScreen";
import { useLook } from "./src/lib/appearance";
import { alpha } from "./src/components/Surface";
import { loadConsent, saveConsent, CONSENT_VERSION, loadConsentSynced, saveConsentSynced } from "./src/lib/store";
import * as api from "./src/lib/api";
import { registerForPush } from "./src/lib/notifications";
import ErrorBoundary from "./src/components/ErrorBoundary";
import { I18nProvider, useI18n } from "./src/lib/i18n";
import { loadThreatList } from "./src/lib/threatList";
import { useTint } from "./src/lib/appearance";
import { theme } from "./src/theme";
import { isLockSuppressed, clearLockSuppress } from "./src/lib/lockGuard";
import { anonEpochs, discRid, openInvite } from "./src/lib/anonCall";
import { anonSharedSecret } from "./src/lib/crypto";

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
export const navRef = createNavigationContainerRef();

const TAB_ICONS = {
  Conversazioni: "chatbubbles",
  Rubrica: "book",
  Certify: "shield-checkmark",
  Profilo: "person",
  Impostazioni: "settings",
};
const TAB_KEY = {
  Conversazioni: "tab.conversations",
  Rubrica: "tab.rubrica",
  Certify: "tab.certify",
  Profilo: "tab.profile",
  Impostazioni: "tab.settings",
};

function MainTabs() {
  const insets = useSafeAreaInsets();
  const look = useLook();
  const glassBg = alpha(look.surface, 0.78);
  const glassEdge = alpha(look.tint, 0.3);
  const tint = useTint();
  const { t } = useI18n();
  const { chatUnread, certifyUnread, expiringLicenses, bookRequests } = useUnread();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        lazy: true,
        freezeOnBlur: true,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: tint,
        tabBarInactiveTintColor: theme.textFaint,
        tabBarLabel: t(TAB_KEY[route.name]),
        tabBarBadgeStyle: { backgroundColor: theme.danger, color: "#fff", fontSize: 10, fontWeight: "800" },
        tabBarStyle: {
          backgroundColor: glassBg,
          borderTopColor: glassEdge,
          height: 58 + insets.bottom,
          paddingBottom: 6 + insets.bottom,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700" },
        tabBarIcon: ({ color, size, focused }) => (
          <Ionicons name={focused ? TAB_ICONS[route.name] : `${TAB_ICONS[route.name]}-outline`} size={size} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Conversazioni" component={ConversationsScreen} options={{ tabBarBadge: chatUnread > 0 ? (chatUnread > 99 ? "99+" : chatUnread) : undefined }} />
      <Tab.Screen name="Certify" component={CertifyScreen} options={{ tabBarBadge: certifyUnread > 0 ? (certifyUnread > 99 ? "99+" : certifyUnread) : undefined }} />
      <Tab.Screen name="Rubrica" component={AddressBookScreen} options={{ tabBarBadge: bookRequests > 0 ? (bookRequests > 99 ? "99+" : bookRequests) : undefined }} />
      <Tab.Screen name="Impostazioni" component={SettingsScreen} options={{ tabBarBadge: expiringLicenses > 0 ? (expiringLicenses > 99 ? "99+" : expiringLicenses) : undefined }} />
    </Tab.Navigator>
  );
}

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: theme.bg,
    card: theme.surface,
    text: theme.text,
    border: theme.border,
    primary: theme.primary,
  },
};

function Root() {
  const { user, booting, locked, mustRotate, pinGate, lock } = useAuth();
  const { chosen: langChosen, setLang } = useI18n();
  const appStateRef = useRef(RNAppState.currentState);
  const bgSince = useRef(0);
  const [consent, setConsent] = useState(undefined); // undefined=loading, false=needed, true=ok
  useEffect(() => {
    loadConsent().then((c) => setConsent(!!c && c.version === CONSENT_VERSION));
  }, []);
  // Once authenticated, record the accepted consent on the server (GDPR audit trail).
  useEffect(() => {
    if (!user || consent !== true) return;
    (async () => {
      const c = await loadConsent();
      if (!c) return;
      if ((await loadConsentSynced()) === c.version) return;
      try {
        await api.recordConsent({ version: c.version, accepted_at: c.at, platform: Platform.OS, documents: ["privacy", "terms"] });
        await saveConsentSynced(c.version);
      } catch {}
    })();
  }, [user, consent]);
  const userRef = useRef(null);
  useEffect(() => { userRef.current = user; }, [user]);
  // Registra il token push a OGNI avvio (e quando cambia identità): prima dipendeva
  // solo dall'interruttore in Impostazioni, così i device che non lo avevano mai
  // toccato non ricevevano nessuna notifica.
  useEffect(() => {
    if (!user?.lns) return;
    const register = async () => {
      try {
        const tok = await registerForPush();
        if (tok) await api.registerPushToken(tok, Platform.OS);
      } catch {}
    };
    register();
    // Ri-registra quando l'app torna in primo piano: il token FCM può cambiare.
    const sub = RNAppState.addEventListener("change", (st) => { if (st === "active") register(); });
    return () => { try { sub.remove(); } catch {} };
  }, [user?.lns]);
  const pendingNotif = useRef(null);
  const routeFromData = (data) => {
    if (!data) return null;
    if (data.type === "lead") return { name: "Leads", params: { focusId: data.lead_id || null } };
    // I dati della push FCM sono stringhe: "false" sarebbe truthy con !!.
    const flag = (v) => v === true || v === "true" || v === "1";
    if (data.type === "call") return { name: "Call", params: { incoming: true, fromPush: true, from: data.from, video: flag(data.video), call_id: data.call_id, autoAnswer: flag(data.autoAnswer), decline: flag(data.decline) } };
    if (data.type === "gcall") return { name: "GroupCall", params: { room_id: data.room_id, video: flag(data.video), chan_name: null } };
    if (data.type === "contact_add") return { name: "Main", params: { screen: "Rubrica", params: { focusLns: data.lns || null } } };
    if (data.type === "license-expiry") return { name: "Licenses" };
    if (data.channel) return { name: "ChannelDetail", params: { chan_id: data.channel } };
    if (data.kind === "certify") return { name: "Main", params: { screen: "Certify" } };
    if (data.kind === "report") return { name: "Reports" };
    if (data.kind === "daily_quiz") {
      return data.quiz_chan
        ? { name: "ChannelDetail", params: { chan_id: data.quiz_chan, openRipasso: true, topic_id: data.quiz_topic || null } }
        : { name: "Main" };
    }
    if (data.conv_id) return { name: "Chat", params: { conv_id: data.conv_id, others: [] } };
    return null;
  };
  const flushNotif = useCallback(() => {
    const r = pendingNotif.current;
    if (!r) return;
    if (!navRef.isReady() || !userRef.current) return; // aspetta navigazione pronta + login
    pendingNotif.current = null;
    try { navRef.navigate(r.name, r.params); } catch (e) {}
  }, []);
  const handleNotif = useCallback((data) => {
    const r = routeFromData(data);
    if (!r) return;
    pendingNotif.current = r;
    flushNotif();
    // cold start: ritenta finché navigazione pronta e utente loggato
    let tries = 0;
    const iv = setInterval(() => { tries++; flushNotif(); if (!pendingNotif.current || tries > 25) clearInterval(iv); }, 400);
  }, [flushNotif]);
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      handleNotif(resp?.notification?.request?.content?.data || {});
    });
    Notifications.getLastNotificationResponseAsync().then((resp) => {
      if (resp) handleNotif(resp?.notification?.request?.content?.data || {});
    }).catch(() => {});
    return () => sub.remove();
  }, [handleNotif]);
  // Routing dalla notifica full-screen chiamata (notify-kit): cold start + press in foreground.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const initial = await notifee.getInitialNotification();
        const d = initial && initial.notification && initial.notification.data;
        if (mounted && d && d.type === "call") {
          const aid = initial.pressAction && initial.pressAction.id;
          handleNotif({ ...d, autoAnswer: aid === "answer" ? "1" : "", decline: aid === "reject" ? "1" : "" });
          try { await notifee.cancelNotification(initial.notification.id); } catch (e2) {}
        }
      } catch (e) {}
    })();
    const unsub = notifee.onForegroundEvent(({ type, detail }) => {
      try {
        const d = detail && detail.notification && detail.notification.data;
        if ((type === EventType.PRESS || type === EventType.ACTION_PRESS) && d && d.type === "call") {
          const aid = detail.pressAction && detail.pressAction.id;
          handleNotif({ ...d, autoAnswer: aid === "answer" ? "1" : "", decline: aid === "reject" ? "1" : "" });
          if (detail.notification.id) notifee.cancelNotification(detail.notification.id).catch(() => {});
        }
      } catch (e) {}
    });
    return () => { mounted = false; try { unsub && unsub(); } catch (e) {} };
  }, [handleNotif]);
  // Notifiche MESSAGGIO via RNFirebase (ora proprietario FCM dopo rimozione servizio Expo):
  // ripristina apertura chat al tap (cold start + background) e aggiorna la lista non letti.
  useEffect(() => {
    let m;
    try { m = fbMessaging(fbApp()); } catch (e) { return; }
    fbGetInitial(m).then((rm) => { if (rm && rm.data) handleNotif(rm.data); }).catch(() => {});
    const unsubOpen = fbOnOpened(m, (rm) => { if (rm && rm.data) handleNotif(rm.data); });
    // APP APERTA: la push data-only della chiamata arriva qui in tempo reale → apriamo
    // subito la schermata di squillo, senza attendere il polling del rendezvous.
    const unsubMsg = fbOnMessage(m, (rm) => {
      const d = (rm && rm.data) || {};
      if (d.type !== "call" || !d.call_id) return;
      handleNotif(d);
      try { api.callRingShown(d.call_id).catch(() => {}); } catch (e) {}
    });
    return () => { try { unsubOpen && unsubOpen(); } catch (e) {} try { unsubMsg && unsubMsg(); } catch (e) {} };
  }, [handleNotif]);
  useEffect(() => { flushNotif(); }, [user, flushNotif]);
  // Dopo lo sblocco col PIN il container si rimonta: ritenta l'apertura della chat pendente.
  useEffect(() => {
    if (locked) return;
    let tries = 0;
    const iv = setInterval(() => { tries++; flushNotif(); if (!pendingNotif.current || tries > 25) clearInterval(iv); }, 300);
    return () => clearInterval(iv);
  }, [locked, flushNotif]);
  // Discovery ANONIMA delle chiamate in arrivo (blind rendezvous): calcolo i rid per ogni
  // contatto e chiedo al server quali hanno un invito, senza rivelare identità.
  const activeCall = useRef(null);
  const dhCache = useRef({});
  const contactSet = useRef([]);
  const contactsAt = useRef(0);
  useEffect(() => {
    if (!user?.dh?.secretKey || !user?.kem?.secretKey) return;
    const myLns = user.lns;
    const refreshContacts = async () => {
      try {
        const [cv, ct] = await Promise.all([api.convs().catch(() => []), api.contacts().catch(() => [])]);
        const set = new Set();
        (Array.isArray(cv) ? cv : []).forEach((c) => (c.others || []).forEach((o) => { if (o && o !== myLns) set.add(o); }));
        (Array.isArray(ct) ? ct : []).forEach((c) => { const l = typeof c === "string" ? c : c && c.lns; if (l && l !== myLns) set.add(l); });
        const list = [...set];
        contactSet.current = list;
        const missing = list.filter((l) => !dhCache.current[l]);
        if (missing.length) { const dh = await api.pulseDhKeys(missing).catch(() => ({})); Object.assign(dhCache.current, dh || {}); }
      } catch {}
    };
    const tick = async () => {
      try {
        if (Date.now() - contactsAt.current > 60000) { contactsAt.current = Date.now(); await refreshContacts(); }
        const contacts = contactSet.current.filter((l) => dhCache.current[l]);
        if (!contacts.length) return;
        const epochs = anonEpochs();
        const ridMap = {};
        for (const from of contacts) {
          const shared = anonSharedSecret(user.dh.secretKey, dhCache.current[from]);
          for (const ep of epochs) ridMap[discRid(shared, from, myLns, ep)] = true;
        }
        const rids = Object.keys(ridMap);
        if (!rids.length || !navRef.isReady()) return;
        const res = await api.anonPoll(rids);
        const hits = (res && res.hits) || [];
        if (!hits.length) return;
        const cur = navRef.getCurrentRoute && navRef.getCurrentRoute();
        if (cur && cur.name === "Call") return;
        const got = await api.anonGet(hits[0]);
        if (!got || !got.found || !got.ping) return;
        const inv = openInvite(got.ping, user.kem.secretKey);
        if (!inv || !inv.chan || activeCall.current === inv.chan) return;
        activeCall.current = inv.chan;
        navRef.navigate("Call", { incoming: true, anon: true, chan: inv.chan, from: inv.from, from_pk: inv.from_pk, from_kem: inv.from_kem, video: !!inv.video, offer: inv.offer, offer_sig: inv.offer_sig });
      } catch {}
    };
    const iv = setInterval(tick, 3500);
    return () => clearInterval(iv);
  }, [user]);
  // Ri-blocca SOLO dopo un vero background prolungato (>8s), non per i popup di
  // permesso (microfono/foto) che mandano l'app in inactive/background per un istante:
  // evita il loop del PIN quando si aprono chat/stato.
  useEffect(() => {
    const sub = RNAppState.addEventListener("change", (next) => {
      appStateRef.current = next;
      if (next === "active") {
        const away = bgSince.current ? Date.now() - bgSince.current : 0;
        bgSince.current = 0;
        // Galleria/fotocamera/permessi: NON ribloccare finché la finestra di soppressione
        // è valida (non azzerarla al primo "active": il popup dei permessi la bruciava).
        if (isLockSuppressed()) return;
        if (away > 8000) lock();
      } else if (next === "background") {
        if (!bgSince.current) bgSince.current = Date.now();
      }
    });
    return () => sub.remove();
  }, [lock]);
  // Primissima schermata assoluta: la lingua. Prima del consenso, prima dell'identità,
  // prima di qualunque rete. Chiedere di accettare documenti in una lingua che non si legge
  // non è un consenso.
  if (langChosen === false) {
    return <LanguageScreen onPick={setLang} />;
  }
  if (langChosen === null || booting || consent === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: "transparent", alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={theme.primary} size="large" />
      </View>
    );
  }
  if (pinGate) {
    return <PinLockScreen />;
  }
  if (!consent) {
    return <ConsentScreen onAccept={async () => { await saveConsent(); setConsent(true); }} />;
  }
  if (user && mustRotate) {
    return <RotateKeyScreen />;
  }
  if (user && locked) {
    return <LockScreen />;
  }
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.surface },
        headerTintColor: theme.text,
        headerTitleStyle: { fontWeight: "800" },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.bg },
        freezeOnBlur: true,
        animation: "slide_from_right",
      }}
    >
      {!user ? (
        <>
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Signup" component={SignupScreen} options={{ headerShown: false }} />
        </>
      ) : (
        <>
          <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
          <Stack.Screen name="GlobalSearch" component={GlobalSearchScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Profilo" component={ProfileScreen} options={{ title: "Profilo" }} />
          <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: "Segnalazioni" }} />
          <Stack.Screen name="Leads" component={LeadsScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Licenses" component={LicensesScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Members" component={MembersScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Security" component={SecurityScreen} options={{ headerShown: false }} />
          <Stack.Screen name="HandshakeKeys" component={HandshakeKeysScreen} options={{ headerShown: false }} />
          <Stack.Screen name="AfterBorder" component={AfterBorderScreen} options={{ headerShown: false }} />
          <Stack.Screen name="VerifyContact" component={VerifyContactScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Blocked" component={BlockedScreen} options={{ headerShown: false }} />
          <Stack.Screen name="MyQr" component={MyQrScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Backup" component={BackupScreen} options={{ headerShown: false }} />
          <Stack.Screen name="PrivacyLock" component={PrivacyLockScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Forward" component={ForwardScreen} options={{ headerShown: false }} />
          <Stack.Screen name="WhatsNew" component={WhatsNewScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Chat" component={ChatScreen} options={{ title: "Chat" }} />
          <Stack.Screen name="ChannelDetail" component={ChannelDetailScreen} options={{ title: "Gruppo" }} />
          <Stack.Screen name="CertifyCompose" component={CertifyComposeScreen} options={{ title: "Nuova Certify" }} />
          <Stack.Screen name="CertifyDetail" component={CertifyDetailScreen} options={{ title: "Certify" }} />
          <Stack.Screen name="CertifyCalendar" component={CertifyCalendarScreen} options={{ title: "Calendario" }} />
          <Stack.Screen name="Call" component={CallScreen} options={{ headerShown: false, presentation: "fullScreenModal", animation: "fade" }} />
          <Stack.Screen name="Status" component={StatusScreen} options={{ headerShown: false }} />
          <Stack.Screen name="CallLog" component={CallLogScreen} options={{ headerShown: false }} />
          <Stack.Screen name="GroupCall" component={GroupCallScreen} options={{ headerShown: false, presentation: "fullScreenModal", animation: "fade" }} />
          <Stack.Screen name="Legal" component={LegalScreen} options={({ route }) => ({ title: route.params?.title || "Documento" })} />
        </>
      )}
    </Stack.Navigator>
  );
}

// Specchio dell'interfaccia: con l'arabo la direzione del layout è rtl per l'intero albero,
// così margini, allineamenti e righe si invertono senza toccare una singola schermata.
function Shell({ children }) {
  const { rtl } = useI18n();
  const look = useLook();
  // Lo sfondo dell'app sta qui, in un posto solo: le schermate hanno il fondo
  // trasparente e lo lasciano passare, così cambiarlo è immediato e non richiede
  // di ricostruire gli stili di quaranta file.
  return (
    <View style={{ flex: 1, direction: rtl ? "rtl" : "ltr", backgroundColor: look.color }}>
      {children}
    </View>
  );
}

export default function App() {
  useEffect(() => {
    // L'impostazione "notifiche fantasma" va letta PRIMA che arrivi la prima notifica.
    require("./src/lib/ghost").loadGhost().catch(() => {});
    try { initNotificationHandler(); } catch (e) { /* notifiche non disponibili */ }
    wake.refresh().catch(() => {});
    reportPendingCrash(false).catch(() => {});
    // App in secondo piano: i salvataggi accorpati finiscono su disco immediatamente.
    const sub = RNAppState.addEventListener("change", (s) => { if (s !== "active") flushBlobs().catch(() => {}); });
    return () => { try { sub.remove(); } catch (e) { /* */ } };
  }, []);

  useEffect(() => {
    // Traffico di Rumore: rumore di rete casuale e continuo mentre l'app è in primo piano,
    // così nessuno può capire dall'esterno QUANDO stai davvero scrivendo o chiamando.
    cover.start().catch(() => {});
    tunnel.boot().catch(() => {});
    return () => { cover.stop(); };
  }, []);
  useEffect(() => {
    // Hide the native splash once JS has mounted.
    const t = setTimeout(() => SplashScreen.hideAsync().catch(() => {}), 300);
    // Lista minacce (~3 MB): caricata DOPO che l'app è utilizzabile e al massimo una volta
    // al giorno. Prima veniva scaricata e analizzata a ogni avvio, bloccando tutto.
    const tl = setTimeout(() => { loadThreatList().catch(() => {}); }, 6000);
    return () => { clearTimeout(t); clearTimeout(tl); };
  }, []);
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
          <I18nProvider>
            <StatusBar style="light" />
            <NavigationContainer ref={navRef} theme={navTheme}>
              <AuthProvider>
                <UnreadProvider>
                  <Shell>
                    <Root />
                    {/* Ultimo a essere disegnato = sopra tutto il resto. Dentro AuthProvider,
                        perche deve poter chiamare la cancellazione. */}
                    <TamperGate />
                  </Shell>
                </UnreadProvider>
              </AuthProvider>
            </NavigationContainer>
          </I18nProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

// AVVIO A PROVA DI ARRESTO.
// Ogni pezzo dell'avvio è isolato: se un modulo esplode al caricamento, l'app NON si chiude
// più. Mostra una schermata leggibile con l'errore e ne manda la traccia tecnica al nostro
// server (solo la traccia: nessun indirizzo, nessuna chiave, nessun messaggio).
const BOOT_ERRORS = [];

function reportBoot(stage, e) {
  const msg = (e && (e.stack || e.message)) || String(e);
  BOOT_ERRORS.push(stage + ": " + msg);
  try { console.log("BOOT_ERROR", stage, msg); } catch (_) {}
  try {
    fetch("https://lattice-network.it/api/public/crash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ v: "js", android: "boot:" + stage, trace: String(msg).slice(0, 5000) }),
    }).catch(() => {});
  } catch (_) {}
}

function step(stage, fn) {
  try { return fn(); } catch (e) { reportBoot(stage, e); return null; }
}

// 1) Polyfill di crypto.getRandomValues: deve venire prima di qualunque codice crittografico.
step("get-random-values", () => require("react-native-get-random-values"));

// 2) Splash nativo: tenuto su finché React non ha montato (lo nasconde App).
// Rete di sicurezza: dopo 8 secondi va via comunque, così il logo non resta mai bloccato.
step("splash", () => {
  const S = require("expo-splash-screen");
  S.preventAutoHideAsync().catch(() => {});
  setTimeout(() => { try { S.hideAsync().catch(() => {}); } catch (_) {} }, 8000);
});

// 3) Qualsiasi errore JS fatale finisce nei log e sul nostro server.
step("global-handler", () => {
  if (typeof ErrorUtils === "undefined" || !ErrorUtils.setGlobalHandler) return;
  const prev = ErrorUtils.getGlobalHandler && ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((e, isFatal) => {
    if (isFatal) reportBoot("fatal", e);
    else { try { console.log("JS_ERROR", e && (e.stack || e.message)); } catch (_) {} }
    if (prev) prev(e, isFatal);
  });
});

// ── Chiamata in arrivo: notifica FULL-SCREEN (schermo bloccato) ──
// Il push chiamate è DATA-ONLY: RNFirebase lo consegna anche ad app chiusa/uccisa e
// noi mostriamo una notifica full-screen (come una vera telefonata).
async function showIncomingCall(notifee, K, data) {
  try {
    const isVideo = data.video === true || data.video === "true" || data.video === "1";
    const channelId = await notifee.createChannel({
      id: "incoming_calls",
      name: "Chiamate in arrivo",
      importance: K.AndroidImportance.HIGH,
      sound: "default",
      vibration: true,
      vibrationPattern: [0, 400, 200, 400],
    });
    await notifee.displayNotification({
      id: `call-${data.call_id || "x"}`,
      title: (data.from ? String(data.from).split("@")[0] : "Sconosciuto"),
      body: isVideo ? "Videochiamata in arrivo" : "Chiamata in arrivo",
      data: { type: "call", from: String(data.from || ""), video: isVideo ? "true" : "", call_id: String(data.call_id || "") },
      android: {
        channelId,
        category: K.AndroidCategory.CALL,
        importance: K.AndroidImportance.HIGH,
        visibility: K.AndroidVisibility.PUBLIC,
        autoCancel: false,
        ongoing: true,
        smallIcon: "notification_icon",
        color: "#22C55E",
        timeoutAfter: 35000,
        fullScreenAction: { id: "incoming-call", launchActivity: "com.latticenetwork.pulse.MainActivity" },
        pressAction: { id: "incoming-call", launchActivity: "com.latticenetwork.pulse.MainActivity" },
        actions: [
          { title: "Rispondi", pressAction: { id: "answer", launchActivity: "com.latticenetwork.pulse.MainActivity" } },
          { title: "Rifiuta", pressAction: { id: "reject", launchActivity: "com.latticenetwork.pulse.MainActivity" } },
        ],
      },
    });
    // Il telefono ha squillato: dillo al server così NON manda la seconda notifica
    // di sistema (fallback anti-Doze) e non si sente un doppio suono.
    try {
      const AsyncStorage = require("@react-native-async-storage/async-storage").default;
      const srv = (await AsyncStorage.getItem("lattice.pulse.server.v1")) || "https://lattice-network.it";
      await fetch(srv.replace(/\/+$/, "") + "/api/public/pulse/call/ring-shown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call_id: String(data.call_id || "") }),
      });
    } catch (_) {}
  } catch (e) {
    console.log("showIncomingCall error", e && (e.message || String(e)));
  }
}

// 4) Notifiche in background (Firebase + notify-kit): tutto isolato.
step("background-notifications", () => {
  const K = require("react-native-notify-kit");
  const notifee = K.default;
  const { getApp } = require("@react-native-firebase/app");
  const { getMessaging, setBackgroundMessageHandler } = require("@react-native-firebase/messaging");

  try {
    const messaging = getMessaging(getApp());
    setBackgroundMessageHandler(messaging, async (remoteMessage) => {
      const data = (remoteMessage && remoteMessage.data) || {};
      if (data.type === "call" && data.call_id) await showIncomingCall(notifee, K, data);
    });
  } catch (e) { reportBoot("fcm-bg-handler", e); }

  // notify-kit richiede un background event handler registrato
  // (il routing lo fa App con getInitialNotification).
  notifee.onBackgroundEvent(async ({ type, detail }) => {
    try {
      const aid = detail && detail.pressAction && detail.pressAction.id;
      if (type === K.EventType.ACTION_PRESS && aid === "reject" && detail?.notification?.id) {
        await notifee.cancelNotification(detail.notification.id);
      } else if (type === K.EventType.PRESS && aid !== "answer" && detail?.notification?.id) {
        await notifee.cancelNotification(detail.notification.id);
      }
    } catch (e) {}
  });
});

// 5) L'app. Se il suo caricamento fallisce, al suo posto va una schermata che spiega perché.
let Root = null;
try {
  Root = require("./App").default;
} catch (e) {
  reportBoot("app-module", e);
}

if (!Root) {
  const React = require("react");
  const { View, Text, ScrollView, Pressable, Share } = require("react-native");
  Root = function BootFailure() {
    const txt = BOOT_ERRORS.join("\n\n---\n\n") || "errore sconosciuto";
    // Via lo splash, altrimenti resterebbe il logo a coprire il messaggio.
    React.useEffect(() => {
      try { require("expo-splash-screen").hideAsync().catch(() => {}); } catch (_) {}
    }, []);
    return React.createElement(
      ScrollView,
      { style: { flex: 1, backgroundColor: "#080B12" }, contentContainerStyle: { padding: 24, paddingTop: 72 } },
      React.createElement(Text, { style: { color: "#F87171", fontSize: 19, fontWeight: "800" } }, "Lattice non è riuscita ad avviarsi"),
      React.createElement(Text, { style: { color: "#94A3B8", fontSize: 13, marginTop: 10 } },
        "L'errore è già stato mandato allo sviluppatore. Puoi anche condividerlo qui sotto."),
      React.createElement(
        Pressable,
        {
          onPress: () => Share.share({ message: "Lattice avvio:\n" + txt.slice(0, 3000) }).catch(() => {}),
          style: { marginTop: 18, backgroundColor: "#0066FF", paddingVertical: 12, borderRadius: 10, alignItems: "center" },
        },
        React.createElement(Text, { style: { color: "#fff", fontWeight: "800" } }, "Condividi il dettaglio")
      ),
      React.createElement(View, { style: { height: 18 } }),
      React.createElement(Text, { selectable: true, style: { color: "#E2E8F0", fontSize: 11, lineHeight: 16 } }, txt.slice(0, 6000))
    );
  };
}

require("expo").registerRootComponent(Root);

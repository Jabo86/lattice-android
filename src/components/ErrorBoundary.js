import React from "react";
import { View, Text, ScrollView } from "react-native";

// Mostra a schermo qualsiasi errore di rendering (invece di una chiusura silenziosa),
// lo salva su file e ne manda la traccia tecnica al nostro server.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.log("BOUNDARY_ERROR", error?.message, info?.componentStack);
    // Via lo splash: altrimenti il logo coprirebbe il messaggio d'errore.
    try { require("expo-splash-screen").hideAsync().catch(() => {}); } catch (e) {}
    const trace = String(error?.message || error) + "\n\n" + String(error?.stack || "").slice(0, 3000) +
      "\n\n" + String(info?.componentStack || "").slice(0, 2000);
    try {
      const FS = require("expo-file-system/legacy");
      FS.writeAsStringAsync(FS.documentDirectory + "lastcrash.txt", trace).catch(() => {});
    } catch (e) { /* niente da fare */ }
    try {
      fetch("https://lattice-network.it/api/public/crash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ v: "render", android: "boundary", trace: trace.slice(0, 5000) }),
      }).catch(() => {});
    } catch (e) {}
  }
  render() {
    if (this.state.error) {
      const e = this.state.error;
      return (
        <ScrollView
          style={{ flex: 1, backgroundColor: "#000000" }}
          contentContainerStyle={{ padding: 24, paddingTop: 72 }}
        >
          <Text style={{ color: "#ff6b6b", fontSize: 18, fontWeight: "800", marginBottom: 12 }}>
            Errore all'avvio
          </Text>
          <Text selectable style={{ color: "#fff", fontSize: 14, marginBottom: 10 }}>
            {String(e?.message || e)}
          </Text>
          <Text selectable style={{ color: "#9aa4b2", fontSize: 11, lineHeight: 16 }}>
            {String(e?.stack || "")}
          </Text>
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

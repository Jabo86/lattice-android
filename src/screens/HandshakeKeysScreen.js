// CHIAVI D'AGGANCIO — si ruotano, l'identità no.
//
// Qui si vede a quale generazione siamo, quando è stata fatta, quando ricambia da sola, e
// si può ricambiare a mano. Il numero di sicurezza e il codice QR NON si toccano: restano
// sulla generazione 0 per sempre, così nessun contatto che ti ha già verificato vede allarmi.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../context/AuthContext";
import { theme } from "../theme";
import * as kg from "../lib/keygen";

const DAY = 24 * 3600 * 1000;

export default function HandshakeKeysScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { lang } = useI18n();
  const it = lang !== "en";
  const { user } = useAuth();
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { kg.status().then(setSt).catch(() => setSt({ gen: 0, at: 0 })); }, []);
  useEffect(load, [load]);

  const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString(it ? "it-IT" : "en-GB", { day: "2-digit", month: "short", year: "numeric" }) : it ? "mai" : "never");
  const fmtIn = (ms) => {
    if (!ms) return it ? "al prossimo accesso" : "at next sign-in";
    const d = Math.ceil((ms - Date.now()) / DAY);
    if (d <= 0) return it ? "al prossimo accesso" : "at next sign-in";
    return it ? `fra ${d} giorn${d === 1 ? "o" : "i"}` : `in ${d} day${d === 1 ? "" : "s"}`;
  };

  const doRotate = () => {
    Alert.alert(
      it ? "Ruotare adesso?" : "Rotate now?",
      it
        ? "Vengono generate chiavi d'aggancio nuove e pubblicate sul server. Il tuo numero di sicurezza, il codice QR e il file chiave NON cambiano: chi ti ha già verificato non vedrà nessun allarme."
        : "New handshake keys are generated and published to the server. Your safety number, QR code and key file do NOT change: contacts who already verified you will see no alarm.",
      [
        { text: it ? "Annulla" : "Cancel", style: "cancel" },
        {
          text: it ? "Ruota" : "Rotate",
          onPress: async () => {
            setBusy(true);
            try {
              const g = await kg.rotate(user);
              if (!g) throw new Error("no");
              load();
              Alert.alert(
                it ? "Fatto" : "Done",
                it ? `Sei alla generazione ${g}. Il numero di sicurezza è rimasto identico.` : `You are on generation ${g}. Your safety number is unchanged.`,
              );
            } catch {
              Alert.alert(it ? "Non riuscito" : "Failed", it ? "Non riesco a pubblicare le chiavi nuove adesso. Riprova quando hai rete: finché non ci riesco, restano valide quelle attuali." : "Cannot publish the new keys right now. Try again when online: until then the current ones stay valid.");
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const FACTS = it
    ? [
      { i: "finger-print", t: "Non cambia", d: "Identità ML-DSA-65, numero di sicurezza, codice QR, file chiave, cronologia delle chat, gruppi. Chi ti ha verificato resta verificato." },
      { i: "sync", t: "Cambia", d: "La curva d'aggancio X25519 e la chiave ML-KEM-1024 con cui gli altri aprono una conversazione nuova con te. Sono le due chiavi pubblicate sul server." },
      { i: "time", t: "Chi scrive con una chiave vecchia", d: `Viene letto comunque: si accettano le ultime ${(st && st.back) || 6} generazioni, cioè circa mezzo anno. Quale generazione hai usato non finisce nella busta: chi legge le prova e vince quella che apre.` },
      { i: "hardware-chip", t: "Perché ogni trenta giorni", d: "La chiave d'aggancio protegge la radice della conversazione, il segreto più longevo che esiste, e sta esposta su un tabellone pubblico per tutta la sua vita. Meno vive, meno vale registrarla oggi per provarci domani." },
    ]
    : [
      { i: "finger-print", t: "Does not change", d: "ML-DSA-65 identity, safety number, QR code, key file, chat history, groups. Verified contacts stay verified." },
      { i: "sync", t: "Does change", d: "The X25519 handshake curve and the ML-KEM-1024 key others use to open a NEW conversation with you. Those are the two keys published on the server." },
      { i: "time", t: "Someone writing with an old key", d: `Still gets through: the last ${(st && st.back) || 6} generations are accepted, roughly half a year. Which generation you used is never on the wire: the receiver tries them and the right one opens.` },
      { i: "hardware-chip", t: "Why every thirty days", d: "The handshake key protects the conversation root, the longest-lived secret there is, and it sits on a public board for its whole life. The shorter that life, the less it pays to record traffic today hoping to break it tomorrow." },
    ];

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} testID="handshake-back" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back-outline" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={s.title}>{it ? "Chiavi d'aggancio" : "Handshake keys"}</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} testID="handshake-screen">
        <View style={s.hero}>
          <Ionicons name="sync-circle-outline" size={44} color={theme.primary} />
          <Text style={s.heroT}>{it ? "Ruotano da sole ogni trenta giorni" : "They rotate on their own every thirty days"}</Text>
          <Text style={s.heroD}>
            {it
              ? "Le chiavi con cui gli altri aprono una conversazione nuova con te si ricambiano periodicamente. La tua identità, invece, non si muove di un byte."
              : "The keys others use to open a new conversation with you are replaced periodically. Your identity, on the other hand, does not move a single byte."}
          </Text>
        </View>

        <View style={s.gcard} testID="handshake-status">
          {!st ? <ActivityIndicator color={theme.primary} /> : (
            <>
              <View style={s.grow}>
                <Text style={s.gk}>{it ? "Generazione attuale" : "Current generation"}</Text>
                <Text style={s.gv} testID="handshake-gen">{st.gen}</Text>
              </View>
              <View style={s.grow}>
                <Text style={s.gk}>{it ? "Ultimo ricambio" : "Last rotation"}</Text>
                <Text style={s.gv} testID="handshake-at">{fmtDate(st.at)}</Text>
              </View>
              <View style={[s.grow, { borderBottomWidth: 0 }]}>
                <Text style={s.gk}>{it ? "Prossimo automatico" : "Next automatic"}</Text>
                <Text style={s.gv} testID="handshake-next">{fmtIn(st.next)}</Text>
              </View>
            </>
          )}
        </View>

        <TouchableOpacity style={[s.btn, busy && { opacity: 0.6 }]} onPress={doRotate} disabled={busy || !user} testID="handshake-rotate-btn">
          {busy ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="sync-outline" size={18} color="#fff" />}
          <Text style={s.btnT}>{it ? "Ruota adesso" : "Rotate now"}</Text>
        </TouchableOpacity>
        <Text style={s.note}>
          {it
            ? "Ruotare a mano è utile dopo un viaggio o qualunque momento in cui il telefono è stato fuori dalle tue mani. Se è stato proprio sequestrato, qui si ruotano solo le chiavi d'aggancio: per rifare anche usa-e-getta, sessioni e chiavi dei contatti, e per ricontrollare i contatti verificati, serve «Dopo la dogana»."
            : "Manual rotation is useful after a trip or any moment the phone left your hands. If it was actually seized, this only rotates the handshake keys: to also redo one-time keys, sessions and contact keys, and to re-check verified contacts, use \"After the border\"."}
        </Text>
        <TouchableOpacity style={s.ghost} onPress={() => navigation.navigate("AfterBorder")} testID="handshake-goto-border">
          <Ionicons name="shield-half-outline" size={17} color={theme.danger} />
          <Text style={s.ghostT}>{it ? "Apri «Dopo la dogana»" : "Open \"After the border\""}</Text>
        </TouchableOpacity>

        <Text style={s.section}>{it ? "Cosa cambia e cosa no" : "What changes and what does not"}</Text>
        {FACTS.map((x, i) => (
          <View key={i} style={s.card} testID={`handshake-fact-${i}`}>
            <Ionicons name={x.i} size={22} color={theme.primary} style={{ marginTop: 2 }} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={s.cardT}>{x.t}</Text>
              <Text style={s.cardD}>{x.d}</Text>
            </View>
          </View>
        ))}

        <Text style={s.section}>{it ? "Il limite, detto chiaro" : "The limit, stated plainly"}</Text>
        <View style={s.card}>
          <Ionicons name="warning-outline" size={22} color={theme.danger} style={{ marginTop: 2 }} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={s.cardD}>
              {it
                ? "Ogni generazione è ricavata dal tuo file chiave: non se ne conserva nessuna, si rifanno quando servono. Il rovescio è che chi rubasse il file chiave otterrebbe tutte le generazioni, passate e future. La rotazione accorcia la vita di una chiave pubblicata; non sostituisce la custodia del file chiave, e non è una difesa contro un telefono già compromesso."
                : "Every generation is derived from your key file: none is stored, they are recomputed when needed. The flip side is that stealing the key file yields every generation, past and future. Rotation shortens the life of a published key; it does not replace keeping the key file safe, and it is not a defence against an already compromised phone."}
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 10, borderBottomColor: theme.border, borderBottomWidth: 1 },
  title: { color: theme.text, fontSize: 18, fontWeight: "800" },
  hero: { alignItems: "center", paddingVertical: 18, paddingHorizontal: 6 },
  heroT: { color: theme.text, fontSize: 18, fontWeight: "800", marginTop: 10, textAlign: "center" },
  heroD: { color: theme.textDim, fontSize: 13, marginTop: 8, textAlign: "center", lineHeight: 19 },
  gcard: { backgroundColor: theme.surface, borderRadius: 14, paddingHorizontal: 14, borderColor: theme.border, borderWidth: 1, minHeight: 60, justifyContent: "center" },
  grow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, borderBottomColor: theme.border, borderBottomWidth: 1, gap: 12 },
  gk: { color: theme.textDim, fontSize: 13, flex: 1 },
  gv: { color: theme.text, fontSize: 14, fontWeight: "800" },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: theme.primary, borderRadius: 12, paddingVertical: 13, marginTop: 14 },
  btnT: { color: "#fff", fontWeight: "800", fontSize: 15 },
  note: { color: theme.textFaint, fontSize: 11.5, lineHeight: 17, marginTop: 10 },
  ghost: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 12, marginTop: 10, borderWidth: 1, borderColor: theme.danger },
  ghostT: { color: theme.danger, fontWeight: "800", fontSize: 14 },
  section: { color: theme.textDim, fontSize: 13, fontWeight: "700", marginTop: 22, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 },
  card: { flexDirection: "row", backgroundColor: theme.surface, borderRadius: 14, padding: 14, borderColor: theme.border, borderWidth: 1, marginBottom: 10 },
  cardT: { color: theme.text, fontSize: 15, fontWeight: "700" },
  cardD: { color: theme.textDim, fontSize: 13, marginTop: 5, lineHeight: 19 },
});

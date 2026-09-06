// DOPO LA DOGANA — la schermata. Un pulsante, sei passaggi, una ricevuta.
import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../context/AuthContext";
import { theme } from "../theme";
import { afterBorder } from "../lib/afterborder";

export default function AfterBorderScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { lang } = useI18n();
  const it = lang !== "en";
  const { user } = useAuth();
  const [state, setState] = useState({});   // { indice: "run" | "ok" | "err" }
  const [busy, setBusy] = useState(false);
  const [rep, setRep] = useState(null);

  const STEPS = it
    ? [
      { t: "Chiavi usa-e-getta", d: "Bruciate tutte. Il server butta le pubbliche, il telefono ne pubblica un lotto nuovo." },
      { t: "Chiavi d'aggancio", d: "Generazione nuova, X25519 e ML-KEM-1024. Numero di sicurezza invariato." },
      { t: "Sessioni e chiavi dei contatti", d: "Ogni conversazione riparte da una radice nuova. Le chiavi dei contatti tornano dal server." },
      { t: "Contatti verificati", d: "Si ricontrolla che l'impronta non sia cambiata mentre eravate lontani dal telefono." },
      { t: "File decifrati nella cache", d: "Foto, video, documenti aperti ed esportazioni: cancellati." },
    ]
    : [
      { t: "One-time keys", d: "All burned. The server drops the public ones, the phone publishes a fresh batch." },
      { t: "Handshake keys", d: "New generation, X25519 and ML-KEM-1024. Safety number unchanged." },
      { t: "Sessions and contact keys", d: "Every conversation restarts from a new root. Contact keys are fetched again." },
      { t: "Verified contacts", d: "Re-checks that no fingerprint changed while you were away from the phone." },
      { t: "Decrypted files in cache", d: "Photos, videos, opened documents and exports: deleted." },
    ];

  const go = () => {
    Alert.alert(
      it ? "Rifare tutte le chiavi?" : "Redo all keys?",
      it
        ? "Serve rete. Ogni conversazione riparte da zero: i messaggi già in viaggio, scritti con le chiavi vecchie, potrebbero non arrivare. La cronologia sul telefono NON si tocca, l'identità e il numero di sicurezza nemmeno."
        : "Requires network. Every conversation restarts: messages already in flight, written with the old keys, may not arrive. Your history on this phone is NOT touched, nor your identity or safety number.",
      [
        { text: it ? "Annulla" : "Cancel", style: "cancel" },
        {
          text: it ? "Procedi" : "Proceed",
          style: "destructive",
          onPress: async () => {
            setBusy(true); setRep(null); setState({});
            const r = await afterBorder(user, (i, s) => setState((p) => Object.assign({}, p, { [i]: s })));
            setRep(r); setBusy(false);
          },
        },
      ],
    );
  };

  const mark = (i) => {
    const s = state[i];
    if (s === "run") return <ActivityIndicator size="small" color={theme.primary} />;
    if (s === "ok") return <Ionicons name="checkmark-circle-outline" size={20} color={theme.accent} />;
    if (s === "err") return <Ionicons name="close-circle-outline" size={20} color={theme.danger} />;
    return <Ionicons name="ellipse-outline" size={18} color={theme.textFaint} />;
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} disabled={busy} testID="border-back" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back-outline" size={26} color={busy ? theme.textFaint : theme.text} />
        </TouchableOpacity>
        <Text style={s.title}>{it ? "Dopo la dogana" : "After the border"}</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} testID="border-screen">
        <View style={s.hero}>
          <Ionicons name="shield-half-outline" size={44} color={theme.danger} />
          <Text style={s.heroT}>{it ? "Il telefono è stato fuori dalle tue mani" : "Your phone left your hands"}</Text>
          <Text style={s.heroD}>
            {it
              ? "Un controllo alla frontiera, un fermo, un albergo. Chi l'ha avuto in mano potrebbe aver copiato dei file: lo stato delle sessioni, i segreti delle usa-e-getta non ancora consumate. Un tocco rifà tutto ciò che si può rifare."
              : "A border check, a stop, a hotel. Whoever held it may have copied files: session state, the secrets of one-time keys not yet consumed. One tap redoes everything that can be redone."}
          </Text>
        </View>

        <TouchableOpacity style={[s.btn, busy && { opacity: 0.6 }]} onPress={go} disabled={busy || !user} testID="border-run-btn">
          {busy ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="flash-outline" size={18} color="#fff" />}
          <Text style={s.btnT}>{busy ? (it ? "In corso…" : "Working…") : (it ? "Rifai tutte le chiavi adesso" : "Redo all keys now")}</Text>
        </TouchableOpacity>

        <Text style={s.section}>{it ? "Cosa fa, in ordine" : "What it does, in order"}</Text>
        {STEPS.map((x, i) => (
          <View key={i} style={s.card} testID={`border-step-${i}`}>
            <View style={{ width: 24, alignItems: "center", marginTop: 2 }}>{mark(i)}</View>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={s.cardT}>{x.t}</Text>
              <Text style={s.cardD}>{x.d}</Text>
            </View>
          </View>
        ))}

        {rep ? (
          <View testID="border-report">
            <Text style={s.section}>{it ? "Ricevuta" : "Receipt"}</Text>
            {rep.changed.length ? (
              <View style={[s.card, { borderColor: theme.danger }]} testID="border-alarm">
                <Ionicons name="alert-circle-outline" size={22} color={theme.danger} style={{ marginTop: 2 }} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[s.cardT, { color: theme.danger }]}>
                    {it ? "Attenzione: chiavi cambiate" : "Warning: keys changed"}
                  </Text>
                  <Text style={s.cardD}>
                    {(it
                      ? "Questi contatti erano verificati e ora hanno un'impronta diversa. Può essere un telefono nuovo, o qualcuno che si è messo in mezzo. Rifate la verifica di persona prima di scrivere: "
                      : "These contacts were verified and now show a different fingerprint. It may be a new phone, or someone in the middle. Verify in person before writing: ") + rep.changed.join(", ")}
                  </Text>
                </View>
              </View>
            ) : null}
            <View style={s.gcard}>
              {[
                [it ? "Chiavi usa-e-getta" : "One-time keys", rep.prekeys ? (it ? "rifatte" : "redone") : (it ? "non riuscito" : "failed")],
                [it ? "Generazione d'aggancio" : "Handshake generation", rep.gen ? String(rep.gen) : (it ? "non riuscito" : "failed")],
                [it ? "Sessioni azzerate" : "Sessions cleared", String(rep.sessions)],
                [it ? "Chiavi dei contatti buttate" : "Contact keys dropped", String(rep.peerKeys)],
                [it ? "Contatti verificati ricontrollati" : "Verified contacts re-checked", String(rep.checked)],
                [it ? "File in chiaro cancellati" : "Plaintext files deleted", String(rep.cache)],
              ].map(([k, v], i, a) => (
                <View key={k} style={[s.grow, i === a.length - 1 && { borderBottomWidth: 0 }]}>
                  <Text style={s.gk}>{k}</Text>
                  <Text style={s.gv}>{v}</Text>
                </View>
              ))}
            </View>
            {rep.errors.length ? (
              <Text style={[s.note, { color: theme.danger }]}>
                {(it ? "Passaggi non riusciti (riprova quando hai rete): " : "Failed steps (retry when online): ") + rep.errors.join(", ")}
              </Text>
            ) : (
              <Text style={[s.note, { color: theme.accent }]}>
                {it ? "Tutto fatto. Identità, numero di sicurezza e cronologia: intatti." : "All done. Identity, safety number and history: untouched."}
              </Text>
            )}
          </View>
        ) : null}

        <Text style={s.section}>{it ? "Cosa NON risolve" : "What it does NOT fix"}</Text>
        <View style={[s.card, { marginBottom: 24 }]}>
          <Ionicons name="warning-outline" size={22} color={theme.danger} style={{ marginTop: 2 }} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={s.cardD}>
              {it
                ? "L'identità ML-DSA-65 non si può rifare: cambiarla vuol dire cambiare numero di sicurezza, e ogni contatto verificato vedrebbe un allarme. Quindi: se il sospetto è che vi abbiano copiato IL FILE CHIAVE, o che il telefono sia stato modificato a livello di sistema, questo pulsante non basta. In quel caso l'unica risposta è l'autodistruzione e un'identità nuova su un telefono diverso. Preferiamo dirlo che lasciarvi credere il contrario."
                : "The ML-DSA-65 identity cannot be redone: changing it changes your safety number, and every verified contact would see an alarm. So: if you suspect THE KEY FILE was copied, or that the phone was tampered with at system level, this button is not enough. In that case the only answer is self-destruct and a new identity on a different phone. We would rather say it than let you believe otherwise."}
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
  hero: { alignItems: "center", paddingVertical: 16, paddingHorizontal: 6 },
  heroT: { color: theme.text, fontSize: 18, fontWeight: "800", marginTop: 10, textAlign: "center" },
  heroD: { color: theme.textDim, fontSize: 13, marginTop: 8, textAlign: "center", lineHeight: 19 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: theme.danger, borderRadius: 12, paddingVertical: 14, marginTop: 6 },
  btnT: { color: "#fff", fontWeight: "800", fontSize: 15 },
  section: { color: theme.textDim, fontSize: 13, fontWeight: "700", marginTop: 22, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 },
  card: { flexDirection: "row", backgroundColor: theme.surface, borderRadius: 14, padding: 14, borderColor: theme.border, borderWidth: 1, marginBottom: 10 },
  cardT: { color: theme.text, fontSize: 15, fontWeight: "700" },
  cardD: { color: theme.textDim, fontSize: 13, marginTop: 5, lineHeight: 19 },
  gcard: { backgroundColor: theme.surface, borderRadius: 14, paddingHorizontal: 14, borderColor: theme.border, borderWidth: 1 },
  grow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 11, borderBottomColor: theme.border, borderBottomWidth: 1, gap: 12 },
  gk: { color: theme.textDim, fontSize: 13, flex: 1 },
  gv: { color: theme.text, fontSize: 14, fontWeight: "800" },
  note: { fontSize: 12, lineHeight: 18, marginTop: 10, fontWeight: "600" },
});

import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import * as integrity from "../lib/integrity";
import * as lock from "../lib/lock";
import { isOwner } from "../lib/canary";

// ALLARME MANOMISSIONE — v2.8.0
//
// Copre TUTTA l'interfaccia quando il telefono risulta rootato, o quando qualcuno ha
// collegato un debugger o attivato il debug USB: sono i due canali con cui si estraggono i
// dati di un'app. Il controllo si rifa a ogni ritorno in primo piano, perche' un cavo si
// attacca mentre l'app e' aperta, non prima.
//
// LA COSA CHE VA DETTA, e che sta scritta anche nella schermata: questa difesa SI PUO
// BATTERE. Magisk sa nascondersi, e chi controlla il sistema controlla anche cio' che
// l'app riesce a vedere. Serve a far scattare un avviso quando la manomissione e'
// visibile — la maggior parte dei casi reali, non tutti.
// La difesa che non si batte e' un'altra: la chiave nel chip di sicurezza. Anche con root
// pieno, il sigillo si puo solo CHIEDERE al chip su questo telefono, non portare via.
//
// Nessuna cancellazione automatica: decide l'utente. Un'app che si autodistrugge da sola
// perche' ha creduto di vedere root e' un'app che ti perde i dati per un falso positivo.
//
// ── NOVITA' v2.8.0: L'ECCEZIONE SI PAGA CON IL PIN ────────────────────────────
// Prima "Sono io, continua comunque" era un pulsante e bastava premerlo: chiunque avesse
// il telefono in mano, root compreso, poteva togliersi l'avviso di torno. Adesso l'unica
// via e' scrivere il PIN REALE. Chi ha rootato il telefono per estrarre i dati il PIN non
// lo ha, e quindi l'avviso gli resta davanti.
//
// Tre dettagli non ovvi, tutti deliberati:
//  · Il PIN ESCA riceve LA STESSA RISPOSTA del PIN sbagliato. Se dicessimo "questo e'
//    l'esca" avremmo appena rivelato che esiste un secondo fondo — cioe' distrutto il
//    doppio fondo con un messaggio di errore.
//  · Il PIN DI EMERGENZA cancella, anche da qui. E' quello il suo unico compito, e non
//    cambia perche' e' stato scritto in questa schermata invece che in quella di sblocco.
//  · L'eccezione vale UNA SESSIONE. Vive in memoria: chiudi l'app e l'avviso torna. Non
//    si scrive su disco di proposito — una preferenza "ignora la manomissione" salvata sul
//    telefono e' esattamente il file che un attaccante vorrebbe trovare (e falsificare).
export default function TamperGate() {
  const { wipeNow, user } = useAuth();
  const [r, setR] = useState(null);
  const [ignorato, setIgnorato] = useState(false);
  const [pinAperto, setPinAperto] = useState(false);
  const [pin, setPin] = useState("");
  const [pinErr, setPinErr] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [pinEsiste, setPinEsiste] = useState(null);

  useEffect(() => integrity.sorveglia(setR), []);
  useEffect(() => { lock.hasPin().then(setPinEsiste).catch(() => setPinEsiste(false)); }, []);

  if (!r || !r.allarme || ignorato) return null;

  const titolo = r.root
    ? "Rilevato tentativo di estrazione dati"
    : "Rilevato accesso di debug al telefono";

  const proprietario = isOwner(user);

  const provaPin = async () => {
    if (pinBusy) return;
    setPinBusy(true); setPinErr("");
    try {
      const esito = await lock.verifyPin(pin);
      if (esito === "ok") { setPin(""); setIgnorato(true); return; }
      if (esito === "panic") { setPin(""); await wipeNow(); return; }
      // "wrong" e "decoy" danno la stessa risposta, parola per parola.
      setPin(""); setPinErr("PIN non valido.");
    } catch { setPinErr("PIN non valido."); } finally { setPinBusy(false); }
  };

  return (
    <View style={s.wrap} testID="tamper-gate">
      <ScrollView contentContainerStyle={s.body}>
        <Ionicons name="warning-outline" size={54} color="#50C878" />
        <Text style={s.h1} testID="tamper-title">{titolo}</Text>
        <Text style={s.p}>
          Questo telefono e' in una condizione in cui i dati di Lattice possono essere letti
          da fuori dall'app. Vuoi eliminare tutto istantaneamente?
        </Text>

        <View style={s.box}>
          <Text style={s.boxT}>Cosa ho visto, per nome</Text>
          {r.motivi.map((m, i) => (
            <Text key={i} style={s.li} testID={"tamper-motivo-" + i}>· {m}</Text>
          ))}
        </View>

        <Pressable style={s.rosso} onPress={wipeNow} testID="tamper-wipe">
          <Text style={s.rossoT}>ELIMINA TUTTO ADESSO</Text>
          <Text style={s.rossoS}>
            Chiavi, messaggi, rubrica e la chiave dentro il chip di sicurezza. Definitivo:
            senza quella chiave nemmeno il PIN giusto riapre piu niente.
          </Text>
        </Pressable>

        {pinEsiste === false ? (
          // Nessun PIN impostato: non c'e' niente con cui dimostrare di essere il
          // proprietario, e chiudere fuori chi non ha ancora messo un PIN sarebbe
          // punirlo per una cosa che non c'entra con la manomissione.
          <Pressable style={s.grigio} onPress={() => setIgnorato(true)} testID="tamper-dismiss">
            <Text style={s.grigioT}>Sono io, continua comunque</Text>
          </Pressable>
        ) : !pinAperto ? (
          <Pressable style={s.grigio} onPress={() => { setPinAperto(true); setPinErr(""); }} testID="tamper-dismiss">
            <Text style={s.grigioT}>Sono io, continua comunque</Text>
            <Text style={s.grigioS}>serve il PIN reale · vale per questa sessione</Text>
          </Pressable>
        ) : (
          <View style={s.pinBox} testID="tamper-pin-box">
            <Text style={s.boxT}>{proprietario ? "Eccezione del proprietario" : "Conferma con il PIN"}</Text>
            <Text style={s.pinP}>
              Scrivi il PIN reale. L'avviso resta via fino alla chiusura dell'app: alla
              riapertura il controllo si rifa da zero.
            </Text>
            <TextInput
              style={s.pinInput}
              value={pin}
              onChangeText={(v) => { setPin(v.replace(/[^0-9]/g, "").slice(0, 12)); setPinErr(""); }}
              placeholder="PIN"
              placeholderTextColor="#4A5A50"
              keyboardType="number-pad"
              secureTextEntry
              autoFocus
              onSubmitEditing={provaPin}
              testID="tamper-pin-input"
            />
            {!!pinErr && <Text style={s.pinErr} testID="tamper-pin-error">{pinErr}</Text>}
            <View style={s.pinRow}>
              <Pressable style={s.pinAnnulla} onPress={() => { setPinAperto(false); setPin(""); setPinErr(""); }} testID="tamper-pin-cancel">
                <Text style={s.grigioT}>Annulla</Text>
              </Pressable>
              <Pressable style={[s.pinOk, (pin.length < 4 || pinBusy) && s.pinOkOff]} disabled={pin.length < 4 || pinBusy} onPress={provaPin} testID="tamper-pin-confirm">
                <Text style={s.pinOkT}>{pinBusy ? "Verifico…" : "Continua"}</Text>
              </Pressable>
            </View>
          </View>
        )}

        <Text style={s.nota}>
          Onesta: questo controllo si puo battere. Magisk sa nascondersi, e chi controlla il
          sistema controlla anche cio' che quest'app riesce a vedere. Serve a farti scattare
          un avviso quando la manomissione e' visibile, non a garantirti che non ce ne sia
          una invisibile. La difesa che non si batte e' che la chiave dei tuoi dati vive nel
          chip di sicurezza e non esce da questo telefono: portati via l'archivio, e altrove
          non si apre.
        </Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, backgroundColor: "#000", zIndex: 9999 },
  body: { padding: 28, paddingTop: 80, gap: 16, alignItems: "flex-start" },
  h1: { color: "#fff", fontSize: 26, fontWeight: "800", lineHeight: 32 },
  p: { color: "#C6D6CC", fontSize: 15, lineHeight: 22 },
  box: { borderWidth: 1, borderColor: "rgba(80,200,120,0.4)", borderRadius: 14, padding: 14, width: "100%", gap: 4 },
  boxT: { color: "#50C878", fontSize: 12, fontWeight: "800", marginBottom: 4, letterSpacing: 0.5 },
  li: { color: "#8A9C91", fontSize: 12.5, lineHeight: 19 },
  rosso: { backgroundColor: "#E0475F", borderRadius: 14, padding: 16, width: "100%", gap: 6 },
  rossoT: { color: "#fff", fontSize: 15, fontWeight: "800", letterSpacing: 0.5 },
  rossoS: { color: "#fff", fontSize: 12, lineHeight: 18, opacity: 0.92 },
  grigio: { borderWidth: 1, borderColor: "#25342B", borderRadius: 14, padding: 14, width: "100%", alignItems: "center", gap: 4 },
  grigioT: { color: "#C6D6CC", fontSize: 14, fontWeight: "700" },
  grigioS: { color: "#6F7D74", fontSize: 11.5 },
  pinBox: { borderWidth: 1, borderColor: "rgba(80,200,120,0.4)", borderRadius: 14, padding: 14, width: "100%", gap: 10 },
  pinP: { color: "#8A9C91", fontSize: 12.5, lineHeight: 19 },
  pinInput: { borderWidth: 1, borderColor: "#25342B", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: "#fff", fontSize: 18, letterSpacing: 6, backgroundColor: "#0A0F0C" },
  pinErr: { color: "#E0475F", fontSize: 12.5, fontWeight: "700" },
  pinRow: { flexDirection: "row", gap: 10 },
  pinAnnulla: { flex: 1, borderWidth: 1, borderColor: "#25342B", borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  pinOk: { flex: 1, backgroundColor: "#50C878", borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  pinOkOff: { opacity: 0.4 },
  pinOkT: { color: "#04140A", fontSize: 14, fontWeight: "800" },
  nota: { color: "#6F7D74", fontSize: 11.5, lineHeight: 18, marginTop: 8 },
});

// Verifica contatto: numero di sicurezza a 60 cifre + QR (anti man-in-the-middle).
//
// v1.5.1 — APERTURA ISTANTANEA. Prima la schermata compariva dopo diversi secondi: si
// aspettavano rete (chiavi del contatto) e conti pesanti PRIMA di disegnare, e nel
// frattempo anche il tasto Indietro sembrava bloccato perché i tocchi restavano in coda.
// Ora si disegna subito la struttura, poi arrivano i pezzi, uno alla volta, senza mai
// occupare il thread dell'interfaccia:
//   1) l'impronta del contatto già vista in passato (salvata sul telefono) → numero subito;
//   2) la tua impronta, calcolata sul telefono appena l'interfaccia è libera;
//   3) le chiavi fresche dal server, per confermare che nulla è cambiato;
//   4) lo stato della catena che si rigenera, per ultimo.
// Il QR è una sola immagine PNG generata fuori dal percorso di apertura (vedi QrCode.js).
// Nessuna verifica indebolita: il numero appare solo con impronte davvero disponibili, e
// un cambio di chiavi viene segnalato con l'avviso rosso.
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Modal,
  Share, TextInput, InteractionManager,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../lib/i18n";
import { useTint } from "../lib/appearance";
import { theme } from "../theme";
import QrCode from "../components/QrCode";
import QrScanner from "../components/QrScanner";
import { ratchetStats } from "../lib/ratchet";
import {
  myFingerprint, peerFingerprint, safetyNumber, digitGroups, qrPayload, parseQr,
  getVerified, setVerified, clearVerified,
} from "../lib/verify";

// Impronte già ottenute in questa sessione: riaprire lo Scudo è immediato.
const mem = new Map();
const PFP = (lns) => "pfp:" + String(lns || "");

export default function VerifyContactScreen({ route, navigation }) {
  const tint = useTint();
  const styles = React.useMemo(() => makeStyles(tint), [tint]);
  const { user } = useAuth();
  const { lang } = useI18n();
  const en = lang === "en";
  const peer = route.params?.peer;
  const peerName = route.params?.peer_name || (peer || "").split("@")[0];

  const [err, setErr] = useState("");
  const [myFp, setMyFp] = useState("");
  const [peerFp, setPeerFp] = useState(mem.get(peer) || "");
  const [fresh, setFresh] = useState(mem.has(peer)); // impronta confermata dal server ora
  const [rec, setRec] = useState(null);
  const [rat, setRat] = useState(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  // (1) e (2): niente rete, niente attese. Il conto della propria impronta (600 giri di
  // SHA3) parte quando l'interfaccia è già a schermo.
  useEffect(() => {
    mounted.current = true;
    getVerified(peer).then((saved) => { if (mounted.current) setRec(saved); }).catch(() => {});
    if (!mem.has(peer)) {
      AsyncStorage.getItem(PFP(peer)).then((v) => {
        if (v && mounted.current) setPeerFp((cur) => cur || v);
      }).catch(() => {});
    }
    const task = InteractionManager.runAfterInteractions(() => {
      try {
        const mine = myFingerprint(user);
        if (mounted.current) setMyFp(mine);
      } catch (e) { /* si vedrà nell'avviso sotto */ }
    });
    return () => { try { task && task.cancel && task.cancel(); } catch { /* niente */ } };
  }, [peer, user]);

  // (3) e (4): rete e stato della catena, sempre dopo che la schermata è visibile.
  const refresh = useCallback(async () => {
    setErr("");
    try {
      const p = await peerFingerprint(peer);
      if (p && p.fp) {
        mem.set(peer, p.fp);
        AsyncStorage.setItem(PFP(peer), p.fp).catch(() => {});
        if (mounted.current) { setPeerFp(p.fp); setFresh(true); }
      }
    } catch (e) {
      if (mounted.current && !mem.has(peer)) setErr(String((e && e.message) || e));
    }
    try {
      const rs = await ratchetStats(peer);
      if (mounted.current) setRat(rs);
    } catch { /* niente */ }
  }, [peer]);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => { refresh(); });
    return () => { try { task && task.cancel && task.cancel(); } catch { /* niente */ } };
  }, [refresh]);

  const sas = safetyNumber(myFp, peerFp);
  const state = !rec ? "none" : rec.fp === peerFp ? "ok" : "changed";
  const waiting = !myFp || !peerFp;

  const markVerified = async (method) => {
    await setVerified(peer, peerFp, method);
    setRec({ fp: peerFp, at: new Date().toISOString(), method });
  };

  // Controlla il codice dell'altro (letto col lettore QR o incollato).
  const checkCode = async (raw) => {
    const parsed = parseQr(raw);
    if (!parsed) {
      Alert.alert(en ? "Unknown code" : "Codice non riconosciuto",
        en ? "This is not a Lattice verification code." : "Questo non è un codice di verifica Lattice.");
      return;
    }
    if ((parsed.lns || "").toLowerCase() !== String(peer).toLowerCase()) {
      Alert.alert(en ? "Wrong contact" : "Contatto diverso",
        (en ? "That code belongs to " : "Quel codice appartiene a ") + parsed.lns + (en ? ", not to this chat." : ", non a questa chat."));
      return;
    }
    setPasteOpen(false); setPasted("");
    if (!peerFp) {
      Alert.alert(en ? "One moment" : "Un attimo",
        en ? "The contact's key is still arriving: try again in a second."
           : "La chiave del contatto sta ancora arrivando: riprova tra un istante.");
      return;
    }
    if (parsed.fp40 === String(peerFp).slice(0, 40)) {
      await markVerified("qr");
      Alert.alert(en ? "Contact verified" : "Contatto verificato",
        en ? "The keys match: nobody is in the middle of this conversation."
           : "Le chiavi combaciano: nessuno è in mezzo a questa conversazione.");
    } else {
      Alert.alert(en ? "⚠ Keys DO NOT match" : "⚠ Le chiavi NON combaciano",
        en ? "The code from the other phone is different from the key the server gave you. Do not send sensitive content and repeat the check in person."
           : "Il codice dell'altro telefono è diverso dalla chiave che il server ti ha consegnato. Non inviare contenuti sensibili e rifate la verifica di persona.");
    }
  };

  const onScanFail = (why) => {
    Alert.alert(
      why === "perm" ? (en ? "Camera permission denied" : "Permesso fotocamera negato") : (en ? "No code found" : "Nessun codice trovato"),
      why === "perm"
        ? (en ? "Allow the camera, or paste the code as text." : "Consenti la fotocamera, oppure incolla il codice come testo.")
        : (en ? "Frame the QR on the other phone filling the picture, with good light." : "Inquadra il QR dell'altro telefono riempiendo la foto, con buona luce."),
    );
  };

  const shareNumber = () => {
    Share.share({
      message: (en ? "Lattice safety number with " : "Numero di sicurezza Lattice con ") + peerName + ":\n" + digitGroups(sas).join(" "),
    }).catch(() => {});
  };
  const shareMyCode = () => {
    Share.share({ message: qrPayload(user?.lns, myFp) }).catch(() => {});
  };

  const badge = state === "ok"
    ? { c: theme.accent, i: "shield-checkmark", t: en ? "Verified" : "Verificato" }
    : state === "changed"
      ? { c: theme.danger, i: "warning", t: en ? "Keys changed" : "Chiavi cambiate" }
      : { c: theme.textDim, i: "shield-outline", t: en ? "Not verified" : "Non verificato" };

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="verify-screen">
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          testID="verify-back"
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back-outline" size={26} color={tint} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{en ? "Verify contact" : "Verifica contatto"}</Text>
          <Text style={styles.sub} numberOfLines={1}>{peerName}</Text>
        </View>
        <View style={[styles.badge, { borderColor: badge.c }]} testID="verify-badge">
          <Ionicons name={badge.i} size={13} color={badge.c} />
          <Text style={[styles.badgeTxt, { color: badge.c }]}>{badge.t}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {state === "changed" && (
          <View style={styles.alertBox} testID="verify-changed-alert">
            <Ionicons name="warning-outline" size={16} color={theme.danger} />
            <Text style={styles.alertTxt}>
              {en
                ? "The keys of this contact changed after your last check. It happens after a key rotation or a new phone — but it is also what an attack looks like. Verify again in person."
                : "Le chiavi di questo contatto sono cambiate dopo l'ultima verifica. Succede dopo una rotazione della chiave o con un telefono nuovo — ma è anche l'aspetto che ha un attacco. Rifate la verifica di persona."}
            </Text>
          </View>
        )}

        {!!err && (
          <View style={styles.alertBox} testID="verify-error">
            <Ionicons name="cloud-offline-outline" size={16} color={theme.danger} />
            <Text style={styles.alertTxt}>{err}</Text>
            <TouchableOpacity onPress={refresh} testID="verify-retry" hitSlop={10}>
              <Text style={[styles.linkTxt, { color: tint }]}>{en ? "Retry" : "Riprova"}</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{en ? "Safety number" : "Numero di sicurezza"}</Text>
          <Text style={styles.cardHint}>
            {en ? "The same 60 digits appear on both phones. Read them out loud in person or on a call you trust: if they match, nobody is in the middle."
                : "Le stesse 60 cifre compaiono sui due telefoni. Leggetele a voce, di persona o in una chiamata di cui vi fidate: se combaciano, nessuno è in mezzo."}
          </Text>
          {waiting ? (
            <View style={styles.sasWait} testID="verify-safety-waiting">
              <ActivityIndicator color={tint} />
              <Text style={styles.sasWaitTxt}>{en ? "Computing the number…" : "Calcolo il numero…"}</Text>
            </View>
          ) : (
            <View style={styles.sasGrid} testID="verify-safety-number">
              {digitGroups(sas).map((g, i) => (
                <Text key={i} style={styles.sasCell}>{g}</Text>
              ))}
            </View>
          )}
          {!waiting && !fresh && (
            <Text style={styles.sasStale} testID="verify-stale">
              {en ? "From the key saved on this phone — checking with the server…" : "Dalla chiave salvata su questo telefono — confronto col server in corso…"}
            </Text>
          )}
          <TouchableOpacity style={styles.linkRow} onPress={shareNumber} disabled={waiting} testID="verify-share-number">
            <Ionicons name="share-outline" size={15} color={tint} />
            <Text style={styles.linkTxt}>{en ? "Share the number" : "Condividi il numero"}</Text>
          </TouchableOpacity>
        </View>

        {state === "ok" ? (
          <TouchableOpacity
            style={[styles.btnGhost, { borderColor: theme.danger }]}
            testID="verify-clear-btn"
            onPress={() => Alert.alert(
              en ? "Remove verification" : "Rimuovi verifica",
              en ? "The contact will show as not verified again." : "Il contatto tornerà a comparire come non verificato.",
              [{ text: en ? "Cancel" : "Annulla", style: "cancel" },
               { text: en ? "Remove" : "Rimuovi", style: "destructive", onPress: async () => { await clearVerified(peer); setRec(null); } }]
            )}
          >
            <Text style={[styles.btnGhostTxt, { color: theme.danger }]}>{en ? "Remove verification" : "Rimuovi verifica"}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.btn, waiting && { opacity: 0.5 }]}
            disabled={waiting}
            testID="verify-manual-btn"
            onPress={() => Alert.alert(
              en ? "Do the numbers match?" : "I numeri combaciano?",
              en ? "Mark as verified only if the 60 digits are identical on both phones."
                 : "Segna come verificato solo se le 60 cifre sono identiche sui due telefoni.",
              [{ text: en ? "Cancel" : "Annulla", style: "cancel" },
               { text: en ? "They match" : "Combaciano", onPress: () => markVerified("manual") }]
            )}
          >
            <Ionicons name="shield-checkmark-outline" size={17} color="#fff" />
            <Text style={styles.btnTxt}>{en ? "They match: mark as verified" : "Combaciano: segna come verificato"}</Text>
          </TouchableOpacity>
        )}

        {!!rec && (
          <Text style={styles.meta} testID="verify-meta">
            {(en ? "Checked on " : "Verificato il ") + new Date(rec.at).toLocaleString()}
          </Text>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{en ? "Read their code" : "Leggi il suo codice"}</Text>
          <Text style={styles.cardHint}>
            {en ? "Point the camera at the QR shown on the other phone. The picture is read on this phone only and thrown away."
                : "Inquadra il QR mostrato sull'altro telefono. La foto viene letta solo qui e poi buttata."}
          </Text>
          <View style={{ height: 12 }} />
          <QrScanner
            tint={tint}
            label={en ? "Scan their QR" : "Inquadra il suo QR"}
            hint={en ? "Camera → automatic check" : "Fotocamera → controllo automatico"}
            onCode={checkCode}
            onFail={onScanFail}
            testID="verify-scan"
          />
          <TouchableOpacity style={styles.btnGhost} onPress={() => setPasteOpen(true)} testID="verify-paste-btn">
            <Text style={styles.btnGhostTxt}>{en ? "Or paste their code" : "Oppure incolla il suo codice"}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{en ? "Your code" : "Il tuo codice"}</Text>
          <Text style={styles.cardHint}>
            {en ? "The other person can read this QR from their Verify contact screen, or you can send them the code as text."
                : "L'altra persona può leggere questo QR dalla sua schermata Verifica contatto, oppure puoi mandargli il codice come testo."}
          </Text>
          <View style={{ alignItems: "center", marginTop: 14 }}>
            {myFp ? <QrCode value={qrPayload(user?.lns, myFp)} size={230} testID="verify-my-qr" /> : (
              <View style={styles.qrWait} testID="verify-my-qr-waiting"><ActivityIndicator color={tint} /></View>
            )}
          </View>
          <TouchableOpacity style={styles.linkRow} onPress={shareMyCode} disabled={!myFp} testID="verify-share-code">
            <Ionicons name="share-outline" size={15} color={tint} />
            <Text style={styles.linkTxt}>{en ? "Send my code" : "Invia il mio codice"}</Text>
          </TouchableOpacity>
        </View>

        {!!rat && rat.sessions > 0 && (
          <View style={styles.card} testID="verify-ratchet-card">
            <Text style={styles.cardTitle}>{en ? "Self-healing chain" : "Catena che si rigenera"}</Text>
            <Text style={styles.cardHint}>
              {en
                ? `${rat.hybrid ? "Hybrid triple ratchet (ML-KEM-768 + X25519): breaking one of the two is not enough. " : ""}This chat has renewed its keys ${rat.heals} times (${rat.sent} sent, ${rat.recv} received). Every message uses a new key, and each change of direction locks out anyone who copied the phone.`
                : `${rat.hybrid ? "Triplo ratchet ibrido (ML-KEM-768 + X25519): romperne uno dei due non basta. " : ""}Questa chat ha rinnovato le chiavi ${rat.heals} volte (${rat.sent} inviati, ${rat.recv} ricevuti). Ogni messaggio usa una chiave nuova e a ogni cambio di direzione chi avesse copiato il telefono resta fuori.`}
            </Text>
          </View>
        )}

        <Text style={styles.note}>
          {en
            ? "How it works: the number comes from the public keys your two phones actually use to encrypt. If they match, the server handed you the genuine key and no one can read along. The check stays on this phone: the server never learns which contacts you verified."
            : "Come funziona: il numero nasce dalle chiavi pubbliche che i vostri due telefoni usano davvero per cifrare. Se combaciano, il server ti ha consegnato la chiave autentica e nessuno può leggere di nascosto. La verifica resta su questo telefono: il server non sa quali contatti hai verificato."}
        </Text>
      </ScrollView>

      <Modal visible={pasteOpen} animationType="slide" transparent onRequestClose={() => setPasteOpen(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.cardTitle}>{en ? "Their code" : "Il codice dell'altro"}</Text>
            <Text style={styles.cardHint}>
              {en ? "Paste the text that starts with LATTICE1: — it comes from their Verify contact screen."
                  : "Incolla il testo che comincia con LATTICE1: — lo trovi nella sua schermata Verifica contatto."}
            </Text>
            <TextInput
              style={styles.input}
              value={pasted}
              onChangeText={setPasted}
              placeholder="LATTICE1:nome@lattice.lns:…"
              placeholderTextColor={theme.textFaint}
              selectionColor={tint}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              testID="verify-paste-input"
            />
            <TouchableOpacity style={styles.btn} onPress={() => checkCode(pasted)} testID="verify-paste-check">
              <Text style={styles.btnTxt}>{en ? "Check the code" : "Controlla il codice"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnGhost} onPress={() => { setPasteOpen(false); setPasted(""); }} testID="verify-paste-close">
              <Text style={styles.btnGhostTxt}>{en ? "Close" : "Chiudi"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (tint) => StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border },
  backBtn: { paddingVertical: 6, paddingRight: 4 },
  title: { color: theme.text, fontSize: 17, fontWeight: "700" },
  sub: { color: theme.textDim, fontSize: 12 },
  badge: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  badgeTxt: { fontSize: 11, fontWeight: "700" },
  card: { backgroundColor: theme.surface, borderWidth: 1, borderColor: tint + "26", borderRadius: 16, padding: 16, marginBottom: 14 },
  cardTitle: { color: theme.text, fontSize: 15, fontWeight: "700" },
  cardHint: { color: theme.textDim, fontSize: 12, marginTop: 4, lineHeight: 17 },
  sasGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: 14, marginHorizontal: -4 },
  sasCell: { width: "33.333%", textAlign: "center", color: theme.text, fontSize: 19, letterSpacing: 2, fontVariant: ["tabular-nums"], paddingVertical: 6 },
  sasWait: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 18 },
  sasWaitTxt: { color: theme.textDim, fontSize: 13 },
  sasStale: { color: theme.textFaint, fontSize: 11, marginTop: 6 },
  qrWait: { width: 230, height: 230, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.06)", alignItems: "center", justifyContent: "center" },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  linkTxt: { color: tint, fontSize: 13, fontWeight: "600" },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: tint, borderRadius: 14, paddingVertical: 14, marginBottom: 14 },
  btnTxt: { color: "#fff", fontSize: 15, fontWeight: "700" },
  btnGhost: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: tint + "4D", borderRadius: 14, paddingVertical: 13, marginBottom: 4 },
  btnGhostTxt: { color: theme.text, fontSize: 14, fontWeight: "600" },
  alertBox: { flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: "#2A1216", borderWidth: 1, borderColor: theme.danger, borderRadius: 14, padding: 14, marginBottom: 14 },
  alertTxt: { flex: 1, color: "#FFD9DE", fontSize: 12, lineHeight: 18 },
  meta: { color: theme.textFaint, fontSize: 11, textAlign: "center", marginBottom: 16 },
  note: { color: theme.textFaint, fontSize: 11, lineHeight: 17 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "center", padding: 18 },
  modalCard: { backgroundColor: theme.surface, borderWidth: 1, borderColor: tint + "33", borderRadius: 18, padding: 18 },
  input: { backgroundColor: theme.surfaceAlt, borderWidth: 1, borderColor: theme.border, borderRadius: 12, color: theme.text, paddingHorizontal: 14, paddingVertical: 11, fontSize: 13, marginTop: 12, marginBottom: 14, minHeight: 80, textAlignVertical: "top" },
});

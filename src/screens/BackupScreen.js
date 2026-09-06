// Backup cifrato LOCALE: creazione, salvataggio dove vuole l'utente e ripristino.
// Nessun byte passa dal server: il file esce dal telefono solo con la condivisione di sistema.
import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Switch,
  ActivityIndicator, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../lib/i18n";
import { theme } from "../theme";
import { suppressLock } from "../lib/lockGuard";
import { hasPin, verifyPin } from "../lib/lock";
import * as bkp from "../lib/backup";

const MODES = ["off", "weekly", "monthly"];

export default function BackupScreen({ route, navigation }) {
  const { user, signIn } = useAuth();
  const { lang } = useI18n();
  const en = lang === "en";
  const [pinAvail, setPinAvail] = useState(false);
  const [mode, setMode] = useState("password"); // "pin" | "password"
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [pin, setPin] = useState("");
  const [withAtts, setWithAtts] = useState(false);
  const [busy, setBusy] = useState("");
  const [step, setStep] = useState("");
  const [last, setLast] = useState(null);
  const [sched, setSched] = useState("off");
  const [picked, setPicked] = useState(null);
  const [restorePwd, setRestorePwd] = useState("");
  const [files, setFiles] = useState([]);

  const refresh = useCallback(async () => {
    setPinAvail(await hasPin());
    setLast(await bkp.lastBackupAt());
    setSched(await bkp.getSchedule());
    setFiles(await bkp.restoredFiles());
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (pinAvail && !user) setMode("password"); }, [pinAvail, user]);

  const secret = async () => {
    if (mode === "pin") {
      if (!/^\d{4,10}$/.test(pin)) throw new Error(en ? "Type your app PIN." : "Digita il PIN dell'app.");
      const r = await verifyPin(pin);
      if (r !== "ok") throw new Error(en ? "Wrong PIN." : "PIN errato.");
      return { password: "pin:" + pin, hint: "pin" };
    }
    if (pwd.length < 8) throw new Error(en ? "The password must be at least 8 characters." : "La password deve avere almeno 8 caratteri.");
    if (pwd !== pwd2) throw new Error(en ? "The two passwords are different." : "Le due password non coincidono.");
    return { password: pwd, hint: "password" };
  };

  const doExport = async () => {
    let s;
    try { s = await secret(); } catch (e) { Alert.alert(en ? "Wait" : "Un momento", String(e.message || e)); return; }
    setBusy("export"); setStep("");
    try {
      suppressLock();
      const r = await bkp.exportBackup({
        user, includeAtts: withAtts, password: s.password, hint: s.hint,
        onStep: (x) => setStep(x),
      });
      await refresh();
      Alert.alert(
        en ? "Backup created" : "Backup creato",
        (en ? "File: " : "File: ") + r.name + "\n" +
        (en ? "Conversations: " : "Conversazioni: ") + r.counts.convs +
        " · " + (en ? "messages: " : "messaggi: ") + r.counts.msgs +
        (withAtts ? " · " + (en ? "files: " : "file: ") + r.counts.files : "") + "\n" +
        (en ? "Size: " : "Dimensione: ") + Math.max(1, Math.round((r.size || 0) / 1024)) + " KB" +
        (r.counts.skippedEphemeral
          ? "\n" + (en ? "Disappearing messages left out: " : "Messaggi a scomparsa esclusi: ") + r.counts.skippedEphemeral
          : "") + "\n\n" +
        (en ? "Keep it somewhere safe: without the password it is unreadable, and nobody can recover it for you."
            : "Conservalo in un posto sicuro: senza la password è illeggibile e nessuno può recuperarlo per te.")
      );
      setPwd(""); setPwd2(""); setPin("");
    } catch (e) {
      Alert.alert(en ? "Backup failed" : "Backup non riuscito", String((e && e.message) || e));
    } finally { setBusy(""); setStep(""); }
  };

  const doPick = async () => {
    setBusy("pick");
    try {
      suppressLock();
      const r = await bkp.pickBackupFile();
      if (r) setPicked(r);
    } catch (e) {
      Alert.alert(en ? "File not valid" : "File non valido", String((e && e.message) || e));
    } finally { setBusy(""); }
  };

  const doRestore = async () => {
    if (!picked) return;
    const pass = picked.container.hint === "pin" ? "pin:" + restorePwd : restorePwd;
    setBusy("restore");
    try {
      const payload = bkp.decryptContainer(picked.container, pass);
      const rep = await bkp.restorePayload(payload);
      await refresh();
      setPicked(null); setRestorePwd("");
      const msg =
        (en ? "Conversations: " : "Conversazioni: ") + rep.convs + " · " + (en ? "messages: " : "messaggi: ") + rep.msgs + "\n" +
        (en ? "Settings restored: " : "Impostazioni ripristinate: ") + rep.prefs +
        (rep.files ? "\n" + (en ? "Files restored: " : "File ripristinati: ") + rep.files : "") +
        (rep.keyfile ? "\n" + (en ? "Identity key restored." : "File chiave (identità) ripristinato.") : "");
      if (rep.keyfile && !user && payload.keyfile) {
        Alert.alert(en ? "Backup restored" : "Backup ripristinato", msg, [
          {
            text: en ? "Sign in now" : "Entra ora",
            onPress: async () => {
              try { await signIn(payload.keyfile); } catch (e) { Alert.alert("Login", String((e && e.message) || e)); }
            },
          },
        ]);
      } else {
        Alert.alert(en ? "Backup restored" : "Backup ripristinato", msg + "\n\n" +
          (en ? "Older messages appear in the chats marked as archive."
              : "I messaggi più vecchi ricompaiono nelle chat, contrassegnati come archivio."));
      }
    } catch (e) {
      Alert.alert(en ? "Restore failed" : "Ripristino non riuscito", String((e && e.message) || e));
    } finally { setBusy(""); }
  };

  const setSchedule = async (m) => { setSched(m); await bkp.setSchedule(m); };

  const modeLabel = (m) => (m === "off"
    ? (en ? "Manual" : "Manuale")
    : m === "weekly" ? (en ? "Weekly" : "Settimanale") : (en ? "Monthly" : "Mensile"));

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="backup-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} testID="backup-back" hitSlop={10}>
          <Ionicons name="chevron-back-outline" size={26} color={theme.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{en ? "Encrypted backup" : "Backup cifrato"}</Text>
          <Text style={styles.sub}>{en ? "On your phone only — never on the server" : "Solo sul tuo telefono — mai sul server"}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{en ? "Status" : "Stato"}</Text>
          <Text style={styles.row} testID="backup-last">
            {last
              ? (en ? "Last backup: " : "Ultimo backup: ") + new Date(last).toLocaleString()
              : (en ? "No backup created yet on this phone." : "Nessun backup creato su questo telefono.")}
          </Text>
          <Text style={styles.cardHint}>{en ? "Reminder" : "Promemoria"}</Text>
          <View style={styles.chips}>
            {MODES.map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.chip, sched === m && styles.chipOn]}
                onPress={() => setSchedule(m)}
                testID={`backup-sched-${m}`}
              >
                <Text style={[styles.chipTxt, sched === m && styles.chipTxtOn]}>{modeLabel(m)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.note}>
            {en ? "The reminder is a local notification: it only tells you to make a new backup, the export always stays in your hands."
                : "Il promemoria è una notifica locale: ti ricorda solo di farne uno nuovo, l'export lo lanci sempre tu."}
          </Text>
        </View>

        {!!user && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{en ? "Create a backup" : "Crea un backup"}</Text>
            <Text style={styles.cardHint}>
              {en ? "Inside: identity key, contacts, settings, conversation text and the anonymous-mailbox history."
                  : "Dentro ci sono: file chiave (identità), rubrica, impostazioni, testo delle conversazioni e la cronologia delle cassette anonime."}
            </Text>
            <Text style={styles.warn} testID="backup-ephemeral-note">
              {en ? "Disappearing messages are never included: if they are meant to vanish, they vanish here too. Deleted messages cannot be recovered from a backup either."
                  : "I messaggi a scomparsa non vengono mai inclusi: se devono svanire, svaniscono anche qui. Nemmeno un backup può recuperare i messaggi cancellati."}
            </Text>

            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchLabel}>{en ? "Include photos and files" : "Includi foto e file"}</Text>
                <Text style={styles.switchHint}>
                  {en ? "Much bigger file (up to ~120 MB, single files up to 8 MB)."
                      : "File molto più grande (fino a ~120 MB, singoli allegati fino a 8 MB)."}
                </Text>
              </View>
              <Switch value={withAtts} onValueChange={setWithAtts} testID="backup-atts-switch"
                trackColor={{ true: theme.primary, false: theme.border }} thumbColor="#fff" />
            </View>

            <Text style={styles.cardHint}>{en ? "Protection" : "Protezione"}</Text>
            <View style={styles.chips}>
              <TouchableOpacity style={[styles.chip, mode === "password" && styles.chipOn]} onPress={() => setMode("password")} testID="backup-mode-password">
                <Text style={[styles.chipTxt, mode === "password" && styles.chipTxtOn]}>{en ? "Dedicated password" : "Password dedicata"}</Text>
              </TouchableOpacity>
              {pinAvail && (
                <TouchableOpacity style={[styles.chip, mode === "pin" && styles.chipOn]} onPress={() => setMode("pin")} testID="backup-mode-pin">
                  <Text style={[styles.chipTxt, mode === "pin" && styles.chipTxtOn]}>{en ? "App PIN" : "PIN dell'app"}</Text>
                </TouchableOpacity>
              )}
            </View>

            {mode === "pin" ? (
              <>
                <TextInput
                  style={styles.input} value={pin} onChangeText={setPin} placeholder={en ? "App PIN" : "PIN dell'app"}
                  placeholderTextColor={theme.textFaint} keyboardType="number-pad" secureTextEntry maxLength={10}
                  testID="backup-pin-input"
                />
                <Text style={styles.warn}>
                  {en ? "A 4-6 digit PIN is weak for a file that leaves the phone: prefer a long password for backups you keep for years."
                      : "Un PIN di 4-6 cifre è debole per un file che esce dal telefono: per i backup che conservi per anni è meglio una password lunga."}
                </Text>
              </>
            ) : (
              <>
                <TextInput
                  style={styles.input} value={pwd} onChangeText={setPwd} placeholder={en ? "Backup password (min 8)" : "Password del backup (min 8)"}
                  placeholderTextColor={theme.textFaint} secureTextEntry autoCapitalize="none" autoCorrect={false}
                  testID="backup-pwd-input"
                />
                <TextInput
                  style={styles.input} value={pwd2} onChangeText={setPwd2} placeholder={en ? "Repeat the password" : "Ripeti la password"}
                  placeholderTextColor={theme.textFaint} secureTextEntry autoCapitalize="none" autoCorrect={false}
                  testID="backup-pwd2-input"
                />
              </>
            )}

            <TouchableOpacity style={[styles.btn, busy && { opacity: 0.6 }]} onPress={doExport} disabled={!!busy} testID="backup-export-btn">
              {busy === "export" ? <ActivityIndicator color="#fff" /> : <Ionicons name="lock-closed-outline" size={17} color="#fff" />}
              <Text style={styles.btnTxt}>{en ? "Create encrypted backup" : "Crea backup cifrato"}</Text>
            </TouchableOpacity>
            {!!step && <Text style={styles.step} testID="backup-step">{step}…</Text>}
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{en ? "Restore a backup" : "Ripristina un backup"}</Text>
          <Text style={styles.cardHint}>
            {en ? "Pick the .lattice file and type its password. On a new phone this also brings back your identity key."
                : "Scegli il file .lattice e digita la sua password. Su un telefono nuovo torna anche il tuo file chiave (identità)."}
          </Text>
          <TouchableOpacity style={styles.btnGhost} onPress={doPick} disabled={!!busy} testID="backup-pick-btn">
            {busy === "pick" ? <ActivityIndicator color={theme.text} /> : (
              <Text style={styles.btnGhostTxt}>{picked ? picked.name : (en ? "Choose the backup file" : "Scegli il file di backup")}</Text>
            )}
          </TouchableOpacity>
          {!!picked && (
            <>
              <Text style={styles.row} testID="backup-picked-info">
                {(en ? "Created on " : "Creato il ") + new Date(picked.container.at).toLocaleString() +
                  (picked.container.lns ? " · " + picked.container.lns : "")}
              </Text>
              <TextInput
                style={styles.input} value={restorePwd} onChangeText={setRestorePwd}
                placeholder={picked.container.hint === "pin" ? (en ? "App PIN of that backup" : "PIN dell'app di quel backup") : (en ? "Backup password" : "Password del backup")}
                placeholderTextColor={theme.textFaint} secureTextEntry autoCapitalize="none" autoCorrect={false}
                keyboardType={picked.container.hint === "pin" ? "number-pad" : "default"}
                testID="backup-restore-pwd"
              />
              <TouchableOpacity style={[styles.btn, busy && { opacity: 0.6 }]} onPress={doRestore} disabled={!!busy} testID="backup-restore-btn">
                {busy === "restore" ? <ActivityIndicator color="#fff" /> : <Ionicons name="cloud-download-outline" size={17} color="#fff" />}
                <Text style={styles.btnTxt}>{en ? "Restore" : "Ripristina"}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {files.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{en ? "Restored files" : "File ripristinati"}</Text>
            <Text style={styles.cardHint}>
              {en ? "Attachments taken out of the backup: tap to open or save them."
                  : "Allegati estratti dal backup: tocca per aprirli o salvarli."}
            </Text>
            {files.slice(0, 40).map((f) => (
              <TouchableOpacity key={f.uri} style={styles.fileRow} onPress={() => bkp.shareRestoredFile(f.uri)} testID="backup-file-row">
                <Ionicons name="document-outline" size={16} color={theme.primary} />
                <Text style={styles.fileTxt} numberOfLines={1}>{f.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <Text style={styles.note}>
          {en ? "How it works: the file is built on the phone and encrypted with AES-256-GCM, key derived with scrypt from your password. The app never uploads it: the share sheet lets you choose where it goes. Lose the password and the backup is gone forever — that is the point."
              : "Come funziona: il file viene creato sul telefono e cifrato con AES-256-GCM, chiave derivata con scrypt dalla tua password. L'app non lo carica da nessuna parte: la finestra di condivisione ti fa scegliere dove finisce. Se perdi la password il backup è perso per sempre — è proprio questo il punto."}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border },
  title: { color: theme.text, fontSize: 17, fontWeight: "700" },
  sub: { color: theme.textDim, fontSize: 12 },
  card: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 16, padding: 16, marginBottom: 14 },
  cardTitle: { color: theme.text, fontSize: 15, fontWeight: "700" },
  cardHint: { color: theme.textDim, fontSize: 12, marginTop: 8, lineHeight: 17 },
  row: { color: theme.text, fontSize: 13, marginTop: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  chip: { borderWidth: 1, borderColor: theme.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  chipOn: { borderColor: theme.primary, backgroundColor: theme.primary + "22" },
  chipTxt: { color: theme.textDim, fontSize: 13, fontWeight: "600" },
  chipTxtOn: { color: theme.text },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 14 },
  switchLabel: { color: theme.text, fontSize: 14, fontWeight: "600" },
  switchHint: { color: theme.textFaint, fontSize: 11, marginTop: 2, lineHeight: 15 },
  input: { backgroundColor: theme.surfaceAlt, borderWidth: 1, borderColor: theme.border, borderRadius: 12, color: theme.text, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, marginTop: 10 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: theme.primary, borderRadius: 14, paddingVertical: 14, marginTop: 14 },
  btnTxt: { color: "#fff", fontSize: 15, fontWeight: "700" },
  btnGhost: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.border, borderRadius: 14, paddingVertical: 13, marginTop: 12 },
  btnGhostTxt: { color: theme.text, fontSize: 14, fontWeight: "600" },
  step: { color: theme.textDim, fontSize: 12, textAlign: "center", marginTop: 10 },
  warn: { color: "#FFC777", fontSize: 11, lineHeight: 16, marginTop: 10 },
  note: { color: theme.textFaint, fontSize: 11, lineHeight: 17, marginTop: 10 },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: theme.border },
  fileTxt: { flex: 1, color: theme.text, fontSize: 13 },
});

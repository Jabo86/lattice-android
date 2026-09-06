import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator,
  ScrollView, Switch, Alert, KeyboardAvoidingView, Platform, Image, Share,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { pickAvatarDataUrl } from "../lib/avatar";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../lib/i18n";
import * as api from "../lib/api";
import { keygen, signMessage, deriveKemKeypair, deriveDhKeypair, bytesToHex } from "../lib/crypto";
import { saveAppLock } from "../lib/store";
import { isDeviceSecure } from "../lib/biometrics";
import { theme } from "../theme";

const DOMAIN = "lattice.lns";
const normUser = (v) => (v || "").toLowerCase().replace(/[^a-z0-9._-]/g, "");

export default function SignupScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const { lang } = useI18n();
  const it = lang !== "en";
  const [username, setUsername] = useState("");
  const [display, setDisplay] = useState("");
  const [bio, setBio] = useState("");
  const [avatar, setAvatar] = useState("");
  const [invite, setInvite] = useState("");
  const [discoverable, setDiscoverable] = useState(true);
  const [useLock, setUseLock] = useState(false);
  const [secure, setSecure] = useState(false);
  const [avail, setAvail] = useState(null); // null | true | false
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [created, setCreated] = useState(null); // { keyfile, lns_name }
  const [saved, setSaved] = useState(false);
  const tRef = useRef(null);

  useEffect(() => { isDeviceSecure().then(setSecure).catch(() => {}); }, []);

  useEffect(() => {
    const u = normUser(username);
    setAvail(null);
    if (u.length < 3) return;
    if (tRef.current) clearTimeout(tRef.current);
    tRef.current = setTimeout(async () => {
      setChecking(true);
      try { const r = await api.personalCheck(u); setAvail(!!r?.available); }
      catch { setAvail(null); }
      finally { setChecking(false); }
    }, 450);
    return () => tRef.current && clearTimeout(tRef.current);
  }, [username]);

  const doSignup = async () => {
    const u = normUser(username);
    if (u.length < 3 || busy) return;
    setBusy(true); setErr("");
    try {
      // 1) chiavi generate SUL DISPOSITIVO: la privata non viene mai inviata al server
      const kp = keygen();
      const lns = `${u}@${DOMAIN}`;
      const signature_hex = signMessage(`lattice-personal-signup-v1:${lns}`, kp.secretKeyHex);
      const kem = deriveKemKeypair(kp.secretKeyHex);
      const dh = deriveDhKeypair(kp.secretKeyHex);
      const r = await api.personalSignup({
        username: u,
        display_name: display.trim(),
        public_key_hex: kp.publicKeyHex,
        signature_hex,
        kem_pk_hex: bytesToHex(kem.publicKey),
        dh_pk_hex: bytesToHex(dh.publicKey),
        discoverable,
        ref: invite.trim() ? (invite.trim().includes("@") ? invite.trim().toLowerCase() : `${normUser(invite)}@${DOMAIN}`) : "",
      });
      const keyfile = {
        version: 1, algorithm: "ML-DSA-65", lns_name: r.lns_name, tenant_id: r.tenant_id,
        did: r.did, public_key_hex: kp.publicKeyHex, secret_key_hex: kp.secretKeyHex,
        server_url: api.getServerUrl(), created_at: r.created_at,
      };
      setCreated({ keyfile, lns_name: r.lns_name });
    } catch (e) {
      setErr(api.apiErr(e));
    } finally { setBusy(false); }
  };

  const shareKeyfile = async () => {
    if (!created) return;
    try {
      const fn = `lattice-key-${created.lns_name.replace(/[^\w.\-]/g, "_")}.json`;
      const uri = FileSystem.cacheDirectory + fn;
      await FileSystem.writeAsStringAsync(uri, JSON.stringify(created.keyfile, null, 2), { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/json", dialogTitle: it ? "Salva il tuo file chiave" : "Save your keyfile" });
      else Alert.alert(it ? "File salvato" : "File saved", uri);
      setSaved(true);
    } catch (e) { Alert.alert("Keyfile", String((e && e.message) || e)); }
  };

  const pickPhoto = async () => {
    try {
      const { dataUrl } = await pickAvatarDataUrl();
      if (dataUrl) setAvatar(dataUrl);
    } catch { /* opzionale */ }
  };

  const enter = async () => {
    if (!created || busy) return;
    setBusy(true); setErr("");
    try {
      if (useLock && secure) await saveAppLock(true);
      await signIn(created.keyfile, { persist: true });
      if (avatar || bio.trim()) {
        try { await api.saveProfile({ headline: "", bio: bio.trim(), avatar, is_public: true }); } catch { /* si può completare dal Profilo */ }
      }
    } catch (e) { setErr(api.apiErr(e)); }
    finally { setBusy(false); }
  };

  if (created) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24 }]}>
        <View style={styles.okBadge}><Ionicons name="shield-checkmark-outline" size={30} color={theme.accent} /></View>
        <Text style={styles.title} testID="signup-done-title">{it ? "Account creato" : "Account created"}</Text>
        <Text style={styles.lnsBig} testID="signup-done-lns">{created.lns_name}</Text>
        <View style={styles.warnBox}>
          <Text style={styles.warnTxt}>
            {it
              ? "La tua chiave privata esiste SOLO su questo telefono: il server non la ha e non può recuperarla. Salvane una copia adesso: senza il file chiave perdi l'accesso all'account."
              : "Your private key exists ONLY on this phone: the server does not have it and cannot recover it. Save a copy now: without the keyfile you lose access."}
          </Text>
        </View>
        <TouchableOpacity style={styles.primaryBtn} onPress={shareKeyfile} testID="signup-save-keyfile">
          <Text style={styles.primaryBtnTxt}>{it ? "Salva il file chiave" : "Save the keyfile"}</Text>
        </TouchableOpacity>
        {/* AZIENDE: la regola detta dove si legge, non sepolta in un documento. Un
            account privato sta sulla rete pubblica; un'organizzazione no. */}
        <View style={styles.noteBox} testID="signup-company-note">
          <Text style={styles.noteTitle}>{it ? "Registri un'azienda?" : "Registering a company?"}</Text>
          <Text style={styles.noteTxt}>
            {it
              ? "Un'organizzazione non si appoggia al nostro server: apre il PROPRIO nodo sui propri server, e da lì crea le identità dei colleghi. Il nodo si installa con un comando (lattice-network.it/install) e database, chiavi e messaggi restano sul vostro hardware. Dati aziendali su un'infrastruttura che l'azienda non controlla non sono sovranità."
              : "An organisation does not rely on our server: it opens its OWN node on its own servers, and creates colleagues' identities from there. The node installs with one command (lattice-network.it/install) and database, keys and messages stay on your hardware. Company data on infrastructure the company does not control is not sovereignty."}
          </Text>
          <Text style={styles.noteTxt}>
            {it
              ? "Esiste anche un client web con le stesse funzioni di questa app, e la stessa crittografia. Non ha però lo stesso modello di fiducia: il programma arriva dal server a ogni caricamento e non esiste un chip di sicurezza in cui tenere la chiave. Per situazioni a rischio elevato, usa questa app."
              : "There is also a web client with the same features as this app, and the same cryptography. It does not have the same trust model: the program arrives from the server on every load and there is no secure element to hold the key. For high-risk situations, use this app."}
          </Text>
        </View>
        {secure && (
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.switchLabel}>{it ? "Blocco app (PIN / impronta)" : "App lock (PIN / biometrics)"}</Text>
              <Text style={styles.hint}>{it ? "Chiede il PIN o l'impronta del telefono ad ogni apertura." : "Asks for your phone PIN or fingerprint at every launch."}</Text>
            </View>
            <Switch value={useLock} onValueChange={setUseLock} testID="signup-applock-switch"
              trackColor={{ true: theme.primary, false: theme.border }} thumbColor="#fff" />
          </View>
        )}
        {!!err && <Text style={styles.err} testID="signup-error">{err}</Text>}
        <TouchableOpacity style={[styles.primaryBtn, !saved && styles.btnDim]} onPress={enter} disabled={!saved || busy} testID="signup-enter">
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnTxt}>{it ? "Entra in Lattice" : "Enter Lattice"}</Text>}
        </TouchableOpacity>
        {!saved && <Text style={styles.hintCenter}>{it ? "Salva prima il file chiave per continuare." : "Save the keyfile first to continue."}</Text>}

        <View style={styles.inviteRow}>
          <Text style={styles.inviteTxt} numberOfLines={2}>
            {(it ? "Il tuo link invito: " : "Your invite link: ") + `${api.getServerUrl()}/signup.html?ref=${encodeURIComponent(created.lns_name)}`}
          </Text>
          <TouchableOpacity onPress={() => Share.share({ message: (it ? "Ti invito su Lattice, la messaggistica sovrana cifrata: " : "Join me on Lattice, sovereign encrypted messaging: ") + `${api.getServerUrl()}/signup.html?ref=${encodeURIComponent(created.lns_name)}` })} testID="signup-invite-share">
            <Ionicons name="share-social-outline" size={20} color={theme.primary} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16 }]} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back} testID="signup-back">
          <Ionicons name="chevron-back-outline" size={22} color={theme.textDim} />
          <Text style={styles.backTxt}>{it ? "Indietro" : "Back"}</Text>
        </TouchableOpacity>

        <Text style={styles.title}>{it ? "Crea il tuo account personale" : "Create your personal account"}</Text>
        <Text style={styles.sub}>
          {it ? "Scegli un nome utente: sarà il tuo indirizzo Lattice. Le chiavi vengono generate su questo dispositivo."
              : "Pick a username: it becomes your Lattice address. Keys are generated on this device."}
        </Text>

        <Text style={styles.label}>{it ? "Nome utente" : "Username"}</Text>
        <View style={styles.lnsRow}>
          <TextInput
            style={styles.input} value={username} onChangeText={(v) => setUsername(normUser(v))}
            placeholder="mario.rossi" placeholderTextColor={theme.textFaint}
            autoCapitalize="none" autoCorrect={false} testID="signup-username"
          />
          <Text style={styles.domain}>@{DOMAIN}</Text>
        </View>
        <View style={styles.availRow}>
          {checking ? <ActivityIndicator size="small" color={theme.textDim} />
            : avail === true ? <Text style={styles.availOk} testID="signup-avail-ok">{it ? "✓ disponibile" : "✓ available"}</Text>
            : avail === false ? <Text style={styles.availNo} testID="signup-avail-no">{it ? "✗ già in uso" : "✗ already taken"}</Text>
            : <Text style={styles.hint}>{it ? "Minimo 3 caratteri: a-z, 0-9, . _ -" : "At least 3 chars: a-z, 0-9, . _ -"}</Text>}
        </View>

        <Text style={styles.label}>{it ? "Nome visualizzato (opzionale)" : "Display name (optional)"}</Text>
        <TextInput style={styles.input} value={display} onChangeText={setDisplay}
          placeholder={it ? "Mario Rossi" : "John Doe"} placeholderTextColor={theme.textFaint} testID="signup-display" />

        <Text style={styles.label}>{it ? "Foto e bio (opzionali)" : "Photo and bio (optional)"}</Text>
        <View style={styles.photoRow}>
          <TouchableOpacity style={styles.avatarBtn} onPress={pickPhoto} testID="signup-photo">
            {avatar ? <Image source={{ uri: avatar }} style={styles.avatarImg} />
              : <Ionicons name="camera-outline" size={24} color={theme.primary} />}
          </TouchableOpacity>
          <TextInput style={[styles.input, { flex: 1 }]} value={bio} onChangeText={setBio} maxLength={160}
            placeholder={it ? "Due parole su di te" : "A couple of words about you"} placeholderTextColor={theme.textFaint} testID="signup-bio" />
        </View>

        <Text style={styles.label}>{it ? "Codice invito (opzionale)" : "Invite code (optional)"}</Text>
        <TextInput style={styles.input} value={invite} onChangeText={setInvite} autoCapitalize="none" autoCorrect={false}
          placeholder={it ? "chi ti ha invitato, es. mario.rossi" : "who invited you, e.g. john.doe"} placeholderTextColor={theme.textFaint} testID="signup-invite" />

        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchLabel}>{it ? "Compari nella directory pubblica" : "Appear in the public directory"}</Text>
            <Text style={styles.hint}>{it ? "Altri utenti possono trovarti cercando il tuo nome utente." : "Other users can find you by searching your username."}</Text>
          </View>
          <Switch value={discoverable} onValueChange={setDiscoverable} testID="signup-discoverable"
            trackColor={{ true: theme.primary, false: theme.border }} thumbColor="#fff" />
        </View>

        <View style={styles.infoBox}>
          <Text style={styles.infoTxt}>
            {it ? "🔒 Il server riceve solo la tua chiave pubblica. I gruppi aziendali restano privati e su invito."
                : "🔒 The server only receives your public key. Company groups stay private and invite-only."}
          </Text>
        </View>

        {!!err && <Text style={styles.err} testID="signup-error">{err}</Text>}

        <TouchableOpacity style={[styles.primaryBtn, (avail !== true || busy) && styles.btnDim]}
          onPress={doSignup} disabled={avail !== true || busy} testID="signup-submit">
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnTxt}>{it ? "Crea account" : "Create account"}</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  scroll: { padding: 24, paddingBottom: 60 },
  back: { flexDirection: "row", alignItems: "center", marginBottom: 18 },
  backTxt: { color: theme.textDim, fontSize: 14, fontWeight: "600" },
  title: { color: theme.text, fontSize: 26, fontWeight: "900", marginBottom: 8 },
  sub: { color: theme.textDim, fontSize: 14, lineHeight: 21, marginBottom: 24 },
  label: { color: theme.textDim, fontSize: 12, fontWeight: "800", letterSpacing: 1, marginBottom: 8, marginTop: 8 },
  lnsRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 12, color: theme.text, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15 },
  domain: { color: theme.primary, fontSize: 14, fontWeight: "800" },
  availRow: { minHeight: 22, justifyContent: "center", marginTop: 8 },
  availOk: { color: theme.accent, fontSize: 13, fontWeight: "700" },
  availNo: { color: theme.danger, fontSize: 13, fontWeight: "700" },
  hint: { color: theme.textFaint, fontSize: 12, lineHeight: 17 },
  hintCenter: { color: theme.textFaint, fontSize: 12, textAlign: "center", marginTop: 10 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 22, backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 12, padding: 14 },
  switchLabel: { color: theme.text, fontSize: 14, fontWeight: "700", marginBottom: 4 },
  infoBox: { marginTop: 22, borderRadius: 12, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surfaceAlt, padding: 14 },
  infoTxt: { color: theme.textDim, fontSize: 13, lineHeight: 19 },
  warnBox: { marginTop: 18, borderRadius: 12, borderWidth: 1, borderColor: "#50C87866", backgroundColor: "#2A2210", padding: 14 },
  warnTxt: { color: "#F7DFA0", fontSize: 13, lineHeight: 19 },
  noteBox: { borderWidth: 1, borderColor: "#25342B", borderRadius: 12, padding: 14, marginTop: 16, gap: 8, width: "100%" },
  noteTitle: { color: "#50C878", fontSize: 12, fontWeight: "800", letterSpacing: 0.4 },
  noteTxt: { color: "#8A9C91", fontSize: 12, lineHeight: 18 },
  err: { color: "#FFB3BD", fontSize: 13, marginTop: 16 },
  primaryBtn: { backgroundColor: theme.primary, borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 24 },
  primaryBtnTxt: { color: "#fff", fontSize: 16, fontWeight: "800" },
  btnDim: { opacity: 0.45 },
  okBadge: { alignSelf: "center", width: 62, height: 62, borderRadius: 31, alignItems: "center", justifyContent: "center", backgroundColor: theme.surface, borderColor: theme.accent, borderWidth: 1, marginBottom: 18 },
  lnsBig: { color: theme.primary, fontSize: 18, fontWeight: "800", marginBottom: 4 },
  photoRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatarBtn: { width: 58, height: 58, borderRadius: 29, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1 },
  avatarImg: { width: "100%", height: "100%" },
  inviteRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16, backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 12, padding: 12 },
  inviteTxt: { flex: 1, color: theme.textDim, fontSize: 12 },
});

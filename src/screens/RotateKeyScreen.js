import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { theme } from "../theme";
import { useAuth } from "../context/AuthContext";
import * as api from "../lib/api";

export default function RotateKeyScreen() {
  const { rotateKey, finishRotation, signOut } = useAuth();
  const [phase, setPhase] = useState("intro"); // intro | done
  const [busy, setBusy] = useState(false);
  const [newKf, setNewKf] = useState(null);
  const [fname, setFname] = useState("lattice-key.json");

  const saveKeyFile = async (kf, filename) => {
    try {
      const path = FileSystem.cacheDirectory + (filename || "lattice-key.json").replace(/[^\w.\-]/g, "_");
      await FileSystem.writeAsStringAsync(path, JSON.stringify(kf, null, 2), { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path, { mimeType: "application/json", dialogTitle: "Salva la tua nuova chiave" });
      return true;
    } catch (e) {
      Alert.alert("Attenzione", "Non è stato possibile aprire il salvataggio. Riprova con 'Salva di nuovo la chiave'.");
      return false;
    }
  };

  const onGenerate = async () => {
    setBusy(true);
    try {
      const r = await rotateKey();
      setNewKf(r.keyfile);
      setFname(r.keyfile_filename || "lattice-key.json");
      setPhase("done");
      await saveKeyFile(r.keyfile, r.keyfile_filename);
    } catch (e) {
      Alert.alert("Errore", api.apiErr(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.wrap}>
        <View style={styles.iconWrap}>
          <Ionicons name={phase === "done" ? "shield-checkmark" : "key"} size={44} color={theme.primary} />
        </View>

        {phase === "intro" ? (
          <>
            <Text style={styles.title}>Crea la tua chiave definitiva</Text>
            <Text style={styles.body}>
              Questo è il tuo primo accesso. La chiave con cui sei entrato è temporanea: per motivi di sicurezza devi generarne una nuova, personale, che solo tu conoscerai.
            </Text>
            <View style={styles.note}>
              <Ionicons name="alert-circle-outline" size={16} color="#50C878" />
              <Text style={styles.noteTxt}>Al termine ti verrà chiesto di SALVARE il nuovo file chiave. Conservalo bene: ti servirà per accedere e non è recuperabile.</Text>
            </View>
            <TouchableOpacity style={[styles.primaryBtn, busy && { opacity: 0.6 }]} onPress={onGenerate} disabled={busy} testID="rotate-generate">
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryTxt}>Genera nuova chiave</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.linkBtn} onPress={signOut} disabled={busy} testID="rotate-signout">
              <Text style={styles.linkTxt}>Esci</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.title}>Chiave creata ✅</Text>
            <Text style={styles.body}>
              La tua nuova chiave è attiva. Assicurati di aver salvato il file <Text style={{ fontWeight: "800", color: theme.accent }}>{fname}</Text> in un posto sicuro (Drive, Note, gestore password).
            </Text>
            <View style={styles.note}>
              <Ionicons name="warning-outline" size={16} color="#ff9a9a" />
              <Text style={styles.noteTxt}>Senza questo file NON potrai più accedere. Salvalo ora se non l'hai già fatto.</Text>
            </View>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => saveKeyFile(newKf, fname)} testID="rotate-save-again">
              <Ionicons name="download-outline" size={18} color={theme.primary} />
              <Text style={styles.secondaryTxt}>Salva di nuovo la chiave</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtn} onPress={finishRotation} testID="rotate-continue">
              <Text style={styles.primaryTxt}>Ho salvato la chiave — Continua</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  wrap: { flexGrow: 1, justifyContent: "center", padding: 24 },
  iconWrap: { alignSelf: "center", width: 84, height: 84, borderRadius: 42, backgroundColor: "rgba(80,200,120,0.14)", alignItems: "center", justifyContent: "center", marginBottom: 20 },
  title: { color: theme.text, fontSize: 24, fontWeight: "800", textAlign: "center", marginBottom: 12 },
  body: { color: theme.textDim, fontSize: 15, lineHeight: 22, textAlign: "center", marginBottom: 18 },
  note: { flexDirection: "row", gap: 10, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 14, marginBottom: 24 },
  noteTxt: { flex: 1, color: theme.textDim, fontSize: 13, lineHeight: 19 },
  primaryBtn: { backgroundColor: theme.primary, borderRadius: 14, paddingVertical: 15, alignItems: "center", marginBottom: 12 },
  primaryTxt: { color: "#fff", fontSize: 16, fontWeight: "800" },
  secondaryBtn: { flexDirection: "row", gap: 8, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: theme.primary, borderRadius: 14, paddingVertical: 13, marginBottom: 12 },
  secondaryTxt: { color: theme.primary, fontSize: 15, fontWeight: "700" },
  linkBtn: { alignItems: "center", paddingVertical: 10 },
  linkTxt: { color: theme.textFaint, fontSize: 14, fontWeight: "600" },
});

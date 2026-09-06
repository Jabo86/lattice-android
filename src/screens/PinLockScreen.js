import React, { useState, useCallback, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Image, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { theme } from "../theme";
import * as lock from "../lib/lock";

const KEYS = [["1", ""], ["2", "ABC"], ["3", "DEF"], ["4", "GHI"], ["5", "JKL"], ["6", "MNO"], ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"], ["", ""], ["0", ""], ["del", ""]];

export default function PinLockScreen() {
  const { unlockWithPin, wipeNow } = useAuth();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [left, setLeft] = useState(lock.MAX_TRIES);
  const [warn, setWarn] = useState(false);

  useEffect(() => { lock.triesLeft().then(setLeft).catch(() => {}); }, []);

  const submit = useCallback(async (value) => {
    setBusy(true); setErr("");
    try {
      const r = await unlockWithPin(value);
      if (r.status === "wrong") {
        setPin("");
        setLeft(r.left);
        if (r.left === 1) setWarn(true);
        else if (r.left <= 0) return; // autodistruzione già in corso
        else setErr("PIN errato.");
      }
    } catch (e) {
      setPin("");
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }, [unlockWithPin]);

  const press = (k) => {
    if (busy) return;
    if (k === "del") { setPin((p) => p.slice(0, -1)); return; }
    if (!k) return;
    const next = (pin + k).slice(0, 10);
    setPin(next);
    if (next.length >= 4) setErr("");
  };

  return (
    <View style={styles.root} testID="pin-lock-screen">
      <Image source={require("../../assets/lattice-logo.png")} style={styles.logo} resizeMode="contain" />
      <Text style={styles.title}>Inserisci il PIN</Text>
      <Text style={styles.sub}>I tuoi messaggi e le tue chiavi sono cifrati su questo telefono: senza PIN non sono leggibili.</Text>

      <View style={styles.dots}>
        {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
          <View key={i} style={[styles.dot, i < pin.length && styles.dotOn]} />
        ))}
      </View>

      {!!err && <Text style={styles.err} testID="pin-error">{err}</Text>}
      {left < lock.MAX_TRIES && left > 0 && (
        <Text style={styles.left} testID="pin-tries-left">Tentativi rimasti: {left}</Text>
      )}

      <View style={styles.pad}>
        {KEYS.map(([k, sub], i) => (
          <TouchableOpacity key={i} style={[styles.key, !k && styles.keyGhost]} onPress={() => press(k)} disabled={!k || busy} testID={`pin-key-${k || "empty"}`}>
            {k === "del" ? <Ionicons name="backspace-outline" size={24} color={theme.text} /> : <Text style={styles.keyTxt}>{k}</Text>}
            {!!sub && <Text style={styles.keySub}>{sub}</Text>}
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={[styles.btn, (busy || pin.length < 4) && { opacity: 0.5 }]} disabled={busy || pin.length < 4} onPress={() => submit(pin)} testID="pin-submit-btn">
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnTxt}>Sblocca</Text>}
      </TouchableOpacity>

      <Text style={styles.note} testID="pin-forgot-note">
        PIN dimenticato? Non esiste un modo per aggirarlo: disinstalla e reinstalla l'app,
        poi rientra con il tuo file chiave.
      </Text>

      {/* Avviso a schermo pieno: ancora un errore e si cancella tutto */}
      <Modal visible={warn} transparent animationType="fade">
        <View style={styles.warnRoot} testID="pin-final-warning">
          <Ionicons name="warning-outline" size={64} color="#fff" />
          <Text style={styles.warnTitle}>Ultimo tentativo</Text>
          <Text style={styles.warnTxt}>
            Al prossimo PIN errato l'app cancellerà definitivamente tutto: chiavi, messaggi, chiamate e
            metadati, sia su questo telefono sia sul server. L'operazione è irreversibile.
          </Text>
          <TouchableOpacity style={styles.warnBtn} onPress={() => setWarn(false)} testID="pin-warning-ok">
            <Text style={styles.warnBtnTxt}>Ho capito</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setWarn(false); wipeNow(); }} style={{ marginTop: 14 }} testID="pin-warning-wipe">
            <Text style={styles.warnLink}>Cancella subito tutto</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent", alignItems: "center", justifyContent: "center", padding: 26 },
  logo: { width: 64, height: 64, marginBottom: 14 },
  title: { color: theme.text, fontSize: 22, fontWeight: "900", marginBottom: 6 },
  sub: { color: theme.textDim, fontSize: 13, lineHeight: 19, textAlign: "center", maxWidth: 320 },
  dots: { flexDirection: "row", gap: 12, marginTop: 22, marginBottom: 8, minHeight: 16 },
  dot: { width: 13, height: 13, borderRadius: 7, borderWidth: 1.5, borderColor: theme.textFaint },
  dotOn: { backgroundColor: theme.primary, borderColor: theme.primary },
  err: { color: "#ef4444", fontSize: 13, fontWeight: "700", marginTop: 6 },
  left: { color: "#f59e0b", fontSize: 12, fontWeight: "700", marginTop: 4 },
  pad: { flexDirection: "row", flexWrap: "wrap", width: 264, justifyContent: "center", marginTop: 14 },
  key: { width: 78, height: 62, alignItems: "center", justifyContent: "center", margin: 3, borderRadius: 14, backgroundColor: theme.surface },
  keyGhost: { backgroundColor: "transparent" },
  keyTxt: { color: theme.text, fontSize: 24, fontWeight: "700" },
  keySub: { color: theme.textFaint, fontSize: 9, letterSpacing: 1 },
  btn: { backgroundColor: theme.primary, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 46, marginTop: 18, minWidth: 180, alignItems: "center" },
  btnTxt: { color: "#fff", fontSize: 16, fontWeight: "800" },
  note: { color: theme.textFaint, fontSize: 11.5, lineHeight: 17, textAlign: "center", marginTop: 18, maxWidth: 300 },
  warnRoot: { flex: 1, backgroundColor: "#b91c1c", alignItems: "center", justifyContent: "center", padding: 32 },
  warnTitle: { color: "#fff", fontSize: 26, fontWeight: "900", marginTop: 16, marginBottom: 10 },
  warnTxt: { color: "#ffe4e6", fontSize: 14.5, lineHeight: 21, textAlign: "center" },
  warnBtn: { backgroundColor: "#fff", borderRadius: 14, paddingVertical: 13, paddingHorizontal: 40, marginTop: 26 },
  warnBtnTxt: { color: "#b91c1c", fontSize: 16, fontWeight: "800" },
  warnLink: { color: "#ffe4e6", fontSize: 12.5, fontWeight: "700", textDecorationLine: "underline" },
});

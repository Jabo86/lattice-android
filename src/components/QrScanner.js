// LETTORE QR — senza fotocamera dentro l'app.
// Il modulo nativo della fotocamera (expo-camera) porta con sé MLKit, che si inizializza
// all'avvio del processo Android: era esattamente ciò che faceva morire l'app, e per
// questo lo scanner era stato tolto. Qui la foto la scatta la fotocamera DI SISTEMA
// (expo-image-picker, già in uso per gli allegati) e il codice viene decodificato QUI, in
// JavaScript puro (jsQR): nessun modulo nativo nuovo, nessun rischio all'avvio, e
// l'immagine non lascia il telefono — viene letta e buttata.
import React, { useState } from "react";
import { TouchableOpacity, Text, View, ActivityIndicator, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { pngToRgba } from "../lib/thumb";
import { base64ToBytes } from "../lib/crypto";
import { suppressLock } from "../lib/lockGuard";
import { theme } from "../theme";

async function pngAt(uri, width) {
  try {
    const img = await ImageManipulator.manipulate(uri).resize({ width }).renderAsync();
    const out = await img.saveAsync({ format: SaveFormat.PNG, base64: true });
    try { img.release && img.release(); } catch { /* niente */ }
    if (out && out.base64) return out.base64;
  } catch { /* si prova la via vecchia */ }
  try {
    const out = await manipulateAsync(uri, [{ resize: { width } }], { format: SaveFormat.PNG, base64: true });
    if (out && out.base64) return out.base64;
  } catch { /* niente da fare */ }
  return null;
}

function decode(rgba, w, h) {
  const mod = require("jsqr");
  const jsQR = mod && (mod.default || mod);
  const r = jsQR(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), w, h, { inversionAttempts: "attemptBoth" });
  return r && r.data ? String(r.data) : "";
}

/// Pulsante "inquadra il codice": scatta, decodifica, restituisce il testo trovato.
export default function QrScanner({ label, hint, tint, onCode, onFail, testID = "qr-scan" }) {
  const [busy, setBusy] = useState(false);
  const color = tint || theme.primary;

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      suppressLock();
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { onFail && onFail("perm"); return; }
      const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 });
      if (shot.canceled || !shot.assets || !shot.assets[0]) return;
      const uri = shot.assets[0].uri;
      let found = "";
      for (const w of [560, 800, 400]) {
        const b64 = await pngAt(uri, w);
        if (!b64) continue;
        const img = pngToRgba(base64ToBytes(b64));
        if (!img) continue;
        try { found = decode(img.rgba, img.w, img.h); } catch { found = ""; }
        if (found) break;
        await new Promise((r) => setTimeout(r, 0)); // si lascia respirare l'interfaccia
      }
      if (found) onCode && onCode(found);
      else onFail && onFail("noqr");
    } catch (e) {
      onFail && onFail(String((e && e.message) || e));
    } finally { setBusy(false); }
  };

  return (
    <TouchableOpacity
      style={[st.btn, { borderColor: color + "88", backgroundColor: color + "14" }]}
      onPress={run}
      disabled={busy}
      testID={testID}
    >
      {busy ? <ActivityIndicator color={color} /> : <Ionicons name="qr-code-outline" size={19} color={color} />}
      <View style={{ flex: 1 }}>
        <Text style={[st.txt, { color }]}>{label}</Text>
        {!!hint && <Text style={st.hint}>{busy ? "…" : hint}</Text>}
      </View>
      <Ionicons name="camera-outline" size={18} color={color} />
    </TouchableOpacity>
  );
}

const st = StyleSheet.create({
  btn: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 12,
  },
  txt: { fontSize: 14, fontWeight: "700" },
  hint: { color: theme.textDim, fontSize: 11, marginTop: 2, lineHeight: 15 },
});

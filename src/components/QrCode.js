// Codice QR disegnato come UNA immagine PNG costruita in JavaScript.
// Prima era un mosaico di View (una per ogni tratto di ogni riga): 40 righe per centinaia di
// viste native, ed era il motivo principale per cui la schermata "Verifica contatto"
// arrivava dopo secondi. Ora il PNG si genera fuori dal percorso di apertura
// (InteractionManager) e a schermo finisce un solo <Image>: la schermata compare subito e il
// QR appare un istante dopo. Nessuna dipendenza nativa, nessun canvas.
import React, { useEffect, useState } from "react";
import { View, Image, InteractionManager } from "react-native";
import { qrPngBase64 } from "../lib/qrpng";

export default function QrCode({ value, size = 240, testID = "qr-code" }) {
  const [uri, setUri] = useState("");

  useEffect(() => {
    let alive = true;
    setUri("");
    if (!value) return undefined;
    const task = InteractionManager.runAfterInteractions(() => {
      const b64 = qrPngBase64(value);
      if (alive) setUri(b64 ? "data:image/png;base64," + b64 : "");
    });
    return () => { alive = false; try { task && task.cancel && task.cancel(); } catch { /* niente */ } };
  }, [value]);

  if (!uri) {
    return (
      <View
        testID={testID + "-placeholder"}
        style={{ width: size, height: size, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.06)" }}
      />
    );
  }
  return (
    <Image
      testID={testID}
      source={{ uri }}
      style={{ width: size, height: size, borderRadius: 12, backgroundColor: "#FFFFFF" }}
      resizeMode="contain"
    />
  );
}

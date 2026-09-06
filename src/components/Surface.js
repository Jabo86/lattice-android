import React from "react";
import { View, StyleSheet } from "react-native";

// Gradienti e vetro senza aggiungere un modulo nativo alla vigilia di una build.
//
// `expo-linear-gradient` e `expo-blur` sono moduli nativi: infilarli adesso vorrebbe dire
// rifare l'autolinking e rimettere in dubbio la build riproducibile appena verificata.
// Qui il gradiente è una pila di strisce a opacità decrescente — a schermo è una sfumatura,
// e costa zero dipendenze. Il vetro è una superficie traslucida con un filo di luce in
// cima: non è una sfocatura vera, e non lo chiamiamo sfocatura.
const ottetti = (hex) => {
  const h = (hex || "#000000").replace("#", "");
  const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
};
export const alpha = (hex, a) => {
  const [r, g, b] = ottetti(hex);
  return `rgba(${r},${g},${b},${a})`;
};

/// Sfumatura verticale (o orizzontale) fra due colori, in `steps` strisce.
export function Gradient({ from, to, steps = 12, horizontal = false, style, children, radius = 0 }) {
  const bande = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    bande.push(
      <View
        key={i}
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          horizontal
            ? { left: `${(i * 100) / steps}%`, width: `${100 / steps + 0.6}%` }
            : { top: `${(i * 100) / steps}%`, height: `${100 / steps + 0.6}%` },
          { backgroundColor: i === 0 ? from : to, opacity: i === 0 ? 1 : t },
        ]}
      />
    );
  }
  return (
    <View style={[{ overflow: "hidden", borderRadius: radius }, style]}>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: from }]} />
      {bande}
      {children}
    </View>
  );
}

/// Superficie «vetro»: traslucida, con un filo di luce sul bordo alto.
export function Glass({ tint, base = "#000000", intensity = 0.72, style, children, radius = 0, edge = true }) {
  return (
    <View style={[{ borderRadius: radius, overflow: "hidden", backgroundColor: alpha(base, intensity) }, style]}>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: alpha(tint, 0.05) }]} />
      {edge && (
        <View
          pointerEvents="none"
          style={{ position: "absolute", top: 0, left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: alpha(tint, 0.35) }}
        />
      )}
      {children}
    </View>
  );
}

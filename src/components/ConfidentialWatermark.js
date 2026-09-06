import React from "react";
import { View, Text, StyleSheet } from "react-native";

// Filigrana di riservatezza: sovrappone in modo tenue l'identità di chi guarda
// (deterrente contro foto dello schermo con un altro dispositivo). Non intercetta i tocchi.
export default function ConfidentialWatermark({ label }) {
  if (!label) return null;
  return (
    <View pointerEvents="none" style={styles.wrap} testID="confidential-watermark">
      {Array.from({ length: 16 }).map((_, r) => (
        <View key={r} style={styles.row}>
          {Array.from({ length: 3 }).map((__, c) => (
            <Text key={c} style={styles.mark} numberOfLines={1}>{label}</Text>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, justifyContent: "space-around", zIndex: 4 },
  row: { flexDirection: "row", justifyContent: "space-around", transform: [{ rotate: "-24deg" }] },
  mark: { color: "rgba(255,255,255,0.045)", fontSize: 13, fontWeight: "800", letterSpacing: 1 },
});

import React from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { avatarColor } from "../theme";

export default function Avatar({ seed, label, size = 44, online, uri }) {
  const color = avatarColor(seed || label);
  const letter = (label || "?").trim().charAt(0).toUpperCase();
  return (
    <View style={{ width: size, height: size }}>
      <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: color + "26", borderColor: color + "66", overflow: "hidden" }]}>
        {uri ? (
          <Image source={{ uri }} style={{ width: size, height: size }} resizeMode="cover" />
        ) : (
          <Text style={{ color, fontSize: size * 0.4, fontWeight: "800" }}>{letter}</Text>
        )}
      </View>
      {online != null && (
        <View style={[styles.dot, { backgroundColor: online ? "#50C878" : "#4A5468" }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: "center", justifyContent: "center", borderWidth: 1 },
  dot: {
    position: "absolute", right: -1, bottom: -1, width: 13, height: 13,
    borderRadius: 7, borderWidth: 2.5, borderColor: "#000000",
  },
});

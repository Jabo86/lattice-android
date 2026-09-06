import React, { useEffect, useRef } from "react";
import { View, Animated, Easing, StyleSheet } from "react-native";
import { theme } from "../theme";

// Caricatori a scheletro: l'attesa smette di essere un buco nero e diventa la forma di
// quello che sta arrivando. Solo opacità e trasformazioni → tutto sul thread nativo.
export function Skeleton({ w = "100%", h = 12, r = 6, style }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 780, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 780, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    ).start();
  }, [v]);
  return (
    <Animated.View
      style={[
        { width: w, height: h, borderRadius: r, backgroundColor: theme.surfaceAlt },
        { opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.85] }) },
        style,
      ]}
    />
  );
}

export function SkeletonRow({ index = 0 }) {
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 380, delay: index * 60, useNativeDriver: true }).start();
  }, [enter, index]);
  return (
    <Animated.View style={[styles.row, { opacity: enter }]}>
      <Skeleton w={46} h={46} r={23} />
      <View style={{ flex: 1, gap: 9 }}>
        <Skeleton w={index % 2 ? "52%" : "68%"} h={13} />
        <Skeleton w={index % 3 ? "84%" : "45%"} h={10} />
      </View>
    </Animated.View>
  );
}

export function SkeletonList({ count = 6, testID }) {
  return (
    <View testID={testID || "skeleton-list"}>
      {Array.from({ length: count }).map((_, i) => <SkeletonRow key={i} index={i} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row", alignItems: "center", gap: 14,
    paddingHorizontal: 16, paddingVertical: 15,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border,
  },
});

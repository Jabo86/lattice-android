import React, { useEffect, useMemo, useRef } from "react";
import { View, Text, Animated, Easing, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";
import { alpha } from "./Surface";

// La Costellazione dentro la chat: non un grafico di rete, il percorso di QUESTO messaggio.
// A sinistra tu, a destra chi legge, in mezzo ciò che sta effettivamente trasportando la
// busta: il server, oppure i telefoni vicini. Il punto che viaggia sulla linea parte da
// capo ogni volta che qualcosa passa davvero — non è un'animazione decorativa.
const H = 132;
const GOLDEN = 2.399963229728653;

function Traveller({ span, delay, tint, run }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    v.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(v, { toValue: 1, duration: 1250, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.delay(650),
        Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [v, delay, run]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute", top: -2.5, left: -3.5, width: 7, height: 7, borderRadius: 4,
        backgroundColor: tint,
        opacity: v.interpolate({ inputRange: [0, 0.1, 0.9, 1], outputRange: [0, 1, 1, 0] }),
        transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, span] }) }],
      }}
    />
  );
}

function Node({ x, y, r, label, icon, tint, filled, delay, dim }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(v, { toValue: 1, delay, friction: 7, tension: 90, useNativeDriver: true }).start();
  }, [v, delay]);
  return (
    <Animated.View
      style={{
        position: "absolute", left: x - r, top: y - r, alignItems: "center",
        opacity: v, transform: [{ scale: v }],
      }}
    >
      <View style={[
        { width: r * 2, height: r * 2, borderRadius: r, alignItems: "center", justifyContent: "center", borderWidth: 1 },
        filled ? { backgroundColor: tint, borderColor: tint } : { borderColor: dim ? theme.border : tint },
      ]}>
        {icon ? <Ionicons name={icon} size={r} color={filled ? "#000" : dim ? theme.textFaint : tint} /> : null}
      </View>
      {!!label && <Text style={styles.nodeTxt} numberOfLines={1}>{label}</Text>}
    </Animated.View>
  );
}

export default function ChatConstellation({ via, hops, neighbours, hybrid, pulses, t, tint = theme.accent, width }) {
  const W = Math.max(240, Math.min(width || 340, 420));
  const meX = 26, youX = W - 26, midY = 44;
  const isMesh = via === "mesh" || via === "ponte" || via === "corriere";
  const relays = isMesh ? Math.max(1, Math.min(neighbours || 1, 5)) : 1;

  const label = via === "mesh" || via === "ponte" ? t("chat.map.mesh")
    : via === "corriere" ? t("chat.map.mesh")
    : via ? t("chat.map.server") : t("chat.map.unknown");

  // I nodi di mezzo: il server è uno, i telefoni si spargono su angoli d'oro così che
  // due vicini non finiscano mai sovrapposti.
  const mids = useMemo(() => {
    const out = [];
    const usable = youX - meX - 80;
    for (let i = 0; i < relays; i++) {
      const f = relays === 1 ? 0.5 : (i + 1) / (relays + 1);
      const jitter = relays === 1 ? 0 : Math.sin(i * GOLDEN) * 26;
      out.push({ x: meX + 40 + usable * f, y: midY + jitter, strong: i < (hybrid || 0) });
    }
    return out;
  }, [relays, hybrid, youX, meX]);

  return (
    <View style={[styles.wrap, { height: H }]} testID="chat-constellation">
      <View style={{ width: W, height: 92, alignSelf: "center" }}>
        {mids.map((m, i) => {
          const segs = [[meX, midY, m.x, m.y], [m.x, m.y, youX, midY]];
          return segs.map(([x1, y1, x2, y2], k) => {
            const dx = x2 - x1, dy = y2 - y1;
            const len = Math.sqrt(dx * dx + dy * dy);
            const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
            return (
              <View
                key={`s${i}-${k}`}
                pointerEvents="none"
                style={{
                  position: "absolute",
                  left: x1 + dx / 2 - len / 2, top: y1 + dy / 2 - 1,
                  width: len, height: 1,
                  backgroundColor: m.strong ? tint : alpha(tint, 0.45),
                  opacity: m.strong ? 0.85 : 0.55,
                  shadowColor: tint, shadowOpacity: 0.9, shadowRadius: 6,
                  shadowOffset: { width: 0, height: 0 }, elevation: 3,
                  transform: [{ rotate: `${ang}deg` }],
                }}
              >
                <Traveller span={len} delay={i * 260 + k * 640} tint={tint} run={(pulses || 0) + "-" + via} />
              </View>
            );
          });
        })}
        <Node x={meX} y={midY} r={15} icon="phone-portrait-outline" tint={tint} filled label={t("mesh.map.you")} delay={0} />
        {mids.map((m, i) => (
          <Node key={`n${i}`} x={m.x} y={m.y} r={11}
                icon={isMesh ? "ellipse-outline" : "server-outline"} tint={tint}
                dim={!m.strong && isMesh} delay={120 + i * 90} />
        ))}
        <Node x={youX} y={midY} r={15} icon="person-outline" tint={tint} delay={200} />
      </View>
      <View style={styles.foot}>
        <Text style={styles.route} testID="chat-map-route">{label}</Text>
        {isMesh && !!relays && (
          <Text style={styles.hops} testID="chat-map-hops">
            {"  ·  " + t("chat.map.hops", { n: relays + 1 })}
          </Text>
        )}
        {!isMesh && !!via && <Text style={styles.hops}>{"  ·  " + t("chat.map.direct")}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: "transparent", borderBottomWidth: 1, borderBottomColor: theme.border, paddingTop: 8 },
  nodeTxt: { color: theme.textFaint, fontSize: 9, fontWeight: "800", letterSpacing: 1, marginTop: 5, textTransform: "uppercase" },
  foot: { flexDirection: "row", justifyContent: "center", alignItems: "center", paddingBottom: 8 },
  route: { color: theme.text, fontSize: 12, fontWeight: "700" },
  hops: { color: theme.textDim, fontSize: 12 },
});

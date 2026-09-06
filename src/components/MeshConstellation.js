import React, { useEffect, useMemo, useRef, useState } from "react";
import { sovereignNodes } from "../lib/api";
import { View, Text, Animated, Easing, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";

// La Costellazione: al posto di un muro di numeri, i telefoni intorno a te disegnati come
// nodi collegati da linee che si accendono quando qualcosa passa. Tutto derivato dai
// contatori anonimi già esposti dal nodo: nessun dato nuovo, nessuna identità.
const BOX = 236;
const GOLDEN = 2.399963229728653;

function Link({ angle, radius, delay, strong, tint, alive }) {
  const flow = useRef(new Animated.Value(0)).current;
  const life = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(life, { toValue: 1, duration: 620, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    if (!alive) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay + 200),
        Animated.timing(flow, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(flow, { toValue: 0, duration: 0, useNativeDriver: true }),
        Animated.delay(900),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [flow, life, delay, alive]);

  const cx = BOX / 2;
  const cy = BOX / 2;
  const midX = cx + Math.cos(angle) * (radius / 2);
  const midY = cy + Math.sin(angle) * (radius / 2);
  const color = strong ? theme.accent : tint;

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: midX - radius / 2,
        top: midY - 1,
        width: radius,
        height: 2,
        backgroundColor: color,
        opacity: life.interpolate({ inputRange: [0, 1], outputRange: [0, strong ? 0.42 : 0.26] }),
        transform: [{ rotate: `${(angle * 180) / Math.PI}deg` }, { scaleX: life }],
      }}
    >
      <Animated.View
        style={{
          position: "absolute",
          top: -2.5,
          left: radius / 2 - 3.5,
          width: 7,
          height: 7,
          borderRadius: 4,
          backgroundColor: color,
          opacity: flow.interpolate({ inputRange: [0, 0.12, 0.88, 1], outputRange: [0, 1, 1, 0] }),
          transform: [{ translateX: flow.interpolate({ inputRange: [0, 1], outputRange: [-radius / 2, radius / 2] }) }],
        }}
      />
    </Animated.View>
  );
}

function Peer({ angle, radius, delay, strong, tint }) {
  const v = useRef(new Animated.Value(0)).current;
  const tw = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(v, { toValue: 1, delay, friction: 6, tension: 90, useNativeDriver: true }).start();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(tw, { toValue: 1, duration: 1700 + (delay % 600), easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(tw, { toValue: 0, duration: 1700 + (delay % 600), easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [v, tw, delay]);
  const x = BOX / 2 + Math.cos(angle) * radius;
  const y = BOX / 2 + Math.sin(angle) * radius;
  const color = strong ? theme.accent : tint;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute", left: x - 13, top: y - 13, width: 26, height: 26,
        alignItems: "center", justifyContent: "center",
        opacity: v, transform: [{ scale: v }],
      }}
    >
      <Animated.View
        style={{
          position: "absolute", width: 26, height: 26, borderRadius: 13, backgroundColor: color,
          opacity: tw.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.3] }),
          transform: [{ scale: tw.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.15] }) }],
        }}
      />
      <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: color }} />
    </Animated.View>
  );
}

function Core({ tint }) {
  const p = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(p, { toValue: 1, duration: 2600, easing: Easing.out(Easing.quad), useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [p]);
  return (
    <View style={{ position: "absolute", left: BOX / 2 - 30, top: BOX / 2 - 30, width: 60, height: 60, alignItems: "center", justifyContent: "center" }} pointerEvents="none">
      {[0, 0.5].map((off) => (
        <Animated.View
          key={off}
          style={{
            position: "absolute", width: 56, height: 56, borderRadius: 28,
            borderWidth: 1.5, borderColor: tint,
            opacity: p.interpolate({ inputRange: [0, 1], outputRange: off ? [0.5, 0] : [0.35, 0] }),
            transform: [{ scale: p.interpolate({ inputRange: [0, 1], outputRange: [0.55 + off * 0.4, 1.9 + off * 0.4] }) }],
          }}
        />
      ))}
      <View style={[styles.core, { backgroundColor: tint, shadowColor: tint }]}>
        <Ionicons name="phone-portrait-outline" size={16} color="#04070D" />
      </View>
    </View>
  );
}

export default function MeshConstellation({ status, t, tint = theme.primary, details }) {
  const [open, setOpen] = useState(false);
  const neighbours = Math.max(0, (status && status.neighbours) || 0);
  const hybrid = Math.max(0, (status && status.hybrid) || 0);
  const mix = Math.max(0, (status && status.mix) || 0);
  const health = (status && status.key) || "isolated";
  const shown = Math.min(neighbours, 9);

  // La mesh intorno a te e i Nodi Sovrani sono due strati diversi della stessa rete:
  // i vicini sono i telefoni a portata, i nodi sono i punti tecnici sempre accesi.
  const [sov, setSov] = useState(null);
  useEffect(() => {
    let on = true;
    const load = () => sovereignNodes()
      .then((d) => on && setSov(d && d.summary ? d.summary : null))
      .catch(() => {});
    load();
    const i = setInterval(load, 30000);
    return () => { on = false; clearInterval(i); };
  }, []);

  const nodes = useMemo(() => {
    const out = [];
    for (let i = 0; i < shown; i++) {
      const angle = i * GOLDEN - Math.PI / 2;
      const radius = 58 + ((i * 37) % 46);
      out.push({ angle, radius, strong: i < hybrid, delay: 120 + i * 110 });
    }
    return out;
  }, [shown, hybrid]);

  const headline = neighbours === 0
    ? t("mesh.map.alone")
    : neighbours === 1 ? t("mesh.map.one") : t("mesh.map.many", { n: neighbours });

  return (
    <View style={styles.wrap} testID="mesh-constellation">
      <Text style={styles.title}>{t("mesh.map.title")}</Text>
      <View style={styles.stage}>
        {nodes.map((n, i) => (
          <Link key={`l${i}`} angle={n.angle} radius={n.radius} delay={n.delay} strong={n.strong} tint={tint} alive={mix > 0 || neighbours > 0} />
        ))}
        <Core tint={tint} />
        {nodes.map((n, i) => (
          <Peer key={`p${i}`} angle={n.angle} radius={n.radius} delay={n.delay} strong={n.strong} tint={tint} />
        ))}
        <View style={styles.youTag}><Text style={styles.youTxt}>{t("mesh.map.you")}</Text></View>
      </View>

      <View style={styles.badges}>
        <View style={[styles.badge, { borderColor: health === "isolated" ? theme.border : theme.accent }]}>
          <View style={[styles.dot, { backgroundColor: health === "isolated" ? theme.textFaint : theme.accent }]} />
          <Text style={styles.badgeTxt} testID="mesh-map-health">{t("mesh.map.health." + health)}</Text>
        </View>
        {sov && sov.nodes_total > 0 && (
          <View style={[styles.badge, { borderColor: sov.nodes_online > 0 ? theme.accent : theme.border }]}>
            <View style={[styles.dot, { backgroundColor: sov.nodes_online > 0 ? theme.accent : theme.textFaint }]} />
            <Text style={styles.badgeTxt} testID="mesh-map-sovereign">{sov.nodes_online}/{sov.nodes_total} nodi</Text>
          </View>
        )}
        {hybrid > 0 && (
          <View style={[styles.badge, { borderColor: theme.accent }]}>
            <Ionicons name="shield-checkmark-outline" size={12} color={theme.accent} />
            <Text style={styles.badgeTxt}>{t("mesh.map.strong", { n: hybrid })}</Text>
          </View>
        )}
        {mix > 0 && (
          <View style={[styles.badge, { borderColor: tint }]}>
            <Ionicons name="swap-horizontal-outline" size={12} color={tint} />
            <Text style={styles.badgeTxt}>{t("mesh.map.carrying", { n: mix })}</Text>
          </View>
        )}
      </View>

      <Text style={styles.head} testID="mesh-map-headline">{headline}</Text>
      <Text style={styles.legend}>{neighbours === 0 ? t("mesh.map.aloneHint") : t("mesh.map.legend")}</Text>

      {!!details && (
        <>
          <TouchableOpacity style={styles.toggle} onPress={() => setOpen((v) => !v)} testID="mesh-map-details-toggle">
            <Ionicons name={open ? "chevron-up" : "chevron-down"} size={14} color={theme.textDim} />
            <Text style={styles.toggleTxt}>{open ? t("mesh.map.hideDetails") : t("mesh.map.details")}</Text>
          </TouchableOpacity>
          {open && <View testID="mesh-map-details">{details}</View>}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 14, padding: 16, borderRadius: 20,
    borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface,
  },
  title: { color: theme.textDim, fontSize: 11, fontWeight: "900", letterSpacing: 1.8, textTransform: "uppercase" },
  stage: { width: BOX, height: BOX, alignSelf: "center", marginVertical: 6 },
  core: {
    width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center",
    shadowOpacity: 0.7, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 6,
  },
  youTag: { position: "absolute", left: 0, right: 0, top: BOX / 2 + 26, alignItems: "center" },
  youTxt: { color: theme.textFaint, fontSize: 10, fontWeight: "800", letterSpacing: 1.4, textTransform: "uppercase" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
    borderWidth: 1, backgroundColor: theme.surfaceAlt,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  badgeTxt: { color: theme.text, fontSize: 11.5, fontWeight: "700" },
  head: { color: theme.text, fontSize: 16, fontWeight: "800", marginTop: 14 },
  legend: { color: theme.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 6 },
  toggle: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 14 },
  toggleTxt: { color: theme.textDim, fontSize: 12, fontWeight: "700" },
});

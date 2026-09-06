import React, { useState } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import { theme } from "../theme";

export default function LegalScreen({ route }) {
  const { url } = route.params || {};
  const [loading, setLoading] = useState(true);
  return (
    <View style={styles.root}>
      <WebView
        source={{ uri: url }}
        style={{ backgroundColor: "transparent" }}
        onLoadEnd={() => setLoading(false)}
        startInLoadingState
        testID="legal-webview"
      />
      {loading && (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator color={theme.primary} size="large" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "transparent" },
});

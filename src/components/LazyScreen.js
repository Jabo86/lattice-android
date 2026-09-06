// Caricamento pigro delle schermate che tirano dentro moduli nativi (fotocamera, selettore
// file, generatore QR). Se uno di quei moduli esplode, esplode SOLO quando apri quella
// schermata, con un messaggio leggibile: l'app non si chiude più all'avvio.
import React from "react";
import { View, Text, ActivityIndicator, ScrollView } from "react-native";
import { theme } from "../theme";

export function lazyScreen(loader, label) {
  return function LazyScreen(props) {
    const [C, setC] = React.useState(null);
    const [err, setErr] = React.useState(null);
    React.useEffect(() => {
      try {
        const mod = loader();
        // ATTENZIONE: setC(Componente) NON va fatto. React tratta una funzione passata a
        // setState come "funzione di aggiornamento" e la CHIAMA con lo stato precedente
        // (null) al posto delle props. Serve la funzione che restituisce il componente.
        setC(() => (mod && (mod.default || mod)));
      } catch (e) { setErr(e); }
    }, []);
    if (err) {
      return (
        <ScrollView style={{ flex: 1, backgroundColor: theme.bg }} contentContainerStyle={{ padding: 24, paddingTop: 72 }}>
          <Text style={{ color: theme.danger, fontSize: 17, fontWeight: "700" }}>{label}: non si apre</Text>
          <Text selectable style={{ color: theme.text, fontSize: 13, marginTop: 12 }}>{String((err && err.message) || err)}</Text>
          <Text selectable style={{ color: theme.textFaint, fontSize: 10, marginTop: 12 }}>{String((err && err.stack) || "").slice(0, 3000)}</Text>
        </ScrollView>
      );
    }
    if (!C) {
      return (
        <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={theme.primary} />
        </View>
      );
    }
    return <C {...props} />;
  };
}

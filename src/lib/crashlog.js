// Diagnostica degli arresti: se l'app muore per un errore nativo (fuori dalla portata del
// JavaScript), il dettaglio viene scritto su file da MainActivity e mostrato qui al riavvio.
// Serve a non trovarsi mai più con "l'app si è chiusa" e nessuna traccia.
import { Alert, Share } from "react-native";
import * as FileSystem from "expo-file-system/legacy";

const NATIVE = FileSystem.documentDirectory + "nativecrash.txt";
const JS = FileSystem.documentDirectory + "lastcrash.txt";

async function readAndClear(path) {
  try {
    const txt = await FileSystem.readAsStringAsync(path);
    await FileSystem.deleteAsync(path, { idempotent: true });
    return txt && txt.trim() ? txt : "";
  } catch { return ""; }
}

export async function reportPendingCrash(isEnglish) {
  // Entrambi i file vengono sempre letti E cancellati: nessun residuo che ricompare.
  const nat = await readAndClear(NATIVE);
  const js = await readAndClear(JS);
  const txt = nat || js;
  if (!txt) return false;
  const en = !!isEnglish;
  Alert.alert(
    en ? "Last time the app stopped" : "L'ultima volta l'app si è fermata",
    (en ? "Here is what went wrong. Send it to the developer: it is all that is needed to fix it.\n\n"
        : "Ecco cosa è andato storto. Mandalo allo sviluppatore: è tutto quello che serve per sistemarlo.\n\n") +
      txt.slice(0, 700),
    [
      { text: en ? "Share" : "Condividi", onPress: () => Share.share({ message: "Lattice crash:\n" + txt.slice(0, 3000) }).catch(() => {}) },
      { text: "OK", style: "cancel" },
    ]
  );
  return true;
}

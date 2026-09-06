// Scelta foto profilo/gruppo: ritaglio quadrato + ridimensionamento a 512px prima
// dell'upload. Le foto del telefono a piena risoluzione superavano il limite del corpo
// della richiesta e il salvataggio falliva silenziosamente (413).
// La galleria manda l'app in background: sopprimiamo il ri-blocco col PIN, altrimenti al
// rientro l'app torna alla Home e la foto scelta va persa.
import * as ImagePicker from "expo-image-picker";
import { shrinkPhoto } from "./imageOpt";
import { suppressLock } from "./lockGuard";

export async function pickAvatarDataUrl() {
  suppressLock();
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { denied: true };
  const r = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"], quality: 0.6, base64: true, allowsEditing: true, aspect: [1, 1],
  });
  suppressLock();
  const uri = !r.canceled && r.assets?.[0]?.uri;
  if (!uri) return {};
  // 128 KB bastano e avanzano per un avatar: prima, con l'API deprecata che lanciava, si
  // finiva SEMPRE nel ripiego e l'avatar del gruppo pesava 2,6 MB (e viaggiava in ogni
  // elenco dei gruppi).
  const out = await shrinkPhoto(uri, 128 * 1024);
  if (out?.base64) return { dataUrl: `data:image/jpeg;base64,${out.base64}` };
  // Fallback: usa lo scatto originale (il server ora accetta fino a 16 MB).
  const a = r.assets[0];
  if (a.base64) return { dataUrl: `data:image/jpeg;base64,${a.base64}` };
  return { error: true };
}

import { PermissionsAndroid, Platform } from "react-native";

// Richiede i permessi microfono (+ fotocamera per video) PRIMA di chiamare getUserMedia.
// Su New Architecture, getUserMedia senza permessi già concessi provoca un crash nativo (SIGABRT):
// qui garantiamo che i permessi siano concessi, altrimenti si esce in modo pulito senza crash.
export async function ensureCallPermissions(video) {
  if (Platform.OS !== "android") return true;
  try {
    const perms = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
    if (video) perms.push(PermissionsAndroid.PERMISSIONS.CAMERA);
    const res = await PermissionsAndroid.requestMultiple(perms);
    return perms.every((p) => res[p] === PermissionsAndroid.RESULTS.GRANTED);
  } catch {
    return false;
  }
}

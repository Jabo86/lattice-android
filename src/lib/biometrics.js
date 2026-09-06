import * as LocalAuthentication from "expo-local-authentication";

// Whether the device can lock the app (biometrics OR a device PIN/passcode).
export async function isDeviceSecure() {
  try {
    const enrolledLevel = await LocalAuthentication.getEnrolledLevelAsync();
    // NONE = 0, SECRET (PIN/pattern/passcode) = 1, BIOMETRIC = 2
    return enrolledLevel !== LocalAuthentication.SecurityLevel.NONE;
  } catch {
    return false;
  }
}

// Prompt biometric (FaceID/Touch/fingerprint) with device PIN/passcode fallback.
export async function authenticate(reason = "Sblocca Lattice") {
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      cancelLabel: "Annulla",
      fallbackLabel: "Usa il PIN del dispositivo",
      disableDeviceFallback: false, // allow device passcode/PIN fallback
    });
    return !!res.success;
  } catch {
    return false;
  }
}

// Default server (trial/hosted). Companies with a license run their OWN server:
// the employee points the app to their company server (or the keyfile embeds it).
export const DEFAULT_SERVER = "https://49.12.242.0";

// Chiamate WebRTC: STUN/TURN self-hosted (coturn sul VPS sovrano, nessun servizio a pagamento).
// Il relay TURN richiede credenziali temporanee dal backend ULTRON.
export const ICE_SERVERS = [{ urls: "stun:49.12.242.0:3478" }];

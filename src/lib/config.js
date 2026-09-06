// Default server (trial/hosted). Companies with a license run their OWN server:
// the employee points the app to their company server (or the keyfile embeds it).
export const DEFAULT_SERVER = "https://lattice-network.it";

// Chiamate WebRTC: STUN/TURN self-hosted (coturn sul VPS sovrano, nessun servizio a pagamento).
export const ICE_SERVERS = [
  { urls: "stun:lattice-network.it:3478" },
  { urls: "turn:lattice-network.it:3478?transport=udp", username: "lattice", credential: "latticeturn" },
  { urls: "turn:lattice-network.it:3478?transport=tcp", username: "lattice", credential: "latticeturn" },
];

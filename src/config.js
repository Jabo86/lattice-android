// Default server (trial/hosted). Companies with a license run their OWN server:
// the employee points the app to their company server (or the keyfile embeds it).
export const DEFAULT_SERVER = "https://lattice-network.it";
// Chi amministra il server. Riceve i promemoria di manutenzione del canarino;
// tutti gli altri vedono soltanto lo stato, senza notifiche di sistema.
// L'owner non e' UN indirizzo: e' un elenco. Con un solo valore, cambiare account
// (o averne due) significa spegnere in silenzio TUTTI gli avvisi di manutenzione —
// ed e' esattamente quello che e' accaduto: `OWNER_LNS` puntava a un indirizzo non piu
// in uso, quindi `isOwner()` era sempre falso, la striscia del canarino non compariva
// mai e nessuna notifica di scadenza e' mai partita.
export const OWNER_LNS_LIST = [
  "fabioastorino@latticenetwork.lns",
  "gerardoastorino@lattice.lns",
];
export const OWNER_LNS = OWNER_LNS_LIST[0];

// Chiamate WebRTC: SOLO infrastruttura nostra (coturn sul VPS sovrano). Gli STUN pubblici
// di Google sono stati rimossi: contattarli significherebbe dire a un terzo che stai
// chiamando, e da quale indirizzo. Il media passa dal nostro relay, quindi i due
// interlocutori non vedono mai l'IP l'uno dell'altro.
export const ICE_SERVERS = [
  { urls: "stun:lattice-network.it:3478" },
  { urls: "turn:lattice-network.it:3478?transport=udp", username: "lattice", credential: "latticeturn" },
  { urls: "turn:lattice-network.it:3478?transport=tcp", username: "lattice", credential: "latticeturn" },
];

// "relay" = tutto il media passa dal nostro relay: nessuno dei due conosce l'IP dell'altro.
// "all" (solo se l'utente lo chiede) = connessione diretta: più veloce, ma il tuo indirizzo
// diventa visibile all'altra persona.
export function iceConfig(allowDirect) {
  return {
    iceServers: ICE_SERVERS,
    iceTransportPolicy: allowDirect ? "all" : "relay",
    bundlePolicy: "max-bundle",
  };
}

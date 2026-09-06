// ACCENSIONE DEL NODO ALL'AVVIO.
// Prima bisognava aprire le Impostazioni perché il nodo partisse: con la chat sulla mesh
// non è più accettabile (i messaggi degli altri arriverebbero solo a schermata aperta).
// Qui il nodo parte da solo al login e allo sblocco col PIN, ma SOLO se la Modalità Nodo
// Sovrano è accesa: in Modalità Standard non parte niente.
import * as meshNode from "./mesh";
import * as runtime from "./mesh/runtime";
import * as meshchat from "./meshchat";
import * as bridge from "./bridge";
import * as gossip from "./mesh/gossip";

export async function boot(user) {
  if (!user || !user.kem) return false;
  try {
    meshchat.setIdentity(user);
    const m = await meshNode.getMode();
    if (m !== meshNode.SOVEREIGN) return false;
    if (runtime.running()) return true;
    // Questo nodo fa anche da PONTE per chi non ha connessione (senza leggere niente).
    await runtime.start(user, meshchat.onDeliver, async () => {
      await meshchat.flush(user);
      await bridge.deliverCarried();     // corriere: si consegna appena torna la rete
      // passaparola di gruppo: se il destinatario di una copia in custodia è comparso,
      // gliela si consegna adesso.
      await gossip.deliverStashed(await meshchat.peerMesh());
    }, bridge.carry);
    return true;
  } catch { return false; }
}

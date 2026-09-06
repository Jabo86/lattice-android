// RIPARAZIONE DELLA CATENA (ratchet) ROTTA IN UN SOLO SENSO.
//
// Il guasto trovato sui telefoni reali (Fabio → Katia, letto nel database del server):
// il mittente manda messaggi del ratchet con numero d'ordine 7, 8, 9, 10, 11 e **senza
// `init`**, perché per lui la sessione è stabilita; il destinatario non ha mai potuto creare
// la propria metà (il primo `init` usava una chiave usa-e-getta che lui non possedeva) e
// quindi non apre NIENTE, per sempre: il mittente non ha alcun motivo per ripartire da capo.
//
// Rimedio: chi non riesce ad aprire un messaggio del ratchet lo DICE al mittente con un
// messaggio di controllo invisibile; il mittente azzera la sessione e manda subito un
// controllo che porta un `init` nuovo. La catena si richiude senza che nessuno dei due
// debba fare nulla — e senza mai indebolire la crittografia: si riparte da una radice nuova.
import { packMessage } from "./crypto";
import * as api from "./api";
import { resetRatchet } from "./ratchet";

export const CTL_PREFIX = "\u0001rst:";
const THROTTLE = 20 * 60 * 1000;      // una richiesta ogni 20 minuti per contatto
const asked = new Map();
export const counters = { asked: 0, honoured: 0 };

/// Chiede al mittente di ripartire da una radice nuova.
export async function requestReset(peerLns, user, sdev) {
  if (!peerLns || !user || !user.kem) return false;
  const now = Date.now();
  if (now - (asked.get(peerLns) || 0) < THROTTLE) return false;
  asked.set(peerLns, now);
  try {
    const { buildEnvelopes } = require("./send");
    const payload = packMessage(CTL_PREFIX + JSON.stringify({ dev: sdev || "", at: now }), [], null, 0);
    const envelopes = await buildEnvelopes(payload, [peerLns], user);
    if (!envelopes.length) return false;
    // Nessuno deve sentire squillare il telefono per una riparazione tecnica.
    await api.send({ to_lns: [peerLns], envelopes, silent: true });
    counters.asked++;
    return true;
  } catch {
    asked.delete(peerLns);            // niente rete: si riproverà
    return false;
  }
}

/// Richiesta ricevuta: si azzera la sessione e si manda subito un controllo invisibile,
/// così l'`init` nuovo parte senza aspettare che l'utente scriva.
export async function onReset(fromLns, user) {
  if (!fromLns || !user || !user.kem) return false;
  try {
    await resetRatchet(fromLns);
    counters.honoured++;
    try {
      const msh = require("./meshchat");
      await msh.publishTo(fromLns, user, { force: true, req: false });
    } catch { /* il prossimo messaggio porterà comunque l'init */ }
    return true;
  } catch { return false; }
}

export function summary() { return { asked: counters.asked, honoured: counters.honoured }; }

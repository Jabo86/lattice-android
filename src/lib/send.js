// Costruzione delle buste in uscita.
// Il doppio ratchet vale per OGNI destinatario: nelle chat a due e nei gruppi (una busta
// ratchet per ciascun dispositivo di ciascun membro). Chi ha un'app vecchia riceve la busta
// nello schema precedente, così nessuno resta senza messaggi.
import { encryptForRecipients } from "./crypto";
import { addSelfKeys } from "./devices";
import { ratchetEnvelopesFor } from "./ratchet";
import * as api from "./api";

export async function buildEnvelopes(payload, others, user) {
  const envelopes = [];
  const keyMap = {};
  for (const peer of others) {
    let r = { envelopes: [], legacy: [] };
    try { r = await ratchetEnvelopesFor(payload, peer, user); } catch { /* si ripiega sotto */ }
    envelopes.push(...r.envelopes);
    if (r.legacy.length) keyMap[peer] = r.legacy;
    if (!r.envelopes.length && !r.legacy.length) {
      const km = await api.pulseKeys([peer]);
      if (km && km[peer]) keyMap[peer] = km[peer];
    }
  }
  await addSelfKeys(keyMap, user); // le mie copie restano sulle chiavi usa-e-getta
  if (Object.keys(keyMap).length) envelopes.push(...encryptForRecipients(payload, keyMap));

  const covered = new Set(envelopes.map((e) => e.for));
  const missing = others.filter((o) => !covered.has(o));
  if (missing.length) throw new Error(missing.join(", "));
  return envelopes;
}

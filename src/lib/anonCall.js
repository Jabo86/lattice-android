// Signaling ANONIMO delle chiamate — helper client per il "blind rendezvous".
// Il server vede solo rid casuali/derivati + blob cifrati E2E: non sa CHI chiama CHI né QUANDO.
import * as crypto from "./crypto";

const EPOCH_MS = 30000; // finestra di discovery ~30s

export const anonEpoch = () => Math.floor(Date.now() / EPOCH_MS);
// epoch corrente + precedente (tolleranza sfasamento orologi).
export const anonEpochs = () => { const e = anonEpoch(); return [e, e - 1]; };

// rid di discovery per la coppia (chi chiama, chi risponde) a un dato epoch.
// Simmetrico: sia il chiamante sia il ricevente calcolano lo stesso valore dal segreto pairwise.
export function discRid(shared, callerLns, calleeLns, epoch) {
  return crypto.anonRid(shared, `disc|${callerLns}|${calleeLns}|${epoch}`);
}

// canale casuale (32 hex) per offer/answer/ICE della singola chiamata (non correlabile).
export const newChan = () => crypto.randomHex(16);

// Sigilla l'invito (offer + identità del chiamante) verso la chiave ML-KEM del ricevente.
export function sealInvite(inviteObj, calleeKemPkHex) {
  const env = crypto.encryptForRecipients(JSON.stringify(inviteObj), { c: calleeKemPkHex });
  return env[0];
}
export function openInvite(env, myKemSk) {
  try {
    const pt = crypto.decryptEnvelope(env, myKemSk);
    return pt ? JSON.parse(pt) : null;
  } catch { return null; }
}

// DOPO LA DOGANA — un tocco, e tutto ciò che può essere rifatto viene rifatto.
//
// Il caso è preciso: il telefono è stato fuori dalle vostre mani. Un controllo alla
// frontiera, un fermo, un sequestro breve, un albergo. Chi l'ha avuto in mano potrebbe avere
// copiato lo stato delle sessioni e i segreti delle chiavi usa-e-getta non ancora consumate.
// Non è ipotetico: sono file, e i file si copiano.
//
// Cosa si può rifare senza cambiare identità (e quindi senza far scattare allarmi a chi vi
// ha verificato):
//   1. le usa-e-getta: si bruciano tutte, il server butta le pubbliche, se ne pubblicano di nuove;
//   2. le chiavi d'aggancio: generazione nuova (X25519 + ML-KEM-1024);
//   3. le sessioni: ogni conversazione riparte da una radice nuova;
//   4. le chiavi dei contatti tenute in cassaforte: buttate e riscaricate;
//   5. i contatti verificati: si ricontrolla che l'impronta non sia cambiata mentre eravate
//      lontani dal telefono — se qualcuno vi ha infilato una chiave falsa, esce qui;
//   6. i file decifrati rimasti nella cache: cancellati.
//
// Cosa NON si può rifare: l'identità ML-DSA-65. Cambiarla vuol dire cambiare numero di
// sicurezza, e ogni contatto verificato vedrebbe un allarme. Se il sospetto è che vi abbiano
// preso IL FILE CHIAVE, l'unica risposta è l'autodistruzione e un'identità nuova.
import { removeBlob, clearPlainCache } from "./lock";
import * as kg from "./keygen";
import { resetAllRatchets } from "./ratchet";
import { syncPrekeys } from "./maintenance";
import { ensureDevice } from "./devices";
import { verifiedList, verifyState } from "./verify";

export async function afterBorder(user, onStep) {
  const r = { prekeys: 0, gen: 0, sessions: 0, peerKeys: 0, checked: 0, changed: [], cache: 0, errors: [], at: Date.now() };
  const tick = (i, s) => { try { onStep && onStep(i, s); } catch { /* la UI non deve poter fermare la pulizia */ } };

  // 1 · usa-e-getta: i segreti stanno sul telefono finché non vengono consumati, quindi
  //     sono la cosa più preziosa che si possa copiare. Si bruciano per prime.
  tick(0, "run");
  try {
    await removeBlob("prekeys");
    await syncPrekeys();          // dichiara al server "non ne possiedo nessuna" → le butta
    await ensureDevice();         // e rifornisce il magazzino con un lotto nuovo
    r.prekeys = 1;
    tick(0, "ok");
  } catch { r.errors.push("prekeys"); tick(0, "err"); }

  // 2 · chiavi d'aggancio: generazione nuova, pubblicata. L'identità non si muove.
  tick(1, "run");
  try {
    r.gen = await kg.rotate(user);
    if (!r.gen) throw new Error("no");
    tick(1, "ok");
  } catch { r.errors.push("handshake"); tick(1, "err"); }

  // 3+4 · sessioni e chiavi dei contatti: via tutto. Quello che è stato copiato non apre
  //       più niente da adesso, e le chiavi dei contatti tornano dal server.
  tick(2, "run");
  try {
    const x = await resetAllRatchets();
    r.sessions = x.sessions;
    r.peerKeys = x.peerKeys;
    tick(2, "ok");
  } catch { r.errors.push("sessions"); tick(2, "err"); }

  // 5 · contatti verificati: è il controllo che conta davvero. Se mentre il telefono era
  //     via qualcuno ha sostituito la chiave di un contatto, l'impronta non combacia più.
  tick(3, "run");
  try {
    const list = await verifiedList();
    for (const lns of list) {
      const st = await verifyState(lns);
      r.checked++;
      if (st.state === "changed") r.changed.push(lns);
    }
    tick(3, "ok");
  } catch { r.errors.push("verify"); tick(3, "err"); }

  // 6 · roba decifrata rimasta nella cache: foto, video, documenti aperti, esportazioni.
  tick(4, "run");
  try { r.cache = await clearPlainCache(); tick(4, "ok"); } catch { r.errors.push("cache"); tick(4, "err"); }

  return r;
}

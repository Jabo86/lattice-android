// CHAT ISTANTANEA — l'ultima pagina di ogni conversazione tenuta sul telefono.
// Prima di aprire una chat si aspettava la rete: con la linea lenta la schermata restava
// vuota per secondi. Qui si conservano le BUSTE CIFRATE così come arrivano dal server
// (nessun testo in chiaro in più sul telefono: la decifratura resta in memoria) dentro un
// blob a sua volta cifrato con la chiave del dispositivo — con il PIN attivo non è
// leggibile finché non sblocchi. Alla riapertura la chat compare subito, poi la rete
// aggiorna quello che è cambiato.
import * as lock from "./lock";

const NAME = (cid) => "cc:" + String(cid || "");
const MAX = 40;
const sigs = new Map(); // conv_id -> firma di ciò che è già stato scritto

export async function read(cid) {
  if (!cid) return null;
  try {
    const v = await lock.getBlob(NAME(cid));
    return Array.isArray(v) && v.length ? v : null;
  } catch { return null; }
}

/// Scrittura accorpata e solo se qualcosa è cambiato: il poll gira ogni 4 secondi e
/// ricifrare l'intera pagina ogni volta sarebbe uno spreco.
export function save(cid, raw) {
  if (!cid || !Array.isArray(raw) || !raw.length) return;
  const cut = raw.slice(-MAX);
  let sig = cut.length + "#";
  for (const m of cut) sig += String(m.message_id) + (m.delivered ? "d" : "") + (m.read ? "r" : "") + (m.edited ? "e" : "") + "|";
  if (sigs.get(cid) === sig) return;
  sigs.set(cid, sig);
  try { lock.setBlobSoon(NAME(cid), cut); } catch { /* si riproverà */ }
}

export async function drop(cid) {
  sigs.delete(cid);
  try { await lock.removeBlob(NAME(cid)); } catch { /* niente */ }
}

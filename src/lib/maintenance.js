// MANUTENZIONE AUTOMATICA — gira da sola all'avvio, l'utente non deve fare nulla.
//
// Tre guasti silenziosi che abbiamo pagato caro e che qui si riparano da soli:
//  1. CHIAVI ORFANE: sul server restavano usa-e-getta pubbliche di cui questo telefono non
//     ha (più) il segreto. Chi ti scrive ne consuma una e quel messaggio è illeggibile per
//     sempre. Ora il telefono dichiara al server quali sa aprire e il server butta le altre.
//  2. DISPOSITIVI MORTI: ogni vecchia installazione resta "attiva" e si prende una copia di
//     ogni messaggio (buste inutili, chiavi consumate, catene mai usate). Si revocano da sole.
//  3. CHIAVE STATICA NON SCARICATA: senza di essa la catena che si rigenera non parte e si
//     ricade sulle usa-e-getta. Ora la chiave statica dei contatti si tiene in cassaforte
//     locale, quindi una richiesta al server andata male non impedisce più la ripartenza.
import * as api from "./api";
import { deviceId, localPrekeyIds, ensureDevice } from "./devices";
import { cacheStaticKeys } from "./ratchet";
import { refreshTicket, deliverCarried } from "./bridge";

const DEAD_MS = 48 * 3600 * 1000;   // non vista da 2 giorni = installazione finita.
// Nessun rischio: se quel telefono esiste ancora, alla prima apertura si registra di
// nuovo da solo (`devices/register` rimette `revoked: false`). Meglio togliere una
// installazione viva per un giorno che tenerne quattro morte che si prendono una copia
// di ogni messaggio e consumano chiavi usa-e-getta.
export const report = { pruned: 0, orphans: 0, devices: 0, at: 0, err: "" };

/// Chiavi orfane: si dichiara quello che si possiede, il server pulisce il resto.
export async function syncPrekeys() {
  const did = await deviceId();
  const have = await localPrekeyIds();
  const r = await api.prekeysSync(did, have);
  const removed = Number(r && r.removed) || 0;
  report.orphans += removed;
  // Se ne sono state buttate, il magazzino va rifornito subito (con l'ordine giusto:
  // prima i segreti al sicuro, poi le pubbliche).
  if (removed > 0) { try { await ensureDevice(); } catch { /* al prossimo avvio */ } }
  return removed;
}

/// Vecchie installazioni: revoca automatica (mai quella in uso).
export async function pruneDevices() {
  const did = await deviceId();
  const list = await api.listDevices();
  const arr = Array.isArray(list) ? list : (list && Array.isArray(list.devices) ? list.devices : []);
  report.devices = arr.filter((d) => d && !d.revoked).length;
  const now = Date.now();
  let n = 0;
  for (const d of arr) {
    const id = d && (d.device_id || d.id || d._id);
    if (!id || id === did || d.revoked) continue;
    const seen = Date.parse(d.last_seen || d.lastSeen || 0) || 0;
    if (!seen || now - seen < DEAD_MS) continue;
    try { await api.revokeDevice(id); n++; } catch { /* si riprova al prossimo avvio */ }
  }
  report.pruned += n;
  if (n) report.devices -= n;
  return n;
}

/// Chiave statica dei contatti in cassaforte: la catena parte anche se il server non
/// risponde in quel momento.
export async function warmStaticKeys(peers) {
  const list = (peers || []).filter((p) => typeof p === "string" && p.includes("@")).slice(0, 40);
  if (!list.length) return 0;
  return await cacheStaticKeys(list);
}

/// Tutto insieme, senza mai far cadere l'avvio dell'app.
export async function run(peers) {
  report.at = Date.now();
  try { await syncPrekeys(); } catch (e) { report.err = "chiavi: " + (e && e.message ? e.message : "?"); }
  try { await pruneDevices(); } catch (e) { report.err = "dispositivi: " + (e && e.message ? e.message : "?"); }
  try { await warmStaticKeys(peers); } catch { /* si riprova */ }
  // Ticket del Ponte Internet: si prende ADESSO che c'è rete, servirà quando non ci sarà.
  try { await refreshTicket(); } catch { /* si riprova al prossimo avvio */ }
  // CORRIERE: se stiamo portando pacchetti di altri e ora c'è rete, si consegnano.
  try { report.later = await deliverCarried(); } catch { /* si riprova */ }
  return report;
}

export function summary() { return Object.assign({}, report); }

// NOME DEL GRUPPO CIFRATO — il server non ha bisogno di sapere come si chiama un gruppo
// privato. Il nome viaggia cifrato con la CHIAVE DI GRUPPO (AES-256-GCM) che il server non
// ha mai visto: in `name` resta un'etichetta fissa, uguale per tutti i gruppi.
// I gruppi PUBBLICI (cercabili per nome) restano in chiaro: il loro nome è pubblico per
// definizione, cifrarlo li renderebbe introvabili.
import { unwrapGroupKey, encryptWithGroupKey, decryptWithGroupKey } from "./crypto";

export const PLACEHOLDER = "Gruppo cifrato";

// chan_id → nome in chiaro (solo in memoria: si svuota alla chiusura dell'app)
const cache = new Map();

export function cachedName(chanId) {
  return cache.get(chanId) || null;
}

/// Cifra un nome per il gruppo: {iv, ct}.
export function sealName(name, groupKey) {
  return encryptWithGroupKey(String(name || "").slice(0, 200), groupKey);
}

/// Restituisce la riga con il nome in chiaro. `row` deve avere `name_enc` e `my_key`
/// (la busta ML-KEM con la chiave di gruppo): senza chiave privata nessuno può leggerlo.
export function openRow(row, user) {
  if (!row || typeof row !== "object") return row;
  const enc = row.name_enc;
  if (!enc || !enc.iv || !enc.ct) return row;
  const id = row.chan_id;
  const known = id ? cache.get(id) : null;
  if (known) return Object.assign({}, row, { name: known, name_blind: true });
  if (!row.my_key || !user?.kem?.secretKey) {
    return Object.assign({}, row, { name: row.name || PLACEHOLDER, name_blind: true });
  }
  try {
    const gk = unwrapGroupKey(row.my_key, user.kem.secretKey);
    const plain = decryptWithGroupKey(enc.iv, enc.ct, gk);
    if (plain) {
      if (id) cache.set(id, plain);
      return Object.assign({}, row, { name: plain, name_blind: true });
    }
  } catch { /* chiave non nostra: resta l'etichetta */ }
  return Object.assign({}, row, { name: row.name || PLACEHOLDER, name_blind: true });
}

export function openRows(rows, user) {
  return Array.isArray(rows) ? rows.map((r) => openRow(r, user)) : rows;
}

export function clear() {
  cache.clear();
}

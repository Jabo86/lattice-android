// RUBRICA CIECA — la rubrica vive sul TELEFONO, cifrata con la chiave del dispositivo
// (o col PIN, se attivo). Al server, per ogni contatto, arriva un GETTONE DI COPPIA:
//     rid = HKDF(segreto X25519 condiviso tra noi due, "lattice-blind-contact-v1")
// Lo calcoliamo identico io e il contatto; il server NON può calcolarlo (gli servirebbe una
// chiave privata che non ha mai visto), però può ancora verificare che ci siamo aggiunti a
// vicenda confrontando i gettoni.
//
// REGOLA IMPARATA A CARO PREZZO (v1.4.1): l'indirizzo si può togliere dal server SOLO per i
// contatti il cui gettone ha già un riscontro dall'altra parte. Togliendolo verso chi non ha
// ancora aggiornato l'app, la reciprocità diventa impossibile e i due non riescono più a
// scriversi. Per questo `sync` pota SOLO i gettoni "matched" e `reconcile` rimette in chiaro
// gli indirizzi mancanti.
import { getBlob, setBlob } from "./lock";
import { anonSharedSecret, anonRid } from "./crypto";
import * as api from "./api";

const BLOB = "book"; // { lns: {name, avatar, dh, blocked, favorite, has_key, pruned, at} }
const LABEL = "lattice-blind-contact-v1";       // gettone stabile (ponte verso la 1.4.x)
const LABEL_POLY = "lattice-blind-contact-v2";  // gettoni a rotazione (polimorfici)
export const EPOCH_MS = 30 * 24 * 3600 * 1000;  // durata di un periodo: 30 giorni

/// Numero del periodo corrente. Deriva dall'orologio: per questo si pubblicano anche il
/// periodo precedente e quello successivo (tolleranza di 30-60 giorni).
export function epochOf(t) {
  return Math.floor((t || Date.now()) / EPOCH_MS);
}

/// I tre gettoni a rotazione di una coppia (precedente, attuale, successivo).
export function polyRids(shared, t) {
  const e = epochOf(t);
  return [e - 1, e, e + 1].map((k) => anonRid(shared, LABEL_POLY + ":" + k));
}

async function all() {
  const o = await getBlob(BLOB);
  return o && typeof o === "object" ? o : {};
}
async function save(o) {
  await setBlob(BLOB, o);
}

export async function list() {
  const o = await all();
  return Object.keys(o).map((lns) => Object.assign({ lns }, o[lns]));
}

export async function get(lns) {
  const o = await all();
  return o[String(lns || "").toLowerCase()] || null;
}

/// Salva/aggiorna un contatto in locale. `info` può portare nome, avatar e chiave DH.
export async function put(lns, info) {
  const k = String(lns || "").trim().toLowerCase();
  if (!k) return null;
  const o = await all();
  o[k] = Object.assign({ at: Date.now() }, o[k] || {}, info || {});
  await save(o);
  return o[k];
}

export async function remove(lns) {
  const k = String(lns || "").trim().toLowerCase();
  const o = await all();
  delete o[k];
  await save(o);
}

export async function setBlocked(lns, on) {
  return await put(lns, { blocked: !!on });
}

export async function setFavorite(lns, on) {
  return await put(lns, { favorite: !!on });
}

/// Nome imparato senza chiedere niente al server (per esempio dall'elenco chat).
export async function learnName(lns, name) {
  const k = String(lns || "").trim().toLowerCase();
  if (!k || !name) return;
  const o = await all();
  if (!o[k] || o[k].name === name) return;
  o[k] = Object.assign({}, o[k], { name });
  await save(o);
}

/// Gettoni di coppia. Richiede la chiave pubblica X25519 dell'altro: si chiede una volta e
/// poi resta nella rubrica locale. Restituisce { rids, poly, dh }: `poly` elenca quali dei
/// gettoni sono a rotazione (il riscontro su uno di questi chiude la transizione).
async function ridFor(lns, entry, user, dhCache) {
  let dh = entry && entry.dh;
  if (!dh) {
    dh = dhCache[lns];
    if (dh === undefined) {
      try {
        const r = await api.pulseDhKeys([lns]);
        dh = (r && (r[lns] || (r.keys && r.keys[lns]))) || "";
      } catch { dh = ""; }
      dhCache[lns] = dh;
    }
  }
  if (!dh || !user?.dh?.secretKey) return null;
  try {
    const shared = anonSharedSecret(user.dh.secretKey, dh);
    const poly = polyRids(shared);
    const rids = poly.slice();
    // Il gettone stabile si pubblica solo finché il contatto non ha risposto su uno di
    // quelli a rotazione: dopo, il server non ha più nessun valore costante nel tempo.
    if (!entry || !entry.poly) rids.push(anonRid(shared, LABEL));
    return { rids, poly, dh };
  } catch {
    return null;
  }
}

/// Pubblica i gettoni e toglie dal server SOLO gli indirizzi dei contatti che sono già
/// passati anche loro ai gettoni. Restituisce il riepilogo.
export async function sync(user) {
  if (!user?.dh?.secretKey) return { ok: false, reason: "no-dh" };
  const o = await all();
  const names = Object.keys(o);
  if (!names.length) return { ok: false, reason: "empty" };
  const dhCache = {};
  const rids = [];
  const blocked = [];
  const byRid = {};
  const isPoly = {};
  let changed = false;
  for (const lns of names) {
    const r = await ridFor(lns, o[lns], user, dhCache);
    if (!r) continue;
    if (o[lns].dh !== r.dh) { o[lns] = Object.assign({}, o[lns], { dh: r.dh }); changed = true; }
    // I gettoni restano SEMPRE tra i contatti: se un bloccato scomparisse anche da lì, il
    // server risponderebbe "aggiungetevi a vicenda" e l'altro capirebbe di essere bloccato.
    for (const rid of r.rids) {
      rids.push(rid);
      byRid[rid] = lns;
      if (r.poly.indexOf(rid) >= 0) isPoly[rid] = true;
      if (o[lns].blocked) blocked.push(rid);
    }
  }
  if (changed) await save(o);
  if (!rids.length) return { ok: false, reason: "no-rids" };
  let res;
  try {
    res = await api.publishBlindContacts(rids, blocked);
  } catch (e) {
    return { ok: false, reason: "publish", err: e };
  }
  const matched = Array.isArray(res && res.matched) ? res.matched : [];
  const okLns = new Set();
  const polyLns = new Set();
  for (const rid of matched) {
    const l = byRid[rid];
    if (!l) continue;
    okLns.add(l);
    if (isPoly[rid]) polyLns.add(l);
  }
  // Transizione chiusa: da qui in avanti verso questo contatto si pubblicano SOLO gettoni
  // a rotazione (niente più valori costanti nel tempo sul server).
  const promote = [...polyLns].filter((l) => o[l] && !o[l].poly);
  const prune = [...okLns].filter((l) => o[l] && !o[l].pruned);
  // RIPARAZIONE: un contatto già "cieco" che non ha più riscontro (per esempio perché è
  // stato mesi senza aprire l'app e i suoi gettoni sono scaduti) tornerebbe irraggiungibile.
  // Gli si rimette l'indirizzo in chiaro sul server: la reciprocità è più importante della
  // riservatezza del grafo, e appena si risincronizza l'indirizzo sparisce di nuovo.
  const heal = Object.keys(o).filter((l) => o[l] && o[l].pruned && !okLns.has(l) && byRid && Object.values(byRid).indexOf(l) >= 0);
  if (promote.length || prune.length || heal.length) {
    if (prune.length) {
      try { await api.prunePlainContacts(prune); } catch { /* si riprova al prossimo giro */ }
    }
    for (const l of heal) {
      try { await api.contactAddServer(l); } catch { /* si riprova al prossimo avvio */ }
    }
    const o2 = await all();
    for (const l of promote) if (o2[l]) o2[l] = Object.assign({}, o2[l], { poly: true });
    for (const l of prune) if (o2[l]) o2[l] = Object.assign({}, o2[l], { pruned: true });
    for (const l of heal) if (o2[l]) o2[l] = Object.assign({}, o2[l], { pruned: false });
    await save(o2);
  }
  return { ok: true, published: (res && res.rids) || 0, matched: okLns.size,
    pruned: prune.length, healed: heal.length, rotating: polyLns.size };
}

/// Riepilogo per la diagnostica in Impostazioni: quanti contatti sono già protetti dai
/// gettoni a rotazione e quanti stanno ancora usando il ponte verso le versioni vecchie.
export async function stats() {
  const o = await all();
  const lns = Object.keys(o);
  return {
    total: lns.length,
    rotating: lns.filter((l) => o[l].poly).length,
    blind: lns.filter((l) => o[l].pruned).length,
    epoch: epochOf(),
  };
}

/// RICONCILIAZIONE AUTOMATICA — gira ad ogni avvio, in silenzio:
/// 1. porta sul telefono la rubrica che era sul server (la prima volta);
/// 2. rimette in chiaro sul server gli indirizzi dei contatti non ancora "ciechi", così ci
///    si può sempre scrivere (ripara anche le installazioni rovinate dalla v1.4.1);
/// 3. ripubblica i gettoni e pota gli indirizzi diventati superflui.
export async function reconcile(user) {
  if (!user?.lns) return { ok: false, reason: "no-user" };
  let o = await all();
  let server = [];
  try { server = await api.contactsRaw(); } catch { server = []; }
  const onServer = new Set((Array.isArray(server) ? server : [])
    .filter((c) => c && c.lns && c.in_my_book !== false)
    .map((c) => String(c.lns).toLowerCase()));

  // 1) prima volta: la rubrica del server diventa la rubrica del telefono
  if (Object.keys(o).length === 0) {
    for (const c of Array.isArray(server) ? server : []) {
      if (!c || !c.lns || c.in_my_book === false) continue;
      await put(c.lns, {
        name: c.display_name || "", avatar: c.avatar || "", blocked: !!c.blocked,
        favorite: !!c.favorite, has_key: !!c.has_key,
      });
    }
    o = await all();
  }

  // 2) chi non è ancora passato ai gettoni deve restare (o tornare) in chiaro sul server
  let restored = 0;
  for (const lns of Object.keys(o)) {
    if (o[lns].pruned) continue;      // già cieco da entrambe le parti
    if (onServer.has(lns)) continue;  // già presente
    try { await api.contactAddServer(lns); restored++; } catch { /* si riprova al prossimo avvio */ }
  }

  // 3) gettoni + potatura selettiva
  const r = await sync(user);
  return Object.assign({ ok: true, restored }, r);
}

// L'identità corrente (serve la chiave privata X25519 per calcolare i gettoni): la mettono
// AuthContext al login e all'avvio, così le modifiche alla rubrica si pubblicano da sole.
let me = null;
let timer = null;
export function setUser(u) {
  me = u;
}
export function syncSoon() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    if (me) sync(me).catch(() => {});
  }, 800);
}

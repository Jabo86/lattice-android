// DIAGNOSTICA DELLE BUSTE NON APERTE.
// Un "· messaggio non decifrabile ·" non deve più essere un mistero: qui si registra, per
// ogni busta che non si apre, TUTTO quello che serve a capire perché — senza mai salvare
// contenuti (che non abbiamo) né chiavi. Solo forma delle buste e conteggi.
const MAX = 12;
const state = { fails: 0, noKey: 0, wrongDev: 0, ratchet: 0, last: [] };

/// Registra un fallimento. `msg` è il record del server, `info` quello che sa il telefono.
export function note(msg, info) {
  try {
    const list = Array.isArray(msg && msg.envelopes) && msg.envelopes.length
      ? msg.envelopes : (msg && msg.envelope ? [msg.envelope] : []);
    const myDev = (info && info.dev) || "";
    const known = (info && info.pkIds) || [];
    const kinds = list.map((e) => ({
      r: !!(e && e.r),
      pk: e && e.pk_id ? (known.indexOf(e.pk_id) >= 0 ? "mia" : "ignota") : (e && e.pk_id === "" ? "identita" : "nessuna"),
      mio: !!(e && e.dev && myDev && e.dev === myDev),
    }));
    state.fails++;
    if (kinds.some((k) => k.pk === "ignota")) state.noKey++;
    if (kinds.length && !kinds.some((k) => k.mio)) state.wrongDev++;
    if (kinds.some((k) => k.r)) state.ratchet++;
    state.last.unshift({
      at: (msg && (msg.sent_at || msg.created_at)) || "",
      n: list.length,
      kinds,
      keys: known.length,
    });
    state.last = state.last.slice(0, MAX);
  } catch { /* la diagnostica non deve mai disturbare */ }
}

export function summary() {
  return { fails: state.fails, noKey: state.noKey, wrongDev: state.wrongDev, ratchet: state.ratchet, last: state.last.slice(0, 3) };
}
export function reset() { state.fails = 0; state.noKey = 0; state.wrongDev = 0; state.ratchet = 0; state.last = []; }

/// Riga leggibile per la schermata di diagnostica.
export function line(en) {
  const s = summary();
  let heal = "";
  try {
    const h = require("./ratchetheal").summary();
    if (h.asked || h.honoured) heal = "\n" + (en ? "Chain restarts: asked " : "Ripartenze catena: chieste ") + h.asked
      + (en ? " \u00b7 honoured " : " \u00b7 onorate ") + h.honoured;
  } catch { /* */ }
  if (!s.fails) {
    let z = en ? "Envelopes that failed to open: 0" : "Buste non aperte: 0";
    try {
      const h = require("./ratchetheal").summary();
      if (h.asked || h.honoured) z += "\n" + (en ? "Chain restarts: asked " : "Ripartenze catena: chieste ") + h.asked
        + (en ? " \u00b7 honoured " : " \u00b7 onorate ") + h.honoured;
    } catch { /* */ }
    return z;
  }
  let l = (en ? "Envelopes that failed to open: " : "Buste non aperte: ") + s.fails
    + (en ? " \u00b7 one-time key missing on this phone: " : " \u00b7 chiave usa-e-getta mancante su questo telefono: ") + s.noKey
    + (en ? " \u00b7 addressed to another device: " : " \u00b7 indirizzate a un altro dispositivo: ") + s.wrongDev;
  const l0 = s.last[0];
  if (l0) {
    l += "\n" + (en ? "Last one: " : "Ultima: ") + String(l0.at).slice(0, 16)
      + (en ? " \u00b7 envelopes: " : " \u00b7 buste: ") + l0.n
      + " [" + l0.kinds.map((k) => (k.r ? "ratchet" : k.pk) + (k.mio ? "*" : "")).join(" ") + "]"
      + (en ? " \u00b7 keys held: " : " \u00b7 chiavi in mio possesso: ") + l0.keys;
  }
  l += heal;
  try {
    const b = require("./bridge").summary();
    const r = require("./mesh/runtime");
    const n = r.bridgePeers ? r.bridgePeers().length : 0;
    if (b.sent || b.carried || n) l += "\n" + (en ? "Bridge: neighbours with internet " : "Ponte: vicini con internet ") + n
      + (en ? " \u00b7 sent through others " : " \u00b7 spediti tramite altri ") + b.sent
      + (en ? " \u00b7 carried for others " : " \u00b7 portati per altri ") + b.pushed
      + (b.held ? (en ? " \u00b7 held as courier " : " \u00b7 in custodia da corriere ") + b.held : "")
      + (b.later ? (en ? " \u00b7 delivered later " : " \u00b7 consegnati dopo ") + b.later : "");
  } catch { /* */ }
  try {
    const m = require("./maintenance").summary();
    if (m.at) l += "\n" + (en ? "Devices: " : "Dispositivi: ") + m.devices
      + (en ? " \u00b7 old ones removed: " : " \u00b7 vecchi rimossi: ") + m.pruned
      + (en ? " \u00b7 orphan keys cleared: " : " \u00b7 chiavi orfane ripulite: ") + m.orphans
      + (m.err ? (en ? " \u00b7 error: " : " \u00b7 errore: ") + m.err : "");
  } catch { /* */ }
  if (s.noKey) l += "\n" + (en
    ? "Diagnosis: the sender used a one-time key this phone no longer holds (reinstall, PIN change or expiry). Ask them to send a new message: it will renegotiate."
    : "Diagnosi: il mittente ha usato una chiave usa-e-getta che questo telefono non ha più (reinstallazione, cambio PIN o scadenza). Fatti riscrivere: la catena si rinegozia.");
  return l;
}

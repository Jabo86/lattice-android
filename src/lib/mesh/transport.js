// PONTE COL MOTORE MESH — posta in uscita / in arrivo su file.
// Il motore gira in un processo separato (MeshService.kt); i due processi condividono la
// sandbox dell'app, quindi si scambiano i pacchetti tramite due cartelle. I pacchetti sono
// cipolle già cifrate: su disco non c'è nulla di leggibile.
//
// v1.6.3: la cartella la dichiara il MOTORE NATIVO (MeshControl.meshDir). Prima si dava per
// buona la traduzione dei percorsi di expo-file-system: se non coincideva con `filesDir`, i
// due processi guardavano due cartelle diverse e non passava un solo pacchetto.
import * as FileSystem from "expo-file-system/legacy";
import { NativeModules } from "react-native";
import { PACKET_SIZE } from "./onion";

const Ctrl = NativeModules.MeshControl || null;
export function nativeAvailable() { return !!Ctrl; }

let P = null;
async function paths() {
  if (P) return P;
  let base = FileSystem.documentDirectory + "mesh/";
  if (Ctrl && Ctrl.meshDir) {
    try {
      const d = await Ctrl.meshDir();
      if (d && typeof d === "string") base = "file://" + d + "/";
    } catch { /* si resta sul percorso di expo */ }
  }
  P = { ROOT: base, OUT: base + "out/", IN: base + "in/", MODE: base + "mode", STAT: base + "stat.json" };
  return P;
}

async function ensure() {
  const p = await paths();
  for (const d of [p.ROOT, p.OUT, p.IN]) {
    try {
      const i = await FileSystem.getInfoAsync(d);
      if (!i.exists) await FileSystem.makeDirectoryAsync(d, { intermediates: true });
    } catch { /* si riprova al giro dopo */ }
  }
  return p;
}

function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return globalThis.btoa ? globalThis.btoa(s) : Buffer.from(bytes).toString("base64");
}
function fromBase64(b64) {
  if (globalThis.atob) {
    const s = globalThis.atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

// Scrittura ATOMICA: il motore nativo gira in un altro processo e legge la posta in uscita
// ogni 200 ms. Scrivendo direttamente il .bin poteva leggerlo a metà, scartarlo e cancellarlo
// (pacchetto perso senza traccia). Si scrive un .tmp e si rinomina: il motore prende solo i .bin.
async function atomic(name, bytes) {
  const tmp = name + ".tmp";
  await FileSystem.writeAsStringAsync(tmp, toBase64(bytes), { encoding: FileSystem.EncodingType.Base64 });
  await FileSystem.moveAsync({ from: tmp, to: name });
}

/// Comunica al motore nativo se la Modalità Nodo Sovrano è accesa E lo accende/spegne subito.
/// (Prima della v1.6.3 il motore partiva solo al riavvio dell'app: la prova della rete
/// avveniva quindi senza nessuna socket aperta.)
export async function writeMode(sovereign) {
  const p = await ensure();
  try { await FileSystem.writeAsStringAsync(p.MODE, sovereign ? "sovereign" : "standard"); } catch { /* niente */ }
  if (Ctrl) {
    try { if (sovereign) await Ctrl.start(); else await Ctrl.stop(); } catch { /* il motore riprova al rientro nell'app */ }
  }
}

/// Mette un pacchetto in partenza (il motore lo spedisce sulla rete locale).
export async function send(packet, next) {
  if (!(packet instanceof Uint8Array) || packet.length !== PACKET_SIZE) throw new Error("pacchetto non valido");
  const p = await ensure();
  // Il nome del file porta il salto successivo: il mezzo locale e' in broadcast, ma il
  // motore nativo della Fase 2 potra' consegnarlo direttamente a quel nodo.
  const hop = typeof next === "string" && /^[0-9a-f]{32}$/.test(next) ? next : "bcast";
  const name = p.OUT + Date.now() + "-" + Math.floor(Math.random() * 1e9) + "-" + hop + ".bin";
  await atomic(name, packet);
}

/// Ritira i pacchetti arrivati (e li rimuove dalla posta).
export async function receive(max = 16) {
  const p = await ensure();
  let names = [];
  try { names = await FileSystem.readDirectoryAsync(p.IN); } catch { return []; }
  const out = [];
  for (const n of names.slice(0, max)) {
    const f = p.IN + n;
    try {
      const b64 = await FileSystem.readAsStringAsync(f, { encoding: FileSystem.EncodingType.Base64 });
      const bytes = fromBase64(b64);
      if (bytes.length === PACKET_SIZE) out.push(bytes);
    } catch { /* pacchetto illeggibile */ }
    try { await FileSystem.deleteAsync(f, { idempotent: true }); } catch { /* niente */ }
  }
  return out;
}

/// PROVA DEL TRASPORTO: manda un pacchetto di diagnostica da 64 byte con un codice leggibile.
/// Non fa parte del protocollo anonimo: serve solo a farti VEDERE se i due telefoni si parlano.
/// I byte 20-27 li riempie il motore nativo con la propria firma, così l'eco dei propri
/// pacchetti non viene contata come "ricevuto dall'altro telefono".
export const PROBE_MAGIC = "LATMESHPROBE";
export async function sendProbe(code) {
  const p = await ensure();
  const b = new Uint8Array(64);
  const head = PROBE_MAGIC + String(code).slice(0, 8).padEnd(8, "0");
  for (let i = 0; i < head.length; i++) b[i] = head.charCodeAt(i);
  const name = p.OUT + Date.now() + "-" + Math.floor(Math.random() * 1e9) + "-probe.bin";
  await atomic(name, b);
}

/// Contatori anonimi del motore + diagnostica della PROPRIA rete (nessun indirizzo altrui).
export async function stats() {
  const empty = { seen: 0, at: 0, probes: 0, probeCode: "", probeAt: 0,
    loops: 0, tx: 0, txErr: 0, rx: 0, ip: "", targets: "", err: "", running: false, since: 0 };
  try {
    const p = await paths();
    const s = await FileSystem.readAsStringAsync(p.STAT);
    const o = JSON.parse(s);
    return { seen: Number(o.seen) || 0, at: Number(o.at) || 0,
      probes: Number(o.probes) || 0, probeCode: String(o.probeCode || ""), probeAt: Number(o.probeAt) || 0,
      loops: Number(o.loops) || 0, tx: Number(o.tx) || 0, txErr: Number(o.txErr) || 0, rx: Number(o.rx) || 0,
      ip: String(o.ip || ""), targets: String(o.targets || ""), err: String(o.err || ""),
      running: !!o.running, since: Number(o.since) || 0,
      p2p: String(o.p2p || "off"), p2pPeers: Number(o.p2pPeers) || 0, p2pFound: Number(o.p2pFound) || 0,
      p2pClients: Number(o.p2pClients) || 0, ble: String(o.ble || "off"),
      bleSeen: Number(o.bleSeen) || 0, bleAt: Number(o.bleAt) || 0, radioErr: String(o.radioErr || "") };
  } catch { return empty; }
}

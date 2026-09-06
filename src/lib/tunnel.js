// TUNNEL DARK MESH (XTLS-Reality) — lato app (JS), con MULTI-VESTITO.
// Costruisce la config del client Xray (ingresso SOCKS locale + uscita Reality) e comanda il
// modulo nativo. MULTI-VESTITO: se un "vestito" (dominio di copertura) è bloccato o instabile
// sulla rete dell'utente, l'app prova automaticamente gli altri finché uno funziona, provando
// una vera richiesta ATTRAVERSO il tunnel prima di dichiararlo buono. Spento di default.
//
// NOTA: publicKey e shortId di Reality NON sono segreti (la chiave privata resta sul server).
// Ordine dei vestiti: prima i più stabili (Apple, Cloudflare), microsoft come ultima risorsa.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeModules } from "react-native";
import { DEFAULT_SERVER } from "../config";

const KEY = "lat.darkmesh.v1";
const LAST = "lat.darkmesh.last"; // ultimo vestito che ha funzionato: si riprova per primo
const M = NativeModules.RealityTunnel;
const SOCKS_PORT = 10808;

const SERVER = "167.233.85.189";
const UUID = "0f75e5ec-2c99-4ba6-b9d7-c3dcd27333cc";
const PBK = "L-9cuAvkkYo7l3aB5RUZSdDDLY6iCXktrqne-itAc2o";
const SID = "f69fec0ed8358a2c";

// Ogni "vestito": porta dedicata sul server + dominio di copertura (SNI).
export const OUTFITS = [
  { id: "apple", port: 8444, sni: "www.apple.com" },
  { id: "cloudflare", port: 8445, sni: "www.cloudflare.com" },
  { id: "microsoft", port: 8443, sni: "www.microsoft.com" },
];

export function buildConfig(outfit) {
  return JSON.stringify({
    log: { loglevel: "warning" },
    inbounds: [
      { tag: "socks", listen: "127.0.0.1", port: SOCKS_PORT, protocol: "socks", settings: { udp: true } },
    ],
    outbounds: [
      {
        protocol: "vless", tag: "proxy",
        settings: { vnext: [{ address: SERVER, port: outfit.port, users: [{ id: UUID, encryption: "none", flow: "xtls-rprx-vision" }] }] },
        streamSettings: {
          network: "tcp", security: "reality",
          realitySettings: { serverName: outfit.sni, fingerprint: "chrome", publicKey: PBK, shortId: SID },
        },
      },
    ],
  });
}

export function available() { return !!M; }

export async function isEnabled() {
  try { return (await AsyncStorage.getItem(KEY)) === "1"; } catch { return false; }
}

// Prova una vera richiesta ATTRAVERSO il tunnel (il modulo è già attivo → OkHttp usa il SOCKS).
async function tunnelWorks(timeoutMs = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(DEFAULT_SERVER + "/api/health", { signal: ctrl.signal, headers: { "Cache-Control": "no-store" } });
    return r.ok;
  } catch { return false; } finally { clearTimeout(t); }
}

// Ordina i vestiti mettendo per primo l'ultimo che aveva funzionato.
async function ordered() {
  let last = null;
  try { last = await AsyncStorage.getItem(LAST); } catch { /* niente */ }
  if (!last) return OUTFITS;
  const first = OUTFITS.filter((o) => o.id === last);
  const rest = OUTFITS.filter((o) => o.id !== last);
  return first.concat(rest);
}

/// Avvia il tunnel provando i vestiti in ordine, con collaudo reale. Torna il vestito scelto.
export async function start() {
  if (!M) throw new Error("Modulo tunnel non disponibile in questa versione.");
  const list = await ordered();
  let lastErr = null;
  for (const o of list) {
    try {
      await M.stop().catch(() => {});
      await M.start(buildConfig(o));
      if (await tunnelWorks()) {
        try { await AsyncStorage.setItem(LAST, o.id); } catch { /* niente */ }
        return o.id;
      }
    } catch (e) { lastErr = e; }
  }
  await M.stop().catch(() => {});
  throw lastErr || new Error("Nessun vestito ha funzionato su questa rete.");
}

export async function stop() {
  if (M) { try { await M.stop(); } catch { /* niente */ } }
}

export async function setEnabled(v) {
  if (v) {
    const outfit = await start(); // accende PRIMA di ricordare la scelta: se fallisce, resti online
    await AsyncStorage.setItem(KEY, "1");
    return outfit;
  }
  await AsyncStorage.setItem(KEY, "0");
  await stop();
  return false;
}

/// All'avvio dell'app: se era acceso, riavvia il tunnel (in sottofondo, senza bloccare).
export async function boot() {
  try { if (M && (await isEnabled())) await start(); } catch { /* si potrà riaccendere a mano */ }
}

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { Platform, AppState } from "react-native";
import { parseKeyfile, deriveKemKeypair, deriveKem1024Keypair, deriveDhKeypair, bytesToHex } from "../lib/crypto";
import * as api from "../lib/api";
import * as msgCache from "../lib/msgCache";
import { saveKeyfile, loadKeyfile, clearStoredKeyfile, saveServer, loadServer, loadAppLock } from "../lib/store";
import { registerForPush, scheduleDailyQuizReminder, cancelDailyQuizReminder } from "../lib/notifications";
import * as guard from "../lib/guard";
import { isDeviceSecure } from "../lib/biometrics";
import * as lock from "../lib/lock";
import * as devices from "../lib/devices";

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

// Company on-premise servers may embed their URL in the issued keyfile.
function serverFromKeyfile(raw) {
  return raw?.server || raw?.server_url || raw?.node_url || raw?.api_url || raw?.homeserver || null;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // { lns, sk, pk, tenant_id, kem }
  const [booting, setBooting] = useState(true);
  const [locked, setLocked] = useState(false); // app-lock gate (biometric/PIN)
  const [mustRotate, setMustRotate] = useState(false); // primo accesso: cambio chiave obbligatorio
  const [pinGate, setPinGate] = useState(false); // PIN dell'app da inserire (dati locali cifrati)

  const unlock = useCallback(() => setLocked(false), []);
  const lockApp = useCallback(() => {
    if (!user) return;
    // TEMPRA (parità col web): bloccare l'app deve azzerare il token di sessione in RAM,
    // la chiave derivata dal PIN e i contenuti decifrati in cache. Così, prima di un
    // eventuale sblocco con il PIN di copertura, non resta viva in memoria nessuna sessione
    // vera — la si rideriva dal file chiave (esca o reale) solo dopo il PIN.
    try { api.clearAuth(); } catch { /* */ }
    try { lock.lockMemory(); } catch { /* */ }
    try { msgCache.clearAll(); } catch { /* */ }
    setLocked(true);
  }, [user]);

  // AZZERAMENTO REATTIVO: la sentinella dell'accelerometro vive solo mentre c'è una
  // sessione aperta (senza utente non c'è nulla da proteggere e il sensore resta spento,
  // così non consuma batteria). `guard.start` non fa nulla se l'opzione è disattivata.
  useEffect(() => {
    if (!user) { guard.stop(); return undefined; }
    guard.start(() => lockApp());
    return () => guard.stop();
  }, [user, lockApp]);

  const signIn = useCallback(async (rawKf, opts = {}) => {
    const { persist = true, server } = opts;
    const kf = parseKeyfile(rawKf);
    if (!kf) throw new Error("File chiave non valido o corrotto.");
    const target = serverFromKeyfile(rawKf) || server || api.getServerUrl();
    api.setServerUrl(target);
    await api.login({ lns: kf.lns, sk: kf.sk, pk: kf.pk });
    const kem = deriveKemKeypair(kf.sk);
    const kem1024 = deriveKem1024Keypair(kf.sk);
    const dh = deriveDhKeypair(kf.sk);
    try {
      const kg = require("../lib/keygen");
      const hs = kg.keysFor(kf.sk, await kg.currentGen());
      await api.publishKey(bytesToHex(kem.publicKey), bytesToHex(dh.publicKey),
        bytesToHex(hs.k5.publicKey), bytesToHex(hs.dh.publicKey));
      kg.rotateIfStale({ sk: kf.sk, kem, dh }).catch(() => {});
      // Promemoria del canarino: parte SOLO se questo account è l'owner del server.
      require("../lib/canary").remindOwner({ lns: kf.lns }, true).catch(() => {});
    } catch { /* idempotent */ }
    try {
      const t = await registerForPush();
      if (t) {
        await api.registerPushToken(t, Platform.OS);
        // NOTIFICHE ANONIME: lo stesso token viene registrato anche sulla cassetta, che
        // non è collegata all'identità: così i messaggi anonimi svegliano il telefono.
        try { const m = require("../lib/mailbox"); await m.registerPush(t, Platform.OS); } catch { /* modalità anonima spenta */ }
      }
    } catch { /* push optional */ }
    // Il promemoria quiz giornaliero riguarda SOLO il gruppo TUTTO OSS → solo profili @tuttooss.lns.
    if ((kf.lns || "").endsWith("@tuttooss.lns")) scheduleDailyQuizReminder().catch(() => {});
    else cancelDailyQuizReminder().catch(() => {});
    const u = { lns: kf.lns, sk: kf.sk, pk: kf.pk, tenant_id: kf.tenant_id, kem, kem1024, dh, server: api.getServerUrl() };
    setUser(u);
    // La cassetta anonima ha bisogno di sapere chi siamo per aprire le buste del ratchet.
    try { require("../lib/mailbox").setIdentity(u); } catch { /* modulo assente */ }
    setLocked(false); // fresh interactive login is already trusted
    // Primo accesso / cambio obbligatorio: come sul web, forza la generazione della chiave definitiva.
    try { const ctx = await api.meContext(kf.lns); setMustRotate(!!(ctx && ctx.must_rotate)); } catch { setMustRotate(false); }
    if (persist) { await saveKeyfile(rawKf); await saveServer(api.getServerUrl()); }
    // BLOCCO A: registra questo dispositivo e mantiene il lotto di chiavi usa-e-getta.
    devices.ensureDevice().catch(() => {});
    // RUBRICA CIECA: la rubrica passa sul telefono (cifrata) e al server restano solo i
    // gettoni di coppia. La prima volta si porta via quella che era sul server.
    try {
      api.setIdentity(u); // serve a decifrare il nome dei gruppi privati
      const book = require("../lib/book");
      book.setUser(u);
      // RICONCILIAZIONE AUTOMATICA: porta la rubrica sul telefono, rimette in chiaro sul
      // server gli indirizzi di chi non ha ancora i gettoni (senza questo non ci si può
      // scrivere) e pota solo quelli diventati superflui.
      book.reconcile(u).catch(() => {});
      // Nodo Sovrano: se è acceso, il motore mesh parte da solo (chat anche senza server).
      try { require("../lib/meshboot").boot(u); } catch { /* */ }
      // Manutenzione automatica: chiavi orfane sul server, vecchie installazioni,
      // chiavi statiche in cassaforte. Non blocca l'avvio e non chiede nulla.
      try { require("../lib/maintenance").run([]); } catch { /* */ }
    } catch { /* rubrica non disponibile */ }
    // Riallinea il token di autodistruzione se il PIN era già attivo.
    lock.panicToken().then((tok) => { if (tok) api.panicArm(tok).catch(() => {}); }).catch(() => {});
    return u;
  }, []);

  // Genera la chiave definitiva (rotazione) e la rende attiva. Restituisce { keyfile, keyfile_filename }.
  const rotateKey = useCallback(async () => {
    const r = await api.rotateKey();
    const rawKf = r.keyfile;
    const kf = parseKeyfile(rawKf);
    if (!kf) throw new Error("Nuova chiave non valida.");
    await api.login({ lns: kf.lns, sk: kf.sk, pk: kf.pk });
    const kem = deriveKemKeypair(kf.sk);
    const kem1024 = deriveKem1024Keypair(kf.sk);
    const dh = deriveDhKeypair(kf.sk);
    try { await api.publishKey(bytesToHex(kem.publicKey), bytesToHex(dh.publicKey), bytesToHex(kem1024.publicKey)); } catch { /* idempotent */ }
    await saveKeyfile(rawKf); // persiste la NUOVA chiave
    const u2 = { lns: kf.lns, sk: kf.sk, pk: kf.pk, tenant_id: kf.tenant_id, kem, kem1024, dh, server: api.getServerUrl() };
    setUser((prev) => ({ ...(prev || {}), ...u2 }));
    try { require("../lib/mailbox").setIdentity(u2); } catch { /* modulo assente */ }
    try {
      api.setIdentity(u2);
      const book = require("../lib/book");
      book.setUser(u2);
      book.reconcile(u2).catch(() => {});
      // Nodo Sovrano: se è acceso, il motore mesh parte da solo (chat anche senza server).
      try { require("../lib/meshboot").boot(u2); } catch { /* */ }
      // Manutenzione automatica: chiavi orfane sul server, vecchie installazioni,
      // chiavi statiche in cassaforte. Non blocca l'avvio e non chiede nulla.
      try { require("../lib/maintenance").run([]); } catch { /* */ }
    } catch { /* rubrica non disponibile */ }
    return r; // NB: mustRotate resta true finché l'utente non conferma di aver salvato la chiave
  }, []);
  const finishRotation = useCallback(() => setMustRotate(false), []);

  // AUTODISTRUZIONE: cancella l'account sul server e rade al suolo i dati locali.
  const wipeNow = useCallback(async () => {
    try { const mbx = require("../lib/mailbox"); await mbx.close(); } catch { /* nessuna cassetta */ }
    try { await lock.selfDestruct((tok) => api.panicWipe(tok)); } catch { /* best effort */ }
    api.clearAuth();
    msgCache.clearAll(); // le decifrature in memoria non sopravvivono all uscita
    try { require("../lib/book").setUser(null); } catch { /* */ }
    try { require("../lib/mailbox").setIdentity(null); } catch { /* */ }
    try { api.setIdentity(null); require("../lib/gname").clear(); } catch { /* */ }
    lock.clearPlainCache().catch(() => {}); // via le foto e i file decifrati dalla cache
    setUser(null);
    setPinGate(false);
    setLocked(false);
  }, []);

  // Sblocco col PIN dell'app: decifra il file chiave e apre la sessione.
  const unlockWithPin = useCallback(async (pin) => {
    const r = await lock.unlockWithPin(pin);
    if (r.status === "panic") { await wipeNow(); return { status: "panic" }; }
    if (r.status === "wrong") {
      if (r.left <= 0) { await wipeNow(); return { status: "wiped" }; }
      return r;
    }
    if (r.status === "decoy") {
      // PROFILO ESCA. Da qui l'app e' identica in tutto: nessun segno, nessun contatore,
      // nessuna scorciatoia per rientrare nel profilo vero. Se l'esca non ha ancora un
      // account, si apre la schermata di accesso normale — che e' esattamente cio' che
      // vedrebbe chi ha appena installato Lattice.
      const srvD = await loadServer();
      if (srvD) api.setServerUrl(srvD);
      if (r.keyfile) await signIn(r.keyfile, { persist: false });
      setPinGate(false);
      setLocked(false);
      return { status: "ok" };
    }
    if (!r.keyfile) throw new Error("Nessun file chiave salvato su questo telefono.");
    const srv = await loadServer();
    if (srv) api.setServerUrl(srv);
    await signIn(r.keyfile, { persist: false });
    setPinGate(false);
    setLocked(false);
    return { status: "ok" };
  }, [signIn, wipeNow]);

  const signOut = useCallback(async () => {
    try { await api.logout(); } catch { /* best-effort: revoca lato server */ }
    await clearStoredKeyfile();
    api.clearAuth();
    msgCache.clearAll(); // le decifrature in memoria non sopravvivono all uscita
    try { require("../lib/book").setUser(null); } catch { /* */ }
    try { require("../lib/mailbox").setIdentity(null); } catch { /* */ }
    try { api.setIdentity(null); require("../lib/gname").clear(); } catch { /* */ }
    lock.clearPlainCache().catch(() => {}); // via le foto e i file decifrati dalla cache
    setUser(null);
    setLocked(false);
    setMustRotate(false);
  }, []);

  // Cassette anonime: ritiro dei depositi all'avvio, ad ogni rientro nell'app (anche
  // quando arriva la notifica generica) e comunque una volta al minuto.
  useEffect(() => {
    if (!user) return;
    const run = () => {
      try { const m = require("../lib/mailbox"); m.pickup().catch(() => {}); } catch { /* */ }
    };
    run();
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") run(); });
    const t = setInterval(() => { if (AppState.currentState === "active") run(); }, 60000);
    return () => { try { sub.remove(); } catch { /* */ } clearInterval(t); };
  }, [user]);

  // Le chiavi usa-e-getta si consumano: si ricontrolla il lotto ogni 15 minuti.
  useEffect(() => {
    if (!user) return;
    const t = setInterval(() => { devices.ensureDevice().catch(() => {}); }, 15 * 60 * 1000);
    return () => clearInterval(t);
  }, [user]);

  useEffect(() => {
    (async () => {
      try {
        const srv = await loadServer();
        if (srv) api.setServerUrl(srv);
        if (await lock.hasPin()) { setPinGate(true); setBooting(false); return; }
        const kf = await loadKeyfile();
        if (kf) {
          await signIn(kf, { persist: false });
          // A persisted session must be unlocked with biometric/PIN if the device
          // supports it AND the user has not disabled the app lock in Settings.
          const pref = await loadAppLock();
          if ((await isDeviceSecure()) && pref !== false) setLocked(true);
        }
      } catch { /* stale/invalid key — show login */ }
      setBooting(false);
    })();
  }, [signIn]);

  // Oggetto stabile: prima cambiava identità a ogni render del provider e faceva
  // ridisegnare TUTTE le schermate che leggono il contesto (chat compresa).
  const value = useMemo(
    () => ({ user, booting, locked, mustRotate, pinGate, signIn, signOut, unlock, lock: lockApp, rotateKey, finishRotation, unlockWithPin, wipeNow }),
    [user, booting, locked, mustRotate, pinGate, signIn, signOut, unlock, lockApp, rotateKey, finishRotation, unlockWithPin, wipeNow]
  );
  return (
    <Ctx.Provider value={value}>
      {children}
    </Ctx.Provider>
  );
}

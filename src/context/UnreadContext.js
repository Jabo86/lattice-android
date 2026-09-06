import React, { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo } from "react";
import { AppState } from "react-native";
import { useAuth } from "./AuthContext";
import * as api from "../lib/api";

const UnreadCtx = createContext({ chatUnread: 0, certifyUnread: 0, expiringLicenses: 0, bookRequests: 0, refresh: () => {} });

const OWNER_LNS = "fabioastorino@latticenetwork.lns";

export function UnreadProvider({ children }) {
  const { user } = useAuth();
  const [chatUnread, setChatUnread] = useState(0);
  const [certifyUnread, setCertifyUnread] = useState(0);
  const [expiringLicenses, setExpiringLicenses] = useState(0);
  const [bookRequests, setBookRequests] = useState(0);
  const busy = useRef(false);
  const fast = useRef(false);

  // GIRO VELOCE: solo i due numeri che cambiano quando arriva un messaggio, in una sola
  // interrogazione. È questo che fa comparire il pallino entro un secondo.
  const tick = useCallback(async () => {
    if (!user || fast.current) return;
    fast.current = true;
    try {
      const b = await api.badges();
      // I gruppi stanno dentro Pulse: il pallino li comprende, altrimenti racconta metà
      // della storia.
      setChatUnread((Number(b?.chat) || 0) + (Number(b?.groups) || 0));
      setCertifyUnread(Number(b?.certify) || 0);
    } catch {}
    fast.current = false;
  }, [user]);

  const refresh = useCallback(async () => {
    if (!user || busy.current) return;
    busy.current = true;
    await tick();
    // Richieste di contatto in arrivo → pallino sul tab Rubrica.
    try {
      const cs = await api.contactsRaw();
      setBookRequests((Array.isArray(cs) ? cs : []).filter((c) => c.they_have_me && c.in_my_book === false && !c.blocked).length);
    } catch {}
    // Licenze in scadenza/scadute (solo owner) → pallino sul tab Impostazioni.
    if (user?.lns === OWNER_LNS) {
      try {
        const ts = await api.consoleTenants();
        setExpiringLicenses((Array.isArray(ts) ? ts : []).filter((t) => {
          const trial = t.is_trial === true || t.status === "trial";
          const perpetual = !trial && (t.perpetual === true || t.billing === "perpetual" || !t.expires_at);
          return !perpetual && t.days_left != null && t.days_left <= 7;
        }).length);
      } catch {}
    } else {
      setExpiringLicenses(0);
    }
    busy.current = false;
  }, [user, tick]);

  useEffect(() => {
    if (!user) { setChatUnread(0); setCertifyUnread(0); setExpiringLicenses(0); setBookRequests(0); return; }
    refresh();
    const fastId = setInterval(() => { if (AppState.currentState === "active") tick(); }, 1500);
    const slowId = setInterval(() => { if (AppState.currentState === "active") refresh(); }, 30000);
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") refresh(); });
    return () => { clearInterval(fastId); clearInterval(slowId); sub.remove(); };
  }, [user, refresh, tick]);

  return (
    <UnreadCtx.Provider value={useMemo(() => ({ chatUnread, certifyUnread, expiringLicenses, bookRequests, refresh }), [chatUnread, certifyUnread, expiringLicenses, bookRequests, refresh])}>
      {children}
    </UnreadCtx.Provider>
  );
}

export const useUnread = () => useContext(UnreadCtx);

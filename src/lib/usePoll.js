// Timer che lavorano SOLO quando serve.
// Prima l'app teneva sette cicli attivi anche in secondo piano o su schermate non visibili:
// rete, CPU e batteria sempre impegnate, e la parte visibile che arrancava. Qui non si
// rinuncia a niente: si smette solo di lavorare a vuoto.
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useIsFocused } from "@react-navigation/native";

function useTimer(fn, ms, { runOnFocus, active, needFocus, focused }) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!active) return;
    if (needFocus && !focused) return;
    let alive = true;
    const tick = () => { if (alive && AppState.currentState === "active") fnRef.current(); };
    if (runOnFocus) tick();
    const id = setInterval(tick, ms);
    // Al rientro nell'app si aggiorna subito, senza aspettare il giro successivo.
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") tick(); });
    return () => { alive = false; clearInterval(id); try { sub.remove(); } catch (e) { /* */ } };
  }, [ms, active, needFocus, focused, runOnFocus]);
}

/// Gira solo se l'app è in primo piano E questa schermata è quella visibile.
export function usePoll(fn, ms, { runOnFocus = true, active = true } = {}) {
  const focused = useIsFocused();
  useTimer(fn, ms, { runOnFocus, active, needFocus: true, focused });
}

/// Gira se l'app è in primo piano, anche da schermate diverse (serve alle chiamate in
/// arrivo: devono essere scoperte anche mentre stai leggendo una chat).
export function useActivePoll(fn, ms, { active = true } = {}) {
  useTimer(fn, ms, { runOnFocus: false, active, needFocus: false, focused: true });
}

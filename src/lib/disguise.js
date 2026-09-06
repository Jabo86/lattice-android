// ASPETTO DISCRETO (v1.5.0) — icona e nome dell'app nella home del telefono
//
// Chi ha il telefono controllato (partner violento, dogana, datore di lavoro, polizia di un
// Paese ostile) viene tradito dalla sola PRESENZA di un'app di messaggistica cifrata: il
// contenuto è al sicuro, l'esistenza no.
//
// Con questa opzione l'utente scegli quale icona e quale nome il telefono mostra nella home:
// Lattice può apparire come una calcolatrice, un blocco note, il meteo o un orologio.
// Tecnicamente si accende un `activity-alias` diverso nel manifest e si spengono gli altri
// (PackageManager.setComponentEnabledSetting): è l'unico modo previsto da Android, non è un
// trucco che le prossime versioni possono rompere.
//
// Nota onesta, mostrata anche in Impostazioni: il nome vero resta visibile in
// Impostazioni Android → App. Questo travestimento serve contro uno sguardo alla home, non
// contro un'analisi forense del telefono.
import { requireOptionalNativeModule } from "expo-modules-core";

// `requireOptionalNativeModule` non lancia se il modulo nativo non c'è: le versioni web e
// gli APK costruiti senza il modulo continuano a funzionare come prima.
const native = requireOptionalNativeModule("AppDisguise");

export const AVAILABLE = !!native;

export const OPTIONS = [
  { key: "default", it: "Lattice (icona vera)", en: "Lattice (real icon)", icon: "shield-checkmark-outline" },
  { key: "calc", it: "Calcolatrice", en: "Calculator", icon: "calculator-outline" },
  { key: "notes", it: "Note", en: "Notes", icon: "document-text-outline" },
  { key: "weather", it: "Meteo", en: "Weather", icon: "partly-sunny-outline" },
  { key: "clock", it: "Orologio", en: "Clock", icon: "time-outline" },
];

export function labelOf(key, en) {
  const o = OPTIONS.find((x) => x.key === key) || OPTIONS[0];
  return en ? o.en : o.it;
}

/// Travestimento attivo adesso ("default" se nessuno).
export function current() {
  try { return (native && native.current()) || "default"; } catch (e) { return "default"; }
}

/// Applica il travestimento. Ritorna false se il modulo nativo non è disponibile.
export async function apply(key) {
  if (!native) return false;
  const k = OPTIONS.some((o) => o.key === key) ? key : "default";
  await native.apply(k);
  return true;
}

// Lingue dell'interfaccia — v2.3.1. Dodici lingue, tradotte a mano, nessuna chiamata di rete.
import fr from "./fr";
import de from "./de";
import es from "./es";
import ru from "./ru";
import ar from "./ar";
import zh from "./zh";
import pt from "./pt";
import ja from "./ja";
import tr from "./tr";
import hi from "./hi";
export { NEW_KEYS } from "./new_v230";
export { NEW_KEYS_231, CHAT_MAP_KEYS } from "./new_v231";
export { CANARY_KEYS } from "./canary_keys";
export { FULL_V250 } from "./full_v250";
export { CHAT12_280 } from "./chat12_v280";

export const EXTRA_LOCALES = { fr, de, es, ru, ar, zh, pt, ja, tr, hi };

// Ordine: italiano primo (casa), poi per numero di persone che le parlano.
export const UI_LANGS = [
  { code: "it", native: "Italiano", english: "Italian", flag: "🇮🇹", rtl: false },
  { code: "en", native: "English", english: "English", flag: "🇬🇧", rtl: false },
  { code: "zh", native: "简体中文", english: "Chinese (Simplified)", flag: "🇨🇳", rtl: false },
  { code: "hi", native: "हिन्दी", english: "Hindi", flag: "🇮🇳", rtl: false },
  { code: "es", native: "Español", english: "Spanish", flag: "🇪🇸", rtl: false },
  { code: "pt", native: "Português (Brasil)", english: "Portuguese (Brazil)", flag: "🇧🇷", rtl: false },
  { code: "ar", native: "العربية", english: "Arabic", flag: "🇸🇦", rtl: true },
  { code: "fr", native: "Français", english: "French", flag: "🇫🇷", rtl: false },
  { code: "ru", native: "Русский", english: "Russian", flag: "🇷🇺", rtl: false },
  { code: "de", native: "Deutsch", english: "German", flag: "🇩🇪", rtl: false },
  { code: "ja", native: "日本語", english: "Japanese", flag: "🇯🇵", rtl: false },
  { code: "tr", native: "Türkçe", english: "Turkish", flag: "🇹🇷", rtl: false },
];

export const UI_LANG_CODES = UI_LANGS.map((l) => l.code);
export const isRTLLang = (code) => !!(UI_LANGS.find((l) => l.code === code) || {}).rtl;

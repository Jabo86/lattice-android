// Rilevazione lingua 100% offline (nessuna rete → privacy totale).
// Euristica: prima lo script Unicode, poi le stopword per le lingue a scrittura latina.
const SCRIPT = [
  [/[\u0600-\u06FF]/, "ar"],
  [/[\u0590-\u05FF]/, "he"],
  [/[\u0370-\u03FF]/, "el"],
  [/[\u3040-\u30FF]/, "ja"], // kana → giapponese
  [/[\uAC00-\uD7AF]/, "ko"],
  [/[\u0E00-\u0E7F]/, "th"],
  [/[\u0900-\u097F]/, "hi"],
  [/[\u0400-\u04FF]/, "ru"],
  [/[\u4E00-\u9FFF]/, "zh"], // Han senza kana → cinese
];

const STOP = {
  en: ["the", "and", "is", "are", "you", "this", "that", "with", "for", "have", "not", "your", "from", "will", "can", "what", "hello", "please", "thanks"],
  it: ["che", "non", "per", "con", "una", "sono", "questo", "come", "anche", "più", "gli", "alla", "dei", "ciao", "grazie", "buongiorno", "siamo", "perché", "della"],
  es: ["que", "los", "las", "por", "con", "una", "para", "como", "pero", "este", "muy", "hola", "gracias", "buenos", "estamos", "porque", "también", "cómo"],
  fr: ["les", "des", "une", "est", "que", "pour", "avec", "pas", "vous", "nous", "cette", "bonjour", "merci", "aussi", "parce", "être", "dans"],
  de: ["und", "der", "die", "das", "ist", "nicht", "mit", "für", "auch", "ein", "eine", "sich", "wir", "hallo", "danke", "weil", "sind", "haben"],
  pt: ["que", "não", "com", "uma", "para", "como", "mais", "você", "este", "obrigado", "olá", "porque", "também", "estamos", "muito"],
  nl: ["het", "een", "van", "niet", "met", "voor", "dat", "zijn", "ook", "hallo", "bedankt", "omdat", "wij", "deze"],
};

export function detectLang(text) {
  if (!text) return null;
  const t = String(text);
  for (const [re, code] of SCRIPT) if (re.test(t)) return code;
  const words = t.toLowerCase().replace(/[^a-zàáâäèéêëìíîïòóôöùúûüçñ\s]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  let best = null, bestN = 0;
  for (const code of Object.keys(STOP)) {
    let n = 0;
    for (const w of words) if (STOP[code].includes(w)) n++;
    if (n > bestN) { bestN = n; best = code; }
  }
  return bestN >= 1 ? best : null;
}

const FLAG = { it: "🇮🇹", en: "🇬🇧", es: "🇪🇸", fr: "🇫🇷", de: "🇩🇪", pt: "🇵🇹", nl: "🇳🇱", ru: "🇷🇺", ar: "🇸🇦", he: "🇮🇱", el: "🇬🇷", zh: "🇨🇳", ja: "🇯🇵", ko: "🇰🇷", hi: "🇮🇳", th: "🇹🇭", tr: "🇹🇷", pl: "🇵🇱", uk: "🇺🇦" };
export function langFlag(code) { return FLAG[(code || "").toLowerCase()] || "🌐"; }

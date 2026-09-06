// v2.8.0 — «Oggi» e «Ieri» dei divisori di giornata in chat, nelle dodici lingue.
// Stessa forma compatta del pacchetto web (`src/i18n/mlocales/chat12.js`): una riga per
// chiave, dodici valori in ordine fisso.
const L = ["it", "en", "zh", "hi", "es", "pt", "ar", "fr", "ru", "de", "ja", "tr"];

const K = {
  "chat.today": ["Oggi", "Today", "今天", "आज", "Hoy", "Hoje", "اليوم", "Aujourd'hui", "Сегодня", "Heute", "今日", "Bugün"],
  "chat.yesterday": ["Ieri", "Yesterday", "昨天", "कल", "Ayer", "Ontem", "أمس", "Hier", "Вчера", "Gestern", "昨日", "Dün"],
};

export const CHAT12_280 = (() => {
  const out = {};
  for (let i = 0; i < L.length; i++) {
    const pack = {};
    for (const key of Object.keys(K)) pack[key] = K[key][i] || K[key][0];
    out[L[i]] = pack;
  }
  return out;
})();

// TEMA v2.3.1 — due colori, e basta.
//
//   Nero pieno   #000000   il fondo. Non «quasi nero»: nero. Sugli schermi OLED i pixel
//                          sono spenti, quindi il fondo non è un colore, è assenza.
//   Smeraldo     #50C878   l'unico accento. Tutto ciò che è vivo, sicuro o toccabile.
//
// Il resto sono grigi neutri per la tipografia. Nessun secondo accento, nessun rosso
// d'allarme: un allarme che è solo un colore lo si può fraintendere, e chi non distingue
// il rosso non lo vede. Gli allarmi qui sono blocchi invertiti (smeraldo pieno, testo nero)
// e una parola scritta.
export const theme = {
  bg: "#000000",
  surface: "#0A0A0A",
  surfaceAlt: "#121212",
  border: "#1C1C1C",
  text: "#F2F4F3",
  textDim: "#8B928E",
  textFaint: "#565C59",
  primary: "#50C878",
  primaryDeep: "#1E5637",
  accent: "#50C878",
  danger: "#F2F4F3",
  bubbleMe: "#50C878",
  bubbleThem: "#101211",
};

// Avatar: un solo colore, in nove passi di luminosità. Le persone si distinguono per
// nome e forma, non per una tavolozza da parco giochi.
const STEPS = ["#50C878", "#3FA862", "#69D48C", "#2E8A4E", "#86DFA3", "#247A42", "#A0E9B8", "#1E6837", "#BAF2CC"];
export function avatarColor(seed) {
  let h = 0;
  for (let i = 0; i < (seed || "").length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return STEPS[h % STEPS.length];
}

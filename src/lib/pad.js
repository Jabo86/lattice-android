// Riempitivo di lunghezza casuale (padding) aggiunto a OGNI richiesta.
// Chi osserva la rete non vede il contenuto (già cifrato) ma vede la DIMENSIONE di ogni
// pacchetto: un "ok" corto e un messaggio lungo hanno stazze diverse, e da lì si intuisce
// cosa stai facendo. Aggiungendo a ogni richiesta un'intestazione `X-Pad` di lunghezza
// casuale, tutte le richieste — quelle vere e quelle di rumore — diventano di stazza
// variabile e indistinguibile. Il server ignora e non memorizza questa intestazione.
const CS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function randPad(rand = Math.random) {
  const n = 24 + Math.floor(rand() * 1200); // 24…1224 byte
  let s = "";
  for (let i = 0; i < n; i++) s += CS[Math.floor(rand() * CS.length) & 63];
  return s;
}

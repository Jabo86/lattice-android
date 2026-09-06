// Decifrature già fatte, tenute SOLO in memoria.
// Non finisce nulla di nuovo sul disco: nessun testo in chiaro aggiunto al telefono.
// Sopravvive all'uscita e al rientro nella chat (prima si ripartiva da zero ogni volta,
// ri-decifrando tutta la conversazione), non sopravvive alla chiusura dell'app né al blocco.
const store = new Map(); // conv_id -> Map(message_id -> voce)
const MAX_CONVS = 12;

export function get(cid, id) {
  const m = store.get(cid);
  return m ? m.get(id) : undefined;
}

export function put(cid, id, entry) {
  let m = store.get(cid);
  if (!m) {
    m = new Map();
    store.set(cid, m);
    if (store.size > MAX_CONVS) store.delete(store.keys().next().value);
  }
  m.set(id, entry);
}

export function clearAll() {
  store.clear();
}

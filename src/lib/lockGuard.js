// Guardia anti-riblocco: quando l'app apre una UI di sistema che la manda in background
// per un istante (galleria, fotocamera, microfono, popup permessi, chiamata in arrivo),
// sopprime il ri-blocco col PIN al ritorno in foreground. Evita il loop del PIN.
let suppressUntil = 0;

export const suppressLock = (ms = 120000) => { suppressUntil = Date.now() + ms; };
export const clearLockSuppress = () => { suppressUntil = 0; };
export const isLockSuppressed = () => Date.now() < suppressUntil;

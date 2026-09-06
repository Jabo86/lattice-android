# Checklist pre-push — client Android

Da eseguire **prima del primo push** e prima di ogni push successivo. Il controllo
automatico è `bash prepush_check.sh`: se stampa una riga `BLOCCO`, non si pubblica.

## A · Prima di creare il repository (una volta sola)

- [ ] **Non fare `git init` nella cartella di lavoro.** Si pubblica un **export pulito**:
      `bash esporta_pubblico.sh`. Motivo: la cartella di lavoro contiene chiavi di firma e
      centinaia di file `.bak-*`, e una volta entrati nella cronologia git non spariscono
      con una cancellazione.
- [ ] Repository su GitHub creato **vuoto** (senza README, senza licenza generata da
      GitHub: i file li porta l'export).
- [ ] Repository **privato** al primo push, reso pubblico solo dopo i controlli B e C.
- [ ] `LICENSE`, `README.md`, `TRADEMARK.md`, `DISCLAIMER.md`, `SECURITY.md`, `NOTICE`,
      `.gitignore` presenti nella radice.

## B · Segreti — il controllo che conta

- [ ] `*.keystore`, `*.jks`, `*.p12`, `*.pem`, `*.key` → **nessun file** nell'export
- [ ] `android/keystore.properties`, `key.properties`, `signing.properties` → assenti
- [ ] `android/local.properties` (percorsi SDK della tua macchina) → assente
- [ ] `google-services.json` e `*service-account*.json` (Firebase/FCM) → assenti
- [ ] `.env`, `.env.*` → assenti (solo `.env.example` con valori finti, se serve)
- [ ] `keyfile*.json` (file chiave di account Lattice) → assenti
- [ ] Nessuna password, token, `JWT_SECRET`, chiave VAPID, URI `mongodb://`,
      indirizzo IP del server o utenza SSH **scritti nel codice**
- [ ] `android/app/build.gradle`: la configurazione di firma legge da
      `keystore.properties` **esterno**, non contiene alias e password in chiaro
- [ ] Nessun endpoint interno di amministrazione o chiave di sviluppo (`lat.dev.key`)

## C · Contenuti e coerenza

- [ ] Solo il **client Android**: nessun file del backend, dei nodi o dell'infrastruttura
- [ ] Nessun file `.bak-*` (l'export li rimuove: sono vecchie versioni del tuo codice)
- [ ] Nessun file oltre 5 MB (font, immagini, binari: se serve, dichiaralo)
- [ ] `versionName`/`versionCode` in `android/app/build.gradle` coerenti con la versione
      pubblicata su `/downloads`
- [ ] Il README dichiara: licenza, marchio, manleva, come verificare la build
- [ ] Nessun dato personale nei commenti (nomi, numeri, indirizzi email di utenti reali)

## D · Configurazione di GitHub (dopo il push)

- [ ] **Branch protection** su `main`: push diretti bloccati, force-push disabilitato
- [ ] **Pull request disabilitate** o richiesta chiusa automaticamente (il README dichiara
      che non vengono accettate) — in alternativa `Settings → Interaction limits`
- [ ] **Issue attive** (servono per le segnalazioni) con template di sicurezza che rimanda
      a `SECURITY.md`
- [ ] **Wiki e Projects disattivati** (superficie inutile)
- [ ] **Secret scanning** e **push protection** attivi (`Settings → Code security`)
- [ ] Nessun *deploy key* né *Actions secret* nel repository pubblico
- [ ] Descrizione e sito: `https://lattice-network.it` · argomenti (topics):
      `android`, `end-to-end-encryption`, `post-quantum`, `privacy`, `reproducible-builds`
- [ ] Tag della release che corrisponde alla versione dell'APK pubblicato

## E · Se un segreto è finito online (procedura d'emergenza)

1. **Considerarlo compromesso**: non basta cancellarlo, è già stato indicizzato e clonato.
2. **Ruotare subito**: nuova chiave di firma non è possibile per un'app già pubblicata su
   store → per la distribuzione diretta (APK dal sito) si genera una **nuova chiave** e si
   annuncia il cambio di impronta sul sito e nel canarino di trasparenza.
3. `google-services.json` / service account: **revocare** le credenziali dalla console
   Firebase/Google e generarne di nuove.
4. Riscrivere la cronologia (`git filter-repo`) **e** cancellare i fork, i mirror e la cache
   di GitHub (serve una richiesta al supporto): sono passaggi separati.
5. Annotare l'accaduto nel registro pubblico: nascondere un incidente su un progetto di
   sicurezza costa più dell'incidente.

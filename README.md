# Lattice — client Android

Client Android di **Lattice Network**: messaggistica cifrata end-to-end con crittografia
post-quantistica (ML-KEM-768 + ML-DSA-65, FIPS 203/204), chiavi che non lasciano il
dispositivo, mesh locale senza internet, doppio PIN con negazione plausibile.

Sito ufficiale: **https://lattice-network.it** · APK firmato:
**https://lattice-network.it/downloads**

Questo repository esiste per **un solo motivo**: permettere a chiunque di leggere il codice
che gira sul proprio telefono e di **ricompilarlo per verificare che corrisponda all'APK
pubblicato**. La sicurezza che si deve credere sulla parola non è sicurezza.

---

## Com'è fatta la rete (e perché qui GitHub scrive "JavaScript")

La barra dei linguaggi descrive **questo repository**, che contiene **solo il client
Android**: interfaccia in React Native (JavaScript) e moduli nativi in Kotlin. Il resto della
rete non è in JavaScript, e la percentuale da sola lo farebbe credere.

| Parte | Linguaggio | Dov'è |
|---|---|---|
| Client Android (interfaccia, crittografia lato dispositivo) | JavaScript / React Native + **Kotlin** | **questo repository** |
| Backend, nodi, consenso, ledger, federazione | **Rust** (~20.000 righe, 49 moduli, Axum) | non pubblicato — si installa come immagine firmata, verificata per digest |
| Validatori QBFT (10 nodi, quorum 7, firme ML-DSA-65) | **Rust** | non pubblicato |
| Tunnel di resistenza alla censura (XTLS-Reality) | **Go** (libXray, compilato con gomobile) | `third_party/libxray` |
| Sito e console | JavaScript / React | non pubblicato |

Il Rust è la parte che **non deve essere clonata**: è il motivo per cui il nodo si distribuisce
come immagine firmata e non come sorgente (<https://lattice-network.it/guida-nodo>). Non
essendo pubblicato, resta però verificabile nei suoi punti che contano:

- la matematica del consenso è **dimostrata e ricontrollata a macchina**:
  <https://lattice-network.it/prova-qbft>
- ogni blocco porta 7 firme ML-DSA-65 di 10 validatori distinti, e chiunque può leggerle:
  <https://lattice-network.it/api/qbft/status> · <https://lattice-network.it/explorer>
- gli audit e i difetti trovati sono pubblici, compresi i nostri:
  <https://lattice-network.it/audit/red-team>

La crittografia che protegge i tuoi messaggi gira **sul dispositivo**, quindi sta in questo
repository: ML-KEM-768 e ML-DSA-65 (`@noble/post-quantum`), il ratchet, la derivazione del PIN,
il doppio fondo. Il server, in Rust, non vede i contenuti: è la ragione per cui il codice che
conta per la tua riservatezza è proprio quello che puoi leggere qui.

---

## Licenza in tre righe

Il codice è **aperto e verificabile, non open source** — e lo scriviamo con precisione
perché la differenza conta.

- **Puoi**: leggerlo, studiarlo, sottoporlo ad audit, usarlo, modificarlo per te o per la
  tua organizzazione e **compilarlo per verificare la build riproducibile**.
- **Non puoi**: ridistribuire l'app (modificata o no), offrire un servizio basato su questo
  codice, o venderlo. Per questo serve una licenza commerciale: **legal@lattice-network.it**
- **Dal 6 settembre 2030** ogni versione diventa automaticamente **GPL-3.0-or-later**.

Licenza: **Business Source License 1.1** — testo integrale in [`LICENSE`](LICENSE).

---

## Verificare la build riproducibile

L'APK pubblicato deve corrispondere, byte per byte nei contenuti, a quello che compili tu.
La procedura completa e i risultati delle verifiche indipendenti sono su
<https://lattice-network.it/install> e in `/downloads`:

```bash
# impronta dell'APK pubblicato
curl -s https://lattice-network.it/downloads/latest.json

# strumenti di verifica pubblicati (leggibili, non minificati)
curl -s https://lattice-network.it/downloads/repro-build.sh
curl -s https://lattice-network.it/downloads/verify-apk.sh
curl -s https://lattice-network.it/downloads/apkrepro.py

# elenco delle voci confrontate, versione per versione
curl -s https://lattice-network.it/downloads/repro-latest.json | head
```

Se una verifica **non** torna, non è un dettaglio: apri una issue e scrivi a
`security@lattice-network.it`.

---

## Marchio: il nome non è nella licenza

**La licenza sul codice non concede alcun diritto sul nome, sul logo o sull'identità visiva
di Lattice.**

Sono riservati, e il loro uso in versioni fork o modificate è **espressamente vietato**:

- i nomi **Lattice**, **Lattice Network**, **Lattice Pulse**, **Nodo Sovrano**, **LNS**;
- il **logo**, il simbolo esagonale e l'**identità visiva** (palette, tipografia, icone,
  schermate di avvio, animazioni caratteristiche);
- il dominio **lattice-network.it**, ogni sottodominio o nome confondibile, e gli indirizzi
  `@lattice.lns` / `@latticenetwork.lns`.

Chi è autorizzato a distribuire una versione derivata **deve prima rinominarla
completamente** (`applicationId`, `app.json`, icone, testi, servizi, endpoint) e dichiarare
in modo visibile: *"versione indipendente, non affiliata a né approvata da Lattice o Fabio
Astorino"*. Puoi citare Lattice per parlarne — non per firmarti Lattice.

Condizioni complete e richieste di autorizzazione: [`TRADEMARK.md`](TRADEMARK.md) ·
**trademark@lattice-network.it**

---

## Nessuna garanzia, nessuna responsabilità

Il software è fornito **"COSÌ COM'È"**, senza garanzia di alcun tipo. Il titolare non
risponde di malfunzionamenti, **perdita di dati** (compresa la perdita **irreversibile**
dovuta allo smarrimento del file chiave, del PIN o del dispositivo), interruzioni del
servizio o della rete, mancata consegna di messaggi, né dell'uso improprio o illecito da
parte di utenti o terzi. Non è software per contesti critici e **non sostituisce i numeri di
emergenza**.

Testo legale integrale: [`DISCLAIMER.md`](DISCLAIMER.md).

---

## Contributi

Questo repository è pubblicato **in sola lettura**: le *pull request* non vengono accettate,
perché la titolarità del codice deve restare integra per poterlo licenziare.

- **Bug e vulnerabilità**: apri una issue o, per le vulnerabilità,
  [`SECURITY.md`](SECURITY.md) (`security@lattice-network.it`) — **niente issue pubbliche
  per le falle di sicurezza**.
- **Licenze commerciali, partnership, acquisizione**: `legal@lattice-network.it`.

---

## Cosa NON c'è in questo repository, e perché

Per scelta di sicurezza qui c'è **solo il client Android**. Non ci sono, e non ci saranno:

- il codice del **backend** e dei nodi (il nodo si installa come immagine firmata e
  verificata per digest: <https://lattice-network.it/guida-nodo>);
- **chiavi di firma** (`*.keystore`, `keystore.properties`), configurazioni locali
  (`local.properties`), credenziali dei servizi di notifica (`google-services.json`),
  segreti dell'infrastruttura.

L'assenza di questi file non impedisce la verifica: la build riproducibile confronta i
**contenuti** dell'APK, non la firma.

---

## Struttura

```
App.js                  avvio dell'applicazione (React Native / Expo)
src/                    schermate, componenti, contesti
src/lib/                crittografia, ratchet, mesh, ponte, PIN, backup
src/lib/mesh/           trasporto locale (UDP broadcast, Wi-Fi Direct, BLE)
locales/                12 lingue
android/                progetto nativo: moduli Kotlin, permessi, servizi
```

---

© 2026 Fabio Astorino. Business Source License 1.1 · Change License GPL-3.0-or-later ·
Change Date 2030-09-06.

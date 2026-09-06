# Segnalazione di vulnerabilità

## Come segnalare

**Non aprire una issue pubblica per una vulnerabilità.** Scrivi a:

**security@lattice-network.it**

Se puoi, cifra il messaggio o mandaci un contatto Lattice: siamo una piattaforma di
messaggistica cifrata, usarla è il modo più coerente.

Nella segnalazione aiuta molto avere: versione dell'app (`versionCode`), modello e versione
di Android, passi per riprodurre, impatto atteso, e se il problema richiede un dispositivo
compromesso o l'accesso fisico.

## Cosa ci aspettiamo da te

- non usare la falla su utenti reali, su dati non tuoi o su nodi di terzi;
- non esfiltrare dati, non degradare il servizio, non fare test distruttivi in produzione;
- darci un tempo ragionevole per correggere prima della divulgazione (proponiamo **90
  giorni**, riducibili di comune accordo se la correzione è già in rete).

## Cosa ci impegniamo a fare

- **rispondere entro 5 giorni lavorativi**;
- dirti se la accettiamo, e con quale gravità, entro 15 giorni;
- correggere e pubblicare, **dichiarando il difetto**: gli audit del progetto pubblicano i
  difetti trovati, inclusi i nostri (<https://lattice-network.it/audit/red-team>);
- accreditarti pubblicamente, se lo vuoi.

Non esiste un programma di ricompense in denaro. Non promettiamo cifre che non potremmo
garantire.

## Fuori ambito

- attacchi che richiedono un dispositivo già compromesso o con permessi di root, salvo che
  dimostrino un difetto specifico delle nostre difese;
- ingegneria sociale, phishing, denial of service volumetrico;
- risultati di scanner automatici senza dimostrazione di impatto;
- vulnerabilità di componenti di terzi già note e senza correzione disponibile a monte,
  segnalate senza un percorso di sfruttamento nella nostra app;
- versioni non ufficiali, fork o build non verificate.

## Nota sulla crittografia

Se ritieni di aver trovato un problema nella crittografia (ML-KEM-768, ML-DSA-65, il
ratchet, la derivazione del PIN, il doppio fondo), scrivi anche senza un exploit
funzionante: un'osservazione su un protocollo vale più di dieci scanner.

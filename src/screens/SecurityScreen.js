import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../lib/i18n";
import { theme } from "../theme";
import * as canary from "../lib/canary";
import * as api from "../lib/api";

const SITE = "https://lattice-network.it";
const VERIFIER_URL = SITE + "/verify.html";

// Elenco di TUTTE le protezioni attive nell'app, spiegate in parole semplici.
// Regola: qui entra solo ciò che è implementato e funzionante. Niente promesse.
function buildSections(it) {
  return it ? [
    {
      title: "Il contenuto delle tue conversazioni",
      items: [
        { i: "lock-closed", t: "Cifratura end-to-end reale", d: "Messaggi, foto, file e chiamate vengono cifrati sul tuo telefono (AES-256-GCM) e decifrati solo su quello di chi legge. Il server trasporta buste chiuse: non ha le chiavi e non può aprirle." },
        { i: "shield-checkmark", t: "Crittografia post-quantum", d: "La tua identità e le firme usano ML-DSA-65, lo scambio delle chiavi usa ML-KEM-768: standard scelti contro i futuri computer quantistici. Chi registrasse oggi il traffico non potrà decifrarlo domani." },
        { i: "qr-code", t: "Verifica del contatto (anti intercettazione)", d: "Da una chat 1:1 tocca lo scudo: vedi un codice QR e un numero di sicurezza a 60 cifre nato dalle chiavi che i vostri telefoni usano davvero. Se inquadri il codice dell'altro e combacia, nessuno si è messo in mezzo. Se un domani le sue chiavi cambiano, l'app te lo dice con un avviso rosso." },
        { i: "infinite", t: "Triplo ratchet ibrido (post-quantistico + curva)", d: "Nelle chat a due E nei gruppi lavorano tre catene insieme. Una chiave nuova per ogni messaggio, cancellata subito. Una chiave nuova su curva X25519 a OGNI cambio di direzione: chi ha copiato il tuo telefono resta tagliato fuori dopo un solo scambio. E una radice nuova post-quantistica con ML-KEM-768 ogni pochi turni, perché quel passo costa 2,6 KB e farlo per scrivere «ok» sarebbe uno spreco. La riservatezza è sempre ibrida: per leggere una sola riga servono rotti ENTRAMBI i mondi, i reticoli e le curve. Con i contatti che hanno ancora una versione precedente dell’app si scende automaticamente al ratchet post-quantistico puro, mai a niente di meno." },
        { i: "git-network", t: "Chat sulla mesh (indipendenza dal server)", d: "Con la Modalità Nodo Sovrano accesa, se il server non è raggiungibile il messaggio di testo parte da solo sulla rete locale: cipolla a 4 salti dove ogni strato è chiuso con ML-KEM-768 E una chiave X25519 effimera, verso le chiavi mesh del destinatario, che nascono dalla sua identità. Per sapere a chi va un pacchetto bisogna rompere entrambe le matematiche. Chi trasporta non sa né chi ha scritto né a chi va. E dentro la cipolla, adesso, c'è la stessa busta del triplo ratchet che passerebbe dal server: chiave nuova per ogni messaggio, curva nuova a ogni turno, radice post-quantistica rinnovata. Il vecchio limite — chiave mesh fissa, nessuna catena che si rigenera — non c'è più. Se la busta non sta in un pacchetto viene spezzata in pezzi, ognuno per la sua strada, e ricomposta a destinazione. L'identità mesh e un sigillo condiviso vengono scambiati una volta dentro la chat cifrata: senza quel sigillo nessuno può fabbricare un messaggio a nome di un tuo contatto. Se non c'è nessun percorso il messaggio resta in coda cifrata sul telefono e parte appena si può. Limiti che restano: sulla mesh viaggia il testo, foto, file e vocali richiedono il server; e con un vicino che ha una versione precedente dell'app la cipolla scende automaticamente a ML-KEM-768 da solo, come prima." },
        { i: "shuffle", t: "Mescolatore contro l'analisi dei tempi", d: "I pacchetti che il tuo telefono inoltra per altri non ripartono appena arrivano: finiscono in una vasca, ognuno con un istante di partenza casuale, e uscono RIMESCOLATI. Senza questo, l'ordine e il ritmo delle uscite raccontano l'ordine degli ingressi e un osservatore sullo stesso Wi-Fi ricuce le tratte col solo tempo. Mitigazione forte, non magia: chi osserva TUTTA la rete per molto tempo conserva un vantaggio statistico." },
        { i: "wifi", t: "Mesh senza router (Wi-Fi Direct e Bluetooth)", d: "Il motore mesh cerca gli altri nodi anche senza alcun Wi-Fi: con Wi-Fi Direct i due telefoni formano una rete propria e i pacchetti viaggiano lì; il Bluetooth LE annuncia e cerca un solo codice di servizio (nessun dato, nessun nome) e serve solo a scoprire chi è vicino e a innescare il collegamento. Android impone per questo il permesso \"Dispositivi nelle vicinanze\" (Posizione su Android 12 e precedenti): la tua posizione non viene mai letta né inviata." },
        { i: "radio", t: "Notifiche senza Google (a tua scelta)", d: "Puoi far arrivare le notifiche direttamente dal nostro server: un servizio dell'app tiene aperta una connessione in attesa e mostra \"hai un nuovo messaggio\" senza che Google sappia nulla. Il gettone usato è casuale e non contiene la tua identità, e il servizio non custodisce chiavi. Se quel servizio viene ucciso dal risparmio energetico, il server torna a usare Google come ripiego, così non perdi le notifiche." },
        { i: "git-network", t: "Chiamate: il tuo IP non esce", d: "Audio e video passano dal nostro relay (coturn sul VPS): i due interlocutori non vedono mai l'indirizzo IP l'uno dell'altro. Abbiamo rimosso gli STUN pubblici di Google: nessun terzo viene a sapere che stai chiamando. Se vuoi la connessione diretta (più veloce) devi accenderla a mano dalle Impostazioni, avvisati che così l'IP diventa visibile." },
        { i: "shield-checkmark-outline", t: "Aggiornamenti firmati e verificati", d: "Il manifest dell'aggiornamento è firmato con ML-DSA-65 da una chiave che vive solo sul server di build. L'app verifica la firma, poi ricalcola l'impronta SHA-256 dell'APK scaricato e la confronta con quella firmata: se non torna, il file viene cancellato e l'installazione non parte. Rifiutati anche i tentativi di farti installare una versione più vecchia." },
        { i: "sync", t: "Chiavi usa-e-getta (forward secrecy)", d: "Ogni tuo dispositivo pubblica un lotto di chiavi monouso: chi ti scrive ne consuma una e viene buttata. Se un domani qualcuno ottenesse la tua chiave d'identità, i messaggi già scambiati restano illeggibili." },
        { i: "resize", t: "Lunghezza mascherata", d: "Ogni messaggio viene riempito fino a un multiplo di 512 byte: dall'esterno non si distingue un \u201cok\u201d da una foto." },
        { i: "call", t: "Chiamate punto-a-punto", d: "Audio e video viaggiano direttamente tra i due telefoni, cifrati (DTLS-SRTP). La messa in contatto avviene su un rendezvous anonimo: il server non registra chi chiama chi." },
      ],
    },
    {
      title: "Sul tuo telefono",
      items: [
        { i: "keypad", t: "PIN dell'app e cifratura locale", d: "Con il PIN attivo, il file chiave e le chiavi di sessione vengono cifrati sul dispositivo: a telefono bloccato o spento non sono leggibili nemmeno estraendo la memoria dell'app. Il PIN non viene mai salvato." },
        { i: "lock-closed", t: "Niente in chiaro sul telefono, anche senza PIN", d: "Anche se non hai impostato il PIN, file chiave, chiavi usa-e-getta e stato del ratchet sono cifrati con AES-256-GCM da una chiave generata sul telefono e custodita dal Keystore di Android: un telefono rootato o un backup ADB non li restituiscono in chiaro. Con il PIN attivo vince il PIN, che è più forte: i dati restano illeggibili finché non lo inserisci." },
        { i: "finger-print", t: "Blocco con impronta o volto", d: "L'app si richiude appena la lasci e chiede di nuovo di sbloccare. Si attiva da Impostazioni." },
        { i: "eye-off", t: "Screenshot bloccati", d: "Il sistema impedisce screenshot, registrazioni dello schermo e anteprime dell'app nell'elenco delle app recenti." },
        { i: "timer", t: "Messaggi a scomparsa", d: "In chat puoi scegliere 1 minuto, 1 ora o 24 ore: il messaggio si autodistrugge sul telefono di chi lo riceve e sul tuo." },
        { i: "save-outline", t: "Backup cifrato locale", d: "Da Impostazioni puoi creare un file di backup (identità, rubrica, impostazioni, testo delle chat e, se vuoi, foto e allegati) cifrato con AES-256-GCM e una chiave derivata con scrypt dalla tua password o dal PIN. Il file non passa MAI dal server: lo salvi dove vuoi tu. Senza la password non è leggibile da nessuno, nemmeno da noi. I messaggi a scomparsa NON entrano nel backup e i messaggi cancellati non sono recuperabili da nessuna parte: l'autodistruzione cancella anche l'archivio locale." },
        { i: "nuclear", t: "Autodistruzione", d: "Tre PIN errati (con avviso a schermo pieno al secondo) cancellano tutto: chiavi, messaggi, chiamate, rubrica e metadati, sul telefono E sul server, compreso il tuo indirizzo Lattice. Esiste anche un PIN di emergenza che finge di sbloccare e cancella in silenzio." },
        { i: "eye-off-outline", t: "Rubrica cieca", d: "La tua rubrica sta sul telefono, cifrata: sul server non c'è più l'elenco dei tuoi contatti. Al suo posto viaggia un gettone opaco per ogni coppia, ricavato dal segreto condiviso tra te e quella persona: voi due lo calcolate identico, il server no. Così continua a impedire che estranei ti scrivano o prendano le tue chiavi, senza sapere chi conosci. Un gettone non si può indovinare né riusare: un blocco non si aggira. Nota: il server vede una coppia solo quando le scrivi davvero, e la rubrica non si scarica su un telefono nuovo (si recupera dal backup cifrato)." },
        { i: "people-circle-outline", t: "Nome dei gruppi cifrato", d: "Nei gruppi privati il nome vero è cifrato con la chiave di gruppo (AES-256-GCM), che il server non ha mai visto: al suo posto legge solo un'etichetta fissa, identica per tutti i gruppi. Lo leggono soltanto i membri, e cambiarlo aggiorna la versione cifrata. I gruppi pubblici, cercabili per nome, restano in chiaro: il loro nome è pubblico per definizione." },
        { i: "trash-outline", t: "Foto e file decifrati cancellati subito", d: "Per mostrarti una foto o aprire un documento l'app deve decifrarlo in una cartella temporanea. Adesso quel file viene cancellato appena blocchi l'app o esci dall'account, insieme alle esportazioni dei dati: sul telefono non resta una copia in chiaro. L'originale cifrato non si perde, viene decifrato di nuovo alla prossima apertura." },
        { i: "phone-portrait", t: "Dispositivi sotto controllo", d: "Vedi l'elenco dei tuoi dispositivi attivi (telefono, browser) e puoi disconnetterne uno in qualsiasi momento: smetterà subito di ricevere buste cifrate." },
        { i: "eye-off-outline", t: "Notifiche fantasma", d: "Con l'opzione attiva non compare più nulla: nessun banner, nessun suono, niente sulla schermata di blocco. Le push arrivano su un canale Android a importanza minima e con testo neutro, e chi ti guarda il telefono non vede nemmeno che tipo di evento è arrivato. Il contrassegno è di QUESTO dispositivo: su un altro tuo telefono le notifiche restano normali. Si attiva da Impostazioni." },
        { i: "flash-outline", t: "Azzeramento della memoria allo strappo", d: "Se qualcuno ti strappa il telefono dalle mani con la chat aperta, l'accelerometro riconosce il picco di forza (molto più violento di qualsiasi movimento normale) e in quell'istante la chiave in memoria viene rimossa, le foto e i documenti già decifrati vengono cancellati e l'app torna alla schermata di blocco. La sensibilità è regolabile; se scatta per sbaglio basta sbloccare di nuovo. Spento per impostazione predefinita." },
        { i: "image-outline", t: "Anteprime leggere e file solo su richiesta", d: "Le foto vengono ricompresse sul telefono prima di essere cifrate, e insieme viaggia una micro-anteprima sfocata di poche centinaia di byte: la chat mostra subito qualcosa e riserva lo spazio giusto, senza scaricare nulla. Video, documenti e immagini oltre 900 KB si scaricano soltanto se li tocchi. Anteprima e dimensioni stanno DENTRO la busta cifrata: il server non le vede." },
        { i: "shuffle-outline", t: "Gettoni della rubrica a rotazione", d: "Il server non conosce i tuoi contatti: di ogni coppia riceve solo un gettone che nessuno può ricalcolare senza le vostre chiavi. Dalla 1.5.0 quel gettone CAMBIA da solo ogni 30 giorni, quindi nemmeno confrontando i dati di anni diversi si può ricostruire chi conosce chi. Si pubblicano tre periodi (precedente, attuale e successivo): se resti un mese senza aprire l'app i tuoi contatti continuano a riconoscerti, e se un riscontro si perde l'indirizzo torna in chiaro da solo per non lasciarti mai senza poter scrivere." },
        { i: "color-wand-outline", t: "Aspetto discreto nella home", d: "Puoi far comparire Lattice nella home del telefono come una calcolatrice, un blocco note, il meteo o un orologio: chi ti guarda lo schermo non vede nessuna app di messaggistica cifrata. Si attiva da Impostazioni. Nota onesta: il nome vero resta leggibile in Impostazioni Android → App, quindi protegge da uno sguardo, non da un'analisi forense del telefono." },
      ],
    },
    {
      title: "Chi può raggiungerti",
      items: [
        { i: "people", t: "Solo contatti reciproci", d: "Nessuno può scriverti o chiamarti se non lo hai aggiunto anche tu in rubrica, o se non avete un gruppo in comune. Gli sconosciuti non hanno un modo per contattarti." },
        { i: "hand-left", t: "Blocco e segnalazione", d: "Da chat, rubrica e schede profilo puoi bloccare o segnalare in due tocchi. Il blocco taglia messaggi, chiamate e visibilità." },
        { i: "link", t: "Scudo link", d: "I link vengono analizzati sul tuo telefono: connessioni non cifrate, domini sospetti e inviti verso altre piattaforme vengono bloccati prima che tu li apra. Il contatore delle minacce bloccate è in Impostazioni." },
        { i: "globe", t: "Visibilità che scegli tu", d: "Puoi rendere il tuo profilo non trovabile nella directory pubblica quando vuoi, senza perdere l'account." },
      ],
    },
    {
      title: "Cosa resta sul server (e per quanto)",
      items: [
        { i: "cube-outline", t: "Cassetta anonima (da attivare)", d: "Modalità sperimentale: i messaggi non vengono più inviati con il tuo account, ma depositati in una cassetta dall'indirizzo casuale con gettoni monouso che il contatto ti consegna dentro la chat cifrata. Il server non sa chi scrive né che voi due vi state scrivendo. Si attiva da \"PIN e autodistruzione\" su entrambi i telefoni." },
        { i: "mail-unread", t: "Sigillo mittente", d: "Nel messaggio salvato sul server non c'è più il tuo indirizzo: restano la conversazione e un bit che dice in quale direzione va il messaggio. Chi leggesse il database non trova scritto chi ha scritto." },
        { i: "notifications-off", t: "Notifiche senza nome", d: "Alla notifica push arriva solo \"Hai un nuovo messaggio\": il servizio di notifica (Google) non sa più chi ti ha scritto. Il nome compare dentro l'app, dopo la decifratura." },
        { i: "footsteps", t: "Nessun indirizzo IP conservato", d: "Il web server non scrive log di accesso e il server delle chiamate non scrive log. Dove serve un contatore anti-abuso, l'IP diventa uno pseudonimo giornaliero non reversibile." },
        { i: "trash", t: "Cancellazione automatica", d: "Le buste già ritirate, i registri delle chiamate e i log applicativi vengono cancellati automaticamente: i tempi esatti sono qui sotto, letti dal server in questo momento." },
        { i: "key", t: "Chiavi cifrate a riposo", d: "Ciò che il server custodisce è cifrato a riposo (AES-256-GCM), non in chiaro nel database. Le tue chiavi private non ci sono mai state." },
        { i: "log-out", t: "Revoca immediata delle sessioni", d: "Il logout invalida davvero la sessione su tutti i nodi entro pochi secondi." },
      ],
    },
    {
      title: "Prove e verificabilità",
      items: [
        { i: "document-text", t: "Export firmati sul dispositivo", d: "Le conversazioni esportate sono firmate con la tua chiave: chiunque può verificarne l'autenticità, anche fra anni, senza fidarsi di noi." },
        { i: "git-commit", t: "Registro amministrativo a prova di manomissione", d: "Ogni azione di amministrazione entra in un registro concatenato con hash: se qualcuno modificasse una riga, la catena si romperebbe e si vedrebbe." },
        { i: "cube", t: "Notarizzazione su registro distribuito", d: "Le comunicazioni certificate (Certify) vengono ancorate su un registro permissionato: data e contenuto diventano dimostrabili." },
      ],
    },
  ] : [
    {
      title: "Your conversations",
      items: [
        { i: "lock-closed", t: "Real end-to-end encryption", d: "Messages, photos, files and calls are encrypted on your phone (AES-256-GCM) and decrypted only on the recipient's. The server carries sealed envelopes and holds no keys." },
        { i: "shield-checkmark", t: "Post-quantum cryptography", d: "ML-DSA-65 identities and signatures, ML-KEM-768 key exchange: standards chosen against future quantum computers." },
        { i: "qr-code", t: "Contact verification (anti-eavesdropping)", d: "In a 1:1 chat tap the shield: you get a QR code and a 60-digit safety number derived from the keys your phones really use. Scan the other code: if it matches, nobody is in the middle. If their keys ever change, the app warns you in red." },
        { i: "infinite", t: "Hybrid triple ratchet (post-quantum + curve)", d: "In 1:1 chats and in groups three chains work together. A fresh key for every message, wiped immediately. A fresh X25519 curve key at EVERY change of direction: anyone who copied your phone is locked out after a single exchange. And a fresh post-quantum root with ML-KEM-768 every few turns, because that step costs 2.6 KB and paying it to write “ok” would be waste. Confidentiality is always hybrid: reading a single line requires breaking BOTH worlds, lattices and curves. With contacts still on an older build we automatically step down to the pure post-quantum ratchet — never to anything less." },
        { i: "git-network", t: "Chat over the mesh (server independence)", d: "With Sovereign Node on, if the server is unreachable your text message leaves on the local network by itself: a 4-hop onion where every layer is sealed with ML-KEM-768 AND an ephemeral X25519 key, to the recipient's mesh keys, which are derived from their identity. Learning where a packet is headed requires breaking both kinds of mathematics. Relays know neither the author nor the destination. And inside the onion there is now the very same triple-ratchet envelope that would go through the server: a fresh key per message, a fresh curve per turn, a renewed post-quantum root. The old limitation — a static mesh key with no self-healing chain — is gone. If the envelope does not fit one packet it is split into pieces, each taking its own route, and reassembled at the destination. Mesh identity and a shared seal are exchanged once inside the encrypted chat: without that seal nobody can forge a message in your contact's name. With no route available the message stays in an encrypted queue on your phone and leaves as soon as it can. Remaining limits: text only over the mesh, photos, files and voice notes need the server; and with a neighbour on an older build the onion steps down to ML-KEM-768 alone by itself, as before." },
        { i: "shuffle", t: "Mixer against timing analysis", d: "Packets your phone relays for others do not leave as soon as they arrive: they go into a pool, each with a random departure moment, and leave SHUFFLED. Without this, the order and rhythm of departures reveal the order of arrivals and an observer on the same Wi-Fi can stitch the legs together from timing alone. A strong mitigation, not magic: whoever watches the WHOLE network for a long time keeps a statistical advantage." },
        { i: "wifi", t: "Mesh with no router (Wi-Fi Direct and Bluetooth)", d: "The mesh engine looks for other nodes even with no Wi-Fi at all: with Wi-Fi Direct the two phones form their own network and packets travel there; Bluetooth LE advertises and scans a single service code (no data, no names) and is only used to discover who is nearby and trigger the connection. Android requires the \"Nearby devices\" permission for this (Location on Android 12 and older): your position is never read nor sent." },
        { i: "radio", t: "Notifications without Google (opt-in)", d: "You can receive notifications straight from our server: an app service keeps a waiting connection open and shows \"you have a new message\" without Google learning anything. The wake token is random and carries no identity, and the service holds no keys. If battery saving kills that service, the server falls back to Google so you never miss a notification." },
        { i: "git-network", t: "Calls: your IP stays in", d: "Audio and video go through our own relay (coturn on the VPS): neither side ever sees the other's IP address. Google public STUN servers were removed: no third party learns that you are calling. Direct connection is opt-in from Settings, with a clear warning that it exposes your IP." },
        { i: "shield-checkmark-outline", t: "Signed, verified updates", d: "The update manifest is signed with ML-DSA-65 by a key that lives only on the build server. The app verifies the signature, recomputes the SHA-256 of the downloaded APK and compares it with the signed one: on any mismatch the file is deleted and the install never starts. Downgrade attempts are refused too." },
        { i: "sync", t: "One-time keys (forward secrecy)", d: "Each device publishes a batch of single-use keys: the sender consumes one and it is thrown away. Stealing your identity key later does not unlock past messages." },
        { i: "resize", t: "Length hidden", d: "Every message is padded to a multiple of 512 bytes: an \u201cok\u201d looks the same as a photo." },
        { i: "call", t: "Peer-to-peer calls", d: "Audio and video flow directly between phones, encrypted (DTLS-SRTP), set up over an anonymous rendezvous." },
      ],
    },
    {
      title: "On your phone",
      items: [
        { i: "keypad", t: "App PIN & local encryption", d: "With the PIN on, your key file and session keys are encrypted on the device: unreadable while the phone is locked or off. The PIN itself is never stored." },
        { i: "lock-closed", t: "Nothing in the clear on the phone, even without a PIN", d: "Even with no PIN set, your key file, one-time keys and ratchet state are encrypted with AES-256-GCM using a key generated on the phone and held by the Android Keystore: a rooted phone or an ADB backup does not hand them over in the clear. With a PIN on, the PIN wins — it is stronger: data stays unreadable until you type it." },
        { i: "finger-print", t: "Biometric lock", d: "The app locks as soon as you leave it and asks to unlock again." },
        { i: "eye-off", t: "Screenshots blocked", d: "The system blocks screenshots, screen recording and app previews in the recents list." },
        { i: "timer", t: "Disappearing messages", d: "Pick 1 minute, 1 hour or 24 hours per chat: the message self-destructs on both phones." },
        { i: "save-outline", t: "Local encrypted backup", d: "From Settings you can build a backup file (identity, contacts, settings, chat text and, if you want, photos and attachments) encrypted with AES-256-GCM and a key derived with scrypt from your password or PIN. The file NEVER goes through the server: you choose where to keep it. Without the password nobody can read it, not even us. Disappearing messages are NOT included and deleted messages stay unrecoverable: self-destruct wipes the local archive too." },
        { i: "nuclear", t: "Self-destruct", d: "Three wrong PINs (full-screen warning at the second) wipe everything: keys, messages, calls, contacts and metadata, on the phone AND on the server, including your Lattice address. A panic PIN wipes silently." },
        { i: "eye-off-outline", t: "Blind address book", d: "Your address book lives on the phone, encrypted: the server no longer stores the list of your contacts. In its place travels one opaque token per pair, derived from the secret shared between you and that person: the two of you compute it identically, the server cannot. So it still stops strangers from writing to you or claiming your keys, without knowing who you know. A token cannot be guessed or reused: a block cannot be bypassed. Note: the server sees a pair only when you actually write to it, and the address book does not download onto a new phone (restore it from the encrypted backup)." },
        { i: "people-circle-outline", t: "Encrypted group names", d: "In private groups the real name is encrypted with the group key (AES-256-GCM), which the server has never seen: it only reads a fixed label, identical for every group. Only members can read it, and renaming updates the encrypted version. Public groups, searchable by name, stay in the clear: their name is public by definition." },
        { i: "trash-outline", t: "Decrypted photos and files wiped at once", d: "To show a photo or open a document the app must decrypt it into a temporary folder. That file is now deleted the moment you lock the app or sign out, together with data exports: no clear copy stays on the phone. The encrypted original is untouched and is decrypted again next time." },
        { i: "phone-portrait", t: "Device control", d: "See your active devices and disconnect any of them at any time." },
        { i: "eye-off-outline", t: "Ghost notifications", d: "With this option on nothing shows up any more: no banner, no sound, nothing on the lock screen. Pushes arrive on a minimum-importance Android channel with neutral text, so someone looking at your phone cannot even tell what kind of event arrived. The flag belongs to THIS device: on another of your phones notifications stay normal. Enable it in Settings." },
        { i: "flash-outline", t: "Memory wipe when the phone is snatched", d: "If someone snatches the phone from your hand with a chat open, the accelerometer recognises the force spike (far more violent than any normal movement) and in that instant the in-memory key is dropped, already-decrypted photos and documents are deleted and the app returns to the lock screen. Sensitivity is adjustable; a false alarm only costs you one unlock. Off by default." },
        { i: "image-outline", t: "Light previews, heavy files on demand", d: "Photos are re-compressed on the phone before being encrypted, and a blurred micro-preview of a few hundred bytes travels with them: the chat shows something immediately and reserves the right amount of space without downloading anything. Videos, documents and images above 900 KB are downloaded only if you tap them. Preview and dimensions live INSIDE the encrypted envelope: the server never sees them." },
        { i: "shuffle-outline", t: "Rotating address-book tokens", d: "The server does not know your contacts: for each pair it only receives a token nobody can recompute without your keys. Since 1.5.0 that token ROTATES every 30 days, so not even by comparing data from different years can anyone rebuild who knows whom. Three periods are published (previous, current and next): if you leave the app closed for a month your contacts still recognise you, and if a match is ever lost the plain address comes back automatically so you are never left unable to write." },
        { i: "color-wand-outline", t: "Discreet look on the home screen", d: "You can make Lattice appear on your home screen as a calculator, a notepad, the weather or a clock: anyone glancing at your phone sees no encrypted messenger. Enable it in Settings. Honest note: the real name is still readable in Android Settings → Apps, so this protects you from a glance, not from a forensic analysis of the phone." },
      ],
    },
    {
      title: "Who can reach you",
      items: [
        { i: "people", t: "Mutual contacts only", d: "Nobody can message or call you unless you added them too, or you share a group." },
        { i: "hand-left", t: "Block & report", d: "Two taps from chat, contacts or profile cards. Blocking cuts messages, calls and visibility." },
        { i: "link", t: "Link shield", d: "Links are analysed on-device: unencrypted connections, suspicious domains and cross-platform invites are blocked before you open them." },
        { i: "globe", t: "Your visibility, your choice", d: "You can hide your profile from the public directory at any time." },
      ],
    },
    {
      title: "What stays on the server (and for how long)",
      items: [
        { i: "cube-outline", t: "Anonymous mailbox (opt-in)", d: "Experimental mode: messages are no longer sent with your account but dropped into a random-address mailbox using single-use tickets your contact hands you inside the encrypted chat. The server learns neither who writes nor that the two of you are talking. Enable it in \"App PIN & self-destruct\" on both phones." },
        { i: "mail-unread", t: "Sealed sender", d: "The stored message no longer contains your address: only the conversation and a direction bit remain. A database dump does not say who wrote." },
        { i: "notifications-off", t: "Nameless notifications", d: "The push says only \"You have a new message\": the notification service (Google) no longer learns who wrote to you. The name appears inside the app, after decryption." },
        { i: "footsteps", t: "No IP addresses kept", d: "The web server writes no access log and the call server writes no log. Where an anti-abuse counter is needed, the IP becomes a non-reversible daily pseudonym." },
        { i: "trash", t: "Automatic deletion", d: "Delivered envelopes, call records and application logs are deleted automatically — exact times below, read live from the server." },
        { i: "key", t: "Keys encrypted at rest", d: "Whatever the server keeps is encrypted at rest. Your private keys were never there." },
        { i: "log-out", t: "Instant session revocation", d: "Logout truly invalidates the session across all nodes within seconds." },
      ],
    },
    {
      title: "Proof & verifiability",
      items: [
        { i: "document-text", t: "Device-signed exports", d: "Exported conversations are signed with your key: anyone can verify them, years later, without trusting us." },
        { i: "git-commit", t: "Tamper-evident admin log", d: "Every administrative action enters a hash-chained log: altering one line breaks the chain." },
        { i: "cube", t: "Distributed-ledger notarisation", d: "Certified communications are anchored on a permissioned ledger." },
      ],
    },
  ];
}

const LBL_IT = {
  messaggi_letti: "Messaggi già ritirati dal destinatario",
  messaggi_non_ritirati: "Messaggi mai ritirati (tetto massimo)",
  registro_chiamate_server: "Registro chiamate sul server",
  log_accessi_applicativi: "Log applicativi degli accessi",
  ultimo_accesso_presenza: "Indicatore \u201cultimo accesso\u201d",
};
const LBL_EN = {
  messaggi_letti: "Envelopes already delivered",
  messaggi_non_ritirati: "Never-delivered envelopes (hard cap)",
  registro_chiamate_server: "Call records on the server",
  log_accessi_applicativi: "Application access logs",
  ultimo_accesso_presenza: "\u201cLast seen\u201d indicator",
};

export default function SecurityScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { lang } = useI18n();
  const it = lang !== "en";
  const [ret, setRet] = useState(null);
  const [retErr, setRetErr] = useState(false);

  useEffect(() => {
    api.privacyRetention().then(setRet).catch(() => setRetErr(true));
  }, []);

  const fmt = (h) => (h % 24 === 0 ? (h === 24 ? (it ? "24 ore" : "24 hours") : h / 24 + (it ? " giorni" : " days")) : h + (it ? " ore" : " hours"));
  const sections = buildSections(it);
  const [can, setCan] = useState(null);
  useEffect(() => { canary.status().then(setCan).catch(() => setCan(null)); }, []);

  return (
    <View style={[st.root, { paddingTop: insets.top }]}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} testID="security-back" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back-outline" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={st.title}>{it ? "Sicurezza & Audit" : "Security & Audit"}</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View style={[st.canary, can && can.state === "alarm" && { borderColor: theme.danger }]} testID="canary-card">
          <Ionicons
            name={!can || can.state === "unknown" ? "help-circle-outline" : can.state === "ok" ? "checkmark-circle" : "alert-circle"}
            size={22}
            color={!can || can.state === "unknown" ? theme.textFaint : can.state === "ok" ? theme.accent : theme.danger} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={st.canaryT} testID="canary-state">
              {it ? "Canarino: " : "Canary: "}
              {!can || can.state === "unknown" ? (it ? "non verificabile adesso" : "not verifiable right now")
                : can.state === "ok" ? (it ? "VERIFICATO" : "VERIFIED") : (it ? "ALLARME" : "ALARM")}
            </Text>
            <Text style={st.canaryD}>
              {!can || can.state === "unknown"
                ? (it ? "Serve rete per controllare la dichiarazione firmata. Nessuna rete non vuol dire nessun problema, vuol dire che non lo sappiamo."
                      : "Network is needed to check the signed statement. No network does not mean no problem, it means we do not know.")
                : can.state === "ok"
                  ? (it ? "Firma ML-DSA-65 valida, dichiarazione del " + can.signedAt + ". Nessuna richiesta di dati, nessun ordine di consegna chiavi, nessun ordine di silenzio."
                        : "Valid ML-DSA-65 signature, statement dated " + can.signedAt + ". No data requests, no key disclosure orders, no gag orders.")
                  : (it ? "Motivo: " + (can.reason || "sconosciuto") + ". Trattalo come una risposta: un canarino che non viene aggiornato non è \"un po' vecchio\"."
                        : "Reason: " + (can.reason || "unknown") + ". Treat it as an answer: a canary that stops being updated is not \"a bit old\".")}
            </Text>
          </View>
        </View>

        <View style={st.hero}>
          <Ionicons name="shield-checkmark-outline" size={40} color={theme.primary} />
          <Text style={st.heroT}>{it ? "Tutto quello che l'app fa per proteggerti" : "Everything the app does to protect you"}</Text>
          <Text style={st.heroD}>
            {it
              ? "Qui sotto c'è l'elenco completo delle protezioni attive in questo momento, spiegate in parole semplici. Nessuna promessa: solo ciò che è già implementato e funzionante."
              : "Below is the complete list of protections active right now, in plain language. No promises: only what is already implemented and working."}
          </Text>
        </View>

        {sections.map((sec, si) => (
          <View key={si} testID={`security-section-${si}`}>
            <Text style={st.section}>{sec.title}</Text>
            {sec.items.map((x, i) => (
              <View key={i} style={st.card} testID={`security-item-${si}-${i}`}>
                <Ionicons name={x.i} size={22} color={theme.primary} style={{ marginTop: 2 }} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <View style={st.rowT}>
                    <Text style={st.cardT}>{x.t}</Text>
                    <Text style={st.badge}>{it ? "ATTIVO" : "ON"}</Text>
                  </View>
                  <Text style={st.cardD}>{x.d}</Text>
                </View>
              </View>
            ))}
          </View>
        ))}

        {/* Dati letti dal server in tempo reale: le stesse cifre della pagina pubblica di trasparenza */}
        <Text style={st.section}>{it ? "Tempi di conservazione, letti ora dal server" : "Retention, read live from the server"}</Text>
        <View style={[st.card, { flexDirection: "column", alignItems: "stretch" }]} testID="security-retention">
          {!ret && !retErr && <ActivityIndicator color={theme.primary} />}
          {retErr && <Text style={st.cardD}>{it ? "Non riesco a contattare il server adesso." : "Cannot reach the server right now."}</Text>}
          {ret && (
            <>
              {Object.keys(ret.retention_hours || {}).map((k) => (
                <View key={k} style={st.retRow}>
                  <Text style={st.retK}>{(it ? LBL_IT : LBL_EN)[k] || k}</Text>
                  <Text style={st.retV}>{fmt(ret.retention_hours[k])}</Text>
                </View>
              ))}
              <View style={st.retRow}>
                <Text style={st.retK}>{it ? "Log del web server" : "Web server logs"}</Text>
                <Text style={st.retV}>{it ? "disabilitati" : "disabled"}</Text>
              </View>
              <View style={st.retRow}>
                <Text style={st.retK}>{it ? "Indirizzi IP" : "IP addresses"}</Text>
                <Text style={st.retV}>{it ? "non conservati" : "not kept"}</Text>
              </View>
              <Text style={st.note}>
                {it
                  ? "Questi valori non sono scritti a mano: arrivano dall'endpoint pubblico /api/public/privacy/retention, che riporta la configurazione attiva sul server."
                  : "These values are not hand-written: they come from the public endpoint /api/public/privacy/retention."}
              </Text>
            </>
          )}
        </View>

        <Text style={st.section}>{it ? "Verifica e trasparenza" : "Verify & transparency"}</Text>
        <View style={[st.card, { flexDirection: "column", alignItems: "stretch" }]}>
          <Text style={st.cardD}>
            {it
              ? "Chiunque può verificare un export firmato direttamente nel browser, senza inviare dati a nessun server. Sul sito trovi anche cosa possiamo e cosa non possiamo consegnare a un'autorità."
              : "Anyone can verify a signed export in the browser, without sending data anywhere. The website also states what we can and cannot hand over to an authority."}
          </Text>
          <TouchableOpacity style={st.btn} onPress={() => Linking.openURL(VERIFIER_URL).catch(() => {})} testID="security-open-verifier">
            <Ionicons name="open-outline" size={18} color="#fff" />
            <Text style={st.btnT}>{it ? "Apri il verificatore" : "Open the verifier"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={st.btnGhost} onPress={() => Linking.openURL(SITE + "/trasparenza.html").catch(() => {})} testID="security-open-transparency">
            <Text style={st.btnGhostT}>{it ? "Cosa possiamo e non possiamo consegnare" : "What we can and cannot hand over"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={st.btnGhost} onPress={() => Linking.openURL(SITE + "/dati.html").catch(() => {})} testID="security-open-data">
            <Text style={st.btnGhostT}>{it ? "Dati trattati e conservazione" : "Data processed & retention"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={st.btnGhost} onPress={() => Linking.openURL(SITE + "/regole.html").catch(() => {})} testID="security-open-rules">
            <Text style={st.btnGhostT}>{it ? "Regole delle aree pubbliche e segnalazioni" : "Public area rules & reporting"}</Text>
          </TouchableOpacity>
        </View>

        <Text style={st.section}>{it ? "Limiti dichiarati" : "Declared limits"}</Text>
        <View style={[st.card, { flexDirection: "column", alignItems: "stretch" }]} testID="security-limits">
          <Text style={st.cardD}>
            {it
              ? "· Le chiavi usa-e-getta (forward secrecy) valgono per l'app: nel browser la busta usa la chiave d'identità, quindi il web offre il multi-dispositivo ma non la forward secrecy. Se vuoi il massimo, disconnetti il dispositivo web da \u201cPIN e autodistruzione\u201d.\n\n· Il sigillo mittente togli il TUO indirizzo dal messaggio salvato, ma nella modalità normale resta scritto che due indirizzi appartengono alla stessa conversazione (mai cosa vi siete detti). Con la cassetta anonima attiva anche quello scompare.\n\n· Cassetta anonima, cosa resta visibile: la PRIMA consegna di gettoni passa dalla chat normale (il server vede una volta che vi siete scritti), poi la conversazione diventa opaca. I messaggi anonimi arrivano mentre l'app è aperta: la notifica push per le cassette non è ancora collegata, è il prossimo passo.\n\n· Il client web resta sul protocollo vecchio: le conversazioni in modalità anonima si leggono solo sul telefono.\n\n· Le aree pubbliche (directory, gruppi pubblici, bandi) sono per definizione visibili: lì la protezione sono le regole e la moderazione, non la cifratura."
              : "· One-time keys (forward secrecy) apply to the app: in the browser the envelope uses the identity key, so the web gives multi-device but not forward secrecy. Disconnect the web device for maximum protection.\n\n· Sealed sender removes YOUR address from the stored message, but in normal mode the record still says two addresses share a conversation (never what you said). With the anonymous mailbox on, that disappears too.\n\n· Anonymous mailbox, what remains visible: the FIRST ticket handover goes through the normal chat (the server sees ONCE that you wrote to each other), then the conversation goes opaque and every later message is unlinkable. Push is wired to the mailbox and not to your identity, so the phone wakes up without the server knowing whose account it is.\n\n· The web client stays on the old protocol: anonymous conversations are readable on the phone only.\n\n· Public areas (directory, public groups, calls for entries) are visible by design: there the protection is rules and moderation, not encryption."}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 10, borderBottomColor: theme.border, borderBottomWidth: 1 },
  title: { color: theme.text, fontSize: 18, fontWeight: "800" },
  canary: { flexDirection: "row", alignItems: "flex-start", backgroundColor: theme.surface, borderRadius: 14, padding: 14, borderColor: theme.border, borderWidth: 1 },
  canaryT: { color: theme.text, fontSize: 14, fontWeight: "800" },
  canaryD: { color: theme.textDim, fontSize: 12.5, marginTop: 5, lineHeight: 18 },
  hero: { alignItems: "center", paddingVertical: 18, paddingHorizontal: 6 },
  heroT: { color: theme.text, fontSize: 18, fontWeight: "800", marginTop: 10, textAlign: "center" },
  heroD: { color: theme.textDim, fontSize: 13, marginTop: 8, textAlign: "center", lineHeight: 19 },
  card: { flexDirection: "row", backgroundColor: theme.surface, borderRadius: 14, padding: 14, borderColor: theme.border, borderWidth: 1, marginBottom: 10 },
  rowT: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  cardT: { color: theme.text, fontSize: 15, fontWeight: "700", flex: 1 },
  badge: { color: theme.accent, fontSize: 9.5, fontWeight: "900", letterSpacing: 0.8, borderColor: theme.accent, borderWidth: 1, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  cardD: { color: theme.textDim, fontSize: 13, marginTop: 5, lineHeight: 19 },
  section: { color: theme.textDim, fontSize: 13, fontWeight: "700", marginTop: 18, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 },
  retRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 8, borderBottomColor: theme.border, borderBottomWidth: 1, gap: 12 },
  retK: { color: theme.textDim, fontSize: 13, flex: 1 },
  retV: { color: theme.text, fontSize: 13, fontWeight: "800" },
  note: { color: theme.textFaint, fontSize: 11.5, lineHeight: 17, marginTop: 10 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: theme.primary, borderRadius: 12, paddingVertical: 12, marginTop: 12 },
  btnT: { color: "#fff", fontWeight: "800", fontSize: 15 },
  btnGhost: { borderColor: theme.border, borderWidth: 1, borderRadius: 12, paddingVertical: 11, marginTop: 8, alignItems: "center" },
  btnGhostT: { color: theme.primary, fontWeight: "700", fontSize: 13 },
});

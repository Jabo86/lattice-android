import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";
import { useI18n } from "../lib/i18n";

// Changelog completo di Lattice Pulse (più recente in alto). Bilingue IT/EN.
const CHANGELOG = [
  {
    v: "2.3.1",
    date: "2026-06",
    it: [
      "Dodici lingue. Alle sette di ieri si aggiungono cinese semplificato, portoghese del Brasile, giapponese, turco e hindi: tradotte a mano, come le altre, senza contattare nessun servizio di traduzione. Cinese e portoghese sono complete; giapponese, turco e hindi coprono tutte le schermate che si attraversano davvero, e quel che resta ricade sull'inglese — non sull'italiano, perché chi ha scelto il giapponese non capisce «Impostazioni» più di quanto capisca «Settings». Lo scriviamo qui invece di far finta.",
      "Due colori, e basta. Nero pieno e verde smeraldo. Il nero non è «quasi nero»: sugli schermi OLED i pixel sono spenti, quindi il fondo non è un colore, è assenza. Le sedici tinte fra cui scegliere sono sparite: un oggetto di design non ha sedici umori. Le icone sono passate alla variante a filo sottile dove esisteva — 178 occorrenze in 32 schermate — e gli allarmi non sono più un rosso: sono blocchi invertiti e una parola scritta, perché un allarme che è solo un colore chi non distingue il rosso non lo vede.",
      "La Costellazione è entrata in chat. Il lucchetto in cima alla conversazione ora si tocca: si apre il percorso di questo messaggio. A sinistra tu, a destra chi legge, in mezzo ciò che sta davvero trasportando la busta — il server, oppure i telefoni vicini, con i salti contati. Il punto che viaggia sulla linea riparte quando qualcosa passa per davvero: non è un'animazione decorativa, è il contatore del nodo.",
      "E il server, ogni notte, ricompila da solo l'APK che pubblica dentro un container che non contiene niente di nostro, e lo confronta voce per voce con il file che scaricate. L'esito finisce sul sito accanto al canarino, con l'ora. Una build riproducibile non è una proprietà del passato: basta che cambi una dipendenza e smette di esserlo. Se smette, lo vedrete anche voi.",
    ],
    en: [
      "Twelve languages. Yesterday's seven are joined by Simplified Chinese, Brazilian Portuguese, Japanese, Turkish and Hindi: hand-translated like the others, without contacting any translation service. Chinese and Portuguese are complete; Japanese, Turkish and Hindi cover every screen you actually walk through, and whatever is left falls back to English — not to Italian, because someone who picked Japanese does not understand «Impostazioni» any better than «Settings». We write it here instead of pretending.",
      "Two colours, and that is all. Deep black and emerald green. The black is not «almost black»: on OLED screens the pixels are off, so the background is not a colour, it is absence. The sixteen tints you could pick from are gone: an object of design does not have sixteen moods. Icons moved to the thin-line variant wherever one existed — 178 occurrences across 32 screens — and alarms are no longer a red: they are inverted blocks and a written word, because an alarm that is only a colour is invisible to anyone who cannot tell red apart.",
      "The Constellation moved into the chat. The padlock at the top of the conversation is now tappable: it opens the route of this message. You on the left, whoever reads on the right, and in between whatever is actually carrying the envelope — the server, or the phones nearby, with the hops counted. The dot travelling along the line restarts when something really passes: it is not decoration, it is the node's counter.",
      "And every night the server recompiles, by itself, the APK it publishes inside a container that holds nothing of ours, and compares it entry by entry with the file you download. The outcome lands on the site next to the canary, with the time. A reproducible build is not a property of the past: one changed dependency and it stops being true. If it stops, you will see it too.",
    ],
  },
  {
    v: "2.3.0",
    date: "2026-06",
    it: [
      "Sette lingue, e la prima cosa che l'app chiede è quale. Prima del consenso, prima dell'identità, prima di qualunque rete: chiedere di accettare dei documenti in una lingua che non si legge non è un consenso, è una firma alla cieca. Italiano, inglese, spagnolo, francese, tedesco, russo e arabo, tradotti a mano — nessun servizio di traduzione contattato, nessun byte che esce dal telefono per capire cosa c'è scritto.",
      "Con l'arabo l'interfaccia si specchia per intero: la direzione del layout diventa da destra a sinistra per tutto l'albero, quindi margini, allineamenti e righe si invertono senza che una singola schermata sia stata riscritta a mano.",
      "La Costellazione al posto del muro di numeri. La mesh era leggibile solo da chi l'ha scritta: vicini, ibridi, mescolatore, flussi. Adesso i telefoni intorno a te sono nodi collegati da linee che si accendono quando qualcosa passa, e i numeri tecnici restano — a un tocco di distanza, per chi li vuole.",
      "L'attesa prende la forma di quello che sta arrivando: al posto della rotellina, lo scheletro della lista. E la verifica riproducibile aveva un difetto vero, trovato provandola da fuori: lo script cercava il compilatore del nucleo Xray in una cartella del NOSTRO server. Chi verificava dal proprio computer si fermava esattamente lì. Adesso il percorso è quello dell'archivio pubblicato, e la verifica gira anche a casa vostra.",
      "E la verifica, girando davvero da fuori, ha trovato una seconda cosa che nessuna dichiarazione avrebbe trovato: dentro l'APK c'era l'indirizzo IP locale della macchina che lo compila. Non un dato vostro, un dato NOSTRO — lo mette il plugin Gradle di React Native per comodità di chi sviluppa, e resta anche nelle build pubblicate. Due conseguenze: ogni macchina produceva un APK diverso, e il nostro indirizzo interno viaggiava in ogni copia scaricata. Adesso è fissato a localhost. Un byte per volta, è questo che serve la verifica.",
    ],
    en: [
      "Seven languages, and the first thing the app asks is which one. Before consent, before identity, before any network: asking someone to accept documents in a language they cannot read is not consent, it is a blind signature. Italian, English, Spanish, French, German, Russian and Arabic, translated by hand — no translation service contacted, not one byte leaving the phone to work out what is written.",
      "With Arabic the interface mirrors completely: the layout direction becomes right-to-left for the whole tree, so margins, alignments and rows flip without a single screen having been rewritten by hand.",
      "The Constellation instead of the wall of numbers. The mesh was only readable by whoever wrote it: neighbours, hybrids, mixer, flows. Now the phones around you are nodes joined by lines that light up when something passes, and the technical numbers stay — one tap away, for whoever wants them.",
      "Waiting takes the shape of what is coming: instead of the spinner, the skeleton of the list. And the reproducible verification had a real defect, found by running it from the outside: the script looked for the Xray core compiler in a folder on OUR server. Anyone verifying from their own computer stopped exactly there. Now the path is the one inside the published archive, and the verification runs at your place too.",
      "And the verification, actually run from the outside, found a second thing no statement would have found: the APK carried the local IP address of the machine that builds it. Not your data, OURS — the React Native Gradle plugin puts it there for developer convenience, and it survives into published builds. Two consequences: every machine produced a different APK, and our internal address travelled in every downloaded copy. It is now pinned to localhost. One byte at a time: that is what verification is for.",
    ],
  },
  {
    v: "2.2.0",
    date: "2026-06",
    it: [
      "Chiave di firma nostra. Fino alla v2.1.0 l'APK era firmato con la chiave di debug di Android, la cui password è pubblica: il file della chiave era l'unico segreto. Adesso c'è una chiave di release RSA 4096 generata sul nostro server, che da lì non esce. Il prezzo lo pagate voi, una volta sola: Android non accetta un aggiornamento firmato con una chiave diversa, quindi questa versione va installata dopo aver disinstallato la precedente. Lo scriviamo grosso perché è un fastidio reale causato da un errore reale, e nasconderlo sarebbe peggio del fastidio.",
      "Build sovrana: zero binari di terze parti. Il nucleo Xray del trasporto offuscato era un file .aar compilato da qualcun altro e messo dentro l'APK così com'era: l'unico pezzo su cui la build riproducibile non poteva dire niente. Adesso si compila qui, da sorgente, con Go e gomobile, a ogni build. Due compilazioni dello stesso sorgente danno lo stesso file, byte per byte. Ogni byte eseguibile dell'APK viene da un compilatore che gira sul nostro server, su codice che pubblichiamo.",
      "Le dipendenze Go le fissa go.sum, che sta nel sorgente: l'impronta di ogni singolo modulo è scritta lì, quindi scaricarle o averle già in casa dà gli stessi byte, e se un modulo cambiasse di un solo bit la compilazione si fermerebbe invece di produrre un binario diverso in silenzio. Il .aar è scomparso dall'archivio del sorgente, perché non è più un file versionato: è un prodotto della compilazione.",
      "Gruppi sulla mesh, Fase 2. Prima era tutto-o-niente: in un gruppo di cinque, senza internet, con quattro membri a portata di radio e uno lontano, non partiva niente per nessuno. Adesso parte per chi c'è. Chi non si è mai presentato sulla mesh resta al ponte o alla coda, ma con SOLO le sue buste: ogni busta porta scritto per chi è, quindi ridurre l'elenco è esatto e nessuno riceve il messaggio due volte.",
      "E il passaparola: la copia destinata a un membro che non si vede adesso viene affidata a un membro che si vede. Appena quello incrocia il destinatario, gliela consegna. Non è una funzione nuova del protocollo, è la custodia del corriere applicata dentro un gruppo. Chi fa da corriere vede il nome del destinatario — ma è nel gruppo, quindi lo sapeva già — e un blocco di byte che non può leggere né modificare: il contenuto è cifrato col ratchet fra mittente e destinatario, e il sigillo è calcolato col segreto mesh di quella coppia, che lui non ha.",
      "Una cosa che il banco di prova ha scovato e che vale la pena raccontare: il passaparola, così com'era scritto, avrebbe potuto trasportare anche il formato precedente (v1), il cui corpo è protetto dai soli strati della cipolla — e il membro-corriere sbuccia il suo strato, quindi lo avrebbe letto. Adesso la custodia si affida SOLO alle buste del ratchet. Un messaggio in chiaro non si dà a nessuno, nemmeno a un membro del gruppo: meglio che resti in coda.",
      "Se la stessa copia arriva sia per via diretta sia per passaparola, il destinatario ne tiene una: il doppione si riconosce dal sigillo, che è identico. La custodia ha un tetto di 40 copie e scade dopo 12 ore, così nessuno può usare il vostro telefono come magazzino.",
      "Security & Transparency Report pubblico, con il canarino firmato ML-DSA-65 e datato: nessuna richiesta di dati, nessun ordine di consegna chiavi, nessuna backdoor imposta, nessun ordine di silenzio. Dentro c'è anche l'elenco onesto di cosa il server può vedere (che vi siate collegati, quando, da quale IP se non usate il tunnel) e di cosa non può vedere (tutto il resto), e la cronologia completa della verifica riproducibile: 11 differenze, poi 3, poi 0.",
      "30 prove automatiche nuove sui gruppi mesh, fra cui la consegna parziale, il tetto della custodia, il doppione scartato e il buco del formato in chiaro. Totale: 334 prove, nessuna rossa.",
    ],
    en: [
      "Our own signing key. Up to v2.1.0 the APK was signed with the Android debug key, whose password is public: the key file was the only secret. Now there is an RSA 4096 release key generated on our server, and it never leaves it. You pay the price once: Android does not accept an update signed with a different key, so this version must be installed after uninstalling the previous one. We are saying it loudly because it is a real annoyance caused by a real mistake, and hiding it would be worse than the annoyance.",
      "Sovereign build: zero third-party binaries. The Xray core used for the obfuscated transport was a .aar compiled by someone else and dropped into the APK as-is: the one piece the reproducible build could say nothing about. Now it is compiled here, from source, with Go and gomobile, on every build. Two builds of the same source produce the same file, byte for byte. Every executable byte in the APK comes from a compiler running on our server, on code we publish.",
      "The Go dependencies are pinned by go.sum, which is in the source: the hash of every single module is written there, so downloading them or having them already gives the same bytes, and if one module changed by a single bit the build would stop instead of quietly producing a different binary. The .aar is gone from the source archive, because it is no longer a versioned file: it is a build product.",
      "Groups over the mesh, phase 2. It used to be all-or-nothing: in a group of five, with no internet, four members within radio range and one far away, nothing went out to anybody. Now it goes out to whoever is there. Members who never introduced themselves on the mesh fall back to the bridge or the queue, but with ONLY their own envelopes: every envelope says who it is for, so trimming the list is exact and nobody receives the message twice.",
      "And the word-of-mouth relay: the copy meant for a member who is not visible right now is handed to a member who is. As soon as that one crosses paths with the recipient, it gets delivered. It is not a new protocol feature, it is the courier's custody applied inside a group. The member acting as courier sees the recipient's name — but they are in the group, so they already knew — and a block of bytes they can neither read nor modify: the content is ratchet-encrypted between sender and recipient, and the seal is computed with that pair's mesh secret, which they do not have.",
      "One thing the test bench caught, worth telling: word-of-mouth, as first written, could also have carried the older format (v1), whose body is protected only by the onion layers — and the courier peels their own layer, so they would have read it. Custody is now handed only for ratchet envelopes. A cleartext message is given to nobody, not even a group member: better it stays in the queue.",
      "If the same copy arrives both directly and by word-of-mouth, the recipient keeps one: the duplicate is recognised by its seal, which is identical. Custody is capped at 40 copies and expires after 12 hours, so nobody can use your phone as a warehouse.",
      "Public Security & Transparency Report, with an ML-DSA-65 signed and dated canary: no data requests, no key disclosure orders, no imposed backdoor, no gag order. It also carries the honest list of what the server can see (that you connected, when, from which IP unless you use the tunnel) and what it cannot (everything else), plus the full history of the reproducible-build verification: 11 differences, then 3, then 0.",
      "30 new automated tests on mesh groups, covering partial delivery, the custody cap, the discarded duplicate and the cleartext-format hole. Total: 334 tests, none red.",
    ],
  },
  {
    v: "2.1.0",
    date: "2026-06",
    it: [
      "Rotazione delle chiavi d'aggancio. La chiave con cui gli altri aprono una conversazione nuova con te protegge la RADICE di quella conversazione — il segreto più longevo che esiste — e resta esposta su un tabellone pubblico per tutta la sua vita. Il motivo per cui nessuna app la ruota mai è semplice: ruotarla vorrebbe dire cambiare identità, e ogni contatto che ti ha verificato vedrebbe un allarme. Qui le due cose sono separate: l'identità ML-DSA-65, il numero di sicurezza e il codice QR restano fermi per sempre, mentre la coppia d'aggancio (X25519 + ML-KEM-1024) si ricambia da sola ogni trenta giorni.",
      "Sul filo NON viaggia quale generazione hai usato: chi riceve prova la corrente e le sei precedenti — circa mezzo anno, per chi è stato offline — e vince quella che apre. Serve dirlo perché è un errore facile: ML-KEM non fallisce MAI la decapsulazione, con la chiave sbagliata restituisce un segreto pseudocasuale in silenzio. Quindi la generazione giusta non si riconosce dalla decapsulazione, ma solo aprendo per davvero il primo messaggio, su una copia dello stato. Un tentativo in più su una conversazione nuova, zero informazioni regalate a chi guarda.",
      "Nuovo pannello «Chiavi d'aggancio» nelle impostazioni: generazione attuale, ultimo ricambio, prossimo automatico e un pulsante per ruotare adesso. Con scritto nero su bianco cosa cambia e cosa no.",
      "«Dopo la dogana». Il caso è preciso: il telefono è stato fuori dalle tue mani. Un controllo alla frontiera, un fermo, un albergo. Chi l'ha avuto in mano potrebbe aver copiato dei file, e i file si copiano. Un tocco rifà tutto ciò che si può rifare: brucia tutte le chiavi usa-e-getta e ne pubblica un lotto nuovo, ruota le chiavi d'aggancio, azzera ogni sessione, butta le chiavi dei contatti tenute in cassaforte e le riscarica, cancella i file decifrati rimasti nella cache. E poi la cosa che conta di più: ricontrolla TUTTI i contatti verificati e ti dice per nome quelli la cui impronta è cambiata mentre eri lontano dal telefono.",
      "Cronologia, identità e numero di sicurezza non si toccano. Quello che non può fare lo diciamo lì dentro: l'identità non si rifà, quindi se il sospetto è che ti abbiano copiato il FILE CHIAVE, o che il telefono sia stato modificato a livello di sistema, quel pulsante non basta — serve l'autodistruzione e un'identità nuova su un telefono diverso.",
      "Build riproducibili. La firma prova che l'APK viene da noi, non prova cosa c'è dentro. L'unica cosa che lo prova è ricompilare e ritrovarsi lo stesso binario: due compilazioni indipendenti dello stesso sorgente, con tutto cancellato in mezzo, adesso danno 1.663 voci identiche byte per byte. Pubblichiamo l'impronta del contenuto di ogni versione e lo strumento di confronto, che dice QUALE voce non combacia — non solo che qualcosa non torna. Manca l'ultimo pezzo, il sorgente pubblicato accanto all'APK, e sta arrivando: finché non c'è, la verifica la possiamo fare solo noi, e lo scriviamo sulla pagina dei download invece di lasciarlo intendere.",
      "68 prove automatiche nuove: 37 sulla rotazione (compresa quella che ha scovato un difetto vero — la generazione veniva scelta accettando la prima provata, e chi scriveva con una chiave non corrente non veniva letto) e 31 su «Dopo la dogana», fra cui l'ordine dei passaggi, l'allarme sui contatti verificati, e che un passaggio fallito non fermi gli altri.",
    ],
    en: [
      "Handshake key rotation. The key others use to open a new conversation with you protects the ROOT of that conversation — the longest-lived secret there is — and it sits on a public board for its whole life. The reason no app ever rotates it is simple: rotating it would mean changing your identity, and every contact who verified you would see an alarm. Here the two are separated: the ML-DSA-65 identity, the safety number and the QR code stay fixed forever, while the handshake pair (X25519 + ML-KEM-1024) is replaced on its own every thirty days.",
      "Which generation you used never travels on the wire: the receiver tries the current one and the previous six — about half a year, for anyone who has been offline — and the right one opens. This is worth stating because it is an easy mistake: ML-KEM NEVER fails decapsulation, with the wrong key it silently returns a pseudorandom secret. So the right generation cannot be recognised from decapsulation, only by actually opening the first message, on a copy of the state. One extra attempt on a new conversation, and not one bit given away to an observer.",
      "New “Handshake keys” panel in settings: current generation, last rotation, next automatic one, and a button to rotate right now. With what changes and what does not stated plainly.",
      "“After the border”. The case is specific: your phone left your hands. A border check, a stop, a hotel. Whoever held it may have copied files, and files do get copied. One tap redoes everything that can be redone: burns every one-time key and publishes a fresh batch, rotates the handshake keys, clears every session, drops the contact keys held in the local vault and fetches them again, deletes decrypted files left in cache. And then the part that matters most: it re-checks ALL your verified contacts and names the ones whose fingerprint changed while you were away from the phone.",
      "History, identity and safety number are untouched. What it cannot do is stated right there: the identity cannot be redone, so if you suspect THE KEY FILE was copied, or that the phone was tampered with at system level, that button is not enough — you need self-destruct and a new identity on a different phone.",
      "Reproducible builds. The signature proves the APK comes from us, it does not prove what is inside. The only thing that proves that is rebuilding and getting the same binary: two independent builds of the same source, with everything wiped in between, now yield 1,663 entries identical byte for byte. We publish the content fingerprint of each version and the comparison tool, which tells you WHICH entry differs — not merely that something does. The last piece, the source published next to the APK, is on its way: until it is there the verification can only be done by us, and we say so on the downloads page rather than letting you assume otherwise.",
      "68 new automated tests: 37 on rotation (including the one that caught a real defect — the generation was picked by accepting the first one tried, so anyone writing with a non-current key was not read) and 31 on “After the border”, covering the order of the steps, the verified-contact alarm, and that one failed step does not stop the others.",
    ],
  },
  {
    v: "2.0.0",
    date: "2026-06",
    it: [
      "Aggancio a livello 5. L'apertura di una sessione \u00e8 il punto che protegge il segreto pi\u00f9 longevo di tutta la conversazione: da l\u00ec nasce la radice, e da quella radice discende ogni chiave che verr\u00e0 dopo. Da adesso quel punto usa ML-KEM-1024, il parametro pi\u00f9 alto che lo standard prevede (livello NIST 5), invece del livello 3. Il ratchet continua a 768, dove un passo si rifa\u0300 ogni pochi turni e il livello 3 basta: il costo si paga una volta per sessione, non a ogni messaggio.",
      "La chiave nuova nasce dallo stesso segreto d'identit\u00e0 con un'etichetta diversa: non c'\u00e8 nulla in pi\u00f9 da custodire, e il tuo numero di sicurezza NON cambia. Chi si \u00e8 gi\u00e0 verificato con te non vedr\u00e0 nessun falso allarme.",
      "Nessuno pu\u00f2 farti scendere di livello per strada: il livello viaggia dentro il dato autenticato della busta, quindi cambiarlo fa fallire la decifratura invece di declassare la sessione in silenzio. Con chi ha una versione precedente si resta a 768, come prima.",
      "Sigillo mittente pieno con il ratchet dentro. La cassetta postale anonima esisteva gi\u00e0: i messaggi non partono a tuo nome ma vengono depositati a un indirizzo casuale con gettoni monouso, e il server non sa n\u00e9 chi scrive, n\u00e9 a chi, n\u00e9 che una conversazione esista. Il problema era che dentro quella busta viaggiava la crittografia a colpo singolo: accenderla significava rinunciare al ratchet.",
      "Adesso dentro il deposito anonimo c'\u00e8 la stessa busta del triplo ratchet ibrido di tutte le altre chat. Chiave nuova per ogni messaggio, curva nuova a ogni turno, auto-guarigione. Accendere la modalit\u00e0 anonima non costa pi\u00f9 niente in robustezza: si guadagna solo. La trovi in \u00abPIN app e autodistruzione\u00bb, va accesa su entrambi i telefoni.",
      "40 prove automatiche nuove sul solo sigillo mittente, fra cui quelle che mettono nero su bianco cosa il server riesce a vedere di un deposito: n\u00e9 il testo, n\u00e9 l'indirizzo di chi scrive, n\u00e9 quello di chi riceve, n\u00e9 l'id della conversazione, n\u00e9 l'id del dispositivo \u2014 e due depositi consecutivi non hanno un solo byte in comune.",
      "31 prove nuove sull'aggancio a livello 5, compreso un giro completo contro il server vero.",
    ],
    en: [
      "Level 5 session setup. Opening a session is the point that protects the longest-lived secret of the whole conversation: the root is born there, and every later key descends from it. From now on that point uses ML-KEM-1024, the highest parameter the standard defines (NIST level 5), instead of level 3. The ratchet stays at 768, where a step is redone every few turns and level 3 is enough: the cost is paid once per session, not per message.",
      "The new key is derived from the same identity secret with a different label: there is nothing extra to keep safe, and your safety number does NOT change. Anyone who already verified you will see no false alarm.",
      "Nobody can downgrade you in transit: the level travels inside the envelope's authenticated data, so changing it makes decryption fail instead of silently weakening the session. With anyone on an older build we stay at 768, as before.",
      "Full sender sealing, now with the ratchet inside. The anonymous mailbox already existed: messages do not leave under your name but are dropped at a random address with single-use tickets, and the server learns neither who writes, nor to whom, nor that a conversation exists. The problem was that inside that envelope travelled single-shot encryption: turning it on meant giving up the ratchet.",
      "Now the anonymous drop carries the very same hybrid triple-ratchet envelope as every other chat. A fresh key per message, a fresh curve per turn, self-healing. Turning on anonymous mode no longer costs you anything in strength: it is pure gain. You will find it under \u201cApp PIN & self-destruct\u201d, and it must be on on both phones.",
      "40 new automated tests on sender sealing alone, including the ones that put in writing what the server can actually see of a drop: not the text, not the sender's address, not the recipient's, not the conversation id, not the device id \u2014 and two consecutive drops do not share a single byte.",
      "31 new tests on level 5 session setup, including a full round against the real server.",
    ],
  },
  {
    v: "1.9.0",
    date: "2026-06",
    it: [
      "Cipolla mesh ibrida. Sulla rete locale ogni pacchetto viaggia dentro quattro strati, e finora ogni strato era chiuso con la sola matematica dei reticoli. Da adesso ogni strato porta anche una chiave X25519 effimera: per sapere soltanto A CHI \u00e8 diretto un pacchetto bisogna rompere entrambe le matematiche. Costa 32 byte per strato, 128 su 8192: un arrotondamento.",
      "Il ratchet arriva sulla mesh. Era l'ultimo punto debole, e lo scrivevamo nel pannello Sicurezza: sulla rete locale il testo era protetto soltanto dalla chiave mesh del destinatario, che nasce dalla sua identit\u00e0 e non ruota mai. Nessuna forward secrecy, nessuna auto-guarigione. Adesso dentro la cipolla c'\u00e8 la stessa busta del triplo ratchet ibrido che passerebbe dal server: chiave nuova per ogni messaggio, curva nuova a ogni turno, radice post-quantistica rinnovata. Chi copia il telefono viene tagliato fuori anche qui.",
      "\u00c8 diventato possibile solo grazie alla 1.8.0: una busta a regime pesa ~200 byte invece di 11,5 KB, quindi ci sta comodamente in un pacchetto mesh. Prima non ci sarebbe entrata.",
      "Quando la busta \u00e8 troppo grande \u2014 succede al primo messaggio, quello che porta l'aggancio della sessione \u2014 viene spezzata in pezzi, ognuno dentro la SUA cipolla e per la SUA strada, e ricomposta a destinazione. I pezzi vivono solo in memoria e scadono in cinque minuti: sul telefono non resta niente.",
      "Compatibilit\u00e0: se anche un solo salto del percorso ha una versione precedente dell'app, l'intero pacchetto scende alla cipolla post-quantistica pura, quella di prima. E se una sessione ratchet non esiste ancora, il messaggio parte comunque col formato precedente invece di restare a terra. Mai il silenzio, mai qualcosa di pi\u00f9 debole di quello che c'era.",
      "Nel Barometro Radio si vede quanti vicini sanno fare la cipolla ibrida.",
      "70 prove automatiche nuove, fra cui: con la sola chiave ML-KEM uno strato ibrido non si apre (e viceversa), un percorso misto arriva comunque a destinazione, nessuna posizione del pacchetto rivela la lunghezza del messaggio, e due telefoni che conversano nei due sensi sulla mesh con il ratchet vero.",
    ],
    en: [
      "Hybrid mesh onion. On the local network every packet travels inside four layers, and until now each layer was sealed with lattice mathematics alone. From now on each layer also carries an ephemeral X25519 key: learning merely WHERE a packet is headed requires breaking both kinds of mathematics. It costs 32 bytes per layer, 128 out of 8192: a rounding error.",
      "The ratchet reaches the mesh. It was the last weak spot, and we said so in the Security panel: on the local network text was protected only by the recipient's mesh key, which is derived from their identity and never rotates. No forward secrecy, no self-healing. Now inside the onion there is the very same hybrid triple-ratchet envelope that would go through the server: a fresh key per message, a fresh curve per turn, a renewed post-quantum root. Anyone who copies the phone is locked out here too.",
      "This only became possible thanks to 1.8.0: a steady-state envelope weighs ~200 bytes instead of 11.5 KB, so it fits comfortably in a mesh packet. Before, it would not have.",
      "When the envelope is too large \u2014 which happens on the first message, the one carrying the session handshake \u2014 it is split into pieces, each inside ITS own onion and along ITS own route, and reassembled at the destination. The pieces live in memory only and expire in five minutes: nothing is left on the phone.",
      "Compatibility: if even a single hop on the route runs an older build, the whole packet steps down to the pure post-quantum onion, the previous one. And if a ratchet session does not exist yet, the message still leaves using the previous format instead of being stuck. Never silence, never anything weaker than what was there before.",
      "The Radio Barometer now shows how many neighbours can do the hybrid onion.",
      "70 new automated tests, including: a hybrid layer does not open with the ML-KEM key alone (and vice versa), a mixed route still reaches its destination, no position in the packet reveals the message length, and two phones holding a two-way mesh conversation with the real ratchet.",
    ],
  },
  {
    v: "1.8.0",
    date: "2026-06",
    it: [
      "Triplo ratchet ibrido. Fino a ieri la riservatezza delle tue chat poggiava su una sola matematica, quella dei reticoli (ML-KEM-768): solidissima, ma giovane. Da adesso ogni radice nasce da DUE segreti diversi \u2014 l'incapsulazione post-quantistica E un Diffie-Hellman su curva X25519 \u2014 concatenati. Per leggere una sola riga bisogna rompere entrambi i mondi. \u00c8 la scelta che ha fatto anche Signal, e non era ancora la nostra.",
      "La chiave su curva gira a OGNI cambio di direzione: se qualcuno riesce a copiare il tuo telefono, resta tagliato fuori dopo un solo scambio di messaggi. Il passo post-quantistico, che costa 2,6 KB, si rifa\u0300 ogni pochi turni: la sua eredit\u00e0 resta comunque dentro la radice per sempre.",
      "Aggancio delle sessioni legato all'identit\u00e0. La radice iniziale ora dipende da chi la riceve, da quale chiave usa-e-getta \u00e8 stata consumata e dai cifrati: un incapsulamento catturato non \u00e8 pi\u00f9 riutilizzabile in nessun altro contesto.",
      "La chiave usa-e-getta si butta appena ha aperto la sessione. Prima restava sul telefono fino a nove giorni: chi ti sequestrava il telefono la settimana dopo poteva ricostruire la radice di una conversazione iniziata oggi. Ora quella finestra \u00e8 chiusa.",
      "Messaggi 60 volte pi\u00f9 leggeri. La chiave pubblica ML-KEM da 1184 byte non viaggia pi\u00f9 in ogni messaggio: si annuncia al suo turno e poi si richiama con un'impronta da 8 byte, e tutto passa in base64 invece di esadecimale. Un messaggio di testo scende da 11,5 KB a 191 byte. Sulla mesh il conto \u00e8 ancora pi\u00f9 concreto: prima un messaggio occupava quattro pacchetti da 8 KB, ora ne occupa uno.",
      "Ogni messaggio porta con s\u00e9 tutto il necessario per aprirsi: non esiste pi\u00f9 un \u00abmessaggio chiave\u00bb che, se si perde, blocca la catena. \u00c8 esattamente quello che serviva sulla mesh, dove l'ordine di arrivo non lo decide nessuno.",
      "Compatibilit\u00e0 garantita: con chi ha ancora una versione precedente si scende automaticamente al ratchet post-quantistico puro. Nessuno resta senza messaggi, e non si scende MAI sotto quel livello.",
      "85 prove automatiche nuove sul solo ratchet, fra cui quelle che dimostrano che con la chiave ML-KEM giusta ma la curva sbagliata (e viceversa) non si apre nulla, e un collaudo dall'inizio alla fine contro il server vero.",
    ],
    en: [
      "Hybrid triple ratchet. Until yesterday your chats' confidentiality rested on a single kind of mathematics, lattices (ML-KEM-768): rock solid, but young. From now on every root is born from TWO different secrets \u2014 the post-quantum encapsulation AND an X25519 curve Diffie-Hellman \u2014 concatenated. Reading a single line requires breaking both worlds. It is the choice Signal made too, and it was not yet ours.",
      "The curve key turns at EVERY change of direction: if someone manages to copy your phone, they are locked out after a single exchange. The post-quantum step, which costs 2.6 KB, is redone every few turns \u2014 its legacy stays inside the root forever anyway.",
      "Session setup bound to identity. The initial root now depends on who receives it, on which one-time key was consumed and on the ciphertexts: a captured encapsulation is no longer reusable in any other context.",
      "The one-time key is destroyed the moment it has opened the session. Before, it lingered on the phone for up to nine days: someone seizing your phone next week could rebuild the root of a conversation started today. That window is now closed.",
      "Messages 60 times lighter. The 1184-byte ML-KEM public key no longer travels in every message: it is announced on its turn and then referenced with an 8-byte fingerprint, and everything moved from hexadecimal to base64. A text message drops from 11.5 KB to 191 bytes. On the mesh the arithmetic is even more concrete: a message used to take four 8 KB packets, now it takes one.",
      "Every message carries everything it needs to open itself: there is no longer a \u201ckey message\u201d that blocks the chain if lost. That is exactly what the mesh needed, where nobody decides the order of arrival.",
      "Compatibility guaranteed: with anyone still on an older build we step down automatically to the pure post-quantum ratchet. Nobody is left without messages, and we NEVER step below that level.",
      "85 new automated tests on the ratchet alone, including the ones proving that with the right ML-KEM key but the wrong curve (and vice versa) nothing opens, plus an end-to-end run against the real server.",
    ],
  },
  {
    v: "1.7.1",
    date: "2026-06",
    it: [
      "Corriere Offline. Se sei senza rete e nessuno dei telefoni vicini ce l'ha, il messaggio non resta fermo: lo affidi a un vicino qualsiasi, che lo porta con sé chiuso e lo consegna al server appena ritrova una connessione — anche ore dopo e chilometri più in là. Nel barometro della chat compare l'icona \u00abCorriere\u00bb.",
      "Il corriere non pu\u00f2 leggere nulla: porta un ticket e una busta gi\u00e0 cifrate punto-a-punto, non sa chi sia il mittente n\u00e9 il destinatario, e nel suo telefono resta solo un numero (quanti pacchetti sta portando). Tetto di 20 pacchetti e scadenza a 24 ore: nessuno pu\u00f2 usarti come deposito.",
      "Ponte Internet consolidato: se un vicino ha rete la spedizione passa subito da lui (icona \u00abPonte\u00bb); se la rete gli cade a met\u00e0 strada il pacchetto non viene buttato, passa in custodia e viene consegnato dopo.",
      "36 prove automatiche sul solo Ponte/Corriere, fra cui quelle che verificano che n\u00e9 il testo n\u00e9 il destinatario compaiano mai in chiaro nei pacchetti che escono.",
    ],
    en: [
      "Offline Courier. If you have no connection and none of the nearby phones has one either, your message does not sit still: you hand it to any neighbour, who carries it sealed and delivers it to the server as soon as they find a connection \u2014 even hours later and miles away. The chat barometer shows a \u201cCourier\u201d icon.",
      "The courier cannot read anything: they carry a ticket and an envelope already encrypted end-to-end, they do not know the sender or the recipient, and only a number stays on their phone (how many packets they are carrying). Cap of 20 packets and a 24-hour expiry: nobody can use you as a warehouse.",
      "Internet Bridge consolidated: if a neighbour has a connection the shipment goes through them immediately (\u201cBridge\u201d icon); if their connection drops halfway the packet is not dropped \u2014 it goes into custody and is delivered later.",
      "36 automated tests on Bridge/Courier alone, including the ones proving that neither the text nor the recipient ever appears in clear in the packets that leave the phone.",
    ],
  },
  {
    v: "1.7.0",
    date: "2026-06",
    it: [
      "Ponte Internet. Il tuo telefono senza rete pu\u00f2 spedire attraverso un telefono Lattice vicino che ha internet: la busta, gi\u00e0 cifrata per il destinatario, viaggia sulla mesh come cipolla a 4 salti e il vicino la spinge al server senza poterla aprire.",
      "Chat sulla mesh, radio Wi-Fi Direct e BLE per trovarsi senza infrastruttura, mixnet anti-timing e barometro visivo per vedere da dove \u00e8 passato l'ultimo messaggio.",
      "Doppio ratchet: catena di auto-guarigione che recupera da sola le sessioni desincronizzate, invece di lasciare messaggi illeggibili.",
      "Manutenzione automatica: i dispositivi non pi\u00f9 usati e le chiavi orfane vengono ripuliti da soli, sul telefono e sul server.",
    ],
    en: [
      "Internet Bridge. Your phone with no connection can send through a nearby Lattice phone that has internet: the envelope, already encrypted for the recipient, travels the mesh as a 4-hop onion and the neighbour pushes it to the server without being able to open it.",
      "Chat over the mesh, Wi-Fi Direct and BLE radios to find each other without infrastructure, anti-timing mixnet and a visual barometer showing where the last message went through.",
      "Double ratchet: a self-healing chain that recovers desynchronised sessions on its own instead of leaving messages unreadable.",
      "Automatic maintenance: unused devices and orphaned keys are cleaned up by themselves, on the phone and on the server.",
    ],
  },
  {
    v: "1.6.2",
    date: "2026-06",
    it: [
      "Prova la Mesh: in Impostazioni, con il Nodo Sovrano attivo, trovi due pulsanti per collaudare la rete con i tuoi occhi. Il primo invia un pacchetto di prova: lancialo su un telefono e leggi il codice comparire sull'altro, sulla stessa Wi-Fi. Il secondo prova il relay cieco: manda una cipolla a 4 salti indirizzata a te stesso, che esce davvero sulla rete e deve tornare completando tutti i salti.",
      "Serve a questo: finora del trasporto UDP e dell'inoltro avevamo solo prove di laboratorio. Questi due pulsanti li mettono alla prova sul mezzo fisico, e te lo mostrano con un codice e un tempo.",
      "I pacchetti di prova sono diagnostica: non fanno parte del protocollo anonimo e sono riconoscibili come tali.",
      "Banco di prova ripulito: eliminate le asserzioni che non verificavano nulla e aggiunta quella che mancava, che scandaglia ogni posizione del pacchetto in cerca di fughe di lunghezza. L'abbiamo messa alla prova ricreando la falla della 1.6.0: la trova.",
    ],
    en: [
      "Test the mesh: in Settings, with Sovereign Node on, you get two buttons to check the network with your own eyes. The first sends a test packet: run it on one phone and watch the code appear on the other, on the same Wi-Fi. The second tests the blind relay: it sends a 4-hop onion addressed to yourself, which really goes out on the network and must come back completing every hop.",
      "Why it matters: until now UDP transport and relaying only had lab proofs. These two buttons test them on the physical medium and show you a code and a time.",
      "Test packets are diagnostics: they are not part of the anonymous protocol and are recognisable as such.",
      "Test bench cleaned up: assertions that verified nothing were removed and the missing one was added, scanning every packet position for length leaks. We validated it by recreating the 1.6.0 flaw: it finds it.",
    ],
  },
  {
    v: "1.6.1",
    date: "2026-06",
    it: [
      "Correzione importante di sicurezza sul Nodo Sovrano. Una revisione indipendente ha dimostrato che nella 1.6.0 il routing anonimo era ricostruibile al 100%: un campo di lunghezza lasciato in chiaro faceva da filo conduttore fra i salti e rivelava anche la lunghezza esatta del messaggio.",
      "Protocollo riscritto: nel pacchetto non c'è più NESSUN dato in chiaro, il contenuto viaggia sempre a lunghezza fissa e i percorsi ricostruibili sono passati dal 100% allo 0%. Ora i salti sono 4, così mittente e destinatario non sono mai noti allo stesso nodo.",
      "Chiuse anche: l'aggiramento dell'anti-duplicato (si potevano fabbricare consegne multiple), l'inoltro che avveniva anche in Modalità Standard, il barometro gonfiabile con traffico finto e i messaggi d'errore che facevano da spia.",
      "Limite che resta, e lo diciamo chiaramente: su una Wi-Fi condivisa un osservatore può ancora seguire in parte i TEMPI degli inoltri. Abbiamo reso casuali le cadenze per ridurlo, ma non è risolto: la modalità resta SPERIMENTALE e le tue chat continuano a passare dal server.",
    ],
    en: [
      "Important security fix in Sovereign Node. An independent review proved that in 1.6.0 the anonymous routing could be reconstructed 100%: a length field left in clear acted as a thread linking the hops and also revealed the exact message length.",
      "Protocol rewritten: there is no cleartext data left in the packet, content always travels at fixed length, and reconstructable paths went from 100% to 0%. Hops are now 4, so sender and recipient are never known to the same node.",
      "Also closed: the duplicate-filter bypass (multiple deliveries could be forged), relaying that happened even in Standard mode, a barometer inflatable with fake traffic, and error messages that acted as an oracle.",
      "A limit remains, and we say it plainly: on a shared Wi-Fi an observer can still partly follow the TIMING of relays. We randomised the cadence to reduce it, but it is not solved: the mode stays EXPERIMENTAL and your chats keep going through the server.",
    ],
  },
  {
    v: "1.6.0",
    date: "2026-06",
    it: [
      "LATTICE SOVEREIGNTY (prima fase). In Impostazioni → Sicurezza puoi scegliere fra Modalità Standard e Nodo Sovrano: il tuo telefono diventa un nodo che può trasportare buste cifrate di altri utenti.",
      "Inoltro cieco (Blind Relay): ogni nodo apre solo il proprio strato e conosce due sole cose, il salto precedente e quello successivo. Mittente e destinatario non sono scritti da nessuna parte nella cipolla.",
      "Ogni pacchetto ha sempre la stessa dimensione e cambia completamente byte a ogni salto: due nodi complici non possono collegare le tratte. Chiavi ML-KEM-768 per ogni salto, quindi al riparo anche da futuri computer quantistici.",
      "Barometro della Privacy: ti dice quanto è viva la rete intorno a te (Isolata / Debole / Discreta / Robusta) contando SOLO i flussi cifrati, senza mai identificare un dispositivo.",
      "Il motore di rete gira in un processo separato dall'app, così l'interfaccia resta fluida.",
      "Sulla rete locale (stesso Wi-Fi) i telefoni si parlano anche senza Internet. La modalità AFFIANCA il server: se il server non risponde, la rete continua.",
      "Wi-Fi Direct e Bluetooth arriveranno nella fase successiva, dopo il collaudo su dispositivi reali: preferiamo dirtelo invece di promettere qualcosa di non verificato.",
    ],
    en: [
      "LATTICE SOVEREIGNTY (first phase). In Settings → Security you can choose between Standard mode and Sovereign Node: your phone becomes a node that can carry other users' encrypted envelopes.",
      "Blind Relay: every node opens only its own layer and knows just two things, the previous hop and the next one. Sender and recipient are written nowhere in the onion.",
      "Every packet always has the same size and its bytes change completely at each hop: two colluding nodes cannot link the legs. ML-KEM-768 keys per hop, so it is safe even against future quantum computers.",
      "Privacy Barometer: tells you how alive the network around you is (Isolated / Weak / Fair / Robust) by counting ONLY encrypted flows, never identifying a device.",
      "The network engine runs in a separate process from the app, so the interface stays smooth.",
      "On the local network (same Wi-Fi) phones talk to each other even without Internet. The mode works ALONGSIDE the server: if the server does not answer, the mesh carries on.",
      "Wi-Fi Direct and Bluetooth will arrive in the next phase, after testing on real devices: we prefer telling you rather than promising something unverified.",
    ],
  },
  {
    v: "1.5.5",
    date: "2026-06",
    it: [
      "Multi-Vestito per Dark Mesh: se il dominio di copertura è bloccato sulla tua rete, l'app ne prova automaticamente altri (Apple, Cloudflare, Microsoft) finché il tunnel funziona — collaudando una vera connessione prima di darlo per buono.",
      "Stato Privacy dal vivo in Impostazioni → Sicurezza: pallini verdi che mostrano a colpo d'occhio cosa è attivo (Rumore h24, Dark Mesh, Chiamate via relay).",
      "App più leggera da scaricare: il motore del tunnel ora è compresso nell'APK (~18 MB in meno a ogni aggiornamento).",
      "Sezione trasparenza aggiornata: spiegazioni chiare su Dark Mesh, Traffico di Rumore 24 ore su 24 e resistenza ai computer quantistici.",
    ],
    en: [
      "Multi-disguise for Dark Mesh: if the cover domain is blocked on your network, the app automatically tries others (Apple, Cloudflare, Microsoft) until the tunnel works — testing a real connection before trusting it.",
      "Live Privacy status in Settings → Security: green dots that show at a glance what is active (24/7 Noise, Dark Mesh, Relay calls).",
      "Smaller download: the tunnel engine is now compressed inside the APK (~18 MB less per update).",
      "Updated transparency section: clear explanations of Dark Mesh, 24/7 Invisible Traffic and quantum-computer resistance.",
    ],
  },
  {
    v: "1.5.4",
    date: "2026-06",
    it: [
      "Mimetizza il traffico (Dark Mesh): nuova opzione in Impostazioni → Sicurezza. Quando è attiva, il traffico dell'app viaggia in un tunnel e per chi osserva la rete sembra una normale navigazione su un grande sito pubblico — così non si vede nemmeno CHE stai usando Lattice.",
      "Non è una VPN di sistema: nessun permesso VPN, nessuna icona VPN fissa, passa solo il traffico di Lattice. Spento di default: lo accendi tu quando vuoi.",
      "Se il tunnel non parte, resti connesso normalmente: la protezione non ti lascia mai offline.",
    ],
    en: [
      "Camouflage traffic (Dark Mesh): new option in Settings → Security. When on, the app's traffic goes through a tunnel and, to anyone watching the network, looks like ordinary browsing of a big public site — so they cannot even see THAT you are using Lattice.",
      "It is not a system VPN: no VPN permission, no permanent VPN icon, only Lattice traffic goes through it. Off by default: you turn it on when you want.",
      "If the tunnel fails to start you stay connected normally: the protection never leaves you offline.",
    ],
  },
  {
    v: "1.5.3",
    date: "2026-06",
    it: [
      "Traffico invisibile anche a schermo spento: il rumore di rete continua in sottofondo pure quando non stai usando l'app, così sei protetto sempre — non solo mentre l'app è aperta.",
      "Quando la protezione è attiva vedi una notifica discreta e permanente \"Protezione traffico attiva\" (necessaria ad Android per far girare il servizio in background).",
      "L'interruttore \"Traffico invisibile\" in Impostazioni → Sicurezza ora comanda sia il rumore in primo piano sia quello in background.",
    ],
    en: [
      "Invisible traffic even with the screen off: the network noise keeps running in the background even when you are not using the app, so you are protected all the time — not only while the app is open.",
      "When protection is on you see a discreet, permanent \"Traffic protection active\" notification (required by Android to run the background service).",
      "The \"Invisible traffic\" switch in Settings → Security now controls both foreground and background noise.",
    ],
  },
  {
    v: "1.5.2",
    date: "2026-06",
    it: [
      "Protocollo invisibile. Chi controlla la rete (operatore, azienda, autorità) non vede il contenuto delle chat (già cifrate) e ora fatica anche a capire QUANDO e QUANTO comunichi.",
      "Traffico invisibile (rumore): l'app invia traffico casuale e continuo, così un messaggio vero si perde nel rumore e nessuno capisce quando scrivi o chiami. Lo attivi/disattivi in Impostazioni → Sicurezza.",
      "Ogni richiesta viaggia con un riempitivo di lunghezza casuale: le dimensioni dei pacchetti non rivelano più cosa stai facendo.",
      "Sul nostro server è attivo l'ingresso mimetizzato Dark Mesh (XTLS-Reality): per chi osserva, il traffico ha l'aspetto di una normale navigazione su un grande sito pubblico.",
    ],
    en: [
      "Invisible protocol. Whoever controls the network (carrier, employer, authority) cannot read your chats (already encrypted) and now struggles to tell WHEN and HOW MUCH you communicate.",
      "Invisible traffic (noise): the app sends constant random traffic, so a real message hides in the noise and nobody can tell when you are writing or calling. Toggle it in Settings → Security.",
      "Every request now carries random-length padding: packet sizes no longer reveal what you are doing.",
      "On our server the camouflaged Dark Mesh entrypoint (XTLS-Reality) is active: to an observer the traffic looks like ordinary browsing of a big public website.",
    ],
  },
  {
    v: "1.5.1",
    date: "2026-06",
    it: [
      "Verifica contatto immediata: la schermata dello Scudo si apre subito (prima ci voleva una decina di secondi) e il tasto Indietro risponde sempre.",
      "Torna il lettore QR: inquadri il codice dell'altro telefono e il controllo è automatico. La foto viene letta solo sul tuo telefono e poi buttata.",
      "Menu del contatto rifatto: pannello che si chiude col tasto Indietro, toccando fuori o con Chiudi (prima l'avviso di sistema restava incastrato).",
      "Chat che si apre all'istante: l'ultima pagina è già sul telefono (cifrata con la chiave del dispositivo) e compare senza aspettare la rete.",
      "Video in chat con anteprima e tasto play, al posto della vecchia riga grigia.",
      "Colori: 16 tinte e 9 sfondi, e la tinta scelta si vede ovunque — pulsanti, icone, liste, schede in basso e schermata di chiamata.",
    ],
    en: [
      "Instant contact verification: the Shield screen opens immediately (it used to take about ten seconds) and Back always responds.",
      "The QR reader is back: frame the code on the other phone and the check is automatic. The picture is read on your phone only, then discarded.",
      "Rebuilt contact menu: a panel that closes with Back, by tapping outside or with Close (the old system alert used to get stuck).",
      "Chats open instantly: the last page is already on your phone (encrypted with the device key) and shows up without waiting for the network.",
      "Videos in chat now have a preview tile with a play button instead of the old grey row.",
      "Colours: 16 accents and 9 backgrounds, and your accent now shows everywhere — buttons, icons, lists, bottom tabs and the call screen.",
    ],
  },
  {
    v: "1.1.4",
    date: "2026-08",
    it: [
      "Quando qualcuno ti aggiunge in rubrica ora ricevi una notifica: aprila e con un tocco lo aggiungi anche tu, così potete scrivervi subito.",
      "Aggiornamento automatico dell'app (dalla 1.1.2): niente più disinstallazioni.",
    ],
    en: [
      "When someone adds you to their address book you now get a notification: open it and add them back with one tap, so you can write immediately.",
      "Automatic app updates (since 1.1.2): no more uninstalling.",
    ],
  },
  {
    v: "1.1.2",
    date: "2026-08",
    it: [
      "Aggiornamento automatico: quando c'è una versione nuova compare un avviso in cima alle chat, premi AGGIORNA e l'app si aggiorna da sola — non devi più disinstallarla né cercare il file.",
      "In Impostazioni trovi anche CONTROLLA AGGIORNAMENTI per farlo quando vuoi.",
      "Se l'installazione non parte, l'app apre automaticamente il download nel browser; i file scaricati a metà vengono scartati.",
    ],
    en: [
      "Automatic updates: when a new version is out a banner appears above your chats, tap UPDATE and the app updates itself — no more uninstalling or hunting for the file.",
      "Settings also has CHECK FOR UPDATES to do it whenever you want.",
      "If the installer does not start, the app falls back to the browser download; truncated files are discarded.",
    ],
  },
  {
    v: "1.1.0",
    date: "2026-08",
    it: [
      "Contatti reciproci: per scriversi o chiamarsi bisogna essersi aggiunti a vicenda in rubrica. Se manca un lato, in rubrica compare \"in attesa che ti aggiunga\".",
      "Nuovo pulsante AGGIUNGI IN RUBRICA: sul biglietto da visita condiviso, nei risultati di ricerca, nella rubrica e accanto a ogni membro di un gruppo.",
      "Nuova scheda in Impostazioni: \"Come funzionano i contatti\", con la spiegazione completa della regola.",
    ],
    en: [
      "Mutual contacts: to chat or call each other you must both add each other to your address book. If one side is missing, the address book shows \"waiting for them to add you back\".",
      "New ADD TO ADDRESS BOOK button: on the shared business card, in search results, in the address book and next to every group member.",
      "New Settings card: \"How contacts work\", with the full explanation of the rule.",
    ],
  },
  {
    v: "1.0.99",
    date: "2026-08",
    it: [
      "Risolto: il biglietto da visita condiviso di un account aziendale dava \"Profilo non trovato\". Ora il link funziona sia per gli account personali sia per quelli aziendali.",
      "Pulsanti separati: CONDIVIDI IL MIO PROFILO nel Profilo e CONDIVIDI GRUPPO nella scheda del gruppo; sul sito ogni gruppo ha il suo pulsante CONDIVIDI nella lista.",
    ],
    en: [
      "Fixed: sharing a company account business card returned \"Profile not found\". The link now works for both personal and company accounts.",
      "Separate buttons: SHARE MY PROFILE in Profile and SHARE GROUP in the group info tab; on the website every group has its own SHARE button in the list.",
    ],
  },
  {
    v: "1.0.98",
    date: "2026-08",
    it: [
      "Nuovo: CONDIVIDI GRUPPO — dalla scheda Info del gruppo ottieni un link d'invito; chi lo apre chiede di entrare e gli amministratori approvano dalla scheda RICHIESTE.",
      "Nuovo: CONDIVIDI IL MIO PROFILO dalla schermata Profilo (biglietto da visita da inviare a chiunque).",
      "Ora puoi aggiungere ai gruppi anche i contatti esterni presenti in rubrica (contrassegnati come \"esterno\").",
    ],
    en: [
      "New: SHARE GROUP — get an invite link from the group Info tab; whoever opens it asks to join and admins approve from the REQUESTS tab.",
      "New: SHARE MY PROFILE from the Profile screen (a business card you can send to anyone).",
      "You can now add external contacts from your address book to groups (marked as \"external\").",
    ],
  },
  {
    v: "1.0.97",
    date: "2026-08",
    it: [
      "Risolto: dopo aver scelto la foto dalla galleria l'app chiedeva il PIN e tornava alla schermata iniziale perdendo la foto. Ora non si riblocca e la foto profilo si salva subito da sola.",
      "Anche la foto del gruppo si salva appena la scegli.",
      "Stessa correzione per gli allegati foto in chat e per i PDF dei concorsi.",
    ],
    en: [
      "Fixed: after picking a photo from the gallery the app asked for the PIN and returned to the home screen, losing the photo. It no longer re-locks and the profile photo saves immediately.",
      "Group photos are saved as soon as you pick them.",
      "Same fix for photo attachments in chat and for contest PDFs.",
    ],
  },
  {
    v: "1.0.95",
    date: "2026-08",
    it: [
      "Risolto: la foto del profilo e quella dei gruppi ora si salvano davvero (le foto del telefono erano troppo grandi e il salvataggio veniva rifiutato).",
      "Le foto scelte vengono ritagliate e ridimensionate automaticamente: caricamento più veloce e app più leggera.",
    ],
    en: [
      "Fixed: profile and group photos now actually save (phone photos were too large and the upload was rejected).",
      "Chosen photos are cropped and resized automatically: faster uploads and a lighter app.",
    ],
  },
  {
    v: "1.0.93",
    date: "2026-08",
    it: [
      "Chiamate SOLO da app: le chiamate dal sito web sono state disattivate (l'audio non arrivava in modo affidabile sul PC). Sul sito resta lo storico chiamate.",
      "Audio più affidabile: il media torna a passare sempre dal relay cifrato, così si sente in entrambi i versi su qualsiasi rete e il tuo IP resta nascosto.",
      "Risolto il conflitto di chiavi tra telefono e sito che poteva far fallire le chiamate.",
    ],
    en: [
      "Calls are app-only now: web calling has been disabled (audio was unreliable on desktop). The website keeps the call history.",
      "More reliable audio: media always goes through the encrypted relay, so both sides are heard on any network and your IP stays hidden.",
      "Fixed the key conflict between phone and website that could break calls.",
    ],
  },
  {
    v: "1.0.92",
    date: "2026-08",
    it: [
      "Chiamate più stabili anche dietro firewall e reti aziendali: ora la connessione può essere diretta (STUN pubblici) e il relay resta come riserva.",
      "Il telefono squilla subito: la notifica di chiamata arriva istantaneamente anche ad app chiusa o schermo bloccato, senza attese.",
      "Niente doppio suono: se il telefono ha già squillato, il server non manda la seconda notifica.",
      "Microfono e videocamera si attivano solo quando premi RISPONDI.",
    ],
    en: [
      "More reliable calls behind firewalls and corporate networks: direct P2P connection (public STUN) with relay as fallback.",
      "The phone rings instantly, even when the app is closed or the screen is locked — no more waiting.",
      "No double ringing: if the phone already rang, the server skips the second notification.",
      "Microphone and camera turn on only when you tap ANSWER.",
    ],
  },
  {
    v: "1.0.90",
    date: "2026-08",
    it: [
      "Pallino rosso sull'icona del telefono: vedi subito quante chiamate hai perso, e si azzera appena apri il registro.",
      "Sul sito ora si RICEVONO le chiamate: il browser squilla e puoi rispondere o rifiutare, come sul telefono.",
      "Le chiamate che rifiuti non vengono più contate come perse.",
    ],
    en: [
      "Red dot on the phone icon: see at a glance how many calls you missed; it clears as soon as you open the call log.",
      "The website now RECEIVES calls: the browser rings and you can answer or decline, just like on the phone.",
      "Calls you decline are no longer counted as missed.",
    ],
  },
  {
    v: "1.0.89",
    date: "2026-08",
    it: [
      "Registro chiamate con i filtri in alto: TUTTE, PERSE (in rosso, con il contatore), EFFETTUATE, RICEVUTE — ognuna con giorno e ora.",
      "Dal sito ora si può chiamare davvero: audio e video partono dal browser verso l'app, sempre cifrati end-to-end.",
    ],
    en: [
      "Call log with filters at the top: ALL, MISSED (in red, with counter), OUTGOING, INCOMING — each with day and time.",
      "Calls now work from the website too: audio and video start from the browser towards the app, always end-to-end encrypted.",
    ],
  },
  {
    v: "1.0.88",
    date: "2026-08",
    it: [
      "Ricerca dentro le chat: dalla lente, premi «Cerca dentro le chat» e ritrovi una frase detta tempo fa (i messaggi vengono decifrati sul tuo telefono).",
      "Registro chiamate finalmente completo: ogni chiamata viene registrata, così vedi le perse con data e ora e puoi richiamare con un tocco.",
      "Togli dalla rubrica un collega che non vuoi più vedere, senza bloccarlo: resta nell'azienda ma sparisce dalla tua lista.",
    ],
    en: [
      "Search inside chats: from the search screen tap \"Search inside chats\" to find a sentence from long ago (messages are decrypted on your phone).",
      "Call log finally complete: every call is recorded, so you see missed calls with date and time and can call back with one tap.",
      "Remove a colleague from your address book without blocking them: they stay in the company but disappear from your list.",
    ],
  },
  {
    v: "1.0.87",
    date: "2026-08",
    it: [
      "Ora chi chiama sente il tono di libero: prima durante la chiamata in uscita non si sentiva nulla.",
      "Sul sito, nella Rubrica, i tasti Blocca e Segnala compaiono anche per i colleghi dell'azienda (prima solo per i contatti salvati).",
    ],
    en: [
      "The caller now hears a ringback tone: previously outgoing calls were silent.",
      "On the website, the address book now shows Block and Report also for company colleagues (previously only for saved contacts).",
    ],
  },
  {
    v: "1.0.86",
    date: "2026-08",
    it: [
      "Videochiamate riparate: i dati della notifica arrivavano come testo, così ogni chiamata veniva aperta come videochiamata e il video restava nero. Ora audio e video vengono riconosciuti correttamente e, se l'offerta contiene il video, la videochiamata si apre anche se la notifica dice il contrario.",
      "Se la fotocamera è occupata la chiamata continua in sola voce invece di fallire, con un avviso a schermo.",
      "Chiamate ad app chiusa: chi chiama vede subito l'avviso «il destinatario non ha dispositivi registrati» invece di uno squillo a vuoto.",
      "Il token per le notifiche viene registrato anche quando riporti l'app in primo piano.",
    ],
    en: [
      "Video calls fixed: notification data arrived as text, so every call opened as a video call and the video stayed black. Audio and video are now detected correctly, and a video call opens whenever the offer contains video.",
      "If the camera is busy the call continues audio-only instead of failing, with an on-screen notice.",
      "Calls with the app closed: the caller is immediately told \"the recipient has no registered device\" instead of ringing into the void.",
      "The notification token is also registered when you bring the app back to the foreground.",
    ],
  },
  {
    v: "1.0.85",
    date: "2026-08",
    it: [
      "Notifiche riparate: il telefono registra le notifiche push a ogni avvio (prima serviva toccare l'interruttore nelle Impostazioni, e chi non l'aveva fatto non riceveva nulla).",
      "Nelle Impostazioni c'è la riga «Push su questo dispositivo» che ti dice se le notifiche sono attive, con tasto per riattivarle subito.",
      "Il «Contatto privacy» nelle Impostazioni ora apre una chat Lattice con fabioastorino@latticenetwork.lns invece di una email.",
      "Sul sito web la barra Cerca della Rubrica mostra anche i gruppi pubblici con il tasto «Chiedi di entrare».",
    ],
    en: [
      "Notifications fixed: the phone registers push notifications on every launch (previously you had to flip the switch in Settings, so devices that never did received nothing).",
      "Settings now shows a \"Push on this device\" row telling you whether notifications are active, with a button to enable them.",
      "\"Privacy contact\" in Settings now opens a Lattice chat with fabioastorino@latticenetwork.lns instead of an email.",
      "On the website, the Address Book search bar also shows public groups with an \"Ask to join\" button.",
    ],
  },
  {
    v: "1.0.84",
    date: "2026-08",
    it: [
      "Gruppi pubblici: dalla ricerca (lente in alto) trovi i gruppi pubblici e puoi premere «Chiedi di entrare». Gli amministratori del gruppo ricevono la richiesta e decidono se accettarla.",
      "Gestione richieste: nel pannello Gestisci del gruppo c'è la scheda «Richieste» per accettare o rifiutare chi vuole entrare.",
      "Rendi pubblico un gruppo: negli Info del gruppo l'admin può attivare «Gruppo pubblico» per farlo trovare nella ricerca.",
      "Esci dal gruppo: chi non è amministratore trova il tasto «Esci» in alto nel gruppo.",
      "Moderazione: quando sospendi o revochi un account devi indicare il motivo, che l'utente vede nella notifica e al login. Aggiunti anche «Blocca utente» ed «Elimina account» nel pannello Segnalazioni.",
    ],
    en: [
      "Public groups: from search you can find public groups and tap \"Ask to join\". Group admins receive the request and approve it.",
      "Requests management: the group Manage panel has a \"Requests\" tab to accept or reject join requests.",
      "Make a group public: in group Info, admins can enable \"Public group\" to make it findable in search.",
      "Leave group: non-admin members find a \"Leave\" button at the top of the group.",
      "Moderation: suspending or revoking an account now requires a reason, shown to the user in the notification and at login. Added \"Block user\" and \"Delete account\" in the Reports panel.",
    ],
  },
  {
    v: "1.0.83",
    date: "2026-08",
    it: [
      "Notifica push all'owner quando arriva una nuova segnalazione: toccandola si apre direttamente il pannello Segnalazioni.",
      "Nel pannello Segnalazioni ora puoi sospendere temporaneamente, riattivare o revocare definitivamente l'account segnalato.",
      "L'utente sospeso o revocato riceve una notifica e non può più accedere (né da app né da web).",
    ],
    en: [
      "Push notification to the owner when a new report arrives: tapping it opens the Reports panel directly.",
      "In the Reports panel you can now suspend, reactivate or permanently revoke the reported account.",
      "Suspended or revoked users get a notification and can no longer sign in (app or web).",
    ],
  },
  {
    v: "1.0.82",
    date: "2026-08",
    it: [
      "Segnalazioni abusi nell'app: il profilo owner trova in Impostazioni la nuova voce \"Segnalazioni abusi\" per leggere, chiudere o eliminare le segnalazioni degli utenti.",
    ],
    en: [
      "Abuse reports in the app: the owner profile finds a new \"Abuse reports\" entry in Settings to review, close or delete user reports.",
    ],
  },
  {
    v: "1.0.81",
    date: "2026-08",
    it: [
      "Blocca e segnala: dal menu di un contatto in Rubrica puoi bloccarlo (non vi scriverete più) o segnalarlo agli amministratori con un tocco.",
      "I contatti bloccati mostrano il simbolo di divieto e possono essere sbloccati quando vuoi.",
    ],
    en: [
      "Block and report: from a contact's menu in the Address book you can block them (no more messages) or report them to the admins in one tap.",
      "Blocked contacts show a ban icon and can be unblocked anytime.",
    ],
  },
  {
    v: "1.0.80",
    date: "2026-08",
    it: [
      "Rubrica: ora puoi eliminare un contatto (con conferma) direttamente dalla lista.",
      "Profilo: foto, bio e visibilità nella directory si cambiano quando vuoi, anche dopo la registrazione.",
      "Impostazioni: nuovo \"Biglietto da visita\" — condividi con un tocco la tua pagina pubblica con foto e bio.",
      "Privacy account personali: nella rubrica vedi solo i TUOI contatti (gli altri si trovano cercandoli nella directory).",
      "Account personali e account aziendali possono cercarsi ma non scriversi: le aziende restano isolate.",
    ],
    en: [
      "Address book: you can now delete a contact (with confirmation) straight from the list.",
      "Profile: photo, bio and directory visibility can be changed anytime, also after signup.",
      "Settings: new \"Business card\" — share your public page with photo and bio in one tap.",
      "Personal account privacy: the address book shows only YOUR contacts (others are found via directory search).",
      "Personal and company accounts can find each other but not message each other: companies stay isolated.",
    ],
  },
  {
    v: "1.0.79",
    date: "2026-08",
    it: [
      "Account personali: chiunque può creare la propria identità Lattice (nomeutente@lattice.lns) dal login, con le chiavi generate sul telefono.",
      "Foto e bio in registrazione + directory pubblica: cerca altri utenti dalla Rubrica e aggiungili con un tocco.",
      "Invita un amico: in Impostazioni trovi il tuo link personale; chi si registra da lì diventa subito un tuo contatto.",
      "Scudo: bloccati i link di invito a gruppi di altri social (WhatsApp, Telegram, Discord, Facebook, Signal).",
      "Promemoria quiz più puntuale (controllo ogni 15 secondi) e, toccando la notifica, si apre direttamente il Ripasso.",
    ],
    en: [
      "Personal accounts: anyone can create their own Lattice identity (username@lattice.lns) from the login screen, with keys generated on the device.",
      "Photo and bio at signup + public directory: search other users from the Address book and add them with one tap.",
      "Invite a friend: find your personal link in Settings; whoever signs up from it becomes your contact right away.",
      "Shield: invite links to groups on other social networks (WhatsApp, Telegram, Discord, Facebook, Signal) are now blocked.",
      "More punctual quiz reminder (checked every 15 seconds) and tapping the notification opens Practice directly.",
    ],
  },
  {
    v: "1.0.74",
    date: "2026-06",
    it: [
      "Nuova opzione 'Suoneria del telefono': usa suoneria e vibrazione predefinite del sistema al posto di quelle dell'app.",
      "Il pulsante Rifiuta ora avvisa subito chi chiama (la chiamata si chiude, niente attesa fino al timeout).",
    ],
    en: [
      "New 'Phone ringtone' option: use the system default ringtone and vibration instead of the app ones.",
      "The Decline button now notifies the caller immediately (call ends, no waiting until timeout).",
    ],
  },
  {
    v: "1.0.73",
    date: "2026-06",
    it: [
      "Suoneria, volume e vibrazione ora sono in una schermata dedicata: Impostazioni > Notifiche.",
      "Chiamata in arrivo: pulsanti Rispondi e Rifiuta direttamente sulla notifica a tutto schermo.",
    ],
    en: [
      "Ringtone, volume and vibration are now in a dedicated screen: Settings > Notifications.",
      "Incoming call: Answer and Decline buttons right on the full-screen notification.",
    ],
  },
  {
    v: "1.0.72",
    date: "2026-06",
    it: [
      "Correzione: toccando la notifica di un messaggio si apre di nuovo la chat giusta.",
      "Correzione: la lista conversazioni torna a mostrare i messaggi non letti e chi ha scritto.",
    ],
    en: [
      "Fix: tapping a message notification opens the correct chat again.",
      "Fix: the conversation list shows unread messages and the sender again.",
    ],
  },
  {
    v: "1.0.69",
    date: "2026-06",
    it: [
      "Chiamate a schermo intero (full-screen) quando il telefono è bloccato, come una vera telefonata.",
      "Inoltra ora include foto e file, non solo il testo (lato web).",
      "Nuova schermata Novità con lo storico completo delle versioni.",
    ],
    en: [
      "Full-screen incoming calls on the lock screen, just like a native phone call.",
      "Forward now includes photos and files, not just text (web).",
      "New What's new screen with the full version history.",
    ],
  },
  {
    v: "1.0.68",
    date: "2026-06",
    it: [
      "Versione dell'app mostrata sempre corretta nelle Impostazioni.",
      "Vibrazione configurabile per le chiamate (Disattivata / Standard / Breve / Lunga).",
    ],
    en: [
      "In-app version shown in Settings is now always accurate.",
      "Configurable call vibration (Off / Standard / Short / Long).",
    ],
  },
  {
    v: "1.0.67",
    date: "2026-06",
    it: [
      "Squillo anche ad app chiusa: le chiamate arrivano come notifica push e aprono la schermata in arrivo.",
      "Chiamata persa registrata automaticamente dopo 30 secondi senza risposta.",
      "Suonerie: Classica, Chime, Beep, Digitale, Marimba, Pulsazione + controllo volume.",
      "Richiama un contatto toccando la riga nel registro chiamate.",
      "Fix videochiamata: il video dell'altra persona ora si vede correttamente.",
    ],
    en: [
      "Rings even when the app is closed: calls arrive as a push and open the incoming screen.",
      "Missed call automatically logged after 30 seconds without an answer.",
      "Ringtones: Classic, Chime, Beep, Digital, Marimba, Pulse + volume control.",
      "Call back a contact by tapping the row in the call log.",
      "Video call fix: the other person's video now shows correctly.",
    ],
  },
  {
    v: "1.0.6x",
    date: "2026",
    it: [
      "Stati 24h cifrati end-to-end (testo e immagini) con reazioni e conferme di visualizzazione.",
      "Azioni messaggio: Fissa, Traduci, Inoltra, Rispondi, Reazioni, Elimina, Segnala.",
      "Allegati cifrati end-to-end (foto e file) in chat 1:1 e nei gruppi.",
      "Chiamate e videochiamate 1:1 cifrate end-to-end con verifica SAS.",
    ],
    en: [
      "24h end-to-end encrypted Status (text and images) with reactions and read receipts.",
      "Message actions: Pin, Translate, Forward, Reply, Reactions, Delete, Report.",
      "End-to-end encrypted attachments (photos and files) in 1:1 and group chats.",
      "End-to-end encrypted 1:1 audio and video calls with SAS verification.",
    ],
  },
];

export default function WhatsNewScreen({ navigation }) {
  const { lang } = useI18n();
  const en = lang === "en";
  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} testID="whatsnew-back" style={{ padding: 4 }}>
          <Ionicons name="chevron-back-outline" size={26} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.hTitle}>{en ? "What's new" : "Novità"}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} testID="whatsnew-list">
        {CHANGELOG.map((rel) => (
          <View key={rel.v} style={styles.card} testID={`whatsnew-v-${rel.v}`}>
            <View style={styles.vRow}>
              <View style={styles.vBadge}><Text style={styles.vBadgeTxt}>v{rel.v}</Text></View>
              <Text style={styles.vDate}>{rel.date}</Text>
            </View>
            {(en ? rel.en : rel.it).map((line, i) => (
              <View key={i} style={styles.bullet}>
                <Ionicons name="sparkles-outline" size={14} color={theme.primary} style={{ marginTop: 3 }} />
                <Text style={styles.bulletTxt}>{line}</Text>
              </View>
            ))}
          </View>
        ))}
        <Text style={styles.footer}>{en ? "Thanks for using Lattice Pulse." : "Grazie per usare Lattice Pulse."}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border },
  hTitle: { color: theme.text, fontSize: 20, fontWeight: "800", marginLeft: 4 },
  card: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 14, padding: 14, marginBottom: 12 },
  vRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  vBadge: { backgroundColor: theme.primary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3 },
  vBadgeTxt: { color: "#fff", fontWeight: "800", fontSize: 13 },
  vDate: { color: theme.textFaint, fontSize: 12 },
  bullet: { flexDirection: "row", gap: 8, marginBottom: 8 },
  bulletTxt: { color: theme.textDim, fontSize: 14, flex: 1, lineHeight: 20 },
  footer: { color: theme.textFaint, fontSize: 12, textAlign: "center", marginTop: 8 },
});

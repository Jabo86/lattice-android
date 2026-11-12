# ULTRON Android — migrazione notifiche al nodo autonomo

## Configurazione
- Nodo notifiche: `49.12.242.0` tramite HTTPS.
- Notifiche native: `WakeService` usa long-poll `GET /api/public/wake/poll?rid=...&wait=25`.
- Registrazione del gettone opaco lato account: `POST /api/public/pulse/wake/register` (la richiesta passa da `src/lib/api.js`, con prefisso `/api`).
- Nessun token push Firebase/FCM, né invio a Firebase/Expo Push.
- Manifest e plugin Google Services rimossi; i canali Android sono notifiche locali.
- La configurazione HTTPS richiede **certificato TLS valido per l'IP 49.12.242.0** (IP address SAN). Non disabilitare la verifica TLS.

## Requisiti backend ancora da verificare
1. Il servizio sull'IP espone le rotte `/api/public/pulse/wake/register`, `/api/public/pulse/wake/revoke` e `/api/public/wake/poll` con semantica e autenticazione compatibili.
2. La chiamata API deve funzionare con HTTPS: un certificato valido solo per un dominio non basta quando il client contatta un IP.
3. Verificare Android 13–16: permesso POST_NOTIFICATIONS, foreground service, avvio dopo reboot, standby/Doze, battery optimization, limitazioni di durata foreground-service per dataSync.
4. Testare chiamate in arrivo e messaggi a schermo spento e app terminata; il long-poll non offre da solo affidabilità identica a push di sistema.
5. Completare migrazione identità, URI, pannelli e backend: non considerare la semplice sostituzione del default server come garanzia di compatibilità.
6. Per la compilazione dell'APK, `android/app/libs/libv2ray.aar` deve essere generato con `tools/build-libv2ray.sh` (non è versionato), e occorre Android SDK, NDK, Go/gomobile, Gradle, signing.
7. Controllare sicurezza e funzionamento del protocollo E2E/PQC con test integrati: la presenza di librerie non costituisce verifica.

## Nota build
I repository Maven `google()` di Gradle sono **repository di build Android**, non Google Play Services o Firebase a runtime. La loro rimozione non è inclusa in questa fase perché potrebbe rendere impossibile compilare l'app.

## Stato
Sorgenti modificati; **nessun APK costruito o testato** e nessuna conferma live del servizio sull'IP. Non distribuire come release finché i test non passano.

# WEB CALL — Fase 1 (chiamate audio 1:1 sul client web) — SPEC turnkey

Obiettivo: chiamate audio web ↔ mobile compatibili al 100%, riusando l'ESATTO stack del mobile.

## STATO
- [x] `web-crypto.js` — bundle browser di `src/lib/crypto.js` (identico al mobile). Servito su `/web-crypto.js`. Export: anonSharedSecret, signMessage, verifyMessage, encryptForRecipients, decryptEnvelope, computeSAS, deriveDhKeypair/KemKeypair, parseKeyfile, bytesToHex...
- [x] `web-anoncall.js` — bundle di `src/lib/anonCall.js`. Servito su `/web-anoncall.js`. Export: `anonEpoch`, `anonEpochs`, `discRid(shared,callerLns,calleeLns,epoch)`, `newChan()`, `sealInvite(invite,calleeKemPk)`, `openInvite(ping,myKemSk)`, `ICE_SERVERS`.
- [ ] `web-call.js` — engine chiamata + UI (DA FARE).
- [ ] Wiring in `index.html` (script defer) — SOLO dopo test, per non rompere il web live.
- [ ] Test reale web ↔ telefono.

## PROTOCOLLO (da CallScreen.js) — replicare fedelmente
Segnali via endpoint anon PUBBLICI (no auth): `POST /api/public/anon/put {rid,slot,data}`, `POST /api/public/anon/get {rid,ice_c_from,ice_e_from}` (o /poll).
- **Canale**: `chan = newChan()` (rid casuale) generato dal CHIAMANTE, incluso nell'invito.
- **Slot**: `ping` (invito, sul rid-scoperta), `answer` (sul chan), `ice_c` (candidati chiamante), `ice_e` (candidati chiamato), `bye`.
- **Rid-scoperta (blind rendezvous)**: `shared = anonSharedSecret(myDhSk, calleeDhPk)`; `rid = discRid(shared, callerLns, calleeLns, anonEpoch())`. Il chiamato NON conosce il chan finché non riceve il ping → per ricevere DEVE pollare `discRid(shared_i, contatto_i, me, epoch)` per OGNI contatto noto × `anonEpochs()` (epoca corrente e precedente).

### CHIAMANTE (outgoing)
1. getUserMedia({audio:true}). `pc = new RTCPeerConnection({iceServers:ICE_SERVERS, iceTransportPolicy:"relay"})`. localIce="ice_c", remoteIce="ice_e".
2. addTrack; `offer = createOffer({offerToReceiveAudio:true})`; setLocalDescription; `offer_sig = signMessage(offer.sdp, mySk)`.
3. `invite = {from:myLns, from_pk:myPk, from_kem:myKemPk, video:false, chan, offer:{type,sdp}, offer_sig}`.
4. `ping = sealInvite(invite, calleeKemPk)`; `anonPut(discRid(shared,myLns,to,anonEpoch()), "ping", ping)`.
5. onicecandidate → `anonPut(chan, "ice_c", cand)`.
6. Poll `anonGet(chan, iceCFrom, iceEFrom)`: se arriva `answer` (cifrato KEM) → `decryptEnvelope(ans, myKemSk)` → verifyMessage(ans.answer.sdp, ans.answer_sig, ans.to_pk) → setRemoteDescription; applica candidati `ice_e`.

### CHIAMATO (incoming)
1. Riceve `ping` pollando i propri rid-scoperta (+ push/FCM sul mobile; sul web = polling continuo).
2. `invite = openInvite(ping, myKemSk)`; verifyMessage(invite.offer.sdp, invite.offer_sig, invite.from_pk). chan=invite.chan; localIce="ice_e", remoteIce="ice_c". peerKem=invite.from_kem.
3. getUserMedia; pc; setRemoteDescription(invite.offer); createAnswer; setLocalDescription; `answer_sig=signMessage(answer.sdp,mySk)`.
4. `ansObj={answer:{type,sdp}, answer_sig, to_pk:myPk}`; `sealed = encryptForRecipients(JSON.stringify(ansObj), {c:peerKem})[0]`; `anonPut(chan,"answer",sealed)`.
5. onicecandidate → anonPut(chan,"ice_e",cand). Poll ice_c e addIceCandidate.

### SAS (verifica MITM)
`computeSAS(localFingerprint, remoteFingerprint)` dai fingerprint DTLS estratti dagli SDP (righe `a=fingerprint:`). Mostrare le stesse parole/emoji su entrambi.

## COMPONENTI MANCANTI PER L'ENGINE WEB
1. **Keyfile utente**: da `localStorage` (già presente nel client web) → `parseKeyfile` per ottenere sk/pk/kem/dh.
2. **Mappe chiavi contatti (dhMap/kemMap)**: il mobile le ottiene via API autenticata. Serve individuare/riusare l'endpoint che ritorna le pubkey DH/KEM dei contatti del tenant (necessario per derivare i rid-scoperta e cifrare l'invito). VERIFICARE in `api.js` mobile la funzione usata per popolare kemMap/dhMap.
3. **UI**: pulsante chiamata nella conversazione web + banner chiamata in arrivo + schermata in-call (mute/hangup + SAS).
4. **Polling incoming**: loop che calcola i rid-scoperta per ogni contatto×epoche e chiama anonGet; su web non c'è FCM → polling (es. ogni 3-5s) mentre l'app web è aperta.

## NOTE
- TURN forzato (`iceTransportPolicy:"relay"`) → nessun IP leak; richiede coturn attivo (lo è).
- NON iniettare `web-call.js` in `index.html` finché non testato: rischio di rompere il web live.
- Test: 2 endpoint reali (browser + telefono), microfono, coturn. Verificare: squillo, answer, audio bidirezionale, SAS uguale, hangup.

## RISOLTO — chiavi contatti (componente #2)
- Pubblica le proprie pubkey al login: `POST /api/public/pulse/publish-key {kem_pk_hex, dh_pk_hex}` (api.publishKey).
- Ottieni le pubkey dei contatti: `POST /api/public/directory/resolve {lns_list}` (api.directoryResolve) → costruisci dhMap/kemMap. Entrambi richiedono sessione autenticata.

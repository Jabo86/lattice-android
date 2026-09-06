// AUDIO — v2.5.0. Voce vicina, chiara, e a portata costante.
//
// Tre scelte, tutte con un motivo:
//
// 1. `useinbandfec=1` — correzione d'errore DENTRO il flusso Opus. Su una rete che perde
//    pacchetti (4G in movimento, Wi-Fi affollato) il decoder ricostruisce la sillaba
//    mancante invece di lasciare il buco che si sente come "robotico". Costa qualche kbps.
//
// 2. `usedtx=0` + `cbr=1` — portata COSTANTE, anche in silenzio. Il comportamento normale
//    del VoIP e' l'opposto: si smette di trasmettere quando nessuno parla, e si risparmia.
//    Ma quel risparmio disegna sulla rete la forma esatta della conversazione: chi guarda
//    il traffico cifrato vede QUANDO parli, per quanto, e chi risponde — l'analisi delle
//    pause e' una tecnica vecchia e funziona. Con bitrate costante la chiamata e' un muro
//    piatto di byte: e' il chaffing applicato alla voce. Costa banda; e' voluto.
//
// 3. `maxaveragebitrate=40000` + `ptime=20` — 40 kbps mono su banda larga Opus e' voce
//    "in stanza", non "al telefono". 20 ms di pacchetto e' il compromesso classico fra
//    latenza e overhead di rete.
//
// La cancellazione d'eco, la soppressione del rumore e il guadagno automatico li fa il
// motore audio di WebRTC: qui li si chiedono in modo esplicito, perche i valori
// predefiniti cambiano da telefono a telefono.

/// Vincoli del microfono. Mono a 48 kHz: lo stereo su un microfono da telefono non aggiunge
/// informazione e raddoppia i byte.
export const MIC = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
  sampleRate: 48000,
};

export const MEDIA_CONSTRAINTS = { audio: MIC, video: false };

const FMTP = "minptime=10;useinbandfec=1;usedtx=0;cbr=1;stereo=0;sprop-stereo=0;maxaveragebitrate=40000";

/// Payload type di Opus dentro un SDP. Restituisce "" se non c'e'.
export function opusPt(sdp) {
  const m = /a=rtpmap:(\d+) opus\/48000/i.exec(String(sdp || ""));
  return m ? m[1] : "";
}

/// Ritocca l'SDP: Opus per primo, parametri sopra, ptime 20 ms.
/// Pura e senza dipendenze, cosi si prova senza aprire una chiamata.
export function tuneSdp(sdp) {
  let s = String(sdp || "");
  if (!s) return s;
  const pt = opusPt(s);
  if (!pt) return s;

  // Parametri di Opus: si sostituisce l'fmtp esistente, o se ne aggiunge uno.
  const fmtpRe = new RegExp("a=fmtp:" + pt + " [^\\r\\n]*", "i");
  if (fmtpRe.test(s)) s = s.replace(fmtpRe, "a=fmtp:" + pt + " " + FMTP);
  else s = s.replace(new RegExp("(a=rtpmap:" + pt + " opus\\/48000[^\\r\\n]*)"), "$1\r\na=fmtp:" + pt + " " + FMTP);

  // Opus in testa all'elenco dei codec: alcuni telefoni offrono prima PCMU (8 kHz, voce
  // "da citofono") e l'altro lato lo accetta perche' e' il primo della lista.
  s = s.replace(/^m=audio (\d+) ([^ \r\n]+) ([^\r\n]+)$/m, (all, port, proto, list) => {
    const pts = list.trim().split(/\s+/);
    if (pts[0] === pt) return all;
    return "m=audio " + port + " " + proto + " " + [pt].concat(pts.filter((x) => x !== pt)).join(" ");
  });

  // Durata del pacchetto.
  if (!/^a=ptime:/m.test(s)) {
    s = s.replace(/^(m=audio [^\r\n]*\r?\n)/m, "$1a=ptime:20\r\na=maxptime:60\r\n");
  }
  return s;
}

/// Applica il ritocco a un oggetto offer/answer, senza toccare il tipo.
export function tuned(desc) {
  if (!desc || !desc.sdp) return desc;
  return { type: desc.type, sdp: tuneSdp(desc.sdp) };
}

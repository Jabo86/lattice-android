// Lattice Threat Shield — motore anti-minacce 100% on-device (nessuna API esterna).
// Analizza testo/link (phishing, malware, truffe) e allegati (eseguibili mascherati,
// macro, firma magic-bytes, EICAR). Tutto locale: nessun dato esce dal dispositivo.

const DANGER_EXT = ["exe","apk","scr","bat","cmd","com","pif","vbs","vbe","js","jse","jar","msi","msp","ps1","psm1","wsf","wsh","hta","dll","lnk","reg","cpl","msc","gadget","inf","sct","shb","sys","dmg","deb","run"];
const MACRO_EXT = ["docm","xlsm","pptm","dotm","xltm","potm","xlam","ppam"];
const SUSPICIOUS_TLD = ["zip","mov","xyz","top","tk","ml","ga","cf","gq","click","country","kim","work","rest","fit","loan","men","gdn","review","stream","download","racing","science","party","date","win","bid","trade","accountant","cricket","faith","webcam","cam","quest","cfd","sbs","autos"];
const SHORTENERS = ["bit.ly","tinyurl.com","t.co","goo.gl","is.gd","cutt.ly","ow.ly","buff.ly","rebrand.ly","shorturl.at","rb.gy","t.ly","tiny.cc","bit.do","soo.gd","short.io","clck.ru","v.gd","x.co","tr.im"];
const BRANDS = ["paypal","postepay","bancoposta","poste","intesasanpaolo","intesa","unicredit","nexi","inps","agenziaentrate","spid","microsoft","office365","apple","icloud","google","gmail","amazon","netflix","facebook","instagram","whatsapp","dhl","fedex","brt","gls","coinbase","binance","metamask","trustwallet","booking"];

// Parole chiave di malware/attacco: se compaiono nell'host o nel percorso del link
// il link è considerato PERICOLOSO (danger) e viene bloccato.
const MALWARE_TOKENS = ["virus","malware","trojan","ransom","ransomware","spyware","keylog","keylogger","rootkit","botnet","worm","exploit","payload","backdoor","phish","phishing","hack","hacked","cracked","warez","keygen","stealer","malicious","badware","infected","drainer","cryptolock"];
// Parole "sensibili" tipiche del phishing (finti login bancari/credenziali).
const SENSITIVE_TOKENS = ["bank","login","signin","logon","verify","secure","account","wallet","unlock","recover","confirm","password","billing","payment","update-info","fake"];
// Contenuti per adulti / pornografici / dating-spam → link BLOCCATO (danger). Match nell'HOST.
const ADULT_SUBSTR = ["porn","xxx","xvideo","xnxx","pornhub","redtube","youporn","chaturbate","onlyfans","fansly","brazzers","xhamster","hentai","camsex","sexcam","sexchat","sexdate","livecam","camgirl","adultfriendfinder","adultdating","getlaid","escort","fetish","fuckbook","fuckbuddy","milfs","nudes","sexy","dating","hookup","incontrihot","bacheca-incontri","cam4","stripchat","livejasmin","bongacams","erotic","erotik","camwhore"];
const ADULT_WORD = ["sex","nude","milf","anal","fling","incontri","viagra","cialis","adult"];
// Link di invito a GRUPPI di altri social (WhatsApp/Telegram/Discord/Facebook/Signal…) → BLOCCATO.
const SOCIAL_GROUP_INVITE = [/^chat\.whatsapp\.com\//, /^(t|telegram)\.me\/(joinchat|\+)/, /^telegram\.dog\//, /^(www\.)?discord\.(gg|me)\//, /^(www\.)?discord(app)?\.com\/invite\//, /^(www\.|m\.|web\.)?facebook\.com\/groups\//, /^(www\.)?fb\.(com|me)\/groups\//, /^m\.me\/j\//, /^ig\.me\/j\//, /^(www\.)?signal\.group\//, /^invite\.viber\.com\//, /^join\.skype\.com\//, /^(www\.)?groupme\.com\/join_group\//];

const PHISH = [
  { re: /verifica(re)?\s+(subito\s+)?(il\s+tuo|l['’]|il)\s+account/i, it: "Richiesta sospetta di verifica account", en: "Suspicious account verification request" },
  { re: /account\s+(è\s+stato\s+)?(bloccat|sospes|limitat|disattivat)/i, it: "Falso avviso di account bloccato", en: "Fake 'account blocked' notice" },
  { re: /conferma(re)?\s+(le\s+tue\s+|i\s+tuoi\s+)?(credenziali|password|dati\s+di\s+accesso)/i, it: "Richiesta di credenziali", en: "Credential request" },
  { re: /aggiorna(re)?\s+(i\s+)?(dati|metodo)\s+di\s+pagamento/i, it: "Richiesta dati di pagamento", en: "Payment details request" },
  { re: /password\s+(è\s+)?(scadut|in\s+scadenza)/i, it: "Falso avviso password scaduta", en: "Fake password expiry" },
  { re: /clicca\s+(qui|sul\s+link)\s+(subito|ora|entro)/i, it: "Sollecito urgente a cliccare", en: "Urgent click bait" },
  { re: /(hai\s+vinto|premio|buono\s+regalo|gift\s+card)/i, it: "Falsa vincita / premio", en: "Fake prize / gift" },
  { re: /entro\s+(24|48)\s+ore/i, it: "Falsa urgenza (scadenza)", en: "Fake urgency (deadline)" },
  { re: /codice\s+(otp|di\s+verifica|pin)/i, it: "Richiesta codice OTP/PIN", en: "OTP/PIN request" },
  { re: /(cambio|aggiornamento)\s+(di\s+)?iban/i, it: "Possibile truffa cambio IBAN", en: "Possible IBAN-change fraud" },
  { re: /(seed\s+phrase|frase\s+di\s+recupero|chiave\s+privata|private\s+key|recovery\s+phrase)/i, it: "Richiesta chiave privata/seed (truffa cripto)", en: "Private key/seed request (crypto scam)" },
  { re: /rimborso\s+(fiscale|inps|agenzia|tasse)/i, it: "Falso rimborso", en: "Fake refund" },
  { re: /verify\s+your\s+account|confirm\s+your\s+(password|identity)/i, it: "Richiesta verifica account", en: "Account verification request" },
  { re: /(you['’ ]?ve\s+won|claim\s+your\s+(prize|reward))/i, it: "Falsa vincita / premio", en: "Fake prize / reward" },
];

// Regex estrazione URL (http/https e domini nudi tipo www.x.tld/…)
export const URL_RE = /((?:https?:\/\/|www\.)[^\s<>"']+|[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+\.[a-z]{2,}(?:\/[^\s<>"']*)?)/gi;
const IP_HOST_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

function pick(r, lang) { return lang === "en" ? r.en : r.it; }
function worst(a, b) { const o = { safe: 0, warn: 1, danger: 2 }; return o[a] >= o[b] ? a : b; }

// Blacklist domini aggiornabile da feed remoto gratuito (URLhaus). In memoria.
let REMOTE_DOMAINS = new Set();
export function setThreatDomains(list) {
  try { REMOTE_DOMAINS = new Set((list || []).map((d) => String(d).toLowerCase().trim()).filter(Boolean)); } catch { /* ignore */ }
}
export function threatListSize() { return REMOTE_DOMAINS.size; }

function parseHost(url) {
  try {
    const withProto = /^https?:\/\//i.test(url) ? url : "https://" + url;
    const u = new URL(withProto);
    return { host: (u.hostname || "").toLowerCase(), path: (u.pathname || "") + (u.search || ""), href: u.href, hasAuth: !!u.username, proto: u.protocol };
  } catch { return null; }
}

export function scanUrl(rawUrl, lang = "it") {
  const reasons = [];
  let level = "safe";
  const url = rawUrl.replace(/[.,);]+$/, "");
  const p = parseHost(url);
  if (!p) return { url, level: "safe", reasons };
  const { host, path, hasAuth, proto } = p;
  const parts = host.split(".");
  const tld = parts[parts.length - 1];
  const domain = parts.slice(-2).join(".");
  const hostPath = (host + " " + path).toLowerCase();

  // Parola chiave di malware nel link (es. /virus, /malware, /phishing) → PERICOLO.
  const mal = MALWARE_TOKENS.find((w) => hostPath.includes(w));
  if (mal) { reasons.push(lang === "en" ? "Malicious keyword in the link (malware/scam)" : "Parola malevola nel link (malware/truffa)"); level = worst(level, "danger"); }
  // Contenuti per adulti / pornografici / dating-spam nell'host → PERICOLO (bloccato).
  const adult = ADULT_SUBSTR.find((w) => host.includes(w)) || ADULT_WORD.find((w) => new RegExp("\\b" + w + "\\b").test(host));
  if (adult) { reasons.push(lang === "en" ? "Adult/pornographic content link — blocked" : "Link a contenuti per adulti/pornografici — bloccato"); level = worst(level, "danger"); }
  // Inviti a gruppi di altri social → PERICOLO (bloccato).
  const sgi = SOCIAL_GROUP_INVITE.find((re) => re.test((host + path).toLowerCase()));
  if (sgi) { reasons.push(lang === "en" ? "Invite link to an external social group — blocked" : "Link di invito a un gruppo di un altro social — bloccato"); level = worst(level, "danger"); }
  // Host locale/interno usato come esca (localhost, .local) → PERICOLO.
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) { reasons.push(lang === "en" ? "Internal/local host used as bait" : "Host locale/interno usato come esca"); level = worst(level, "danger"); }

  if (IP_HOST_RE.test(host)) { reasons.push(lang === "en" ? "Numeric IP address instead of a domain" : "Indirizzo IP numerico invece di un dominio"); level = worst(level, "danger"); }
  if (REMOTE_DOMAINS.size && (REMOTE_DOMAINS.has(host) || REMOTE_DOMAINS.has(domain))) { reasons.push(lang === "en" ? "Domain on the live threat blacklist" : "Dominio nella blacklist minacce aggiornata"); level = worst(level, "danger"); }
  if (hasAuth || url.includes("@")) { reasons.push(lang === "en" ? "Hidden login info in the link (@ trick)" : "Credenziali nascoste nel link (trucco @)"); level = worst(level, "danger"); }
  if (/xn--/i.test(host)) { reasons.push(lang === "en" ? "Punycode domain (possible look-alike)" : "Dominio punycode (possibile clone)"); level = worst(level, "danger"); }
  const extInPath = (path.match(/\.([a-z0-9]{1,5})(?:$|[?#/])/i) || [])[1];
  if (extInPath && DANGER_EXT.includes(extInPath.toLowerCase())) { reasons.push((lang === "en" ? "Dangerous file in link: ." : "File pericoloso nel link: .") + extInPath.toLowerCase()); level = worst(level, "danger"); }
  const brand = BRANDS.find((b) => host.includes(b));
  if (brand && !host.endsWith(brand + "." + tld) && !domain.startsWith(brand)) { reasons.push((lang === "en" ? "Impersonates a known brand: " : "Imita un marchio noto: ") + brand); level = worst(level, "danger"); }
  // Host "sensibile" (bank/login/verify/…): pericolo se combinato con TLD a rischio,
  // http o molti trattini (tipico dei domini di phishing usa-e-getta).
  const sensitive = SENSITIVE_TOKENS.find((w) => host.includes(w));
  const legitBrand = brand && host.endsWith(brand + "." + tld);
  if (sensitive && !legitBrand) {
    const hyphens = (host.match(/-/g) || []).length;
    const risky = SUSPICIOUS_TLD.includes(tld) || proto === "http:" || hyphens >= 2 || host.includes("fake");
    reasons.push(lang === "en" ? "Login/credential lure in the address" : "Esca per credenziali/login nell'indirizzo");
    level = worst(level, risky ? "danger" : "warn");
  }
  if (SHORTENERS.includes(domain)) { reasons.push(lang === "en" ? "Shortened link (real destination hidden)" : "Link accorciato (destinazione nascosta)"); level = worst(level, "warn"); }
  if (SUSPICIOUS_TLD.includes(tld)) { reasons.push((lang === "en" ? "High-risk domain extension: ." : "Estensione dominio ad alto rischio: .") + tld); level = worst(level, "warn"); }
  // http senza HTTPS: BLOCCATO (danger). Connessione in chiaro = rischio intercettazione/manomissione.
  if (proto === "http:") { reasons.push(lang === "en" ? "Insecure connection (no HTTPS) — blocked" : "Connessione non sicura (senza HTTPS) — bloccato"); level = worst(level, "danger"); }
  if (parts.length >= 5) { reasons.push(lang === "en" ? "Too many sub-domains" : "Troppi sotto-domini"); level = worst(level, "warn"); }
  if (host.length > 40) { reasons.push(lang === "en" ? "Unusually long address" : "Indirizzo insolitamente lungo"); level = worst(level, "warn"); }

  return { url, level, reasons };
}

export function analyzeMessage(text, lang = "it") {
  const out = { level: "safe", reasons: [], urls: [] };
  if (!text || typeof text !== "string") return out;
  const urls = [...new Set(text.match(URL_RE) || [])];
  let hasBadUrl = false;
  for (const u of urls) {
    const r = scanUrl(u, lang);
    out.urls.push(r);
    if (r.level !== "safe") { out.level = worst(out.level, r.level); r.reasons.forEach((x) => out.reasons.push(x)); if (r.level === "danger") hasBadUrl = true; }
  }
  for (const ph of PHISH) {
    if (ph.re.test(text)) {
      out.reasons.push(pick(ph, lang));
      // Testo-truffa + link = pericolo; testo-truffa da solo = attenzione.
      out.level = worst(out.level, (urls.length > 0 || hasBadUrl) ? "danger" : "warn");
    }
  }
  out.reasons = [...new Set(out.reasons)];
  return out;
}

// EICAR standard antivirus test string
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

function magicType(bytes) {
  if (!bytes || bytes.length < 4) return null;
  const b = bytes;
  if (b[0] === 0x4d && b[1] === 0x5a) return "exe";           // MZ (Windows PE)
  if (b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46) return "elf"; // ELF
  if (b[0] === 0xca && b[1] === 0xfe && b[2] === 0xba && b[3] === 0xbe) return "macho"; // Mach-O
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "pdf";  // %PDF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "gif";
  if (b[0] === 0x50 && b[1] === 0x4b) return "zip";           // PK (zip/apk/jar/office)
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return "riff"; // webp/wav
  return null;
}

function extOf(name) {
  const m = (name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

// bytes: Uint8Array (facoltativo, per analisi firma). name/mime dai metadati.
export function analyzeAttachment({ name = "", mime = "", bytes = null } = {}, lang = "it") {
  const out = { level: "safe", reasons: [] };
  const lower = (name || "").toLowerCase();
  const ext = extOf(name);

  if (DANGER_EXT.includes(ext)) { out.reasons.push((lang === "en" ? "Executable file type: ." : "Tipo di file eseguibile: .") + ext); out.level = worst(out.level, "danger"); }
  if (MACRO_EXT.includes(ext)) { out.reasons.push(lang === "en" ? "Office file with macros (can run code)" : "File Office con macro (può eseguire codice)"); out.level = worst(out.level, "warn"); }
  // Doppia estensione mascherata: documento.pdf.exe
  if (/\.(pdf|docx?|xlsx?|jpe?g|png|txt|zip)\.(exe|scr|bat|cmd|js|vbs|jar|apk|msi|com|pif)$/i.test(lower)) {
    out.reasons.push(lang === "en" ? "Disguised double extension" : "Doppia estensione mascherata");
    out.level = worst(out.level, "danger");
  }

  if (bytes && bytes.length) {
    const mt = magicType(bytes);
    if (mt === "exe" || mt === "elf" || mt === "macho") { out.reasons.push(lang === "en" ? "File is actually an executable program" : "Il file è in realtà un programma eseguibile"); out.level = worst(out.level, "danger"); }
    // Immagine dichiarata ma firma non immagine → mascheramento
    if ((mime || "").startsWith("image/") && mt && !["jpg","png","gif","riff"].includes(mt)) {
      out.reasons.push(lang === "en" ? "Not a real image (disguised file)" : "Non è una vera immagine (file mascherato)");
      out.level = worst(out.level, "danger");
    }
    // EICAR test antivirus
    try {
      const head = String.fromCharCode.apply(null, bytes.subarray(0, 512));
      if (head.includes(EICAR)) { out.reasons.push(lang === "en" ? "Malware test signature detected (EICAR)" : "Firma malware di test rilevata (EICAR)"); out.level = worst(out.level, "danger"); }
    } catch { /* ignore */ }
  }

  out.reasons = [...new Set(out.reasons)];
  return out;
}

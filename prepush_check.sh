#!/usr/bin/env bash
# CONTROLLO PRE-PUSH — si esegue nella radice dell'export pubblico.
#   bash prepush_check.sh
# Esce con 1 se trova qualcosa che non deve essere pubblicato. Un BLOCCO non si discute:
# un segreto pubblicato non si cancella, si ruota.
set -uo pipefail
BLOCCHI=0
AVVISI=0
blocca() { echo "BLOCCO  · $*"; BLOCCHI=$((BLOCCHI+1)); }
avvisa() { echo "avviso  · $*"; AVVISI=$((AVVISI+1)); }
ok()     { echo "ok      · $*"; }
ESCL="--exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist --exclude=prepush_check.sh --exclude=CHECKLIST_PRE_PUSH.md --exclude=.gitignore --exclude=*.example"

echo "== 1 · chiavi e credenziali =="
TROVATI=$(find . -path ./.git -prune -o -type f \( \
  -name '*.keystore' -o -name '*.jks' -o -name '*.p12' -o -name '*.pfx' -o -name '*.pem' \
  -o -name '*.key' -o -name 'keystore.properties' -o -name 'key.properties' \
  -o -name 'signing.properties' -o -name 'local.properties' -o -name 'google-services.json' \
  -o -name '*service-account*.json' -o -name 'firebase-adminsdk*.json' -o -name '.env' \
  -o -name '.env.*' -o -name 'keyfile*.json' -o -name 'lat.dev.key' \) -print 2>/dev/null \
  | grep -vE '\.example$' || true)
if [ -n "$TROVATI" ]; then
  while read -r f; do blocca "file di credenziali presente: $f"; done <<< "$TROVATI"
else
  ok "nessun file di chiavi, keystore o credenziali"
fi

echo "== 2 · segreti scritti nel codice =="
# Solo modelli che indicano un segreto VERO. I nomi di campo (secret_key_hex, publicKeyHex)
# non sono segreti: sono il vocabolario di un'app di crittografia, e bloccare su quelli
# insegna solo a ignorare il controllo.
MODELLI='BEGIN [A-Z ]*PRIVATE KEY|JWT_SECRET *=|KEYSTORE_ENC_KEY *=|VAPID_PRIVATE|MONGO_URL *=|mongodb(\+srv)?://[^ "'"'"']*:[^ "'"'"']*@|sshpass|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|-----BEGIN'
COLPI=$(grep -rInE "$MODELLI" . $ESCL 2>/dev/null | head -20 || true)
if [ -n "$COLPI" ]; then
  while IFS= read -r l; do blocca "possibile segreto: ${l:0:150}"; done <<< "$COLPI"
else
  ok "nessun segreto riconoscibile nel codice"
fi

echo "== 3 · utenze e accessi all'infrastruttura =="
SSH=$(grep -rInE 'root@[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|StrictHostKeyChecking' . $ESCL 2>/dev/null | head -10 || true)
[ -n "$SSH" ] && while IFS= read -r l; do blocca "accesso al server nel codice: ${l:0:130}"; done <<< "$SSH" || ok "nessuna utenza SSH nel codice"
# L'indirizzo del server non è un segreto: è dentro l'APK pubblicato e lo legge chiunque.
# Va però saputo che si pubblica, quindi si segnala senza bloccare.
IP=$(grep -rInE '\b167\.233\.85\.189\b' . $ESCL 2>/dev/null | head -5 || true)
[ -n "$IP" ] && while IFS= read -r l; do avvisa "indirizzo del server (già presente nell'APK): ${l:0:110}"; done <<< "$IP" || ok "nessun indirizzo IP dell'infrastruttura"

echo "== 4 · copie di lavoro e artefatti =="
BAK=$(find . -path ./.git -prune -o -type f \( -name '*.bak' -o -name '*.bak-*' -o -name '*.orig' -o -name '*.save' \) -print 2>/dev/null | wc -l)
[ "$BAK" = "0" ] && ok "nessun file .bak/.orig" || blocca "$BAK file di backup (.bak-*) nell'export: vecchie versioni del tuo codice"
BUILD=$(find . -path ./.git -prune -o -type d \( -name node_modules -o -name build -o -name .gradle -o -name .expo -o -name dist \) -print 2>/dev/null | wc -l)
[ "$BUILD" = "0" ] && ok "nessuna cartella di build o dipendenze" || blocca "$BUILD cartelle di build/dipendenze presenti"
APK=$(find . -path ./.git -prune -o -type f \( -name '*.apk' -o -name '*.aab' -o -name '*.aar' -o -name '*.so' \) -print 2>/dev/null | wc -l)
[ "$APK" = "0" ] && ok "nessun binario compilato (apk/aab/aar/so)" || blocca "$APK binari compilati nell'export: si ricompilano, non si pubblicano"

echo "== 5 · file enormi =="
GROSSI=$(find . -path ./.git -prune -o -type f -size +5M -print 2>/dev/null | head -10 || true)
[ -n "$GROSSI" ] && while read -r f; do avvisa "file oltre 5 MB: $f ($(du -h "$f" | cut -f1))"; done <<< "$GROSSI" || ok "nessun file oltre 5 MB"

echo "== 6 · documenti legali obbligatori =="
for f in LICENSE README.md TRADEMARK.md DISCLAIMER.md SECURITY.md NOTICE .gitignore; do
  [ -f "$f" ] && ok "presente: $f" || blocca "manca: $f"
done

echo "== 7 · firma dell'app: password fuori dal repository =="
GRADLE=android/app/build.gradle
if [ -f "$GRADLE" ]; then
  # 'android' è la password pubblica della chiave di debug di Android: non è un segreto.
  SOSPETTE=$(grep -nE "(storePassword|keyPassword) +'[^']+'" "$GRADLE" | grep -v "'android'" || true)
  [ -n "$SOSPETTE" ] && while IFS= read -r l; do blocca "$GRADLE password di firma in chiaro: ${l:0:90}"; done <<< "$SOSPETTE" \
    || ok "nessuna password di firma in chiaro in $GRADLE (la release legge keystore.properties, fuori dal repo)"
fi

echo
if [ "$BLOCCHI" -gt 0 ]; then
  echo "NON PUBBLICARE · $BLOCCHI blocchi, $AVVISI avvisi"
  exit 1
fi
echo "SI PUO' PUBBLICARE · 0 blocchi, $AVVISI avvisi"

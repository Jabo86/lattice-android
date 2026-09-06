#!/usr/bin/env bash
# libv2ray.aar COMPILATO DA NOI — nessun binario di terze parti dentro l'APK.
#
# Prende il sorgente di AndroidLibXrayLite (che tira dentro xray-core) e lo compila con
# gomobile per arm64, l'unica architettura che l'APK dichiara. Ogni byte del .so finisce
# nell'APK viene da questa compilazione, non da un file scaricato da qualcun altro.
#
# Le dipendenze Go: se accanto al sorgente c'è gomodproxy/ si compila COMPLETAMENTE OFFLINE.
# Altrimenti si scaricano — e va detto che non è un downgrade di fiducia: go.sum fissa
# l'impronta di ogni modulo, quindi scaricare o avere già in casa dà gli stessi byte.
set -euo pipefail

SRC="${1:-/opt/apkbuild/third_party/libxray}"
OUT="${2:-/opt/apkbuild/android/app/libs/libv2ray.aar}"
XMOBILE=v0.0.0-20260709172247-6129f5bee9d5

export GOROOT="${GOROOT:-/usr/local/go}"
export GOBIN="${GOBIN:-$(go env GOPATH 2>/dev/null || echo /root/go)/bin}"
export PATH="$GOROOT/bin:$GOBIN:/root/go/bin:$PATH"
export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export ANDROID_NDK_HOME="${ANDROID_NDK_HOME:-/opt/android-sdk/ndk/27.1.12297006}"
export TZ=UTC LC_ALL=C LANG=C
export CGO_ENABLED=1
export GOTOOLCHAIN=local    # niente toolchain scaricate a runtime: usiamo questa e basta
export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-$(cat "$SRC/../../repro.epoch" 2>/dev/null || cat /opt/apkbuild/repro.epoch 2>/dev/null || echo 1757000000)}"

# Le dipendenze Go si prendono dal proxy dei moduli. Non è un buco di fiducia: go.sum, che
# sta nel sorgente, fissa l'impronta di OGNI modulo. Scaricarli o averli già in casa dà gli
# stessi byte, e se un modulo cambiasse di un solo bit la compilazione si fermerebbe.
export GOPROXY="${GOPROXY:-https://proxy.golang.org,direct}"

command -v gomobile >/dev/null || {
  echo "==> installo gomobile $XMOBILE (la versione fissata da go.mod)"
  go install "golang.org/x/mobile/cmd/gomobile@$XMOBILE"
}
command -v gobind >/dev/null || {
  echo "==> installo gobind $XMOBILE"
  go install "golang.org/x/mobile/cmd/gobind@$XMOBILE"
}

cd "$SRC"
echo "==> gomobile bind (android/arm64)"
gomobile bind -androidapi 21 -trimpath \
  -ldflags "-s -w -buildid= -checklinkname=0" \
  -target=android/arm64 \
  -o "$OUT" ./

ls -la "$OUT"
sha256sum "$OUT"

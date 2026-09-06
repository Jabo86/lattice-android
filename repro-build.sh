#!/usr/bin/env bash
# BUILD RIPRODUCIBILE — ricompila l'APK di Lattice Pulse in modo che due compilazioni
# dello stesso sorgente producano gli stessi byte, firma esclusa, ANCHE su macchine diverse.
#
# Il punto delicato è il PERCORSO: i compilatori nativi incorporano il percorso assoluto
# dei sorgenti dentro le librerie .so. Compilare in /opt/apkbuild e in /home/tizio/lattice
# dà librerie diverse pur essendo lo stesso codice. Per questo si compila sempre da un
# percorso canonico, /lattice-src, ottenuto con un bind mount: chi verifica fa la stessa
# cosa e ottiene gli stessi byte.
#
# Uso:  bash repro-build.sh [file-di-uscita.apk]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$HERE/android/gradlew" ]; then APKDIR="$HERE"; else APKDIR="$(cd "$HERE/.." && pwd)"; fi
[ -f "$APKDIR/android/gradlew" ] || { echo "ERRORE: sorgente non trovato accanto a questo script"; exit 1; }

TOOL="$APKDIR/tools/apkrepro.py"
[ -f "$TOOL" ] || TOOL=/opt/lattice/apkrepro.py
OUT="${1:-/tmp/lattice-repro.apk}"
CANON=/lattice-src

# ── Tutto ciò che rende una build diversa dall'altra, fissato ──
export TZ=UTC LC_ALL=C LANG=C LANGUAGE=C
export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-amd64}"
export SOURCE_DATE_EPOCH="$(cat "$APKDIR/repro.epoch" 2>/dev/null || echo 1600000000)"
umask 022

SWAP=/swapfile-build
if [ "$(swapon --show --noheadings 2>/dev/null | wc -l)" -eq 0 ]; then
  fallocate -l 6G "$SWAP" && chmod 600 "$SWAP" && mkswap "$SWAP" >/dev/null && swapon "$SWAP" && echo "swap 6G attivo"
fi

# ── Percorso canonico ──
BOUND=0
if [ "$APKDIR" != "$CANON" ]; then
  mkdir -p "$CANON"
  mountpoint -q "$CANON" && umount "$CANON"
  if mount --bind "$APKDIR" "$CANON" 2>/dev/null; then
    BOUND=1
    echo "==> percorso canonico: $CANON  (bind di $APKDIR)"
  else
    echo "!!! ATTENZIONE: bind mount non disponibile (servono privilegi di root)."
    echo "!!! Si compila da $APKDIR: le librerie native NON saranno confrontabili con le nostre."
    CANON="$APKDIR"
  fi
fi
cleanup() { [ "$BOUND" = 1 ] && umount "$CANON" 2>/dev/null || true; }
trap cleanup EXIT

echo "==> SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH  TZ=$TZ"

# Nessun binario di terze parti dentro l'APK: il nucleo Xray si compila qui, da sorgente,
# ogni volta. Il .aar non è un file versionato, è un prodotto della compilazione.
AARSRC="$CANON/third_party/libxray"
AAR="$CANON/android/app/libs/libv2ray.aar"
if [ "${LATTICE_SKIP_AAR:-0}" = "1" ]; then
  echo "!!! LATTICE_SKIP_AAR=1: si usa il .aar già presente. La build NON è sovrana."
elif [ -d "$AARSRC" ]; then
  echo "==> Compilazione di libv2ray.aar dal sorgente (Go + gomobile)"
  rm -f "$AAR"
  mkdir -p "$(dirname "$AAR")"
  # Lo script sta accanto a questo, dentro tools/, sia nell'archivio pubblicato sia qui.
  # Prima si cercava in tools/tools/ e si ricadeva su un percorso del NOSTRO server: chi
  # verificava da fuori si fermava esattamente qui. Ora il percorso è quello dell'archivio.
  BL="$HERE/build-libv2ray.sh"
  [ -f "$BL" ] || BL="$APKDIR/tools/build-libv2ray.sh"
  [ -f "$BL" ] || BL=/opt/lattice/build-libv2ray.sh
  [ -f "$BL" ] || { echo "ERRORE: build-libv2ray.sh non trovato accanto al sorgente"; exit 1; }
  bash "$BL" "$AARSRC" "$AAR"
  [ -f "$AAR" ] || { echo "ERRORE: libv2ray.aar non generato"; exit 1; }
else
  echo "ERRORE: manca third_party/libxray, il .aar non si può compilare"; exit 1
fi
echo "==> Pulizia completa (una build riproducibile non si fida della cache)"
cd "$CANON/android"
rm -rf app/build build app/.cxx .gradle/configuration-cache 2>/dev/null || true
rm -rf /tmp/metro-* /tmp/haste-map-* "$CANON/node_modules/.cache" 2>/dev/null || true

echo "==> Compilazione release"
nice -n 10 ./gradlew --no-daemon --no-build-cache --no-configuration-cache \
  :app:assembleRelease --max-workers=2 \
  -Dorg.gradle.jvmargs=-Xmx3g -Duser.timezone=UTC -Dfile.encoding=UTF-8

APK="$CANON/android/app/build/outputs/apk/release/app-release.apk"
[ -f "$APK" ] || { echo "ERRORE: APK non generato"; exit 1; }
cp -f "$APK" "$OUT"
echo "==> $OUT"
python3 "$TOOL" manifest "$OUT"

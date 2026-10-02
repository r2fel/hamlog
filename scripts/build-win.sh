#!/bin/bash
# Builds the Windows installers into dist/:
#
#   R2FEL-LOG-Setup-<version>.exe              Windows 10 and 11, 64-bit
#   R2FEL-LOG-Setup-<version>-Windows7-8.exe   Windows 7, 8, 8.1 — and any
#                                              32-bit Windows, 10 included
#
# Two of them because Electron dropped Windows 7/8/8.1 after version 22, and
# 32-bit Windows altogether later on (44 has no ia32 build): the first runs
# on the same Electron as the Mac app, the second on 22.3.27, the last that
# still starts on those (no longer updated, but a logbook that only talks to
# QRZ and the weather service can live with that), 64- and 32-bit in one
# installer. Windows Vista isn't possible at all: no Chromium-based app has
# run on it since 2016.
#
# GitHub, where electron-builder downloads Electron and its NSIS tools from,
# is slow from here — slower than electron-builder's 10-minute limit. So
# everything is fetched beforehand, resumably, by fetch-win-tools.sh into
# ~/Library/Caches/r2fel-win-mirror, and served to electron-builder from
# there as a local mirror (same files, checksums still verified).
#
# Built on the Mac, outside iCloud for the same reason as build-dmg.sh.
set -euo pipefail

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$HOME/Library/Caches/R2FEL-LOG-build-win"
LEGACY_ELECTRON="22.3.27"

rm -rf "$STAGE"
mkdir -p "$STAGE"

echo "Copying the project outside iCloud (without its extended attributes)..."
for item in package.json package-lock.json electron-main.js electron-preload.js debug-log.js server.js public build node_modules; do
  ditto --noextattr --norsrc "$PROJECT/$item" "$STAGE/$item"
done

cd "$STAGE"
VERSION=$(node -p "require('./package.json').version")
export NODE_OPTIONS="${NODE_OPTIONS:-} --use-bundled-ca"   # see build-dmg.sh

MIRROR="$HOME/Library/Caches/r2fel-win-mirror"
bash "$PROJECT/scripts/fetch-win-tools.sh" "$MIRROR"
( cd "$MIRROR" && exec python3 -m http.server 8765 --bind 127.0.0.1 >/dev/null 2>&1 ) &
MIRROR_PID=$!
trap 'kill $MIRROR_PID 2>/dev/null' EXIT
sleep 1
export ELECTRON_BUILDER_BINARIES_MIRROR="http://127.0.0.1:8765/bin/"
export ELECTRON_BUILDER_BINARIES_ALLOW_HTTP=true
EMIRROR="-c.electronDownload.mirror=http://127.0.0.1:8765/electron/"

echo
echo "=== Windows 10 / 11 ==="
npx electron-builder --win nsis --x64 "$EMIRROR"

echo
echo "=== Windows 7 / 8 / 8.1 (Electron $LEGACY_ELECTRON) ==="
npx electron-builder --win nsis --x64 --ia32 "$EMIRROR" \
  -c.electronVersion="$LEGACY_ELECTRON" \
  -c.directories.output=dist-legacy \
  '-c.nsis.artifactName=R2FEL-LOG-Setup-${version}-Windows7-8.${ext}'

mkdir -p "$PROJECT/dist"
cp "dist/R2FEL-LOG-Setup-$VERSION.exe" "dist-legacy/R2FEL-LOG-Setup-$VERSION-Windows7-8.exe" "$PROJECT/dist/"
echo
echo "Done:"
ls -lh "$PROJECT"/dist/R2FEL-LOG-Setup-"$VERSION"*.exe

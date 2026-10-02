#!/bin/bash
# Draws every icon the program needs from scripts/app-icon.swift:
#
#   build/icon.icns            the installed Mac app (16…1024 on Apple's grid)
#   public/icons/app-icon.png  the dev copy's Dock icon
#   public/icons/app-icon-win.png   Windows (a larger tile, as Windows likes)
#   public/icons/icon-180|192|512.png   the web/PWA icons, edge to edge
#
# Run it after changing the drawing: bash scripts/make-icons.sh
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
swiftc -O scripts/app-icon.swift -o "$tmp/app-icon"

set="$tmp/icon.iconset"; mkdir -p "$set"
draw() { "$tmp/app-icon" "$1" "$2" "$3" "$4"; }
for pair in "16 icon_16x16" "32 icon_16x16@2x" "32 icon_32x32" "64 icon_32x32@2x" \
            "128 icon_128x128" "256 icon_128x128@2x" "256 icon_256x256" \
            "512 icon_256x256@2x" "512 icon_512x512" "1024 icon_512x512@2x"; do
  draw "$set/${pair#* }.png" "${pair%% *}" 0.8047 1
done
iconutil -c icns "$set" -o build/icon.icns

draw public/icons/app-icon.png 1024 0.8047 1
draw public/icons/app-icon-win.png 512 0.94 1
draw public/icons/icon-180.png 180 1 0
draw public/icons/icon-192.png 192 1 0
draw public/icons/icon-512.png 512 1 0
echo "icons redrawn"

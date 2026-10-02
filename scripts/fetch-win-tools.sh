#!/bin/bash
# Pre-downloads what electron-builder needs for the Windows installers, from
# the official GitHub releases, resumably (GitHub is slow from here, and
# electron-builder gives up after 10 minutes). build-win.sh serves this folder
# to electron-builder as a local mirror.
M="${1:-$HOME/Library/Caches/r2fel-win-mirror}"; mkdir -p "$M"
# A finished file gets a .done mark next to it: asked to resume a complete
# download, GitHub answers "range not satisfiable", which would loop forever.
get() {  # dir url
  mkdir -p "$M/$1"; local f="$M/$1/$(basename "$2")"
  [ -f "$f.done" ] && return
  until curl -fsSL -C - --retry 30 --retry-delay 3 --retry-all-errors --speed-time 60 --speed-limit 1000 -o "$f" "$2"; do sleep 3; done
  touch "$f.done"
  echo "done $1/$(basename "$2") $(du -h "$f" | cut -f1)"
}
E=https://github.com/electron/electron/releases/download
B=https://github.com/electron-userland/electron-builder-binaries/releases/download
get bin/nsis-3.0.4.1 $B/nsis-3.0.4.1/nsis-3.0.4.1.7z &
get bin/nsis-resources-3.4.1 $B/nsis-resources-3.4.1/nsis-resources-3.4.1.7z &
get bin/winCodeSign-2.6.0 $B/winCodeSign-2.6.0/winCodeSign-2.6.0.7z &
get bin/icons@1.1.0 $B/icons@1.1.0/icons-bundle.tar.gz &   # PNG → .ico for the app icon
get bin/7zip@1.0.0 $B/7zip@1.0.0/7zip-darwin-$( [ "$(uname -m)" = arm64 ] && echo arm64 || echo x64 ).tar.gz &   # packs the installer
get electron/v22.3.27 $E/v22.3.27/electron-v22.3.27-win32-ia32.zip &
for v in 44.3.0 22.3.27; do
  get electron/v$v $E/v$v/SHASUMS256.txt
  get electron/v$v $E/v$v/electron-v$v-win32-x64.zip &
done
wait
echo ALL DONE

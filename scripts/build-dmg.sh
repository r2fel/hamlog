#!/bin/bash
# Builds dist/R2FEL-LOG-<version>-arm64.dmg.
#
# The project lives in iCloud Drive, and iCloud tags every folder in it with
# FinderInfo / fileprovider extended attributes. codesign refuses to sign a
# bundle carrying them ("resource fork, Finder information, or similar
# detritus not allowed"), and iCloud re-applies them to anything written back
# inside the project. So the build runs from a clean copy outside iCloud, and
# only the finished DMG comes back into dist/.
set -euo pipefail

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$HOME/Library/Caches/R2FEL-LOG-build"

rm -rf "$STAGE"
mkdir -p "$STAGE"

echo "Copying the project outside iCloud (without its extended attributes)..."
for item in package.json package-lock.json electron-main.js electron-preload.js debug-log.js server.js public build native scripts node_modules; do
  ditto --noextattr --norsrc "$PROJECT/$item" "$STAGE/$item"
done

cd "$STAGE"
# The macOS location prompt (native/location.m) — always built fresh for the
# DMG, never taken from whatever happens to be lying in the project.
rm -f native/location.node
node scripts/build-native.js
if [ ! -f native/location.node ]; then
  echo "native/location.node did not build — the DMG would have no location prompt. Stopping." >&2
  exit 1
fi
# electron-builder downloads its DMG tool from GitHub. The Node on this Mac
# defaults to the system certificate store and fails to verify GitHub's
# asset host there ("unable to get local issuer certificate"), while its own
# bundled store verifies it fine — so the build uses the bundled one.
# The Mac build uses the Electron already in node_modules (no download);
# the Windows one (build-win.sh) fetches its own, so this isn't in package.json.
NODE_OPTIONS="${NODE_OPTIONS:-} --use-bundled-ca" npx electron-builder --mac dmg -c.electronDist=node_modules/electron/dist

mkdir -p "$PROJECT/dist"
cp "$STAGE"/dist/*.dmg "$PROJECT/dist/"
echo
echo "Done:"
ls -lh "$PROJECT"/dist/*.dmg

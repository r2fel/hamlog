/* Compiles native/location.m into native/location.node — the macOS location
 * permission prompt for the 📍 button (see the comment at the top of that
 * file for why Electron needs it).
 *
 * Runs as part of postinstall and of `npm run dist`. Needs the Xcode command
 * line tools (clang), which any Mac that has git already has. If it can't be
 * built, the app still works: 📍 then just can't ask macOS for permission,
 * and says where to switch it on instead.
 */
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

if (process.platform !== 'darwin') process.exit(0);

const dir = path.join(__dirname, '..', 'native');
const src = path.join(dir, 'location.m');
const out = path.join(dir, 'location.node');

// node_api.h ships with Node itself, next to the binary: <prefix>/include/node.
const include = path.join(process.execPath, '..', '..', 'include', 'node');
if (!fs.existsSync(path.join(include, 'node_api.h'))) {
  console.warn(`[build-native] node_api.h not found in ${include} — skipping location.node`);
  process.exit(0);
}

try {
  execFileSync('clang', [
    '-fobjc-arc', '-bundle', '-undefined', 'dynamic_lookup',
    '-arch', 'arm64', '-mmacosx-version-min=11.0', '-O2',
    `-I${include}`,
    '-framework', 'Foundation', '-framework', 'CoreLocation',
    '-o', out, src
  ], { stdio: 'inherit' });
  console.log('[build-native] built native/location.node');
} catch (e) {
  console.warn('[build-native] could not build location.node (no Xcode command line tools?) — 📍 will not prompt for permission');
}

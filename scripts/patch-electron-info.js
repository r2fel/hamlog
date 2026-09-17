/* Electron's downloaded Electron.app ships with no location-usage
 * description and the generic bundle id com.github.Electron. Without the
 * usage description, macOS refuses geolocation outright — no prompt, no
 * error the app can catch, the 📍 button (MY GRID / MY RDA autodetect) just
 * never gets a position. Without a bundle id of our own, this dev app's
 * permission grants live under an identity shared with every other
 * unpackaged Electron app on the machine.
 *
 * The id is deliberately NOT the installed app's (com.r2fel.qsolog): with
 * the same id, macOS and uninstallers like AppCleaner treat this copy inside
 * node_modules and the one in /Applications as a single app, list it under
 * this copy's name ("Electron"), and share preferences and permissions
 * between the two. So it's "R2FEL-LOG Dev", com.r2fel.qsolog.dev.
 *
 * `npm install` re-downloads Electron.app and wipes any hand edits to its
 * Info.plist, so this runs as postinstall (see package.json) to reapply them
 * every time rather than relying on someone remembering to redo it by hand.
 * A real packaged build (electron-builder) would bake these in instead —
 * this is only needed for `npm run electron` during development.
 */
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const PLIST = path.join(
  __dirname, '..', 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'Info.plist'
);

if (process.platform !== 'darwin' || !fs.existsSync(PLIST)) {
  process.exit(0);   // nothing to patch — not macOS, or Electron isn't installed yet
}

function setOrAdd(key, type, value) {
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, PLIST]);
  } catch (e) {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} ${type} ${value}`, PLIST]);
  }
}

setOrAdd(
  'NSLocationWhenInUseUsageDescription',
  'string',
  "'Your location is used once, when you tap the pin button, to fill in MY QTH GRID and MY RDA.'"
);
setOrAdd('CFBundleName', 'string', "'R2FEL-LOG Dev'");
setOrAdd('CFBundleDisplayName', 'string', "'R2FEL-LOG Dev'");
setOrAdd('CFBundleIdentifier', 'string', 'com.r2fel.qsolog.dev');

console.log('[patch-electron-info] Electron.app\'s Info.plist updated (location usage description, bundle id).');

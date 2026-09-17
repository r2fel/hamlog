/* The little the page may ask of the desktop app around it: the system's
 * location permission for the 📍 button (see handleLocationAccess in
 * electron-main.js), the debug log for ⚙ → DEBUG LOG, and saving a file the page made (the one for
 * HAMLOG). In a plain browser this file doesn't exist and
 * window.desktopApp is undefined, which app.js checks for.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApp', {
  platform: process.platform,   // 'darwin' | 'win32' — whose settings to send the user to
  // → 'granted' | 'denied' | 'restricted' | 'disabled' | 'not-determined' | 'unknown'
  locationAccess: () => ipcRenderer.invoke('location-access'),
  openLocationSettings: () => ipcRenderer.invoke('open-location-settings'),
  // The debug log (debug-log.js): save a copy (→ the saved path, or null if
  // cancelled), or show the file itself in Finder / Explorer.
  saveLog: () => ipcRenderer.invoke('log-save'),
  showLog: () => ipcRenderer.invoke('log-show'),
  // A file the page made (bytes), saved where the user picks → the path, or null if cancelled.
  saveFile: (name, bytes) => ipcRenderer.invoke('file-save', name, bytes),
  // …and shown in Finder / Explorer afterwards (only a file saved that way).
  showFile: filePath => ipcRenderer.invoke('file-show', filePath),
  // Which language the page is in, so the right-click menu the app builds
  // (cut / copy / paste) speaks the same one — see electron-main.js.
  setLanguage: ru => ipcRenderer.send('app-language', Boolean(ru))
});

/* The debug log: one text file where the desktop app writes down what it's
 * doing and everything that goes wrong — so that when it misbehaves on
 * someone else's computer, that file is all it takes to find out why.
 *
 * Where it lives is the system's own place for app logs, the same on every
 * machine: ~/Library/Logs/R2FEL-LOG on a Mac, %APPDATA%\R2FEL-LOG\logs on
 * Windows. Not next to the program itself: a Mac app is a sealed, signed
 * package that writing into would break, and on Windows the program folder
 * is replaced by every update. Settings (⚙ → DEBUG LOG) saves a copy to the
 * Desktop and shows the file, so nobody has to know the path.
 *
 * What goes in:
 *   - a header for every launch: version, system, engine versions, paths;
 *   - everything the main process prints (server.js included: lookup and
 *     network errors, weather, RDA) — it never prints the QRZ password,
 *     URLs carrying it are masked in server.js;
 *   - the page's console: its errors, uncaught exceptions with file and
 *     line, and the few [qso]/[lookup]/[settings] notes app.js leaves;
 *   - the window: page crashed, froze, failed to load; helper processes gone;
 *   - crashes of the main process itself, which also get a message box.
 * Times are UTC, like the log of contacts.
 *
 * Kept to a couple of megabytes: past that, at launch, it becomes
 * r2fel-log.old.txt (one previous file kept) and a new one starts.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, dialog } = require('electron');

const MAX_BYTES = 2 * 1024 * 1024;
let file = null;

function stamp() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function describe(value) {
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch (e) { return String(value); }
}

/** One entry: time, level, where from, and the text (continuation lines indented). */
function write(level, source, parts) {
  if (!file) return;
  const text = parts.map(describe).join(' ').replace(/^\s+|\s+$/g, '');
  if (!text) return;
  const lines = text.split('\n');
  const head = `${stamp()}  ${level.padEnd(5)}  ${source.padEnd(4)}  `;
  const body = lines.map((line, i) => (i ? ' '.repeat(head.length) : head) + line).join('\n');
  try {
    fs.appendFileSync(file, body + '\n');   // synchronous: a crash must not lose its own entry
  } catch (e) { /* a full disk mustn't take the app down with it */ }
}

/** Starts the log and routes the main process's console into it. Call first thing. */
function start() {
  const dir = app.getPath('logs');
  try {
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, 'r2fel-log.txt');
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) {
      fs.renameSync(file, path.join(dir, 'r2fel-log.old.txt'));
    }
  } catch (e) {
    file = null;
    return;
  }

  let version = '?';
  try { version = require('./package.json').version; } catch (e) { /* shown as ? */ }
  const rule = '='.repeat(78);
  try {
    fs.appendFileSync(file, `\n${rule}\n`);
  } catch (e) { /* see write() */ }
  write('START', 'app', [[
    `R2FEL-LOG ${version}${app.isPackaged ? '' : ' (development copy)'}`,
    `system:   ${os.type()} ${os.release()} (${process.platform}, ${process.arch}), ${Math.round(os.totalmem() / 1e9)} GB RAM`,
    `engine:   Electron ${process.versions.electron}, Chrome ${process.versions.chrome}, Node ${process.versions.node}`,
    `program:  ${process.execPath}`,
    `data:     ${app.getPath('userData')}`,
    `log:      ${file}`
  ].join('\n')]);

  [['log', 'INFO'], ['info', 'INFO'], ['warn', 'WARN'], ['error', 'ERROR']].forEach(([method, level]) => {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      original(...args);
      write(level, 'main', args);
    };
  });

  process.on('uncaughtException', err => {
    write('CRASH', 'main', ['Uncaught exception:', err]);
    // Handling it here also means Electron's own error box doesn't show, so
    // say what happened — and where the details are.
    dialog.showErrorBox('LOG — an error occurred',
      `${err && err.message ? err.message : err}\n\nThe details are in the debug log:\n${file}`);
  });
  process.on('unhandledRejection', reason => write('ERROR', 'main', ['Unhandled promise rejection:', reason]));

  app.on('child-process-gone', (ev, details) => {
    if (details.reason !== 'clean-exit') {
      write('CRASH', 'app', [`${details.type} process gone: ${details.reason} (exit code ${details.exitCode})` +
        (details.name ? ` — ${details.name}` : '')]);
    }
  });
  app.on('before-quit', () => write('STOP', 'app', ['quitting']));
  // Only known once the app is ready.
  app.whenReady().then(() => write('INFO', 'app', [`language: ${app.getLocale()}, screen scaling ${require('electron').screen.getPrimaryDisplay().scaleFactor}×`]));
}

/**
 * The window's side: the page's console, and the page crashing, freezing
 * or failing to load. A crashed page is loaded again, so the app carries on
 * instead of standing there blank.
 */
function watchWindow(win) {
  const contents = win.webContents;
  const LEVELS = ['debug', 'info', 'warning', 'error'];

  const record = (level, message, line, source) => {
    if (level === 'debug') return;
    const where = level === 'error' && source ? `  (${String(source).replace(/^.*\//, '')}:${line})` : '';
    write(level === 'error' ? 'ERROR' : level === 'warning' ? 'WARN' : 'INFO', 'page', [message + where]);
  };
  // Newer Electron hands over one details object — and warns if the
  // listener asks for more — while older (Electron 22, the Windows 7/8
  // build) passes the values one by one. So the listener's shape follows
  // the version.
  if (Number(process.versions.electron.split('.')[0]) >= 35) {
    contents.on('console-message', ev => record(ev.level, ev.message, ev.lineNumber, ev.sourceUrl));
  } else {
    contents.on('console-message', (ev, level, message, line, source) =>
      record(LEVELS[level] || 'info', message, line, source));
  }

  contents.on('render-process-gone', (ev, details) => {
    write('CRASH', 'page', [`page process gone: ${details.reason} (exit code ${details.exitCode}) — loading it again`]);
    if (details.reason !== 'clean-exit') setTimeout(() => { if (!win.isDestroyed()) contents.reload(); }, 1000);
  });
  contents.on('unresponsive', () => write('WARN', 'page', ['page stopped responding']));
  contents.on('responsive', () => write('INFO', 'page', ['page responding again']));
  contents.on('did-fail-load', (ev, code, description, url, isMainFrame) => {
    if (isMainFrame) write('ERROR', 'page', [`failed to load ${url}: ${description} (${code})`]);
  });
}

function logFile() {
  return file;
}

module.exports = { start, watchWindow, logFile, write };

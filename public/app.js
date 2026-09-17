/* R2FEL HamLog — application logic
 *
 * Local-first: the logbook lives in this browser. Callsign lookup goes through
 * this app's own server, which holds the QRZ credentials; losing the network
 * never blocks logging a contact.
 */
(function () {
  'use strict';

  const BUILD = '2026-09-16 · card by post size, their name in the letter\'s language, Latin-only mail fields';

  const $ = id => document.getElementById(id);

  const LEGACY_KEY = 'qso-entries-local';   // logbook before IndexedDB
  const STATION_KEY = 'qso-station';
  const AUTH_STORAGE = 'qso-auth';

  let entries = [];
  let station = {
    callsign: '', rda: '', qth: '', mode: 'SSB', recent: [], exportedCount: 0,
    contest: false,       // contest mode on/off, remembered between sessions
    serial: 1,            // the serial number the next contact will send
    ruPhonetics: false,   // spell Russian/Belarusian/Kazakh calls in Russian
    showPhonetics: true   // spell anything out at all — off for operators who don't need the prompting
  };
  let auth = { mode: 'none' };
  let accessKeyRequired = true;

  // Whether DATE/TIME should keep tracking the real clock. True by default —
  // typing a time by hand turns it off (that entry's time is now fixed);
  // NOW, logging a QSO, or loading a fresh form turns it back on.
  let timeAutoUpdating = true;

  let lookupTimer = null;
  let lastLookedUp = '';
  // Which callsign the name/country/qth/grid/RDA fields currently describe.
  // The moment CALLSIGN changes to something else, those fields are stale —
  // otherwise a failed lookup for a new call could go on showing the
  // previous callsign's operator as if it belonged to this one.
  let detailFieldsCallsign = '';
  // The callsign a lookup has actually answered for. detailFieldsCallsign is
  // set the moment typing starts, so it can't be used to decide whether the
  // record has been seen yet — using it made the panel claim "no locator in
  // the record" for every callsign while its lookup was still in flight.
  let lookupDoneCallsign = '';
  // The callsign a lookup came back empty for. Neither database has it, so
  // the operator types the details themselves — in the panel, where those
  // details would have appeared.
  let notFoundCallsign = '';
  // Whether the correspondent's locator was worked out from coordinates
  // rather than stated by the source. Kept here rather than read off the
  // lookup result, so the "≈" on the distance survives the panel being redrawn
  // for anything else (a weather reading arriving, a hand-edited field).
  let corrGridApprox = false;
  let newestIds = new Set();
  let editingId = null;        // set while an existing QSO is being edited
  let dupeCallsign = '';       // earlier contacts with this call are highlighted
  // While a callsign already in the log is being entered, the log below shows
  // only that callsign's contacts — the question at that moment is always
  // "when and how often have I worked them?", and scrolling a thousand rows
  // for the highlighted ones is no way to answer it. SHOW ALL opts out for as
  // long as that callsign stays in the field.
  let dupeFilterOff = false;
  let selected = new Set();
  let searchTerm = '';
  let groupSeq = 0;            // ids for the pileup/group rows below CALLSIGN

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  // ---------------------------------------------------------------------
  // Latin-only input
  //
  // A web page can't switch the operating system's keyboard layout, so
  // instead we undo the effect of the wrong one. Typing R2FEL with a Russian
  // layout active produces к2ауд; mapping each character back to the Latin
  // letter on the same physical key restores it. Callsigns, locators and RDA
  // codes are Latin by definition, so this is safe for them — whatever
  // layout the operator's system happens to be in.
  // ---------------------------------------------------------------------

  const RU_TO_LATIN_KEY = {
    'й': 'Q', 'ц': 'W', 'у': 'E', 'к': 'R', 'е': 'T', 'н': 'Y', 'г': 'U',
    'ш': 'I', 'щ': 'O', 'з': 'P', 'х': '[', 'ъ': ']',
    'ф': 'A', 'ы': 'S', 'в': 'D', 'а': 'F', 'п': 'G', 'р': 'H', 'о': 'J',
    'л': 'K', 'д': 'L', 'ж': ';', 'э': "'",
    'я': 'Z', 'ч': 'X', 'с': 'C', 'м': 'V', 'и': 'B', 'т': 'N', 'ь': 'M',
    'б': ',', 'ю': '.', 'ё': '`',
    // Not a letter, but on the same key: an e-mail address typed with the
    // Russian layout still on comes out with a quotation mark for the @.
    '"': '@'
  };

  /**
   * The same keyboard the other way round: the Cyrillic letter on the key a
   * Latin character sits on. Built from the map above so the two can never
   * drift apart. Used where the text is meant to be Russian — an operator's
   * name and their town — so a forgotten layout produces "Алексей" instead of
   * "Fktrcth".
   */
  const LATIN_TO_RU_KEY = Object.entries(RU_TO_LATIN_KEY)
    .reduce((map, [ru, latin]) => {
      map[latin.toLowerCase()] = ru;
      return map;
    }, {});

  function toCyrillicKeepCase(raw) {
    return String(raw || '')
      .split('')
      .map(ch => {
        const mapped = LATIN_TO_RU_KEY[ch.toLowerCase()];
        if (!mapped) return ch;
        return ch === ch.toLowerCase() ? mapped : mapped.toUpperCase();
      })
      .join('');
  }

  /**
   * Readable transliteration, for Cyrillic that arrives from a lookup rather
   * than from the keyboard. QRZ.RU answers with Russian town names, and with
   * the Russian mode off those are unreadable to the operator — but they must
   * not be run through the keyboard map either, which would turn
   * "Ростов-на-Дону" into "Hjcnjd-yf-Ljye". This spells it "Rostov-na-Donu".
   */
  const RU_TRANSLIT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e',
    'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
    'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
    'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
    'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
    'і': 'i', 'ї': 'yi', 'є': 'ye', 'ґ': 'g', 'ў': 'w'
  };

  function toLatinTranslit(raw) {
    const text = String(raw || '');
    let out = '';

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const mapped = RU_TRANSLIT[ch.toLowerCase()];

      if (mapped === undefined) { out += ch; continue; }
      if (ch === ch.toLowerCase()) { out += mapped; continue; }

      // An uppercase letter mid-word stays uppercase (ГОСТ → GOST); one at the
      // start of a word is only capitalised (Сочи → Sochi, not SOchi).
      const nextIsLower = /\p{Ll}/u.test(text[i + 1] || '');
      out += nextIsLower
        ? mapped.charAt(0).toUpperCase() + mapped.slice(1)
        : mapped.toUpperCase();
    }

    return out;
  }

  function latinizeRecord(data) {
    if (!data) return data;
    return Object.assign({}, data, {
      name: toLatinTranslit(data.name),
      country: toLatinTranslit(data.country),
      city: toLatinTranslit(data.city)
    });
  }

  /**
   * A lookup result as the operator should see it — the mode in DATA decides.
   *
   * Off: nothing Cyrillic reaches the fields, the panel or the log, whatever
   * the source answered.
   *
   * On: a Russian, Belarusian or Kazakh station is shown in Russian, which
   * means the source's own Russian spelling of the name (QRZ.RU carries both,
   * and the Latin one is only a transcription of it). A station from anywhere
   * else is left exactly as the source gave it — Cyrillic can't spell a
   * foreign name back correctly, so it is not even attempted.
   */
  function presentRecord(data, callsign) {
    if (!data) return data;
    if (!station.ruPhonetics) return latinizeRecord(data);

    if (isCyrillicSpelledCall(callsign) && data.nameLocal) {
      return Object.assign({}, data, { name: data.nameLocal });
    }
    return data;
  }

  /**
   * Cyrillic letters that are visually identical to Latin ones. A locator
   * typed as КО-04 with Russian letters looks exactly like KO-04 but doesn't
   * match anything, so these are folded to their Latin twins first.
   */
  const LOOKALIKE_TO_LATIN = {
    'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O',
    'Р': 'P', 'С': 'C', 'Т': 'T', 'У': 'Y', 'Х': 'X',
    'а': 'A', 'в': 'B', 'е': 'E', 'к': 'K', 'м': 'M', 'н': 'H', 'о': 'O',
    'р': 'P', 'с': 'C', 'т': 'T', 'у': 'Y', 'х': 'X'
  };

  function foldLookalikes(text) {
    return String(text || '')
      .split('')
      .map(ch => LOOKALIKE_TO_LATIN[ch] || ch)
      .join('');
  }

  const FIELD_SHAPES = {
    callsign: /[^A-Z0-9/]/g,        // R2FEL, R2FEL/P
    code: /[^A-Z0-9-]/g,            // KO85TR, MO-07
    place: /[^A-Z0-9 ,.\-/]/g       // Moscow, KO85
  };

  /**
   * RDA codes are always two letters, a hyphen and two digits — MO-07. The
   * hyphen is inserted for you, so it's four keystrokes.
   */
  function formatRda(raw) {
    const chars = toLatinCode(raw).replace(/[^A-Z0-9]/g, '');
    const letters = chars.slice(0, 2).replace(/[^A-Z]/g, '');

    // The region letters come first; digits before them aren't part of a code.
    if (letters.length < 2) return letters;

    const digits = chars.slice(2).replace(/[^0-9]/g, '').slice(0, 2);
    return digits ? `${letters}-${digits}` : letters;
  }

  /**
   * Maidenhead locators are two letters, two digits, and — when the operator
   * gives that much precision — two more letters. Each position accepts only
   * what belongs there. All capitals, KO85TR: the textbook form puts the last
   * pair in lower case (KO85tr), but among capitals it reads as a mistake,
   * and every log and QSL takes it either way.
   */
  function formatGrid(raw) {
    const chars = toLatinCode(raw).replace(/[^A-Z0-9]/g, '');
    let out = '';

    for (const ch of chars) {
      const pos = out.length;
      if (pos < 2) { if (/[A-R]/.test(ch)) out += ch; }
      else if (pos < 4) { if (/[0-9]/.test(ch)) out += ch; }
      else if (pos < 6) { if (/[A-X]/.test(ch)) out += ch; }
      else break;
    }
    return out;
  }

  function toLatin(raw) {
    return String(raw || '')
      .split('')
      .map(ch => RU_TO_LATIN_KEY[ch.toLowerCase()] || ch)
      .join('')
      .toUpperCase();
  }

  /**
   * For codes — locators and RDA — a Cyrillic letter is read as its Latin
   * twin where one exists (КО-04 means KO-04), and otherwise as the Latin
   * letter on the same physical key (лщ04, typed with the wrong layout
   * active, also means KO04). Callsigns use key position only, since their
   * letters rarely coincide with Cyrillic look-alikes.
   */
  function toLatinCode(raw) {
    return String(raw || '')
      .split('')
      .map(ch => LOOKALIKE_TO_LATIN[ch] || RU_TO_LATIN_KEY[ch.toLowerCase()] || ch)
      .join('')
      .toUpperCase();
  }

  function cleanCallsignInput(raw) {
    return toLatin(raw).replace(FIELD_SHAPES.callsign, '');
  }

  /**
   * Same wrong-layout rescue as the callsign fields, but for free text that
   * isn't a code: logins and passwords. Cyrillic becomes the Latin letter on
   * the same physical key, and nothing else changes — case is kept exactly as
   * typed (passwords are case-sensitive) and no character is thrown away.
   */
  function toLatinKeepCase(raw) {
    return String(raw || '')
      .split('')
      .map(ch => {
        const mapped = RU_TO_LATIN_KEY[ch.toLowerCase()];
        if (!mapped) return ch;
        return ch === ch.toLowerCase() ? mapped.toLowerCase() : mapped.toUpperCase();
      })
      .join('');
  }

  /**
   * Rewrites a field as you type, keeping the caret where you left it.
   * `shape` names the format the field holds.
   */
  /**
   * Which alphabet the fields you fill in are written in.
   *
   * Latin is the default for everything: with the Russian mode off, an
   * operator who doesn't read Cyrillic must not be able to end up with it in
   * their own log — not by a forgotten layout, not by a paste. Switching the
   * mode on is what allows Cyrillic at all, and then only for the countries
   * that use it: a Russian, Belarusian or Kazakh callsign means the details
   * are Russian, any other callsign stays Latin.
   */
  function detailScriptFor(callsign) {
    if (!station.ruPhonetics) return 'latin';
    return isCyrillicSpelledCall(callsign) ? 'cyrillic' : 'latin';
  }

  function formatDetailText(raw, callsign) {
    return detailScriptFor(callsign) === 'cyrillic'
      ? toCyrillicKeepCase(raw)
      : toLatinKeepCase(raw);
  }

  /*
   * The name and QTH typed in by hand for a station nobody has on file. With
   * the Russian mode on these are Russian whatever the station's country: a
   * Russian-speaking operator writes down the name he hears — "John" as
   * «Джон» — and can't be expected to spell it correctly in English. With
   * the mode off they're Latin, as before.
   *
   * Letters are converted by key position, as elsewhere (a forgotten English
   * layout still gives Russian). Punctuation only when it came from the key
   * that holds that letter in the Russian layout: the comma of "Москва,
   * Россия", typed with the Russian layout, is a comma, not «б».
   */
  let lastKeyCode = '';
  document.addEventListener('keydown', ev => { lastKeyCode = ev.code || ''; }, true);

  const LETTER_KEY_CODES = {
    ',': 'Comma', '.': 'Period', ';': 'Semicolon', "'": 'Quote',
    '[': 'BracketLeft', ']': 'BracketRight', '`': 'Backquote'
  };

  function toCyrillicTyped(raw) {
    return String(raw || '').split('').map(ch => {
      const key = LETTER_KEY_CODES[ch];
      if (key && lastKeyCode !== key) return ch;
      const mapped = LATIN_TO_RU_KEY[ch.toLowerCase()];
      if (!mapped) return ch;
      return ch === ch.toLowerCase() ? mapped : mapped.toUpperCase();
    }).join('');
  }

  function formatTypedDetail(raw) {
    return station.ruPhonetics ? toCyrillicTyped(raw) : toLatinKeepCase(raw);
  }

  /**
   * The same fields when Russian mode is switched with something already in
   * them. Nothing is re-read by key position here — "John" typed in English
   * mode is not «Ощты». Switching on leaves the text as it is; switching off
   * turns any Cyrillic into readable Latin (Иван → Ivan), since the log may
   * hold nothing Cyrillic with the mode off.
   */
  function reformatTypedDetail(text) {
    return station.ruPhonetics ? text : toLatinTranslit(text);
  }

  /**
   * Notes are free text, so the mode decides on its own without asking the
   * callsign: with the Russian mode off they are held to Latin like
   * everything else, with it on they are left exactly as typed.
   */
  function formatNotesText(raw) {
    return station.ruPhonetics ? raw : toLatinKeepCase(raw);
  }

  /**
   * Holds a field to an alphabet, converting only the characters just typed or
   * pasted — never the rest of the value.
   *
   * That distinction matters: these fields also hold what a lookup found, and
   * a record's own "Ростов-на-Дону" must survive being edited. Rewriting the
   * whole value on every keystroke would turn it into nonsense on the first
   * one. The formatter is asked fresh each time, because the alphabet depends
   * on the callsign above the field and on the mode, both of which change
   * while the app is running.
   */
  function attachLiveFormat(field, format) {
    field.addEventListener('input', ev => {
      const typed = ev && typeof ev.data === 'string' ? ev.data : '';
      if (!typed) return;   // a deletion, or an input event with nothing added

      const converted = format(typed);
      if (converted === typed) return;

      const end = field.selectionStart;
      const start = Math.max(0, end - typed.length);
      field.value = field.value.slice(0, start) + converted + field.value.slice(end);

      const caret = start + converted.length;
      field.setSelectionRange(caret, caret);
    });
  }

  function attachLatinInput(field, shape) {
    const format = {
      callsign: cleanCallsignInput,
      rda: formatRda,
      grid: formatGrid,
      place: raw => toLatinCode(raw).replace(FIELD_SHAPES.place, ''),
      code: raw => toLatinCode(raw).replace(FIELD_SHAPES.code, ''),
      text: toLatinKeepCase
    }[shape] || (raw => toLatinCode(raw).replace(FIELD_SHAPES.code, ''));

    field.addEventListener('input', () => {
      const cleaned = format(field.value);
      if (cleaned === field.value) return;

      // Not every kind of field has a caret to read or move: on type="email"
      // and type="number" Chromium hands back null for selectionStart and
      // throws outright on setSelectionRange. The text is still put right —
      // where the caret can't be placed, the browser keeps its own.
      const caret = field.selectionStart;
      const removed = field.value.length - cleaned.length;
      field.value = cleaned;
      if (caret === null || caret === undefined) return;
      // A formatter can add characters (the RDA hyphen) as well as drop them;
      // clamping keeps the caret inside the field either way.
      const position = Math.max(0, Math.min(cleaned.length, caret - removed));
      try { field.setSelectionRange(position, position); } catch (e) { /* no caret here */ }
    });
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function nowUtcParts() {
    const d = new Date();
    return {
      date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
      time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
    };
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[c]));
  }

  /** Uppercase, no stray spaces. Suffixes like /P and /QRP are kept. */
  function normalizeCallsign(raw) {
    return String(raw || '').trim().replace(/\s+/g, '').toUpperCase();
  }

  /**
   * My callsign without the operating suffixes: R2FEL/P, R2FEL/M,
   * R2FEL/QRP/P — all R2FEL. That's how this operator's contacts have always
   * gone to LoTW and eQSL: under the plain callsign. A prefix or a district
   * (DL/R2FEL, R2FEL/1) is a different callsign and stays as it is.
   */
  /** The callsign I'm working as right now — MY CALLSIGN in the station bar. */
  function currentMyCall() {
    const field = document.getElementById('s-callsign');
    return normalizeCallsign((field && field.value) || station.callsign);
  }

  /**
   * The log's "MY → CALL": my callsign, an arrow, theirs — who called whom.
   * Mine in the app's amber; an earlier callsign of mine (not the one in
   * MY CALLSIGN now, suffixes aside) quieter, in grey.
   */
  function myCallHtml(qso) {
    // Not recorded (logged with MY CALLSIGN empty, or imported from a file
    // that doesn't say): a grey "?" rather than nothing, and how to put it right.
    if (!qso.myCallsign) {
      const how = tr('Your callsign on this contact isn\'t recorded — set it in ⚙ → My callsign on contacts',
        'Ваш позывной у этой связи не записан — укажите его: ⚙ → «Мой позывной у связей»');
      return `<span class="qso-mine is-unknown" title="${escapeHtml(how)}">?</span><span class="qso-arrow">→</span>`;
    }
    const other = baseCallsign(qso.myCallsign) !== baseCallsign(currentMyCall());
    return `<span class="qso-mine${other ? ' is-other' : ''}">${escapeHtml(qso.myCallsign)}</span><span class="qso-arrow">→</span>`;
  }

  /** " · MY CALL UB2FEJ/P" — when an earlier contact was made under another callsign of mine than the one now. */
  function myCallNote(qso) {
    return qso.myCallsign && qso.myCallsign !== currentMyCall() ? ` · MY CALL ${qso.myCallsign}` : '';
  }

  const OPERATING_SUFFIXES = new Set(['P', 'M', 'MM', 'AM', 'QRP', 'QRPP', 'A']);
  function baseCallsign(raw) {
    const parts = normalizeCallsign(raw).split('/');
    while (parts.length > 1 && OPERATING_SUFFIXES.has(parts[parts.length - 1])) parts.pop();
    return parts.join('/');
  }

  // ---------------------------------------------------------------------
  // Phonetic spelling
  //
  // Read the correspondent's callsign back to them off this line instead of
  // sounding it out yourself — one less thing to get wrong on air.
  //
  // Both alphabets treat a suffix the same way: what follows a slash isn't
  // part of the callsign's letters, so it's set apart by a "/" glyph and
  // lower case. R2FEL/P reads "Romeo Two Foxtrot Echo Lima / stroke
  // portable", or «Роман Два Фёдор Елена Леонид / дробь поле» in Russian.
  // A few suffixes are said as words rather than spelled (see `suffixes`):
  // /P, /QRP, and in Russian /M — «дробь машина». R2FEL/QRP/P is "… / stroke
  // QRP / stroke portable", each suffix on its own.
  // ---------------------------------------------------------------------

  const PHONETIC = {
    A: 'Alfa', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot',
    G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliett', K: 'Kilo', L: 'Lima',
    M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo',
    S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey',
    X: 'X-ray', Y: 'Yankee', Z: 'Zulu',
    '0': 'Zero', '1': 'One', '2': 'Two', '3': 'Three', '4': 'Four',
    '5': 'Five', '6': 'Six', '7': 'Seven', '8': 'Eight', '9': 'Nine',
    '/': 'stroke',
    slashMark: '/',
    // Said as they are on air, each one whole between its slashes. /M stays
    // "Mike": English has no word for it the way Russian does.
    suffixes: { P: 'portable', QRP: 'QRP' }
  };

  /**
   * The same callsign as Russian operators spell it on air: each Latin letter
   * read as the Russian word for the Cyrillic letter it stands for — V is
   * «Жук», W is «Василий», X is «Знак», Y is «Игрек», Q is «Щука». So UA3XQV
   * reads «Ульяна Анна Три Знак Щука Жук».
   */
  const PHONETIC_RU = {
    A: 'Анна', B: 'Борис', C: 'Центр', D: 'Дмитрий', E: 'Елена', F: 'Фёдор',
    G: 'Григорий', H: 'Харитон', I: 'Иван', J: 'Иван Краткий', K: 'Константин',
    L: 'Леонид', M: 'Михаил', N: 'Николай', O: 'Ольга', P: 'Павел', Q: 'Щука',
    R: 'Роман', S: 'Сергей', T: 'Татьяна', U: 'Ульяна', V: 'Жук', W: 'Василий',
    X: 'Знак', Y: 'Игрек', Z: 'Зинаида',
    '0': 'Ноль', '1': 'Один', '2': 'Два', '3': 'Три', '4': 'Четыре',
    '5': 'Пять', '6': 'Шесть', '7': 'Семь', '8': 'Восемь', '9': 'Девять',
    '/': 'дробь',
    slashMark: '/',
    // «дробь поле», «дробь машина», «дробь QRP» — as said on air.
    suffixes: { P: 'поле', M: 'машина', QRP: 'QRP' }
  };

  // Whose callsigns get the Russian reading: Russia (R…, UA–UI), Belarus
  // (EU, EV, EW) and Kazakhstan (UN–UQ). The neighbouring U-blocks belong to
  // other countries — UJ–UM is Uzbekistan, UR–UZ Ukraine — and stay in NATO
  // spelling, as does everyone else.
  const CYRILLIC_CALL_PREFIX = /^(R|EU|EV|EW|U[A-IN-Q])/;

  function isCyrillicSpelledCall(raw) {
    const call = cleanCallsignInput(raw);
    if (!call) return false;
    // A prefix before the slash is where the station is actually operating
    // from: DL/R2FEL is in Germany, R2FEL/P is at home.
    return CYRILLIC_CALL_PREFIX.test(call.split('/')[0]);
  }

  /**
   * Which alphabet to read with. Russian only when the mode is switched on in
   * DATA *and* the callsign in question belongs to one of those three
   * countries — otherwise nothing changes.
   */
  function phoneticTableFor(callsign) {
    return station.ruPhonetics && isCyrillicSpelledCall(callsign) ? PHONETIC_RU : PHONETIC;
  }

  /** The spelling step itself, on text already reduced to A-Z, 0-9 and "/". */
  function spellOut(text, table) {
    const words = table || PHONETIC;
    const str = String(text || '');
    if (!str) return '';
    const spell = part => part.split('').map(ch => words[ch] || ch);
    const [first, ...rest] = str.split('/');
    const out = spell(first);
    rest.forEach(part => {
      // The slash carries its own glyph, so a suffix reads as an aside
      // rather than as more letters of the callsign.
      out.push(`${words.slashMark} ${words['/']}`);
      // Said as a word only when it's the whole part between slashes:
      // R2FEL/QRP/P is "QRP" then "portable", but the P in R2FEL/PX is just
      // Papa (and DL/R2FEL's slash is followed by a callsign, spelled).
      const said = words.suffixes && words.suffixes[part];
      out.push(...(said ? [said] : spell(part)));
    });
    return out.join(' ');
  }

  /**
   * Read out a callsign. Converted exactly the way the callsign fields
   * themselves convert what you type, so a character entered with the Russian
   * layout still active is read as the Latin letter it becomes — not as the
   * Cyrillic one that was in the field for the instant before the field
   * rewrote itself.
   */
  function phoneticSpelling(raw) {
    return spellOut(cleanCallsignInput(raw), phoneticTableFor(raw));
  }

  function updatePhonetic() {
    $('f-phonetic').textContent = phoneticSpelling($('f-callsign').value);
    // Catches the routes that set the field without typing into it — a
    // contact opened for editing, the form reset after logging, ✕.
    refreshPortableButtons();
    // The station bar reads in whichever alphabet this callsign calls for, so
    // it has to follow every change to this field.
    updateMyPhonetic();
  }

  function formatDateHuman(ymd) {
    if (!ymd) return '';
    const [y, m, d] = ymd.split('-');
    return y && m && d ? `${d}.${m}.${y}` : ymd;
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------------------------------------------------------------------
  // Frequency and bands
  //
  // Input is read as KILOHERTZ, the way it's read off the rig, and shown
  // grouped as MHz.kHz.tenths-of-kHz (compact — no padding on the MHz
  // digit, one decimal on the kHz):
  //   6145    -> 6.145.0
  //   7354.5  -> 7.354.5   (same for 7354,5 / 7354.50 / 7354,500)
  //   14250   -> 14.250.0
  // A value already in grouped form (old zero-padded style included) is
  // accepted as-is — see formatFrequency for the exact display shape.
  //
  // Ranges are in kHz, deliberately the widest in common use rather than one
  // region's allocation. Adding a band is one line.
  // ---------------------------------------------------------------------

  const BAND_PLAN = [
    { band: '160m', from: 1800, to: 2000 },
    { band: '80m', from: 3500, to: 4000 },
    { band: '40m', from: 7000, to: 7300 },
    { band: '30m', from: 10100, to: 10150 },
    { band: '20m', from: 14000, to: 14350 },
    { band: '17m', from: 18068, to: 18168 },
    { band: '15m', from: 21000, to: 21450 },
    { band: '12m', from: 24890, to: 24990 },
    { band: '10m', from: 28000, to: 29700 },
    { band: '2m', from: 144000, to: 148000 },
    { band: '70cm', from: 420000, to: 450000 }
  ];

  function parseFrequency(raw) {
    if (raw === null || raw === undefined) return null;
    const text = String(raw).trim().replace(/\s/g, '');
    if (!text) return null;
    if (!/^[0-9]+([.,][0-9]*)*$/.test(text)) return null;

    const parts = text.split(/[.,]/);

    if (parts.length === 3) {           // already grouped: MHz.kHz.Hz
      const mhz = Number(parts[0]);
      const khz = Number(parts[1].padEnd(3, '0'));
      const hz = Number(parts[2].padEnd(3, '0'));
      if (![mhz, khz, hz].every(Number.isFinite)) return null;
      return mhz * 1e6 + khz * 1000 + hz;
    }

    if (parts.length === 2) {           // kHz with a fractional part
      const whole = Number(parts[0]);
      const frac = parts[1] === '' ? 0 : Number(`0.${parts[1]}`);
      if (![whole, frac].every(Number.isFinite)) return null;
      return Math.round((whole + frac) * 1000);
    }

    if (parts.length === 1) {           // plain kHz
      const khz = Number(parts[0]);
      return Number.isFinite(khz) ? Math.round(khz * 1000) : null;
    }

    return null;
  }

  // Displayed compact — MHz (no padding), kHz (3 digits), tenths-of-kHz
  // (1 digit, i.e. rounded to the nearest 100 Hz) — e.g. 7145500 Hz shows
  // as "7.145.5" instead of the old, zero-padded "007.145.500". However
  // the operator typed it (dots, commas, no separators at all — see
  // parseFrequency), it's normalized to this same shape as soon as the
  // field is confirmed. The full, un-rounded value is kept separately
  // (qso.freqHz) for ADIF export, so this rounding never touches the
  // exported data.
  function formatFrequency(hz) {
    if (!Number.isFinite(hz)) return '';
    const total = Math.max(0, Math.round(hz / 100) * 100);
    const mhz = Math.floor(total / 1e6);
    const khz = Math.floor((total % 1e6) / 1000);
    const tenthKhz = Math.floor((total % 1000) / 100);
    return `${mhz}.${String(khz).padStart(3, '0')}.${tenthKhz}`;
  }

  function bandFor(hz) {
    if (!Number.isFinite(hz)) return null;
    const khz = hz / 1000;
    const match = BAND_PLAN.find(b => khz >= b.from && khz <= b.to);
    return match ? match.band : null;
  }

  /**
   * Frequency is optional — you can log a contact with only a band picked by
   * hand and no frequency at all. But whenever a frequency IS entered and it
   * falls inside a recognised amateur allocation, that band takes over the
   * chip automatically, exactly like a rig's own band readout: 14275 always
   * means 20m, no matter what was picked before. The band picker stays
   * click-driven only for the case frequency can't decide — the field left
   * blank, or a value outside any known allocation.
   */
  function applyFrequency(reformat, persistBand) {
    const input = $('f-freq');
    const hz = parseFrequency(input.value);

    input.classList.remove('is-ham', 'is-out');

    if (hz === null) return null;

    if (reformat) input.value = formatFrequency(hz);

    const band = bandFor(hz);
    input.classList.add(band ? 'is-ham' : 'is-out');

    if (band) setBand(band, persistBand !== false);

    return { hz };
  }

  // ---------------------------------------------------------------------
  // RST defaults
  //
  // Changing mode sets the customary report, but only while the fields still
  // hold a default — anything typed by hand is left alone.
  // ---------------------------------------------------------------------

  const MODES = ['SSB', 'CW', 'AM', 'FM', 'DMR', 'D-STAR', 'C4FM', 'DIGITAL'];

  /**
   * What the digital modes are called in an ADIF file. The standard has no
   * DMR or D-STAR mode of its own: they are submodes of DIGITALVOICE, and
   * that is what LoTW, eQSL and every other logbook expect to receive —
   * write "DMR" in the MODE field and the upload is refused. Plain DIGITAL
   * goes out as DIGITALVOICE without a submode: it stands with the three
   * above it in the list, for a digital contact whose flavour isn't one of
   * them.
   *
   * Our own label is written alongside in APP_LOG_MODE, so a file exported
   * here and imported here again comes back saying exactly what it said.
   */
  const ADIF_MODE = {
    'DMR': { mode: 'DIGITALVOICE', submode: 'DMR' },
    'D-STAR': { mode: 'DIGITALVOICE', submode: 'DSTAR' },
    'C4FM': { mode: 'DIGITALVOICE', submode: 'C4FM' },
    'DIGITAL': { mode: 'DIGITALVOICE' }
  };

  /** The MODE/SUBMODE fields for a contact, ours or standard. */
  function adifModeFields(mode) {
    const m = ADIF_MODE[String(mode || '').toUpperCase()];
    if (!m) return adifField('MODE', mode);
    return adifField('MODE', m.mode) + (m.submode ? adifField('SUBMODE', m.submode) : '') +
      adifField('APP_LOG_MODE', mode);
  }

  /** Back from a file: our own label first, then a known submode, then the mode. */
  function modeFromAdif(rec) {
    const ours = (rec.app_log_mode || '').toUpperCase();
    if (ours) return ours;
    const sub = (rec.submode || '').toUpperCase();
    const known = { DMR: 'DMR', DSTAR: 'D-STAR', 'D-STAR': 'D-STAR', C4FM: 'C4FM' }[sub];
    if (known) return known;
    return (rec.mode || '').toUpperCase();
  }

  const RST_BY_MODE = {
    SSB: ['59', '59'], AM: ['59', '59'], FM: ['59', '59'], SSTV: ['59', '59'],
    // Digital voice carries no readability and strength of its own; everyone
    // writes 59 out of habit, so that is what is offered.
    DMR: ['59', '59'], 'D-STAR': ['59', '59'], C4FM: ['59', '59'], DIGITAL: ['59', '59'],
    CW: ['599', '599'], RTTY: ['599', '599'], PSK31: ['599', '599'],
    FT8: ['-10', '-10'], FT4: ['-10', '-10'], JS8: ['-10', '-10']
  };

  const DEFAULT_RST_VALUES = new Set(['', '59', '599', '-10']);

  function currentMode() {
    return $('f-mode').value || 'SSB';
  }

  function setMode(mode, applyDefaults) {
    $('f-mode').value = mode;
    $('f-mode-btn').textContent = mode;
    if (applyDefaults) applyModeDefaults();
    // CW → voice: 599 has already become 59 above if it was the standard
    // report; a report typed by hand keeps its first two digits (579 → 57).
    reportFields().forEach(fitReport);
    renderModeMenu();

    // The mode is picked once and left alone, so it should survive a reload.
    if (station.mode !== mode) {
      station.mode = mode;
      persistStation();
    }
  }

  function renderModeMenu() {
    const mode = currentMode();
    $('f-mode-menu').innerHTML = MODES.map(m =>
      `<button type="button" data-mode="${m}" class="${m === mode ? 'is-current' : ''}">${m}</button>`
    ).join('');

    $('f-mode-menu').querySelectorAll('[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        setMode(btn.getAttribute('data-mode'), true);
        $('f-mode-menu').hidden = true;
      });
    });
  }

  // ---------------------------------------------------------------------
  // Band
  //
  // Picked by hand from BAND_PLAN, the same way mode is picked — not derived
  // from the frequency field, which stays optional.
  // ---------------------------------------------------------------------

  function currentBand() {
    return $('f-band').value || '';
  }

  function setBand(band, persist) {
    $('f-band').value = band || '';

    const btn = $('f-band-btn');
    btn.textContent = band || 'BAND';
    btn.classList.toggle('is-unset', !band);

    renderBandMenu();

    // Picked once and left alone, like mode — so it survives a reload.
    if (persist && station.band !== band) {
      station.band = band;
      persistStation();
    }
    // "New band" depends on which band it is.
    renderFirstBadge();
  }

  function renderBandMenu() {
    const band = currentBand();
    $('f-band-menu').innerHTML = BAND_PLAN.map(b =>
      `<button type="button" data-band="${b.band}" class="${b.band === band ? 'is-current' : ''}">${b.band}</button>`
    ).join('');

    $('f-band-menu').querySelectorAll('[data-band]').forEach(btn => {
      btn.addEventListener('click', () => {
        setBand(btn.getAttribute('data-band'), true);
        $('f-band-menu').hidden = true;
      });
    });
  }

  // ---- Log table: manual column widths -----------------------------------
  // Widths live as percentages on the <colgroup> <col> elements (see
  // index.html) so they always add up to 100% of the table — dragging a
  // handle only trades width between the two columns it touches, it never
  // makes the table wider than its container. Saved to localStorage so a
  // reload keeps whatever the operator set up. Desktop-only: the phone
  // layout hides two columns and uses its own fixed percentages.
  const COL_WIDTHS_KEY = 'qso-col-widths';
  const COL_COUNT = 10;
  const COL_MIN_PERCENT = 3;

  function isMobileTable() {
    // The card follows the window everywhere now (the desktop app's window
    // can be resized too), so the window's width decides.
    return window.matchMedia('(max-width: 700px)').matches;
  }


  function loadColWidths() {
    try {
      const arr = JSON.parse(localStorage.getItem(COL_WIDTHS_KEY));
      if (Array.isArray(arr) && arr.length === COL_COUNT && arr.every(n => typeof n === 'number' && n > 0)) {
        return arr;
      }
    } catch (e) { /* corrupt or unavailable — fall back to defaults */ }
    return null;
  }

  function saveColWidths(arr) {
    try { localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(arr)); }
    catch (e) { /* best effort only */ }
  }

  function applyColWidths() {
    const table = $('qso-table');
    if (!table) return;
    const cols = table.querySelectorAll('colgroup col');
    if (cols.length !== COL_COUNT) return;

    if (isMobileTable()) {
      // Let the phone-layout stylesheet rules take over untouched.
      cols.forEach(col => { col.style.width = ''; });
      return;
    }

    const saved = loadColWidths();
    cols.forEach((col, i) => {
      col.style.width = saved ? saved[i] + '%' : '';
    });
  }

  function resetColWidths() {
    try { localStorage.removeItem(COL_WIDTHS_KEY); } catch (e) { /* ignore */ }
    applyColWidths();
  }

  // Measured from the header cells (real rendered boxes) rather than the
  // <col> elements themselves, since <col> doesn't reliably report a
  // client rect across browsers.
  function readCurrentColPercents() {
    const table = $('qso-table');
    const ths = table.querySelectorAll('thead th');
    const tableWidth = table.getBoundingClientRect().width || 1;
    return Array.from(ths).map(th => (th.getBoundingClientRect().width / tableWidth) * 100);
  }

  function initColumnResize() {
    const table = $('qso-table');
    if (!table) return;
    const cols = table.querySelectorAll('colgroup col');
    let dragging = null;

    table.querySelectorAll('.qso-col-resizer').forEach(handle => {
      // No button for this — double-clicking any column divider puts every
      // column back to its default width, which is enough of a way out of a
      // badly dragged layout without another control in the way.
      handle.addEventListener('dblclick', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        resetColWidths();
      });

      handle.addEventListener('mousedown', ev => {
        if (isMobileTable()) return;
        ev.preventDefault();
        ev.stopPropagation();
        const idx = Number(handle.getAttribute('data-col-idx'));
        const percents = readCurrentColPercents();
        dragging = {
          idx,
          handle,
          startX: ev.clientX,
          startA: percents[idx],
          startB: percents[idx + 1],
          tableWidth: table.getBoundingClientRect().width || 1
        };
        handle.classList.add('is-dragging');
        document.body.style.cursor = 'col-resize';
      });
    });

    document.addEventListener('mousemove', ev => {
      if (!dragging) return;
      const deltaPercent = ((ev.clientX - dragging.startX) / dragging.tableWidth) * 100;
      let a = dragging.startA + deltaPercent;
      let b = dragging.startB - deltaPercent;
      if (a < COL_MIN_PERCENT) { b -= (COL_MIN_PERCENT - a); a = COL_MIN_PERCENT; }
      if (b < COL_MIN_PERCENT) { a -= (COL_MIN_PERCENT - b); b = COL_MIN_PERCENT; }
      cols[dragging.idx].style.width = a + '%';
      cols[dragging.idx + 1].style.width = b + '%';
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging.handle.classList.remove('is-dragging');
      document.body.style.cursor = '';
      dragging = null;
      saveColWidths(readCurrentColPercents());
    });

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(applyColWidths, 150);
    });
  }

  function applyModeDefaults() {
    const preset = RST_BY_MODE[currentMode()];
    if (!preset) return;

    const sent = $('f-rst-sent');
    const rcvd = $('f-rst-rcvd');

    if (DEFAULT_RST_VALUES.has(sent.value.trim())) sent.value = preset[0];
    if (DEFAULT_RST_VALUES.has(rcvd.value.trim())) rcvd.value = preset[1];
  }

  // ---------------------------------------------------------------------
  // Storage
  //
  // IndexedDB: localStorage caps out around 5 MB and rewrites the whole
  // logbook on every save, which won't hold a few thousand contacts. Anything
  // written by the earlier localStorage version is carried across on first
  // run, and the old copy is left in place as a safety net.
  //
  // If IndexedDB is unavailable (private browsing in some browsers), the app
  // falls back to localStorage rather than refusing to log.
  // ---------------------------------------------------------------------

  const DB_NAME = 'qso-log';
  const DB_VERSION = 1;
  const STORE = 'qsos';
  const FALLBACK_KEY = 'qso-entries-fallback';

  let db = null;
  let usingFallback = false;

  function openDb() {
    return new Promise(resolve => {
      if (!('indexedDB' in window)) { usingFallback = true; resolve(null); return; }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE)) {
          const store = database.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('callsign', 'callsign', { unique: false });
          store.createIndex('date', 'date', { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        console.warn('[storage] IndexedDB unavailable, using localStorage');
        usingFallback = true;
        resolve(null);
      };
    });
  }

  function dbAll() {
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  function dbWriteAll(list) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.clear();
      list.forEach(item => store.put(item));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  function dbPut(qso) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(qso);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  function dbDelete(id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  function sortEntries(list) {
    return list.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
  }

  /**
   * Records from the version that had a single BAND/FREQ field often carry a
   * frequency where the band should be ("7145"). Split those out so they show
   * and export correctly. Also re-stamps any frequency still shown in the
   * old zero-padded style ("007.145.000") into the current compact one
   * ("7.145.0") — using the stored exact value (qso.freqHz) when there is
   * one, or recovering it by re-parsing the old string when there isn't.
   * Returns true when something was changed.
   */
  function repairEntries() {
    let changed = false;
    let garbled = 0;

    entries.forEach(qso => {
      ['name', 'qth', 'country', 'notes'].forEach(field => {
        if (!qso[field]) return;
        const fixed = repairMojibake(qso[field]);
        if (fixed !== qso[field]) {
          qso[field] = fixed;
          garbled++;
          changed = true;
        }
      });

      if (qso.freq && !Number.isFinite(qso.freqHz)) {
        const recovered = parseFrequency(qso.freq);
        if (recovered !== null) qso.freqHz = recovered;
      }

      if (!qso.freq && qso.band) {
        const hz = parseFrequency(qso.band);
        if (hz !== null) {
          qso.freqHz = hz;
          qso.band = bandFor(hz) || '';
        }
      }

      if (Number.isFinite(qso.freqHz)) {
        const formatted = formatFrequency(qso.freqHz);
        if (qso.freq !== formatted) {
          qso.freq = formatted;
          changed = true;
        }
      }
    });

    if (garbled) console.info(`[data] put back ${garbled} garbled Russian text field(s) from an earlier import`);
    return changed;
  }

  async function loadEntries() {
    db = await openDb();

    if (!db) {
      try {
        const raw = localStorage.getItem(FALLBACK_KEY) || localStorage.getItem(LEGACY_KEY);
        entries = raw ? JSON.parse(raw) : [];
      } catch (e) { entries = []; }
      sortEntries(entries);
      return;
    }

    entries = await dbAll();

    if (!entries.length) {
      // First run on IndexedDB: bring across whatever the old version saved.
      let legacy = [];
      try {
        const raw = localStorage.getItem(LEGACY_KEY);
        legacy = raw ? JSON.parse(raw) : [];
      } catch (e) { legacy = []; }

      if (Array.isArray(legacy) && legacy.length) {
        legacy.forEach(item => { item.id = String(item.id); });
        await dbWriteAll(legacy);
        entries = legacy;
        localStorage.setItem(`${LEGACY_KEY}-migrated`, new Date().toISOString());
        console.info(`[storage] carried over ${legacy.length} contact(s) from the previous version`);
      }
    }

    sortEntries(entries);
  }

  async function saveEntry(qso) {
    if (!db) {
      try { localStorage.setItem(FALLBACK_KEY, JSON.stringify(entries)); } catch (e) {}
      return;
    }
    await dbPut(qso);
  }

  async function removeEntry(id) {
    if (!db) {
      try { localStorage.setItem(FALLBACK_KEY, JSON.stringify(entries)); } catch (e) {}
      return;
    }
    await dbDelete(id);
  }

  async function saveAll() {
    if (!db) {
      try { localStorage.setItem(FALLBACK_KEY, JSON.stringify(entries)); } catch (e) {}
      return;
    }
    await dbWriteAll(entries);
  }

  // ---- Station settings ----

  function persistStation() {
    try { localStorage.setItem(STATION_KEY, JSON.stringify(station)); } catch (e) {}
  }

  function loadStation() {
    try {
      const raw = localStorage.getItem(STATION_KEY);
      if (raw) station = Object.assign(station, JSON.parse(raw));
    } catch (e) {}
    if (!Array.isArray(station.recent)) station.recent = [];
    if (!Number.isFinite(station.exportedCount)) station.exportedCount = 0;
    station.contest = Boolean(station.contest);
    station.ruPhonetics = Boolean(station.ruPhonetics);
    // Missing entirely (an older save) means "on" — this is an opt-out.
    station.showPhonetics = station.showPhonetics === undefined ? true : Boolean(station.showPhonetics);
    if (!Number.isFinite(station.serial) || station.serial < 1) station.serial = 1;
  }

  function loadAuth() {
    try {
      const raw = localStorage.getItem(AUTH_STORAGE);
      if (raw) auth = JSON.parse(raw);
    } catch (e) { auth = { mode: 'none' }; }
  }

  function saveAuth(next) {
    auth = next;
    try { localStorage.setItem(AUTH_STORAGE, JSON.stringify(next)); } catch (e) {}
    updateSubtitle();
  }

  // ---------------------------------------------------------------------
  // My station bar
  // ---------------------------------------------------------------------

  function readStationFields() {
    // While a saved contact is open for editing, the station bar shows the
    // callsign *that contact* was made under — R2FEL's log is full of UB2FEJ
    // ones. That is not a change of station and must not be remembered:
    // it used to stay in the bar after the edit (even after Cancel), so the
    // next contact went into the log under the old callsign, and from there
    // to LoTW and eQSL under a callsign that isn't his any more.
    if (editingId) {
      updateMyPhonetic();
      updateMyWeather();
      return;
    }
    station.callsign = normalizeCallsign($('s-callsign').value);
    station.rda = formatRda($('s-rda').value);
    station.qth = formatGrid($('s-qth').value);
    persistStation();
    // Whatever route a value arrived by — typed, 📍, or a contact opened for
    // editing — the readings underneath follow it from here.
    updateMyPhonetic();
    updateMyWeather();
  }

  function fillStationFields() {
    $('s-callsign').value = station.callsign || '';
    $('s-rda').value = station.rda || '';
    $('s-qth').value = formatGrid(station.qth || '');   // saved by an older version as KO85tr
    updateMyPhonetic();
    updateMyWeather();
    lockStationFields();
  }

  // ---------------------------------------------------------------------
  // My own station, once it is set
  //
  // The callsign, the district and the locator are typed once and then read
  // out loud every contact — but they sit right under the hand at the top of
  // the window, and a stray keystroke there quietly changed the callsign
  // every contact was being logged under. So a filled field goes grey and
  // stops taking the keyboard; the pencil at its end opens it for editing,
  // and it closes again as soon as the field is left.
  // ---------------------------------------------------------------------

  const LOCK_FIELDS = ['s-callsign', 's-rda', 's-qth'];

  function setFieldLocked(input, locked) {
    input.readOnly = locked;
    const field = input.closest('.qso-field');
    if (field) field.classList.toggle('is-locked', locked);
  }

  /** Greys out every station field that has something in it and isn't being edited. */
  function lockStationFields() {
    LOCK_FIELDS.forEach(id => {
      const input = $(id);
      if (document.activeElement === input && !input.readOnly) return;
      setFieldLocked(input, input.value.trim() !== '');
    });
  }

  function openStationField(input) {
    setFieldLocked(input, false);
    input.focus();
    input.select();
  }

  /**
   * Read out a code — an RDA district or a locator — rather than a callsign.
   * Two differences: the separator isn't read out, so KA-05 is "Kilo Alfa
   * Zero Five" and not "Kilo Alfa dash …"; and Cyrillic is resolved the way
   * those fields resolve it (a look-alike letter first, КО04 meaning KO04,
   * then the key position), which is not the same rule callsigns use.
   */
  function phoneticCode(raw, table) {
    return spellOut(toLatinCode(raw).replace(/[^A-Z0-9]/g, ''), table);
  }

  /**
   * All three lines under the station fields at once — callsign, RDA and
   * locator, each spelled out ready to read on air.
   *
   * The alphabet is chosen by the callsign in the CALLSIGN field, not by your
   * own: you read your station's details out to whoever you're working, so
   * they follow that side. Working a Russian, Belarusian or Kazakh station
   * with Russian mode on, all four lines go Russian together; working anyone
   * else, all four stay NATO.
   *
   * Which also means there is no answer at all until a callsign is being
   * worked: with CALLSIGN empty, these lines stay blank rather than picking
   * NATO on the operator's behalf and then switching alphabet under them the
   * moment a Russian call is typed in.
   *
   * Called from more than just the keystroke handlers on purpose: a value can
   * appear in a field without any 'input' event — the browser restoring the
   * form on reload, 📍 filling in the grid and RDA, an old contact opened for
   * editing — and a blank line under a filled field is worse than useless
   * when you're about to read it out.
   */
  function updateMyPhonetic() {
    const working = cleanCallsignInput($('f-callsign').value);
    const table = phoneticTableFor($('f-callsign').value);

    $('s-phonetic').textContent = working
      ? spellOut(cleanCallsignInput($('s-callsign').value), table) : '';
    $('s-rda-phonetic').textContent = working ? phoneticCode($('s-rda').value, table) : '';
    $('s-qth-phonetic').textContent = working ? phoneticCode($('s-qth').value, table) : '';
  }

  // ---------------------------------------------------------------------
  // Contest mode
  //
  // A running serial number sent with every contact, and the one received in
  // return. The sent number counts itself up as contacts are logged and is
  // skipped by Tab; the received number is the only thing to type, so the
  // rhythm is: callsign → Tab → their number → Enter. Group logging is off
  // while this is on — in a contest you work one station at a time.
  // ---------------------------------------------------------------------

  /**
   * The phonetic alphabet entirely, on or off — not just the Russian reading
   * of it. Off hides every spelled-out line the app draws (correspondent, my
   * station, RDA, grid, each group row) via one CSS rule on the root, so
   * there's nothing per-field to keep in sync.
   */
  function setShowPhonetics(on, persist) {
    station.showPhonetics = Boolean(on);
    if (persist) console.info(`[settings] phonetic alphabet ${on ? 'on' : 'off'}`);

    $('qso-root').classList.toggle('no-phonetics', !station.showPhonetics);
    renderPhoneticsSwitch();

    if (persist) persistStation();
  }

  /** A settings switch (⚙) shown on or off. */
  function renderSwitch(id, on) {
    $(id).classList.toggle('is-on', on);
    $(id).setAttribute('aria-checked', String(on));
  }

  function renderPhoneticsSwitch() {
    renderSwitch('phonetics-toggle-btn', station.showPhonetics);
  }

  /**
   * Russian mode on or off. Nothing about the logbook changes — only how the
   * four spelling lines read, which language settings and messages are in,
   * and how DATE and TIME are shown — so switching it is instant and
   * reversible.
   */
  function setRuPhonetics(on, persist) {
    station.ruPhonetics = Boolean(on);
    if (persist) console.info(`[settings] Russian mode ${on ? 'on' : 'off'}`);

    renderSwitch('ru-phonetics-btn', station.ruPhonetics);

    updatePhonetic();          // refreshes the station bar too
    refreshGroupPhonetics();
    refreshDetailScripts();    // anything already typed follows the new rule

    applyLanguage();
    applyDateTimeFormat();

    if (persist) persistStation();
  }

  // ---------------------------------------------------------------------
  // Russian mode, beyond the alphabet
  //
  // The same switch that reads RU / BY / KZ callsigns in Russian also puts
  // settings, the dialogs opened from them and the app's messages into
  // Russian, and shows DATE and TIME the Russian way. The logging form's own
  // labels stay English, the language of QSL cards and contest rules.
  //
  // Text in the page carries its Russian beside it: data-ru for an element's
  // text, data-ru-title for its tooltip, data-ru-placeholder for a field's
  // hint. The English is whatever the markup says, set aside the first time
  // it's swapped out. Messages built in code pick theirs with tr().
  // ---------------------------------------------------------------------

  function tr(en, ru) {
    return station.ruPhonetics ? ru : en;
  }

  function applyLanguage() {
    const ru = station.ruPhonetics;
    const swap = (ruAttr, enAttr, read, write) => {
      document.querySelectorAll(`[${ruAttr}]`).forEach(el => {
        if (!el.hasAttribute(enAttr)) el.setAttribute(enAttr, read(el));
        write(el, el.getAttribute(ru ? ruAttr : enAttr));
      });
    };
    swap('data-ru', 'data-en', el => el.textContent, (el, v) => { el.textContent = v; });
    swap('data-ru-title', 'data-en-title', el => el.title, (el, v) => { el.title = v; });
    swap('data-ru-placeholder', 'data-en-placeholder',
      el => el.placeholder, (el, v) => { el.placeholder = v; });

    // What code writes into settings follows along too. Statuses left from
    // before the switch are dropped rather than left in the other language.
    renderPhoneticsSwitch();
    refreshPortableButtons();   // the /P buttons explain themselves in their tooltips
    renderUpdateRow();
    // The app's own right-click menu speaks whichever language this is.
    if (window.desktopApp && window.desktopApp.setLanguage) {
      window.desktopApp.setLanguage(ru);
    }
    refreshStationFilter();
    renderQrzAccountsStatus();
    renderBackupNote();
    renderSettingsCounts();
    setDataStatus('');
    setImportStatus('');
    setFillStatus('');
    paintStatus($('lotw-status'), '');
    paintStatus($('eqsl-status'), '');
    paintStatus($('hamlog-status'), '');
    if (pendingImport) renderImportPreview();
    renderMyCallFix();
  }

  /*
   * DATE and TIME the way the operator reads them. The browser's own date
   * and time fields can't be given a format — they follow the Mac's system
   * language, which on an English Mac means 09/14/2026 and 6:25 PM — so in
   * Russian mode they become plain text fields showing 14.09.2026 and 18:25.
   * Code never reads or writes .value on them directly: dateValue/setDateValue
   * and timeValue/setTimeValue always speak 2026-09-14 and 18:25, whichever
   * kind of field is showing.
   */
  const DATE_FIELDS = ['f-date', 'exp-from', 'exp-to', 'mc-from', 'mc-to', 'imp-from', 'imp-to'];
  const TIME_FIELDS = ['f-time'];

  /** 14.09.2026, 14.9.26, 14/09/2026 or 2026-09-14 → 2026-09-14; '' if not a real date. */
  function parseDateText(text) {
    const t = String(text).trim();
    let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    let year, month, day;
    if (m) {
      [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
    } else {
      m = t.match(/^(\d{1,2})[./ -](\d{1,2})[./ -](\d{4}|\d{2})$/);
      if (!m) return '';
      [day, month] = [Number(m[1]), Number(m[2])];
      year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    }
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return '';
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  /** 18:25, 18.25, 1825 or 925 → 18:25 / 09:25; '' if not a real time. */
  function parseTimeText(text) {
    const m = String(text).trim().match(/^(\d{1,2})[:. ]?(\d{2})$/);
    if (!m) return '';
    const [h, min] = [Number(m[1]), Number(m[2])];
    return h < 24 && min < 60 ? `${pad(h)}:${pad(min)}` : '';
  }

  function dateValue(el) {
    return el.type === 'date' ? el.value : parseDateText(el.value);
  }

  function setDateValue(el, iso) {
    el.value = el.type === 'date' ? (iso || '') : formatDateHuman(iso || '');
  }

  function timeValue(el) {
    return el.type === 'time' ? el.value.slice(0, 5) : parseTimeText(el.value);
  }

  function setTimeValue(el, hhmm) {
    el.value = hhmm || '';
  }

  function applyDateTimeFormat() {
    const asText = station.ruPhonetics;
    DATE_FIELDS.forEach(id => {
      const el = $(id);
      const iso = dateValue(el);
      el.type = asText ? 'text' : 'date';
      el.placeholder = asText ? 'ДД.ММ.ГГГГ' : '';
      el.inputMode = asText ? 'numeric' : '';
      setDateValue(el, iso);
    });
    TIME_FIELDS.forEach(id => {
      const el = $(id);
      const hhmm = timeValue(el);
      el.type = asText ? 'text' : 'time';
      el.placeholder = asText ? 'ЧЧ:ММ' : '';
      el.inputMode = asText ? 'numeric' : '';
      setTimeValue(el, hhmm);
    });
  }

  /** A two-digit year, 01.09.26, is shown back in full, 01.09.2026, once left. */
  function tidyDateTimeField(el) {
    if (el.type !== 'text' || !el.value.trim()) return;
    if (DATE_FIELDS.includes(el.id)) {
      const iso = parseDateText(el.value);
      if (iso) setDateValue(el, iso);
    } else {
      const hhmm = parseTimeText(el.value);
      if (hhmm) setTimeValue(el, hhmm);
    }
  }

  /*
   * Digits only, in the shape of a date or a time: as plain text fields
   * (Russian mode, above) these would otherwise take letters and anything
   * else. The dots and the colon go in by themselves as the digits arrive,
   * and a digit that can't be one — a 13th month, a 25th hour — isn't taken.
   * A first digit that can only mean one thing is completed at once: 5 in
   * the day is 05, 9 in the hours is 09 — so 925 is 09:25.
   */
  function maskDateDigits(digits) {
    let day = '', month = '', year = '';
    for (const d of digits) {
      const n = Number(d);
      if (day.length < 2) {
        if (!day) day = n > 3 ? `0${d}` : d;
        else if ((day === '3' && n > 1) || (day === '0' && n === 0)) continue;
        else day += d;
      } else if (month.length < 2) {
        if (!month) month = n > 1 ? `0${d}` : d;
        else if ((month === '1' && n > 2) || (month === '0' && n === 0)) continue;
        else month += d;
      } else if (year.length < 4) {
        // 19xx or 20xx — or two digits, 26 for 2026. Nothing earlier.
        if (!year && n !== 1 && n !== 2) continue;
        if (year === '1' && n !== 9) continue;
        year += d;
      }
    }
    return [day, month, year].filter(Boolean).join('.');
  }

  function maskTimeDigits(digits) {
    let hh = '', mm = '';
    for (const d of digits) {
      const n = Number(d);
      if (hh.length < 2) {
        if (!hh) hh = n > 2 ? `0${d}` : d;
        else if (hh === '2' && n > 3) continue;
        else hh += d;
      } else if (mm.length < 2) {
        mm += mm ? d : (n > 5 ? `0${d}` : d);
      }
    }
    return [hh, mm].filter(Boolean).join(':');
  }

  function maskDateTimeField(el) {
    if (el.type !== 'text') return;
    const isDate = DATE_FIELDS.includes(el.id);
    let raw = el.value;
    // A whole date pasted the other way round — 2026-09-14 — is still that date.
    if (isDate && /^\s*\d{4}-\d{1,2}-\d{1,2}\s*$/.test(raw)) {
      raw = formatDateHuman(parseDateText(raw)) || raw;
    }

    const caret = el.selectionStart === null ? raw.length : el.selectionStart;
    const atEnd = caret >= raw.length;
    const digitsBefore = raw.slice(0, caret).replace(/\D/g, '').length;
    const masked = (isDate ? maskDateDigits : maskTimeDigits)(raw.replace(/\D/g, ''));
    if (masked === el.value) return;

    el.value = masked;
    // The caret stays after the same digit it followed (or at the end, where
    // typing normally happens — a completed 05 must not leave it inside).
    let pos = masked.length;
    if (!atEnd) {
      let seen = 0;
      for (pos = 0; pos < masked.length && seen < digitsBefore; pos++) {
        if (/\d/.test(masked[pos])) seen++;
      }
    }
    el.setSelectionRange(pos, pos);
  }

  /**
   * Re-runs the alphabet rule over details already typed — for when the mode
   * is switched with a contact half-entered, so the fields don't end up half
   * in one alphabet and half in the other.
   */
  function refreshDetailScripts() {
    const call = $('f-callsign').value;

    // A record already on screen was written in the alphabet of the mode that
    // was in force when it arrived, so it is read again under the new one.
    // Only records a lookup actually answered: anything typed by hand is the
    // operator's and is left to the conversion below.
    if (lookupDoneCallsign && lookupDoneCallsign === normalizeCallsign(call)) {
      runLookup(true);
    }
    Array.from($('f-group-list').querySelectorAll('.qso-group-row')).forEach(row => {
      if (row._refresh) row._refresh();
    });
    [['f-q-name', 'f-name'], ['f-q-qth', 'f-qth']].forEach(([from, to]) => {
      const fixed = reformatTypedDetail($(from).value);
      if (fixed === $(from).value) return;
      $(from).value = fixed;
      $(to).value = fixed;
    });

    Array.from($('f-group-list').querySelectorAll('.qso-group-row')).forEach(row => {
      if (!row._els) return;
      [row._els.qName, row._els.qQth].forEach(field => {
        field.value = reformatTypedDetail(field.value);
      });
      renderGroupCorrespondent(row, null);
    });

    renderCorrespondent(null);
  }

  function formatSerial(n) {
    const value = Math.max(1, Math.round(Number(n) || 1));
    return String(value).padStart(3, '0');
  }

  function setContestMode(on, persist) {
    station.contest = Boolean(on);
    if (persist) console.info(`[settings] contest mode ${on ? 'on' : 'off'}`);

    $('f-nr-sent-cell').hidden = !on;
    $('f-nr-rcvd-cell').hidden = !on;
    $('f-nr-reset').hidden = !on;
    $('f-group-btn').hidden = Boolean(on);
    $('s-contest-btn').classList.toggle('is-on', Boolean(on));

    // Rows already on screen stay (nothing typed is thrown away), but they
    // stop offering to add more while the contest mode is on.
    $('f-group-list').classList.toggle('is-contest', Boolean(on));

    if (on && !$('f-nr-sent').value.trim()) {
      $('f-nr-sent').value = formatSerial(station.serial);
    }

    if (persist) persistStation();
  }

  /**
   * Moves the sent serial on by however many contacts were just logged (a
   * pileup logged in one go takes consecutive numbers) and shows the next one
   * in the field, ready to go out.
   */
  function advanceSerial(count) {
    if (!station.contest) return;

    const shown = Number($('f-nr-sent').value.trim());
    const current = Number.isFinite(shown) && shown > 0 ? shown : station.serial;

    station.serial = current + Math.max(1, count || 1);
    persistStation();
    $('f-nr-sent').value = formatSerial(station.serial);
  }

  /**
   * Back to 001 for a new contest. The count is deliberately remembered
   * between sessions (a contest can span a night's sleep), so starting the
   * next one over is an explicit act — this button. Nothing already in the
   * log is touched: those contacts keep the numbers they were sent with.
   */
  function resetSerial() {
    station.serial = 1;
    persistStation();
    $('f-nr-sent').value = formatSerial(station.serial);
    $('f-nr-rcvd').value = '';
    flashSaved('✓ SERIAL BACK TO 001');
    $('f-callsign').focus();
  }

  /**
   * Looks up the RDA (Russian District Award) district for a point, through
   * this app's own server — see /api/rda-lookup in server.js for where that
   * actually goes (the same public map service r1cf.ru/rdaloc itself reads
   * from). Always resolves: { rda, name } on success, otherwise { reason }
   * saying what went wrong, so the status line can be specific instead of
   * just quietly falling back to opening the map.
   */
  async function lookupRdaByCoords(lat, lon) {
    let res;
    try {
      res = await fetch('/api/rda-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lon, accessKey: auth.accessKey || '' })
      });
    } catch (e) {
      return { reason: 'the app server is not responding' };
    }

    // An older server build has no such route: the request comes back as the
    // 404 page rather than JSON. Saying so beats a vague failure — a restart
    // is all it takes.
    if (res.status === 404) {
      return { reason: 'this app version needs a restart to enable RDA lookup' };
    }

    let data = null;
    try { data = await res.json(); } catch (e) { /* not JSON */ }

    if (!data) return { reason: `RDA service error (HTTP ${res.status})` };
    if (data.needsAuth) return { reason: 'sign in (⚙) to use RDA lookup' };
    if (data.found) return { rda: data.rda, name: data.name };
    if (data.error) return { reason: data.error };

    return { reason: 'no RDA district at this point' };
  }

  /**
   * What the 📍 button has to say, shown as a note floating over the form for
   * a few seconds rather than as a line inside the station block — the block
   * stays the same height whether there's something to report or not. A
   * result that worked needs no reading anyway: the answer is in the fields.
   * Pass holdMs = 0 to leave it up (used for "detecting…", which is replaced
   * by the outcome).
   */
  let geoStatusTimer = null;

  function setGeoStatus(text, kind, holdMs) {
    const el = $('s-geo-status');
    clearTimeout(geoStatusTimer);
    if (text && kind !== 'pending') console.info(`[location] ${text}`);

    el.textContent = text || '';
    el.className = 'qso-geo-status' + (kind ? ` ${kind}` : '');
    el.hidden = !text;

    if (text && holdMs) {
      geoStatusTimer = setTimeout(() => { el.hidden = true; }, holdMs);
    }
  }

  /**
   * One click fills in both MY QTH LOCATOR and MY RDA from the browser's own
   * location. Grid is exact, offline Maidenhead math; RDA goes through this
   * app's server to the same map service operators already use by hand (see
   * lookupRdaByCoords). If that lookup fails or the point isn't in any
   * district, the coordinates are copied to the clipboard and the map opens
   * in a new tab instead, ready to paste in and read the code off by hand.
   */
  async function detectMyLocation() {
    if (!navigator.geolocation) {
      setGeoStatus(tr('geolocation is not available in this browser', 'геолокация здесь недоступна'), 'err', 9000);
      return;
    }

    setGeoStatus(tr('detecting your location…', 'определяю местоположение…'), 'pending', 0);

    // In the Mac app, macOS's own permission comes first — asked for here,
    // with the system prompt, since Electron never asks on its own.
    if (window.desktopApp && !(await desktopLocationAllowed())) return;

    navigator.geolocation.getCurrentPosition(
      async pos => {
        const { latitude, longitude } = pos.coords;
        const grid = latLonToGrid(latitude, longitude);

        if (grid) {
          $('s-qth').value = formatGrid(grid);
          readStationFields();
          lockStationFields();
        }

        setGeoStatus(grid
          ? tr(`grid set: ${formatGrid(grid)} — looking up RDA…`, `локатор: ${formatGrid(grid)} — ищу RDA…`)
          : tr('could not compute a grid from that position — looking up RDA…',
            'не удалось вычислить локатор — ищу RDA…'), 'pending', 0);

        const rdaResult = await lookupRdaByCoords(latitude, longitude);

        if (rdaResult && rdaResult.rda) {
          $('s-rda').value = formatRda(rdaResult.rda);
          readStationFields();
          lockStationFields();
          setGeoStatus(
            `RDA${tr(' set', '')}: ${formatRda(rdaResult.rda)}${rdaResult.name ? ` (${rdaResult.name})` : ''}`,
            'ok',
            3500
          );
        } else {
          // Couldn't get the district automatically — say exactly why, then
          // fall back to reading it off the map by hand. This one stays up
          // long enough to read: there's something to do about it.
          const coords = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
          let copied = false;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            try { await navigator.clipboard.writeText(coords); copied = true; } catch (e) { /* ignore */ }
          }
          window.open('https://r1cf.ru/rdaloc/', '_blank', 'noopener');
          const reason = (rdaResult && rdaResult.reason) || tr('not found', 'не найден');
          setGeoStatus(tr(
            `RDA: ${reason} — opened the map (coords ${coords}${copied ? ', copied' : ''}), paste there and type the code into MY RDA`,
            `RDA: ${reason} — открыта карта (координаты ${coords}${copied ? ', скопированы' : ''}): вставьте их туда и впишите код в MY RDA`),
            'err',
            12000
          );
          $('s-rda').focus();
        }

        if ($('f-callsign').value.trim()) renderCorrespondent(null);
      },
      err => {
        // Windows gives no prompt of its own to answer: whatever went wrong,
        // the fix is in its Location settings (or typing the locator in).
        if (window.desktopApp && (err.code === err.PERMISSION_DENIED || isWindowsApp())) {
          showLocationSettings('denied');
          return;
        }
        setGeoStatus(err.code === err.PERMISSION_DENIED
          ? tr('location permission denied — allow it in the browser to use this',
            'доступ к геопозиции запрещён — разрешите его в браузере')
          : tr('could not get your location', 'не удалось определить местоположение'), 'err', 9000);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  /**
   * The Mac app's side of 📍: whether macOS lets R2FEL-LOG use the location.
   * On a fresh install this puts up the system prompt and waits for the
   * answer (see handleLocationAccess in electron-main.js). Once refused,
   * macOS won't prompt again — the switch is in System Settings, which is
   * opened right away with a note saying what to turn on.
   */
  async function desktopLocationAllowed() {
    let access = 'unknown';
    try { access = await window.desktopApp.locationAccess(); } catch (e) { /* older shell */ }

    if (access === 'denied' || access === 'disabled') {
      showLocationSettings(access);
      return false;
    }
    if (access === 'restricted') {
      setGeoStatus(tr('location access is restricted on this Mac (Screen Time or a device profile)',
        'доступ к геопозиции ограничен на этом Mac (Экранное время или профиль)'), 'err', 12000);
      return false;
    }
    if (access === 'not-determined') {
      setGeoStatus(tr('no answer to the macOS location prompt — press 📍 to ask again',
        'нет ответа на запрос macOS — нажмите 📍 ещё раз'), 'err', 9000);
      return false;
    }
    return true;   // granted — or unknown (no helper), where the page's own error says the rest
  }

  function isWindowsApp() {
    return Boolean(window.desktopApp && window.desktopApp.platform === 'win32');
  }

  function showLocationSettings(why) {
    // Windows 7 and 8 have no location setting for apps at all.
    if (isWindowsApp() && /Windows NT 6\./.test(navigator.userAgent)) {
      setGeoStatus(tr('this version of Windows can\'t tell apps where you are — type your locator into MY QTH LOCATOR',
        'эта версия Windows не сообщает программам местоположение — впишите локатор в MY QTH LOCATOR вручную'), 'err', 15000);
      return;
    }
    window.desktopApp.openLocationSettings();
    if (isWindowsApp()) {
      setGeoStatus(tr('couldn\'t get your location — in Windows Settings (just opened) turn on Location services and “Let desktop apps access your location”, then press 📍 again — or type your locator into MY QTH LOCATOR',
        'не удалось определить местоположение — в открывшихся Параметрах Windows включите «Службы определения местоположения» и «Разрешить классическим приложениям доступ к местоположению», затем нажмите 📍 ещё раз — или впишите локатор в MY QTH LOCATOR'),
        'err', 20000);
      return;
    }
    setGeoStatus(why === 'disabled'
      ? tr('Location Services are off on this Mac — turn them on in System Settings (just opened), then press 📍 again',
        'Службы геолокации на этом Mac выключены — включите их в открывшихся Системных настройках и нажмите 📍 ещё раз')
      // The program by its own name; in System Settings it's listed by its file's, R2FEL-LOG.
      : tr('R2FEL HamLog may not use your location — switch R2FEL-LOG on under Location Services in System Settings (just opened), then press 📍 again',
        'Программе не разрешён доступ к геопозиции — в открывшихся Системных настройках включите R2FEL-LOG в «Службах геолокации» и нажмите 📍 ещё раз'),
      'err', 20000);
  }

  // ---------------------------------------------------------------------
  // Weather
  //
  // The temperature where the other station is, next to how far away they
  // are, and the same for your own locator up in the station bar. Asked for
  // by locator, and each answer is kept for a quarter of an hour: the panel
  // redraws on every keystroke, and none of those redraws should reach the
  // network. A locator already being asked about is not asked about twice.
  // ---------------------------------------------------------------------

  const WEATHER_TTL = 15 * 60 * 1000;
  const weatherByGrid = new Map();   // grid → { wx, at }
  const weatherInFlight = new Set();

  // WMO weather codes as Open-Meteo reports them, grouped the way they
  // actually differ at a glance. Clear and near-clear skies get a night
  // variant — it can well be dark at the other end of the contact.
  const WEATHER_LOOKS = [
    { codes: [0], day: '☀️', night: '🌙', words: 'clear' },
    { codes: [1], day: '🌤️', night: '🌙', words: 'mainly clear' },
    { codes: [2], day: '⛅', night: '☁️', words: 'partly cloudy' },
    { codes: [3], icon: '☁️', words: 'overcast' },
    { codes: [45, 48], icon: '🌫️', words: 'fog' },
    { codes: [51, 53, 55], icon: '🌦️', words: 'drizzle' },
    { codes: [56, 57], icon: '🌧️', words: 'freezing drizzle' },
    { codes: [61, 63, 65], icon: '🌧️', words: 'rain' },
    { codes: [66, 67], icon: '🌧️', words: 'freezing rain' },
    { codes: [71, 73, 75, 77], icon: '❄️', words: 'snow' },
    { codes: [80, 81, 82], icon: '🌦️', words: 'showers' },
    { codes: [85, 86], icon: '🌨️', words: 'snow showers' },
    { codes: [95], icon: '⛈️', words: 'thunderstorm' },
    { codes: [96, 99], icon: '⛈️', words: 'thunderstorm, hail' }
  ];

  // Around a fresh breeze. Below this the wind isn't worth a mention; above
  // it, under an otherwise plain sky, it's the thing about the weather.
  const WINDY_MS = 8;

  /**
   * The line beside the correspondent's town: how far away they are and what
   * the sky is doing there. Both are drawn rather than boxed — a great-circle
   * arc from my dot to theirs, and the weather's own icon — so the row reads
   * as one sentence instead of three framed objects.
   */
  const DIST_ARC =
    '<svg class="qso-dist-arc" width="40" height="15" viewBox="0 0 40 15" aria-hidden="true">' +
      '<path class="qso-dist-path" d="M4 12 Q20 -2.5 36 12"></path>' +
      '<circle class="qso-dist-me" cx="4" cy="12" r="3"></circle>' +
      '<circle class="qso-dist-them" cx="36" cy="12" r="3"></circle>' +
    '</svg>';

  function distanceBadge(km, approx) {
    if (km === null || km === undefined) return '';
    const title = approx
      ? 'straight-line distance — from a locator worked out, not stated'
      : 'straight-line distance to the correspondent';
    return ` <span class="qso-dist" title="${title}">${DIST_ARC}` +
      `<span>${approx ? '≈ ' : ''}${km.toLocaleString('ru-RU')} km</span></span>`;
  }

  function weatherBadge(wx, look) {
    if (!wx) return '';
    return ` <span class="qso-temp" title="${escapeHtml(look.words || 'current weather there')}">` +
      (look.icon ? `<span class="qso-wx-icon">${look.icon}</span>` : '') +
      `${escapeHtml(formatTempC(wx.tempC))}</span>`;
  }

  // The twelve clock-face emoji, one per hour — the nearest one stands in
  // for a real analogue clock icon without drawing one.
  const CLOCK_FACES = ['🕛', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚'];

  function clockFace(hour, minute) {
    const rounded = Math.round((hour % 12) + minute / 60) % 12;
    return CLOCK_FACES[rounded];
  }

  /** Correspondent's own wall-clock time, worked out from the UTC offset
   *  their weather reading came with — the same reading, so it costs no
   *  extra request and never appears when the weather doesn't either. */
  function timeBadge(wx) {
    if (!wx || !Number.isFinite(wx.utcOffsetSeconds)) return '';
    const local = new Date(Date.now() + wx.utcOffsetSeconds * 1000);
    const hh = local.getUTCHours();
    const mm = local.getUTCMinutes();
    const hhmm = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    return ` <span class="qso-time" title="current local time there">` +
      `<span class="qso-clock-icon">${clockFace(hh, mm)}</span>${hhmm}</span>`;
  }

  function formatTempC(tempC) {
    if (!Number.isFinite(tempC)) return '';
    const whole = Math.round(tempC);
    return `${whole > 0 ? '+' : ''}${whole} °C`;
  }

  /**
   * Icon and wording for a reading: the sky as a rule, but a plain sky with
   * real wind in it shows as wind, since that's the part you'd remark on.
   */
  function weatherLook(wx) {
    if (!wx) return { icon: '', words: '' };

    const windy = Number.isFinite(wx.wind) && wx.wind >= WINDY_MS;
    const gust = windy ? `wind ${Math.round(wx.wind)} m/s` : '';
    const plainSky = wx.code !== null && wx.code <= 3;

    if (windy && plainSky) return { icon: '💨', words: gust };

    const look = WEATHER_LOOKS.find(entry => entry.codes.includes(wx.code));
    if (!look) return { icon: '', words: gust };

    const icon = look.icon || (wx.isDay === false ? look.night : look.day);
    return { icon, words: [look.words, gust].filter(Boolean).join(', ') };
  }

  /** Cached reading for a locator, or null if it isn't known (yet). */
  function cachedWeather(grid) {
    const key = extractGrid(grid);
    if (!key) return null;
    const hit = weatherByGrid.get(key);
    if (!hit || Date.now() - hit.at > WEATHER_TTL) return null;
    return hit.wx;
  }

  /**
   * Makes sure the weather for a locator is on its way, and calls back
   * once — and only once — when a fresh reading arrives. Weather is a nicety:
   * a failure is logged and then forgotten, never shown as an error.
   */
  function requestWeather(grid, onReady) {
    const key = extractGrid(grid);
    if (!key || cachedWeather(key) !== null || weatherInFlight.has(key)) return;

    const point = gridToLatLon(key);
    if (!point) return;

    weatherInFlight.add(key);
    fetch('/api/weather', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: point.lat, lon: point.lon, accessKey: auth.accessKey || '' })
    })
      .then(res => res.json())
      .then(data => {
        if (!data || !Number.isFinite(Number(data.tempC))) {
          throw new Error((data && data.error) || 'no temperature');
        }
        weatherByGrid.set(key, {
          wx: {
            tempC: Number(data.tempC),
            code: Number.isFinite(Number(data.code)) ? Number(data.code) : null,
            wind: Number.isFinite(Number(data.wind)) ? Number(data.wind) : null,
            isDay: data.isDay === null || data.isDay === undefined ? null : Boolean(data.isDay),
            utcOffsetSeconds: Number.isFinite(Number(data.utcOffsetSeconds))
              ? Number(data.utcOffsetSeconds) : null
          },
          at: Date.now()
        });
        if (typeof onReady === 'function') onReady();
      })
      .catch(err => console.warn(`[weather] ${key}: ${err.message}`))
      .then(() => { weatherInFlight.delete(key); });
  }

  /** Weather at my own locator, shown beside the MY QTH LOCATOR label. */
  function updateMyWeather() {
    const grid = myGrid();
    const el = $('s-temp');

    if (!grid) {
      el.innerHTML = '';
      el.removeAttribute('title');
      return;
    }

    const wx = cachedWeather(grid);
    const look = weatherLook(wx);

    el.innerHTML = wx
      ? (look.icon ? `<span class="qso-wx-icon">${look.icon}</span>` : '') +
        escapeHtml(formatTempC(wx.tempC))
      : '';
    el.title = wx && look.words
      ? `${look.words} at your locator`
      : 'Current temperature at your locator';

    requestWeather(grid, updateMyWeather);
  }

  // ---------------------------------------------------------------------
  // Correspondent panel and duplicate detection
  // ---------------------------------------------------------------------

  function previousContacts(callsign) {
    const call = normalizeCallsign(callsign);
    if (!call) return [];
    return entries
      .filter(e => e.callsign === call && e.id !== editingId)
      .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
  }

  function describeQso(qso) {
    return [
      formatDateHuman(qso.date),
      qso.time,
      qso.freq || '',
      qso.band || '',
      qso.mode || '',
      [qso.rstSent, qso.rstRcvd].filter(Boolean).join('/')
    ].filter(Boolean).join(' · ');
  }

  /**
   * Whether this is a country you have never worked, a Russian district
   * (RDA) you have never had, or a country you have never worked on this
   * band — the thing you want to know while the contact is still on the air,
   * not afterwards. For an operator whose log is mostly Russia, the district
   * is the one that comes up: a new country is a once-a-month event, a new
   * RDA happens all the time, and it is the award most of them are chasing.
   * Counted from the log itself, by what was written down at the time. A log
   * with the same country spelled two ways (an import in another language)
   * can call one of them new; nothing here invents what the record doesn't name.
   */
  function firstTimeFor(country, band, rda) {
    const key = v => String(v || '').trim().toLowerCase();
    const c = key(country);
    const r = key(rda);
    if (!c && !r) return null;

    let worked = 0;
    let onBand = 0;
    let inRda = 0;
    for (const e of entries) {
      if (editingId && e.id === editingId) continue;   // the contact being edited isn't its own precedent
      if (r && key(e.rda) === r) inRda++;
      if (!c || key(e.country) !== c) continue;
      worked++;
      if (band && key(e.band) === key(band)) onBand++;
    }
    // The rarest true thing, in that order: a country you haven't had beats a
    // district you haven't had, which beats a band you haven't had it on.
    if (c && !worked) return { text: '★ NEW COUNTRY' };
    if (r && !inRda) return { text: `★ NEW RDA · ${String(rda).toUpperCase()}` };
    if (c && band && !onBand) return { text: `★ NEW BAND · ${band}` };
    return null;
  }

  function renderFirstBadge() {
    const badge = $('f-first');
    if (!badge) return;
    const call = normalizeCallsign($('f-callsign').value);
    const first = call ? firstTimeFor($('f-country').value, currentBand(), $('f-rda').value) : null;
    badge.hidden = !first;
    if (first) badge.textContent = first.text;
  }

  function renderCorrespondent(data) {
    const panel = $('f-corr');
    const call = normalizeCallsign($('f-callsign').value);

    if (!call) {
      panel.classList.remove('is-shown');
      panel.classList.add('is-empty');
      setDupeHighlight(currentDupeCall());
      return;
    }

    const prev = previousContacts(call);
    const badge = $('f-badge');

    if (prev.length) {
      badge.className = 'qso-badge is-worked';
      badge.textContent = prev.length === 1
        ? '● WORKED BEFORE'
        : `● WORKED BEFORE · ${prev.length} QSOs`;
      const worked = $('f-worked');
      worked.hidden = false;
      worked.textContent = `Last: ${describeQso(prev[0])}${myCallNote(prev[0])}`;
    } else {
      badge.className = 'qso-badge is-new';
      badge.textContent = '● NEW CONTACT';
      $('f-worked').hidden = true;
    }

    renderFirstBadge();

    const name = (data && data.name) || $('f-name').value.trim();
    const country = (data && data.country) || $('f-country').value.trim();
    const city = (data && data.city) || $('f-qth').value.trim();
    const grid = (data && data.grid) || $('f-grid').value.trim();

    $('f-corr-name').textContent = name || call;

    const where = [city, country].filter(Boolean).join(' · ') || '—';
    const km = distanceKm(myGrid(), grid);

    // How far away they are and what the weather is doing there, both worked
    // out from their locator. The reading arrives a moment later than the
    // rest of the panel, and redraws it once when it does.
    const wx = cachedWeather(grid);
    const look = weatherLook(wx);
    if (grid) requestWeather(grid, () => {
      if (extractGrid($('f-grid').value) === extractGrid(grid)) renderCorrespondent(null);
    });

    const approx = data ? Boolean(data.gridApprox) : corrGridApprox;

    $('f-corr-where').innerHTML = escapeHtml(where) +
      distanceBadge(km, approx) + weatherBadge(wx, look) + timeBadge(wx);

    // No GRID and no RDA here: both go into the log with the contact anyway,
    // and the card is for what's read on air — the locator only shows up as
    // the distance and weather beside the town (one that's only approximate
    // marks the distance "≈"). Where it was found is already said under the
    // callsign. What's left in this line is only ever a hint, when needed.
    const meta = [];

    // Distance and weather both need their locator. When one is missing, say
    // which — otherwise the figures just silently never appear.
    if (grid && km === null && !myGrid()) {
      meta.push('set MY QTH LOCATOR above for distance');
    }
    if (!grid && (data || lookupDoneCallsign === call)) {
      meta.push('no locator in the record — no distance or weather');
    }

    $('f-corr-meta').textContent = meta.join('   ');

    panel.classList.add('is-shown');
    panel.classList.remove('is-empty');
    setDupeHighlight(prev.length ? call : currentDupeCall());
  }

  /**
   * The hand-entry row inside the correspondent panel. Shown only for a
   * callsign both databases came back empty on — that is the moment the
   * operator has to write down what they're told on air, and reaching into
   * DETAILS & NOTES for it mid-QSO is exactly the wrong place to look.
   *
   * The three inputs are a front for the real fields below, which is what the
   * QSO is logged from: nothing about saving, editing or exporting changes.
   */
  function quickEntryShown() {
    const call = normalizeCallsign($('f-callsign').value);
    return Boolean(call) && notFoundCallsign === call;
  }

  function renderQuickEntry() {
    const shown = quickEntryShown();
    $('f-quick').hidden = !shown;
    if (!shown) return;

    // Whatever the real fields hold is what the row shows — so a callsign
    // re-entered by hand doesn't come back with empty boxes.
    if ($('f-q-name').value !== $('f-name').value) $('f-q-name').value = $('f-name').value;
    if ($('f-q-qth').value !== $('f-qth').value) $('f-q-qth').value = $('f-qth').value;
    if ($('f-q-rda').value !== $('f-rda').value) $('f-q-rda').value = $('f-rda').value;
  }

  function clearQuickEntry() {
    notFoundCallsign = '';
    $('f-q-name').value = '';
    $('f-q-qth').value = '';
    $('f-q-rda').value = '';
    $('f-quick').hidden = true;
  }

  /**
   * The log below the form: closed by default (it's for looking something
   * up, not for reading through after every contact). It opens two ways,
   * and closes accordingly:
   *
   * - by its own toggle — then it's the operator's, and stays open until
   *   they close it, so it never vanishes out from under someone mid-search;
   * - by itself, to show a worked-before callsign — then it goes again once
   *   there's no worked-before callsign left to show (cleared, changed, or
   *   that group station removed), rather than staying open on the whole log.
   *
   * Either way it collapses when the form resets for the next contact (see
   * prepareForNext): logging that QSO is the search being finished.
   */
  let logOpenedForDupe = false;

  function setLogPanelOpen(open) {
    $('qso-log-panel').hidden = !open;
    $('qso-log-toggle').classList.toggle('is-on', open);
    $('qso-log-toggle-label').textContent = open ? '▾ LOG' : '▸ LOG';
    logOpenedForDupe = false;   // setDupeHighlight marks it after, when it's the one opening
  }

  function setDupeHighlight(call) {
    if (dupeCallsign === call) return;
    dupeCallsign = call;
    // A different callsign is a different question, so the log narrows again
    // even if it had been opened up for the previous one.
    dupeFilterOff = false;
    if (call && $('qso-log-panel').hidden) {
      setLogPanelOpen(true);      // worked before — show it without asking
      logOpenedForDupe = true;
    } else if (!call && logOpenedForDupe) {
      setLogPanelOpen(false);     // opened only to show that — nothing left to show
    }
    render();
  }

  /**
   * The worked-before callsign the log should be showing, across every
   * callsign on the form: the main one first, then the group stations in
   * order. Used wherever one of them stops being worked-before, so the
   * highlight moves to another that still is instead of simply dropping.
   */
  function currentDupeCall() {
    const calls = [$('f-callsign').value]
      .concat([...$('f-group-list').querySelectorAll('.qso-group-call')].map(el => el.value))
      .map(normalizeCallsign);
    return calls.find(call => call && previousContacts(call).length) || '';
  }

  /** Whether the log is currently narrowed to the callsign being entered. */
  function dupeFilterActive() {
    return Boolean(dupeCallsign) && !dupeFilterOff;
  }

  // ---------------------------------------------------------------------
  // Lookup
  // ---------------------------------------------------------------------

  function setLookupStatus(text, kind) {
    const el = $('f-lookup-status');
    el.textContent = text || '';
    el.className = 'qso-lookup-status' + (kind ? ' ' + kind : '');
    // Outcomes (not "looking up…") go to the debug log, which reads this
    // page's console — see debug-log.js.
    if (text && kind !== 'pending') console.info(`[lookup] ${normalizeCallsign($('f-callsign').value)}: ${text}`);
  }

  /**
   * Wipes name/country/qth/grid/RDA the moment CALLSIGN stops matching the
   * callsign those fields were last filled in for — so switching to a new
   * callsign never goes on displaying (or logging) the previous one's
   * operator, especially when the new lookup then fails or finds nothing.
   */
  function clearStaleDetailFields() {
    const call = normalizeCallsign($('f-callsign').value);
    if (call === detailFieldsCallsign) return;

    $('f-name').value = '';
    $('f-country').value = '';
    $('f-grid').value = '';
    $('f-rda').value = '';
    $('f-qth').value = '';
    delete $('f-callsign').dataset.source;
    detailFieldsCallsign = call;
    lookupDoneCallsign = '';
    corrGridApprox = false;
    clearQuickEntry();
  }

  async function runLookup(force) {
    const callsign = normalizeCallsign($('f-callsign').value);
    if (!callsign) {
      setLookupStatus('');
      renderCorrespondent(null);
      return;
    }
    if (callsign === lastLookedUp && !force) return;
    lastLookedUp = callsign;
    clearStaleDetailFields();

    // Worked-before comes from the local logbook, so it shows with no network
    // and before any lookup completes.
    renderCorrespondent(null);

    if (auth.mode === 'none') {
      setLookupStatus('lookup off — tap ⚙ to sign in', 'err');
      return;
    }

    setLookupStatus('looking up…', 'pending');
    try {
      const res = await fetch('/api/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callsign, accessKey: auth.accessKey || '' })
      });
      const data = presentRecord(await res.json(), callsign);

      if (data.needsAuth) {
        setLookupStatus('sign in required', 'err');
        openOverlay('qso-signin');
        return;
      }
      if (data.error) {
        const notFound = data.errorCode === '404' || /not found/i.test(data.error);
        const base = notFound ? 'not found — type their details below' : data.error;
        // When the primary source failed, "not found" means "not found on the
        // fallback" — for a Russian callsign that is a completely different
        // statement, and without saying so the operator has no way to tell.
        setLookupStatus(data.primaryError ? `${base} · ${data.primaryError}` : base, 'err');
        if (data.primaryError) console.warn(`[lookup] ${data.primaryError}`);
        if (notFound) {
          notFoundCallsign = callsign;
          renderCorrespondent(null);   // the panel, with the row inside it
          renderQuickEntry();
        }
        return;
      }

      if (data.name) $('f-name').value = data.name;
      if (data.country) $('f-country').value = data.country;
      if (data.grid) $('f-grid').value = formatGrid(data.grid);
      if (data.city) $('f-qth').value = data.city;
      if (data.rda) $('f-rda').value = formatRda(data.rda);
      detailFieldsCallsign = callsign;
      corrGridApprox = Boolean(data.gridApprox);

      lookupDoneCallsign = callsign;
      clearQuickEntry();
      $('f-callsign').dataset.source = data.source || '';
      setLookupStatus(
        `✓ found [${data.source || 'qrz'}]` + (data.primaryError ? ` · ${data.primaryError}` : ''),
        data.primaryError ? 'err' : 'ok'
      );
      if (data.primaryError) console.warn(`[lookup] ${data.primaryError}`);
      renderCorrespondent(data);
    } catch (err) {
      setLookupStatus('lookup unavailable — type their details below', 'err');
      notFoundCallsign = callsign;
      renderCorrespondent(null);
      renderQuickEntry();
    }
  }

  function scheduleLookup() {
    clearTimeout(lookupTimer);
    lookupTimer = setTimeout(() => runLookup(false), 700);
  }

  // ---------------------------------------------------------------------
  // Group / pileup — extra stations answering alongside the main contact
  //
  // Each station is one line in the GROUP box under the main contact, with
  // everything the main panel has — phonetic spelling, live lookup as you
  // type, NEW / WORKED badge, where and how far, the hand-entry fields when
  // nobody has the station on file — just smaller, scoped to that row's own
  // elements instead of the page's #f-* ids, and with its own RST.
  // Submitting the form logs the main contact plus one QSO per filled-in
  // row — see readGroupQsos.
  // ---------------------------------------------------------------------

  /** Same lookup the main field uses, but silent — no shared state touched. */
  async function lookupCallsignQuick(callsign) {
    if (!callsign || auth.mode === 'none') return null;
    try {
      const res = await fetch('/api/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callsign, accessKey: auth.accessKey || '' })
      });
      const data = await res.json();
      return (data && !data.error && !data.needsAuth) ? presentRecord(data, callsign) : null;
    } catch (e) {
      return null;
    }
  }

  function clearGroupRows() {
    $('f-group-rows').innerHTML = '';
    $('f-group-list').hidden = true;
    renumberGroupRows();
  }

  /** Re-spells every group row — each by its own callsign, as always. */
  function refreshGroupPhonetics() {
    $('f-group-list').querySelectorAll('.qso-group-row').forEach(row => {
      if (row._els) row._els.phonetic.textContent = phoneticSpelling(row._els.call.value);
    });
  }

  /**
   * Keeps the group numbered top to bottom — the main station is 1, the rows
   * under it 2..n — and the count in the GROUP heading, which counts the
   * main station too. Rows can be inserted in the middle (Space in a row's
   * callsign) and removed from anywhere, so the numbers are assigned by
   * position rather than fixed when the row is created. Also switches the
   * contact block between one station (amber, MAIN STATION) and a group
   * (green), which is simply whether any row is left.
   */
  function renumberGroupRows() {
    const rows = $('f-group-rows').querySelectorAll('.qso-group-row');
    rows.forEach((row, i) => {
      if (row._els && row._els.num) row._els.num.textContent = String(i + 2);
    });
    $('f-group-count').textContent = `${rows.length + 1} STATIONS`;
    $('f-contact').classList.toggle('is-group', rows.length > 0);
    updateSubmitLabel();
  }

  /**
   * LOG QSO — or, with a group, how many contacts pressing it will write:
   * the main station and every row with a callsign in it (an empty row
   * logs nothing). Editing a saved contact says SAVE CHANGES, as ever.
   */
  function updateSubmitLabel() {
    if (editingId) { $('f-submit').textContent = 'SAVE CHANGES'; return; }
    const filled = [...$('f-group-rows').querySelectorAll('.qso-group-call')]
      .filter(input => input.value.trim()).length;
    $('f-submit').textContent = filled ? `LOG ${filled + 1} QSO` : 'LOG QSO';
  }

  /**
   * Takes a station out of the pileup — its ✕, or Esc while typing in it.
   * If it was the worked-before one the log was showing, the highlight moves
   * to another that still is, or the log closes. With moveFocus (Esc), the
   * cursor steps back to the callsign above, so the keyboard never loses its
   * place.
   */
  function removeGroupRow(row, moveFocus) {
    const above = row.previousElementSibling;
    row.remove();
    if (!$('f-group-rows').children.length) $('f-group-list').hidden = true;
    renumberGroupRows();
    setDupeHighlight(currentDupeCall());
    if (moveFocus) {
      (above ? above.querySelector('.qso-group-call') : $('f-callsign')).focus();
    }
  }

  /**
   * The who-and-where part of one group row: name and badge on the
   * first line, town, distance, weather and local time on the second. Works
   * off the element references cached on the row when it was built
   * (row._els) rather than looking them up by class each time: the badge's
   * own class list is rewritten here to switch between is-new and
   * is-worked, so re-finding it by class afterwards is exactly the kind of
   * thing that breaks silently.
   */
  function renderGroupCorrespondent(row, data) {
    const els = row._els;
    // A lookup or weather reading can land after the station was removed
    // (Esc, or its ✕) — it must not bring the removed callsign's highlight back.
    if (!els || !row.isConnected) return;

    const call = normalizeCallsign(els.call.value);

    if (!call) {
      els.corr.classList.remove('is-shown');
      els.corr.classList.add('is-empty');
      setDupeHighlight(currentDupeCall());
      return;
    }

    const prev = previousContacts(call);

    if (prev.length) {
      els.badge.className = 'qso-badge qso-group-badge is-worked';
      els.badge.textContent = prev.length === 1 ? '● WORKED BEFORE' : `● WORKED ×${prev.length}`;
      // No room in the line for "Last: …" — it's the badge's tooltip, and a
      // click on the badge opens the whole list, as "Last: …" does above.
      els.badge.title = `Last: ${describeQso(prev[0])}${myCallNote(prev[0])} — click for all`;
      els.badge.dataset.history = call;
      // A pileup station worked before is exactly as much a dupe as the main
      // one — the log opens and narrows to it the same way either gives it.
      setDupeHighlight(call);
    } else {
      els.badge.className = 'qso-badge qso-group-badge is-new';
      els.badge.textContent = '● NEW';
      els.badge.title = '';
      delete els.badge.dataset.history;
      setDupeHighlight(currentDupeCall());
    }

    // Everything the panel shows is kept on the row as well as read from the
    // lookup result, so a redraw without that result — which is what a
    // weather reading arriving causes — shows the same thing, not less.
    // Details typed by hand for a station no database has count the same as
    // looked-up ones — the panel shows them as they are typed.
    // (The RDA isn't shown — it's written into the contact, not read out.)
    const typedName = els.qName ? els.qName.value.trim() : '';
    const typedCity = els.qQth ? els.qQth.value.trim() : '';

    const name = (data && data.name) || row.dataset.name || typedName;
    const country = (data && data.country) || row.dataset.country || '';
    const city = (data && data.city) || row.dataset.city || typedCity;
    const grid = (data && data.grid) || row.dataset.grid || '';
    const source = (data && data.source) || row.dataset.source || '';
    const approx = data ? Boolean(data.gridApprox) : row.dataset.gridApprox === '1';

    // While the lookup is out (or found nothing), the status stands where
    // the name will be — the callsign itself is right there in its field.
    els.name.textContent = name;

    // Distance and weather, exactly as the main panel does it: both from the
    // station's locator, the reading fetched once and redrawn when it lands.
    const km = distanceKm(myGrid(), grid);
    const wx = cachedWeather(grid);
    const look = weatherLook(wx);
    if (grid) requestWeather(grid, () => {
      if (extractGrid(row.dataset.grid || '') === extractGrid(grid)) {
        renderGroupCorrespondent(row, null);
      }
    });

    // Typed by hand, the details are in the fields right there: the line
    // under them would only repeat them.
    const where = els.quick.hidden ? [city, country].filter(Boolean).join(' · ') : '';
    const extras = els.quick.hidden ? distanceBadge(km, approx) + weatherBadge(wx, look) + timeBadge(wx) : '';
    els.where.innerHTML = where || extras ? escapeHtml(where) + extras : '';
    els.where.title = grid && km === null && !myGrid() ? 'set MY QTH LOCATOR above for distance'
      : (!grid && source ? 'no locator in the record — no distance or weather' : '');

    els.corr.classList.add('is-shown');
    els.corr.classList.remove('is-empty');
  }

  /**
   * Adds one more station to the pileup. `afterRow`, when given, puts the new
   * row directly below that one — that's what the 👥 button on each row does,
   * so working down a pileup never means reaching back up to the top.
   */
  function addGroupRow(focus, afterRow) {
    const id = `g${++groupSeq}`;
    const rstSent = escapeHtml($('f-rst-sent').value || '59');
    const rstRcvd = escapeHtml($('f-rst-rcvd').value || '59');

    const wrap = document.createElement('div');
    wrap.className = 'qso-group-row';
    wrap.dataset.rowId = id;
    wrap.innerHTML = `
      <b class="qso-group-num">?</b>

      <div class="qso-group-callcell">
        <div class="qso-group-callrow">
          <span class="qso-clear-wrap">
            <input class="qso-group-call" autocapitalize="characters" autocorrect="off"
                   spellcheck="false" autocomplete="off" placeholder=" " aria-label="Callsign">
            <button type="button" class="qso-inline-clear qso-group-clear" tabindex="-1"
                    title="Clear this callsign">✕</button>
          </span>
          <span class="qso-suffix-wrap">
            <button type="button" class="qso-mini-btn qso-portable-btn qso-group-portable"
                    tabindex="-1" title="Add or remove /P — portable">/P</button>
          </span>
        </div>
        <div class="qso-phonetic qso-group-phonetic"></div>
      </div>

      <div class="qso-group-info qso-group-corr is-empty">
        <div class="qso-group-hint">Enter a callsign · Space: next station · Esc: remove</div>
        <div class="qso-group-line1">
          <span class="qso-group-corr-name"></span>
          <span class="qso-badge qso-group-badge"></span>
          <span class="qso-lookup-status qso-group-lookup-status"></span>
        </div>
        <div class="qso-group-corr-where"></div>
        <div class="qso-quick qso-group-quick" hidden>
          <div class="qso-quick-row">
            <label class="qso-quick-field">
              <input class="qso-group-q-name" autocomplete="off" placeholder="name" aria-label="Operator">
            </label>
            <label class="qso-quick-field">
              <input class="qso-group-q-qth" autocomplete="off" placeholder="city / location" aria-label="QTH">
            </label>
            <label class="qso-quick-field qso-quick-rda">
              <input class="qso-group-q-rda" autocomplete="off" autocapitalize="characters"
                     spellcheck="false" placeholder="RDA" maxlength="5" aria-label="RDA">
            </label>
          </div>
        </div>
      </div>

      <div class="qso-group-rsts">
        <input class="qso-group-rst" data-role="sent" value="${rstSent}" title="RST sent">
        <input class="qso-group-rst" data-role="rcvd" value="${rstRcvd}" title="RST rcvd">
      </div>

      <button type="button" class="qso-mini-btn qso-group-remove"
              title="Remove this station (or Esc in its callsign)">✕</button>
    `;

    $('f-group-list').hidden = false;
    if (afterRow && afterRow.parentNode === $('f-group-rows')) {
      afterRow.insertAdjacentElement('afterend', wrap);
    } else {
      $('f-group-rows').appendChild(wrap);
    }

    // Found once, here, and kept: renderGroupCorrespondent rewrites the
    // badge's class list, so nothing below may depend on finding these by
    // class again later.
    wrap._els = {
      call: wrap.querySelector('.qso-group-call'),
      num: wrap.querySelector('.qso-group-num'),
      phonetic: wrap.querySelector('.qso-group-phonetic'),
      status: wrap.querySelector('.qso-group-lookup-status'),
      corr: wrap.querySelector('.qso-group-corr'),
      badge: wrap.querySelector('.qso-group-badge'),
      name: wrap.querySelector('.qso-group-corr-name'),
      where: wrap.querySelector('.qso-group-corr-where'),
      quick: wrap.querySelector('.qso-group-quick'),
      qName: wrap.querySelector('.qso-group-q-name'),
      qQth: wrap.querySelector('.qso-group-q-qth'),
      qRda: wrap.querySelector('.qso-group-q-rda')
    };

    wrap._els.badge.addEventListener('click', () => {
      if (wrap._els.badge.dataset.history) showHistory(wrap._els.badge.dataset.history);
    });

    renumberGroupRows();

    // Tab inside a group row stays inside it: its callsign → (operator and
    // QTH, when neither database has the station) → its reports, and no
    // further. Recomputed on each keypress, because the hand-entry fields
    // come and go with the lookup result.
    const reports = Array.from(wrap.querySelectorAll('.qso-group-rst'));
    const rowTabChain = () => {
      const chain = [wrap._els.call];
      if (!wrap._els.quick.hidden) chain.push(wrap._els.qName, wrap._els.qQth);
      return chain.concat(reports);
    };
    [wrap._els.call, wrap._els.qName, wrap._els.qQth, ...reports].forEach(field => {
      field.addEventListener('keydown', ev => chainTab(ev, rowTabChain()));
    });
    reports.forEach(field => {
      attachReportInput(field);
      field.addEventListener('keydown', ev => addGroupFromReport(ev, wrap._els.call, wrap));
    });

    attachLatinInput(wrap._els.qRda, 'rda');
    [wrap._els.qName, wrap._els.qQth].forEach(field => {
      attachLiveFormat(field, formatTypedDetail);
    });
    [wrap._els.qName, wrap._els.qQth, wrap._els.qRda].forEach(field => {
      field.addEventListener('input', () => renderGroupCorrespondent(wrap, null));
    });

    const callInput = wrap._els.call;
    const status = wrap._els.status;
    let lookedUp = '';
    let foundRecord = false;
    let lookupTimerLocal = null;
    attachLatinInput(callInput, 'callsign');

    const updatePhoneticLocal = () => {
      wrap._els.phonetic.textContent = phoneticSpelling(callInput.value);
    };

    // Asked for when the alphabet mode changes: a row showing a looked-up
    // record reads it again under the new mode, a row filled in by hand is
    // left alone.
    wrap._refresh = () => { if (foundRecord) doLookup(true); };

    const doLookup = async (force) => {
      const call = normalizeCallsign(callInput.value);
      if (call === lookedUp && !force) return;
      lookedUp = call;

      delete wrap.dataset.name;
      delete wrap.dataset.country;
      delete wrap.dataset.grid;
      delete wrap.dataset.rda;
      delete wrap.dataset.city;
      delete wrap.dataset.source;
      delete wrap.dataset.gridApprox;
      // Details typed for the previous callsign must not ride along to this
      // one — the row starts blank and hidden again.
      foundRecord = false;
      wrap._els.quick.hidden = true;
      wrap._els.qName.value = '';
      wrap._els.qQth.value = '';
      wrap._els.qRda.value = '';

      if (!call) {
        status.textContent = '';
        status.className = 'qso-lookup-status';
        renderGroupCorrespondent(wrap, null);
        return;
      }

      renderGroupCorrespondent(wrap, null);   // worked-before badge, no network needed

      if (auth.mode === 'none') {
        status.textContent = 'lookup off — tap ⚙ to sign in';
        status.className = 'qso-lookup-status err';
        return;
      }

      status.textContent = 'looking up…';
      status.className = 'qso-lookup-status pending';

      const data = await lookupCallsignQuick(call);
      // The operator may have kept typing while this was in flight.
      if (normalizeCallsign(callInput.value) !== call) return;

      if (data) {
        status.textContent = '';   // the name now stands where "looking up…" was
        status.className = 'qso-lookup-status';
        wrap.dataset.name = data.name || '';
        wrap.dataset.country = data.country || '';
        wrap.dataset.grid = data.grid ? formatGrid(data.grid) : '';
        wrap.dataset.rda = data.rda ? formatRda(data.rda) : '';
        wrap.dataset.city = data.city || '';
        wrap.dataset.source = data.source || '';
        wrap.dataset.gridApprox = data.gridApprox ? '1' : '';
        console.info(`[lookup] group ${call}: found [${data.source || 'qrz'}]`);
        wrap._els.quick.hidden = true;
        foundRecord = true;
        renderGroupCorrespondent(wrap, data);
      } else {
        status.textContent = 'not found — type what you hear:';
        console.info(`[lookup] group ${call}: not found`);
        status.className = 'qso-lookup-status err';
        // Nobody has this station on file: its details get typed here, in the
        // same place the looked-up ones would have appeared.
        wrap._els.quick.hidden = false;
        renderGroupCorrespondent(wrap, null);
      }
    };

    callInput.addEventListener('input', () => {
      // The lookup is scheduled first on purpose: whatever else happens while
      // redrawing the panel, typing a callsign must always end in a lookup —
      // exactly as it does for the main CALLSIGN field.
      clearTimeout(lookupTimerLocal);
      lookupTimerLocal = setTimeout(() => doLookup(false), 700);
      updatePhoneticLocal();
      refreshPortableButtons();
      renderGroupCorrespondent(wrap, null);
      updateSubmitLabel();
    });
    callInput.addEventListener('blur', () => doLookup(false));
    callInput.addEventListener('keydown', ev => {
      // Enter means the same thing here as anywhere else: the contact is
      // finished — log it, group and all. Another station is added by Space
      // (or 👥 ADD STATION), never by Enter.
      if (ev.key === 'Enter') {
        ev.preventDefault();
        clearTimeout(lookupTimerLocal);
        logNow();
        return;
      }
      // Space adds the next station straight under this one, so a pileup is
      // worked call-space-call without leaving the keyboard.
      addGroupFromCallsign(ev, callInput, wrap);
    });

    wireSuffixButton(wrap.querySelector('.qso-group-portable'), callInput);

    // The looked-up record goes with the callsign: doLookup on an empty
    // field is what wipes the row's stored details and status, so it runs
    // straight away rather than after the typing delay.
    wrap.querySelector('.qso-group-clear').addEventListener('click', () => {
      callInput.value = '';
      callInput.dispatchEvent(new Event('input', { bubbles: true }));
      clearTimeout(lookupTimerLocal);
      doLookup(false);
      callInput.focus();
    });

    wrap.querySelector('.qso-group-remove').addEventListener('click', () => removeGroupRow(wrap, false));

    if (focus) callInput.focus();
  }

  // ---------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------

  function setNow() {
    const p = nowUtcParts();
    setDateValue($('f-date'), p.date);
    setTimeValue($('f-time'), p.time);
    setTimeAuto(true);
  }

  /**
   * The clock stops the moment DATE or TIME is typed into — otherwise it would
   * overwrite the override a second later. That silence is how a log ends up
   * with a run of contacts all stamped the same minute, so the state is shown:
   * the label says the time is set by hand and NOW lights up as the way back.
   */
  function setTimeAuto(on) {
    timeAutoUpdating = Boolean(on);
    $('f-time-manual').hidden = timeAutoUpdating;
    $('f-now').classList.toggle('needs-now', !timeAutoUpdating);
  }

  /**
   * Keeps DATE/TIME showing the real current time between contacts, instead
   * of freezing at whenever the form was last reset. Runs once a second;
   * does nothing while a hand-typed time is in effect, or while either field
   * has focus (so it never fights an edit in progress).
   */
  function tickClock() {
    if (!timeAutoUpdating || editingId) return;
    if (document.activeElement === $('f-date') || document.activeElement === $('f-time')) return;
    setNow();
  }

  /**
   * The ✕ beside CALLSIGN: wipes the callsign and everything a lookup filled
   * in for it, and puts DATE/TIME back on the clock — abandoning a contact
   * half-entered is exactly when a stale timestamp would otherwise be logged.
   * Group rows, band, frequency and reports are left alone.
   */
  function clearCallsignField() {
    $('f-callsign').value = '';
    $('f-name').value = '';
    $('f-country').value = '';
    $('f-grid').value = '';
    $('f-rda').value = '';
    $('f-qth').value = '';
    delete $('f-callsign').dataset.source;

    lastLookedUp = '';
    detailFieldsCallsign = '';
    lookupDoneCallsign = '';
    corrGridApprox = false;
    clearQuickEntry();

    setLookupStatus('');
    updatePhonetic();
    renderCorrespondent(null);   // hides the panel and un-narrows the log
    setNow();                    // the clock runs again, showing the real time
    updateSubmitState();
    $('f-callsign').focus();
  }

  /**
   * Puts /P on a callsign, or takes it off again — the suffix that comes up
   * most on air, on the one key that moves around between layouts. Written
   * through an 'input' event rather than by hand so everything that watches
   * the field (lookup, phonetics, the correspondent panel, the station bar)
   * reacts exactly as it would to typing.
   */
  // The suffixes the button can put on a callsign, /P first. Everyday
  // working is /P, so that stays what the button does at a press; the rest
  // come up rarely enough to live in a list that only appears when the
  // pointer rests on the button. Each one is explained in both languages —
  // /MM and /AM are not obvious even to an operator who knows /P.
  const SUFFIX_CHOICES = [
    ['P', 'portable', 'в поле'],
    ['QRP', 'low power', 'малая мощность'],
    ['M', 'mobile', 'из машины'],
    ['MM', 'maritime mobile', 'с судна'],
    ['AM', 'aeronautical mobile', 'с борта самолёта']
  ];

  /** 'QRP' for R2FEL/QRP — the operating suffix this callsign is wearing, if any. */
  function callSuffix(raw) {
    const parts = String(raw || '').trim().split('/');
    const last = (parts[parts.length - 1] || '').toUpperCase();
    return parts.length > 1 && OPERATING_SUFFIXES.has(last) ? last : '';
  }

  /**
   * Puts `sfx` on the callsign — or takes it off, if that is the suffix
   * already there. A different suffix is replaced rather than stacked:
   * R2FEL/P with /QRP chosen becomes R2FEL/QRP, not R2FEL/P/QRP.
   */
  function togglePortable(input, sfx) {
    const raw = input.value.trim();
    const suffix = sfx || 'P';
    if (raw) {
      const now = callSuffix(raw);
      const bare = now ? raw.slice(0, raw.length - now.length - 1) : raw;
      input.value = now === suffix ? bare : `${bare}/${suffix}`;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    input.focus();
  }

  /**
   * Every /P button says which suffix it will put on, and lights up when the
   * callsign beside it is already wearing that one. Typing a suffix by hand
   * moves the button to it, so the button and the callsign never disagree.
   */
  function refreshSuffixButton(input, btn) {
    const now = callSuffix(input.value);
    if (now) btn.dataset.suffix = now;
    const sfx = btn.dataset.suffix || 'P';
    const said = SUFFIX_CHOICES.find(c => c[0] === sfx);
    btn.textContent = `/${sfx}`;
    btn.title = tr(`Add or remove /${sfx} — ${said ? said[1] : 'portable'}`,
      `Поставить или убрать /${sfx} — ${said ? said[2] : 'в поле'}`);
    btn.classList.toggle('is-on', now === sfx);
  }

  /** Lights every /P button whose callsign is carrying its suffix. */
  function refreshPortableButtons() {
    [['f-callsign', 'f-portable'], ['s-callsign', 's-portable']].forEach(([field, btn]) => {
      refreshSuffixButton($(field), $(btn));
    });
    $('f-group-list').querySelectorAll('.qso-group-row').forEach(row => {
      const call = row.querySelector('.qso-group-call');
      const btn = row.querySelector('.qso-group-portable');
      if (call && btn) refreshSuffixButton(call, btn);
    });
  }

  /**
   * The /P button and the list of the other suffixes under it. A press is
   * what it always was — the suffix on the button goes on the callsign, a
   * second press takes it off. Resting the pointer on the button for a
   * moment drops the list down; picking from it puts that suffix on and
   * leaves the button set to it, so the next station gets it at one press.
   */
  function wireSuffixButton(btn, input) {
    const wrap = btn.parentElement;
    const menu = document.createElement('div');
    menu.className = 'qso-suffix-menu';
    menu.hidden = true;
    wrap.appendChild(menu);

    let openTimer = null;
    let shutTimer = null;

    function open() {
      const now = callSuffix(input.value);
      // Built each time it opens, so it is in the language of the moment.
      menu.innerHTML = SUFFIX_CHOICES.map(([sfx, en, ru]) =>
        `<button type="button" tabindex="-1" data-suffix="${sfx}"` +
        `${sfx === now ? ' class="is-current"' : ''}>` +
        `<b>/${sfx}</b><i>${escapeHtml(tr(en, ru))}</i></button>`).join('');
      menu.hidden = false;
      // A group row low in the window has no room underneath it: there the
      // list unrolls upwards instead of off the bottom of the screen.
      menu.classList.remove('is-up');
      if (menu.getBoundingClientRect().bottom > window.innerHeight - 8) menu.classList.add('is-up');
    }

    function shut(atOnce) {
      clearTimeout(openTimer);
      openTimer = null;
      clearTimeout(shutTimer);
      // A short wait, so the list doesn't vanish while the pointer is on its
      // way from the button down onto it.
      if (atOnce) menu.hidden = true;
      else shutTimer = setTimeout(() => { menu.hidden = true; }, 220);
    }

    // Waiting for the pointer to *move* on the button, not merely to find
    // itself over it: pressing 👥 rearranges the row under a pointer that
    // never moved, and a list unrolling by itself after that looks broken.
    wrap.addEventListener('mousemove', () => {
      clearTimeout(shutTimer);
      if (!menu.hidden || openTimer) return;
      openTimer = setTimeout(() => { openTimer = null; open(); }, 350);
    });
    wrap.addEventListener('mouseleave', () => shut(false));

    btn.addEventListener('click', () => {
      shut(true);
      togglePortable(input, btn.dataset.suffix || 'P');
    });

    menu.addEventListener('click', ev => {
      const pick = ev.target.closest('button');
      if (!pick) return;
      btn.dataset.suffix = pick.dataset.suffix;
      shut(true);
      togglePortable(input, pick.dataset.suffix);
    });
  }

  function closeSuffixMenus() {
    document.querySelectorAll('.qso-suffix-menu').forEach(el => { el.hidden = true; });
  }

  /**
   * Space in a callsign field means "and the next one" — a pileup is worked
   * by calling one station after another, and reaching for 👥 between each
   * takes a hand off the keyboard. A space is never part of a callsign, so
   * the key is free to mean this. Nothing happens on an empty field (no
   * blank row to log), or in contest mode, where stations are worked one at
   * a time and group logging is off.
   */
  function addGroupFromCallsign(ev, input, afterRow) {
    if (ev.key !== ' ') return;
    ev.preventDefault();
    // Only from a station that has a callsign — main or group alike.
    if (!input.value.trim()) return;
    addGroupStation(afterRow);
  }

  /**
   * One more station for the pileup — from Space, 👥 or ADD STATION — but
   * never an empty one beside another: there has to be a main callsign, and
   * if a group station is still waiting for its callsign, that's where the
   * cursor goes instead. (An empty station would be skipped when logging
   * anyway; this keeps them from piling up on the screen at all.)
   */
  function addGroupStation(afterRow) {
    if (station.contest) return;
    if (!$('f-callsign').value.trim()) { $('f-callsign').focus(); return; }
    const waiting = [...$('f-group-rows').querySelectorAll('.qso-group-row')]
      .find(row => row._els && !row._els.call.value.trim());
    if (waiting) { waiting._els.call.focus(); return; }
    addGroupRow(true, afterRow);
  }

  /*
   * The same from a station's report fields: callsign, Tab, the report — and
   * Space for the next one, without going back up to the callsign first. A
   * report never holds a space, so the key is just as free there. `input`
   * is the callsign the reports belong to (see above for when it matters).
   */
  function addGroupFromReport(ev, callInput, afterRow) {
    addGroupFromCallsign(ev, callInput, afterRow);
  }

  /*
   * Reports are digits only, and as many as the mode's report has: RS, two
   * (59), for voice; RST, three (599), for CW. Anything else typed or pasted
   * is dropped as it arrives, and switching the mode trims what's there.
   */
  function rstLength() {
    return currentMode() === 'CW' ? 3 : 2;
  }

  function reportFields() {
    return [$('f-rst-sent'), $('f-rst-rcvd'), ...document.querySelectorAll('#f-group-rows .qso-group-rst')];
  }

  function fitReport(el) {
    // Not the field's own maxlength: that cuts a paste off before the
    // letters are taken out of it ("5a7x9" would give "5", not "57").
    el.inputMode = 'numeric';
    const digits = el.value.replace(/\D/g, '').slice(0, rstLength());
    if (digits !== el.value) el.value = digits;
  }

  function attachReportInput(el) {
    fitReport(el);
    el.addEventListener('input', () => fitReport(el));
  }

  /**
   * Tab runs through the fields of the contact in hand and stops at the end
   * of it: callsign → report sent → report received (in contest mode the
   * serial received comes first, keeping the callsign → Tab → number rhythm).
   * Past that, Tab does nothing rather than wandering off into the date,
   * details and buttons — on air the hands must be able to Tab without
   * looking. Shift+Tab walks the same chain backwards.
   */
  function chainTab(ev, chain) {
    if (ev.key !== 'Tab') return;

    const index = chain.indexOf(ev.target);
    if (index === -1) return;

    ev.preventDefault();
    const next = ev.shiftKey ? chain[index - 1] : chain[index + 1];
    if (!next) return;   // both ends are dead stops: focus stays where it is

    next.focus();
    // Reports arrive pre-filled with 59, so arriving selected means the
    // operator can just type the real one over it.
    if (typeof next.select === 'function' && next !== $('f-callsign')) next.select();
  }

  /** The main contact's chain, which depends on whether contest mode is on. */
  function mainTabChain() {
    const chain = [$('f-callsign')];
    if (station.contest) chain.push($('f-nr-rcvd'));
    // A station nobody has on file: callsign → operator → QTH → reports.
    if (quickEntryShown()) chain.push($('f-q-name'), $('f-q-qth'));
    chain.push($('f-rst-sent'), $('f-rst-rcvd'));
    return chain;
  }

  function updateSubmitState() {
    $('f-submit').disabled = !$('f-callsign').value.trim();
  }

  // Whether QRZ.RU/QRZ.com are actually configured — kept up to date whenever
  // /api/qrz-status is fetched, so the subtitle and the DATA button can say
  // plainly when there's nothing to look callsigns up against yet, instead of
  // that being discoverable only by opening DATA.
  let qrzConfigured = { ru: false, com: false, ham: false };

  function applyQrzStatus(status) {
    qrzConfigured = {
      ru: Boolean(status && status.ruConfigured),
      com: Boolean(status && status.comConfigured),
      ham: Boolean(status && status.hamConfigured)
    };
    updateSubtitle();
    updateDataAlert();
  }

  function updateSubtitle() {
    const el = $('qso-subtitle');

    if (auth.mode !== 'key') {
      el.textContent = 'contact record · times in UTC · lookup off';
      el.classList.remove('needs-qrz');
      return;
    }

    const active = qrzConfigured.ru || qrzConfigured.com || qrzConfigured.ham;
    el.textContent = active
      ? 'contact record · times in UTC · lookup enabled'
      : 'contact record · times in UTC · lookup off — tap here to add QRZ login';
    el.classList.toggle('needs-qrz', !active);
  }

  function readForm() {
    const freq = applyFrequency(true);
    const nowIso = new Date().toISOString();

    return {
      id: editingId || String(Date.now()),

      myCallsign: normalizeCallsign($('s-callsign').value),
      myRda: formatRda($('s-rda').value),
      myQth: formatGrid($('s-qth').value),   // now holds a locator, not free text

      callsign: normalizeCallsign($('f-callsign').value),
      name: $('f-name').value.trim(),
      country: $('f-country').value.trim(),
      grid: formatGrid($('f-grid').value),
      rda: formatRda($('f-rda').value),
      qth: $('f-qth').value.trim(),

      band: currentBand(),
      freq: freq ? formatFrequency(freq.hz) : '',
      freqHz: freq ? freq.hz : null,
      mode: currentMode(),

      // A date or time typed by hand that isn't one (31.02, 25:70) would log
      // a contact no other program can read — the clock's is used instead.
      date: dateValue($('f-date')) || nowUtcParts().date,
      time: timeValue($('f-time')) || nowUtcParts().time,

      rstSent: $('f-rst-sent').value.trim(),
      rstRcvd: $('f-rst-rcvd').value.trim(),

      // Contest serials. Read from the fields rather than from the mode flag,
      // so an old contest contact opened for editing keeps its numbers even
      // if contest mode happens to be switched off at the time.
      nrSent: $('f-nr-sent').value.trim(),
      nrRcvd: $('f-nr-rcvd').value.trim(),

      notes: $('f-notes').value.trim(),
      source: $('f-callsign').dataset.source || '',
      createdAt: nowIso,
      updatedAt: nowIso
    };
  }

  function fillForm(qso) {
    $('f-callsign').value = qso.callsign || '';
    $('f-name').value = qso.name || '';
    $('f-country').value = qso.country || '';
    $('f-grid').value = formatGrid(qso.grid || '');
    $('f-rda').value = formatRda(qso.rda || '');
    $('f-qth').value = qso.qth || '';
    $('f-freq').value = qso.freq || '';
    setMode(qso.mode || 'SSB', false);
    setBand(qso.band || '', false);
    setDateValue($('f-date'), qso.date || '');
    setTimeValue($('f-time'), qso.time || '');
    setTimeAuto(false);   // editing a logged QSO — its time is fixed, not the clock
    $('f-rst-sent').value = qso.rstSent || '';
    $('f-rst-rcvd').value = qso.rstRcvd || '';
    $('f-notes').value = qso.notes || '';
    $('f-callsign').dataset.source = qso.source || '';

    // A contact with serials is contest work: show the serial fields (turning
    // the mode on if it was off) so its numbers are visible and editable.
    $('f-nr-sent').value = qso.nrSent || '';
    $('f-nr-rcvd').value = qso.nrRcvd || '';
    if ((qso.nrSent || qso.nrRcvd) && !station.contest) setContestMode(true, true);

    applyFrequency(true, false);   // reformat the field, but don't let an old entry change the session's default band
    updateSubmitState();
    updatePhonetic();
    detailFieldsCallsign = normalizeCallsign(qso.callsign);
    corrGridApprox = false;
  }

  /**
   * Clears only the contact just logged; frequency, mode and RST stay put,
   * and so does the sent serial (advanceSerial has already moved it on) —
   * only the number they gave you is cleared, ready for the next one.
   */
  function prepareForNext() {
    $('f-callsign').value = '';
    $('f-name').value = '';
    $('f-country').value = '';
    $('f-grid').value = '';
    $('f-rda').value = '';
    $('f-qth').value = '';
    $('f-notes').value = '';
    $('f-nr-rcvd').value = '';
    delete $('f-callsign').dataset.source;

    lastLookedUp = '';
    detailFieldsCallsign = '';
    lookupDoneCallsign = '';
    corrGridApprox = false;
    clearQuickEntry();
    applyModeDefaults();   // refills either report if it was left blank
    updatePhonetic();
    setLookupStatus('');
    $('f-corr').classList.remove('is-shown');
    $('f-corr').classList.add('is-empty');
    setDupeHighlight('');
    setLogPanelOpen(false);
    setNow();
    updateSubmitState();
    $('f-callsign').focus();
  }

  function enterEditMode(id) {
    const qso = entries.find(e => e.id === id);
    if (!qso) return;

    editingId = id;
    fillForm(qso);

    // Group rows are left alone here, and the 👥 button stays where it is:
    // opening an old contact must never take the button away (that used to
    // leave it hidden until "cancel" was pressed, which read as the button
    // simply vanishing). Anything typed into the group rows is logged as new
    // contacts when the edit is saved — see submitForm.

    // The station bar reflects the callsign this contact was made under.
    if (qso.myCallsign) $('s-callsign').value = qso.myCallsign;
    if (qso.myRda) $('s-rda').value = qso.myRda;
    if (qso.myQth) $('s-qth').value = formatGrid(qso.myQth);
    updateMyPhonetic();
    lockStationFields();

    $('f-edit-note').classList.add('is-shown');
    $('f-cancel-edit').hidden = false;
    updateSubmitLabel();

    lastLookedUp = normalizeCallsign(qso.callsign);
    renderCorrespondent(null);
    render();

    $('qso-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function exitEditMode() {
    editingId = null;
    // The station bar goes back to the station you are actually working —
    // see readStationFields for why this matters.
    fillStationFields();
    $('f-edit-note').classList.remove('is-shown');
    $('f-cancel-edit').hidden = true;
    updateSubmitLabel();
    prepareForNext();
    render();
  }

  function flashSaved(text, kind) {
    const el = $('f-saved');
    el.textContent = text;
    el.classList.toggle('is-warn', kind === 'warn');
    el.classList.toggle('is-quiet', kind === 'quiet');
    el.classList.add('is-shown');
    clearTimeout(flashTimer);
    // A quiet line is longer on screen than a green "logged": nobody is
    // waiting for it, so it needs the time to be noticed and read.
    const ms = kind === 'warn' ? 3200 : kind === 'quiet' ? 5000 : 1600;
    flashTimer = setTimeout(() => el.classList.remove('is-shown'), ms);
  }
  let flashTimer = null;

  /**
   * What has to be there before a contact can go in the log. Pressing LOG QSO
   * used to write it down regardless: with MY CALLSIGN empty the contact was
   * saved as nobody's (the grey "?" in the log, and it can never be sent to
   * LoTW, eQSL or HAMLOG), and with no band it was saved as a contact on no
   * band at all — which reads in the log as if nothing had been logged.
   * Neither is ever what the operator meant, so now the form says so and puts
   * the cursor in the field that is missing.
   */
  function missingForLog() {
    if (!normalizeCallsign($('f-callsign').value)) {
      return { el: $('f-callsign'),
               says: tr('Type the callsign you worked', 'Впишите позывной корреспондента') };
    }
    if (!currentMyCall()) {
      return { el: $('s-callsign'),
               says: tr('Your own callsign first — it goes on every contact',
                        'Сначала ваш позывной — он записывается в каждую связь') };
    }
    if (!currentBand()) {
      return { el: $('f-band-btn'), menu: 'f-band-menu',
               says: tr('Pick the band', 'Выберите диапазон') };
    }
    return null;
  }

  /** Says what is missing, goes to that field, and marks it for a moment. */
  function pointAtMissing(miss) {
    flashSaved('✗ ' + miss.says, 'warn');
    const el = miss.el;
    el.classList.add('is-needed');
    setTimeout(() => el.classList.remove('is-needed'), 2600);
    el.scrollIntoView({ block: 'center' });
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    // The band has nothing to type into — its list is the field. Opened on a
    // timer because the click that got here closes every menu on its way out.
    if (miss.menu) setTimeout(() => { $(miss.menu).hidden = false; }, 0);
  }

  /**
   * One QSO per filled-in group row, sharing everything about the contact
   * that isn't specific to who's on the other end (date, time, band, freq,
   * mode, my station) — only callsign, whatever the lookup found, and that
   * row's own RST differ. Empty rows (never given a callsign) are skipped.
   */
  function readGroupQsos(base) {
    const rows = Array.from($('f-group-list').querySelectorAll('.qso-group-row'));
    const extra = [];

    rows.forEach((row, i) => {
      const call = normalizeCallsign(row.querySelector('.qso-group-call').value);
      if (!call) return;

      const sent = row.querySelector('[data-role="sent"]').value.trim();
      const rcvd = row.querySelector('[data-role="rcvd"]').value.trim();

      // Hand-typed details win over the looked-up ones: the row is only
      // filled in when a lookup found nothing, or when the operator is
      // correcting what it did find.
      const typed = sel => {
        const el = row.querySelector(sel);
        return el ? el.value.trim() : '';
      };

      extra.push(Object.assign({}, base, {
        // Random tail as well as the index: the same contact can be opened and
        // saved with group rows more than once, and those must not collide.
        id: `${base.id}-g${i + 1}-${Math.random().toString(36).slice(2, 6)}`,
        callsign: call,
        name: typed('.qso-group-q-name') || row.dataset.name || '',
        country: row.dataset.country || '',
        grid: row.dataset.grid || '',
        rda: formatRda(typed('.qso-group-q-rda')) || row.dataset.rda || '',
        qth: typed('.qso-group-q-qth') || row.dataset.city || '',
        rstSent: sent || base.rstSent,
        rstRcvd: rcvd || base.rstRcvd,
        // Contest and group logging don't normally meet (the 👥 button is
        // hidden in contest mode), but if they do, each station in the pileup
        // takes the next serial rather than sharing one.
        nrSent: base.nrSent ? formatSerial(Number(base.nrSent) + extra.length + 1) : '',
        nrRcvd: '',
        source: ''
      }));
    });

    return extra;
  }

  /**
   * Enter finishes the contact, wherever the cursor happens to be: the QSO
   * (plus every group station) goes into the log and the cursor returns to
   * CALLSIGN for the next one. A lookup still running is not waited for —
   * speed on air matters more, and DATA → FILL GAPS can backfill names
   * afterwards.
   */
  function logNow() {
    clearTimeout(lookupTimer);
    if ($('f-submit').disabled) return;      // no callsign yet — nothing to log
    submitForm(new Event('submit', { cancelable: true }));
  }

  async function submitForm(ev) {
    ev.preventDefault();

    const miss = missingForLog();
    if (miss) { pointAtMissing(miss); return; }

    readStationFields();
    const qso = readForm();

    // Group rows are logged the same way whether this is a new contact or an
    // edit of an old one: the edit is saved, and each filled-in group row
    // becomes its own new QSO next to it.
    const group = readGroupQsos(qso);

    if (editingId) {
      const existing = entries.find(e => e.id === editingId);
      qso.createdAt = existing ? existing.createdAt : qso.createdAt;
      carryQslStatus(existing, qso);
      entries = entries.map(e => (e.id === editingId ? qso : e));
      await saveEntry(qso);

      if (group.length) {
        entries = group.concat(entries);
        newestIds = new Set(group.map(e => e.id));
        for (const entry of group) await saveEntry(entry);
      }

      console.info(`[qso] edited ${qso.callsign}${group.length ? ` + logged ${group.map(e => e.callsign).join(', ')}` : ''}`);
      flashSaved(group.length
        ? `✓ CHANGES SAVED · ${group.length} QSO LOGGED`
        : '✓ CHANGES SAVED');
      clearGroupRows();
      exitEditMode();
      // The edited contact keeps its own serial; only newly logged group
      // stations consume further numbers.
      if (group.length) advanceSerial(group.length);
      if (group.length) setTimeout(() => { newestIds = new Set(); render(); }, 1400);
      return;
    }

    const batch = [qso].concat(group);

    entries = batch.concat(entries);
    newestIds = new Set(batch.map(e => e.id));
    for (const entry of batch) await saveEntry(entry);
    render();
    flashSaved(batch.length > 1 ? `✓ ${batch.length} QSO LOGGED` : '✓ QSO LOGGED');
    console.info(`[qso] logged ${batch.map(e => e.callsign).join(', ')} · ${qso.band || 'no band'} ${qso.mode} · ${qso.date} ${qso.time}`);
    prepareForNext();
    clearGroupRows();
    autoBackup();                  // cheap: it returns at once unless a copy is due
    advanceSerial(batch.length);   // after prepareForNext, so the next number stands
    setTimeout(() => { newestIds = new Set(); render(); }, 1400);
  }

  // ---------------------------------------------------------------------
  // Logbook
  // ---------------------------------------------------------------------

  function matchesSearch(qso) {
    if (!searchTerm) return true;
    const haystack = [
      qso.callsign, qso.name, qso.country, qso.grid, qso.rda,
      qso.qth, qso.notes, qso.myCallsign, qso.band, qso.mode, qso.freq
    ].join(' ').toLowerCase();
    return haystack.includes(searchTerm);
  }

  function visibleEntries() {
    const list = entries.filter(matchesSearch);
    if (!dupeFilterActive()) return list;
    return list.filter(qso => qso.callsign === dupeCallsign);
  }

  /**
   * The bar above the log explaining why it is short — and the way back to the
   * whole log without clearing the callsign.
   */
  function renderDupeFilterBar() {
    const bar = $('qso-dupe-filter');
    const text = $('qso-dupe-filter-text');
    const toggle = $('qso-dupe-filter-toggle');

    if (!dupeCallsign) {
      bar.hidden = true;
      return;
    }

    const count = entries.filter(qso => qso.callsign === dupeCallsign).length;
    const plural = count === 1 ? 'QSO' : 'QSOs';

    if (dupeFilterActive()) {
      text.innerHTML = `showing only <strong>${escapeHtml(dupeCallsign)}</strong> — ` +
        `${count} ${plural} in the log`;
      toggle.textContent = 'SHOW ALL';
    } else {
      text.innerHTML = `<strong>${escapeHtml(dupeCallsign)}</strong> worked before — ` +
        `${count} ${plural}, highlighted below`;
      toggle.textContent = 'SHOW ONLY THESE';
    }

    bar.hidden = false;
  }

  function rowHtml(qso, index) {
    const classes = [];
    if (newestIds.has(qso.id)) classes.push('qso-new');
    if (dupeCallsign && qso.callsign === dupeCallsign) classes.push('qso-dupe');
    if (qso.id === editingId) classes.push('is-editing');

    return `
      <tr class="${classes.join(' ')}" data-id="${escapeHtml(qso.id)}">
        <td class="qso-pick"><input type="checkbox" data-pick="${escapeHtml(qso.id)}" data-index="${index}"
            ${selected.has(qso.id) ? 'checked' : ''}></td>
        <td>${escapeHtml(formatDateHuman(qso.date))}</td>
        <td>${escapeHtml(qso.time)}</td>
        <td class="qso-call">${myCallHtml(qso)}<span class="qso-them">${escapeHtml(qso.callsign)}</span></td>
        <td class="col-extra">${escapeHtml(qso.name || '—')}</td>
        <td class="col-extra">${escapeHtml(qso.qth || '—')}</td>
        <td>${escapeHtml(qso.band || '—')}</td>
        <td class="qso-freq">${escapeHtml(qso.freq || '—')}</td>
        <td class="qso-qsl-cell">${qslMarksHtml(qso)}</td>
        <td><button class="qso-del" data-del="${escapeHtml(qso.id)}" title="Delete">✕</button></td>
      </tr>`;
  }

  /** Keeps every count and the bulk-delete button in step with the selection. */
  function updateSelectionUi() {
    $('qso-selected').textContent = selected.size;
    $('exp-selected-count').textContent = selected.size;
    $('qso-del-count').textContent = selected.size;
    $('qso-del-selected').hidden = selected.size === 0;
    renderSettingsCounts();
  }

  let backupNeeded = false;

  /**
   * The log's safety net: once a day, quietly, the whole logbook is written
   * out as ADIF into the app's own folder, and the last five are kept. The
   * export button is still the one that puts a file where you want it — this
   * is for the day the profile goes and nobody had pressed it. Nothing to
   * switch on: the only sign of it is the line at the foot of settings
   * saying when the last copy was made.
   *
   * It runs on the day's first launch, and only when something has actually
   * been logged since the last one.
   */
  const BACKUP_AFTER = 20;   // contacts logged since the last copy

  async function autoBackup() {
    if (!entries.length || backupRunning) return;
    const today = new Date().toISOString().slice(0, 10);
    const since = entries.length - (station.autoBackupCount || 0);
    // Never copied before; or a new day with something logged since; or a
    // good evening's worth of contacts — an operator who works a hundred in
    // one sitting shouldn't have to wait until tomorrow for them to be safe.
    const due = !station.autoBackupDate ||
                (station.autoBackupDate !== today && since !== 0) ||
                since >= BACKUP_AFTER;
    if (!due) return;
    backupRunning = true;

    try {
      const res = await fetch('/api/backup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adif: buildAdif(entries), count: entries.length })
      });
      // Hosted copy, or no room. Say so in the debug log: this failed
      // silently for months when the request was too large for the server.
      if (!res.ok) {
        console.info(`[backup] the server would not keep the copy: ${res.status}`);
        return;
      }

      const data = await res.json();
      station.autoBackupDate = today;
      station.autoBackupCount = entries.length;
      station.autoBackupFile = data.file || '';
      persistStation();
      console.info(`[backup] ${data.file}: ${entries.length} contact(s) kept in ${data.dir}`);
      renderBackupNote();
    } catch (e) { /* no server to write to — nothing lost, the note stands */ }
    finally { backupRunning = false; }
  }
  let backupRunning = false;

  /** DATA glows for either reason: a backup is overdue, or QRZ isn't set up yet. */
  function updateDataAlert() {
    const needsQrz = auth.mode === 'key' && !qrzConfigured.ru && !qrzConfigured.com && !qrzConfigured.ham;
    $('qso-data-btn').classList.toggle('has-alert', backupNeeded || needsQrz);
  }

  function renderBackupNote() {
    const note = $('qso-backup-note');
    const unsaved = entries.length - (station.exportedCount || 0);

    // Nudges towards a backup, without nagging after every contact. The
    // automatic copy is a safety net, not a backup you can hold — a file of
    // your own, somewhere that isn't this computer, is still the thing to have.
    backupNeeded = unsaved >= 15;
    if (backupNeeded) {
      note.textContent = tr(`${unsaved} contacts logged since the last export — ⚙️ to back up`,
        `С последнего экспорта записано QSO: ${unsaved} — сохраните копию через ⚙️`);
      note.classList.add('is-shown');
    } else {
      note.classList.remove('is-shown');
    }
    const auto = $('qso-auto-backup');
    if (auto) {
      auto.textContent = station.autoBackupDate
        ? tr(`The app keeps its own copy of the log — last one ${formatDateHuman(station.autoBackupDate)}, five are kept.`,
             `Программа сама хранит копию журнала — последняя ${formatDateHuman(station.autoBackupDate)}, хранятся пять.`)
        : tr('The app makes its own copy of the log once a day.',
             'Программа раз в день сама делает копию журнала.');
    }
    updateDataAlert();
  }

  function render() {
    const list = visibleEntries();

    $('qso-total').textContent = entries.length;
    $('qso-log-toggle-count').textContent = entries.length;
    $('qso-shown').textContent = list.length;
    updateSelectionUi();
    renderDupeFilterBar();

    const table = $('qso-table');
    const tbody = $('qso-tbody');
    const empty = $('qso-empty');

    $('qso-qsl-legend').hidden = !list.length;
    if (!list.length) {
      table.style.display = 'none';
      empty.style.display = 'block';
      empty.textContent = !entries.length
        ? 'No contacts logged yet'
        : dupeFilterActive()
          ? `No ${dupeCallsign} contacts match that search`
          : 'Nothing matches that search';
      tbody.innerHTML = '';
      renderBackupNote();
      return;
    }

    table.style.display = 'table';
    empty.style.display = 'none';
    tbody.innerHTML = list.map((qso, index) => rowHtml(qso, index)).join('');

    tbody.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        askDelete(btn.getAttribute('data-del'));
      });
    });

    tbody.querySelectorAll('[data-eqsl]').forEach(mark => {
      mark.addEventListener('click', ev => {
        ev.stopPropagation();
        openEqslCard(mark.getAttribute('data-eqsl'));
      });
    });

    tbody.querySelectorAll('[data-card]').forEach(mark => {
      mark.addEventListener('click', ev => {
        ev.stopPropagation();
        openCardSend(mark.getAttribute('data-card'));
      });
    });

    tbody.querySelectorAll('[data-pick]').forEach(box => {
      box.addEventListener('click', ev => {
        ev.stopPropagation();

        // Shift-click extends the selection from the last box you touched,
        // the way file lists behave.
        const index = Number(box.getAttribute('data-index'));
        if (ev.shiftKey && lastPickedIndex !== null) {
          const from = Math.min(lastPickedIndex, index);
          const to = Math.max(lastPickedIndex, index);
          const want = box.checked;   // state it is about to take
          list.slice(from, to + 1).forEach(e => {
            if (want) selected.add(e.id); else selected.delete(e.id);
          });
          lastPickedIndex = index;
          render();
          return;
        }
        lastPickedIndex = index;
      });

      box.addEventListener('change', () => {
        const id = box.getAttribute('data-pick');
        if (box.checked) selected.add(id); else selected.delete(id);
        updateSelectionUi();
      });
    });

    tbody.querySelectorAll('tr').forEach(tr => {
      tr.addEventListener('click', () => enterEditMode(tr.getAttribute('data-id')));
    });

    refreshStationFilter();
    renderBackupNote();
  }

  function openDataPanel() {
    refreshStationFilter();
    renderExportFormat();
    refreshFillCount();
    renderSettingsCounts();
    setDataStatus('');
    setImportStatus('');
    setFillStatus('');
    paintStatus($('log-status'), '');
    paintStatus($('lotw-status'), '');
    paintStatus($('eqsl-status'), '');
    paintStatus($('hamlog-status'), '');
    resetImport();
    refreshQrzAccountsStatus();
    refreshLotwStatus();
    refreshEqslStatus();
    Promise.all([refreshCardStatus(), refreshMailStatus()]).then(renderCardSummary);
    showSettingsPage('main');
    openOverlay('qso-data');
  }

  /** The numbers settings show: the logbook's size, and what EXPORT and DELETE ALL would take. */
  function renderSettingsCounts() {
    const total = entries.length;
    $('set-log-count').textContent = total;
    $('clear-count').textContent = total;
    $('clear-all').disabled = total === 0;
    $('clear-note').textContent = total
      ? tr(`The whole logbook on this device will be emptied: ${total} QSO.`,
        `Будет очищен весь журнал на этом устройстве: ${total} QSO.`)
      : tr('The logbook is empty already.', 'Журнал уже пуст.');
    $('exp-count').textContent = matchingExport().length;
    renderLotw();
    renderEqsl();
    renderHamlog();
    renderCardSummary();
  }

  /**
   * Settings is one card with pages in it: the list ('main'), and a page
   * for each row with a › — export, import, clear, debug. Opening settings
   * always starts at the list. A page is shorter than the list, and the
   * card sits centred in the window — so while a page shows, its top edge
   * is pinned where the list had it, and only the bottom comes up, instead
   * of the whole card jumping to a new middle.
   */
  function showSettingsPage(name, animate) {
    const overlay = $('qso-data');
    const card = overlay.querySelector('.qso-card');
    const current = card.querySelector('.qso-set-page:not([hidden])');
    if (name === 'main') {
      card.style.marginTop = '';
    } else if (current && current.id === 'set-page-main' && !overlay.hidden) {
      const padTop = parseFloat(getComputedStyle(overlay).paddingTop) || 0;
      card.style.marginTop = `${Math.max(0, card.offsetTop - padTop)}px`;
    }
    card.querySelectorAll('.qso-set-page').forEach(page => {
      const show = page.id === `set-page-${name}`;
      page.hidden = !show;
      page.classList.remove('is-entering', 'is-returning');
      if (show && animate) {
        void page.offsetWidth;   // restart the slide if it just ran
        page.classList.add(name === 'main' ? 'is-returning' : 'is-entering');
      }
    });
  }

  function settingsSubpageOpen() {
    const main = $('set-page-main');
    return !$('qso-data').hidden && main.hidden;
  }

  /** Export's "date range" shows its two dates; any change re-counts the button. */
  function onExportChoice() {
    $('exp-range').hidden = selectedScope() !== 'range';
    renderExportFormat();
    renderSettingsCounts();
  }

  /**
   * The manual — two plain pages, help/en.html and help/ru.html, shown in a
   * frame over the app, Russian when Russian mode is on. Opened from 📖 in
   * settings, F1, or Help in the Mac app's menu bar. The page stays loaded
   * once opened, so coming back to it lands where the reading left off.
   */
  function openHelp(anchor) {
    const frame = $('help-frame');
    const page = `help/${station.ruPhonetics ? 'ru' : 'en'}.html`;
    const src = page + (anchor ? '#' + anchor : '');
    const shown = (frame.getAttribute('src') || '').split('#')[0];
    if (shown !== page) {
      // Not loaded yet (or the language changed): the address carries the
      // section, and help.js jumps to it once the page is up.
      frame.setAttribute('src', src);
      frame.addEventListener('load', () => frame.contentWindow.focus(), { once: true });
    } else if (anchor) {
      // Already open — telling it where to go keeps the reader's place in
      // the rest of the manual.
      frame.contentWindow.postMessage({ r2fel: 'goto', id: anchor }, location.origin);
    }
    closeOverlay('qso-data');
    openOverlay('qso-help');
    // Keys go to the manual straight away, Esc included (help.js hands that back).
    frame.contentWindow.focus();
  }

  function closeHelp() {
    closeOverlay('qso-help');
  }

  let pendingDelete = null;   // { mode: 'one' | 'selected' | 'all', id }
  let pendingAsk = null;      // a plain question that isn't a deletion
  let pendingNo = null;       // …and what "no" means for that question, if anything
  let lastPickedIndex = null; // anchor for shift-click ranges

  /**
   * The same little card as "delete this?", for an ordinary question: amber
   * button instead of red, and no "this cannot be undone" underneath.
   * The labels are set here every time, so the card can be borrowed for
   * anything without the language switch putting DELETE back on the button.
   */
  function askConfirm(title, detail, okLabel, onYes, opts) {
    const o = opts || {};
    pendingDelete = null;
    pendingAsk = onYes;
    pendingNo = o.onNo || null;
    $('confirm-title').textContent = title;
    $('confirm-detail').textContent = detail || '';
    $('confirm-undo').hidden = true;
    $('confirm-cancel').textContent = o.noLabel || tr('Cancel', 'Отмена');
    const btn = $('confirm-delete');
    btn.textContent = okLabel;
    btn.classList.remove('qso-danger-btn');
    btn.classList.add('qso-go-btn');
    openOverlay('qso-confirm');
  }

  /** Puts the card back the way deletions want it. */
  function confirmAsDelete() {
    pendingAsk = null;
    pendingNo = null;
    $('confirm-undo').hidden = false;
    $('confirm-cancel').textContent = tr('Cancel', 'Отмена');
    const btn = $('confirm-delete');
    btn.textContent = tr('DELETE', 'УДАЛИТЬ');
    btn.classList.remove('qso-go-btn');
    btn.classList.add('qso-danger-btn');
  }

  function askDelete(id) {
    const qso = entries.find(e => e.id === id);
    if (!qso) return;
    pendingDelete = { mode: 'one', id };
    confirmAsDelete();
    $('confirm-title').textContent = tr('Delete this QSO?', 'Удалить эту связь?');
    $('confirm-detail').textContent = `${qso.callsign} · ${describeQso(qso)}`;
    openOverlay('qso-confirm');
  }

  function askDeleteSelected() {
    if (!selected.size) return;
    pendingDelete = { mode: 'selected' };
    confirmAsDelete();
    $('confirm-title').textContent = tr(`Delete ${selected.size} selected QSO?`,
      `Удалить отмеченные QSO (${selected.size})?`);
    const names = entries.filter(e => selected.has(e.id)).slice(0, 4).map(e => e.callsign);
    const more = selected.size > names.length
      ? tr(` and ${selected.size - names.length} more`, ` и ещё ${selected.size - names.length}`) : '';
    $('confirm-detail').textContent = names.join(', ') + more;
    openOverlay('qso-confirm');
  }

  function askDeleteAll() {
    if (!entries.length) return;
    pendingDelete = { mode: 'all' };
    confirmAsDelete();
    $('confirm-title').textContent = tr(
      `Delete all ${entries.length} contact${entries.length === 1 ? '' : 's'}?`,
      `Удалить все QSO (${entries.length})?`);
    $('confirm-detail').textContent = tr('The entire logbook on this device will be emptied.',
      'Журнал на этом устройстве будет полностью очищен.');
    openOverlay('qso-confirm');
  }

  async function confirmDelete() {
    if (!pendingDelete) { closeOverlay('qso-confirm'); return; }
    let cleared = 0;
    console.info(`[qso] delete: ${pendingDelete.mode === 'one' ? '1 contact' : pendingDelete.mode === 'all' ? 'the whole logbook' : `${selected.size} selected`}`);

    if (pendingDelete.mode === 'one') {
      const id = pendingDelete.id;
      entries = entries.filter(e => e.id !== id);
      selected.delete(id);
      await removeEntry(id);
      if (editingId === id) { pendingDelete = null; closeOverlay('qso-confirm'); exitEditMode(); return; }

    } else if (pendingDelete.mode === 'selected') {
      const doomed = new Set(selected);
      entries = entries.filter(e => !doomed.has(e.id));
      selected.clear();
      if (doomed.has(editingId)) editingId = null;
      await saveAll();

    } else if (pendingDelete.mode === 'all') {
      cleared = entries.length;
      entries = [];
      selected.clear();
      editingId = null;
      station.exportedCount = 0;
      persistStation();
      await saveAll();
    }

    pendingDelete = null;
    lastPickedIndex = null;
    closeOverlay('qso-confirm');
    render();
    // Emptied from settings: say so there, plainly.
    if (cleared && !$('qso-data').hidden) {
      renderSettingsCounts();
      showResult({ from: 'clear', backTo: 'main', heading: tr('The log is empty now', 'Журнал очищен'),
        lines: [[tr('Deleted', 'Удалено'), `${cleared} QSO`]] });
    }
  }

  function showHistory(callsign) {
    const prev = previousContacts(callsign);
    $('history-title').textContent =
      `${callsign} — ${prev.length} previous ${prev.length === 1 ? 'contact' : 'contacts'}`;
    $('history-list').innerHTML = prev.map(q => `
      <div class="qso-history-row">
        <div>${escapeHtml(formatDateHuman(q.date))} ${escapeHtml(q.time)}</div>
        <span>${escapeHtml([q.band, q.freq, q.mode, [q.rstSent, q.rstRcvd].filter(Boolean).join('/')]
          .filter(Boolean).join(' · ') + myCallNote(q))}</span>
      </div>`).join('') || '<div class="qso-history-row">No earlier contacts</div>';
    openOverlay('qso-history');
  }

  // ---------------------------------------------------------------------
  // Overlays
  // ---------------------------------------------------------------------

  function openOverlay(id) { $(id).hidden = false; }
  function closeOverlay(id) { $(id).hidden = true; }

  // ---------------------------------------------------------------------
  // ADIF
  //
  // Field lengths in ADIF count BYTES, not characters, so Cyrillic names are
  // measured with a TextEncoder and read back out of the raw bytes.
  //
  // RDA and MY_RDA aren't in the ADIF specification, but Russian logging
  // software reads and writes them, so they're included — everything else
  // sticks to standard field names.
  // ---------------------------------------------------------------------

  const encoder = new TextEncoder();

  // ---------------------------------------------------------------------
  // Distance
  //
  // Great-circle distance between two Maidenhead locators, using the centre
  // of each square. A four-character locator is a box roughly 70 km across,
  // so a distance computed from one is good to a few tens of kilometres —
  // fine for knowing whether someone is next door or across the continent.
  // ---------------------------------------------------------------------

  function gridToLatLon(grid) {
    const g = String(grid || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^[A-R]{2}[0-9]{2}([A-X]{2})?$/.test(g)) return null;

    let lon = (g.charCodeAt(0) - 65) * 20 - 180 + Number(g[2]) * 2;
    let lat = (g.charCodeAt(1) - 65) * 10 - 90 + Number(g[3]);

    if (g.length >= 6) {
      lon += (g.charCodeAt(4) - 65) * (2 / 24) + (1 / 24);
      lat += (g.charCodeAt(5) - 65) * (1 / 24) + (1 / 48);
    } else {
      lon += 1;      // centre of the 2° square
      lat += 0.5;    // centre of the 1° square
    }

    return { lat, lon };
  }

  /** The inverse of gridToLatLon — coordinates in, a 6-character locator out. */
  function latLonToGrid(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    let lonPos = ((lon + 180) % 360 + 360) % 360; // 0..360
    let latPos = lat + 90;                        // 0..180

    const fieldLon = Math.floor(lonPos / 20);
    const fieldLat = Math.floor(latPos / 10);
    lonPos -= fieldLon * 20;
    latPos -= fieldLat * 10;

    const squareLon = Math.floor(lonPos / 2);
    const squareLat = Math.floor(latPos);
    lonPos -= squareLon * 2;
    latPos -= squareLat;

    const subLon = Math.min(23, Math.max(0, Math.floor(lonPos * 12)));
    const subLat = Math.min(23, Math.max(0, Math.floor(latPos * 24)));

    return (
      String.fromCharCode(65 + fieldLon) +
      String.fromCharCode(65 + fieldLat) +
      String(squareLon) +
      String(squareLat) +
      String.fromCharCode(97 + subLon) +
      String.fromCharCode(97 + subLat)
    );
  }

  function distanceKm(gridA, gridB) {
    const a = gridToLatLon(gridA);
    const b = gridToLatLon(gridB);
    if (!a || !b) return null;

    const R = 6371;
    const toRad = deg => (deg * Math.PI) / 180;

    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;

    return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
  }

  /** My own locator, taken from the station bar. */
  function myGrid() {
    return extractGrid($('s-qth').value) || extractGrid(station.qth);
  }

  function adifField(name, value) {
    if (value === null || value === undefined || value === '') return '';
    const text = String(value);
    return `<${name.toUpperCase()}:${encoder.encode(text).length}>${text} `;
  }

  /** Pulls a grid square out of a free-text QTH like "Moscow, KO85tr". */
  function extractGrid(text) {
    const source = foldLookalikes(text);

    const direct = source.match(/\b[A-R]{2}[0-9]{2}([A-X]{2})?\b/i);
    if (direct) return direct[0].toUpperCase();

    // People write their locator with a separator — "KO-04", "KO 85tr".
    const joined = source.replace(/[\s-]/g, '');
    const loose = joined.match(/\b[A-R]{2}[0-9]{2}([A-X]{2})?\b/i);
    return loose ? loose[0].toUpperCase() : '';
  }

  /** "007" → "7" for the numeric ADIF serial fields; anything else → ''. */
  function serialNumber(raw) {
    const n = Number(String(raw || '').trim());
    return Number.isFinite(n) && n > 0 ? String(n) : '';
  }

  function adifRecord(qso) {
    const freqMHz = Number.isFinite(qso.freqHz) ? (qso.freqHz / 1e6).toFixed(6) : '';
    return [
      adifField('CALL', qso.callsign),
      adifField('QSO_DATE', (qso.date || '').replace(/-/g, '')),
      adifField('TIME_ON', (qso.time || '').replace(':', '') + '00'),
      adifField('BAND', (qso.band || '').toLowerCase()),
      adifField('FREQ', freqMHz),
      adifModeFields(qso.mode),
      adifField('RST_SENT', qso.rstSent),
      adifField('RST_RCVD', qso.rstRcvd),
      // Contest serials: the _STRING fields keep the leading zeros as sent on
      // air, STX/SRX carry the same value as the plain integer the standard
      // asks for. Both are skipped entirely for non-contest contacts.
      adifField('STX_STRING', qso.nrSent),
      adifField('SRX_STRING', qso.nrRcvd),
      adifField('STX', serialNumber(qso.nrSent)),
      adifField('SRX', serialNumber(qso.nrRcvd)),
      adifField('NAME', qso.name),
      adifField('QTH', qso.qth),
      adifField('COUNTRY', qso.country),
      adifField('GRIDSQUARE', qso.grid),
      adifField('RDA', qso.rda),
      adifField('STATION_CALLSIGN', qso.myCallsign),
      adifField('OPERATOR', qso.myCallsign),
      adifField('MY_GRIDSQUARE', extractGrid(qso.myQth)),
      adifField('MY_RDA', qso.myRda),
      adifField('COMMENT', qso.notes),
      adifField('EMAIL', qso.email),
      qslAdifFields(qso)
    ].join('') + '<EOR>\n';
  }

  function buildAdif(list) {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const header =
      'ADIF export from R2FEL HamLog\n' +
      adifField('ADIF_VER', '3.1.4') + '\n' +
      adifField('PROGRAMID', 'R2FEL-HamLog') + '\n' +
      adifField('CREATED_TIMESTAMP', stamp) + '\n' +
      '<EOH>\n\n';
    return header + list.map(adifRecord).join('');
  }

  /**
   * UTF-8 bytes cut off mid-letter at the end — as some services write a
   * Russian field whose length they counted wrong — decoded without the
   * broken tail. null when the bytes aren't UTF-8 text with letters beyond
   * plain Latin (then they're something else — windows-1251, most often).
   */
  const utf8Strict = new TextDecoder('utf-8', { fatal: true });
  function utf8Letters(bytes) {
    let end = bytes.length;
    let i = end - 1;
    let tail = 0;
    while (i >= 0 && (bytes[i] & 0xc0) === 0x80 && tail < 3) { i--; tail++; }
    if (i >= 0 && bytes[i] >= 0xc0) {
      const need = bytes[i] >= 0xf0 ? 3 : bytes[i] >= 0xe0 ? 2 : 1;
      if (tail < need) end = i;
    }
    const part = bytes.subarray(0, end);
    if (!part.some(b => b >= 0x80)) return null;
    try { return utf8Strict.decode(part); } catch (e) { return null; }
  }

  /**
   * Russian text that went through the wrong decoding somewhere — UTF-8
   * read as windows-1251 — comes out as "РђР»РµРєС" for "Алек…". Put back:
   * the same characters as windows-1251 bytes, read as UTF-8. Only when that
   * really gives UTF-8 text: ordinary Russian in windows-1251 never does.
   */
  let cp1251Codes = null;
  /** Character → its windows-1251 byte, for everything above plain Latin. */
  function cp1251Table() {
    if (!cp1251Codes) {
      cp1251Codes = new Map();
      const dec = new TextDecoder('windows-1251');
      for (let b = 0x80; b <= 0xff; b++) cp1251Codes.set(dec.decode(new Uint8Array([b])), b);
    }
    return cp1251Codes;
  }

  function repairMojibake(text) {
    const s = String(text || '');
    // At least two letters' worth of it — a stray pair can be real text.
    if ((s.match(/[РС][\u0400-\u040f\u0450-\u045f\u0490\u0491\u00a0-\u00bf\u2013-\u2122]/g) || []).length < 2) return s;
    const table = cp1251Table();
    const bytes = [];
    for (const ch of s) {
      const code = ch.charCodeAt(0);
      if (code < 0x80) bytes.push(code);
      else if (table.has(ch)) bytes.push(table.get(ch));
      else return s;
    }
    const fixed = utf8Letters(new Uint8Array(bytes));
    return fixed && /[\u0400-\u04ff]/.test(fixed) ? fixed.trim() : s;
  }

  function parseAdif(bytes) {
    // Russian logging software often writes ADIF in windows-1251 rather than
    // UTF-8. Try strict UTF-8 first; if the bytes aren't valid UTF-8, they're
    // almost certainly cp1251.
    let decode;
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const utf8 = new TextDecoder('utf-8');
      decode = slice => utf8.decode(slice);
    } catch (e) {
      const cp1251 = new TextDecoder('windows-1251');
      // Some files mix the two: most fields windows-1251, a few UTF-8. Each
      // field that reads as UTF-8 is taken as UTF-8.
      decode = slice => utf8Letters(slice) || cp1251.decode(slice);
      console.info('[adif] file is not UTF-8, reading as windows-1251');
    }

    // One char per byte, so string indexes line up with byte offsets.
    const ascii = new TextDecoder('latin1').decode(bytes);

    let start = 0;
    const eoh = ascii.toLowerCase().indexOf('<eoh>');
    if (eoh !== -1) start = eoh + 5;

    const records = [];
    let record = {};
    const tagRe = /<([a-z0-9_]+)(?::(\d+))?(?::[a-z])?>/gi;
    tagRe.lastIndex = start;

    let m;
    while ((m = tagRe.exec(ascii)) !== null) {
      const name = m[1].toLowerCase();

      if (name === 'eor') {
        if (Object.keys(record).length) records.push(record);
        record = {};
        continue;
      }
      if (name === 'eoh') { record = {}; continue; }

      const declared = m[2] ? parseInt(m[2], 10) : 0;
      const valueStart = m.index + m[0].length;

      // A value runs until the next tag, and ADIF values never contain '<'.
      const nextTag = ascii.indexOf('<', valueStart);
      const limit = nextTag === -1 ? bytes.length : nextTag;

      let end = Math.min(valueStart + declared, limit);

      // The standard counts bytes, but plenty of programs count characters
      // instead, which cuts Cyrillic values in half. If real text continues
      // past the declared length, the count was characters — take the whole
      // value up to the next tag.
      if (ascii.slice(end, limit).trim() !== '') end = limit;

      record[name] = decode(bytes.subarray(valueStart, end)).trim();
      tagRe.lastIndex = end;
    }
    if (Object.keys(record).length) records.push(record);
    return records;
  }

  function qsoFromAdif(rec) {
    const date = (rec.qso_date || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
    const rawTime = rec.time_on || rec.time_off || '';
    const time = rawTime.length >= 4 ? `${rawTime.slice(0, 2)}:${rawTime.slice(2, 4)}` : '';

    let hz = null;
    if (rec.freq) {
      const mhz = Number(String(rec.freq).replace(',', '.'));
      if (Number.isFinite(mhz)) hz = Math.round(mhz * 1e6);
    }

    const band = hz !== null ? (bandFor(hz) || '') : (rec.band || '').toLowerCase();

    return {
      id: `imp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      myCallsign: normalizeCallsign(rec.station_callsign || rec.operator || station.callsign),
      // HAMLOG (and others) keep my RDA in MY_CNTY, the standard's district field.
      myRda: (rec.my_rda || (/^[A-Z]{2}-\d{2}$/i.test(rec.my_cnty || '') ? rec.my_cnty : '')).toUpperCase(),
      myQth: formatGrid(rec.my_gridsquare || rec.my_city || ''),
      callsign: normalizeCallsign(rec.call),
      name: rec.name || '',
      country: rec.country || '',
      grid: (rec.gridsquare || rec.vucc_grids || '').toUpperCase(),
      rda: (rec.rda || rec.app_rda || '').toUpperCase(),
      // Programs disagree on where the town goes: QTH is standard, but
      // ADDRESS, CITY and STATE all turn up in real files.
      qth: rec.qth || rec.city || rec.address || rec.addr || rec.state || '',
      band,
      freq: hz !== null ? formatFrequency(hz) : '',
      freqHz: hz,
      mode: modeFromAdif(rec),
      date,
      time,
      rstSent: rec.rst_sent || '',
      rstRcvd: rec.rst_rcvd || '',
      nrSent: rec.stx_string || rec.stx || '',
      nrRcvd: rec.srx_string || rec.srx || '',
      notes: rec.comment || rec.notes || '',
      email: rec.email || '',
      source: 'adif',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...qslFromAdif(rec)
    };
  }

  function dedupeKey(qso) {
    return [qso.callsign, qso.date, qso.time, qso.band].join('|');
  }

  // ---------------------------------------------------------------------
  // QSL confirmations: LoTW, eQSL, HAMLOG
  //
  // Each contact carries, per service, whether it has been sent there and
  // whether it came back confirmed, with the dates: lotwSent / lotwSentDate /
  // lotwRcvd / lotwRcvdDate, and the same with eqsl… and hamlog…. In the log
  // they're the L / e / H marks — grey outline not sent, amber sent, green
  // confirmed. They go out in ADIF under the standard fields (LOTW_QSL_SENT,
  // EQSL_QSL_RCVD…) and come back in on import.
  // ---------------------------------------------------------------------

  const QSL_SERVICES = [
    { key: 'lotw', letter: 'L', name: 'LoTW' },
    { key: 'eqsl', letter: 'e', name: 'eQSL' },
    { key: 'hamlog', letter: 'H', name: 'HAMLOG' },
    // Our own card, sent by e-mail from here: only ever "sent". Its mark is a
    // button — pressing it opens the sending window.
    { key: 'card', letter: '✉', name: 'QSL e-mail' }
  ];
  const QSL_FIELDS = QSL_SERVICES.flatMap(s =>
    ['Sent', 'SentDate', 'Rcvd', 'RcvdDate'].map(part => s.key + part));

  function qslState(qso, key) {
    if (qso[`${key}Rcvd`]) return 'cfm';
    if (qso[`${key}Sent`]) return 'sent';
    return '';
  }

  function qslTooltip(qso, s) {
    if (s.key === 'card') {
      return qso.cardSent
        ? tr(`QSL by e-mail: sent ${formatDateHuman(qso.cardSentDate)}${qso.email ? ` to ${qso.email}` : ''}`,
          `QSL по e-mail: отправлена ${formatDateHuman(qso.cardSentDate)}${qso.email ? ` на ${qso.email}` : ''}`)
        : tr('QSL by e-mail: not sent — click ✉ to send', 'QSL по e-mail: не отправлена — нажмите ✉, чтобы отправить');
    }
    const sent = qso[`${s.key}SentDate`] ? ` ${formatDateHuman(qso[`${s.key}SentDate`])}` : '';
    const rcvd = qso[`${s.key}RcvdDate`] ? ` ${formatDateHuman(qso[`${s.key}RcvdDate`])}` : '';
    const state = qslState(qso, s.key);
    if (state === 'cfm' && s.key === 'eqsl') {
      return `${s.name}: ${tr('confirmed', 'подтверждено')}${rcvd} — ${tr('click the e to see the card', 'нажмите на «e», чтобы посмотреть карточку')}`;
    }
    if (state === 'cfm') return `${s.name}: ${tr('confirmed', 'подтверждено')}${rcvd}`;
    if (state === 'sent') return `${s.name}: ${tr('sent', 'отправлено')}${sent}${tr(', not confirmed yet', ', подтверждения пока нет')}`;
    return `${s.name}: ${tr('not sent', 'не отправлено')}`;
  }

  function qslMarksHtml(qso) {
    const title = QSL_SERVICES.map(s => qslTooltip(qso, s)).join('\n');
    return `<span class="qso-qsl" title="${escapeHtml(title)}">` +
      QSL_SERVICES.map(s => {
        const state = qslState(qso, s.key);
        if (s.key === 'card') return `<i class="qso-card-mark ${state}" data-card="${escapeHtml(qso.id)}">${s.letter}</i>`;
        // A confirmed eQSL has a card behind it: the "e" opens it.
        if (s.key === 'eqsl' && state === 'cfm') return `<i class="cfm qso-eqsl-card" data-eqsl="${escapeHtml(qso.id)}">${s.letter}</i>`;
        return `<i class="${state}">${s.letter}</i>`;
      }).join('') + '</span>';
  }

  /**
   * An edited contact keeps its marks — unless what the services matched it
   * by changed (who, when, band, mode, under which callsign): then, as far as
   * they're concerned, it's a different contact, to be sent again.
   */
  function carryQslStatus(from, to) {
    if (!from) return;
    const same = ['callsign', 'date', 'time', 'band', 'mode']
      .every(k => (from[k] || '') === (to[k] || '')) && baseCallsign(from.myCallsign) === baseCallsign(to.myCallsign);
    if (!same) {
      if (QSL_FIELDS.some(f => from[f])) console.info(`[qsl] ${to.callsign}: changed after sending — marks cleared, to be sent again`);
      return;
    }
    QSL_FIELDS.forEach(f => { if (from[f]) to[f] = from[f]; });
  }

  /** Takes on what `incoming` knows and `existing` doesn't yet. True if anything changed. */
  function mergeQslStatus(existing, incoming) {
    let changed = false;
    QSL_SERVICES.forEach(({ key }) => {
      ['Sent', 'Rcvd'].forEach(part => {
        if (incoming[key + part] && !existing[key + part]) {
          existing[key + part] = incoming[key + part];
          if (incoming[`${key}${part}Date`]) existing[`${key}${part}Date`] = incoming[`${key}${part}Date`];
          changed = true;
        }
      });
    });
    return changed;
  }

  const adifDate = ymd => (ymd || '').replace(/-/g, '');
  const fromAdifDate = s => {
    const m = String(s || '').match(/^(\d{4})-?(\d{2})-?(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
  };

  function qslAdifFields(qso) {
    return [
      qso.lotwSent ? adifField('LOTW_QSL_SENT', 'Y') + adifField('LOTW_QSLSDATE', adifDate(qso.lotwSentDate)) : '',
      qso.lotwRcvd ? adifField('LOTW_QSL_RCVD', 'Y') + adifField('LOTW_QSLRDATE', adifDate(qso.lotwRcvdDate)) : '',
      qso.eqslSent ? adifField('EQSL_QSL_SENT', 'Y') + adifField('EQSL_QSLSDATE', adifDate(qso.eqslSentDate)) : '',
      qso.eqslRcvd ? adifField('EQSL_QSL_RCVD', 'Y') + adifField('EQSL_QSLRDATE', adifDate(qso.eqslRcvdDate)) : '',
      // HAMLOG has no standard field; these are our own, named so.
      qso.hamlogSent ? adifField('APP_LOG_HAMLOG_SENT', 'Y') + adifField('APP_LOG_HAMLOG_SENTDATE', adifDate(qso.hamlogSentDate)) : '',
      qso.hamlogRcvd ? adifField('APP_LOG_HAMLOG_RCVD', 'Y') + adifField('APP_LOG_HAMLOG_RCVDDATE', adifDate(qso.hamlogRcvdDate)) : '',
      qso.cardSent ? adifField('APP_LOG_CARD_SENT', 'Y') + adifField('APP_LOG_CARD_SENTDATE', adifDate(qso.cardSentDate)) : ''
    ].join('');
  }

  function qslFromAdif(rec) {
    const out = {};
    const yes = v => /^[YV]$/i.test(String(v || '').trim());
    const take = (key, sent, sentDate, rcvd, rcvdDate) => {
      if (yes(rec[sent])) { out[`${key}Sent`] = 'Y'; out[`${key}SentDate`] = fromAdifDate(rec[sentDate]); }
      if (yes(rec[rcvd])) { out[`${key}Rcvd`] = 'Y'; out[`${key}RcvdDate`] = fromAdifDate(rec[rcvdDate]); }
    };
    take('lotw', 'lotw_qsl_sent', 'lotw_qslsdate', 'lotw_qsl_rcvd', 'lotw_qslrdate');
    take('eqsl', 'eqsl_qsl_sent', 'eqsl_qslsdate', 'eqsl_qsl_rcvd', 'eqsl_qslrdate');
    take('hamlog', 'app_log_hamlog_sent', 'app_log_hamlog_sentdate', 'app_log_hamlog_rcvd', 'app_log_hamlog_rcvddate');
    take('card', 'app_log_card_sent', 'app_log_card_sentdate', '', '');
    // HAMLOG's own export: uploaded on a date, confirmed by HQSL or not.
    if (rec.app_hamlog_qso_upload_date) { out.hamlogSent = 'Y'; out.hamlogSentDate = fromAdifDate(rec.app_hamlog_qso_upload_date); }
    if (yes(rec.app_hamlog_qso_cfm)) { out.hamlogRcvd = 'Y'; out.hamlogSent = 'Y'; }
    // Confirmed means it got there.
    QSL_SERVICES.forEach(({ key }) => { if (out[`${key}Rcvd`]) out[`${key}Sent`] = 'Y'; });
    Object.keys(out).forEach(k => { if (!out[k]) delete out[k]; });
    return out;
  }

  /**
   * The line under a service's SEND button that says why its count is what
   * it is: contacts under this callsign, not sent yet, that lack a band or a
   * mode — no service takes those, so they're named, to be filled in — or,
   * with nothing to send at all, just that. `blocked`: the page already says
   * why others can't go (LoTW's certificate dates), so no "nothing to send".
   */
  function renderQueueNote(el, key, call, pending, where, blocked) {
    const incomplete = call ? entries.filter(e => !e[`${key}Sent`] && e.callsign &&
      e.myCallsign && baseCallsign(e.myCallsign) === call &&
      (!e.band || !e.mode || !e.date || !e.time)) : [];
    // Whose they are isn't known — so they can't go under anyone's callsign.
    const nobody = entries.filter(e => !e[`${key}Sent`] && e.callsign && !e.myCallsign).length;
    const parts = [];
    if (incomplete.length) {
      const calls = incomplete.slice(0, 5).map(e => e.callsign).join(', ') +
        (incomplete.length > 5 ? tr(` and ${incomplete.length - 5} more`, ` и ещё ${incomplete.length - 5}`) : '');
      const noBand = incomplete.every(e => !e.band);
      parts.push(tr(
        `${incomplete.length} QSO won't go — no ${noBand ? 'band' : 'band or mode'}: ${calls}. Click the contact in the log and fill in the frequency or band.`,
        `Не уйдут, пока не указан ${noBand ? 'диапазон' : 'диапазон или вид излучения'}: ${incomplete.length} QSO — ${calls}. Щёлкните по связи в журнале и впишите частоту или диапазон.`));
    }
    if (nobody) {
      parts.push(tr(
        `${nobody} QSO won't go — your callsign on them isn't recorded (a "?" in the log). Set it in ⚙ → My callsign on contacts.`,
        `Не уйдут, пока не записан ваш позывной («?» в журнале): ${nobody} QSO. Укажите его: ⚙ → «Мой позывной у связей».`));
    }
    if (!parts.length && call && !pending && !blocked) {
      parts.push(tr(`Nothing to send: every ${call} contact is ${where.en} already.`,
        `Отправлять нечего: все связи ${call} уже ${where.ru}.`));
    }
    el.textContent = parts.join(' ');
    el.classList.toggle('qso-set-warn', incomplete.length > 0 || nobody > 0);
    el.hidden = !el.textContent;
  }

  function qslCounts(key) {
    let sent = 0;
    let cfm = 0;
    entries.forEach(e => {
      if (e[`${key}Sent`]) sent++;
      if (e[`${key}Rcvd`]) cfm++;
    });
    return { sent, cfm };
  }

  // ---------------------------------------------------------------------
  // LoTW
  //
  // Sending goes through TQSL on this computer (server.js runs it), under a
  // Station Location chosen here — and only the contacts made under that
  // location's callsign go with it: TQSL signs with the certificate for that
  // call. Checking asks LoTW itself, with the website login, twice: what it
  // has received from this operator (marks those sent, however they got
  // there), and what has come back confirmed. Each asks only for what's new
  // since the last time.
  // ---------------------------------------------------------------------

  let lotwInfo = null;     // /api/lotw/status: { tqsl, locations, login } — or { remote } / { offline }
  let lotwBusy = false;

  async function refreshLotwStatus() {
    try {
      const res = await fetch('/api/lotw/status');
      lotwInfo = res.status === 403 ? { remote: true } : await res.json();
    } catch (e) {
      lotwInfo = { offline: true };
    }
    renderLotw();
  }

  function lotwLocation() {
    const list = (lotwInfo && lotwInfo.locations) || [];
    return list.find(loc => loc.name === station.lotwLocation) || list[0] || null;
  }

  /** The callsign certificates TQSL has for this call: [{ call, from, to }]. */
  function lotwCertificates(call) {
    return ((lotwInfo && lotwInfo.certificates) || []).filter(c => c.call === call);
  }

  /** Inside the span of contact dates a certificate for this call may sign — LoTW takes nothing outside it. */
  function lotwInCertRange(qso, call) {
    const certs = lotwCertificates(call);
    if (!certs.length) return true;   // not known here — TQSL will say
    return certs.some(c => (!c.from || qso.date >= c.from) && (!c.to || qso.date <= c.to));
  }

  /** A contact that could go under this location: its callsign (or none recorded), a band, a mode. */
  function lotwCandidate(qso, loc) {
    if (qso.lotwSent || !loc) return false;
    if (!qso.myCallsign || baseCallsign(qso.myCallsign) !== loc.call) return false;
    return Boolean(qso.callsign && qso.band && qso.mode && qso.date && qso.time);
  }

  /** …and one TQSL can actually sign: within the certificate's dates. */
  function lotwSendable(qso, loc) {
    return lotwCandidate(qso, loc) && lotwInCertRange(qso, loc.call);
  }

  function lotwPending() {
    const loc = lotwLocation();
    return entries.filter(e => lotwSendable(e, loc));
  }

  function renderLotw() {
    const { sent, cfm } = qslCounts('lotw');
    const pending = lotwPending().length;
    $('lotw-summary').textContent = tr(
      `Sent ${sent} · confirmed ${cfm}${lotwLocation() ? ` · waiting to go ${pending}` : ''}`,
      `Отправлено ${sent} · подтверждено ${cfm}${lotwLocation() ? ` · ждут отправки ${pending}` : ''}`);

    const info = lotwInfo || {};
    const state = $('lotw-tqsl-state');
    if (info.remote) {
      state.textContent = '';
      $('lotw-tqsl-desc').textContent = tr('Only on the computer the program runs on', 'Только на компьютере, где работает программа');
    } else if (info.offline || !lotwInfo) {
      state.textContent = '';
      $('lotw-tqsl-desc').textContent = tr('checking…', 'проверяю…');
    } else if (!info.tqsl) {
      state.textContent = tr('✕ not found', '✕ не найдена');
      state.className = 'qso-lotw-bad';
      $('lotw-tqsl-desc').textContent = tr('Install TQSL from lotw.arrl.org and set up your callsign certificate in it',
        'Установите TQSL с lotw.arrl.org и заведите в ней сертификат своего позывного');
    } else {
      state.textContent = tr('✓ found', '✓ найдена');
      state.className = 'qso-lotw-ok';
      $('lotw-tqsl-desc').textContent = tr('Signs the contacts with your certificate and sends them to LoTW',
        'Подписывает связи вашим сертификатом и отправляет их в LoTW');
    }
    $('lotw-tqsl-version').textContent = info.tqsl && info.tqsl.version ? tr(`version ${info.tqsl.version}`, `версия ${info.tqsl.version}`) : '';

    const select = $('lotw-location');
    const locations = info.locations || [];
    const loc = lotwLocation();
    select.innerHTML = locations.length
      ? locations.map(l => `<option value="${escapeHtml(l.name)}">${escapeHtml(l.name)} · ${escapeHtml(l.call)}</option>`).join('')
      : `<option value="">${tr('none', 'нет')}</option>`;
    select.disabled = !locations.length;
    if (loc) select.value = loc.name;
    $('lotw-location-desc').textContent = locations.length || !info.tqsl
      ? tr('As you named it in TQSL (Station Location)', 'Как вы назвали его в TQSL (Station Location)')
      : tr('No Station Location in TQSL yet — add one there', 'В TQSL ещё нет ни одного места станции — заведите его там');

    const login = info.login || {};
    $('lotw-login-desc').textContent = login.username
      ? tr(`${login.username} · the password is kept on this computer only`, `${login.username} · пароль хранится только на этом компьютере`)
      : tr('not set — needed to check confirmations', 'не задан — нужен для проверки подтверждений');

    $('lotw-send-count').textContent = pending;
    $('lotw-send').disabled = lotwBusy || !info.tqsl || !loc || !pending;
    $('lotw-check').disabled = lotwBusy || !login.username || info.remote;

    // Contacts under this callsign that the certificate's dates leave out.
    const outside = loc ? entries.filter(e => lotwCandidate(e, loc) && !lotwInCertRange(e, loc.call)) : [];
    $('lotw-range-note').hidden = !outside.length;
    if (outside.length) {
      const certs = lotwCertificates(loc.call);
      const from = certs.map(c => c.from).filter(Boolean).sort()[0] || '';
      const to = certs.map(c => c.to).filter(Boolean).sort().slice(-1)[0] || '';
      const span = from && to ? tr(`from ${formatDateHuman(from)} to ${formatDateHuman(to)}`, `с ${formatDateHuman(from)} по ${formatDateHuman(to)}`)
        : from ? tr(`from ${formatDateHuman(from)}`, `с ${formatDateHuman(from)}`) : tr(`until ${formatDateHuman(to)}`, `по ${formatDateHuman(to)}`);
      $('lotw-range-note').textContent = tr(
        `${outside.length} QSO as ${loc.call} won't go to LoTW: the ${loc.call} certificate in TQSL signs contacts ${span} only. Earlier ones need a certificate starting earlier — ARRL issues it.`,
        `${outside.length} QSO под ${loc.call} в LoTW не уйдут: сертификат ${loc.call} в TQSL подписывает только связи ${span}. Для более ранних нужен сертификат с более ранней датой начала — его выдаёт ARRL.`);
    }
    const noCert = Boolean(loc && info.certificates && info.certificates.length && !lotwCertificates(loc.call).length);
    if (noCert) {
      $('lotw-range-note').hidden = false;
      $('lotw-range-note').textContent = tr(`TQSL has no callsign certificate for ${loc.call}.`, `В TQSL нет сертификата позывного ${loc.call}.`);
      $('lotw-send').disabled = true;
    }
    renderQueueNote($('lotw-queue-note'), 'lotw', loc ? loc.call : '', pending,
      { en: 'in LoTW', ru: 'в LoTW' }, outside.length > 0 || noCert);

    // What goes: this location's callsign, suffixes included. Contacts under
    // other callsigns of mine (an old one, say) just stay in the log.
    $('lotw-other-note').hidden = !loc;
    if (loc) {
      $('lotw-other-note').textContent = tr(
        `What goes is the contacts made as ${loc.call} — /P, /M and /QRP included, under ${loc.call}, as always.`,
        `Уходят связи позывного ${loc.call} — вместе с /P, /M и /QRP, под ${loc.call}, как всегда.`);
    }
    if (!$('lotw-status').textContent && station.lotwChecked) {
      paintStatus($('lotw-status'), lotwCheckedText(), '');
    }
  }

  function lotwCheckedText(key = 'lotw') {
    const d = new Date(station[`${key}Checked`]);
    if (Number.isNaN(d.getTime())) return '';
    const ymd = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    return tr(`Last checked ${formatDateHuman(ymd)} at ${hm} UTC`, `Последняя проверка ${formatDateHuman(ymd)} в ${hm} UTC`);
  }

  function setLotwStatus(text, kind) {
    if (text && kind !== 'pending') console.info(`[lotw] ${text}`);
    paintStatus($('lotw-status'), text, kind);
  }

  /** Just what LoTW matches a contact by — nothing about my station, so TQSL takes it from the location. */
  function buildLotwAdif(list) {
    const header = 'Contacts for LoTW, from R2FEL HamLog\n' + adifField('ADIF_VER', '3.1.4') + adifField('PROGRAMID', 'R2FEL-HamLog') + '\n<EOH>\n';
    return header + list.map(qso => [
      adifField('CALL', qso.callsign),
      adifField('QSO_DATE', adifDate(qso.date)),
      adifField('TIME_ON', (qso.time || '').replace(':', '')),
      adifField('BAND', (qso.band || '').toUpperCase()),
      qso.freqHz ? adifField('FREQ', (qso.freqHz / 1e6).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')) : '',
      adifModeFields(qso.mode),
      adifField('RST_SENT', qso.rstSent),
      adifField('RST_RCVD', qso.rstRcvd)
    ].join('') + '<EOR>\n').join('');
  }

  async function sendToLotw() {
    const loc = lotwLocation();
    const list = lotwPending().slice().sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    if (!loc || !list.length || lotwBusy) return;

    lotwBusy = true;
    renderLotw();
    setLotwStatus(tr(`TQSL is signing and sending ${list.length} QSO…`, `TQSL подписывает и отправляет ${list.length} QSO…`), 'pending');
    try {
      const res = await fetch('/api/lotw/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adif: buildLotwAdif(list), location: loc.name })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      const code = data.code;
      if (code === 0 || code === 8 || code === 9) {
        const today = nowUtcParts().date;
        for (const qso of list) {
          qso.lotwSent = 'Y';
          qso.lotwSentDate = today;
          await saveEntry(qso);
        }
        render();
        serviceResult('lotw', true,
          code === 8 ? tr('Nothing new for LoTW', 'Для LoTW ничего нового') : tr('Sent to LoTW', 'Отправлено в LoTW'),
          code === 0
            ? [[tr('Sent', 'Отправлено'), `${list.length} QSO`],
              tr('Confirmations come as the other stations upload their logs.', 'Подтверждения придут, когда корреспонденты загрузят свои журналы.')]
            : code === 9
              ? [[tr('Sent', 'Отправлено'), `${list.length} QSO`],
                tr('Some were in LoTW already — TQSL skipped those. All are marked sent.', 'Часть уже была в LoTW — TQSL их пропустила. Все отмечены как отправленные.')]
              : [tr(`TQSL had sent all ${list.length} before (or they're outside the certificate's dates). Marked sent.`,
                `TQSL уже отправляла все ${list.length} (или они вне дат сертификата). Отмечены как отправленные.`)]);
      } else {
        const why = {
          1: tr('cancelled in TQSL', 'отменено в TQSL'),
          2: tr('LoTW rejected the log', 'LoTW отклонил журнал'),
          3: tr('LoTW answered something unexpected', 'непонятный ответ LoTW'),
          4: tr('TQSL error — is the certificate in place, and TQSL itself closed?', 'ошибка TQSL — на месте ли сертификат и закрыта ли сама TQSL?'),
          5: tr('TQSL error', 'ошибка TQSL'),
          6: tr('TQSL could not read the file', 'TQSL не смогла прочитать файл'),
          11: tr('no connection to LoTW', 'нет связи с LoTW')
        }[code] || tr(`TQSL status ${code}`, `TQSL, код ${code}`);
        serviceResult('lotw', false, tr('Not sent', 'Не отправлено'),
          [why.charAt(0).toUpperCase() + why.slice(1) + '.', tr('Details are in the debug log.', 'Подробности — в журнале отладки.')]);
      }
    } catch (err) {
      serviceResult('lotw', false, tr('Not sent', 'Не отправлено'), [err.message]);
    } finally {
      lotwBusy = false;
      renderLotw();
    }
  }

  function adifHeaderField(text, name) {
    const m = String(text).match(new RegExp(`<${name}:(\\d+)(?::[a-z])?>`, 'i'));
    if (!m) return '';
    const start = m.index + m[0].length;
    return text.slice(start, start + Number(m[1])).trim();
  }

  const modeGroup = mode => {
    const m = String(mode || '').toUpperCase();
    if (m === 'CW') return 'CW';
    if (['SSB', 'USB', 'LSB', 'AM', 'FM', 'PHONE'].includes(m)) return 'PHONE';
    return 'DATA';
  };

  /**
   * Our contact a LoTW record stands for: same call, band, date, mode group,
   * time within half an hour — and my callsign, unless `anyOfMine` (a file of
   * my own log, whatever callsign it files the contacts under).
   */
  function matchLotwRecord(rec, byCall, anyOfMine) {
    const list = byCall.get(normalizeCallsign(rec.call)) || [];
    const date = fromAdifDate(rec.qso_date);
    const band = String(rec.band || '').toLowerCase();
    const group = rec.app_lotw_modegroup ? rec.app_lotw_modegroup.toUpperCase() : modeGroup(rec.mode);
    const t = String(rec.time_on || '');
    const minutes = t.length >= 4 ? Number(t.slice(0, 2)) * 60 + Number(t.slice(2, 4)) : null;
    const own = normalizeCallsign(rec.station_callsign || '');
    return list.find(e => {
      if (e.date !== date || (e.band || '').toLowerCase() !== band || modeGroup(e.mode) !== group) return false;
      if (!anyOfMine && own && e.myCallsign && baseCallsign(e.myCallsign) !== baseCallsign(own)) return false;
      if (minutes === null) return true;
      const [h, m] = (e.time || '').split(':').map(Number);
      return Math.abs(h * 60 + m - minutes) <= 30;
    }) || null;
  }

  async function lotwReport(kind, since) {
    const res = await fetch('/api/lotw/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, since })
    });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.badLogin
        ? tr('LoTW did not accept the login or password', 'LoTW не принял логин или пароль')
        : data.network ? tr('no connection to LoTW', 'нет связи с LoTW') : (data.error || `HTTP ${res.status}`));
      err.badLogin = Boolean(data.badLogin);
      throw err;
    }
    return data.adif;
  }

  async function checkLotw() {
    if (lotwBusy) return;
    lotwBusy = true;
    renderLotw();
    setLotwStatus(tr('Asking LoTW…', 'Спрашиваю LoTW…'), 'pending');
    try {
      const byCall = new Map();
      entries.forEach(e => {
        if (!byCall.has(e.callsign)) byCall.set(e.callsign, []);
        byCall.get(e.callsign).push(e);
      });
      const touched = new Set();

      // What LoTW has from me: those are sent, whichever program sent them.
      const rxText = await lotwReport('rx', station.lotwLastRx || '1900-01-01');
      let newSent = 0;
      parseAdif(new TextEncoder().encode(rxText)).forEach(rec => {
        const qso = matchLotwRecord(rec, byCall);
        if (!qso || qso.lotwSent) return;
        qso.lotwSent = 'Y';
        qso.lotwSentDate = fromAdifDate(rec.app_lotw_rxqso) || nowUtcParts().date;
        touched.add(qso);
        newSent++;
      });

      // What has come back confirmed.
      const qslText = await lotwReport('qsl', station.lotwLastQsl || '1900-01-01');
      let newCfm = 0;
      let unmatched = 0;
      parseAdif(new TextEncoder().encode(qslText)).forEach(rec => {
        if (!/^[YV]$/i.test(rec.qsl_rcvd || '')) return;
        const qso = matchLotwRecord(rec, byCall);
        if (!qso) { unmatched++; return; }
        if (qso.lotwRcvd) return;
        qso.lotwRcvd = 'Y';
        qso.lotwRcvdDate = fromAdifDate(rec.qslrdate) || nowUtcParts().date;
        if (!qso.lotwSent) { qso.lotwSent = 'Y'; qso.lotwSentDate = qso.lotwSentDate || qso.lotwRcvdDate; }
        touched.add(qso);
        newCfm++;
      });

      for (const qso of touched) {
        qso.updatedAt = new Date().toISOString();
        await saveEntry(qso);
      }
      // Next time, only what's newer than this.
      const lastRx = adifHeaderField(rxText, 'APP_LoTW_LASTQSORX');
      const lastQsl = adifHeaderField(qslText, 'APP_LoTW_LASTQSL');
      if (lastRx) station.lotwLastRx = lastRx;
      if (lastQsl) station.lotwLastQsl = lastQsl;
      station.lotwChecked = new Date().toISOString();
      persistStation();
      render();

      serviceResult('lotw', true, tr('LoTW checked', 'LoTW проверен'), [
        [tr('New confirmations', 'Новых подтверждений'), newCfm],
        newSent ? [tr('Found in LoTW and marked sent', 'Нашлось в LoTW и отмечено отправленными'), newSent] : '',
        unmatched ? [tr('Confirmations for contacts not in this log', 'Подтверждений на связи, которых нет в журнале'), unmatched] : ''
      ]);
    } catch (err) {
      serviceResult('lotw', false, tr('Could not check', 'Не удалось проверить'), [err.message],
        err.badLogin ? { label: tr('CHANGE THE LOGIN', 'ИЗМЕНИТЬ ЛОГИН'), run: () => document.querySelector('[data-page="lotw-login"]').click() } : null);
    } finally {
      lotwBusy = false;
      renderLotw();
    }
  }

  async function saveLotwLogin() {
    const username = $('lotw-user').value.trim();
    const password = passwordValue($('lotw-pass'));
    const status = $('lotw-login-status');
    const savedFor = (lotwInfo && lotwInfo.login && lotwInfo.login.hasPassword && lotwInfo.login.username) || '';
    if (!username || (!password && username !== savedFor)) {
      paintStatus(status, tr('Both the login and the password, please', 'Нужны и логин, и пароль'), 'err');
      return;
    }
    paintStatus(status, tr('saving…', 'сохраняю…'), 'pending');
    try {
      const res = await fetch('/api/lotw/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      $('lotw-pass').value = '';
      paintStatus(status, '');
      await refreshLotwStatus();
      showSettingsPage('lotw', true);
      toast(tr('✓ LoTW login saved', '✓ Логин LoTW сохранён'));
    } catch (err) {
      paintStatus(status, tr(`Not saved: ${err.message}`, `Не сохранено: ${err.message}`), 'err');
    }
  }

  // ---------------------------------------------------------------------
  // eQSL
  //
  // The account is a callsign, so what goes from here is the contacts made
  // under that callsign (or none recorded) — same rule as LoTW's location.
  // Sending posts them in batches; eQSL says how many it took, and names
  // the ones it didn't (a duplicate — already there — counts as sent).
  // Checking downloads the cards received since last time and marks the
  // contacts they confirm.
  // ---------------------------------------------------------------------

  let eqslInfo = null;     // /api/eqsl/status: { login } — or { remote } / { offline }
  let eqslBusy = false;
  const EQSL_BATCH = 250;

  async function refreshEqslStatus() {
    try {
      const res = await fetch('/api/eqsl/status');
      eqslInfo = res.status === 403 ? { remote: true } : await res.json();
    } catch (e) {
      eqslInfo = { offline: true };
    }
    renderEqsl();
  }

  function eqslCall() {
    return (eqslInfo && eqslInfo.login && eqslInfo.login.username) || '';
  }

  function eqslSendable(qso, call) {
    if (qso.eqslSent || !call) return false;
    if (!qso.myCallsign || baseCallsign(qso.myCallsign) !== baseCallsign(call)) return false;
    return Boolean(qso.callsign && qso.band && qso.mode && qso.date && qso.time);
  }

  function eqslPending() {
    const call = eqslCall();
    return entries.filter(e => eqslSendable(e, call));
  }

  function renderEqsl() {
    const { sent, cfm } = qslCounts('eqsl');
    const call = eqslCall();
    const pending = eqslPending().length;
    $('eqsl-summary').textContent = tr(
      `Sent ${sent} · confirmed ${cfm}${call ? ` · waiting to go ${pending}` : ''}`,
      `Отправлено ${sent} · подтверждено ${cfm}${call ? ` · ждут отправки ${pending}` : ''}`);

    const info = eqslInfo || {};
    const login = info.login || {};
    $('eqsl-login-desc').textContent = info.remote
      ? tr('Only on the computer the program runs on', 'Только на компьютере, где работает программа')
      : login.username
        ? tr(`${login.username}${login.qth ? ` · QTH «${login.qth}»` : ''} · the password is kept on this computer only`,
          `${login.username}${login.qth ? ` · QTH «${login.qth}»` : ''} · пароль хранится только на этом компьютере`)
        : tr('not set', 'не задан');

    $('eqsl-send-count').textContent = pending;
    $('eqsl-send').disabled = eqslBusy || eqslCards.running || !call || !pending;
    // While the pictures are coming, the same button is the way to stop them —
    // the page gains nothing new for it.
    $('eqsl-check').disabled = eqslBusy || !call;
    const checkBtn = $('eqsl-check');
    // Both spellings are kept on the button, so a switch of language while it
    // runs doesn't put "check confirmations" back on a button that stops.
    checkBtn.setAttribute('data-ru', eqslCards.running ? 'ОСТАНОВИТЬ' : 'ПРОВЕРИТЬ ПОДТВЕРЖДЕНИЯ');
    checkBtn.setAttribute('data-en', eqslCards.running ? 'STOP' : 'CHECK CONFIRMATIONS');
    checkBtn.textContent = tr(eqslCards.running ? 'STOP' : 'CHECK CONFIRMATIONS',
      eqslCards.running ? 'ОСТАНОВИТЬ' : 'ПРОВЕРИТЬ ПОДТВЕРЖДЕНИЯ');

    renderQueueNote($('eqsl-queue-note'), 'eqsl', call ? baseCallsign(call) : '', pending, { en: 'in eQSL', ru: 'в eQSL' });
    $('eqsl-other-note').hidden = !call;
    if (call) {
      const base = baseCallsign(call);
      $('eqsl-other-note').textContent = tr(
        `What goes is the contacts made as ${base} — /P, /M and /QRP included, under ${base}, as always.`,
        `Уходят связи позывного ${base} — вместе с /P, /M и /QRP, под ${base}, как всегда.`);
    }
    if (!$('eqsl-status').textContent && station.eqslChecked) {
      paintStatus($('eqsl-status'), lotwCheckedText('eqsl'), '');
    }
  }

  function setEqslStatus(text, kind) {
    if (text && kind !== 'pending') console.info(`[eqsl] ${text}`);
    paintStatus($('eqsl-status'), text, kind);
  }

  function buildEqslAdif(list) {
    const header = 'Contacts for eQSL, from R2FEL HamLog\n' + adifField('ADIF_VER', '3.1.4') + adifField('PROGRAMID', 'R2FEL-HamLog') + '\n<EOH>\n';
    return header + list.map(qso => [
      adifField('CALL', qso.callsign),
      adifField('QSO_DATE', adifDate(qso.date)),
      adifField('TIME_ON', (qso.time || '').replace(':', '')),
      adifField('BAND', (qso.band || '').toUpperCase()),
      qso.freqHz ? adifField('FREQ', (qso.freqHz / 1e6).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')) : '',
      adifModeFields(qso.mode),
      adifField('RST_SENT', qso.rstSent)
    ].join('') + '<EOR>\n').join('');
  }

  async function eqslPost(url, payload) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.badLogin
        ? tr('eQSL did not accept the login or password', 'eQSL не принял логин или пароль')
        : data.network ? tr('no connection to eQSL', 'нет связи с eQSL') : (data.error || `HTTP ${res.status}`));
      err.badLogin = Boolean(data.badLogin);
      throw err;
    }
    return data;
  }

  async function sendToEqsl() {
    const list = eqslPending().slice().sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    if (!list.length || eqslBusy) return;

    eqslBusy = true;
    renderEqsl();
    let added = 0;
    let already = 0;
    let marked = 0;
    const refused = [];
    try {
      for (let i = 0; i < list.length; i += EQSL_BATCH) {
        const batch = list.slice(i, i + EQSL_BATCH);
        setEqslStatus(tr(`Sending to eQSL: ${Math.min(i + batch.length, list.length)} of ${list.length}…`,
          `Отправляю в eQSL: ${Math.min(i + batch.length, list.length)} из ${list.length}…`), 'pending');
        const data = await eqslPost('/api/eqsl/upload', { adif: buildEqslAdif(batch) });
        added += data.added;
        already += data.duplicates;

        // A warning that isn't "duplicate" is a contact eQSL didn't take; it
        // names the date, and usually the callsign. Those stay unsent.
        const bad = (data.warnings || []).filter(w => !/duplicate/i.test(w));
        const badQsos = new Set();
        bad.forEach(w => {
          const text = w.toUpperCase();
          batch.forEach(q => { if (text.includes(q.callsign)) badQsos.add(q); });
        });
        const sureOfAll = data.added + data.duplicates >= batch.length;
        const unnamed = bad.length > badQsos.size;
        const today = nowUtcParts().date;
        for (const qso of batch) {
          if (badQsos.has(qso) || (!sureOfAll && unnamed)) continue;
          qso.eqslSent = 'Y';
          qso.eqslSentDate = today;
          await saveEntry(qso);
          marked++;
        }
        badQsos.forEach(q => refused.push(q.callsign));
        if (!sureOfAll && unnamed) refused.push(tr('some unnamed', 'без позывного'));
      }
      render();
      serviceResult('eqsl', !refused.length || added > 0,
        refused.length ? tr('Sent, but not all of it', 'Отправлено, но не всё') : tr('Sent to eQSL', 'Отправлено в eQSL'), [
          [tr('Sent', 'Отправлено'), `${added} QSO`],
          already ? [tr('Already there', 'Уже были там'), already] : '',
          refused.length ? tr(`Not taken: ${refused.join(', ')} — details in the debug log.`, `Не приняты: ${refused.join(', ')} — подробности в журнале отладки.`) : ''
        ]);
    } catch (err) {
      render();
      serviceResult('eqsl', false, tr('Not sent', 'Не отправлено'), [err.message],
        err.badLogin ? { label: tr('CHANGE THE LOGIN', 'ИЗМЕНИТЬ ЛОГИН'), run: () => document.querySelector('[data-page="eqsl-login"]').click() } : null);
    } finally {
      eqslBusy = false;
      renderEqsl();
    }
  }

  async function checkEqsl() {
    if (eqslBusy) return;
    eqslBusy = true;
    renderEqsl();
    setEqslStatus(tr('Asking eQSL…', 'Спрашиваю eQSL…'), 'pending');
    try {
      const startedAt = new Date();
      const data = await eqslPost('/api/eqsl/inbox', { since: station.eqslLastRcvd || '190001010000' });
      const byCall = new Map();
      entries.forEach(e => {
        if (!byCall.has(e.callsign)) byCall.set(e.callsign, []);
        byCall.get(e.callsign).push(e);
      });
      let newCfm = 0;
      let unmatched = 0;
      const records = data.adif ? parseAdif(new TextEncoder().encode(data.adif)) : [];
      for (const rec of records) {
        const qso = matchLotwRecord(rec, byCall);
        if (!qso) { unmatched++; continue; }
        if (qso.eqslRcvd) continue;
        qso.eqslRcvd = 'Y';
        qso.eqslRcvdDate = fromAdifDate(rec.eqsl_qslrdate || rec.qslrdate) || nowUtcParts().date;
        qso.updatedAt = new Date().toISOString();
        await saveEntry(qso);
        newCfm++;
      }
      // Next time, only cards received after this check began.
      const u = startedAt;
      station.eqslLastRcvd = `${u.getUTCFullYear()}${pad(u.getUTCMonth() + 1)}${pad(u.getUTCDate())}${pad(u.getUTCHours())}${pad(u.getUTCMinutes())}`;
      station.eqslChecked = new Date().toISOString();
      persistStation();
      render();
      // A check is also the moment to try again for the pictures eQSL had
      // none of last time — it may have them now.
      for (const qso of entries) {
        if (qso.eqslCardNone) { delete qso.eqslCardNone; await saveEntry(qso); }
      }
      const wanted = eqslCardsWanted().length;
      serviceResult('eqsl', true, tr('eQSL inbox checked', 'Входящие eQSL проверены'), [
        [tr('New cards', 'Новых карточек'), newCfm],
        unmatched ? [tr('Cards for contacts not in this log', 'Карточек на связи, которых нет в журнале'), unmatched] : '',
        wanted ? tr(`Fetching ${wanted} card picture(s) — eQSL gives one every 11 seconds, so about ${Math.ceil(wanted * 11 / 60)} min. It carries on in the background; the eQSL page shows how far it has got.`,
          `Качаю картинки карточек: ${wanted} — eQSL отдаёт по одной раз в 11 секунд, это примерно ${Math.ceil(wanted * 11 / 60)} мин. Идёт в фоне, на странице eQSL видно, сколько уже.`) : ''
      ]);
    } catch (err) {
      serviceResult('eqsl', false, tr('Could not check', 'Не удалось проверить'), [err.message],
        err.badLogin ? { label: tr('CHANGE THE LOGIN', 'ИЗМЕНИТЬ ЛОГИН'), run: () => document.querySelector('[data-page="eqsl-login"]').click() } : null);
    } finally {
      eqslBusy = false;
      renderEqsl();
      fetchEqslCards();          // in the background; the page can be closed
    }
  }

  // ---------------------------------------------------------------------
  // The cards themselves
  //
  // A confirmation sets the green "e"; the picture behind it used to arrive
  // only when that "e" was clicked, one contact at a time. Checking for
  // confirmations now fetches them too, so the card is simply there when the
  // log is opened. No switch for it: whoever pressed "check confirmations"
  // wants the cards as well.
  //
  // eQSL asks for fewer than six requests a minute; server.js already queues
  // them one every eleven seconds, so this only has to ask. Anything already
  // on disk is never asked for again, and a contact eQSL has no picture for
  // is remembered so the next run doesn't waste its turn on it — until the
  // next check, which tries those once more.
  // ---------------------------------------------------------------------

  let eqslCards = { running: false, stop: false, done: 0, total: 0 };

  /** Confirmed, no picture yet, and eQSL has enough to find it by. */
  function eqslCardsWanted() {
    return entries.filter(e => e.eqslRcvd && !e.eqslCardFile && !e.eqslCardNone &&
      e.callsign && e.band && e.mode && e.date && e.time);
  }

  function stopEqslCards() {
    eqslCards.stop = true;
    setEqslStatus(tr('Stopping…', 'Останавливаю…'), 'pending');
  }

  async function fetchEqslCards() {
    if (eqslCards.running) return;
    const todo = eqslCardsWanted();
    if (!todo.length) return;

    eqslCards = { running: true, stop: false, done: 0, total: todo.length };
    renderEqsl();
    let missing = 0;

    for (const qso of todo) {
      if (eqslCards.stop) break;
      setEqslStatus(tr(`Card pictures: ${eqslCards.done} of ${eqslCards.total}`,
        `Картинки карточек: ${eqslCards.done} из ${eqslCards.total}`), 'pending');
      try {
        const res = await fetch('/api/eqsl/card', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ call: qso.callsign, date: qso.date, time: qso.time, band: qso.band, mode: qso.mode })
        });
        const data = await res.json();
        if (res.ok && data.file) {
          qso.eqslCardFile = data.file;
          delete qso.eqslCardNone;
          await saveEntry(qso);
          eqslCards.done++;
        } else if (data.notFound) {
          // eQSL keeps no picture for this one (their time or mode differs
          // from ours). Remembered, so the queue moves on.
          qso.eqslCardNone = true;
          await saveEntry(qso);
          missing++;
        } else if (data.needsLogin || data.badLogin) {
          setEqslStatus(tr('The eQSL login isn\'t accepted — pictures stopped', 'Логин eQSL не принят — картинки не качаются'), 'err');
          break;
        }
      } catch (e) {
        setEqslStatus(tr('eQSL is not answering — pictures stopped', 'eQSL не отвечает — картинки не качаются'), 'err');
        break;
      }
    }

    const stopped = eqslCards.stop;
    const { done, total } = eqslCards;
    eqslCards = { running: false, stop: false, done: 0, total: 0 };
    render();
    renderEqsl();
    if (done || missing) {
      setEqslStatus((stopped ? tr('Stopped. ', 'Остановлено. ') : '') +
        tr(`Card pictures: ${done} of ${total}`, `Картинки карточек: ${done} из ${total}`) +
        (missing ? tr(` · ${missing} eQSL has no picture for`, ` · у ${missing} eQSL картинки нет`) : ''), done ? 'ok' : '');
      console.info(`[eqsl] cards: ${done} fetched of ${total}${missing ? `, ${missing} without a picture` : ''}${stopped ? ', stopped' : ''}`);
    }
  }

  async function saveEqslLogin() {
    const username = $('eqsl-user').value.trim();
    const password = passwordValue($('eqsl-pass'));
    const qth = $('eqsl-qth').value.trim();
    const status = $('eqsl-login-status');
    const savedFor = (eqslInfo && eqslInfo.login && eqslInfo.login.hasPassword && eqslInfo.login.username) || '';
    if (!username || (!password && username.toUpperCase() !== savedFor.toUpperCase())) {
      paintStatus(status, tr('Both the login and the password, please', 'Нужны и логин, и пароль'), 'err');
      return;
    }
    paintStatus(status, tr('saving…', 'сохраняю…'), 'pending');
    try {
      await eqslPost('/api/eqsl/login', { username, password, qth });
      $('eqsl-pass').value = '';
      paintStatus(status, '');
      await refreshEqslStatus();
      showSettingsPage('eqsl', true);
      toast(tr('✓ eQSL login saved', '✓ Логин eQSL сохранён'));
    } catch (err) {
      paintStatus(status, tr(`Not saved: ${err.message}`, `Не сохранено: ${err.message}`), 'err');
    }
  }

  // ---------------------------------------------------------------------
  // HAMLOG
  //
  // hamlog.online takes nothing from programs directly yet (its API is "in
  // development"), so both ways go by file. Out: the contacts not on HAMLOG
  // yet — those made under MY CALLSIGN — in windows-1251 like HAMLOG's own
  // files, for its Upload ADIF page; a saved file marks them sent. Back: the
  // file its Download ADIF gives, where every record says when it was
  // uploaded and whether an HQSL confirms it. Only those marks come from it;
  // it adds no contacts (Import is for that).
  // ---------------------------------------------------------------------

  const HAMLOG_SITE = 'https://hamlog.online/account/calls.php';
  let hamlogBusy = false;

  function hamlogSendable(qso, call) {
    if (qso.hamlogSent || !call) return false;
    if (!qso.myCallsign || baseCallsign(qso.myCallsign) !== call) return false;
    return Boolean(qso.callsign && qso.band && qso.mode && qso.date && qso.time);
  }

  function hamlogPending() {
    const call = baseCallsign(currentMyCall());
    return entries.filter(e => hamlogSendable(e, call));
  }

  function renderHamlog() {
    const { sent, cfm } = qslCounts('hamlog');
    const call = baseCallsign(currentMyCall());
    const pending = hamlogPending().length;
    $('hamlog-summary').textContent = tr(
      `Sent ${sent} · confirmed ${cfm}${call ? ` · waiting to go ${pending}` : ''}`,
      `Отправлено ${sent} · подтверждено ${cfm}${call ? ` · ждут отправки ${pending}` : ''}`);
    $('hamlog-save-count').textContent = pending;
    $('hamlog-save').disabled = hamlogBusy || !pending;
    $('hamlog-read').disabled = hamlogBusy;
    renderQueueNote($('hamlog-queue-note'), 'hamlog', call, pending, { en: 'on HAMLOG', ru: 'на HAMLOG' });
    $('hamlog-other-note').textContent = call
      ? tr(`The file takes the contacts made as ${call} — /P, /M and /QRP included, under ${call}.`,
        `В файл идут связи позывного ${call} — вместе с /P, /M и /QRP, под ${call}.`)
      : tr('Fill in MY CALLSIGN first — the file takes the contacts made under it.',
        'Сначала впишите MY CALLSIGN — в файл идут связи, сделанные под ним.');
    if (!$('hamlog-status').textContent && station.hamlogChecked) {
      paintStatus($('hamlog-status'), lotwCheckedText('hamlog'), '');
    }
  }

  function setHamlogStatus(text, kind) {
    if (text && kind !== 'pending') console.info(`[hamlog] ${text}`);
    paintStatus($('hamlog-status'), text, kind);
  }

  /** An ADIF field for a windows-1251 file: length in its one-byte letters, anything it lacks as '?'. */
  function cp1251Field(name, value) {
    if (value === null || value === undefined || value === '') return '';
    const table = cp1251Table();
    const text = [...String(value)].map(ch => (ch.charCodeAt(0) < 0x80 || table.has(ch) ? ch : '?')).join('');
    return `<${name}:${text.length}>${text} `;
  }

  function encodeCp1251(text) {
    const table = cp1251Table();
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      out[i] = code < 0x80 ? code : (table.get(text[i]) || 0x3f);
    }
    return out;
  }

  /** The fields HAMLOG's own files carry; my RDA goes in MY_CNTY, where HAMLOG keeps it. */
  function buildHamlogAdif(list, call) {
    const header = 'Contacts for HAMLOG, from R2FEL HamLog\n' + cp1251Field('ADIF_VER', '3.1.4') + cp1251Field('PROGRAMID', 'R2FEL-HamLog') + '\n<EOH>\n';
    return header + list.map(qso => [
      cp1251Field('STATION_CALLSIGN', call),
      cp1251Field('OPERATOR', call),
      cp1251Field('CALL', qso.callsign),
      cp1251Field('QSO_DATE', adifDate(qso.date)),
      cp1251Field('TIME_ON', (qso.time || '').replace(':', '')),
      cp1251Field('BAND', (qso.band || '').toUpperCase()),
      qso.freqHz ? cp1251Field('FREQ', (qso.freqHz / 1e6).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')) : '',
      cp1251Field('MODE', qso.mode),
      cp1251Field('RST_SENT', qso.rstSent),
      cp1251Field('RST_RCVD', qso.rstRcvd),
      cp1251Field('STX', serialNumber(qso.nrSent)),
      cp1251Field('SRX', serialNumber(qso.nrRcvd)),
      cp1251Field('NAME', qso.name),
      cp1251Field('QTH', qso.qth),
      cp1251Field('GRIDSQUARE', qso.grid),
      cp1251Field('MY_CNTY', qso.myRda),
      cp1251Field('MY_GRIDSQUARE', extractGrid(qso.myQth)),
      cp1251Field('COMMENT', qso.notes)
    ].join('') + '<EOR>\n').join('');
  }

  async function saveHamlogFile() {
    const call = baseCallsign(currentMyCall());
    const list = hamlogPending().slice().sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    if (!list.length || hamlogBusy) return;
    const name = `HAMLOG-${call.replace(/\//g, '_')}-${nowUtcParts().date}.adi`;
    const bytes = encodeCp1251(buildHamlogAdif(list, call));

    hamlogBusy = true;
    renderHamlog();
    try {
      // The app asks where, and says whether it was saved; a browser just downloads.
      let where = '';
      if (window.desktopApp && window.desktopApp.saveFile) {
        where = await window.desktopApp.saveFile(name, bytes);
        if (!where) {
          setHamlogStatus('');   // cancelled: nothing saved, nothing marked
          return;
        }
      } else {
        download(name, bytes, 'text/plain;charset=windows-1251');
      }
      const today = nowUtcParts().date;
      for (const qso of list) {
        qso.hamlogSent = 'Y';
        qso.hamlogSentDate = today;
        await saveEntry(qso);
      }
      render();
      serviceResult('hamlog', true, tr('The file for HAMLOG is saved', 'Файл для HAMLOG сохранён'), [
        [tr('Contacts in it', 'Связей в нём'), `${list.length} QSO`],
        tr(`Now upload it on HAMLOG: My calls → ${call} → Upload ADIF.`, `Теперь загрузите его на HAMLOG: «Мои позывные» → ${call} → «Загрузить ADIF».`)
      ], { label: tr('OPEN HAMLOG', 'ОТКРЫТЬ HAMLOG'), run: () => window.open(HAMLOG_SITE, '_blank', 'noopener') }, where);
    } catch (err) {
      serviceResult('hamlog', false, tr('Not saved', 'Не сохранено'), [err.message]);
    } finally {
      hamlogBusy = false;
      renderHamlog();
    }
  }

  async function readHamlogFile(file) {
    if (hamlogBusy) return;
    hamlogBusy = true;
    renderHamlog();
    setHamlogStatus(tr('reading…', 'читаю…'), 'pending');
    try {
      const records = parseAdif(new Uint8Array(await file.arrayBuffer()))
        .filter(rec => rec.app_hamlog_qso_upload_date || rec.app_hamlog_qso_cfm);
      if (!records.length) {
        throw new Error(tr("it isn't one from HAMLOG's Download ADIF", 'это не файл из «Скачать ADIF» на HAMLOG'));
      }
      const byCall = new Map();
      entries.forEach(e => {
        if (!byCall.has(e.callsign)) byCall.set(e.callsign, []);
        byCall.get(e.callsign).push(e);
      });
      let newSent = 0;
      let newCfm = 0;
      let unmatched = 0;
      for (const rec of records) {
        const qso = matchLotwRecord(rec, byCall, true);
        if (!qso) { unmatched++; continue; }
        let changed = false;
        if (!qso.hamlogSent) {
          qso.hamlogSent = 'Y';
          qso.hamlogSentDate = fromAdifDate(rec.app_hamlog_qso_upload_date);
          newSent++;
          changed = true;
        }
        if (/^[YV]$/i.test(rec.app_hamlog_qso_cfm || '') && !qso.hamlogRcvd) {
          qso.hamlogRcvd = 'Y';
          newCfm++;
          changed = true;
        }
        if (changed) {
          qso.updatedAt = new Date().toISOString();
          await saveEntry(qso);
        }
      }
      station.hamlogChecked = new Date().toISOString();
      persistStation();
      render();
      serviceResult('hamlog', true, tr('HAMLOG file read', 'Файл HAMLOG прочитан'), [
        [tr('In the file', 'В файле'), `${records.length} QSO`],
        [tr('Newly marked as on HAMLOG', 'Отмечены как отправленные'), newSent],
        [tr('New HQSL confirmations', 'Новых подтверждений HQSL'), newCfm],
        unmatched ? tr(`Not in this log: ${unmatched} — Import ADIF adds those.`, `Нет в этом журнале: ${unmatched} — их добавляет «Импорт ADIF».`) : ''
      ]);
    } catch (err) {
      serviceResult('hamlog', false, tr('Could not read that file', 'Не удалось прочитать файл'), [err.message]);
    } finally {
      hamlogBusy = false;
      renderHamlog();
    }
  }

  // ---------------------------------------------------------------------
  // QSL cards by e-mail
  //
  // The operator's card, with a contact's details written into it, sent to
  // the other station from his own mailbox — one at a time, by hand, from the
  // ✉ mark in the log. The card is either his own picture, with a layout
  // saying where each detail goes on it, or the program's own card (dark or
  // light) drawn from his details. The page draws it; server.js sends it.
  // ---------------------------------------------------------------------

  // Layouts of operators' own card pictures, found by the picture's
  // fingerprint (SHA-256): a picture nobody has laid out gets the program's
  // card instead, for now. Numbers are the picture's own pixels. `label`
  // boxes are printed-style white text, their top and bottom the capitals'
  // top and the baseline; `ink` boxes are table cells, the value typed into
  // the middle. The rings go round PSE QSL or TNX QSL.
  const CARD_LAYOUTS = {
    // R2FEL, Kaliningrad — measured off the picture, approved 15.09.2026.
    '9a9cbbd1cf86a7276c34e752374cfd0ee6044a7c6a9d4b4be189735acc17b1c2': {
      call: 'R2FEL',
      boxes: [
        { field: 'myRda', style: 'label', x0: 124, y0: 88, x1: 330, y1: 114, align: 'left' },
        { field: 'myGrid', style: 'label', x0: 1379, y0: 41, x1: 1491, y1: 67, align: 'right' },
        { field: 'call', style: 'ink', x0: 473, y0: 839, x1: 736, y1: 893, size: 43 },
        { field: 'utc', style: 'ink', x0: 737, y0: 839, x1: 914, y1: 893, size: 36 },
        { field: 'band', style: 'ink', x0: 915, y0: 839, x1: 1043, y1: 893, size: 36 },
        { field: 'mode', style: 'ink', x0: 1043, y0: 839, x1: 1194, y1: 893, size: 36 },
        { field: 'rst', style: 'ink', x0: 1195, y0: 839, x1: 1349, y1: 893, size: 38 }
      ],
      pse: [550, 924, 680, 958],
      tnx: [1206, 924, 1344, 957]
    }
  };

  const CARD_INK = '#23201c';
  const CARD_RING = '#e8a23d';
  const CARD_TYPE = "'Special Elite', 'Courier New', monospace";
  const CARD_LABEL = "'Roboto Condensed', 'Barlow Condensed', sans-serif";

  let cardPicture = null;   // { sha256, img } — the operator's own picture, if he gave one
  let mailInfo = null;      // /api/mail/status: { address, host, hasPassword } — or { remote } / { offline }
  let cardLogo = null;

  function cardSettings() {
    station.card = Object.assign({ kind: 'dark', me: {}, subject: '', textRu: '', textEn: '' }, station.card || {});
    return station.card;
  }

  async function refreshCardStatus() {
    try {
      const res = await fetch('/api/card/status');
      if (res.status === 403) { cardPicture = null; return; }
      const data = await res.json();
      if (!data.image) { cardPicture = null; return; }
      if (cardPicture && cardPicture.sha256 === data.image.sha256) return;
      const img = new Image();
      img.src = `/api/card/image?v=${data.image.sha256.slice(0, 12)}`;
      await img.decode();
      cardPicture = { sha256: data.image.sha256, img };
    } catch (e) {
      cardPicture = null;
    }
  }

  async function refreshMailStatus() {
    try {
      const res = await fetch('/api/mail/status');
      mailInfo = res.status === 403 ? { remote: true } : (await res.json()).mail;
    } catch (e) {
      mailInfo = { offline: true };
    }
  }

  /**
   * The layout for the operator's picture. Two can exist: the one measured off
   * R2FEL's own card (kept in the code, and used only for contacts made under
   * the callsign printed on it), and one the operator placed themselves in the
   * editor — that one is their own card, whatever callsign the contact was
   * made under, so it carries no such restriction. Both are keyed by the
   * picture's fingerprint, so changing the picture and changing back keeps
   * whichever belongs to it.
   */
  function cardLayoutFor(qso) {
    const card = cardSettings();
    if (card.kind !== 'image' || !cardPicture) return null;
    const built = CARD_LAYOUTS[cardPicture.sha256];
    if (built) return baseCallsign(qso.myCallsign) === built.call ? built : null;

    // Своя размеченная картинка — это бумажная карточка одного позывного:
    // он на ней напечатан. Связь под другим своим позывным такой карточкой
    // не подтверждают — уйдёт карточка программы, где позывной берётся из
    // самой связи. Разметка без позывного — из версии, где его ещё не
    // записывали: считаем её своей, пока владелец позывной не сменил.
    const mine = (station.cardLayouts || {})[cardPicture.sha256] || null;
    if (!mine) return null;
    const on = baseCallsign(qso.myCallsign);
    if (mine.call && on && mine.call !== on) return null;
    return mine;
  }

  /**
   * Почему в окне отправки не та карточка, которую человек размечал —
   * сказано прямо, до нажатия «отправить».
   */
  function cardSendCardNote(qso) {
    const card = cardSettings();
    if (!qso || card.kind !== 'image' || !cardPicture) return '';
    const built = CARD_LAYOUTS[cardPicture.sha256];
    const mine = (station.cardLayouts || {})[cardPicture.sha256];
    const owner = (built && built.call) || (mine && mine.call) || '';
    const on = baseCallsign(qso.myCallsign);
    if (!owner || !on || owner === on) return '';
    return tr(
      `This contact was made as ${qso.myCallsign}, and the picture is ${owner}'s card — the program's own card is going instead.`,
      `Связь под позывным ${qso.myCallsign}, а картинка — карточка ${owner}: вместо неё уйдёт карточка программы.`);
  }

  /** Whether this picture has any layout at all — the settings page says so. */
  function cardPictureLaidOut() {
    if (!cardPicture) return false;
    return Boolean(CARD_LAYOUTS[cardPicture.sha256] || (station.cardLayouts || {})[cardPicture.sha256]);
  }

  /** What goes on the card, as it will read there. */
  function cardValues(qso) {
    return {
      call: qso.callsign,
      utc: `${formatDateHuman(qso.date)} ${qso.time}`,
      date: formatDateHuman(qso.date),
      time: qso.time,
      band: qso.band || '',
      mode: qso.mode || '',
      rst: qso.rstSent || '',
      myRda: qso.myRda || '',
      myGrid: extractGrid(qso.myQth) || '',
      myCall: qso.myCallsign || currentMyCall()
    };
  }

  /** Whether their confirmation has come (any service): TNX QSL; otherwise PSE QSL. */
  function cardThanks(qso) {
    return Boolean(qso.lotwRcvd || qso.eqslRcvd || qso.hamlogRcvd);
  }

  async function cardFontsReady() {
    await Promise.all(['400 36px "Special Elite"', '700 36px "Roboto Condensed"', '900 200px "Roboto Condensed"', 'italic 700 40px "Roboto Condensed"']
      .map(f => document.fonts.load(f, 'R2FEL 0123456789 QSL').catch(() => null)));
    if (!cardLogo) {
      cardLogo = new Image();
      cardLogo.src = 'icons/app-icon.png';
      await cardLogo.decode().catch(() => null);
    }
  }

  /** Text shrunk until it fits `maxW` at most `size`; returns the size used. */
  function cardFit(g, text, font, size, maxW) {
    let s = size;
    for (; s > 8; s--) {
      g.font = font.replace('{s}', s);
      if (g.measureText(text).width <= maxW) break;
    }
    return s;
  }

  /** Letters centred on (cx, cy) by their ink, not by the font's box. */
  function cardCentred(g, text, cx, cy) {
    g.textAlign = 'left';   // before measuring: the box is measured from the alignment point
    const m = g.measureText(text);
    g.fillText(text, cx - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2,
      cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  }

  function cardRing(g, box, color) {
    if (!box) return;            // a layout where that ring was never placed
    const [x0, y0, x1, y1] = box;
    g.save();
    g.strokeStyle = color; g.lineWidth = 5; g.lineCap = 'round';
    g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 4;
    g.beginPath();
    g.ellipse((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2 + 22, (y1 - y0) / 2 + 13, -0.04, 0.2, Math.PI * 2 + 0.42);
    g.stroke();
    g.restore();
  }

  function drawPictureCard(g, qso, layout, thanks) {
    const img = cardPicture.img;
    g.canvas.width = img.naturalWidth;
    g.canvas.height = img.naturalHeight;
    g.drawImage(img, 0, 0);
    const v = cardValues(qso);
    layout.boxes.forEach(b => {
      const text = v[b.field];
      if (!text) return;
      const w = b.x1 - b.x0;
      const h = b.y1 - b.y0;
      if (b.style === 'label') {
        // Capitals as tall as the box — the height of the printed labels.
        cardFit(g, text, `700 {s}px ${CARD_LABEL}`, Math.round(h / 0.711), w);
        const tw = g.measureText(text).width;
        g.save();
        if (layout.ink === 'dark') {
          g.fillStyle = CARD_INK;
        } else {
          g.fillStyle = '#fff'; g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = 6; g.shadowOffsetY = 2;
        }
        g.textAlign = 'left';
        const x = b.align === 'right' ? b.x1 - tw
          : b.align === 'center' ? b.x0 + (w - tw) / 2
            : b.x0;
        g.fillText(text, x, b.y1);
        g.restore();
        return;
      }
      g.fillStyle = CARD_INK;
      const cx = (b.x0 + b.x1) / 2;
      const cy = (b.y0 + b.y1) / 2;
      if (b.field === 'utc') {
        // Date over time: the cell is too narrow for both on one line.
        cardFit(g, v.date, `400 {s}px ${CARD_TYPE}`, Math.round(b.size * 0.62), w - 24);
        cardCentred(g, v.date, cx, cy - h * 0.24);
        cardFit(g, v.time, `400 {s}px ${CARD_TYPE}`, Math.round(b.size * 0.8), w - 24);
        cardCentred(g, v.time, cx, cy + h * 0.24);
        return;
      }
      cardFit(g, text, `400 {s}px ${CARD_TYPE}`, b.size || 36, w - 24);
      cardCentred(g, text, cx, cy);
    });
    cardRing(g, thanks ? layout.tnx : layout.pse, CARD_RING);
  }

  /** The program's own card, dark or light, from the operator's details. */
  function drawProgramCard(g, qso, theme, thanks) {
    const W = 1536;
    const H = 1024;
    g.canvas.width = W;
    g.canvas.height = H;
    const dark = theme !== 'light';
    const C = dark
      ? { bg0: '#2b2821', bg1: '#12110e', text: '#ece7d8', dim: '#9c9587', accent: '#e8a23d', call: '#ece7d8', waves: 'rgba(232,162,61,0.07)', cell: '#f1e9d8', line: '#3b3528', label: '#5b5344' }
      : { bg0: '#f6efdf', bg1: '#e3d6bb', text: '#2a261f', dim: '#7a705f', accent: '#b8741c', call: '#1d2a55', waves: 'rgba(184,116,28,0.10)', cell: '#fffaf0', line: '#8c7d63', label: '#6b604e' };
    const me = cardSettings().me || {};
    const v = cardValues(qso);
    const text = (t, x, y, font, color, align = 'left') => { g.font = font; g.fillStyle = color; g.textAlign = align; g.fillText(t, x, y); };

    const bg = g.createRadialGradient(W * 0.55, H * 0.42, 80, W * 0.5, H * 0.5, W * 0.75);
    bg.addColorStop(0, C.bg0);
    bg.addColorStop(1, C.bg1);
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    // The waves of the program's icon, spreading from a corner.
    g.strokeStyle = C.waves; g.lineCap = 'round'; g.lineWidth = 26;
    for (let r = 120; r < 1500; r += 90) { g.beginPath(); g.arc(150, 900, r, -Math.PI / 2, 0); g.stroke(); }
    g.strokeStyle = C.accent; g.lineWidth = 4; g.strokeRect(28, 28, W - 56, H - 56);
    g.lineWidth = 1.5; g.strokeRect(40, 40, W - 80, H - 80);

    if (me.country) text(me.country.toUpperCase(), 80, 110, `700 34px ${CARD_LABEL}`, C.accent);
    const zones = [me.cq && `CQ ${me.cq}`, me.itu && `ITU ${me.itu}`].filter(Boolean).join('  ·  ');
    if (zones) text(zones, W - 80, 110, `700 34px ${CARD_LABEL}`, C.accent, 'right');

    g.save();
    g.shadowColor = dark ? 'rgba(0,0,0,.6)' : 'rgba(0,0,0,.15)'; g.shadowBlur = 18; g.shadowOffsetY = 6;
    const callSize = cardFit(g, v.myCall, `900 {s}px ${CARD_LABEL}`, 250, W - 240);
    text(v.myCall, W / 2, 380, `900 ${callSize}px ${CARD_LABEL}`, C.call, 'center');
    g.restore();
    g.fillStyle = C.accent;
    g.fillRect(W / 2 - 330, 410, 660, 6);
    if (me.name) text(me.name, W / 2, 485, `700 52px ${CARD_LABEL}`, C.text, 'center');
    const place = [me.qth, v.myGrid && `GRID ${v.myGrid}`, v.myRda && `RDA ${v.myRda}`].filter(Boolean).join('  ·  ');
    if (place) text(place, W / 2, 545, `400 38px ${CARD_LABEL}`, C.dim, 'center');

    const cols = [['TO RADIO', 300, v.call], ['DATE', 200, v.date], ['UTC', 130, v.time], ['BAND', 150, v.band], ['MODE', 150, v.mode], ['RST', 120, v.rst]];
    const tw = cols.reduce((sum, c) => sum + c[1], 0);
    const tx = (W - tw) / 2;
    const ty = 640;
    const rh = 56;
    g.fillStyle = C.cell; g.fillRect(tx, ty, tw, rh * 2);
    g.strokeStyle = C.line; g.lineWidth = 2; g.strokeRect(tx, ty, tw, rh * 2);
    g.beginPath(); g.moveTo(tx, ty + rh); g.lineTo(tx + tw, ty + rh); g.stroke();
    let x = tx;
    cols.forEach(([label, w, value], i) => {
      if (i) { g.beginPath(); g.moveTo(x, ty); g.lineTo(x, ty + rh * 2); g.stroke(); }
      text(label, x + w / 2, ty + 38, `700 28px ${CARD_LABEL}`, C.label, 'center');
      g.fillStyle = CARD_INK;
      cardFit(g, value, `400 {s}px ${CARD_TYPE}`, i ? 32 : 38, w - 16);
      cardCentred(g, value, x + w / 2, ty + rh * 1.5);
      x += w;
    });

    const yq = 830;
    text('PSE QSL', W / 2 - 330, yq, `700 40px ${CARD_LABEL}`, C.text, 'center');
    text('TNX QSL', W / 2 + 330, yq, `700 40px ${CARD_LABEL}`, C.text, 'center');
    text('73!', W / 2, yq + 4, `italic 900 56px ${CARD_LABEL}`, C.accent, 'center');
    g.strokeStyle = C.accent; g.lineWidth = 2;
    g.beginPath();
    g.moveTo(W / 2 - 250, yq - 14); g.lineTo(W / 2 - 60, yq - 14);
    g.moveTo(W / 2 + 60, yq - 14); g.lineTo(W / 2 + 250, yq - 14);
    g.stroke();
    const cx = thanks ? W / 2 + 330 : W / 2 - 330;
    cardRing(g, [cx - 78, yq - 34, cx + 78, yq + 6], C.accent);
    text('BEST 73 & GOOD DX!', W / 2, yq + 80, `italic 700 40px ${CARD_LABEL}`, C.accent, 'center');
    // The program's mark, small, in the corner.
    if (cardLogo && cardLogo.complete && cardLogo.naturalWidth) {
      g.globalAlpha = 0.9; g.drawImage(cardLogo, W - 150, H - 150, 90, 90); g.globalAlpha = 1;
    }
    // Just HamLog here, without the callsign on the plate: this card is
    // another operator's, and R2FEL beside their own callsign would read as
    // if someone else had signed it.
    text('HamLog', W - 160, H - 92, `700 30px ${CARD_LABEL}`, C.dim, 'right');
  }

  /** The finished card for a contact, on a canvas. */
  async function renderCard(qso, thanks) {
    await cardFontsReady();
    const canvas = document.createElement('canvas');
    const g = canvas.getContext('2d');
    const layout = cardLayoutFor(qso);
    if (layout) drawPictureCard(g, qso, layout, thanks);
    else drawProgramCard(g, qso, cardSettings().kind === 'light' ? 'light' : 'dark', thanks);
    return canvas;
  }

  // A QSL card is 140 × 90 mm on paper; sent as a picture it wants to be big
  // enough to read and print, small enough for a mailbox: 1050 px on the long
  // side is about 190 dots per inch at that size, and a couple of hundred
  // kilobytes. The card is drawn large and scaled down to this to send.
  const CARD_EMAIL_LONG_SIDE = 1050;

  function cardForEmail(canvas) {
    const scale = Math.min(1, CARD_EMAIL_LONG_SIDE / Math.max(canvas.width, canvas.height));
    if (scale === 1) return canvas.toDataURL('image/jpeg', 0.9);
    const small = document.createElement('canvas');
    small.width = Math.round(canvas.width * scale);
    small.height = Math.round(canvas.height * scale);
    const g = small.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(canvas, 0, 0, small.width, small.height);
    return small.toDataURL('image/jpeg', 0.88);
  }

  // ---------------------------------------------------------------------
  // Placing the fields on your own picture
  //
  // The card in the code was measured off R2FEL's own picture by hand. Anyone
  // else's picture needs the same thing done to it, and this is where they do
  // it: pick a field, drag a box on the card, and the box is where that field
  // will be printed. The canvas underneath is not a mock-up — it is the very
  // renderer the sent card uses, redrawn on every change, so what is on screen
  // is what goes out.
  // ---------------------------------------------------------------------

  const CARD_FIELDS = [
    { field: 'call', style: 'ink', en: 'Callsign', ru: 'Позывной' },
    { field: 'utc', style: 'ink', en: 'Date & time', ru: 'Дата и время' },
    { field: 'band', style: 'ink', en: 'Band', ru: 'Диапазон' },
    { field: 'mode', style: 'ink', en: 'Mode', ru: 'Вид' },
    { field: 'rst', style: 'ink', en: 'Report', ru: 'Рапорт' },
    { field: 'myRda', style: 'label', en: 'My RDA', ru: 'Мой RDA' },
    { field: 'myGrid', style: 'label', en: 'My locator', ru: 'Мой локатор' },
    { field: 'pse', style: 'ring', en: 'PSE QSL ring', ru: 'Кружок PSE QSL' },
    { field: 'tnx', style: 'ring', en: 'TNX QSL ring', ru: 'Кружок TNX QSL' }
  ];

  const MIN_BOX = 24;   // picture pixels — smaller than this is a stray click, not a box

  let cardEdit = null;  // { layout, picked, drag, scale, qso }

  function cardEditDraft() {
    const saved = (station.cardLayouts || {})[cardPicture.sha256];
    return saved
      ? JSON.parse(JSON.stringify(saved))
      : { boxes: [], pse: null, tnx: null, ink: 'light' };
  }

  function cardEditBox(field) {
    if (field === 'pse' || field === 'tnx') {
      const r = cardEdit.layout[field];
      return r ? { x0: r[0], y0: r[1], x1: r[2], y1: r[3] } : null;
    }
    return cardEdit.layout.boxes.find(b => b.field === field) || null;
  }

  function cardEditSetBox(field, box) {
    const l = cardEdit.layout;
    if (field === 'pse' || field === 'tnx') {
      l[field] = box ? [box.x0, box.y0, box.x1, box.y1].map(Math.round) : null;
      return;
    }
    l.boxes = l.boxes.filter(b => b.field !== field);
    if (!box) return;
    const spec = CARD_FIELDS.find(f => f.field === field);
    const h = box.y1 - box.y0;
    l.boxes.push({
      field, style: spec.style,
      x0: Math.round(box.x0), y0: Math.round(box.y0), x1: Math.round(box.x1), y1: Math.round(box.y1),
      // Typewriter text is sized off the box: draw the box the height you want
      // the figures, and there is nothing else to set. cardFit shrinks it
      // further if the box is too narrow for what goes in it.
      ...(spec.style === 'ink' ? { size: Math.max(12, Math.round(h * 0.62)) } : { align: 'center' })
    });
  }

  function renderCardEditChips() {
    const wrap = $('ce-fields');
    wrap.innerHTML = '';
    CARD_FIELDS.forEach(f => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'qso-ce-chip' + (cardEditBox(f.field) ? ' is-set' : '') + (cardEdit.picked === f.field ? ' is-now' : '');
      b.textContent = tr(f.en, f.ru);
      b.addEventListener('click', () => { cardEdit.picked = f.field; renderCardEditChips(); drawCardEdit(); });
      wrap.appendChild(b);
    });
    const placed = CARD_FIELDS.filter(f => cardEditBox(f.field)).length;
    const now = CARD_FIELDS.find(f => f.field === cardEdit.picked);
    $('ce-hint').textContent = tr(
      `Pick a field, then drag a box on the card where it belongs — drag inside a box to move it. Now placing: ${tr(now.en, now.ru)}. ${placed} of ${CARD_FIELDS.length} placed.`,
      `Выберите поле и обведите на карточке место для него — по готовой рамке можно тянуть, чтобы подвинуть. Сейчас ставим: ${tr(now.en, now.ru)}. Размечено ${placed} из ${CARD_FIELDS.length}.`);
    $('ce-drop').disabled = !cardEditBox(cardEdit.picked);
  }

  /** The card as it will really be, with the boxes drawn over it. */
  function drawCardEdit() {
    const canvas = $('ce-canvas');
    const g = canvas.getContext('2d');
    drawPictureCard(g, cardEdit.qso, cardEdit.layout, false);
    g.save();
    g.lineWidth = Math.max(2, Math.round(canvas.width / 500));
    g.setLineDash([g.lineWidth * 3, g.lineWidth * 2]);
    CARD_FIELDS.forEach(f => {
      const b = cardEditBox(f.field);
      if (!b) return;
      const now = f.field === cardEdit.picked;
      g.strokeStyle = now ? CARD_RING : 'rgba(255,255,255,0.55)';
      g.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    });
    g.restore();
  }

  /** Where a mouse or finger is, in the picture's own pixels. */
  function cardEditPoint(ev) {
    const canvas = $('ce-canvas');
    const r = canvas.getBoundingClientRect();
    const t = ev.touches ? ev.touches[0] : ev;
    return {
      x: (t.clientX - r.left) / r.width * canvas.width,
      y: (t.clientY - r.top) / r.height * canvas.height
    };
  }

  /** Dragging: inside a placed box moves it, anywhere else draws a new one. */
  function wireCardEditor() {
    const canvas = $('ce-canvas');

    const start = ev => {
      if (!cardEdit) return;
      ev.preventDefault();
      const p = cardEditPoint(ev);
      const b = cardEditBox(cardEdit.picked);
      cardEdit.drag = (b && p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1)
        ? { mode: 'move', from: p, box: Object.assign({}, b) }
        : { mode: 'draw', from: p };
    };

    const move = ev => {
      if (!cardEdit || !cardEdit.drag) return;
      ev.preventDefault();
      const p = cardEditPoint(ev);
      const d = cardEdit.drag;
      if (d.mode === 'move') {
        const dx = p.x - d.from.x;
        const dy = p.y - d.from.y;
        cardEditSetBox(cardEdit.picked, {
          x0: d.box.x0 + dx, y0: d.box.y0 + dy, x1: d.box.x1 + dx, y1: d.box.y1 + dy
        });
      } else {
        cardEditSetBox(cardEdit.picked, {
          x0: Math.min(d.from.x, p.x), y0: Math.min(d.from.y, p.y),
          x1: Math.max(d.from.x, p.x), y1: Math.max(d.from.y, p.y)
        });
      }
      drawCardEdit();
    };

    const end = () => {
      if (!cardEdit || !cardEdit.drag) return;
      const b = cardEditBox(cardEdit.picked);
      // A click rather than a drag: too small to be a box, and a box that size
      // would print nothing readable anyway.
      if (cardEdit.drag.mode === 'draw' && b && (b.x1 - b.x0 < MIN_BOX || b.y1 - b.y0 < MIN_BOX)) {
        cardEditSetBox(cardEdit.picked, null);
      }
      cardEdit.drag = null;
      renderCardEditChips();
      drawCardEdit();
    };

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('touchstart', start, { passive: false });
    window.addEventListener('mousemove', move);
    canvas.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchend', end);

    $('ce-drop').addEventListener('click', () => {
      cardEditSetBox(cardEdit.picked, null);
      renderCardEditChips();
      drawCardEdit();
    });
    $('ce-clear').addEventListener('click', () => {
      cardEdit.layout = { boxes: [], pse: null, tnx: null, ink: cardEdit.layout.ink };
      renderCardEditChips();
      drawCardEdit();
    });
    document.querySelectorAll('input[name="ce-ink"]').forEach(r => r.addEventListener('change', () => {
      cardEdit.layout.ink = document.querySelector('input[name="ce-ink"]:checked').value;
      drawCardEdit();
    }));
    ['ce-close', 'ce-cancel'].forEach(id => $(id).addEventListener('click', closeCardEditor));
    $('ce-save').addEventListener('click', saveCardLayout);
  }

  function openCardEditor() {
    if (!cardPicture) return;
    cardEdit = { layout: cardEditDraft(), picked: CARD_FIELDS[0].field, drag: null, qso: cardSampleQso() };
    document.querySelectorAll('input[name="ce-ink"]').forEach(r => { r.checked = r.value === (cardEdit.layout.ink === 'dark' ? 'dark' : 'light'); });
    openOverlay('qso-card-edit');
    renderCardEditChips();
    drawCardEdit();
  }

  function closeCardEditor() {
    cardEdit = null;
    closeOverlay('qso-card-edit');
  }

  async function saveCardLayout() {
    const l = cardEdit.layout;
    if (!l.boxes.length && !l.pse && !l.tnx) {
      closeCardEditor();
      return;
    }
    // Под каким позывным размечали — на самой картинке он и напечатан.
    // Сменит человек позывной — эта карточка станет чужой, и отправлять её
    // нельзя (см. cardLayoutFor).
    l.call = baseCallsign(currentMyCall()) || '';
    station.cardLayouts = Object.assign({}, station.cardLayouts, { [cardPicture.sha256]: l });
    persistStation();
    closeCardEditor();
    await renderCardSettings();
    toast(tr('✓ Layout saved', '✓ Разметка сохранена'));
  }

  /** A made-up contact for the settings preview, when the log has none of this callsign yet. */
  function cardSampleQso() {
    const card = cardSettings();
    const layout = card.kind === 'image' && cardPicture ? CARD_LAYOUTS[cardPicture.sha256] : null;
    // With MY CALLSIGN still empty there's nothing to contradict the picture:
    // show it as it will be, under the callsign drawn on it.
    const mine = !currentMyCall() && layout ? layout.call : currentMyCall();
    const real = mine && entries.find(e => e.myCallsign && baseCallsign(e.myCallsign) === baseCallsign(mine));
    return real || { callsign: 'UA3TEST', date: nowUtcParts().date, time: nowUtcParts().time, band: '40m', mode: 'SSB',
      rstSent: '59', myCallsign: mine || 'MYCALL', myRda: station.rda || '', myQth: station.qth || '' };
  }

  // --- the letter --------------------------------------------------------

  const LETTER_RU = 'Здравствуйте, {NAME}!\n\nСпасибо за связь {DATE} в {TIME} UTC на {BAND} {MODE}. Высылаю свою QSL-карточку.\n\n73!\n{MYNAME} {MYCALL}';
  const LETTER_EN = 'Dear {NAME},\n\nThank you for the QSO on {DATE} at {TIME} UTC on {BAND} {MODE}. Here is my QSL card.\n\n73!\n{MYNAME} {MYCALL}';
  const LETTER_SUBJECT = 'QSL {MYCALL} → {CALL} · {DATE} {BAND} {MODE}';

  /** The letter's words with the contact's details put in; no name — no "Dear ," left behind. */
  /**
   * The name to greet them by, spelled the way the letter is written: a
   * Russian letter to a Russian station takes the Russian spelling the
   * callsign book gave (the log may hold the Latin one, or the other way
   * round), an English letter always the Latin.
   */
  function letterName(qso, lang) {
    const stored = String(qso.name || '').trim();
    const found = cardSendNames || {};
    const full = lang === 'ru' ? (found.local || stored) : (found.latin || toLatinTranslit(stored));
    return String(full || '').trim().split(/\s+/)[0] || '';
  }

  function fillLetter(template, qso, lang) {
    const v = cardValues(qso);
    const first = letterName(qso, lang);
    const me = cardSettings().me || {};
    let text = template;
    if (!first) text = text.replace(/,? ?\{NAME\}/g, '').replace(/^Dear\s*([!,.]|$)/m, 'Hello$1');
    return text
      .replace(/\{NAME\}/g, first)
      .replace(/\{CALL\}/g, v.call).replace(/\{DATE\}/g, v.date).replace(/\{TIME\}/g, v.time)
      .replace(/\{BAND\}/g, v.band).replace(/\{MODE\}/g, v.mode).replace(/\{RST\}/g, v.rst)
      .replace(/\{MYCALL\}/g, v.myCall).replace(/\{MYNAME\}/g, me.name || '')
      .replace(/[ \t]+\n/g, '\n').replace(/^[ \t]+/gm, '').trim();
  }

  // The correspondent's name as the callsign books spell it, both ways —
  // filled in when the sending window looks them up.
  let cardSendNames = null;

  function letterTemplate(lang) {
    const card = cardSettings();
    return lang === 'ru' ? (card.textRu || LETTER_RU) : (card.textEn || LETTER_EN);
  }


  // --- settings: which card, the mailbox, the letter ----------------------

  function mailDescText() {
    const m = mailInfo || {};
    if (m.remote) return tr('Only on the computer the program runs on', 'Только на компьютере, где работает программа');
    if (m.offline || !mailInfo) return tr('checking…', 'проверяю…');
    return m.address
      ? tr(`${m.address} · the password is kept on this computer only`, `${m.address} · пароль хранится только на этом компьютере`)
      : tr('not set — needed to send', 'не задана — нужна для отправки');
  }

  function renderCardSummary() {
    const card = cardSettings();
    const { sent } = qslCounts('card');
    const which = card.kind === 'image' ? tr('your picture', 'своя картинка')
      : card.kind === 'light' ? tr("program's, light", 'программы, светлая') : tr("program's, dark", 'программы, тёмная');
    $('card-summary').textContent = tr(`Sent ${sent} · card: ${which}`, `Отправлено ${sent} · карточка: ${which}`);
  }

  let cardPreviewTimer = null;

  /** The settings page: choice, preview, the picture's or the program card's details, the mailbox line. */
  async function renderCardSettings() {
    const card = cardSettings();
    renderCardSummary();
    document.querySelectorAll('input[name="card-kind"]').forEach(r => { r.checked = r.value === card.kind; });
    $('card-image-box').hidden = card.kind !== 'image';
    $('card-me-box').hidden = card.kind === 'image';
    const me = card.me || {};
    $('card-me-desc').textContent = [me.name, me.qth, me.country].filter(Boolean).join(' · ')
      || tr('not filled in yet', 'пока не заполнены');
    [['name', 'card-me-name'], ['qth', 'card-me-qth'], ['country', 'card-me-country'], ['cq', 'card-me-cq'], ['itu', 'card-me-itu']]
      .forEach(([k, id]) => { if (document.activeElement !== $(id)) $(id).value = me[k] || ''; });
    $('mail-desc').textContent = mailDescText();

    const built = cardPicture && CARD_LAYOUTS[cardPicture.sha256];
    const mine = cardPicture && (station.cardLayouts || {})[cardPicture.sha256];
    const placed = mine ? mine.boxes.length + (mine.pse ? 1 : 0) + (mine.tnx ? 1 : 0) : 0;
    $('card-image-desc').textContent = !cardPicture
      ? tr('Not chosen yet', 'Пока не выбрана')
      : built ? tr(`Laid out: the details go into the places on it (for ${built.call} contacts)`, `Разметка есть: данные встанут на свои места (для связей ${built.call})`)
        : mine ? tr(`Laid out by you — ${placed} field(s) placed${mine.call ? `, for ${mine.call} contacts` : ''}. PLACE THE FIELDS… to change it.`,
          `Размечена вами — полей расставлено: ${placed}${mine.call ? `, для связей ${mine.call}` : ''}. «РАЗМЕТИТЬ…» — поправить.`)
          : tr('No layout yet — press PLACE THE FIELDS… and show where each detail goes', 'Разметки пока нет — нажмите «РАЗМЕТИТЬ…» и покажите, где что печатать');
    $('card-layout-btn').hidden = !cardPicture || Boolean(built);

    // The preview: a real contact of this callsign if there is one.
    const qso = cardSampleQso();
    // A paper card belongs to one callsign — it is printed on it. So does a
    // layout, whether it came with the program or was placed by hand: for
    // contacts made as another of your callsigns the program's own card goes
    // instead, and that is said here rather than discovered at sending time.
    const owner = (built && built.call) || (mine && mine.call) || '';
    const note = card.kind === 'image' && cardPicture && owner && baseCallsign(qso.myCallsign) !== owner
      ? tr(`Contacts made as ${qso.myCallsign} get the program's card — this picture is ${owner}'s.`,
        `Для связей ${qso.myCallsign} уходит карточка программы — на картинке позывной ${owner}.`) : '';
    $('card-preview-note').textContent = note;
    clearTimeout(cardPreviewTimer);
    cardPreviewTimer = setTimeout(async () => {
      const canvas = await renderCard(qso, cardThanks(qso));
      $('card-preview').src = canvas.toDataURL('image/jpeg', 0.8);
    }, 150);
  }

  async function chooseCardPicture(file) {
    const type = file.type;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) {
      toast(tr('A JPEG, PNG or WebP picture, please', 'Нужна картинка JPEG, PNG или WebP'));
      return;
    }
    const data = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    try {
      const res = await fetch('/api/card/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, data }) });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
      cardPicture = null;
      await refreshCardStatus();
      const layout = cardPicture && CARD_LAYOUTS[cardPicture.sha256];
      toast(layout ? tr(`✓ Picture saved — laid out for ${layout.call}`, `✓ Картинка сохранена — разметка для ${layout.call} найдена`)
        : tr('✓ Picture saved', '✓ Картинка сохранена'));
      renderCardSettings();
    } catch (err) {
      toast(tr(`Not saved: ${err.message}`, `Не сохранено: ${err.message}`));
    }
  }

  /** The operator's own details for the program's card, from the same callsign books as any lookup. */
  async function fillCardMe() {
    const call = baseCallsign(currentMyCall());
    if (!call) { toast(tr('Fill in MY CALLSIGN first', 'Сначала впишите MY CALLSIGN')); return; }
    $('card-me-fill').disabled = true;
    try {
      const res = await fetch('/api/lookup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callsign: call, accessKey: auth.accessKey || '' })
      });
      // The card goes abroad too: the Latin spelling of the name and town.
      const data = latinizeRecord(await res.json());
      if (data.error) throw new Error(data.error);
      const me = cardSettings().me;
      me.name = me.name || data.name || '';
      me.qth = me.qth || data.city || '';
      me.country = me.country || data.country || '';
      me.cq = me.cq || data.cq || '';
      me.itu = me.itu || data.itu || '';
      persistStation();
      renderCardSettings();
      toast(tr('✓ Taken from the callsign books', '✓ Взято из справочников'));
    } catch (err) {
      toast(tr(`Nothing found: ${err.message}`, `Не нашлось: ${err.message}`));
    } finally {
      $('card-me-fill').disabled = false;
    }
  }

  function renderMailLogin() {
    const m = mailInfo || {};
    $('mail-address').value = m.address || '';
    showSavedPassword($('mail-pass'), Boolean(m.hasPassword));
    $('mail-host').value = m.known ? '' : (m.host || '');
    $('mail-port').value = m.known ? '' : (m.port || '');
    updateMailHowto();
    paintStatus($('mail-status'), '');
  }

  /** Where this address's app password is made — said for the services people use here. */
  function updateMailHowto() {
    const domain = ($('mail-address').value.split('@')[1] || '').toLowerCase();
    const known = /^(mail|inbox|list|bk|internet)\.ru$/.test(domain) ? 'mailru'
      : /^(yandex\.(ru|com|by|kz)|ya\.ru)$/.test(domain) ? 'yandex'
        : /^(gmail|googlemail)\.com$/.test(domain) ? 'gmail'
          : /^(outlook|hotmail|live|msn)\.com$/.test(domain) ? 'outlook'
            : /^(rambler|lenta|ro)\.ru$/.test(domain) ? 'rambler'
              : /^(icloud|me|mac)\.com$/.test(domain) ? 'icloud' : '';
    $('mail-server-box').hidden = Boolean(known) || !domain;
    const how = {
      mailru: tr('Mail.ru: Settings → Security → Passwords for external applications → Add, give it a name (LOG), tick "Sending mail (SMTP)". Mail.ru shows the password once — copy it here.',
        'Mail.ru: Настройки → Безопасность → Пароли для внешних приложений → Добавить, назовите (например, LOG), отметьте «Отправка писем (SMTP)». Mail.ru покажет пароль один раз — скопируйте его сюда.'),
      yandex: tr('Yandex: Yandex ID → Security → App passwords → Mail. Paste the password it gives here.',
        'Яндекс: Яндекс ID → Безопасность → Пароли приложений → Почта. Вставьте сюда пароль, который он покажет.'),
      gmail: tr('Gmail: Google account → Security → 2-Step Verification on → App passwords. Paste the 16 letters here.',
        'Gmail: Аккаунт Google → Безопасность → включите двухэтапную аутентификацию → Пароли приложений. Вставьте сюда 16 букв.'),
      outlook: tr('Outlook: account.microsoft.com → Security → Advanced security options → App passwords.',
        'Outlook: account.microsoft.com → Безопасность → Дополнительные параметры → Пароли приложений.'),
      rambler: tr('Rambler: Settings → Mail programs → allow access, then use your mailbox password or an app password.',
        'Рамблер: Настройки → Почтовые программы → разрешите доступ, затем пароль ящика или пароль приложения.'),
      icloud: tr('iCloud: appleid.apple.com → Sign-In and Security → App-Specific Passwords.',
        'iCloud: appleid.apple.com → Вход и безопасность → Пароли приложений.')
    }[known];
    $('mail-howto').textContent = how || (domain
      ? tr('For this mail service type its SMTP server and port (they are in its help, "mail programs" or "SMTP"). Most take an app password rather than the usual one.',
        'Для этой почты впишите её сервер SMTP и порт — они есть в её справке («почтовые программы» или «SMTP»). Почти везде нужен пароль приложения, а не обычный.')
      : tr('Letters go from your own mailbox. Most mail services give programs a separate "app password" — the steps appear here once you type the address.',
        'Письма уходят с вашей почты. Большинство почтовых служб дают программам отдельный «пароль приложения» — как его сделать, появится здесь, когда впишете адрес.'));
  }

  async function saveMailLogin() {
    const address = $('mail-address').value.trim();
    const password = passwordValue($('mail-pass'));
    paintStatus($('mail-status'), tr('saving…', 'сохраняю…'), 'pending');
    try {
      const res = await fetch('/api/mail/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, password, host: $('mail-host').value.trim(), port: $('mail-port').value.trim() })
      });
      const data = await res.json();
      if (!res.ok) {
        const why = data.needsHost ? tr('this mail service needs its SMTP server — type it below', 'для этой почты нужен сервер SMTP — впишите ниже')
          : res.status === 400 && /password/i.test(data.error) ? tr('the app password is needed', 'нужен пароль приложения')
            : /address/i.test(data.error || '') ? tr('that is not an e-mail address', 'это не адрес почты') : data.error;
        if (data.needsHost) $('mail-server-box').hidden = false;
        throw new Error(why);
      }
      mailInfo = data.mail;
      renderMailLogin();
      showSettingsPage('card', true);
      renderCardSettings();
      toast(address ? tr('✓ Mailbox saved', '✓ Почта сохранена') : tr('✓ Mailbox removed', '✓ Почта удалена'));
    } catch (err) {
      paintStatus($('mail-status'), tr(`Not saved: ${err.message}`, `Не сохранено: ${err.message}`), 'err');
    }
  }

  async function testMailLogin() {
    paintStatus($('mail-status'), tr('logging in to the mailbox…', 'вхожу в почту…'), 'pending');
    try {
      const res = await fetch('/api/mail/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.badLogin ? tr('the mail service did not accept the address or the app password', 'почта не приняла адрес или пароль приложения')
          : data.network ? tr('no connection to the mail server', 'нет связи с почтовым сервером') : (data.error || `HTTP ${res.status}`));
      }
      paintStatus($('mail-status'), tr('✓ The mailbox lets the program in — cards can go', '✓ Почта пускает программу — карточки можно отправлять'), 'ok');
    } catch (err) {
      paintStatus($('mail-status'), tr(`✕ ${err.message}`, `✕ ${err.message}`), 'err');
    }
  }

  function renderLetterPage() {
    const card = cardSettings();
    $('letter-myname').value = (card.me && card.me.name) || '';
    $('letter-subject').value = card.subject || LETTER_SUBJECT;
    $('letter-ru').value = card.textRu || LETTER_RU;
    $('letter-en').value = card.textEn || LETTER_EN;
  }

  function saveLetter() {
    const card = cardSettings();
    // The default is kept as "no text of your own", so an improved default reaches everyone who didn't change it.
    const own = (value, def) => (value.trim() === def ? '' : value);
    card.subject = own($('letter-subject').value, LETTER_SUBJECT);
    card.textRu = own($('letter-ru').value, LETTER_RU);
    card.textEn = own($('letter-en').value, LETTER_EN);
    persistStation();
  }

  // --- the sending window --------------------------------------------------

  let cardSendQso = null;
  let cardSendCanvas = null;

  async function drawCardSendPreview() {
    if (!cardSendQso) return;
    const thanks = document.querySelector('input[name="cs-mark"]:checked').value === 'tnx';
    cardSendCanvas = await renderCard(cardSendQso, thanks);
    $('cs-preview').src = cardSendCanvas.toDataURL('image/jpeg', 0.85);

    const note = cardSendCardNote(cardSendQso);
    $('cs-card-note').textContent = note;
    $('cs-card-note').hidden = !note;
  }

  function fillCardSendLetter() {
    const lang = document.querySelector('input[name="cs-lang"]:checked').value;
    $('cs-subject').value = fillLetter(cardSettings().subject || LETTER_SUBJECT, cardSendQso, lang);
    $('cs-text').value = fillLetter(letterTemplate(lang), cardSendQso, lang);
    cardSendWritten = $('cs-text').value;
  }

  /** The letter is rewritten when the lookup arrives — unless it's been edited by hand. */
  let cardSendWritten = '';
  function refillCardSendLetter() {
    if (cardSendQso && $('cs-text').value === cardSendWritten) fillCardSendLetter();
  }

  async function openCardSend(id) {
    const qso = entries.find(e => e.id === id);
    if (!qso) return;
    cardSendQso = qso;
    cardSendNames = null;
    await Promise.all([refreshMailStatus(), refreshCardStatus()]);
    $('cs-title').textContent = tr(`✉ QSL card to ${qso.callsign}`, `✉ QSL-карточка для ${qso.callsign}`);
    $('cs-form').hidden = false;
    $('cs-done').hidden = true;
    document.querySelectorAll('input[name="cs-mark"]').forEach(r => { r.checked = r.value === (cardThanks(qso) ? 'tnx' : 'pse'); });
    // English unless the program itself is in Russian *and* the callsign is a
    // Russian-speaking one. With Russian mode off, a letter in Russian is
    // never what was meant — the operator picks it by hand if they want it.
    const ruLetter = station.ruPhonetics && isCyrillicSpelledCall(qso.callsign);
    document.querySelectorAll('input[name="cs-lang"]').forEach(r => { r.checked = r.value === (ruLetter ? 'ru' : 'en'); });
    fillCardSendLetter();
    paintStatus($('cs-status'), mailInfo && mailInfo.address ? ''
      : tr('The mailbox to send from isn\'t set up yet — ⚙ → QSL by e-mail → Mailbox.', 'Почта для отправки ещё не настроена — ⚙ → «QSL по e-mail» → «Почта для отправки».'),
    mailInfo && mailInfo.address ? '' : 'err');
    if (qso.cardSent) {
      paintStatus($('cs-status'), tr(`Already sent ${formatDateHuman(qso.cardSentDate)}${qso.email ? ` to ${qso.email}` : ''} — it can go again.`,
        `Уже отправлена ${formatDateHuman(qso.cardSentDate)}${qso.email ? ` на ${qso.email}` : ''} — можно отправить ещё раз.`), '');
    }
    $('cs-preview').removeAttribute('src');
    openOverlay('qso-card-send');
    drawCardSendPreview();

    // The address: from this contact or an earlier one, else the callsign books (HamQTH has them).
    const known = qso.email || (station.cardEmails || {})[qso.callsign] || '';
    $('cs-to').value = known;
    $('cs-to-note').textContent = known ? tr('from the log', 'из журнала') : tr('looking it up…', 'ищу адрес…');
    // The books are asked either way: they hold the address and both
    // spellings of the name, which the letter needs.
    try {
      const res = await fetch('/api/lookup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callsign: qso.callsign, accessKey: auth.accessKey || '' })
      });
      const data = await res.json();
      if (cardSendQso !== qso) return;
      if (!data.error) {
        cardSendNames = { latin: latinizeRecord(data).name || '', local: data.nameLocal || '' };
        refillCardSendLetter();
      }
      if ($('cs-to').value) return;
      if (data.email) {
        $('cs-to').value = data.email;
        $('cs-to-note').textContent = tr(`found in the callsign book (${data.source || 'hamqth'}) — check it`, `нашлось в справочнике (${data.source || 'hamqth'}) — проверьте`);
      } else {
        $('cs-to-note').textContent = tr('No address in the callsign books — find it on qrz.com and paste it here.', 'В справочниках адреса нет — найдите его на qrz.com и вставьте сюда.');
      }
    } catch (e) {
      if (!$('cs-to').value) $('cs-to-note').textContent = tr('Could not look the address up — type it in.', 'Не удалось поискать адрес — впишите его.');
    }
  }

  async function sendCard() {
    const qso = cardSendQso;
    const to = $('cs-to').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      paintStatus($('cs-status'), tr('Type their e-mail address', 'Впишите адрес почты корреспондента'), 'err');
      $('cs-to').focus();
      return;
    }
    if (!cardSendCanvas) await drawCardSendPreview();
    const btn = $('cs-send');
    btn.disabled = true;
    paintStatus($('cs-status'), tr('sending…', 'отправляю…'), 'pending');
    const v = cardValues(qso);
    const me = cardSettings().me || {};
    try {
      const res = await fetch('/api/card/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          subject: $('cs-subject').value,
          text: $('cs-text').value,
          image: cardForEmail(cardSendCanvas).split(',')[1],
          filename: `QSL_${v.myCall}_${v.call}_${adifDate(qso.date)}.jpg`.replace(/\//g, '-'),
          fromName: [me.name, v.myCall].filter(Boolean).join(' ')
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.notSet ? tr('the mailbox to send from isn\'t set up — ⚙ → QSL by e-mail', 'почта для отправки не настроена — ⚙ → «QSL по e-mail»')
          : data.badLogin ? tr('the mail service did not accept the app password — check it in ⚙ → QSL by e-mail → Mailbox', 'почта не приняла пароль приложения — проверьте его: ⚙ → «QSL по e-mail» → «Почта для отправки»')
            : data.network ? tr('no connection to the mail server', 'нет связи с почтовым сервером') : (data.error || `HTTP ${res.status}`));
      }
      qso.cardSent = 'Y';
      qso.cardSentDate = nowUtcParts().date;
      qso.email = to;
      qso.updatedAt = new Date().toISOString();
      await saveEntry(qso);
      station.cardEmails = Object.assign({}, station.cardEmails, { [qso.callsign]: to });
      persistStation();
      render();
      $('cs-form').hidden = true;
      $('cs-done').hidden = false;
      $('cs-done-ico').textContent = '✓';
      $('cs-done-ico').classList.remove('is-bad');
      $('cs-done-title').textContent = tr('The card is sent', 'Карточка отправлена');
      $('cs-done-line').textContent = tr(`${qso.callsign} · ${to}`, `${qso.callsign} · ${to}`);
      console.info(`[card] sent: ${qso.callsign} → ${to}`);
    } catch (err) {
      paintStatus($('cs-status'), tr(`Not sent: ${err.message}`, `Не отправлено: ${err.message}`), 'err');
    } finally {
      btn.disabled = false;
    }
  }

  // --- a received eQSL card -------------------------------------------------

  let cardViewQso = null;

  /** The picture of the eQSL card a contact was confirmed with: kept after the first time. */
  async function openEqslCard(id) {
    const qso = entries.find(e => e.id === id);
    if (!qso) return;
    cardViewQso = qso;
    $('cv-title').textContent = tr(`eQSL card from ${qso.callsign}`, `Карточка eQSL от ${qso.callsign}`);
    $('cv-image').removeAttribute('src');
    $('cv-save').hidden = true;
    openOverlay('qso-card-view');
    const show = file => {
      $('cv-image').src = `/api/eqsl/card-image?f=${encodeURIComponent(file)}`;
      $('cv-save').hidden = !(window.desktopApp && window.desktopApp.saveFile);
      paintStatus($('cv-status'), tr('Kept on this computer — opens without eQSL from now on.', 'Хранится на этом компьютере — дальше открывается без eQSL.'), '');
    };
    paintStatus($('cv-status'), tr('Asking eQSL for the card… (eQSL gives one every few seconds)', 'Прошу карточку у eQSL… (eQSL отдаёт по одной, раз в несколько секунд)'), 'pending');
    try {
      const res = await fetch('/api/eqsl/card', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call: qso.callsign, date: qso.date, time: qso.time, band: qso.band, mode: qso.mode })
      });
      const data = await res.json();
      if (cardViewQso !== qso) return;
      if (!res.ok) {
        throw new Error(data.needsLogin ? tr('the eQSL login isn\'t set — ⚙ → eQSL', 'не задан логин eQSL — ⚙ → eQSL')
          : data.badLogin ? tr('eQSL did not accept the login', 'eQSL не принял логин')
            : data.notFound ? tr('eQSL has no card for this contact (the time or mode may differ from theirs)', 'у eQSL нет карточки на эту связь (возможно, у корреспондента другое время или вид излучения)')
              : data.throttled ? tr('eQSL asks to wait a little — try again in a minute', 'eQSL просит подождать — попробуйте через минуту')
                : (data.error || `HTTP ${res.status}`));
      }
      if (qso.eqslCardFile !== data.file) {
        qso.eqslCardFile = data.file;
        await saveEntry(qso);
      }
      show(data.file);
    } catch (err) {
      paintStatus($('cv-status'), tr(`No card: ${err.message}`, `Карточки нет: ${err.message}`), 'err');
    }
  }

  async function saveEqslCardPicture() {
    const qso = cardViewQso;
    if (!qso || !qso.eqslCardFile) return;
    const res = await fetch(`/api/eqsl/card-image?f=${encodeURIComponent(qso.eqslCardFile)}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const ext = qso.eqslCardFile.split('.').pop();
    const where = await window.desktopApp.saveFile(`eQSL_${qso.callsign.replace(/\//g, '-')}_${adifDate(qso.date)}.${ext}`, bytes);
    if (where) paintStatus($('cv-status'), tr(`Saved: ${friendlyPath(where)}`, `Сохранено: ${friendlyPath(where)}`), 'ok');
  }

  // ---------------------------------------------------------------------
  // What an action came to
  //
  // A status line under a button went unnoticed — the owner pressed IMPORT
  // and couldn't tell whether anything had happened. So the end of every
  // real action (import, export, sending, checking, changing callsigns,
  // clearing the log) is a page of its own: a big ✓ or ✕, the numbers, and
  // a button to what comes next. Small things (a login saved) get a green
  // note that goes by itself. Progress while it runs stays on the line.
  // ---------------------------------------------------------------------

  /** связь / связи / связей — the one Russian word the numbers need. */
  function contactsWord(n, upper) {
    const m10 = n % 10;
    const m100 = n % 100;
    const word = !station.ruPhonetics ? (n === 1 ? 'contact' : 'contacts')
      : m10 === 1 && m100 !== 11 ? 'связь'
        : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'связи' : 'связей';
    return upper ? word.toUpperCase() : word;
  }

  /** A saved file's place, the way the owner knows it: "Рабочий стол / qso-log.adi". */
  function friendlyPath(full) {
    const parts = String(full || '').split(/[\\/]/).filter(Boolean);
    if (!parts.length) return '';
    const folder = parts.length > 1 ? parts[parts.length - 2] : '';
    const named = { Desktop: tr('Desktop', 'Рабочий стол'), Downloads: tr('Downloads', 'Загрузки'), Documents: tr('Documents', 'Документы') }[folder] || folder;
    return named ? `${named} / ${parts[parts.length - 1]}` : parts[parts.length - 1];
  }

  /**
   * The result page. `lines`: strings, or [label, value] pairs (the value in
   * bold). `from`: the page the action was on — the title comes from it, and
   * ‹ goes back to it (or to `backTo`). The second button is DONE, to `doneTo`.
   */
  function showResult({ from, ok = true, heading, lines = [], path = '', primary = null, backTo, doneTo = 'main' }) {
    const origin = $(`set-page-${from}`);
    const title = origin ? origin.querySelector('.qso-set-title').textContent : '';
    const back = backTo || from;
    $('result-title').textContent = title;
    const backPage = $(`set-page-${back}`);
    const backName = back === 'main' ? tr('Settings', 'Настройки')
      : (backPage ? backPage.querySelector('.qso-set-title').textContent : '').replace(/^[^A-Za-zА-Яа-яЁё0-9]+/, '');
    $('result-back').textContent = `‹ ${backName}`;
    $('result-back').setAttribute('data-back', back);

    $('result-ico').textContent = ok ? '✓' : '✕';
    $('result-ico').classList.toggle('is-bad', !ok);
    $('result-heading').textContent = heading;
    $('result-lines').innerHTML = lines.filter(Boolean).map(line => Array.isArray(line)
      ? `<p class="qso-done-line">${escapeHtml(line[0])}: <b>${escapeHtml(String(line[1]))}</b></p>`
      : `<p class="qso-done-line">${escapeHtml(line)}</p>`).join('') +
      (path ? `<span class="qso-done-path">${escapeHtml(friendlyPath(path))}</span>` : '');
    console.info(`[${from}] ${heading}${lines.length ? ' — ' : ''}${lines.filter(Boolean).map(l => Array.isArray(l) ? `${l[0]}: ${l[1]}` : l).join('; ')}`);

    const first = $('result-primary');
    first.hidden = !primary;
    if (primary) {
      first.textContent = primary.label;
      first.onclick = primary.run;
    }
    const second = $('result-secondary');
    second.textContent = ok ? tr('DONE', 'ГОТОВО') : tr('BACK', 'НАЗАД');
    second.onclick = () => showSettingsPage(ok ? doneTo : back, true);
    showSettingsPage('result', true);
  }

  /** A service page's outcome (LoTW, eQSL, HAMLOG): its progress line gone, the result page up. */
  function serviceResult(from, ok, heading, lines, primary, path) {
    paintStatus($(`${from}-status`), '');
    showResult({ from, ok, heading, lines, primary, path, doneTo: from });
  }

  /** A short green "done" over the settings card, gone in a couple of seconds. */
  function toast(text) {
    const card = document.querySelector('#qso-data .qso-card');
    card.querySelectorAll('.qso-toast').forEach(t => t.remove());
    const note = document.createElement('div');
    note.className = 'qso-toast';
    note.textContent = text;
    card.appendChild(note);
    console.info(`[settings] ${text}`);
    setTimeout(() => note.classList.add('is-leaving'), 2200);
    setTimeout(() => note.remove(), 2600);
  }

  /** Out of settings and into the log, open. */
  function showInLog() {
    closeOverlay('qso-data');
    setLogPanelOpen(true);
    render();
    $('qso-log-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------------------------------------------------------------------
  // Export / import
  // ---------------------------------------------------------------------

  function refreshStationFilter() {
    const select = $('exp-station');
    const current = select.value;
    const calls = new Set(entries.map(e => e.myCallsign).filter(Boolean));
    if (station.callsign) calls.add(station.callsign);
    select.innerHTML = `<option value="">${tr('all stations', 'все станции')}</option>` +
      [...calls].map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    if (current && calls.has(current)) select.value = current;
  }

  function selectedScope() {
    const chosen = document.querySelector('input[name="exp-scope"]:checked');
    return chosen ? chosen.value : 'all';
  }

  /** The contacts the export page's choices pick out, in logbook order. */
  function matchingExport() {
    const scope = selectedScope();
    let list = entries;

    if (scope === 'selected') {
      list = list.filter(e => selected.has(e.id));
    } else if (scope === 'range') {
      const from = dateValue($('exp-from'));
      const to = dateValue($('exp-to'));
      list = list.filter(e => (!from || e.date >= from) && (!to || e.date <= to));
    }

    const stationFilter = $('exp-station').value;
    if (stationFilter) list = list.filter(e => e.myCallsign === stationFilter);
    return list;
  }

  function entriesForExport() {
    // Oldest first, the usual order in an ADIF file.
    return matchingExport().slice()
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  }

  /** A status line: its text, and ok / err / pending for its colour. */
  function paintStatus(el, text, kind) {
    el.textContent = text || '';
    el.classList.remove('ok', 'err', 'pending');
    if (kind) el.classList.add(kind);
  }

  function setDataStatus(text, kind) {
    if (text && kind !== 'pending') console.info(`[data] ${text}`);
    paintStatus($('data-status'), text, kind);
  }

  function setImportStatus(text, kind) {
    if (text && kind !== 'pending') console.info(`[data] ${text}`);
    paintStatus($('imp-status'), text, kind);
  }

  // ---------------------------------------------------------------------
  // Cabrillo — the one file contest organisers take
  //
  // Not a logbook format: a header saying who entered and in what category,
  // then one QSO: line per contact, in a fixed order. The exchange it writes
  // is the common one — report and serial number, which is what contest mode
  // records — so a contest that asks for a zone or an oblast instead needs
  // those columns edited by hand before sending. Said as much on the page.
  // ---------------------------------------------------------------------

  const CABRILLO_MODE = { SSB: 'PH', AM: 'PH', FM: 'FM', CW: 'CW', RTTY: 'RY', PSK: 'DG', FT8: 'DG',
    DMR: 'DG', 'D-STAR': 'DG', C4FM: 'DG', DIGITAL: 'DG' };

  /** The band's own frequency, for contacts logged without one. */
  const BAND_KHZ = {
    '160m': 1800, '80m': 3500, '40m': 7000, '30m': 10100, '20m': 14000, '17m': 18068,
    '15m': 21000, '12m': 24890, '10m': 28000, '6m': 50000, '2m': 144000, '70cm': 432000
  };

  function cabrilloBand(list) {
    const bands = new Set(list.map(q => String(q.band || '').toLowerCase()).filter(Boolean));
    return bands.size === 1 ? [...bands][0].toUpperCase() : 'ALL';
  }

  function cabrilloEntryMode(list) {
    const modes = new Set(list.map(q => CABRILLO_MODE[String(q.mode || '').toUpperCase()] || 'PH'));
    if (modes.size !== 1) return 'MIXED';
    return { PH: 'SSB', CW: 'CW', FM: 'FM', RY: 'RTTY', DG: 'DIGI' }[[...modes][0]] || 'MIXED';
  }

  function cabrilloSettings() {
    const c = station.cabrillo || {};
    return {
      contest: c.contest || '',
      ops: c.ops || 'SINGLE-OP',
      power: c.power || 'LOW',
      name: c.name || (cardSettings().me || {}).name || ''
    };
  }

  function buildCabrillo(list, call) {
    const c = cabrilloSettings();
    const me = (cardSettings().me || {});
    const pad = (v, n) => String(v || '').padEnd(n).slice(0, Math.max(n, String(v || '').length));
    const lines = [
      'START-OF-LOG: 3.0',
      `CONTEST: ${c.contest || 'UNKNOWN'}`,
      `CALLSIGN: ${call}`,
      `CATEGORY-OPERATOR: ${c.ops}`,
      `CATEGORY-POWER: ${c.power}`,
      // Both read off the contacts themselves — an entry made entirely on one
      // band and one mode should say so rather than claim ALL and MIXED.
      `CATEGORY-BAND: ${cabrilloBand(list)}`,
      `CATEGORY-MODE: ${cabrilloEntryMode(list)}`,
      'CATEGORY-TRANSMITTER: ONE',
      `GRID-LOCATOR: ${(station.qth || '').toUpperCase()}`,
      `NAME: ${c.name}`,
      me.city ? `ADDRESS: ${me.city}` : '',
      me.country ? `ADDRESS-COUNTRY: ${me.country}` : '',
      `SOAPBOX: Logged with R2FEL HamLog ${$('about-version').textContent || ''}`.trim(),
      `CREATED-BY: R2FEL HamLog ${$('about-version').textContent || ''}`.trim()
    ].filter(Boolean);

    // QSO: freq mode date time mycall rst-sent nr-sent theircall rst-rcvd nr-rcvd
    for (const q of list) {
      const khz = q.freqHz ? Math.round(q.freqHz / 1000) : (BAND_KHZ[String(q.band || '').toLowerCase()] || 0);
      lines.push([
        'QSO:', String(khz).padStart(5),
        CABRILLO_MODE[String(q.mode || '').toUpperCase()] || 'PH',
        q.date, String(q.time || '').replace(':', ''),   // Cabrillo wants 1432, not 14:32
        pad(q.myCallsign || call, 13), pad(q.rstSent || '59', 3), pad(q.nrSent || '', 6),
        pad(q.callsign, 13), pad(q.rstRcvd || '59', 3), pad(q.nrRcvd || '', 6)
      ].join(' ').replace(/\s+$/, ''));
    }
    lines.push('END-OF-LOG:');
    return lines.join('\n') + '\n';
  }

  function exportFormat() {
    const picked = document.querySelector('input[name="exp-format"]:checked');
    return picked ? picked.value : 'adif';
  }

  /** The contest block appears only with Cabrillo picked, and says what it can't do. */
  function renderExportFormat() {
    const cab = exportFormat() === 'cabrillo';
    $('exp-cab').hidden = !cab;
    const c = cabrilloSettings();
    $('cab-contest').value = c.contest;
    $('cab-ops').value = c.ops;
    $('cab-power').value = c.power;
    $('cab-name').value = c.name;
    $('cab-note').textContent = tr(
      'One .log file for the organiser. Each contact goes down with its report and serial number — the usual exchange, and the one contest mode keeps. If your contest asks for something else (a zone, a district), put it in those columns before sending.',
      'Получится файл .log для организатора. Каждая связь записывается с рапортом и номером — обычный обмен, и как раз то, что запоминает режим контеста. Если в вашем контесте передаётся что-то другое (зона, район), впишите это в те же столбцы перед отправкой.');
    $('exp-foot').hidden = cab;
    // The 📖 at the foot of the page follows the choice: the export section,
    // or the contest one that explains what a Cabrillo file is.
    const help = document.querySelector('#set-page-export .qso-set-help');
    if (help) {
      help.setAttribute('data-help', cab ? 'cabrillo' : 'export');
      const label = help.querySelector('span');
      label.setAttribute('data-ru', cab ? '📖 Инструкция: отчёт Cabrillo' : '📖 Инструкция: Экспорт ADIF');
      label.setAttribute('data-en', cab ? '📖 Manual: your Cabrillo entry' : '📖 Manual: Export ADIF');
      label.textContent = tr(cab ? '📖 Manual: your Cabrillo entry' : '📖 Manual: Export ADIF',
        cab ? '📖 Инструкция: отчёт Cabrillo' : '📖 Инструкция: Экспорт ADIF');
    }
    const btn = $('exp-adif').querySelector('span');
    if (btn) {
      btn.setAttribute('data-ru', cab ? 'ОТЧЁТ CABRILLO' : 'ЭКСПОРТ');
      btn.setAttribute('data-en', cab ? 'CABRILLO ENTRY' : 'EXPORT');
      btn.textContent = tr(cab ? 'CABRILLO ENTRY' : 'EXPORT', cab ? 'ОТЧЁТ CABRILLO' : 'ЭКСПОРТ');
    }
  }

  function saveCabrilloSettings() {
    station.cabrillo = {
      contest: $('cab-contest').value.trim().toUpperCase(),
      ops: $('cab-ops').value,
      power: $('cab-power').value,
      name: $('cab-name').value.trim()
    };
    persistStation();
  }

  async function exportAdif() {
    const list = entriesForExport();
    if (!list.length) {
      setDataStatus(tr('Nothing matches that selection', 'Под этот выбор ничего не подходит'), 'err');
      return;
    }
    const cabrillo = exportFormat() === 'cabrillo';
    if (cabrillo) saveCabrilloSettings();
    const call = $('exp-station').value || currentMyCall();
    if (cabrillo && !call) {
      setDataStatus(tr('Which callsign was the entry made under? Pick it above.',
        'Под каким позывным отчёт? Выберите его выше.'), 'err');
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const who = $('exp-station').value ? `-${$('exp-station').value.replace(/\//g, '_')}` : '';
    const name = cabrillo
      ? `${call.replace(/\//g, '_')}-${(cabrilloSettings().contest || 'contest').toLowerCase()}.log`
      : `qso-log-${stamp}${who}.adi`;
    const text = cabrillo ? buildCabrillo(list, call) : buildAdif(list);

    // The app asks where and says whether it was saved — "saved" only when
    // it was (it used to say so even after Cancel). A browser just downloads.
    let where = '';
    if (window.desktopApp && window.desktopApp.saveFile) {
      where = await window.desktopApp.saveFile(name, new TextEncoder().encode(text));
      if (!where) { setDataStatus(''); return; }
    } else {
      download(name, text, 'text/plain;charset=utf-8');
    }
    setDataStatus('');

    // A full export counts as a backup; partial ones don't reset the reminder.
    const whole = !cabrillo && selectedScope() === 'all' && !$('exp-station').value;
    if (whole) {
      station.exportedCount = entries.length;
      persistStation();
      renderBackupNote();
    }
    const scope = selectedScope();
    const what = scope === 'selected' ? tr('Selected', 'Отмеченные')
      : scope === 'range' ? tr('A period', 'За период') : tr('The whole log', 'Весь журнал');
    showResult({
      from: 'export',
      backTo: 'main',
      heading: where ? tr('File saved', 'Файл сохранён') : tr('File downloaded', 'Файл скачан'),
      lines: [[`${what}${$('exp-station').value ? ` · ${$('exp-station').value}` : ''}`, `${list.length} QSO`],
        cabrillo ? tr(`Cabrillo entry for ${cabrilloSettings().contest || 'the contest'} — check the exchange, then send it to the organiser.`,
          `Отчёт Cabrillo${cabrilloSettings().contest ? ` для ${cabrilloSettings().contest}` : ''} — проверьте обмен и отправьте организатору.`) : '',
        !cabrillo && whole ? tr('This is your backup, too.', 'Это и есть ваша резервная копия.') : ''],
      path: where,
      primary: where && window.desktopApp.showFile
        ? { label: tr('SHOW THE FILE', 'ПОКАЗАТЬ ФАЙЛ'), run: () => window.desktopApp.showFile(where) } : null
    });
  }

  /**
   * Fills gaps in a record already in the logbook from an incoming one.
   * Re-importing a file repairs earlier imports — a name cut short by a
   * mis-counted field length gets replaced by the full one — without ever
   * overwriting something longer or creating a duplicate contact.
   */
  function enrich(existing, incoming) {
    let changed = false;

    ['name', 'country', 'grid', 'rda', 'qth', 'notes', 'myRda', 'myQth', 'email'].forEach(field => {
      const have = existing[field] || '';
      const next = repairMojibake(incoming[field] || '');
      if (next && (next.length > have.length || (repairMojibake(have) !== have && next !== have))) {
        existing[field] = next;
        changed = true;
      }
    });

    if (!existing.freq && incoming.freq) {
      existing.freq = incoming.freq;
      existing.freqHz = incoming.freqHz;
      changed = true;
    }

    if (mergeQslStatus(existing, incoming)) changed = true;

    if (changed) existing.updatedAt = new Date().toISOString();
    return changed;
  }

  // ---------------------------------------------------------------------
  // My callsign on contacts
  //
  // Every contact records which of my callsigns it was made under
  // (myCallsign) — the log's MY CALL column. A log brought in from elsewhere
  // can have that wrong, all of it under today's callsign when half was made
  // under an old one. This page puts it right for a period at once. The QSL
  // marks stay: this is only saying who I was, not a new contact.
  // ---------------------------------------------------------------------

  // "(none)" in the list: contacts with no callsign of mine recorded. Its
  // own value, not an empty one — an empty value read back as "any".
  const MC_NONE = '-none-';

  function myCallFixMatches() {
    const from = dateValue($('mc-from'));
    const to = dateValue($('mc-to'));
    const old = $('mc-old').value;
    return entries.filter(e =>
      (!from || e.date >= from) && (!to || e.date <= to) &&
      (old === '*' || (e.myCallsign || MC_NONE) === old));
  }

  function renderMyCallFix() {
    const select = $('mc-old');
    const current = select.value || '*';
    const counts = {};
    entries.forEach(e => { const k = e.myCallsign || MC_NONE; counts[k] = (counts[k] || 0) + 1; });
    select.innerHTML = `<option value="*">${tr('any', 'любым')}</option>` + Object.keys(counts).sort()
      .map(k => `<option value="${escapeHtml(k)}">${escapeHtml(k === MC_NONE ? tr('(none)', '(не указан)') : k)} · ${counts[k]}</option>`).join('');
    select.value = [...select.options].some(o => o.value === current) ? current : '*';
    const to = normalizeCallsign($('mc-new').value);
    const n = myCallFixMatches().filter(e => (e.myCallsign || '') !== to).length;
    $('mc-count').textContent = n;
    $('mc-apply').disabled = !to || !n;
  }

  async function applyMyCallFix() {
    const to = normalizeCallsign($('mc-new').value);
    if (!to) return;
    const list = myCallFixMatches().filter(e => (e.myCallsign || '') !== to);
    if (!list.length) return;
    const now = new Date().toISOString();
    for (const qso of list) {
      qso.myCallsign = to;
      qso.updatedAt = now;
    }
    await saveAll();
    render();
    renderMyCallFix();
    paintStatus($('mc-status'), '');
    showResult({
      from: 'mycall',
      backTo: 'main',
      heading: tr('Done', 'Готово'),
      lines: [[tr(`Now under ${to}`, `Теперь под ${to}`), `${list.length} QSO`]],
      primary: { label: tr('SHOW IN THE LOG', 'ПОКАЗАТЬ В ЖУРНАЛЕ'), run: showInLog }
    });
  }

  // ---------------------------------------------------------------------
  // Import: first what's in the file, then what of it goes in
  // ---------------------------------------------------------------------

  let pendingImport = null;   // { name, items: [{ qso, fileCall }] }
  let importTake = new Map();  // callsign of mine in the file ('' — not given) → take it or not

  /** Back to "choose a file": the page as it opens. */
  function resetImport() {
    pendingImport = null;
    $('imp-preview').hidden = true;
    $('imp-start').hidden = false;
    setImportStatus('');
  }

  async function readImportFile(file) {
    // The previous file's summary and button go while this one is read.
    pendingImport = null;
    $('imp-preview').hidden = true;
    setImportStatus(tr('reading…', 'читаю…'), 'pending');
    try {
      const records = parseAdif(new Uint8Array(await file.arrayBuffer()));
      const items = records.map(rec => ({
        qso: qsoFromAdif(rec),
        fileCall: normalizeCallsign(rec.station_callsign || rec.operator || '')
      })).filter(it => it.qso.callsign && it.qso.date);
      if (!items.length) throw new Error(tr('no contacts in it', 'в нём нет связей'));
      pendingImport = { name: file.name, items };
      importTake = new Map(items.map(it => [it.fileCall, true]));
      setImportStatus('');
      setDateValue($('imp-from'), '');
      setDateValue($('imp-to'), '');
      $('imp-range-box').hidden = true;
      $('imp-range-open').hidden = false;
      $('imp-as').value = currentMyCall();
      $('imp-start').hidden = true;
      renderImportPreview();
    } catch (err) {
      pendingImport = null;
      $('imp-preview').hidden = true;
      $('imp-start').hidden = false;
      setImportStatus(tr(`Could not read that file: ${err.message}`, `Не удалось прочитать файл: ${err.message}`), 'err');
    }
  }

  function importSelection() {
    if (!pendingImport) return [];
    const from = dateValue($('imp-from'));
    const to = dateValue($('imp-to'));
    return pendingImport.items.filter(it => importTake.get(it.fileCall) !== false &&
      (!from || it.qso.date >= from) && (!to || it.qso.date <= to));
  }

  /**
   * What IMPORT would do, worked out before it's pressed: the new contacts,
   * the ones already in the log (and in how many of those the file would
   * fill something in). Where the file doesn't say whose a contact is, it
   * goes under the callsign asked for above.
   */
  function importPlan() {
    const as = normalizeCallsign($('imp-as').value);
    const byKey = new Map(entries.map(e => [dedupeKey(e), e]));
    const fresh = new Map();
    const known = [];
    let fill = 0;
    for (const it of importSelection()) {
      const qso = Object.assign({}, it.qso, { myCallsign: it.fileCall || as });
      const key = dedupeKey(qso);
      const existing = byKey.get(key);
      if (existing) {
        known.push([existing, qso]);
        if (enrich(Object.assign({}, existing), qso)) fill++;
      } else if (fresh.has(key)) {
        enrich(fresh.get(key), qso);   // twice in the file: one contact
      } else {
        fresh.set(key, qso);
      }
    }
    return { fresh: [...fresh.values()], known, fill };
  }

  function renderImportPreview() {
    if (!pendingImport) return;
    $('imp-preview').hidden = false;
    const { name, items } = pendingImport;

    // The file: name, size, dates — and whose, when it's one callsign.
    const groups = new Map();
    items.forEach(it => {
      const g = groups.get(it.fileCall) || { n: 0, first: it.qso.date, last: it.qso.date };
      g.n++;
      if (it.qso.date < g.first) g.first = it.qso.date;
      if (it.qso.date > g.last) g.last = it.qso.date;
      groups.set(it.fileCall, g);
    });
    const span = g => g.first === g.last ? formatDateHuman(g.first) : `${formatDateHuman(g.first)} — ${formatDateHuman(g.last)}`;
    const all = { first: items.reduce((m, it) => (it.qso.date < m ? it.qso.date : m), items[0].qso.date),
      last: items.reduce((m, it) => (it.qso.date > m ? it.qso.date : m), items[0].qso.date) };
    const calls = [...groups.keys()];
    $('imp-file-name').textContent = name;
    $('imp-file-sub').textContent = `${items.length} ${contactsWord(items.length)} · ${span(all)}` +
      (calls.length === 1 && calls[0] ? ` · ${tr('as', 'от')} ${calls[0]}` : '');

    // More than one callsign of mine (or some with none): which to take.
    $('imp-mine-box').hidden = calls.length < 2;
    if (calls.length >= 2) {
      $('imp-mine').innerHTML = calls.sort((x, y) => (x ? (y ? x.localeCompare(y) : -1) : 1)).map(call => {
        const g = groups.get(call);
        const on = importTake.get(call) !== false;
        return `<div class="qso-set-row is-plain is-toggle" data-call="${escapeHtml(call)}">
          <span class="qso-set-text"><span class="qso-set-name">${escapeHtml(call || tr('Callsign not given', 'Позывной не записан'))}</span>
          <span class="qso-set-desc">${g.n} ${contactsWord(g.n)} · ${span(g)}</span></span>
          <button type="button" class="qso-switch${on ? ' is-on' : ''}" role="switch" aria-checked="${on}"></button></div>`;
      }).join('');
    }

    // Some whose callsign the file doesn't give, and they're being taken: ask.
    $('imp-as-box').hidden = !(groups.has('') && importTake.get('') !== false);

    const { fresh, known, fill } = importPlan();
    $('imp-new').textContent = tr(`new — ${fresh.length}`, `новых — ${fresh.length}`);
    $('imp-old').textContent = known.length
      ? tr(`already in the log — ${known.length}${fill ? `, ${fill} of them get details filled in` : ', skipped'}`,
        `уже есть в журнале — ${known.length}${fill ? `, в ${fill} допишу сведения` : ', пропущу'}`)
      : '';
    const go = $('imp-go');
    go.disabled = !fresh.length && !fill;
    go.textContent = fresh.length
      ? tr(`ADD TO THE LOG · ${fresh.length} QSO`, `ДОБАВИТЬ В ЖУРНАЛ · ${fresh.length} QSO`)
      : fill ? tr(`FILL IN · ${fill} QSO`, `ДОПИСАТЬ СВЕДЕНИЯ · ${fill} QSO`)
        : tr('ALL OF IT IS IN THE LOG ALREADY', 'ВСЁ ЭТО УЖЕ ЕСТЬ В ЖУРНАЛЕ');
  }

  async function runImport() {
    if (!pendingImport) return;
    const { fresh, known } = importPlan();
    if (!fresh.length && !known.length) return;
    try {
      let updated = 0;
      known.forEach(([existing, qso]) => { if (enrich(existing, qso)) updated++; });
      entries = sortEntries(entries.concat(fresh));
      await saveAll();
      render();
      resetImport();
      // The imported contacts change how many are missing a name or a town,
      // and that count is on the button back in the list.
      refreshFillCount();
      renderSettingsCounts();
      autoBackup();                // a log that just arrived is worth keeping
      console.info(`[data] import: ${fresh.length} added, ${known.length} already there (${updated} filled in)`);
      showResult({
        from: 'import',
        backTo: 'main',
        heading: fresh.length ? tr('Done — the contacts are in the log', 'Готово — связи в журнале')
          : tr('Done — details filled in', 'Готово — сведения дописаны'),
        lines: [[tr('Added', 'Добавлено'), fresh.length],
          known.length ? [tr('Already in the log', 'Уже были в журнале'), `${known.length}${updated ? tr(` — ${updated} with details filled in`, ` — в ${updated} дописаны сведения`) : ''}`] : ''],
        primary: { label: tr('SHOW IN THE LOG', 'ПОКАЗАТЬ В ЖУРНАЛЕ'), run: showInLog }
      });
    } catch (err) {
      showResult({ from: 'import', ok: false, heading: tr('Not imported', 'Не получилось'), lines: [err.message] });
    }
  }

  // ---------------------------------------------------------------------
  // Filling gaps from QRZ
  //
  // Imported files often carry little more than a callsign and a time. This
  // walks the incomplete records and asks QRZ for the rest. It runs one at a
  // time because QRZ.RU permits one request every three seconds, and it can
  // be stopped mid-way without losing what's already been filled.
  // ---------------------------------------------------------------------

  let fillRunning = false;
  let fillStop = false;

  /**
   * Contacts worth asking the books about again. The locator is deliberately
   * not on this list: abroad it is the one thing nobody has — QRZ.RU keeps no
   * locator field for foreign records, QRZ.com without the paid subscription
   * gives the address but not the coordinates, and HamQTH only has the
   * stations that registered there. Counting a contact as unfinished for the
   * want of a locator meant every foreign contact stayed in the queue for
   * ever, however much had in fact been written down — which read as "it
   * isn't filling anything in at all".
   */
  function incompleteEntries() {
    return entries.filter(e =>
      e.callsign && (!e.name || !e.country || !e.qth));
  }

  function refreshFillCount() {
    const count = incompleteEntries().length;
    $('fill-count').textContent = count;
    $('fill-qrz').disabled = count === 0 || fillRunning;
  }

  function setFillStatus(text, kind) {
    if (text && kind !== 'pending') console.info(`[fill] ${text}`);
    paintStatus($('fill-status'), text, kind);
  }

  async function fillFromQrz() {
    if (fillRunning) return;

    if (auth.mode !== 'key') {
      setFillStatus(tr('Sign in first — lookup is off', 'Сначала войдите — поиск выключен'), 'err');
      return;
    }

    const todo = incompleteEntries();
    if (!todo.length) return;


    fillRunning = true;
    fillStop = false;
    $('fill-stop').hidden = false;
    $('fill-qrz').disabled = true;

    let filled = 0;      // something was actually written down
    let unknown = 0;     // no book knows this callsign
    let nothingNew = 0;  // found, but it had nothing we were missing

    for (let i = 0; i < todo.length; i++) {
      if (fillStop) break;

      const qso = todo[i];
      setFillStatus(`${i + 1} ${tr('of', 'из')} ${todo.length} — ${qso.callsign}…`, 'pending');

      try {
        const res = await fetch('/api/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callsign: qso.callsign, accessKey: auth.accessKey || '' })
        });
        const data = await res.json();

        if (data.error) {
          unknown++;
          console.info(`[fill] ${qso.callsign}: ${data.error}`);
          continue;
        }

        const before = JSON.stringify([qso.name, qso.country, qso.qth, qso.grid, qso.rda]);

        if (!qso.name && data.name) qso.name = data.name;
        if (!qso.country && data.country) qso.country = data.country;
        if (!qso.qth && data.city) qso.qth = data.city;
        if (!qso.grid && data.grid) qso.grid = data.grid;
        if (!qso.rda && data.rda) qso.rda = data.rda;

        if (JSON.stringify([qso.name, qso.country, qso.qth, qso.grid, qso.rda]) !== before) {
          qso.updatedAt = new Date().toISOString();
          await saveEntry(qso);
          filled++;
          if (filled % 5 === 0) render();
        } else {
          nothingNew++;
          console.info(`[fill] ${qso.callsign}: found [${data.source || 'qrz'}], nothing to add`);
        }
      } catch (err) {
        setFillStatus(tr('Lookup unavailable — stopped', 'Поиск недоступен — остановлено'), 'err');
        break;
      }
    }

    fillRunning = false;
    $('fill-stop').hidden = true;
    render();
    refreshFillCount();

    // Three different endings, and lumping them together as "not found" left
    // the owner guessing: a callsign no book knows is not the same as one
    // that was found and simply had nothing we were missing.
    const parts = [tr(`Filled in ${filled}`, `Дополнено ${filled}`)];
    if (unknown) parts.push(tr(`${unknown} not in the books`, `${unknown} нет в справочниках`));
    if (nothingNew) parts.push(tr(`${nothingNew} had nothing to add`, `у ${nothingNew} добавить нечего`));
    setFillStatus(
      (fillStop ? tr('Stopped. ', 'Остановлено. ') : tr('Done. ', 'Готово. ')) + parts.join(' · '),
      filled ? 'ok' : ''
    );
  }

  // ---------------------------------------------------------------------
  // Access code
  // ---------------------------------------------------------------------

  function setSigninStatus(text, kind) {
    const el = $('signin-status');
    el.textContent = text || '';
    el.className = 'qso-card-status' + (kind ? ' ' + kind : '');
  }

  async function submitSignin() {
    const key = $('in-access-key').value.trim();
    if (!key) { setSigninStatus(tr('Enter the access code', 'Введите код доступа'), 'err'); return; }

    const btn = $('signin-submit');
    btn.disabled = true;
    setSigninStatus(tr('checking…', 'проверяю…'), 'pending');
    try {
      const res = await fetch('/api/verify-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessKey: key })
      });
      const data = await res.json();
      if (!data.ok) { setSigninStatus(data.error || tr('Wrong access code', 'Неверный код'), 'err'); return; }
      saveAuth({ mode: 'key', accessKey: key });
      setSigninStatus(tr('signed in', 'вход выполнен'), 'ok');
      setTimeout(() => { closeOverlay('qso-signin'); initQrzSetup(); }, 400);
    } catch (err) {
      setSigninStatus(tr('Could not reach the server', 'Нет связи с сервером'), 'err');
    } finally {
      btn.disabled = false;
    }
  }

  async function initAuth() {
    loadAuth();

    try {
      const res = await fetch('/api/config');
      const cfg = await res.json();
      accessKeyRequired = Boolean(cfg.accessKeyRequired);
      if (cfg.version) $('about-version').textContent = cfg.version;
    } catch (e) { /* offline — keep the stored state */ }

    if (!accessKeyRequired) {
      if (auth.mode !== 'key') saveAuth({ mode: 'key', accessKey: '' });
      $('qso-account-btn').hidden = true;
      updateSubtitle();
      initQrzSetup();
      return;
    }

    updateSubtitle();

    $('signin-submit').addEventListener('click', submitSignin);
    $('in-access-key').addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); submitSignin(); }
    });
    $('signin-skip').addEventListener('click', () => {
      saveAuth({ mode: 'none' });
      closeOverlay('qso-signin');
    });
    // The ✕ is there once there is something to go back to — at the very
    // first run the answer is the point of the window, so it isn't.
    $('signin-x').addEventListener('click', () => closeOverlay('qso-signin'));
    $('qso-account-btn').addEventListener('click', () => {
      $('in-access-key').value = auth.accessKey || '';
      setSigninStatus('');
      $('signin-x').hidden = auth.mode !== 'key';
      openOverlay('qso-signin');
    });
    let seen = false;
    try { seen = localStorage.getItem(AUTH_STORAGE) !== null; } catch (e) {}
    if (!seen) openOverlay('qso-signin');
    else if (auth.mode === 'key') initQrzSetup();
    // If they'd previously skipped the access code, lookup is off regardless
    // of QRZ credentials, so there's nothing to offer setting up here.
  }

  // ---------------------------------------------------------------------
  // QRZ.RU / QRZ.com account setup
  //
  // Asked once, right in the app, instead of editing .env by hand — and only
  // once the access-code gate (if any) is already settled, so the two
  // overlays never compete for the screen. Answering "skip" here still leaves
  // a fully working offline logbook; entries just aren't looked up.
  // ---------------------------------------------------------------------

  // A password that's saved shows as dots — the page never has the password
  // itself, so the field holds this stand-in. Clicking in clears it for a
  // new one; left empty, the dots come back and the saved password stays.
  const SAVED_PASSWORD = 'saved-password';

  function showSavedPassword(input, saved) {
    input.dataset.saved = saved ? '1' : '';
    input.value = saved ? SAVED_PASSWORD : '';
    input.placeholder = '';
  }

  /** What to send for a password field: '' for the untouched dots (keep the saved one). */
  function passwordValue(input) {
    return input.value === SAVED_PASSWORD ? '' : input.value.trim();
  }

  function wireSavedPassword(input) {
    input.addEventListener('focus', () => {
      if (input.value !== SAVED_PASSWORD) return;
      input.value = '';
      input.placeholder = tr('saved — leave empty to keep it', 'сохранён — оставьте пустым');
    });
    input.addEventListener('blur', () => {
      if (input.dataset.saved === '1' && !input.value) {
        input.value = SAVED_PASSWORD;
        input.placeholder = '';
      }
    });
  }

  const QRZ_SETUP_SEEN_KEY = 'qso-qrz-setup-seen';

  function markQrzSetupSeen() {
    try { localStorage.setItem(QRZ_SETUP_SEEN_KEY, '1'); } catch (e) {}
  }

  async function fetchQrzStatus() {
    try {
      const res = await fetch('/api/qrz-status');
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  function setQrzSetupStatus(text, kind) {
    paintStatus($('qrz-setup-status'), text, kind);
  }

  /** Fills the logins page in from what the server last said. */
  function renderQrzPage(status) {
    const s = status || {};
    // Passwords never come back from the server: a saved one shows as dots,
    // and left as it is it stays.
    [['ru', s.ruConfigured], ['ham', s.hamConfigured], ['com', s.comConfigured]].forEach(([key, saved]) => {
      $(`qrz-${key}-user`).value = s[`${key}Username`] || '';
      showSavedPassword($(`qrz-${key}-pass`), saved);
    });
    setQrzSetupStatus('');
  }

  async function saveQrzSetup() {
    const body = {
      ruUsername: $('qrz-ru-user').value.trim(),
      ruPassword: passwordValue($('qrz-ru-pass')),
      comUsername: $('qrz-com-user').value.trim(),
      comPassword: passwordValue($('qrz-com-pass')),
      hamUsername: $('qrz-ham-user').value.trim(),
      hamPassword: passwordValue($('qrz-ham-pass'))
    };
    if (auth.mode === 'key') body.accessKey = auth.accessKey || '';

    const btn = $('qrz-setup-save');
    btn.disabled = true;
    setQrzSetupStatus(tr('saving…', 'сохраняю…'), 'pending');
    try {
      const res = await fetch('/api/qrz-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setQrzSetupStatus(
          data.needsAuth
            ? tr('Sign in first — tap ⚙ for the access code', 'Сначала введите код доступа')
            : (data.error || tr('Could not save', 'Не удалось сохранить')),
          'err'
        );
        return;
      }

      markQrzSetupSeen();
      applyQrzStatus(data);
      refreshQrzAccountsStatus(data);
      setQrzSetupStatus('');
      showSettingsPage('main', true);
      toast(tr('✓ Logins saved', '✓ Логины сохранены'));
    } catch (err) {
      setQrzSetupStatus(tr('Could not reach the server', 'Нет связи с сервером'), 'err');
    } finally {
      btn.disabled = false;
    }
  }

  // What the settings last heard about the QRZ logins — kept so the line can
  // be redrawn in the other language without asking the server again.
  let qrzAccountsStatus;   // undefined: not asked yet · null: server unreachable

  async function refreshQrzAccountsStatus(status) {
    qrzAccountsStatus = status || await fetchQrzStatus();
    if (qrzAccountsStatus) applyQrzStatus(qrzAccountsStatus);
    renderQrzAccountsStatus();
  }

  function renderQrzAccountsStatus() {
    const el = $('qrz-accounts-status');
    const s = qrzAccountsStatus;
    if (s === undefined) { el.textContent = tr('checking…', 'проверяю…'); return; }
    if (!s) {
      el.textContent = tr('Could not reach the server to check.', 'Не удалось связаться с сервером.');
      return;
    }
    const notSet = tr('not set', 'не задан');
    el.textContent = [
      `QRZ.RU — ${s.ruConfigured ? s.ruUsername : notSet}`,
      `HamQTH — ${s.hamConfigured ? s.hamUsername : notSet}`,
      `QRZ.com — ${s.comConfigured ? s.comUsername : notSet}`
    ].join(' · ');
  }

  async function initQrzSetup() {
    let seen = false;
    try { seen = localStorage.getItem(QRZ_SETUP_SEEN_KEY) !== null; } catch (e) {}

    const status = await fetchQrzStatus();
    if (!status) return;   // offline right now — try again on the next launch

    applyQrzStatus(status);

    if (status.ruConfigured || status.comConfigured || status.hamConfigured) {
      markQrzSetupSeen();
      return;
    }
    // Not configured — the DATA button now glows and the subtitle says so
    // too, so skipping here is never a dead end even if this card doesn't
    // pop up again on its own.
    if (seen) return;

    // A first run with nothing set up: settings open straight on the logins.
    openDataPanel();
    renderQrzPage(status);
    showSettingsPage('qrz');
    markQrzSetupSeen();
  }

  // ---------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------

  function wire() {
    ['s-callsign', 's-rda', 's-qth'].forEach(id => {
      $(id).addEventListener('change', readStationFields);
      $(id).addEventListener('blur', readStationFields);
      $(id).addEventListener('input', updateMyPhonetic);
    });
    $('s-callsign').addEventListener('input', refreshPortableButtons);
    // MY CALL in the log tells today's callsign from earlier ones.
    $('s-callsign').addEventListener('change', render);
    $('s-geo-btn').addEventListener('click', detectMyLocation);

    // The browser can restore what was typed into these fields after the page
    // has already loaded, without firing 'input' — so the readings are taken
    // once more when everything has settled.
    window.addEventListener('load', updateMyPhonetic);

    $('ru-phonetics-btn').addEventListener('click', () =>
      setRuPhonetics(!station.ruPhonetics, true));

    $('phonetics-toggle-btn').addEventListener('click', () =>
      setShowPhonetics(!station.showPhonetics, true));

    $('qso-log-toggle').addEventListener('click', () =>
      setLogPanelOpen($('qso-log-panel').hidden));

    $('s-contest-btn').addEventListener('click', () => {
      setContestMode(!station.contest, true);
      if (station.contest) $('f-callsign').focus();
    });

    // Serials are digits only, and Enter in either one finishes the contact
    // just like anywhere else — that's the whole contest rhythm: callsign,
    // Tab, their number, Enter.
    ['f-nr-sent', 'f-nr-rcvd'].forEach(id => {
      $(id).addEventListener('input', () => {
        const digits = $(id).value.replace(/[^0-9]/g, '');
        if (digits !== $(id).value) $(id).value = digits;
      });
      $(id).addEventListener('keydown', ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); logNow(); }
      });
    });

    $('f-nr-reset').addEventListener('click', () => askConfirm(
      tr('Start the serial again from 001?', 'Начать нумерацию заново с 001?'),
      tr(`The number you send now is ${formatSerial(station.serial)}.`,
        `Сейчас вы отправляете номер ${formatSerial(station.serial)}.`),
      tr('RESET', 'СБРОСИТЬ'), resetSerial));

    // A serial typed by hand is where the count carries on from.
    $('f-nr-sent').addEventListener('blur', () => {
      const n = Number($('f-nr-sent').value.trim());
      if (Number.isFinite(n) && n > 0) {
        station.serial = n;
        persistStation();
        $('f-nr-sent').value = formatSerial(n);
      }
    });

    // The hand-entry row writes straight through to the fields the QSO is
    // logged from, so there is only ever one copy of the truth.
    // The hand-entry name and QTH follow Russian mode alone (see
    // formatTypedDetail); the detail fields behind them keep the older rule,
    // by the callsign's country. The hand-entry pair is wired before the
    // mirror below, so what reaches the real field is already converted.
    ['f-q-name', 'f-q-qth'].forEach(id => attachLiveFormat($(id), formatTypedDetail));
    ['f-name', 'f-country', 'f-qth'].forEach(id => {
      attachLiveFormat($(id), raw => formatDetailText(raw, $('f-callsign').value));
    });
    attachLiveFormat($('f-notes'), formatNotesText);

    [['f-q-name', 'f-name'], ['f-q-qth', 'f-qth'], ['f-q-rda', 'f-rda']].forEach(([from, to]) => {
      $(from).addEventListener('input', () => {
        $(to).value = $(from).value;
        renderCorrespondent(null);   // the panel shows the name as it is typed
      });
    });
    attachLatinInput($('f-q-rda'), 'rda');

    ['f-q-name', 'f-q-qth', 'f-q-rda'].forEach(id => {
      $(id).addEventListener('keydown', ev => chainTab(ev, mainTabChain()));
    });

    attachLatinInput($('f-callsign'), 'callsign');
    attachLatinInput($('s-callsign'), 'callsign');
    attachLatinInput($('s-rda'), 'rda');
    attachLatinInput($('f-rda'), 'rda');
    attachLatinInput($('f-grid'), 'grid');
    attachLatinInput($('s-qth'), 'grid');

    $('f-now').addEventListener('click', setNow);

    // A hand-edited date or time is a deliberate override — stop tracking
    // the clock until NOW is pressed again or the form resets for a fresh
    // contact.
    $('f-date').addEventListener('input', () => setTimeAuto(false));
    $('f-time').addEventListener('input', () => setTimeAuto(false));
    DATE_FIELDS.concat(TIME_FIELDS).forEach(id => {
      $(id).addEventListener('input', () => maskDateTimeField($(id)));
      $(id).addEventListener('blur', () => tidyDateTimeField($(id)));
    });

    // Band detection updates while typing; reformatting waits until the field
    // is left, so the digits aren't rearranged under your fingers.
    $('f-freq').addEventListener('input', () => applyFrequency(false));
    $('f-freq').addEventListener('blur', () => applyFrequency(true));
    $('f-freq').addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); applyFrequency(true); logNow(); }
    });
    // Clearing leaves the band chip as it is — the band is still the band
    // you're on, only the exact frequency is gone.
    $('f-freq-clear').addEventListener('click', () => {
      $('f-freq').value = '';
      $('f-freq').dispatchEvent(new Event('input', { bubbles: true }));
      $('f-freq').focus();
    });

    renderModeMenu();
    $('f-mode-btn').addEventListener('click', ev => {
      ev.stopPropagation();
      const menu = $('f-mode-menu');
      menu.hidden = !menu.hidden;
    });

    renderBandMenu();
    $('f-band-btn').addEventListener('click', ev => {
      ev.stopPropagation();
      const menu = $('f-band-menu');
      menu.hidden = !menu.hidden;
    });

    document.addEventListener('click', () => {
      $('f-mode-menu').hidden = true;
      $('f-band-menu').hidden = true;
    });

    $('f-callsign').addEventListener('input', () => {
      updateSubmitState();
      updatePhonetic();
      if (!editingId) clearStaleDetailFields();
      renderCorrespondent(null);
      scheduleLookup();
    });
    $('f-callsign').addEventListener('blur', () => runLookup(false));
    $('f-callsign').addEventListener('keydown', ev => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        logNow();
        return;
      }
      addGroupFromCallsign(ev, $('f-callsign'));
    });

    LOCK_FIELDS.forEach(id => {
      const input = $(id);
      // Only the pencil opens it: a double click landed too easily for a
      // field that holds the callsign every contact is logged under.
      $(`${id}-edit`).addEventListener('click', () => openStationField(input));
      // A click on a closed field does nothing at all — no caret, no
      // selection, no amber frame. Otherwise it looks ready to be typed in
      // and then swallows every keystroke.
      input.addEventListener('mousedown', ev => { if (input.readOnly) ev.preventDefault(); });
      input.addEventListener('blur', () => { if (input.value.trim()) setFieldLocked(input, true); });
    });

    wireSuffixButton($('f-portable'), $('f-callsign'));
    wireSuffixButton($('s-portable'), $('s-callsign'));
    // No separate look-up button: the lookup runs by itself as the callsign
    // is typed (and again on Enter or when the field loses focus), so the
    // space next to CALLSIGN goes to the group button instead.
    ['f-callsign', 'f-nr-rcvd', 'f-rst-sent', 'f-rst-rcvd'].forEach(id => {
      $(id).addEventListener('keydown', ev => chainTab(ev, mainTabChain()));
    });
    // Space in the main station's reports opens the first/next group station,
    // just as it does in its callsign.
    ['f-rst-sent', 'f-rst-rcvd'].forEach(id => {
      attachReportInput($(id));
      $(id).addEventListener('keydown', ev => addGroupFromReport(ev, $('f-callsign')));
    });

    $('f-clear-call').addEventListener('click', clearCallsignField);
    $('f-group-btn').addEventListener('click', () => addGroupStation());
    $('f-group-add').addEventListener('click', () => addGroupStation());

    $('f-worked').addEventListener('click', () =>
      showHistory(normalizeCallsign($('f-callsign').value)));

    $('qso-form').addEventListener('submit', submitForm);
    $('f-cancel-edit').addEventListener('click', exitEditMode);

    $('qso-search').addEventListener('input', ev => {
      searchTerm = ev.target.value.trim().toLowerCase();
      render();
    });
    $('qso-search-clear').addEventListener('click', () => {
      $('qso-search').value = '';
      searchTerm = '';
      render();
    });

    // Opting out lasts only while this callsign is in the field: entering the
    // next one narrows the log again, which is what you want on the next dupe.
    $('qso-dupe-filter-toggle').addEventListener('click', () => {
      dupeFilterOff = !dupeFilterOff;
      render();
    });

    $('qso-pick-all').addEventListener('change', ev => {
      const list = visibleEntries();
      if (ev.target.checked) list.forEach(e => selected.add(e.id));
      else list.forEach(e => selected.delete(e.id));
      render();
    });

    $('qso-data-btn').addEventListener('click', openDataPanel);
    $('qso-subtitle').addEventListener('click', () => {
      if ($('qso-subtitle').classList.contains('needs-qrz')) openDataPanel();
    });
    $('data-close').addEventListener('click', () => closeOverlay('qso-data'));
    document.querySelectorAll('#qso-data .qso-set-close').forEach(btn =>
      btn.addEventListener('click', () => closeOverlay('qso-data')));

    // Settings' pages: a row with › opens its page, ‹ comes back to the list.
    document.querySelectorAll('#qso-data [data-page]').forEach(row =>
      row.addEventListener('click', () => showSettingsPage(row.getAttribute('data-page'), true)));
    document.querySelectorAll('#qso-data .qso-set-back').forEach(btn =>
      btn.addEventListener('click', () => showSettingsPage(btn.getAttribute('data-back') || 'main', true)));

    // LoTW: its page, the location it sends under, the two buttons, the login.
    $('lotw-location').addEventListener('change', () => {
      station.lotwLocation = $('lotw-location').value;
      persistStation();
      renderLotw();
    });
    $('lotw-send').addEventListener('click', sendToLotw);
    $('lotw-check').addEventListener('click', checkLotw);
    document.querySelector('[data-page="lotw-login"]').addEventListener('click', () => {
      const login = (lotwInfo && lotwInfo.login) || {};
      $('lotw-user').value = login.username || '';
      showSavedPassword($('lotw-pass'), Boolean(login.hasPassword));
      paintStatus($('lotw-login-status'), '');
      setTimeout(() => $('lotw-user').focus(), 200);
    });
    $('lotw-login-save').addEventListener('click', saveLotwLogin);
    ['lotw-user', 'lotw-pass'].forEach(id => $(id).addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); saveLotwLogin(); }
    }));
    attachLatinInput($('lotw-user'), 'text');

    // eQSL: the two buttons and the login.
    $('eqsl-send').addEventListener('click', sendToEqsl);
    $('eqsl-check').addEventListener('click', () => (eqslCards.running ? stopEqslCards() : checkEqsl()));
    document.querySelector('[data-page="eqsl-login"]').addEventListener('click', () => {
      const login = (eqslInfo && eqslInfo.login) || {};
      $('eqsl-user').value = login.username || station.callsign || '';
      showSavedPassword($('eqsl-pass'), Boolean(login.hasPassword));
      $('eqsl-qth').value = login.qth || '';
      paintStatus($('eqsl-login-status'), '');
      setTimeout(() => $('eqsl-user').focus(), 200);
    });
    $('eqsl-login-save').addEventListener('click', saveEqslLogin);
    ['eqsl-user', 'eqsl-pass', 'eqsl-qth'].forEach(id => $(id).addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); saveEqslLogin(); }
    }));
    attachLatinInput($('eqsl-user'), 'callsign');

    // QSL by e-mail: the card, the mailbox, the letter — and the sending window.
    document.querySelector('[data-page="card"]').addEventListener('click', renderCardSettings);
    document.querySelectorAll('input[name="card-kind"]').forEach(r => r.addEventListener('change', () => {
      cardSettings().kind = r.value;
      persistStation();
      renderCardSettings();
    }));
    $('card-file-btn').addEventListener('click', () => $('card-file').click());
    $('card-file').addEventListener('change', ev => {
      const file = ev.target.files && ev.target.files[0];
      if (file) chooseCardPicture(file);
      ev.target.value = '';
    });
    [['name', 'card-me-name'], ['qth', 'card-me-qth'], ['country', 'card-me-country'], ['cq', 'card-me-cq'], ['itu', 'card-me-itu']]
      .forEach(([k, id]) => $(id).addEventListener('input', () => {
        cardSettings().me[k] = $(id).value.trim();
        persistStation();
        renderCardSettings();
      }));
    $('card-me-fill').addEventListener('click', fillCardMe);
    document.querySelector('[data-page="mail-login"]').addEventListener('click', renderMailLogin);
    $('mail-address').addEventListener('input', updateMailHowto);
    $('mail-save').addEventListener('click', saveMailLogin);
    $('mail-test').addEventListener('click', testMailLogin);
    ['mail-address', 'mail-pass', 'mail-host', 'mail-port'].forEach(id => $(id).addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); saveMailLogin(); }
    }));
    wireSavedPassword($('mail-pass'));
    // An address typed with the Russian layout still on would be rejected with
    // no hint as to why — the same rescue the callsign and QRZ fields have.
    ['mail-address', 'mail-host', 'cs-to'].forEach(id => attachLatinInput($(id), 'text'));
    document.querySelector('[data-page="letter"]').addEventListener('click', renderLetterPage);
    ['letter-subject', 'letter-ru', 'letter-en'].forEach(id => $(id).addEventListener('input', saveLetter));
    // The same name as on the program's card — one field, shown on both pages.
    $('letter-myname').addEventListener('input', () => {
      cardSettings().me.name = $('letter-myname').value.trim();
      persistStation();
    });
    $('letter-reset').addEventListener('click', () => {
      Object.assign(cardSettings(), { subject: '', textRu: '', textEn: '' });
      persistStation();
      renderLetterPage();
      toast(tr('✓ The default text is back', '✓ Текст по умолчанию возвращён'));
    });
    wireCardEditor();
    $('card-layout-btn').addEventListener('click', openCardEditor);
    ['cs-close', 'cs-cancel', 'cs-done-close'].forEach(id => $(id).addEventListener('click', () => closeOverlay('qso-card-send')));
    ['cv-close', 'cv-done'].forEach(id => $(id).addEventListener('click', () => closeOverlay('qso-card-view')));
    $('cv-save').addEventListener('click', saveEqslCardPicture);
    document.querySelectorAll('input[name="cs-mark"]').forEach(r => r.addEventListener('change', drawCardSendPreview));
    document.querySelectorAll('input[name="cs-lang"]').forEach(r => r.addEventListener('change', fillCardSendLetter));
    $('cs-send').addEventListener('click', sendCard);
    $('cs-qrz').addEventListener('click', () => {
      if (cardSendQso) window.open(`https://www.qrz.com/db/${encodeURIComponent(baseCallsign(cardSendQso.callsign))}`, '_blank', 'noopener');
    });

    // HAMLOG: a file out, a file back, and its website.
    $('hamlog-save').addEventListener('click', saveHamlogFile);
    $('hamlog-read').addEventListener('click', () => $('hamlog-file').click());
    $('hamlog-file').addEventListener('change', ev => {
      const file = ev.target.files && ev.target.files[0];
      if (file) readHamlogFile(file);
      ev.target.value = '';
    });
    $('hamlog-site').addEventListener('click', () => window.open(HAMLOG_SITE, '_blank', 'noopener'));
    // A switch row flips from anywhere on it, not only from the switch.
    document.querySelectorAll('#qso-data .qso-set-row.is-toggle').forEach(row => {
      const sw = row.querySelector('.qso-switch');
      row.addEventListener('click', ev => { if (ev.target !== sw) sw.click(); });
    });

    // ⚙ → DEBUG LOG, in the desktop app (the log belongs to it: debug-log.js).
    if (window.desktopApp && window.desktopApp.saveLog) {
      $('debug-log-section').hidden = false;
      $('log-save').addEventListener('click', async () => {
        const saved = await window.desktopApp.saveLog();
        if (saved) {
          paintStatus($('log-status'), tr(`Saved: ${saved}`, `Сохранено: ${saved}`), 'ok');
          toast(tr('✓ A copy of the debug log is saved', '✓ Копия журнала отладки сохранена'));
        }
      });
      $('log-show').addEventListener('click', () => window.desktopApp.showLog());
    }

    $('help-open').addEventListener('click', () => openHelp());
    // 📖 at the foot of a settings page — the manual, opened at that page's
    // own section rather than at the top.
    document.querySelectorAll('[data-help]').forEach(el =>
      el.addEventListener('click', () => openHelp(el.getAttribute('data-help'))));
    $('help-close').addEventListener('click', closeHelp);
    // Keys pressed inside the manual stay in its frame; help.js passes Esc
    // back out as this message.
    window.addEventListener('message', ev => {
      if (ev.origin === location.origin && ev.data === 'r2fel-help-close') closeHelp();
    });
    $('qrz-accounts-edit').addEventListener('click', async () => {
      renderQrzPage(qrzAccountsStatus || {});
      const fresh = await fetchQrzStatus();
      if (fresh && !$('set-page-qrz').hidden) renderQrzPage(fresh);
    });
    $('qrz-setup-save').addEventListener('click', saveQrzSetup);
    document.querySelector('[data-page="card-me"]').addEventListener('click', renderCardSettings);
    ['qrz-ru-pass', 'qrz-ham-pass', 'qrz-com-pass', 'lotw-pass', 'eqsl-pass'].forEach(id => wireSavedPassword($(id)));
    ['qrz-ru-user', 'qrz-ru-pass', 'qrz-ham-user', 'qrz-ham-pass', 'qrz-com-user', 'qrz-com-pass'].forEach(id => {
      $(id).addEventListener('keydown', ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); saveQrzSetup(); }
      });
      // A QRZ login typed with the Russian layout still active would be
      // rejected with no hint as to why — so the same key-position rescue the
      // callsign fields use applies here too, case left untouched.
      attachLatinInput($(id), 'text');
    });

    $('exp-adif').addEventListener('click', exportAdif);
    document.querySelectorAll('input[name="exp-scope"]').forEach(radio =>
      radio.addEventListener('change', onExportChoice));
    document.querySelectorAll('input[name="exp-format"]').forEach(radio =>
      radio.addEventListener('change', renderExportFormat));
    ['cab-contest', 'cab-ops', 'cab-power', 'cab-name'].forEach(id =>
      $(id).addEventListener('change', saveCabrilloSettings));
    attachLatinInput($('cab-contest'), 'text');
    ['exp-from', 'exp-to', 'exp-station'].forEach(id => {
      $(id).addEventListener('input', onExportChoice);
      $(id).addEventListener('change', onExportChoice);
    });
    $('fill-qrz').addEventListener('click', fillFromQrz);
    $('fill-stop').addEventListener('click', () => { fillStop = true; });
    $('imp-btn').addEventListener('click', () => $('imp-file').click());
    $('imp-file').addEventListener('change', ev => {
      const file = ev.target.files && ev.target.files[0];
      if (file) readImportFile(file);
      ev.target.value = '';
    });
    $('imp-other').addEventListener('click', () => $('imp-file').click());
    // Which of my callsigns in the file to take: a row flips its switch.
    $('imp-mine').addEventListener('click', ev => {
      const row = ev.target.closest('[data-call]');
      if (!row) return;
      const call = row.getAttribute('data-call');
      importTake.set(call, importTake.get(call) === false);
      renderImportPreview();
    });
    $('imp-range-open').addEventListener('click', () => {
      $('imp-range-box').hidden = false;
      $('imp-range-open').hidden = true;
    });
    ['imp-from', 'imp-to', 'imp-as'].forEach(id => {
      $(id).addEventListener('input', renderImportPreview);
      $(id).addEventListener('change', renderImportPreview);
    });
    $('imp-go').addEventListener('click', runImport);
    attachLatinInput($('imp-as'), 'callsign');

    // My callsign on contacts.
    ['mc-from', 'mc-to', 'mc-old', 'mc-new'].forEach(id => {
      $(id).addEventListener('input', renderMyCallFix);
      $(id).addEventListener('change', renderMyCallFix);
    });
    $('mc-apply').addEventListener('click', applyMyCallFix);
    attachLatinInput($('mc-new'), 'callsign');
    $('set-open-mycall').addEventListener('click', () => { paintStatus($('mc-status'), ''); renderMyCallFix(); });

    ['history-close', 'history-x'].forEach(id => $(id).addEventListener('click', () => closeOverlay('qso-history')));

    $('confirm-cancel').addEventListener('click', () => {
      const no = pendingNo;
      pendingDelete = null;
      pendingAsk = null;
      pendingNo = null;
      closeOverlay('qso-confirm');
      if (no) no();          // "no" is an answer too, when something was asked
    });
    $('confirm-delete').addEventListener('click', () => {
      if (pendingAsk) {
        const yes = pendingAsk;
        pendingAsk = null;
        pendingNo = null;
        closeOverlay('qso-confirm');
        yes();
        return;
      }
      confirmDelete();
    });
    $('qso-del-selected').addEventListener('click', askDeleteSelected);
    $('clear-all').addEventListener('click', askDeleteAll);

    $('update-check-btn').addEventListener('click', () => setUpdateCheck(!station.updateCheck, true));
    $('set-update-found').addEventListener('click', () => {
      if (station.updateUrl) window.open(station.updateUrl, '_blank', 'noopener');
    });

    initColumnResize();
    applyColWidths();

    document.addEventListener('keydown', ev => {
      if (ev.key === 'F1') {
        ev.preventDefault();
        openHelp();
        return;
      }
      if (ev.key !== 'Escape') return;

      // Anything open on top takes the Esc first — a menu or a dialog
      // closes, and nothing underneath it is touched.
      const menuOpen = !$('f-mode-menu').hidden || !$('f-band-menu').hidden ||
        [...document.querySelectorAll('.qso-suffix-menu')].some(el => !el.hidden);
      const overlayOpen = [...document.querySelectorAll('.qso-overlay')].some(el => !el.hidden);
      // A page inside settings steps back to the list first, like ‹ does.
      if (settingsSubpageOpen() && $('qso-confirm').hidden) {
        const back = document.querySelector('#qso-data .qso-set-page:not([hidden]) .qso-set-back');
        showSettingsPage((back && back.getAttribute('data-back')) || 'main', true);
        return;
      }
      if (menuOpen || overlayOpen) {
        $('f-mode-menu').hidden = true;
        $('f-band-menu').hidden = true;
        closeSuffixMenus();
        ['qso-data', 'qso-history', 'qso-confirm', 'qso-help', 'qso-card-send', 'qso-card-view'].forEach(closeOverlay);
        if (cardEdit) closeCardEditor();
        if (auth.mode === 'key') closeOverlay('qso-signin');
        return;
      }

      // Otherwise Esc is the ✕ for the contact in hand, so the hands never
      // leave the keys: in a group station it removes that station (added
      // one too many — "that's all of us"), anywhere else in the form it
      // clears the main callsign. Outside the form (the station bar, the log
      // search) it does nothing.
      const focus = document.activeElement;
      const inForm = !focus || focus === document.body || $('qso-form').contains(focus);
      if (!inForm) return;

      ev.preventDefault();
      const groupRow = focus && focus.closest ? focus.closest('.qso-group-row') : null;
      if (groupRow) removeGroupRow(groupRow, true);
      else clearCallsignField();
    });
  }

  // ---------------------------------------------------------------------
  // Is there a newer version?
  //
  // Once a day the program asks a small service of the author's. The same
  // call is the head count — how many copies are actually in use, and in
  // which countries — and it carries nothing but a random number this copy
  // invented for itself, its version, its system and its language. No
  // callsign, no log, not one contact (see /api/update in server.js).
  //
  // It is asked about in plain words once, on the first launch after this
  // arrived, and can be turned off in settings at any time. Nothing waits
  // for the answer: no internet, no service, no message — the program goes
  // on exactly as before.
  // ---------------------------------------------------------------------

  /** true when `a` is a later version than `b`: 1.0.14 over 1.0.9. */
  function isNewerVersion(a, b) {
    const pa = String(a || '').split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b || '').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    }
    return false;
  }

  function thisVersion() {
    return ($('about-version').textContent || '').trim();
  }

  /** The line at the foot of settings, and the dot on ⚙ that leads to it. */
  function renderUpdateRow() {
    const latest = station.updateLatest || '';
    const waiting = station.updateCheck === true && latest && isNewerVersion(latest, thisVersion());
    $('set-update-found').hidden = !waiting;
    $('qso-data-btn').classList.toggle('has-update', Boolean(waiting));
    if (!waiting) return;
    $('update-found-name').textContent = tr(`Version ${latest} is out`, `Вышла версия ${latest}`);
    $('update-found-desc').textContent = station.updateUrl
      ? tr('Open the download page', 'Открыть страницу загрузки')
      : tr('Look for it where you got this one', 'Ищите там же, где брали эту');
  }

  async function checkUpdates() {
    if (station.updateCheck !== true) { renderUpdateRow(); return; }
    const day = new Date().toISOString().slice(0, 10);
    if (station.updateCheckedDate === day) { renderUpdateRow(); return; }

    try {
      const res = await fetch(`/api/update?lang=${station.ruPhonetics ? 'ru' : 'en'}`);
      const data = await res.json();
      if (!data || !data.ok) return;            // the service didn't answer — try again tomorrow
      station.updateCheckedDate = day;
      station.updateLatest = data.latest || '';
      station.updateUrl = data.url || '';
      persistStation();
      if (isNewerVersion(station.updateLatest, thisVersion())) {
        console.info(`[update] ${station.updateLatest} is out (this one is ${thisVersion()})`);
      }
      renderUpdateRow();
    } catch (e) { /* offline. Nothing is lost and nothing is said. */ }
  }

  function setUpdateCheck(on, persist) {
    station.updateCheck = Boolean(on);
    renderSwitch('update-check-btn', station.updateCheck);
    if (persist) {
      persistStation();
      console.info(`[settings] update check ${station.updateCheck ? 'on' : 'off'}`);
    }
    if (station.updateCheck) checkUpdates(); else renderUpdateRow();
  }

  /**
   * On by default, and said out loud once rather than asked.
   *
   * The owner's call (17.09.2026): a yes/no card at the first launch costs
   * most of the count — people press "no" to anything they don't expect —
   * and the whole point was to see how many copies are out there. So the
   * check starts switched on, and the first launch says so plainly in the
   * line under the form, with where to turn it off. Nothing is hidden: the
   * same words stand in settings and in both manuals.
   */
  function announceUpdateCheck(tries) {
    if (station.updateCheck === undefined) setUpdateCheck(true, true);
    if (station.updateAnnounced) return;

    // The very first launch has its own cards open (the QRZ logins), and a
    // line behind them is a line nobody reads. It waits for a clear screen,
    // and if that never comes in this session, says it at the next launch.
    const busy = [...document.querySelectorAll('.qso-overlay')].some(el => !el.hidden);
    if (busy) {
      if ((tries || 0) < 60) setTimeout(() => announceUpdateCheck((tries || 0) + 1), 5000);
      return;
    }

    station.updateAnnounced = true;
    persistStation();
    flashSaved(tr('Checking for updates is on — you can turn it off in settings (⚙)',
      'Проверка обновлений включена — выключить можно в настройках (⚙)'), 'quiet');
  }

  async function init() {
    loadStation();
    fillStationFields();
    setNow();
    wire();
    setMode(station.mode || 'SSB', false);
    setBand(station.band || '', false);
    setContestMode(station.contest, false);   // as it was left last session
    setShowPhonetics(station.showPhonetics, false);
    setRuPhonetics(station.ruPhonetics, false);
    applyModeDefaults();
    updateSubmitState();

    await loadEntries();
    if (repairEntries()) {
      await saveAll();
      console.info('[storage] split frequency out of the old band field');
    }
    render();
    initAuth();
    // Once the stored access code is in hand (initAuth reads it before its
    // first await), so a hosted copy's very first weather call carries it.
    updateMyWeather();
    setInterval(tickClock, 1000);
    // Weather moves slowly; a look every ten minutes keeps the figure honest
    // without pestering the service.
    setInterval(updateMyWeather, 10 * 60 * 1000);

    if (usingFallback) {
      console.warn('[app] IndexedDB unavailable — logbook kept in localStorage');
    }

    autoBackup();

    renderSwitch('update-check-btn', station.updateCheck === true);
    renderUpdateRow();
    // A few seconds in: the first-run cards are done with by then, and the
    // program has nothing to wait for.
    setTimeout(() => { announceUpdateCheck(); checkUpdates(); }, 4000);
  }

  init();
  console.info(`R2FEL-LOG build: ${BUILD}`);

  // Offline support. Registers only over HTTPS or localhost — browsers refuse
  // service workers on plain http://, so this quietly does nothing when the
  // app is served from a laptop over the local network.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();

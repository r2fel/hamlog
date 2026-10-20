// Прежний (классический) декодер телеграфа — копия из public/app.js на 02.10.2026,
// перед тем как он был убран из программы (владелец: «старый декодер убрать»).
// Нужен только для сравнений «новый против прежнего» в scratchpad/cw: decode.js,
// suite.js, real.js, noise.js вырезают из этого файла тот же кусок, что раньше
// вырезали из app.js (от «const MORSE = {» до «let cwText»).
  const MORSE = {
    '.-': 'A', '-...': 'B', '-.-.': 'C', '-..': 'D', '.': 'E', '..-.': 'F',
    '--.': 'G', '....': 'H', '..': 'I', '.---': 'J', '-.-': 'K', '.-..': 'L',
    '--': 'M', '-.': 'N', '---': 'O', '.--.': 'P', '--.-': 'Q', '.-.': 'R',
    '...': 'S', '-': 'T', '..-': 'U', '...-': 'V', '.--': 'W', '-..-': 'X',
    '-.--': 'Y', '--..': 'Z',
    '-----': '0', '.----': '1', '..---': '2', '...--': '3', '....-': '4',
    '.....': '5', '-....': '6', '--...': '7', '---..': '8', '----.': '9',
    '.-.-.-': '.', '--..--': ',', '..--..': '?', '.----.': "'", '-.-.--': '!',
    '-..-.': '/', '-.--.': '(', '-.--.-': ')', '.-...': '&', '---...': ':',
    '-.-.-.': ';', '-...-': '=', '.-.-.': '+', '-....-': '-', '..--.-': '_',
    '.-..-.': '"', '...-..-': '$', '.--.-.': '@',
    // The prosigns an operator actually hears on the air, written the way
    // they are written down.
    '...-.-': '<SK>', '.-.-': '<AA>', '...-.': '<SN>', '-.--.': '<KN>',
    '........': '<HH>'
  };

  // The code, sorted by how many elements a letter has: what the search
  // below walks through for every place a letter might start.
  const MORSE_BY_LENGTH = (() => {
    const by = {};
    for (const symbol in MORSE) {
      const len = symbol.length;
      (by[len] = by[len] || []).push({ symbol, ch: MORSE[symbol] });
    }
    return by;
  })();

  // The tone is somewhere in here. Operators set their receivers anywhere
  // from a low growl to a high whistle, and a web SDR in a browser can
  // land well above either: the first signal taken off the air came in at
  // 1270 Hz, and the decoder, hunting only as high as 1200, heard nothing
  // at all — not a wrong letter, not a single one.
  const CW_TONE_LOW = 250;
  const CW_TONE_HIGH = 2700;
  // How long a look at the tone. The longer the look the weaker the signal
  // it can pull out of the noise, but the blunter the timing — so the look
  // follows the speed: about half a dot, which is what a matched filter for
  // on-off keying comes to. Below and above are the limits for 60 and 5
  // words a minute.
  const CW_WINDOW_MIN = 5;
  const CW_WINDOW_MAX = 30;
  const CW_HOP_MS = 2.5;
  const CW_OFFSET = 260;          // how far off the tone the noise is measured
  const CW_SNR_ON = 2.6;          // tone this much above the neighbouring hiss = a signal
  const CW_SNR_OFF = 1.8;         //   and this little = silence again
  const CW_TONE_AGREE = 3;        // scans in a row a new tone must win before it is followed
  const CW_SNR_FIND = 4;          // and this much to be worth re-tuning to
  const CW_SNR_LETTER = 2.4;      // a letter made of weaker stuff than this is not printed
  const CW_DOT_MIN = 24;          // 50 wpm
  const CW_DOT_MAX = 250;         // 5 wpm
  // The key is judged against how loud the marks around here have been,
  // not only against the hiss. A microphone listening to a speaker hears
  // every mark twice — once from the speaker and once off the walls — and
  // the echo, though 15–20 dB down, is still far above the hiss of a quiet
  // room. By "is there a tone at all" the key never lifts: a 35 ms dot
  // measures 85 ms and the gap after it all but disappears. Against the
  // marks' own loudness the echo is plainly a tail.
  const CW_PEAK_FALL = 0.995;     // the reference peak's decay, about 2.5 s
  const CW_ON_FRAC = 0.35;         // key down: this much of that peak
  const CW_OFF_FRAC = 0.2;        // key up: this little
  const CW_MARK_FRAC = 0.5;       // or this much of the mark's own loudness
  // A room fills the gaps with echo. On a microphone a gap inside a letter
  // sags only to a third of the mark instead of to silence, so by any fixed
  // fraction of the mark the key never lifts and the letter arrives as one
  // long mark. What the echo cannot hide is the fall itself: this reference
  // follows the mark down at the speed a room decays, so a tone holding
  // steady stays above it while a real key-up drops through it.
  const CW_DIP_FALL = 0.9885;     // about 6 dB in 150 ms
  const CW_DIP_FRAC = 0.55;       // a fall this far below it is a gap
  // And the way back: a mark after an echo-filled gap does not rise steeply
  // enough for CW_RISE, because the echo it climbs out of is already loud.
  // Against the quietest point of that gap it rises plainly. An echo dying
  // away never does — it only falls.
  const CW_RISE_FROM_DIP = 2.5;
  const CW_WORD_FACTOR = 1.8;     // a word gap is this much longer than a letter gap
  // A key going down is a rise; an echo dying away is not. Requiring the
  // tone to be this much louder than it was fifteen milliseconds ago is
  // what stops the tail of a dash from being read as a mark of its own and
  // swallowing the gap between two letters.
  const CW_RISE = 2.5;
  // How far a length may stray from what it should be before the search
  // starts charging for it, in natural logarithms: a mark may be a third
  // out, a silence half, because silences are where hands wander most.
  const CW_MARK_SPREAD = 0.25;
  const CW_GAP_SPREAD = 0.5;
  const CW_FIT_MAX = 6;           // a word that fits the code this badly is not printed
  const CW_PIECE = 5;             // a silence this many dots long ends the piece
  // What every new letter costs the search before it has proved anything.
  // Without it the cheapest reading of a noisy word is a long row of E's
  // and T's: single marks fit the code whatever their length.
  const CW_LETTER_COST = 0.8;
  // And what it costs to read a word at a speed other than the one the
  // station has been sending at: a hand speeds up and slows down, but not
  // inside a single word.
  const CW_SPEED_COST = 1.5;
  const CW_UP_HOLD = 0.25;        // a gap shorter than this part of a dot is not a gap
  const CW_BLIP = 14;             // shorter than this is a click, not a key
  const CW_TEXT_MAX = 6000;

  /** One frequency's strength in a stretch of samples (Goertzel). */
  function goertzel(samples, from, count, freq, rate) {
    const k = 2 * Math.cos(2 * Math.PI * freq / rate);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < count; i++) {
      const s = samples[from + i] + k * s1 - s2;
      s2 = s1;
      s1 = s;
    }
    return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - k * s1 * s2)) / count;
  }

  /**
   * The decoder proper, kept apart from the microphone so it can be fed
   * anything: it takes blocks of samples and hands back text.
   *
   * What keeps static out of the text is that the tone is never judged on
   * its own loudness. Its strength is always compared with the same
   * measurement taken a couple of hundred hertz to either side: a real CW
   * note is loud in one narrow place and quiet beside it, while a crash of
   * static, a voice or a rig's hum is loud everywhere at once and so never
   * passes. The same comparison is what lets a weak signal through — it
   * does not have to be loud, only cleaner than its own neighbourhood.
   */
  function makeCwDecoder() {
    const d = {
      tone: 700, snr: 0, level: 0, reading: false,
      on: false, since: 0, t: 0,
      dot: 60, symbol: '', text: '', wpm: 0, seen: 0, rms: 0, heard: 0, snrPeak: 1,
      quality: 0, elements: 0, locked: false
    };

    let ring = null, ringLen = 0, ringAt = 0, filled = 0;
    let hop = 0, sinceHop = 0, rate = 0;
    let scanIn = 0;               // samples until the next hunt for the tone
    let segment = [];             // the word being heard: lengths, nothing decided
    // Where the line between a dot and a dash runs. Nobody sends to the
    // textbook one-to-three: a dash is two and a half dots from one
    // operator and four from another, and the same hand changes through
    // the evening. So the line is not calculated from the speed but kept
    // halfway between the two piles of lengths actually arriving.
    let dotLen = 0, dashLen = 0;
    let hot = 0, cold = 0;        // measurements in a row above / below the threshold
    let wantTone = 0, wantCount = 0;   // the frequency asking to be followed, and for how long
    let peakRef = 0;              // how loud the marks around here have been
    let dipRef = 0;               // how loud it was a moment ago
    let dipLow = 0;               // the quietest point of the gap we are in
    let markLevel = 0;            // the loudest this mark has been
    const past = new Float32Array(6);   // the level fifteen milliseconds ago
    let pastAt = 0;
    const durations = [];         // recent marks and inside-letter gaps, ms

    function setRate(r) {
      if (rate === r) return;
      rate = r;
      ringLen = Math.max(64, Math.round(rate * CW_WINDOW_MAX / 1000));
      ring = new Float32Array(ringLen);
      ringAt = 0;
      filled = 0;
      hop = Math.max(16, Math.round(rate * CW_HOP_MS / 1000));
      sinceHop = 0;
      scanIn = 0;
    }

    /** How many samples to look at: half a dot, within the limits. */
    function windowLen() {
      const ms = Math.min(CW_WINDOW_MAX, Math.max(CW_WINDOW_MIN, d.dot * 0.5));
      return Math.min(ringLen, Math.max(32, Math.round(rate * ms / 1000)));
    }

    /** The newest `n` samples, laid out straight so Goertzel can walk them. */
    const window = n => {
      const out = new Float32Array(n);
      const from = (ringAt - n + ringLen * 2) % ringLen;
      for (let i = 0; i < n; i++) out[i] = ring[(from + i) % ringLen];
      return out;
    };

    /** How far a frequency stands out from its own neighbourhood. */
    function standsOut(buf, n, f) {
      const here = goertzel(buf, 0, n, f, rate);
      const beside = (goertzel(buf, 0, n, f - CW_OFFSET, rate) +
        goertzel(buf, 0, n, f + CW_OFFSET, rate)) / 2 + 1e-9;
      return here / beside;
    }

    /** Hunt for the tone: the frequency that stands out most from its own
     *  neighbourhood, not simply the loudest one.
     *
     *  Two guards, both learned the hard way. The scan looks at fifty-odd
     *  frequencies and keeps the best of them, and the best of fifty noisy
     *  measurements is high by itself — so a candidate has to stand out far
     *  more than a signal needs to (CW_SNR_FIND), and it has to beat the
     *  tone already being followed by a wide margin. And the scan only runs
     *  at all when there is something to hear: in a silent band it would
     *  otherwise wander off to whatever the hiss threw up. */
    function findTone(buf) {
      const n = buf.length;
      let rms = 0;
      for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
      rms = Math.sqrt(rms / n);
      d.floor = d.floor ? (rms < d.floor ? rms * 0.2 + d.floor * 0.8 : d.floor * 0.999 + rms * 0.001) : rms;
      if (rms < d.floor * 1.6) return;            // nothing but the band's own hiss

      // Coarsely first, over the whole range, then finely around the
      // winner: a single sweep fine enough to land on the tone would cost
      // three times as much for the same answer.
      let best = 0, bestAt = d.tone;
      for (let f = CW_TONE_LOW; f <= CW_TONE_HIGH; f += 40) {
        const stands = standsOut(buf, n, f);
        if (stands > best) { best = stands; bestAt = f; }
      }
      if (best < CW_SNR_FIND) return;
      for (let f = bestAt - 36; f <= bestAt + 36; f += 9) {
        const stands = standsOut(buf, n, f);
        if (stands > best) { best = stands; bestAt = f; }
      }
      const current = standsOut(buf, n, d.tone);
      // Moving the tone is a decision, not a reflex. A single scan that
      // likes another frequency means little — the band throws up such
      // winners all the time — so the same candidate has to win several
      // scans in a row before the decoder follows it. Without this the
      // tone wanders off a station mid-transmission, and everything after
      // that is nonsense: the marks are measured somewhere beside it.
      if (best > current * 1.8) {
        if (Math.abs(bestAt - wantTone) < 30) wantCount++;
        else { wantTone = bestAt; wantCount = 1; }
        if (wantCount >= CW_TONE_AGREE) {
          d.tone = d.tone * 0.5 + bestAt * 0.5;
          wantCount = 0;
        }
      } else {
        wantCount = 0;
      }
    }

    /** Halfway between the two piles, or three dots while one is empty. */
    function markSplit(dot) {
      return (dotLen && dashLen > dotLen * 1.6) ? (dotLen + dashLen) / 2 : (dot || d.dot) * 2;
    }

    /**
     * How long a dot is around here.
     *
     * Not from the marks alone: the gap between two elements of the same
     * letter is a dot long as well, so dots, element gaps and the shortest
     * thing anyone sends all pile up at the same value. Taking the fifth
     * of the recent durations that is shortest finds that pile whatever is
     * being sent — a string of dashes would defeat an estimate made from
     * marks only, because its gaps are still dots.
     */
    function noteDuration(ms) {
      if (ms < Math.max(6, Math.min(CW_BLIP, d.dot * 0.3)) || ms > CW_DOT_MAX * 10) return;
      durations.push(ms);
      if (durations.length > 48) durations.shift();
      if (durations.length < 5) return;
      const sorted = durations.slice().sort((a, b) => a - b);
      const seed = sorted[Math.floor(sorted.length * 0.15)];
      const short = sorted.filter(x => x < seed * 2);
      const found = short.length ? short[Math.floor(short.length / 2)] : seed;
      const dot = Math.min(Math.max(found, CW_DOT_MIN), CW_DOT_MAX);
      d.dot = d.dot ? d.dot * 0.7 + dot * 0.3 : dot;
      d.wpm = Math.round(1200 / d.dot);
    }

    /** How badly a measured length fits what it was supposed to be. */
    function misfit(ms, want, spread) {
      const off = Math.log(ms / want) / spread;
      return off * off;
    }

    /**
     * The whole word at once.
     *
     * Up to here the decoder decided each silence the moment it ended —
     * "short, so the letter goes on; long, so the letter is over" — and
     * wrote the answer in ink. One silence judged wrong and the word fell
     * apart: CONFERENCE came off the air as C TN RE ET CE, with every dot
     * and dash heard correctly and only the boundaries in the wrong place.
     *
     * So nothing is decided as it arrives any more. The lengths are kept
     * until the word ends, and then every way of cutting them into letters
     * is tried: each way is charged for how far its lengths stray from the
     * rhythm it implies, and for letters that do not exist in the code, and
     * the cheapest way is the one that gets printed. A single doubtful
     * silence is then one voice against a dozen confident ones instead of
     * ruining everything after it.
     *
     * This is the cheap, one-word relative of what CW Skimmer does over a
     * whole transmission. The search is a walk along the marks: for each
     * place a letter might start, every letter of every length that could
     * follow is priced, which is a few thousand sums for a word — nothing.
     */
    function readWord(marks, gaps, unit, weight) {
      const n = marks.length;
      const cost = new Float64Array(n + 1).fill(Infinity);
      const back = new Int32Array(n + 1).fill(-1);
      const letter = new Array(n + 1).fill('');
      const breaks = new Array(n + 1).fill(false);
      cost[0] = 0;

      for (let i = 0; i < n; i++) {
        if (!isFinite(cost[i])) continue;
        for (let len = 1; len <= 7 && i + len <= n; len++) {
          // Everything inside a letter has to be a one-unit silence.
          let inside = 0;
          for (let k = i; k < i + len - 1; k++) inside += misfit(gaps[k], unit, CW_GAP_SPREAD);

          // The silence after it is either between letters or between
          // words — whichever it fits better, and the word one costs a
          // space on the page.
          let after = 0, isWord = false;
          const last = i + len - 1;
          if (last < n - 1) {
            const asLetter = misfit(gaps[last], unit * 3, CW_GAP_SPREAD);
            const asWord = misfit(gaps[last], unit * 7, CW_GAP_SPREAD);
            if (asWord < asLetter) { after = asWord; isWord = true; } else { after = asLetter; }
          }

          // The best letter of that many elements.
          let bestCh = '', best = Infinity;
          const choices = MORSE_BY_LENGTH[len] || [];
          for (let c = 0; c < choices.length; c++) {
            const symbol = choices[c].symbol;
            let sum = 0;
            for (let k = 0; k < len && sum < best; k++) {
              sum += misfit(marks[i + k], symbol[k] === '.' ? unit : unit * weight, CW_MARK_SPREAD);
            }
            if (sum < best) { best = sum; bestCh = choices[c].ch; }
          }
          if (!bestCh) continue;

          const total = cost[i] + inside + after + best + CW_LETTER_COST;
          if (total < cost[i + len]) {
            cost[i + len] = total;
            back[i + len] = i;
            letter[i + len] = bestCh;
            breaks[i + len] = isWord;
          }
        }
      }

      if (!isFinite(cost[n])) return null;
      const out = [];
      for (let at = n; at > 0; at = back[at]) {
        out.push(letter[at] + (breaks[at] ? ' ' : ''));
      }
      return { text: out.reverse().join(''), per: cost[n] / n };
    }

    /** The word just heard, read every way and printed the best way. */
    function readSegment(endsWord) {
      const parts = segment;
      segment = [];
      const marks = [], gaps = [];
      let snrSum = 0;
      for (const part of parts) {
        if (part.m) { marks.push(part.m); gaps.push(0); snrSum += part.snr; }
        else if (marks.length) gaps[marks.length - 1] = part.g;
      }
      if (!marks.length) return;
      // Too quiet to be anybody sending: the hiss has its own rhythm and it
      // is not Morse, but there is no sense in reading it to find that out.
      if (snrSum / marks.length < CW_SNR_LETTER) return;
      // One or two marks fit the code no matter what they are — every
      // single mark is either E or T — so a crash of static becomes a
      // letter for free. A piece that short is only believed from a
      // station already being read.
      if (marks.length < 3 && d.elements < 8) return;

      // The speed is not known exactly, so the word is read at several
      // speeds around the estimate and the one that fits best wins. This is
      // also what catches an operator who has just sped up.
      const seed = dotOf(marks.concat(gaps.filter(Boolean))) || d.dot;
      const weight = (dotLen && dashLen > dotLen * 1.6)
        ? Math.min(5, Math.max(2, dashLen / dotLen)) : 3;
      let best = null, bestUnit = seed;
      // The seed is only a guess, and off the air it is usually a low one:
      // a noisy signal throws in blips, they are all short, and they drag
      // the estimate down. So the search reaches further up than down.
      for (const k of [0.7, 0.85, 1, 1.15, 1.35, 1.6, 1.9]) {
        const unit = Math.min(Math.max(seed * k, CW_DOT_MIN), CW_DOT_MAX);
        const got = readWord(marks, gaps, unit, weight);
        if (!got) continue;
        // A reading at a speed far from the one being sent has to be that
        // much better to win.
        const off = Math.log(unit / (d.dot || unit));
        got.per += CW_SPEED_COST * off * off;
        if (!best || got.per < best.per) { best = got; bestUnit = unit; }
      }
      // How well a piece has to fit before it is believed. A long word
      // that fits the code is evidence in itself: ten lengths falling into
      // Morse by chance practically does not happen. Two or three lengths
      // fall into it all the time — every single mark is an E or a T — so
      // a short piece has to fit much better than a long one.
      const limit = CW_FIT_MAX * (marks.length >= 6 ? 1 : marks.length >= 4 ? 0.6 : 0.25);
      // Nothing that fits the code at all: static, a voice, a carrier.
      // Whatever this tone is, it is not a station, so the hunt resumes.
      if (!best || best.per > limit) {
        d.reading = false;
        return;
      }
      d.reading = true;

      d.dot = d.dot ? d.dot * 0.6 + bestUnit * 0.4 : bestUnit;
      d.wpm = Math.round(1200 / d.dot);
      d.text += best.text + (endsWord ? ' ' : '');
      if (d.text.length > CW_TEXT_MAX) d.text = d.text.slice(-CW_TEXT_MAX);
    }

    /** The dot length that best fits a stretch of durations. */
    function dotOf(list) {
      const sorted = list.filter(x => x >= 8).sort((a, b) => a - b);
      if (sorted.length < 3) return 0;
      const seed = sorted[Math.floor(sorted.length * 0.2)];
      const short = sorted.filter(x => x < seed * 2);
      const found = short.length ? short[Math.floor(short.length / 2)] : seed;
      return Math.min(Math.max(found, CW_DOT_MIN), CW_DOT_MAX);
    }

    /** A mark that has just ended. Nothing is decided here any more — the
     *  length is simply written down for the search at the end of the word. */
    function mark(ms, snr) {
      // Too short to be a key at any sane speed, or absurdly long: a burst
      // of static, a carrier, somebody tuning up.
      if (ms < Math.max(8, d.dot * 0.35) || ms > CW_DOT_MAX * 5) return;
      noteDuration(ms);
      d.seen++;
      d.elements++;
      const split = markSplit(0);
      if (ms > split) dashLen = dashLen ? dashLen * 0.8 + ms * 0.2 : ms;
      else dotLen = dotLen ? dotLen * 0.8 + ms * 0.2 : ms;
      d.symbol += ms > split ? '-' : '.';
      if (d.symbol.length > 8) d.symbol = '';
      segment.push({ m: ms, snr });
      // A word nobody ever closed — a long string of digits, a machine
      // sending without pause — is read in pieces rather than held for ever.
      if (segment.length > 90) readSegment(false);
    }

    /** A silence that has just ended. */
    function gap(ms) {
      if (ms < d.dot * 2) noteDuration(ms);
      if (segment.length) segment.push({ g: ms });

      // Only a real break in the sending closes the piece — not every gap
      // between words. The longer the piece, the more the search has to go
      // on when it works out the speed, and the word breaks inside it are
      // its own business to place.
      if (ms > d.dot * CW_PIECE) {
        d.symbol = '';
        readSegment(true);
      }

      // A long dead silence: whatever was being read is over, and the next
      // signal may well be somebody else at another speed.
      if (ms > d.dot * 40) {
        dotLen = dashLen = 0;        // another station, another hand
        d.reading = false;           // and the tone may be hunted for again
        d.elements = 0;              // and nothing is "already being read" any more
      }
    }

    return {
      state: d,

      /** One block of microphone samples. */
      push(buf, sampleRate) {
        setRate(sampleRate);
        for (let i = 0; i < buf.length; i++) {
          ring[ringAt] = buf[i];
          ringAt = (ringAt + 1) % ringLen;
          if (filled < ringLen) filled++;
          sinceHop++;
          scanIn--;
          if (filled < ringLen || sinceHop < hop) continue;
          sinceHop = 0;
          const wn = windowLen();
          const w = window(wn);
          // The hunt for the tone stops as soon as a station is being
          // read. In the silences between marks there is nothing to hear,
          // and the hunt would start pulling the tone towards whatever the
          // noise threw up — by the next mark it was listening slightly
          // beside the station. Unnoticeable by ear; it cost the decoder
          // half its errors.
          // The hunt stops while a station is actually being read — and
          // "being read" means pieces that come out as words, not merely
          // marks arriving. On a real band the first few things over the
          // threshold are easily noise, and a tone held on noise leaves
          // the decoder deaf for the rest of the recording.
          if (scanIn <= 0 && !d.reading) {
            findTone(w);
            scanIn = Math.round(rate * 0.1);
          }

          const level = goertzel(w, 0, wn, d.tone, rate);
          const beside = (goertzel(w, 0, wn, d.tone - CW_OFFSET, rate) +
            goertzel(w, 0, wn, d.tone + CW_OFFSET, rate)) / 2 + 1e-9;
          // Inside one mark the loudness jumps about — a room does that to a
          // tone, and so does a fist. The envelope follows a rise at once and
          // a fall gently, so those jumps stop being mistaken for the end of
          // the mark while a real key-up still shows within a few
          // measurements.
          const here = level;
          const snr = here / beside;
          // The loudest the signal has been lately: marks set it, silence
          // lets it sag, so it follows an operator turning the gain up or a
          // station fading, but never follows the echo down.
          peakRef = Math.max(level, peakRef * CW_PEAK_FALL);
          dipRef = Math.max(level, dipRef * CW_DIP_FALL);

          // What the microphone is hearing at all, tone or no tone: without
          // it there is no telling a dead input from a dead band, and that
          // is the first thing to look at when nothing is decoded.
          let power = 0;
          for (let j = 0; j < wn; j++) power += w[j] * w[j];
          d.rms = d.rms * 0.8 + Math.sqrt(power / wn) * 0.2;
          if (snr > CW_SNR_ON) d.heard = d.t;

          d.t += CW_HOP_MS;
          d.level = here;
          d.snr = d.snr * 0.7 + snr * 0.3;

          // The tone has to hold for a few measurements before the key is
          // called down or up. Without that, a signal wavering across the
          // threshold is chopped into blips, and blips are what a speed
          // estimate trips over. The moment of the change is taken as the
          // start of that run, so nothing is lost in timing.
          // Key-down is judged against the band, as on the air. Key-up is
          // judged against this mark's own strength as well: played through
          // a speaker and heard by a microphone, a mark leaves an echo that
          // hangs above the band's noise after the key is up. A tail well
          // below the mark's own peak is a tail; a dip that deep in the
          // middle of a mark does not happen.
          // Key-down is judged against the band, as on the air: is there a
          // tone here at all. Key-up needs more than that. Played through a
          // speaker and heard by a microphone, every mark leaves an echo —
          // quiet, but in a quiet room still far above the hiss, so by the
          // "is there a tone" test the key never lifts: a 35 ms dot measures
          // 85 ms and the gap after it all but disappears. Against the
          // mark's own loudness the echo is plainly what it is; a dip that
          // deep in the middle of a mark does not happen.
          if (d.on) markLevel = Math.max(markLevel, here);
          const was = past[pastAt];
          past[pastAt] = here;
          pastAt = (pastAt + 1) % past.length;
          const rising = here > was * CW_RISE;
          const onAt = Math.max(beside * CW_SNR_ON, peakRef * CW_ON_FRAC);
          // Half of the mark's own loudness is where a pulse is normally
          // called over — the key-down edge is steep, so that is the moment
          // the key really lifted, whatever the echo does afterwards.
          const offAt = Math.max(beside * CW_SNR_OFF, peakRef * CW_OFF_FRAC,
            d.on ? Math.max(markLevel * CW_MARK_FRAC, dipRef * CW_DIP_FRAC) : 0);
          // Pressed and released are judged apart, and only the one that can
          // happen next is judged at all. Asking "is this loud enough to be a
          // mark?" while the key is already down undid every guard above it:
          // the key-up threshold stands higher than the key-down one, so a
          // level between the two answered yes to the first question and
          // cleared the count towards release on every measurement. The key
          // then never lifted while an echo held the gap above a third of the
          // peak — which, on a microphone in a room, is every gap inside a
          // letter. The same transmission read "TGOOMCAQQOM" off the
          // microphone and "DE EU1 … QSO … 73" off the cable.
          if (d.on) {
            if (here < offAt) { cold++; hot = 0; } else { cold = 0; }
          } else {
            dipLow = dipLow ? Math.min(dipLow, here) : here;
            const climbed = here > dipLow * CW_RISE_FROM_DIP;
            if (here > onAt && (rising || hot || climbed)) { hot++; cold = 0; }
            else { hot = 0; }
          }

          // At 40 wpm a dot is barely 30 ms, so the guard against blips has
          // to shrink with the speed or it starts eating the dots.
          const blip = Math.max(6, Math.min(CW_BLIP, d.dot * 0.3));
          // Letting go of the key is judged more slowly than pressing it.
          // A mark that wavers — and off the air they all do — breaks into
          // pieces otherwise, and the pieces ruin the speed estimate.
          const upBlip = Math.max(blip, d.dot * CW_UP_HOLD);
          if (!d.on && hot * CW_HOP_MS >= blip) {
            const at = d.t - hot * CW_HOP_MS;
            gap(Math.max(0, at - d.since));
            d.on = true;
            d.since = at;
            d.markSnr = snr;
            markLevel = here;
            hot = 0;
          } else if (d.on && cold * CW_HOP_MS >= upBlip) {
            const at = d.t - cold * CW_HOP_MS;
            mark(Math.max(0, at - d.since), d.markSnr || snr);
            d.on = false;
            dipLow = here;
            d.since = at;
            cold = 0;
          } else if (d.on) {
            d.markSnr = Math.max(d.markSnr || 0, snr);
          } else if (segment.length && d.t - d.since > d.dot * CW_PIECE) {
            // Nothing more is coming: read the word without waiting for the
            // next one to start.
            d.symbol = '';
            readSegment(true);
            d.since = d.t;
          }
        }
      },

      take() {
        const text = d.text;
        d.text = '';
        return text;
      },

      reset() {
        d.symbol = '';
        d.text = '';
        segment = [];
        d.seen = 0;
        d.elements = 0;
        d.locked = false;
        d.dot = 60;
        d.wpm = 0;
      }
    };
  }

  // What the letters mean. Hams write the same few dozen things all
  // evening — Q-codes and worn-down English — and to somebody who is not
  // yet fluent in them the decoded line is still a wall of letters. So the
  // words that carry meaning are spelled out underneath, the way the
  // phonetic alphabet is spelled out under a callsign.
  const CW_WORDS = {
    CQ: ['general call — calling anyone', 'общий вызов — зову всех'],
    DE: ['from', 'от (такого-то)'],
    K: ['over — go ahead', 'приём'],
    KN: ['over — the named station only', 'приём, только названная станция'],
    AR: ['end of message', 'конец передачи'],
    SK: ['end of contact', 'конец связи'],
    AS: ['wait a moment', 'подождите'],
    BK: ['break — back to you', 'перебой, передаю вам'],
    R: ['received', 'принято'],
    RR: ['received, all correct', 'принято полностью'],
    PSE: ['please', 'пожалуйста'],
    TNX: ['thanks', 'спасибо'],
    TKS: ['thanks', 'спасибо'],
    TU: ['thank you', 'спасибо'],
    UR: ['your / you are', 'ваш / вы'],
    RST: ['report — readability, strength, tone', 'рапорт — разборчивость, сила, тон'],
    '5NN': ['report 599', 'рапорт 599'],
    QTH: ['my location', 'моё местоположение'],
    QRZ: ['who is calling me?', 'кто меня вызывает?'],
    QRL: ['is this frequency busy?', 'частота занята?'],
    QRM: ['interference from stations', 'помехи от станций'],
    QRN: ['atmospheric noise', 'атмосферные помехи'],
    QRP: ['low power', 'малая мощность'],
    QRO: ['high power', 'большая мощность'],
    QRS: ['send more slowly', 'передавайте медленнее'],
    QRQ: ['send faster', 'передавайте быстрее'],
    QRT: ['stopping transmission', 'прекращаю работу'],
    QRV: ['ready', 'готов'],
    QRX: ['stand by', 'подождите, вызову'],
    QSB: ['fading', 'замирания сигнала'],
    QSL: ['confirm / QSL card', 'подтверждаю / карточка'],
    QSO: ['contact', 'связь'],
    QSY: ['change frequency', 'смена частоты'],
    QTC: ['a message to pass', 'есть сообщение'],
    QTR: ['exact time', 'точное время'],
    '73': ['best regards', 'наилучшие пожелания'],
    '88': ['love and kisses — to a lady', 'наилучшие пожелания даме'],
    OM: ['old man — the other operator', 'дружище — оператор-мужчина'],
    YL: ['young lady — a woman operator', 'девушка-оператор'],
    XYL: ['wife', 'жена'],
    GM: ['good morning', 'доброе утро'],
    GA: ['good afternoon', 'добрый день'],
    GE: ['good evening', 'добрый вечер'],
    GL: ['good luck', 'удачи'],
    GB: ['goodbye', 'до свидания'],
    DX: ['a distant station', 'дальняя станция'],
    ES: ['and', 'и'],
    HR: ['here', 'здесь, у меня'],
    HW: ['how do you copy me?', 'как меня принимаете?'],
    NW: ['now', 'сейчас'],
    WX: ['weather', 'погода'],
    PWR: ['power', 'мощность'],
    ANT: ['antenna', 'антенна'],
    RIG: ['transceiver', 'трансивер'],
    AGN: ['again', 'ещё раз'],
    ABT: ['about', 'около'],
    BCNU: ['be seeing you', 'до встречи'],
    CFM: ['confirm', 'подтверждаю'],
    CUL: ['see you later', 'до связи'],
    FB: ['fine business — excellent', 'отлично'],
    HPE: ['hope', 'надеюсь'],
    MNI: ['many', 'много'],
    NR: ['number', 'номер'],
    OP: ['operator — my name', 'оператор — моё имя'],
    RPT: ['repeat', 'повторите'],
    SRI: ['sorry', 'извините'],
    VY: ['very', 'очень'],
    WID: ['with', 'с'],
    WKD: ['worked', 'провёл связь'],
    NIL: ['nothing heard', 'ничего не принял'],
    GUD: ['good', 'хорошо'],
    CPY: ['copy', 'приём, разбор'],
    TEST: ['contest call', 'вызов в соревнованиях'],
    BT: ['separator — a new thought', 'разделитель — новая мысль'],
    AA: ['all after', 'всё после'],
    AB: ['all before', 'всё до'],
    WA: ['word after', 'слово после'],
    WB: ['word before', 'слово до'],
    HH: ['error — disregard', 'ошибка, не принимайте'],
    SN: ['understood', 'понял'],
    CS: ['callsign', 'позывной'],
    DR: ['dear', 'дорогой'],
    OT: ['old timer — a veteran', 'ветеран эфира'],
    OC: ['old chap', 'дружище'],
    DSW: ['goodbye (Russian)', 'до свидания'],
    HI: ['laughter', 'смех'],
    UFB: ['ultra fine business — splendid', 'великолепно'],
    SOLID: ['copying perfectly', 'принимаю уверенно'],
    SKED: ['a scheduled contact', 'назначенная связь'],
    CUAGN: ['see you again', 'до новой встречи'],
    BTU: ['back to you', 'передаю вам'],
    CLG: ['calling', 'вызывает'],
    CL: ['closing down the station', 'закрываю станцию'],
    STN: ['station', 'станция'],
    SIG: ['signal', 'сигнал'],
    SIGS: ['signals', 'сигналы'],
    CONDX: ['band conditions', 'прохождение'],
    FREQ: ['frequency', 'частота'],
    UP: ['listening higher in frequency', 'слушаю выше по частоте'],
    DWN: ['listening lower in frequency', 'слушаю ниже по частоте'],
    LSN: ['listening', 'слушаю'],
    MSG: ['message', 'сообщение'],
    TFC: ['traffic — messages', 'сообщения'],
    RCVR: ['receiver', 'приёмник'],
    XMTR: ['transmitter', 'передатчик'],
    TX: ['transmitter / transmit', 'передатчик, передача'],
    RX: ['receiver / receive', 'приёмник, приём'],
    PA: ['power amplifier', 'усилитель мощности'],
    VERT: ['vertical antenna', 'вертикальная антенна'],
    GND: ['ground', 'земля'],
    FER: ['for', 'для, за'],
    FM: ['from', 'от'],
    HV: ['have', 'имею'],
    HVY: ['heavy', 'сильный'],
    ENUF: ['enough', 'достаточно'],
    SUM: ['some', 'немного'],
    WUD: ['would', 'бы'],
    WL: ['will / well', 'будет, хорошо'],
    YR: ['your / year', 'ваш, год'],
    URS: ['yours', 'ваш'],
    U: ['you', 'вы'],
    C: ['yes, correct', 'да, верно'],
    TMW: ['tomorrow', 'завтра'],
    LTR: ['later', 'позже'],
    AGE: ['age', 'возраст'],
    INFO: ['information', 'сведения'],
    LID: ['a poor operator', 'плохой оператор'],
    SWL: ['shortwave listener', 'наблюдатель'],
    BURO: ['QSL bureau', 'бюро карточек'],
    CRD: ['card', 'карточка'],
    DIRECT: ['QSL direct by mail', 'карточка почтой напрямую'],
    TEMP: ['temperature', 'температура'],
    WW: ['worldwide', 'всемирный'],
    CK: ['check', 'проверка'],
    NM: ['no more', 'больше нечего'],
    ND: ['nothing doing', 'ничего не выходит'],
    RCD: ['received', 'получено'],
    SED: ['said', 'сказал'],
    GG: ['going', 'иду, еду'],
    TT: ['that', 'тот, это'],
    WRD: ['word', 'слово'],
    '55': ['good luck', 'удачи'],
    '99': ['go away', 'уйдите с частоты']
  };

  // A callsign as it is actually written: a prefix that ends in a digit,
  // then one to four letters, plus the /P or /QRP an operator adds. The
  // three shapes below cover R2FEL, RA3ABC and 9M2PJU alike — and leave
  // out the things that only look like callsigns, 5NN and 599 and 73.
  const CW_CALL = /\b(?:[A-Z]{1,2}[0-9]|[0-9][A-Z]{1,2}[0-9]|[A-Z][0-9][A-Z][0-9])[A-Z]{1,4}(?:\/[A-Z0-9]{1,4})?\b/g;

  /**
   * The decoded text, drawn the way the panel shows it: word by word, and
   * under each word what it means. Hams write in worn-down English and
   * Q-codes all evening, and to somebody who does not know them by heart
   * the letters alone are still a wall — so the meaning stands where it can
   * be read as a sentence, under the words it belongs to, and not in a
   * table of hints somewhere else.
   */
  function cwHtml(text) {
    // The line under each word is the same kind of help as the phonetic
    // alphabet under a callsign, so it follows the same switch: an operator
    // who doesn't need one doesn't need the other.
    const explain = station.showPhonetics !== false;
    const words = text.split(/\s+/).filter(Boolean);
    // The new decoder marks whose over begins where: §2@780 is station 2 at
    // 780 Hz. With one station on the frequency the marks say nothing and
    // are not drawn; with two taking turns, each over starts on a line of
    // its own under its station — otherwise there is no telling who said what.
    const voices = new Set(words.filter(w => w[0] === '§').map(w => w.split('@')[0]));
    return words.map(word => {
      if (word[0] === '§') {
        if (voices.size < 2) return '';
        const [n, tone] = word.slice(1).split('@');
        return `<span class="qso-cw-station is-st${Math.min(3, Number(n) || 1)}">` +
          `${escapeHtml(tr(`station ${n} · ${tone} Hz`, `станция ${n} · ${tone} Гц`))}</span>`;
      }
      CW_CALL.lastIndex = 0;
      const isCall = word.replace(CW_CALL, '') === '';
      const said = explain ? CW_WORDS[word.toUpperCase()] : null;
      const mean = said
        ? `<span class="qso-cw-mean">${escapeHtml(tr(said[0], said[1]))}</span>`
        : (isCall && explain) ? `<span class="qso-cw-mean is-call">${tr('callsign', 'позывной')}</span>` : '';
      return `<span class="qso-cw-word${isCall ? ' is-call' : ''}">` +
        `<span class="qso-cw-letters">${escapeHtml(word)}</span>${mean}</span>`;
    }).join('');
  }

  let cwText = '';

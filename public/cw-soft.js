/*
 * The second CW decoder: soft decisions and a search over the whole
 * transmission. The first one (makeCwDecoder in app.js) decides "key down
 * or key up" at every measurement; on a weak signal some of those decisions
 * are bound to be wrong and nothing after can mend them. This one throws
 * nothing away: every measurement only says how much it looks like a tone,
 * and the reading that explains the whole stretch of sound best wins — the
 * way an operator hears a phrase rather than a click at a time.
 *
 * Built and measured outside the program first (scratchpad/cw/soft, see
 * CLAUDE.md, "Мягкий декодер"). Every constant here was chosen there by
 * runs over the test bench, the owner's recordings and the noise check —
 * not by eye. Change them only the same way.
 *
 * Runs as a Web Worker (the search takes a second or two per piece and must
 * not stall the page) and as a plain module under Node for the tests.
 * Nothing newer than Chromium 108: it also ships in the Windows 7/8 build.
 */
(function (root) {
  'use strict';

  const MORSE = {
    '.-': 'A', '-...': 'B', '-.-.': 'C', '-..': 'D', '.': 'E', '..-.': 'F',
    '--.': 'G', '....': 'H', '..': 'I', '.---': 'J', '-.-': 'K', '.-..': 'L',
    '--': 'M', '-.': 'N', '---': 'O', '.--.': 'P', '--.-': 'Q', '.-.': 'R',
    '...': 'S', '-': 'T', '..-': 'U', '...-': 'V', '.--': 'W', '-..-': 'X',
    '-.--': 'Y', '--..': 'Z',
    '-----': '0', '.----': '1', '..---': '2', '...--': '3', '....-': '4',
    '.....': '5', '-....': '6', '--...': '7', '---..': '8', '----.': '9',
    '.-.-.-': '.', '--..--': ',', '..--..': '?', '-..-.': '/', '-...-': '=',
    '.-.-.': '+', '-.--.': '(', '.--.-.': '@', '-....-': '-'
  };

  const HOP_MS = 2.5;
  // Analysis windows. A window should be half a dot long (it is a matched
  // filter), and the dot is not known in advance, so the envelope is taken
  // at every one of these and the right one is picked with the speed.
  const WINDOWS = [6, 10, 16, 24, 32, 44];
  const SPEED_LAYER = 3;          // all speeds are compared on this one (24 ms)

  // The search.
  const MARK_SPREAD = 0.25;       // how far a mark may stray from its length (log)
  const GAP_SPREAD = 0.5;         // a silence twice as far: hands wander there most
  const TIME_COST = 1.2;          // rhythm against the sound itself
  const LETTER_COST = 1.6;        // what a new letter costs before it proves anything
  const BEAM = 14;                // best paths kept at every step
  const SPACE_COST = 12;          // against stretched spacing: it is the exception

  // Knowing the air.
  const LANG_WEIGHT = 20;
  const RULE_WEIGHT = 25;

  // Is anybody sending at all.
  const MIN_Z = 8;                // evidence, scaled by the length of the piece
  const MIN_SWING = 0.7;          // a steady carrier does not swing
  const MIN_RATIO = 2.2;          // stricter, for every tone but the main one
  const MIN_STATION_LETTERS = 4;  // a station heard for less is not shown
  const MAX_STATIONS = 3;
  const STYLE_EVIDENCE = 60;      // less than this, and a remembered speed is used

  /* ------------------------------------------------------------------ */
  /* Sound                                                               */
  /* ------------------------------------------------------------------ */

  /** One frequency's strength over a stretch of samples (Goertzel). */
  function goertzel(s, from, n, f, rate) {
    const k = 2 * Math.cos(2 * Math.PI * f / rate);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < n; i++) { const v = s[from + i] + k * s1 - s2; s2 = s1; s1 = v; }
    return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - k * s1 * s2)) / n;
  }

  /** ln I0(z) without overflow (Abramowitz & Stegun, better than 1e-7). */
  function logI0(z) {
    if (z < 3.75) {
      const t = (z / 3.75) * (z / 3.75);
      return Math.log(1 + t * (3.5156229 + t * (3.0899424 + t * (1.2067492 +
        t * (0.2659732 + t * (0.0360768 + t * 0.0045813))))));
    }
    const t = 3.75 / z;
    const poly = 0.39894228 + t * (0.01328592 + t * (0.00225319 + t * (-0.00157565 +
      t * (0.00916281 + t * (-0.02057706 + t * (0.02635537 + t * (-0.01647633 + t * 0.00392377)))))));
    return z - 0.5 * Math.log(z) + Math.log(poly);
  }

  /**
   * Up to three tones at once: on a frequency there are often two stations,
   * and the one answering sounds a little higher or lower. A tone is found
   * by how sharp it is — how much stronger than 90 Hz to either side — not
   * by how loud: a station is a peak, the band's noise is flat. From 300 Hz
   * (below live the mains harmonics and the voice; at 250 a street hum got
   * in) to 2900 Hz (tuned a couple of kHz off, the tone goes there too).
   */
  function findTones(x, rate, most) {
    const n = Math.round(rate * 0.04);
    const steps = Math.min(300, Math.floor(x.length / n));
    if (steps < 4) return [{ tone: 700, sharp: 0 }];
    const sharpAt = f => {
      const vals = [];
      for (let k = 0; k < steps; k++) {
        const at = Math.floor(k * (x.length - n) / steps);
        const c = goertzel(x, at, n, f, rate);
        const a = (goertzel(x, at, n, f - 90, rate) + goertzel(x, at, n, f + 90, rate)) / 2 + 1e-12;
        vals.push(c / a);
      }
      vals.sort((a, b) => a - b);
      return vals[Math.floor(vals.length * 0.9)];
    };
    const curve = [];
    for (let f = 300; f <= 2900; f += 10) curve.push([f, sharpAt(f)]);
    const peaks = [];
    for (let i = 1; i < curve.length - 1; i++) {
      if (curve[i][1] >= curve[i - 1][1] && curve[i][1] >= curve[i + 1][1]) peaks.push(curve[i]);
    }
    peaks.sort((a, b) => b[1] - a[1]);
    const out = [];
    for (const [f, v] of peaks) {
      if (out.length && v < out[0].sharp * 0.5) break;
      if (out.some(t => Math.abs(t.tone - f) < 40)) continue;
      // The peak is not refined further: the sharpness measure is noisy,
      // and a 2 Hz search only fitted its noise — worse on every measure.
      out.push({ tone: f, sharp: v });
      if (out.length >= (most || MAX_STATIONS)) break;
    }
    return out.length ? out : [{ tone: 700, sharp: 0 }];
  }

  /**
   * The envelope at a tone and, from it, how much every measurement looks
   * like the tone: the true likelihood ratio, Rayleigh in a silence against
   * Rice in a mark — ln I0(nu·r/sigma²) − nu²/(2·sigma²). On a strong signal
   * it is nearly linear in loudness; on a weak one it becomes quadratic, an
   * energy detector. A linear score was crude exactly where decoding failed.
   */
  function softScores(x, rate, tone, winMs) {
    const w = Math.round(rate * winMs / 1000), hop = Math.round(rate * HOP_MS / 1000);
    const n = Math.max(1, Math.floor((x.length - w) / hop));
    const env = new Float64Array(n), near = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      env[i] = goertzel(x, i * hop, w, tone, rate);
      near[i] = (goertzel(x, i * hop, w, tone - 90, rate) +
        goertzel(x, i * hop, w, tone + 90, rate)) / 2 + 1e-12;
    }
    const sorted = Float64Array.from(env).sort();
    // sigma from the silences: a quarter of the quietest windows is nearly
    // always silence, and Rayleigh's lower quartile is 0.7585 sigma.
    const sigma = Math.max(sorted[Math.floor(n * 0.25)] / 0.7585, 1e-12);
    // nu, the mark over the noise: for Rice E[r²] = nu² + 2 sigma².
    const p90 = sorted[Math.floor(n * 0.90)];
    const nu = Math.sqrt(Math.max(p90 * p90 - 2 * sigma * sigma, 0.25 * sigma * sigma));
    // Neighbouring measurements overlap: one stretch of sound is counted
    // win/hop times. Without this the sound is over-counted and neither the
    // rhythm nor the knowledge of the air weighs anything against it.
    const overlap = HOP_MS / Math.max(winMs, HOP_MS);
    const soft = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const llr = logI0(nu * env[i] / (sigma * sigma)) - nu * nu / (2 * sigma * sigma);
      soft[i] = Math.max(-6, Math.min(6, llr * overlap));
    }
    return { soft, env, near, noise: sigma, amp: nu };
  }

  /* ------------------------------------------------------------------ */
  /* The search                                                          */
  /* ------------------------------------------------------------------ */

  /** The Morse tree: a node is the code so far, the edges a dot and a dash. */
  function buildTree() {
    const nodes = [{ code: '', ch: '', dot: -1, dash: -1 }];
    const index = new Map([['', 0]]);
    const useful = new Set();
    for (const code of Object.keys(MORSE)) {
      for (let i = 1; i <= code.length; i++) useful.add(code.slice(0, i));
    }
    for (const code of Array.from(useful).sort((a, b) => a.length - b.length)) {
      index.set(code, nodes.length);
      nodes.push({ code, ch: MORSE[code] || '', dot: -1, dash: -1 });
    }
    for (const node of nodes) {
      const d = node.code + '.', h = node.code + '-';
      node.dot = index.has(d) ? index.get(d) : -1;
      node.dash = index.has(h) ? index.get(h) : -1;
    }
    return nodes;
  }
  const TREE = buildTree();
  const N = TREE.length;
  const NEG = -1e18;

  /** Log-normal price for a length that is not the one expected. */
  function misfit(got, want, spread) {
    const d = Math.log(Math.max(got, 1e-6) / want) / spread;
    return d * d;
  }

  /** Candidate lengths around the expected one, coarser for long ones. */
  function lengths(nominal, lo, hi) {
    const from = Math.max(1, Math.round(nominal * lo)), to = Math.round(nominal * hi);
    const step = Math.max(1, Math.round(nominal / 12));
    const out = [];
    for (let d = from; d <= to; d += step) out.push(d);
    return out;
  }

  /**
   * The best reading of a stretch of soft scores. A state is a place in the
   * Morse tree; a step is a mark or a silence of any plausible length. The
   * reading that explains the whole stretch best wins, so a doubtful place
   * is settled by what came before and after it, not on its own.
   * @param soft  per-measurement scores (above zero: looks like the tone)
   * @param unit  a dot, in measurements
   * @param space how far the gaps are stretched against the marks (Farnsworth)
   */
  function parsePiece(soft, unit, space) {
    space = space || 1;
    const T = soft.length;
    const P = new Float64Array(T + 1);
    for (let i = 0; i < T; i++) P[i + 1] = P[i] + soft[i];

    const dots = lengths(unit, 0.45, 1.9), dashes = lengths(unit * 3, 0.62, 1.7);
    const inner = lengths(unit, 0.4, 2.0);
    const letterGap = unit * 3 * space, wordGap = unit * 7 * space;
    const between = lengths(letterGap, 0.6, 1.7), words = lengths(wordGap, 0.65, 2.4);

    // A: a silence has just ended (a mark comes next). B: a mark has.
    const A = new Float64Array((T + 1) * N).fill(NEG);
    const B = new Float64Array((T + 1) * N).fill(NEG);
    const Ab = new Int32Array((T + 1) * N).fill(-1);
    const Bb = new Int32Array((T + 1) * N).fill(-1);
    const Ae = new Int8Array((T + 1) * N);       // 1: a letter came out, 2: a letter and a space
    A[0] = 0;

    const live = [];
    for (let t = 0; t <= T; t++) {
      live.length = 0;
      for (let k = 0; k < N; k++) {
        if (A[t * N + k] > NEG) live.push([A[t * N + k], k, 0]);
        if (B[t * N + k] > NEG) live.push([B[t * N + k], k, 1]);
      }
      if (!live.length) continue;
      if (live.length > BEAM) {
        live.sort((p, q) => q[0] - p[0]);
        for (let i = BEAM; i < live.length; i++) {
          if (live[i][2]) B[t * N + live[i][1]] = NEG; else A[t * N + live[i][1]] = NEG;
        }
        live.length = BEAM;
      }
      for (const [score, node, which] of live) {
        if (!which) {
          const here = TREE[node];
          const choices = [[dots, here.dot, unit], [dashes, here.dash, unit * 3]];
          for (const [list, child, want] of choices) {
            if (child < 0) continue;
            for (const d of list) {
              if (t + d > T) break;
              const v = score + (P[t + d] - P[t]) - TIME_COST * misfit(d, want, MARK_SPREAD);
              const at = (t + d) * N + child;
              if (v > B[at]) { B[at] = v; Bb[at] = t * N + node; }
            }
          }
        } else {
          const ch = TREE[node].ch;
          for (const d of inner) {
            if (t + d > T) break;
            const v = score - (P[t + d] - P[t]) - TIME_COST * misfit(d, unit, GAP_SPREAD);
            const at = (t + d) * N + node;
            if (v > A[at]) { A[at] = v; Ab[at] = t * N + node + (1 << 24); Ae[at] = 0; }
          }
          if (!ch) continue;
          const ends = [[between, letterGap, 1], [words, wordGap, 2]];
          for (const [list, want, kind] of ends) {
            for (const d of list) {
              if (t + d > T) break;
              const v = score - (P[t + d] - P[t]) - TIME_COST * misfit(d, want, GAP_SPREAD) - LETTER_COST;
              const at = (t + d) * N;
              if (v > A[at]) { A[at] = v; Ab[at] = t * N + node + (1 << 24); Ae[at] = kind; }
            }
          }
        }
      }
    }

    let best = NEG, from = -1, tail = '';
    if (A[T * N] > best) { best = A[T * N]; from = T * N; }
    for (let k = 1; k < N; k++) {
      if (!TREE[k].ch) continue;
      if (B[T * N + k] - LETTER_COST > best) { best = B[T * N + k] - LETTER_COST; from = -(T * N + k); tail = TREE[k].ch; }
    }
    if (from === -1) return { text: '', score: NEG, letters: 0 };

    const out = [];
    if (tail) out.push(tail);
    let at = from < 0 ? -from : from, inB = from < 0;
    while (at >= 0) {
      const prev = inB ? Bb[at] : Ab[at];
      if (!inB) {
        const kind = Ae[at];
        if (kind === 2) out.push(' ');
        if (kind >= 1) out.push(TREE[(prev & 0xffffff) % N].ch);
      }
      if (prev < 0) break;
      inB = (prev & (1 << 24)) !== 0;
      at = prev & 0xffffff;
      if (at === 0 && !inB) break;
    }
    const text = out.reverse().join('').trim();
    let letters = 0;
    for (const ch of text) if (ch !== ' ') letters++;
    return { text, score: best, letters };
  }

  /* ------------------------------------------------------------------ */
  /* Knowing the air                                                     */
  /* ------------------------------------------------------------------ */

  // Plain words that are not abbreviations (those come from CW_WORDS, the
  // same table that explains them under the text) but are heard all the time.
  const PLAIN = ('NAME QTH AGE RIG ANT PWR WX TEMP TEST THE AND IS MY UR TO ON IN AT OF ALL NOW NOT ' +
    'NO YES OK HERE BEST REGARDS GOOD LUCK SEE YOU AGAIN SOON BYE THANKS PLEASE STATION POWER ' +
    'ANTENNA DIPOLE VERTICAL BEAM YAGI LOOP WIRE WATTS KW SOLID COPY NOISE RAIN SNOW SUN CLOUD ' +
    'CLEAR WIND FINE NICE HEAVY LITTLE HOT COLD WARM CITY TOWN YEARS OLD ' +
    'BE THAT HAVE I IT FOR WITH HE AS DO THIS BUT HIS BY FROM THEY WE SAY HER SHE OR AN WILL ONE ' +
    'WOULD THERE THEIR WHAT SO UP OUT IF ABOUT WHO GET WHICH GO ME WHEN MAKE CAN LIKE TIME JUST HIM ' +
    'KNOW TAKE INTO YEAR YOUR SOME COULD THEM OTHER THAN THEN LOOK ONLY COME ITS OVER THINK ALSO ' +
    'BACK AFTER USE TWO HOW OUR WORK FIRST WELL WAY EVEN NEW WANT BECAUSE ANY THESE GIVE DAY MOST US ' +
    'ARE WAS WERE BEEN HAS HAD DID DOES MUCH VERY MANY MORE HEAR SEND SENT RECEIVE RECEIVED SIGNAL ' +
    'REPORT WEATHER TEMPERATURE SUNNY CLOUDY BAD STRONG WEAK LOUD TOWER WATT RADIO TRANSCEIVER ' +
    'AMPLIFIER KEY PADDLE COUNTRY HOPE MEET LATER TODAY TOMORROW MORNING EVENING NIGHT THANK SORRY ' +
    'HEALTH FAMILY FRIEND HAM AMATEUR CONTEST AWARD').split(' ');

  const CALL = /^[A-Z0-9]{1,3}[0-9][A-Z]{1,4}(\/[A-Z0-9]{1,3})?$/;
  const RST = /^[1-5][1-9][1-9]$|^[1-5]N[1-9]$|^[1-5][1-9]N$|^5NN$/;

  /**
   * What the decoder knows: the abbreviations (handed over by the page from
   * CW_WORDS), plain words, and — the strongest hint there is — the
   * operator's own log: the calls, names and places actually heard on these
   * bands. The log stays on this computer; it only reaches this worker.
   */
  function makeKnowledge(given) {
    given = given || {};
    const words = new Set(PLAIN);
    for (const w of given.words || []) words.add(String(w).toUpperCase());
    const calls = new Set(), prefixes = new Set(), names = new Set(), places = new Set();
    for (const c of given.calls || []) {
      const call = String(c).toUpperCase().trim();
      if (!call) continue;
      calls.add(call);
      const base = call.split('/')[0], at = base.search(/[0-9]/);
      if (at > 0) prefixes.add(base.slice(0, at + 1));
    }
    const split = (list, into) => {
      for (const v of list || []) {
        for (const part of String(v).toUpperCase().split(/[^A-Z0-9]+/)) if (part.length >= 2) into.add(part);
      }
    };
    split(given.names, names);
    split(given.places, places);
    return { words, calls, prefixes, names, places };
  }

  /**
   * How much a text sounds like the air, in the same units as the sound.
   * Abbreviations weigh most (they are used nearly always — the owner's own
   * rule), a call from the log more still. An unknown word is barely charged
   * — the air is full of names and towns no dictionary has — but a lone
   * letter is: speech is not made of them, and charging unknown words by
   * length made the search shatter "NASA TO HOST" into "N A S A T O H O S T".
   */
  function langScore(text, k) {
    let total = 0;
    for (const raw of text.toUpperCase().split(/\s+/)) {
      const token = raw.replace(/[^A-Z0-9/?=+]/g, '');
      if (!token) continue;
      const n = token.length;
      if (k.words.has(token)) { total += 1.6 * n; continue; }
      if (RST.test(token)) { total += 1.4 * n; continue; }
      if (CALL.test(token)) {
        const base = token.split('/')[0], at = base.search(/[0-9]/);
        const prefix = at > 0 ? base.slice(0, at + 1) : '';
        if (k.calls.has(token)) total += 2.2 * n;
        else if (k.prefixes.has(prefix)) total += 1.4 * n;
        else total += 0.9 * n;
        continue;
      }
      if (k.names.has(token)) { total += 1.4 * n; continue; }
      if (k.places.has(token)) { total += 1.3 * n; continue; }
      if (/^[0-9]+$/.test(token)) { total += 0.5 * n; continue; }
      if (n === 1) { total -= 1.1; continue; }
      total -= 0.12 * n;
    }
    return total;
  }

  /** Whether two words are one edit apart — two readings of one call. */
  function oneEdit(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, bad = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++bad > 1) return false;
      if (a.length === b.length) { i++; j++; } else if (a.length > b.length) i++; else j++;
    }
    return bad + (a.length - i) + (b.length - j) <= 1;
  }

  /**
   * A transmission follows rules, and that is stronger than a dictionary:
   * CQ comes two or three times, a call follows DE and is said twice, the
   * report follows RST, the end is K or 73. And one call read two ways in
   * one transmission means a mistake somewhere.
   */
  function rules(text) {
    const t = text.toUpperCase().split(/\s+/).filter(Boolean);
    let bonus = 0, run = 0;
    for (const w of t) {
      if (w === 'CQ') { run++; if (run >= 2) bonus += 3; } else run = 0;
    }
    for (let i = 0; i < t.length - 1; i++) {
      if (t[i] !== 'DE') continue;
      if (CALL.test(t[i + 1])) bonus += 4;
      if (t[i + 2] === t[i + 1]) bonus += 4;
    }
    const seen = new Map();
    for (const w of t) if (CALL.test(w)) seen.set(w, (seen.get(w) || 0) + 1);
    for (const n of seen.values()) if (n > 1) bonus += 3 * (n - 1);
    const calls = Array.from(seen.keys());
    for (let i = 0; i < calls.length; i++) {
      for (let j = i + 1; j < calls.length; j++) if (oneEdit(calls[i], calls[j])) bonus -= 5;
    }
    for (let i = 0; i < t.length - 1; i++) {
      if ((t[i] === 'RST' || t[i] === 'UR' || t[i] === 'URS') && RST.test(t[i + 1])) bonus += 3;
    }
    if (['K', 'KN', 'AR', 'SK', 'BK', '73', 'TU', 'E'].includes(t[t.length - 1])) bonus += 2;
    return bonus;
  }

  /* ------------------------------------------------------------------ */
  /* A whole stretch of sound                                            */
  /* ------------------------------------------------------------------ */

  function layerFor(u) {
    const want = u * HOP_MS / 2;
    let at = 0;
    for (let i = 1; i < WINDOWS.length; i++) {
      if (Math.abs(WINDOWS[i] - want) < Math.abs(WINDOWS[at] - want)) at = i;
    }
    return at;
  }

  function layersFor(x, rate, tone) {
    const scored = WINDOWS.map(win => softScores(x, rate, tone, win));
    return { tone, scored, layers: scored.map(s => s.soft) };
  }

  /** Pieces between long silences: nobody is sending in between. */
  function pieces(soft, quiet) {
    const found = [];
    let i = 0;
    while (i < soft.length) {
      while (i < soft.length && soft[i] <= 0) i++;
      if (i >= soft.length) break;
      let j = i, lastOn = i;
      while (j < soft.length) {
        if (soft[j] > 0) lastOn = j; else if (j - lastOn > quiet) break;
        j++;
      }
      const from = Math.max(0, i - 4), to = Math.min(soft.length, lastOn + 4);
      if (to - from > 8) found.push([from, to]);
      i = j;
    }
    return found;
  }

  /** A first guess at the dot: the middle of the short runs. */
  function guessUnit(soft) {
    const runs = [];
    let at = 0;
    while (at < soft.length) {
      const sign = soft[at] > 0;
      let n = 0;
      while (at < soft.length && (soft[at] > 0) === sign) { n++; at++; }
      if (n >= 2 && n < 200) runs.push(n);
    }
    if (runs.length < 6) return 20;
    runs.sort((a, b) => a - b);
    const low = runs.slice(0, Math.max(3, Math.round(runs.length * 0.45)));
    return Math.max(10, Math.min(100, low[Math.floor(low.length / 2)]));
  }

  /**
   * Is anybody sending — as a statistic that knows how long the piece is.
   * The piece's energy against the noise at the same frequency (the
   * neighbours sit on the skirt of a 250 Hz filter and would mislead), the
   * excess scaled by the root of the number of independent windows. Ten
   * seconds of a weak station is overwhelming evidence; a crackle is not.
   */
  function evidenceOf(L, layer, from, to) {
    const sc = L.scored[layer], env = sc.env, sigma = sc.noise;
    let e2 = 0;
    for (let i = from; i < to; i++) e2 += env[i] * env[i];
    const ratio = (e2 / Math.max(1, to - from)) / (2 * sigma * sigma);
    const independent = (to - from) * HOP_MS / WINDOWS[layer];
    return (ratio - 1) * Math.sqrt(Math.max(1, independent));
  }

  /** How far the envelope swings: keying does, a steady carrier does not. */
  function swingOf(L, layer, from, to) {
    const env = L.scored[layer].env;
    const r = Array.from(env.subarray(from, to));
    if (r.length < 20) return 0;
    r.sort((a, b) => a - b);
    const low = r[Math.floor(r.length * 0.15)], high = r[Math.floor(r.length * 0.9)];
    return high > 0 ? (high - low) / high : 0;
  }

  /** The tone against its neighbours over the whole piece, unbiased. */
  function powerRatio(L, layer, from, to) {
    const { env, near } = L.scored[layer];
    let a = 0, b = 0;
    for (let i = from; i < to; i++) { a += env[i]; b += near[i]; }
    return b > 0 ? a / b : 0;
  }

  /**
   * The speed and the stretch of the gaps belong to a hand, so they are
   * chosen from one station's own pieces — the most convincing ones — and
   * over the whole scale rather than around a first guess, which on a weak
   * signal is pieced together from fragments and nearly always too fast.
   * All speeds are compared on one window: the speed is a matter of rhythm,
   * and a shorter window overlaps less and would pull towards faster ones.
   */
  function chooseStyle(L, spans, unit0) {
    const ranked = spans.map(([from, to]) => [from, to, evidenceOf(L, SPEED_LAYER, from, to)])
      .filter(sp => sp[2] >= MIN_Z)
      .sort((p, q) => q[2] - p[2]);
    const probe = (ranked.length ? ranked : spans.map(([a, b]) => [a, b, 0])).slice(0, 5)
      .map(([from, to]) => [from, Math.min(to, from + 1500)]);
    if (!probe.length) return { unit: unit0, space: 1 };
    const soft = L.layers[SPEED_LAYER];
    const weigh = (u, sp) => {
      let total = 0;
      for (const [from, to] of probe) total += parsePiece(soft.subarray(from, to), u, sp).score;
      return total - SPACE_COST * (sp - 1) * probe.length;
    };
    let unit = unit0, space = 1, best = -Infinity;
    for (let u = 10; u <= 100; u = Math.max(u + 1, Math.round(u * 1.25))) {
      for (const sp of [1, 1.5, 2]) {
        const v = weigh(u, sp);
        if (v > best) { best = v; unit = u; space = sp; }
      }
    }
    for (const u of [unit - 2, unit - 1, unit, unit + 1, unit + 2]) {
      if (u < 8 || u > 110) continue;
      for (const sp of [1, 1.2, 1.45, 1.7, 2]) {
        const v = weigh(u, sp);
        if (v > best) { best = v; unit = u; space = sp; }
      }
    }
    return { unit, space };
  }

  /** One piece; an empty string when there is nothing here to read. */
  function decodeSpan(L, from, to, style, knowledge, extra) {
    const layer = layerFor(style.unit);
    if (evidenceOf(L, layer, from, to) < MIN_Z) return '';
    if (swingOf(L, layer, from, to) < MIN_SWING) return '';
    // Searching for three stations gives the noise three tries, so every
    // tone but the main one has to prove more.
    if (extra && powerRatio(L, layer, from, to) < MIN_RATIO) return '';
    // Readings from the speed and the stretch of the gaps around the chosen
    // ones; the knowledge of the air picks among those that already fit the
    // rhythm. The sound enters the comparison as it is.
    let got = null, bestTotal = -Infinity;
    for (const u of [style.unit - 1, style.unit, style.unit + 1]) {
      if (u < 8 || u > 110) continue;
      const soft = L.layers[layerFor(u)].subarray(from, to);
      for (const sp of [0.7, 0.85, 1, 1.2, 1.45, 1.75, 2.1]) {
        const cand = parsePiece(soft, u, sp);
        if (!cand.text) continue;
        const total = cand.score + LANG_WEIGHT * langScore(cand.text, knowledge) + RULE_WEIGHT * rules(cand.text);
        if (total > bestTotal) { bestTotal = total; got = cand; }
      }
    }
    return got && got.letters ? got.text : '';
  }

  function mergeSpans(lists) {
    const all = [].concat(...lists).sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const sp of all) {
      const last = out[out.length - 1];
      if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
      else out.push([sp[0], sp[1]]);
    }
    return out;
  }

  /**
   * Cut a piece where the voice changes. The answer usually comes half a
   * second after K and the two pieces merge; given whole to one station,
   * the second one's words are read at the wrong tone and come out as a row
   * of E's. The owner is decided in 200 ms blocks, a change counts only if
   * it holds for 600 ms, and the cut moves to the quietest place nearby.
   */
  function splitByOwner(Ls, from, to) {
    const BLOCK = 80, HOLD = 3;
    const blocks = [];
    for (let b = from; b < to; b += BLOCK) {
      const e = Math.min(to, b + BLOCK);
      let best = -1, at = -1;
      Ls.forEach((L, i) => {
        const soft = L.layers[1], env = L.scored[1].env, near = L.scored[1].near;
        let sum = 0, cnt = 0;
        for (let k = b; k < e; k++) if (soft[k] > 0) { sum += env[k] / near[k]; cnt++; }
        const v = cnt >= 4 ? sum / cnt : 0;
        if (v > best) { best = v; at = i; }
      });
      blocks.push(best > 0 ? at : -1);
    }
    const owner = blocks.slice();
    let cur = owner.find(o => o >= 0);
    if (cur === undefined) return [];
    for (let k = 0; k < owner.length; k++) {
      if (owner[k] < 0 || owner[k] === cur) { owner[k] = cur; continue; }
      let run = 0;
      while (k + run < owner.length && (blocks[k + run] === blocks[k] || blocks[k + run] < 0)) run++;
      if (run >= HOLD) cur = blocks[k];
      owner[k] = cur;
    }
    const out = [];
    let start = from, who = owner[0];
    for (let k = 1; k < owner.length; k++) {
      if (owner[k] === who) continue;
      const guess = from + k * BLOCK;
      let cut = guess, low = Infinity;
      for (let t = Math.max(start + 1, guess - BLOCK); t < Math.min(to - 1, guess + BLOCK); t++) {
        let v = -Infinity;
        for (const L of Ls) v = Math.max(v, L.layers[1][t]);
        if (v < low) { low = v; cut = t; }
      }
      out.push([start, cut, who]);
      start = cut; who = owner[k];
    }
    out.push([start, to, who]);
    return out.filter(([a, b]) => b - a > 8);
  }

  /**
   * Read a stretch of sound. Two operators on one frequency take turns and
   * the one answering sounds a little higher or lower, so there is no need
   * to pull apart two signals sounding at once: each piece belongs to the
   * tone that is sharpest in it, and is read at that station's own speed.
   * The main station is the one with the most evidence, not the one whose
   * tone happened to be found first — on a weak signal a noise peak could
   * come first, and the real station, judged as an extra, was thrown away.
   *
   * @param x       mono samples
   * @param rate    sample rate
   * @param options { knowledge, tones: [Hz] to skip the search }
   */
  function decodeSamples(x, rate, options) {
    options = options || {};
    const knowledge = options.knowledge || makeKnowledge();
    const tones = options.tones && options.tones.length
      ? options.tones.map(t => ({ tone: t, sharp: 0 }))
      : findTones(x, rate, MAX_STATIONS);
    const Ls = tones.map(t => layersFor(x, rate, t.tone));

    // Reading as the sound comes in, the stretch handed over starts with a
    // few seconds already read: they make the noise and level estimates
    // sounder, but no piece may begin in them — their letters are out.
    if (options.ignoreBefore > 0) {
      const stop = Math.floor(options.ignoreBefore / Math.round(rate * HOP_MS / 1000));
      for (const L of Ls) for (const soft of L.layers) soft.fill(-6, 0, Math.min(stop, soft.length));
    }

    const unit0 = guessUnit(Ls[0].layers[1]);
    const quiet = Math.max(160, Math.round(unit0 * 12));
    const merged = mergeSpans(Ls.map(L => pieces(L.layers[1], quiet)));
    const parts = [];
    for (const [from, to] of merged) {
      if (Ls.length === 1) parts.push([from, to, 0]);
      else parts.push(...splitByOwner(Ls, from, to));
    }

    const weight = Ls.map(() => 0);
    for (const [from, to, i] of parts) weight[i] += Math.max(0, evidenceOf(Ls[i], SPEED_LAYER, from, to));

    // A station's speed is worked out afresh when this stretch carries
    // enough of it to tell; otherwise the one remembered from before is
    // used. A short "R TU" on its own shows no speed at all, but read at
    // the speed this station had a minute ago it reads fine.
    const styles = Ls.map((L, i) => {
      const own = parts.filter(p => p[2] === i).map(p => [p[0], p[1]]);
      if (!own.length) return null;
      const known = options.styles && options.styles[L.tone];
      if (known && weight[i] < STYLE_EVIDENCE) return known;
      return chooseStyle(L, own, unit0);
    });
    let main = 0;
    for (let i = 1; i < Ls.length; i++) if (weight[i] > weight[main]) main = i;

    let segments = [];
    for (const [from, to, i] of parts) {
      if (!styles[i]) continue;
      const text = decodeSpan(Ls[i], from, to, styles[i], knowledge, i !== main);
      if (text) segments.push({ station: i, tone: Ls[i].tone, from: from * HOP_MS / 1000, to: to * HOP_MS / 1000, text });
    }

    // A station heard for fewer than a few letters is not shown: every
    // noise leak ever seen was two or three letters (EM, ET E, M R). A lone
    // TU goes too; that is cheaper than printing letters out of a hum.
    const letters = Ls.map(() => 0);
    for (const sg of segments) letters[sg.station] += sg.text.replace(/[^A-Z0-9?/=]/g, '').length;
    const least = options.minStationLetters === undefined ? MIN_STATION_LETTERS : options.minStationLetters;
    segments = segments.filter(sg => letters[sg.station] >= least);

    const parts2 = [];
    let prev = -1;
    for (const sg of segments) {
      if (prev !== -1 && sg.station !== prev) parts2.push('|');
      parts2.push(sg.text);
      prev = sg.station;
    }
    const style = styles[main] || { unit: unit0, space: 1 };
    const stylesByTone = {};
    Ls.forEach((L, i) => { if (styles[i]) stylesByTone[L.tone] = styles[i]; });
    const weights = {};
    Ls.forEach((L, i) => { weights[L.tone] = weight[i]; });
    return {
      tone: Ls[main].tone, tones: Ls.map(L => L.tone), main, styles: stylesByTone, weights,
      unit: style.unit, space: style.space, wpm: Math.round(1200 / (style.unit * HOP_MS)),
      text: parts2.join(' '), segments
    };
  }

  /* ------------------------------------------------------------------ */
  /* Reading as the sound comes in                                       */
  /* ------------------------------------------------------------------ */

  const CHECK_EVERY = 1.0;        // seconds between looks at what has come in
  const CONTEXT = 4;              // seconds of sound already read, kept for the estimates
  const LONGEST = 8;              // a transmission without a break is cut after this
  const MIN_STRETCH = 3;          // seconds gathered before cutting between words
  const SCAN_EVERY = 3;           // seconds between looks for a newly appeared tone

  /**
   * The same decoder, fed piece by piece. Sound piles up; once a second it
   * looks whether the sending has broken off — a silence a few letters
   * long — and when it has, that stretch is read whole, exactly as a
   * recording would be. A transmission that runs on without a break is
   * cut at its quietest place after LONGEST seconds, so the text never
   * lags far behind. Stations are kept by their tone across stretches, and
   * each keeps its speed.
   */
  function makeStream(options) {
    options = options || {};
    const knowledge = makeKnowledge(options.knowledge);
    let rate = 0;
    let buf = new Float32Array(0);
    let base = 0;                 // the absolute sample index of buf[0]
    let done = 0;                 // everything before this has been read
    let lastLook = 0;
    let stations = [];            // { tone, style, weight }
    let unitGuess = 24;
    let recent = [], lastScan = 0;

    const end = () => base + buf.length;

    function append(samples) {
      const next = new Float32Array(buf.length + samples.length);
      next.set(buf);
      next.set(samples, buf.length);
      buf = next;
      // Keep only what may still be needed: the unread sound and some
      // context before it.
      const keepFrom = Math.max(base, done - Math.round(CONTEXT * rate));
      if (keepFrom - base > rate * 2) {
        buf = buf.slice(keepFrom - base);
        base = keepFrom;
      }
    }

    function stationFor(tone) {
      let best = -1, gap = 26;
      stations.forEach((s, i) => { if (Math.abs(s.tone - tone) < gap) { gap = Math.abs(s.tone - tone); best = i; } });
      return best;
    }

    /**
     * Where the unread sound may be cut. Two kinds of place: the end of a
     * transmission (a silence a dozen dots long — read at once, so the text
     * of an over appears right after its K), and a gap between words (a
     * full silence, so cutting there loses nothing). Cutting only at long
     * silences waited for a break that a quick answer never gives — the
     * reply comes half a second after K — and then cut at "the quietest
     * place", right through the words of both stations.
     */
    function places(x, tones) {
      const hop = Math.round(rate * HOP_MS / 1000);
      const endQuiet = Math.max(Math.round(400 / HOP_MS), Math.round(unitGuess * 12));
      const wordQuiet = Math.max(Math.round(250 / HOP_MS), Math.round(unitGuess * 5));
      const startHop = Math.max(0, Math.floor((done - base) / hop));
      let active = null;
      for (const t of tones) {
        const soft = softScores(x, rate, t, 10).soft;
        if (!active) active = new Uint8Array(soft.length);
        for (let i = 0; i < soft.length; i++) if (soft[i] > 0) active[i] = 1;
      }
      if (!active) return null;
      let lastOn = -1, run = 0, endCut = null;
      const wordCuts = [];
      for (let i = startHop; i < active.length; i++) {
        if (active[i]) {
          if (lastOn >= 0 && run >= wordQuiet) wordCuts.push({ at: base + (i - Math.floor(run / 2)) * hop, run });
          lastOn = i; run = 0;
          continue;
        }
        run++;
        if (lastOn >= 0 && run === endQuiet) endCut = base + (lastOn + Math.round(endQuiet / 2)) * hop;
      }
      return { endCut, wordCuts, lastOn };
    }

    function read(upTo) {
      const x = buf.subarray(0, Math.max(0, upTo - base));
      if (x.length < rate * 0.5) { done = upTo; return []; }
      const found = findTones(x, rate, MAX_STATIONS).map(t => t.tone);
      const styles = {};
      for (const t of found) {
        const k = stationFor(t);
        if (k >= 0 && stations[k].style) styles[t] = stations[k].style;
      }
      // The few-letters rule counts over the whole session here, not over
      // one stretch: counted per stretch it cut off the honest start of
      // every transmission — "AND" of a sentence, the first words of an
      // answer. A station's first pieces are held back until it has said
      // enough to be believed, then let out together.
      const got = decodeSamples(x, rate, { knowledge, tones: found, styles, ignoreBefore: done - base, minStationLetters: 0 });
      if (options.trace) options.trace(`читаю ${((done) / rate).toFixed(1)}–${(upTo / rate).toFixed(1)} с · тона ${found.join(',')} · ` +
        got.segments.map(g => `[${g.tone}] ${g.text}`).join(' / '));
      const out = [];
      for (const sg of got.segments) {
        let k = stationFor(sg.tone);
        if (k < 0) { stations.push({ tone: sg.tone, style: null, weight: 0, letters: 0, held: [] }); k = stations.length - 1; }
        const st = stations[k];
        const item = { station: k, tone: sg.tone, text: sg.text, at: (base / rate) + sg.from };
        st.letters += sg.text.replace(/[^A-Z0-9?/=]/g, '').length;
        if (st.letters >= MIN_STATION_LETTERS) {
          out.push(...st.held, item);
          st.held = [];
        } else {
          st.held.push(item);
        }
      }
      // Remember each station's speed, trusting the stretch that said the
      // most about it.
      for (const t of got.tones) {
        const k = stationFor(t);
        if (k < 0 || !got.styles[t]) continue;
        const w = got.weights[t] || 0;
        if (!stations[k].style || w >= stations[k].weight * 0.5) {
          stations[k].style = got.styles[t];
          stations[k].weight = Math.max(stations[k].weight * 0.9, w);
        }
      }
      if (got.unit) unitGuess = got.unit;
      done = upTo;
      return out;
    }

    /**
     * The tones to watch: the stations already heard, and whatever has
     * newly appeared in the last few seconds. Watching only the known ones
     * missed the answer — the second operator sounds at another tone, so
     * to the stream it was silence, and the start of the reply was thrown
     * away with it.
     */
    function watched(x) {
      if (end() - lastScan >= rate * SCAN_EVERY || !recent.length) {
        lastScan = end();
        const from = Math.max(0, x.length - Math.round(rate * SCAN_EVERY), done - base);
        recent = x.length - from > rate * 0.5 ? findTones(x.subarray(from), rate, MAX_STATIONS).map(t => t.tone) : [];
      }
      const tones = stations.map(s => s.tone);
      for (const t of recent) if (!tones.some(k => Math.abs(k - t) < 40)) tones.push(t);
      return tones;
    }

    function look(final) {
      if (!rate || end() - done < rate * 0.3) return [];
      const x = buf;
      if (final) return read(end());
      const at = places(x, watched(x));
      if (!at) return [];
      // The end of a transmission: read it now.
      if (at.endCut !== null) return read(at.endCut);
      // Nothing on the watched tones for a long while. Not thrown away
      // unread: the reading itself decides whether anybody is there, and
      // it says nothing when nobody is.
      if (at.lastOn < 0) {
        if (end() - done > rate * LONGEST) return read(end() - Math.round(rate));
        return [];
      }
      // Between words, once enough has gathered to give the reading some
      // context: the latest word gap at least MIN_STRETCH seconds in.
      const ripe = at.wordCuts.filter(c => c.at - done >= rate * MIN_STRETCH);
      if (ripe.length) return read(ripe[ripe.length - 1].at);
      // Sending on and on without a word gap long enough: the longest gap
      // there is.
      if (end() - done > rate * LONGEST && at.wordCuts.length) {
        const widest = at.wordCuts.reduce((p, q) => (q.run > p.run ? q : p));
        return read(widest.at);
      }
      return [];
    }

    return {
      push(samples, sampleRate) {
        rate = sampleRate;
        append(samples);
        if (end() - lastLook < rate * CHECK_EVERY) return [];
        lastLook = end();
        return look(false);
      },
      flush() { return look(true); },
      reset() { buf = new Float32Array(0); base = 0; done = 0; lastLook = 0; stations = []; recent = []; lastScan = 0; },
      get stations() { return stations.map(s => ({ tone: s.tone, wpm: s.style ? Math.round(1200 / (s.style.unit * HOP_MS)) : 0 })); }
    };
  }

  const api = { decodeSamples, makeStream, makeKnowledge, findTones, softScores, parsePiece, HOP_MS };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CwSoft = api;
})(typeof self !== 'undefined' ? self : this);

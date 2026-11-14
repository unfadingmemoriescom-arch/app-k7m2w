/* follow.js — the voice follower. Engine-agnostic: heard words (with times) go in, a line index comes out.
   Used by app.js on the phone and by test/replay.js in Node, so both run the exact same logic.

   Rules it implements (from how Bo actually preaches):
   - Advance only when most of the END of the current line has been heard, in order, just now.
   - Ad-libs match nothing, so the screen waits.
   - If he skips ahead, a later line (within LOOKAHEAD) that is clearly being spoken wins: jump there.
   - Never go backwards by itself. Repeats of the previous line match nothing new, so nothing moves.
   - Fuzzy word matching: contractions, somebody/someone, numbers, misheard Bible names.
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Follower = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- word normalisation ----------
  const CONTRACTIONS = {
    im: 'i am', youre: 'you are', hes: 'he is', shes: 'she is', its: 'it is', were: 'we are', theyre: 'they are',
    ive: 'i have', youve: 'you have', weve: 'we have', theyve: 'they have', ill: 'i will', youll: 'you will', hell: 'he will',
    well: 'we will', theyll: 'they will', id: 'i would', youd: 'you would', hed: 'he would', wed: 'we would', theyd: 'they would',
    dont: 'do not', doesnt: 'does not', didnt: 'did not', cant: 'can not', cannot: 'can not', couldnt: 'could not', wont: 'will not',
    wouldnt: 'would not', shouldnt: 'should not', isnt: 'is not', arent: 'are not', wasnt: 'was not', werent: 'were not',
    hasnt: 'has not', havent: 'have not', hadnt: 'had not', thats: 'that is', whats: 'what is', wheres: 'where is', theres: 'there is',
    heres: 'here is', whos: 'who is', lets: 'let us', aint: 'is not', gonna: 'going to', wanna: 'want to', gotta: 'got to',
    yall: 'you all', cause: 'because', til: 'until', till: 'until', ok: 'okay'
  };
  const SYNONYM = {
    someone: 'somebody', everyone: 'everybody', anyone: 'anybody', noone: 'nobody', yeah: 'yes', yep: 'yes',
    tryin: 'trying', nothin: 'nothing', somethin: 'something', christ: 'jesus',
    // Bible words the recognizer gets wrong -> what the script says
    zakiya: 'zacchaeus', zaccheus: 'zacchaeus', zacheus: 'zacchaeus', zakias: 'zacchaeus', zakeus: 'zacchaeus', zacchaeuss: 'zacchaeus',
    elroy: 'elroi', roi: 'elroi', roy: 'elroi', jerico: 'jericho', sicamore: 'sycamore', sickamore: 'sycamore', abram: 'abraham'
  };
  const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  function numberWords(n) {
    n = +n; if (!(n >= 0) || n > 9999) return [String(n)];
    if (n < 20) return [ONES[n]];
    if (n < 100) return [TENS[Math.floor(n / 10)]].concat(n % 10 ? [ONES[n % 10]] : []);
    if (n < 1000) return [ONES[Math.floor(n / 100)], 'hundred'].concat(n % 100 ? numberWords(n % 100) : []);
    return [ONES[Math.floor(n / 1000)], 'thousand'].concat(n % 1000 ? numberWords(n % 1000) : []);
  }
  const STOP = new Set(['the', 'a', 'an', 'and', 'to', 'of', 'in', 'on', 'at', 'is', 'it', 'i', 'you', 'he', 'me', 'my', 'that', 'this', 'be', 'was', 'not', 'do', 'am', 'are', 'so', 'but', 'or', 'for', 'with', 'his', 'her', 'him', 'they', 'we', 'us', 'all', 'if', 'then']);

  // One raw word -> array of normalised tokens.
  function tokens(raw) {
    let w = String(raw).toLowerCase().replace(/[’‘`´]/g, "'");
    w = w.replace(/[^a-z0-9':]+/g, ' ').trim();
    if (!w) return [];
    const out = [];
    for (let part of w.split(/\s+/)) {
      part = part.replace(/'/g, '');
      if (!part) continue;
      if (/^\d+(:\d+)?$/.test(part)) { part.split(':').filter(Boolean).forEach(n => out.push(...numberWords(n))); continue; }
      if (/^\d+(st|nd|rd|th)$/.test(part)) { out.push(...numberWords(parseInt(part, 10))); continue; }
      if (CONTRACTIONS[part]) { out.push(...CONTRACTIONS[part].split(' ')); continue; }
      out.push(SYNONYM[part] || part);
    }
    return out;
  }
  function tokenize(text) { const out = []; String(text).split(/\s+/).forEach(w => out.push(...tokens(w))); return out; }

  // ---------- fuzzy equality ----------
  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = new Array(b.length + 1), cur = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      cur[0] = i; let rowMin = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > max) return max + 1;
      [prev, cur] = [cur, prev];
    }
    return prev[b.length];
  }
  const stem = s => s.replace(/(ies|es|s|ed|ing)$/, m => (m === 'ies' ? 'y' : ''));
  const simCache = new Map();
  function sim(a, b) {
    if (a === b) return 1;
    const key = a < b ? a + '|' + b : b + '|' + a;
    let v = simCache.get(key); if (v != null) return v;
    v = 0;
    if (stem(a) === stem(b) && a.length >= 3) v = 0.95;
    else if (a.length >= 4 && b.length >= 4) {
      const max = (a.length >= 6 && b.length >= 6) ? 2 : 1;
      const d = lev(a, b, max);
      if (d <= max) v = d === 1 ? 0.9 : 0.8;
      else if (a.length >= 6 && b.length >= 6 && a.slice(0, 4) === b.slice(0, 4)) v = 0.72;
    }
    if (simCache.size > 20000) simCache.clear();
    simCache.set(key, v); return v;
  }
  const MATCH = 0.7;

  // In-order alignment of a line's tokens against a window of heard tokens (LCS with fuzzy equality).
  // Returns {count, matched[] (bool per line token), posFirst, posLast (heard positions), score}.
  function align(lineToks, heard, from) {
    const n = lineToks.length, m = heard.length - from;
    if (n === 0 || m <= 0) return { count: 0, matched: new Array(n).fill(false), pos: new Array(n).fill(-1), posFirst: -1, posLast: -1, weight: 0 };
    // dp[i][j] = best (weighted) match of first i line tokens vs first j heard tokens
    const W = n + 1, dp = new Float32Array((n + 1) * (m + 1)), dir = new Uint8Array((n + 1) * (m + 1));
    for (let i = 1; i <= n; i++) {
      const lt = lineToks[i - 1], wt = STOP.has(lt) ? 0.6 : 1;
      for (let j = 1; j <= m; j++) {
        const ht = heard[from + j - 1];
        let best = dp[(i - 1) * (m + 1) + j], d = 1;                 // skip line token
        const v2 = dp[i * (m + 1) + j - 1]; if (v2 > best) { best = v2; d = 2; } // skip heard token
        const s = sim(lt, ht);
        if (s >= MATCH) { const v3 = dp[(i - 1) * (m + 1) + j - 1] + s * wt; if (v3 >= best) { best = v3; d = 3; } }
        dp[i * (m + 1) + j] = best; dir[i * (m + 1) + j] = d;
      }
    }
    const matched = new Array(n).fill(false), pos = new Array(n).fill(-1); let i = n, j = m, posFirst = -1, posLast = -1, count = 0;
    while (i > 0 && j > 0) {
      const d = dir[i * (m + 1) + j];
      if (d === 3) { matched[i - 1] = true; pos[i - 1] = from + j - 1; count++; posFirst = from + j - 1; if (posLast < 0) posLast = from + j - 1; i--; j--; }
      else if (d === 1) i--; else j--;
    }
    return { count, matched, pos, posFirst, posLast, weight: dp[n * (m + 1) + m] };
  }

  // ---------- the follower ----------
  const DEFAULTS = {
    lookahead: 5,        // how many lines ahead it may jump when he skips
    windowSec: 14,       // only words heard this recently count
    endTokens: 3,        // "the end of the line" = its last 3 tokens
    endNeed: 2,          // ...of which this many must be heard
    minCoverage: 0.5,    // and at least this share of the whole line
    recentTokens: 2,     // the end must have been heard within the last N heard words
    skipCoverage: 0.6,   // a later line needs this share heard (in order)...
    skipMinCount: 3,     // ...and at least this many words, to jump to it
    chain: 3             // max lines advanced from one heard word (two short lines said fast)
  };

  function create(lines, opts) {
    const cfg = Object.assign({}, DEFAULTS, opts || {});
    const L = lines.map(l => tokenize(l.t));
    // "Meaningful" words of each line: everything that is not a filler word. A line with none keeps all its words.
    const C = L.map(toks => { const c = []; toks.forEach((t, k) => { if (!STOP.has(t)) c.push(k); }); return c.length ? c : toks.map((_, k) => k); });
    const st = { i: 0, heard: [], times: [], consumed: 0, events: [] };

    function setIndex(k) { st.i = Math.max(0, Math.min(L.length - 1, k)); st.consumed = st.heard.length; }

    function windowStart(tNow) {
      let s = st.consumed;
      while (s < st.times.length && tNow - st.times[s] > cfg.windowSec) s++;
      return s;
    }
    const contentCount = (a, k) => C[k].reduce((n, idx) => n + (a.matched[idx] ? 1 : 0), 0);

    // Has the END of line k been heard just now?
    function endSatisfied(a, k) {
      const c = C[k], e = Math.min(cfg.endTokens, c.length), endIdx = c.slice(c.length - e);
      const need = e <= 2 ? e : Math.min(cfg.endNeed, e);
      let got = 0, lastPos = -1; endIdx.forEach(idx => { if (a.matched[idx]) { got++; lastPos = Math.max(lastPos, a.pos[idx]); } });
      if (got < need) return false;
      const H = st.heard.length, fin = c[c.length - 1];
      if (a.matched[fin]) return a.pos[fin] >= H - cfg.recentTokens;           // heard the last meaningful word: go
      // last word missed (misheard name, swallowed word): go only once he has started the NEXT line
      if (lastPos < H - 6 || k + 1 >= L.length) return false;
      const nextStart = C[k + 1].slice(0, 2).map(idx => L[k + 1][idx]);
      for (let p = lastPos + 1; p < H; p++) for (const nt of nextStart) if (sim(st.heard[p], nt) >= MATCH) return true;
      return false;
    }

    // Feed one heard word (raw text) at time t (seconds). Returns an event or null.
    function push(raw, t) {
      const toks = tokens(raw);
      if (!toks.length) return null;
      for (const tk of toks) { st.heard.push(tk); st.times.push(t); }
      let ev = null;
      for (let hop = 0; hop < cfg.chain; hop++) {
        const from = windowStart(t);
        const cur = align(L[st.i], st.heard, from), curC = contentCount(cur, st.i), nC = C[st.i].length;
        // 1) finished the current line?
        if (nC > 0 && curC >= Math.ceil(nC * cfg.minCoverage) && endSatisfied(cur, st.i) && st.i < L.length - 1) {
          st.consumed = cur.posLast + 1;
          ev = { type: hop ? 'chain' : 'advance', from: st.i, to: st.i + 1, t };
          st.i++; st.events.push(ev); continue;
        }
        // 2) clearly speaking a later line already?
        let best = null;
        for (let j = st.i + 1; j <= Math.min(L.length - 1, st.i + cfg.lookahead); j++) {
          const nj = C[j].length; if (nj === 0) continue;
          const a = align(L[j], st.heard, from), cj = contentCount(a, j);
          const need = nj <= 2 ? nj : Math.max(Math.min(nj, cfg.skipMinCount), Math.ceil(nj * cfg.skipCoverage));
          if (cj < need) continue;
          if (nj <= 2 && a.count < L[j].length) continue;                         // tiny line: every word, in order
          if (a.posLast < st.heard.length - cfg.recentTokens) continue;          // not what he is saying right now
          if (a.posLast - a.posFirst > L[j].length + 4) continue;                 // scattered matches, not a real read
          if (curC > 0 && a.posFirst <= cur.posLast) continue;                    // he is still saying words of the current line
          if (!best || a.weight > best.a.weight) best = { j, a };
        }
        if (best) {
          st.consumed = Math.max(st.consumed, best.a.posFirst);
          ev = { type: 'jump', from: st.i, to: best.j, t };
          st.i = best.j; st.events.push(ev); continue;
        }
        break;
      }
      return ev;
    }

    // Live recognition revises its last few words. Drop heard tokens back to `len` (never below what
    // already triggered a move; a move is never undone, a tap fixes it).
    function truncate(len) {
      const keep = Math.max(st.consumed, Math.min(len, st.heard.length));
      st.heard.length = keep; st.times.length = keep;
    }

    return {
      push, setIndex, truncate,
      get heardLength() { return st.heard.length; },
      get index() { return st.i; },
      get events() { return st.events; },
      cfg, tokensOf: k => L[k]
    };
  }

  return { create, tokenize, tokens, sim, align, DEFAULTS };
});

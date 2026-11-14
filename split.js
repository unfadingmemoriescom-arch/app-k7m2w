/* split.js — turns a plain-text sermon manuscript into screen lines.
   One sentence per line; long sentences (over MAX_WORDS) split at a natural break.
   Works in the browser (window.SermonSplit) and in Node (module.exports). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SermonSplit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MAX_WORDS = 13;   // a sentence longer than this gets split
  const SOFT_WORDS = 9;   // ...and its pieces keep splitting at commas while longer than this
  const ABBREV = /\b(?:mr|mrs|ms|dr|st|vs|etc|jr|sr|rev|ps|cf|e\.g|i\.e)\.$/i;
  const CONJ = new Set(['and', 'but', 'because', 'so', 'who', 'that', 'which', 'when', 'or', 'while', 'until']);

  function words(s) { return s.trim().split(/\s+/).filter(Boolean); }
  function norm(s) { return s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim(); }

  function titleCase(s) {
    return s.toLowerCase().replace(/(^|[\s(\["“])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  }
  function isHeading(line) {
    const letters = line.replace(/[^A-Za-z]/g, '');
    return letters.length >= 3 && letters === letters.toUpperCase() && words(line).length <= 12;
  }
  function endsSentence(line) { return /[.?!…]["”')\]]*$/.test(line.trim()); }

  // Split a paragraph into sentences.
  function sentences(par) {
    const out = [];
    let buf = '';
    const toks = par.split(/(\s+)/);
    for (let k = 0; k < toks.length; k += 2) {
      const tok = toks[k], sp = toks[k + 1] || '';
      buf += tok;
      const nxt = toks[k + 2] || '';
      const numberDot = /^\d+\.$/.test(tok) && !/^["“'(]?[A-Z]/.test(nxt);
      const isEnd = /[.?!]["”')\]]*$/.test(tok) && !ABBREV.test(tok) && !numberDot;
      if (isEnd && sp) { out.push(buf.trim()); buf = ''; } else buf += sp;
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
  }

  // Split one long sentence at the break nearest the middle. Returns array of pieces.
  function splitLong(sent, soft) {
    const w = words(sent);
    if (w.length <= (soft ? SOFT_WORDS : MAX_WORDS)) return [sent];
    const mid = w.length / 2;
    let best = -1, bestD = Infinity;
    // 1) after a comma / colon / semicolon / dash, both sides >= 3 words
    for (let k = 2; k < w.length - 3; k++) {
      if (/[,;:—–]["”')]*$/.test(w[k]) || w[k + 1] === '—' || w[k + 1] === '–') {
        const d = Math.abs(k + 1 - mid);
        if (d < bestD) { bestD = d; best = k + 1; }
      }
    }
    // 2) otherwise before a joining word, only if still clearly long
    if (best < 0 && w.length > MAX_WORDS + 2) {
      for (let k = 4; k < w.length - 4; k++) {
        if (CONJ.has(norm(w[k]))) {
          const d = Math.abs(k - mid);
          if (d < bestD) { bestD = d; best = k; }
        }
      }
    }
    if (best < 0) return [sent];
    return splitLong(w.slice(0, best).join(' '), true).concat(splitLong(w.slice(best).join(' '), true));
  }

  function paragraphs(text) {
    text = text.replace(/\r\n?/g, '\n').replace(/ /g, ' ');
    const hasBlank = /\n\s*\n/.test(text);
    const blocks = hasBlank ? text.split(/\n\s*\n+/) : text.split(/\n/);
    return blocks.map(b => b.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  }

  // Mark build runs: 3+ lines in a row that open the same way.
  function markBuilds(lines) {
    const key = l => {
      const w = norm(l.t).split(' ');
      return w.length <= 3 ? w[0] : w.slice(0, 2).join(' ');
    };
    let k = 0;
    while (k < lines.length) {
      let j = k + 1;
      while (j < lines.length && key(lines[j]) === key(lines[k]) && key(lines[k])) j++;
      if (j - k >= 3) {
        for (let q = k; q < j; q++) { lines[q].b = 1; lines[q].bs = q === k ? 1 : 0; lines[q].land = q === j - 1 ? 1 : 0; }
      }
      k = j > k + 1 ? j : k + 1;
    }
    return lines;
  }

  /* parse(text) -> { title, meta:[...], lines:[{t,s,np,b,bs,land}] } */
  function parse(text) {
    const pars = paragraphs(text);
    const lines = [];
    let section = 'Opening', title = '', meta = [], started = false;
    for (const p of pars) {
      if (!started) {
        // Leading lines without sentence punctuation are the title / reference / series.
        if (!endsSentence(p) && words(p).length <= 14) {
          if (!title && isHeading(p)) title = titleCase(p); else if (!title) title = p; else meta.push(p);
          continue;
        }
        started = true;
      }
      if (isHeading(p)) { section = titleCase(p); continue; }
      let first = true;
      for (const s of sentences(p)) {
        for (const piece of splitLong(s)) {
          lines.push({ t: piece, s: section, np: first, b: 0, bs: 0, land: 0 });
          first = false;
        }
      }
    }
    return { title: title || 'Sermon', meta, lines: markBuilds(lines) };
  }

  // Accepts either a chunks.json array or a manuscript string.
  function load(input, nameHint) {
    if (typeof input === 'string') {
      const t = input.trim();
      if (t.startsWith('[') || t.startsWith('{')) {
        try { return load(JSON.parse(t), nameHint); } catch (e) { /* fall through: treat as text */ }
      }
      const r = parse(input);
      return { title: nameHint && !/^sermon$/i.test(r.title) ? r.title : (nameHint || r.title), lines: r.lines };
    }
    if (Array.isArray(input)) {
      const lines = input.filter(x => x && typeof x.t === 'string').map(x => ({
        t: x.t, s: x.s || 'Sermon', np: !!x.np, b: x.b ? 1 : 0, bs: x.bs ? 1 : 0, land: x.land ? 1 : 0,
        ...(x.a0 != null ? { a0: x.a0, a1: x.a1 } : {})
      }));
      return { title: nameHint || 'Sermon', lines };
    }
    if (input && Array.isArray(input.lines)) return { title: input.title || nameHint || 'Sermon', lines: load(input.lines).lines };
    throw new Error('Not a sermon I can read');
  }

  return { parse, load, norm, words, MAX_WORDS };
});

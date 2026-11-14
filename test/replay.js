#!/usr/bin/env node
/* replay.js — replays a word-by-word rehearsal transcript through the follower and reports how it did.
   usage: node test/replay.js [--words test/data/rehearsal-249-words.json] [--lines sermons/current.json]
                              [--out test/out/replay-249.txt] [--grid] [--rescue]
   Truth = where Bo actually was, from a global alignment of the transcript to the script. */
const fs = require('fs'), path = require('path');
const F = require('../follow.js');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const flag = k => args.includes('--' + k);
const root = path.join(__dirname, '..');
const wordsPath = opt('words', path.join(root, 'test/data/rehearsal-249-words.json'));
const linesPath = opt('lines', path.join(root, 'sermons/current.json'));
const outPath = opt('out', path.join(root, 'test/out/replay-249.txt'));

const lines = JSON.parse(fs.readFileSync(linesPath, 'utf8'));
const words = JSON.parse(fs.readFileSync(wordsPath, 'utf8')); // [[start, end, word], ...]

// ---------- truth: align transcript tokens to script tokens ----------
const scriptToks = [], scriptLine = [];
lines.forEach((l, k) => F.tokenize(l.t).forEach(t => { scriptToks.push(t); scriptLine.push(k); }));
const tr = []; // {tok, wi (word index), t (end time)}
words.forEach((w, wi) => F.tokens(w[2]).forEach(tok => tr.push({ tok, wi, t: w[1] })));

function alignTruth() {
  const n = tr.length, m = scriptToks.length;
  const GAP_T = -0.45, GAP_S = -0.55;     // ad-lib word / skipped script word
  // dp over transcript i, script j; free leading/trailing script gaps (start/end anywhere in the script)
  const dp = new Float32Array((n + 1) * (m + 1)), dir = new Uint8Array((n + 1) * (m + 1));
  const W = m + 1;
  for (let i = 1; i <= n; i++) dp[i * W] = i * GAP_T;
  for (let i = 1; i <= n; i++) {
    const a = tr[i - 1].tok;
    for (let j = 1; j <= m; j++) {
      const s = F.sim(a, scriptToks[j - 1]);
      let best = dp[(i - 1) * W + j] + GAP_T, d = 1;
      const v2 = dp[i * W + j - 1] + (i === n ? 0 : GAP_S); if (v2 > best) { best = v2; d = 2; }
      if (s >= 0.7) { const v3 = dp[(i - 1) * W + j - 1] + s; if (v3 > best) { best = v3; d = 3; } }
      dp[i * W + j] = best; dir[i * W + j] = d;
    }
  }
  // best end: any j for i = n
  let j = 0, bestV = -Infinity; for (let jj = 0; jj <= m; jj++) if (dp[n * W + jj] > bestV) { bestV = dp[n * W + jj]; j = jj; }
  const match = new Array(n).fill(-1); let i = n;
  while (i > 0 && j > 0) { const d = dir[i * W + j]; if (d === 3) { match[i - 1] = j - 1; i--; j--; } else if (d === 1) i--; else j--; }
  return match;
}
const match = alignTruth();
// truth per transcript word: line of the last matched token up to and including this word
const truthByWord = new Array(words.length).fill(-1);
let lastLine = -1;
tr.forEach((x, k) => { if (match[k] >= 0) lastLine = scriptLine[match[k]]; truthByWord[x.wi] = Math.max(truthByWord[x.wi], lastLine); });
for (let k = 0; k < words.length; k++) if (truthByWord[k] < 0) truthByWord[k] = k ? truthByWord[k - 1] : 0;
// smooth: a lone backward blip (repeat of an earlier line) keeps the furthest line reached so far
for (let k = 1; k < words.length; k++) if (truthByWord[k] < truthByWord[k - 1]) truthByWord[k] = truthByWord[k - 1];
const matchedWords = new Set(); tr.forEach((x, k) => { if (match[k] >= 0) matchedWords.add(x.wi); });

// ---------- replay ----------
function run(cfg, rescue) {
  const f = F.create(lines, cfg);
  const start = truthByWord[0]; f.setIndex(start);
  const rows = [], issues = { wrong: [], soon: [], stuck: [], lost: null, taps: 0 };
  const lastWordOf = {}; truthByWord.forEach((tr, k) => { lastWordOf[tr] = k; });
  let onLine = 0, near = 0, behindSince = null, early1 = 0, behind1 = 0, far = 0;
  const firstShown = {}, firstTruth = {};
  for (let k = 0; k < words.length; k++) {
    const [t0, t1, w] = words[k];
    const ev = f.push(w, t1);
    const truth = truthByWord[k], idx = f.index;
    if (!(truth in firstTruth)) firstTruth[truth] = t1;
    if (!(idx in firstShown)) firstShown[idx] = t1;
    if (idx === truth) onLine++; else if (idx === truth + 1) early1++; else if (idx === truth - 1) behind1++; else far++;
    if (Math.abs(idx - truth) <= 1) near++;
    if (ev && idx > truth + 1) issues.wrong.push({ t: t1, from: ev.from, to: ev.to, truth, type: ev.type });
    // moved off a line more than one word before he finished saying it
    if (ev && ev.type !== 'jump' && ev.from in lastWordOf && lastWordOf[ev.from] > k + 1 && ev.from >= truth) issues.soon.push({ t: t1, from: ev.from, wordsLeft: lastWordOf[ev.from] - k });
    if (idx < truth - 1) { if (behindSince == null) behindSince = t1; }
    else if (behindSince != null) { if (t1 - behindSince >= 3) issues.stuck.push({ from: behindSince, to: t1, dur: t1 - behindSince }); behindSince = null; }
    if (rescue && behindSince != null && t1 - behindSince >= 6) { f.setIndex(truth); issues.taps++; issues.stuck.push({ from: behindSince, to: t1, dur: t1 - behindSince, tap: true }); behindSince = null; }
    if (truth - idx > cfg.lookahead + 1 && !issues.lost && !rescue) issues.lost = { t: t1, truth, idx };
    rows.push({ t: t1, w, truth, idx, ev, m: matchedWords.has(k) });
  }
  if (behindSince != null) issues.stuck.push({ from: behindSince, to: words[words.length - 1][1], dur: words[words.length - 1][1] - behindSince });
  // lateness per truth line reached
  const late = [], early = [];
  Object.keys(firstTruth).forEach(j => { if (j in firstShown) { const d = firstShown[j] - firstTruth[j]; (d >= 0 ? late : early).push(d); } });
  late.sort((a, b) => a - b); early.sort((a, b) => a - b);
  const pct = p => late.length ? late[Math.min(late.length - 1, Math.floor(p * late.length))] : 0;
  const n = words.length;
  return { rows, issues, onLine: onLine / n, near: near / n, early1: early1 / n, behind1: behind1 / n, far: far / n, late: { n: late.length, median: pct(0.5), p90: pct(0.9), max: late[late.length - 1] || 0, early: early.length, earliest: early[0] || 0 }, events: f.events.length, start, cfg };
}

const fmtT = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') + '.' + Math.floor((s % 1) * 10);
function report(r) {
  const lineText = k => (lines[k] ? lines[k].t : '?');
  const out = [];
  out.push(`Replay of ${path.basename(wordsPath)} (${words.length} words, ${fmtT(words[words.length - 1][1])}) against ${path.basename(linesPath)} (${lines.length} lines)`);
  out.push(`Settings: ${JSON.stringify(r.cfg)}`);
  out.push(`Start line ${r.start + 1}: "${lineText(r.start)}"`);
  out.push(`Truth lines covered: ${truthByWord[0] + 1} .. ${truthByWord[words.length - 1] + 1}; transcript words matched to script: ${matchedWords.size}/${words.length}`);
  out.push('');
  out.push(`On the right line:      ${(r.onLine * 100).toFixed(1)}% of words   (one line ahead ${(r.early1 * 100).toFixed(1)}%, one behind ${(r.behind1 * 100).toFixed(1)}%, further off ${(r.far * 100).toFixed(1)}%)`);
  out.push(`Within one line:        ${(r.near * 100).toFixed(1)}% of words`);
  out.push(`Line shown late by:     median ${r.late.median.toFixed(2)}s, 90th pct ${r.late.p90.toFixed(2)}s, max ${r.late.max.toFixed(2)}s (${r.late.n} lines); shown early: ${r.late.early} lines (earliest ${r.late.earliest.toFixed(2)}s)`);
  out.push(`Moves made:             ${r.events}`);
  out.push(`Wrong jumps (ahead):    ${r.issues.wrong.length}`);
  r.issues.wrong.forEach(x => out.push(`   ${fmtT(x.t)} ${x.type} ${x.from + 1} -> ${x.to + 1} while he was on ${x.truth + 1}: "${lineText(x.to)}"`));
  out.push(`Moved on too soon (2+ words before he finished the line): ${r.issues.soon.length}`);
  r.issues.soon.forEach(x => out.push(`   ${fmtT(x.t)} left line ${x.from + 1} with ${x.wordsLeft} words to go: "${lineText(x.from)}"`));
  out.push(`Stuck (2+ lines behind for 3s+): ${r.issues.stuck.length}${r.issues.taps ? ' (' + r.issues.taps + ' rescue taps)' : ''}`);
  r.issues.stuck.forEach(x => out.push(`   ${fmtT(x.from)} - ${fmtT(x.to)} (${x.dur.toFixed(1)}s)${x.tap ? ' tapped' : ''}`));
  if (r.issues.lost) out.push(`LOST at ${fmtT(r.issues.lost.t)}: he was on line ${r.issues.lost.truth + 1}, screen showed ${r.issues.lost.idx + 1}`);
  out.push('');
  out.push('Timeline (time, heard word, truth line, screen line; * = word not in script, > = moved):');
  let prevTruth = -1, prevIdx = -1;
  r.rows.forEach(row => {
    const mark = (row.ev ? '>' : ' ') + (row.m ? ' ' : '*') + (row.idx === row.truth ? ' ' : (row.idx > row.truth ? '+' : '-'));
    let s = `${fmtT(row.t).padStart(7)} ${mark} ${row.w.padEnd(14)} ${String(row.truth + 1).padStart(3)} ${String(row.idx + 1).padStart(3)}`;
    if (row.truth !== prevTruth) s += `   | now: ${lineText(row.truth)}`;
    if (row.idx !== prevIdx && row.idx !== row.truth) s += `   | screen: ${lineText(row.idx)}`;
    prevTruth = row.truth; prevIdx = row.idx;
    out.push(s);
  });
  return out.join('\n');
}

if (flag('grid')) {
  const grid = [];
  for (const endNeed of [2, 3]) for (const minCoverage of [0.4, 0.5, 0.6]) for (const recentTokens of [2, 3]) for (const skipCoverage of [0.5, 0.6, 0.7]) for (const lookahead of [4, 6])
    grid.push({ endNeed, minCoverage, recentTokens, skipCoverage, lookahead });
  const res = grid.map(cfg => { const r = run(Object.assign({}, F.DEFAULTS, cfg), false); return { cfg, on: r.onLine, near: r.near, wrong: r.issues.wrong.length, stuck: r.issues.stuck.length, lost: !!r.issues.lost, p90: r.late.p90 }; });
  res.sort((a, b) => (b.on - a.on) || (a.wrong - b.wrong));
  res.slice(0, 15).forEach(x => console.log((x.on * 100).toFixed(1) + '%', (x.near * 100).toFixed(1) + '%', 'wrong', x.wrong, 'stuck', x.stuck, x.lost ? 'LOST' : '', 'p90', x.p90.toFixed(2), JSON.stringify(x.cfg)));
} else {
  const r = run(Object.assign({}, F.DEFAULTS), flag('rescue'));
  const text = report(r);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, text);
  console.log(text.split('\n').slice(0, 15 + r.issues.wrong.length + r.issues.soon.length + r.issues.stuck.length).join('\n'));
  console.log('\nFull timeline: ' + outPath);
}

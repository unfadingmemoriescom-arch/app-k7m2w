#!/usr/bin/env python3
"""add_times.py — give each Preaching View line its start/end time (a0/a1) in the pause-inserted sermon audio.

usage: python3 add_times.py <chunks.json> <build folder with sents_vN.json, points_vN.json, plan_vN.json> <vN> <out.json> [audio duration seconds]

The build folder is the one build_vN_book.py ran in (e.g. v2build). Times come from the same numbers the DAISY book uses:
sentence ends use the book's clip boundaries (B); breath pauses inside a sentence use the silence run after the word
plus every pause inserted before it. Lines whose end is not a pause point get a share by word count."""
import json, sys, bisect

chunks, build, v, out = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
dur = float(sys.argv[5]) if len(sys.argv) > 5 else None
C = json.load(open(chunks))
S = json.load(open(f'{build}/sents_{v}.json'))
P = json.load(open(f'{build}/points_{v}.json'))
plan = sorted(json.load(open(f'{build}/plan_{v}.json')))          # [ins_time, add_seconds, word_index]
ins_t = [p[0] for p in plan]; cum = []
run = 0.0
for p in plan: run += p[1]; cum.append(run)
def shift(t):                                                     # seconds inserted before original time t
    k = bisect.bisect_left(ins_t, t)                              # points with ins < t
    return cum[k - 1] if k else 0.0
LEAD = 0.05                                                       # the book starts each clip 0.05 s before the word

# word index range of every line (lines were cut from the same word list as the book)
pos = 0; ends = []
for c in C:
    n = len(c['t'].split()); ends.append(pos + n - 1); pos += n
assert pos == S[-1]['w1'] + 1, f'word count differs: lines {pos} vs script {S[-1]["w1"] + 1}'

B_by_w1 = {s['w1']: s['B'] for s in S}
pt_by_wi = {p['wi']: p for p in P}
if dur: B_by_w1[S[-1]['w1']] = dur

bound = [None] * len(C)
for k, e in enumerate(ends):
    if e in B_by_w1: bound[k] = B_by_w1[e]
    elif e in pt_by_wi and pt_by_wi[e].get('run'):            # a point with no silence run got no pause: share by words below
        p = pt_by_wi[e]; bound[k] = p['run'][1] + shift(p['run'][1] + 1e-6) - LEAD
# lines without a point at their end: share the gap by word count
k = 0
while k < len(C):
    if bound[k] is None:
        j = k
        while bound[j] is None: j += 1
        prev = bound[k - 1] if k else (S[0]['A'] if S[0]['A'] > 0 else 0.06)
        words = [len(C[q]['t'].split()) for q in range(k, j + 1)]; tot = sum(words); acc = 0
        for q in range(k, j):
            acc += words[q - k]; bound[q] = prev + (bound[j] - prev) * acc / tot
        k = j
    k += 1

a0 = S[0]['A'] if S[0]['A'] > 0 else 0.06
bad = 0
for k, c in enumerate(C):
    c['a0'] = round(a0, 3); c['a1'] = round(bound[k], 3)
    if c['a1'] <= c['a0']: bad += 1
    a0 = bound[k]
json.dump(C, open(out, 'w'), ensure_ascii=False)
spans = [c['a1'] - c['a0'] for c in C]
rate = [len(c['t'].split()) / (c['a1'] - c['a0']) for c in C if c['a1'] > c['a0']]
print(f'{len(C)} lines timed -> {out}; last end {C[-1]["a1"]:.1f}s; non-increasing spans: {bad}')
print(f'line length: median {sorted(spans)[len(spans)//2]:.2f}s, min {min(spans):.2f}s, max {max(spans):.2f}s; words/sec median {sorted(rate)[len(rate)//2]:.2f}')
odd = [(k, round(spans[k], 2), C[k]['t']) for k in range(len(C)) if spans[k] < 0.5 or (len(C[k]['t'].split()) / max(spans[k], 0.01) > 4.5)]
print('lines to double-check (very short span or very fast):', odd[:8])
for k in (0, 1, 2, 3, 21, 22, 23, len(C) - 1): print(f'{k+1:4d} {C[k]["a0"]:8.2f}-{C[k]["a1"]:8.2f}  {C[k]["t"]}')

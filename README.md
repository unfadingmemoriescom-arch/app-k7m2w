# Preaching View (voice-following)

One sermon line at a time on an iPhone or iPad, with the next line small and dim underneath.
Tap right = next, tap left = back; Bluetooth page-turner / keyboard keys work. Voice following
(the screen moves when you finish a line) is being built in steps.

## Files
- `index.html`, `app.js` — the app. Open it over https (GitHub Pages) so the microphone works.
- `split.js` — turns a pasted manuscript into screen lines (one sentence per line; long sentences split at commas).
  Headings in CAPITALS become sections. Also used by the test harness in Node.
- `follow.js` — the voice follower (heard words in, line index out). Same code runs on the phone and in the replay test.
- `tools/add_times.py` — gives each line its start/end time in the pause-inserted sermon audio (from the vN build folder's sents/points/plan files), so Practice mode can drive the lines. Output goes in the sermon JSON as `a0`/`a1`.
- `test/replay.js` — replays a rehearsal transcript through the follower and reports how it did (`node test/replay.js`, `--grid` to sweep settings).
- `manifest.webmanifest`, `icon.png` — "Add to Home Screen" support.
- `sermons/` (not published) — this week's `chunks.json`; `sermons/current.json` is offered by the Sermon tab when the page is served from this Mac.
- `test/data/` (not published) — rehearsal word timings and the manuscript used to tune the follower.

## Weekly routine
1. Make `chunks.json` for the sermon (one sentence per line) and the pause-inserted audio build as usual.
2. `python3 tools/add_times.py <chunks.json> <build folder> v3 sermons/current.json <audio seconds>` → sermon JSON with practice times.
3. AirDrop that JSON and the MP3 to the phone. In the page: Menu → Sermon → Choose a file (the JSON), then Choose the sermon MP3.

## Preview on this Mac
```bash
python3 -m http.server 8765 --directory ~/sermon-read-along-tools/voice-follow
```
Then open http://localhost:8765/ (microphone works on localhost in desktop browsers).

## Steps
1. One-line view + sermon library + mic check (done 2026-11-14)
2. Replay test over a rehearsal transcript, tune the follower on the Mac (done 2026-11-14: `node test/replay.js`)
3. Live voice following on the phone, tap always overrides (done 2026-11-14; `follow.js`)
4. Practice mode: plays the sermon audio and moves the lines with it (done 2026-11-14; MP3 is chosen once on the phone and kept there)
5. Church hardening

## License
Copyright (c) 2026 Bolivar Hiciano. All rights reserved. Not licensed for reuse.

/* app.js — Preaching View, step 1: one line at a time, tap / keyboard, sermon library, mic check.
   Voice following (auto-advance) is added in a later step; the Listener below already produces
   the word stream it will need. */
(function () {
  'use strict';
  const VERSION = 'Preaching View 0.4.5 (waiting-for-mic message, 2026-11-15)';
  const $ = id => document.getElementById(id);
  const now = () => performance.now();

  // ---------- tiny storage helpers (everything stays on this phone) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('Could not save (storage blocked)'); } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  // ---------- sermon library ----------
  const SAMPLE = {
    id: 'sample', title: 'Welcome', lines: [
      { t: 'This is Preaching View.', s: 'Welcome', np: true },
      { t: 'One line at a time.', s: 'Welcome' },
      { t: 'The next line waits underneath, small and dim.', s: 'Welcome' },
      { t: 'Tap the right side of the screen to move on.', s: 'How it works', np: true },
      { t: 'Tap the left side to go back.', s: 'How it works' },
      { t: 'A page-turner or keyboard works too.', s: 'How it works' },
      { t: 'You are not an interruption.', s: 'How it works', np: true, b: 1, bs: 1 },
      { t: 'You are not too messy.', s: 'How it works', b: 1 },
      { t: 'You are not too complicated.', s: 'How it works', b: 1, land: 1 },
      { t: 'Gold lines are a build; the last one says "Land it".', s: 'How it works', np: true },
      { t: 'Open Menu, then Sermon, to load this week\'s sermon.', s: 'Load a sermon', np: true },
      { t: 'Paste the manuscript, or choose the .txt or .json file.', s: 'Load a sermon' },
      { t: 'Open Menu, then Mic check, to see whether this phone hears you.', s: 'Load a sermon', np: true },
    ].map(l => ({ b: 0, bs: 0, land: 0, np: false, ...l }))
  };
  let lib = store.get('pv.sermons', []);
  let sermon = null, L = [], i = 0;
  let fol = null;                 // the voice follower for the current sermon
  const followLog = [];           // last voice moves, for the Mic check screen
  let scale = parseFloat(store.get('pv.scale', 1)) || 1;

  function useSermon(s, startAt) {
    sermon = s; L = s.lines;
    const saved = store.get('pv.pos.' + s.id, 0);
    i = Math.min(L.length - 1, Math.max(0, startAt != null ? startAt : (parseInt(saved, 10) || 0)));
    if (s.id !== 'sample') store.set('pv.active', s.id);
    fol = Follower.create(L); fol.setIndex(i); resetFeed();
    if (practicing) stopPractice();
    loadAudioFor(s);
    buildSections();
    render();
  }
  function addSermon(input, nameHint) {
    const r = SermonSplit.load(input, nameHint);
    if (!r.lines.length) throw new Error('No lines found');
    const id = 's' + Date.now().toString(36);
    const s = { id, title: r.title, lines: r.lines, added: new Date().toISOString().slice(0, 10) };
    lib.push(s); store.set('pv.sermons', lib);
    useSermon(s, 0);
    toast('Added "' + s.title + '" (' + s.lines.length + ' lines)');
    renderLibrary();
  }
  function removeSermon(id) {
    lib = lib.filter(s => s.id !== id); store.set('pv.sermons', lib); store.del('pv.pos.' + id);
    if (sermon && sermon.id === id) useSermon(lib[lib.length - 1] || SAMPLE);
    renderLibrary();
  }

  // ---------- rendering ----------
  function render() {
    const c = L[i], n = L[i + 1];
    $('now').textContent = c.t; $('now').classList.toggle('build', !!c.b);
    $('next').textContent = n ? n.t : 'Amen. End of sermon.'; $('next').classList.toggle('build', !!(n && n.b));
    $('para').classList.toggle('on', !!c.np);
    $('sec').textContent = c.s; $('sec').classList.toggle('changed', i > 0 && L[i - 1].s !== c.s);
    $('tag').textContent = c.land ? 'Land it' : (c.bs ? '▲ Build' : (c.b ? 'Build' : ''));
    $('pos').textContent = (i + 1) + ' / ' + L.length;
    $('fill').style.width = ((i + 1) / L.length * 100) + '%';
    document.documentElement.style.setProperty('--size', 'clamp(' + Math.round(30 * scale) + 'px,' + (7.2 * scale).toFixed(2) + 'vw,' + Math.round(84 * scale) + 'px)');
    document.documentElement.style.setProperty('--nextmin', Math.round(22 * scale) + 'px');
    if (sermon && sermon.id !== 'sample') store.set('pv.pos.' + sermon.id, i);
    store.set('pv.scale', scale);
    $('currentInfo').textContent = sermon.title + ' · ' + L.length + ' lines · line ' + (i + 1) + ' (' + c.s + ')';
  }
  function go(d) { i = Math.min(L.length - 1, Math.max(0, i + d)); if (fol) fol.setIndex(i); if (practicing) seekToLine(); render(); wake(); }
  function jumpTo(k) { i = Math.min(L.length - 1, Math.max(0, k)); if (fol) fol.setIndex(i); if (practicing) seekToLine(); render(); }

  // ---------- keep the screen awake ----------
  let lock = null;
  async function wake() {
    try {
      if (!lock && navigator.wakeLock) {
        lock = await navigator.wakeLock.request('screen');
        lock.addEventListener('release', () => { lock = null; });
      }
    } catch (e) { /* not granted: nothing to do */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { lock = null; wake(); } });

  // ---------- taps and keys ----------
  $('field').addEventListener('click', e => {
    const r = $('stage').getBoundingClientRect();
    go(e.clientX < r.left + r.width * 0.35 ? -1 : 1);
  });
  $('back').addEventListener('click', () => go(-1));
  $('bigger').addEventListener('click', () => { scale = Math.min(1.8, +(scale + 0.1).toFixed(2)); render(); });
  $('smaller').addEventListener('click', () => { scale = Math.max(0.6, +(scale - 0.1).toFixed(2)); render(); });
  document.addEventListener('keydown', e => {
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (!$('menu').hidden) { if (e.key === 'Escape') closeMenu(); return; }
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); go(1); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); go(-1); }
  });

  // ---------- menu ----------
  function openMenu(tab) { $('menu').hidden = false; showTab(tab || 'sections'); }
  function closeMenu() { $('menu').hidden = true; if (fol) fol.setIndex(i); wake(); }
  function showTab(name) {
    document.querySelectorAll('.tabs [role=tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    ['sections', 'sermon', 'mic', 'help'].forEach(t => { $('pane-' + t).hidden = t !== name; });
    if (name === 'sections') buildSections();
    if (name === 'sermon') renderLibrary();
    if (name === 'mic') renderDiag();
  }
  document.querySelectorAll('.tabs [role=tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('menuBtn').addEventListener('click', () => openMenu('sections'));
  $('close').addEventListener('click', closeMenu);

  function buildSections() {
    const firsts = [];
    L.forEach((c, k) => { if (k === 0 || L[k - 1].s !== c.s) firsts.push([c.s, k]); });
    const ol = $('secs'); ol.innerHTML = '';
    firsts.forEach(([name, k], idx) => {
      const end = idx + 1 < firsts.length ? firsts[idx + 1][1] : L.length;
      const li = document.createElement('li'); const b = document.createElement('button'); b.className = 'row';
      if (i >= k && i < end) b.classList.add('current');
      b.innerHTML = '<span></span><small>' + (end - k) + ' lines</small>'; b.firstChild.textContent = name;
      b.addEventListener('click', () => { jumpTo(k); closeMenu(); });
      li.appendChild(b); ol.appendChild(li);
    });
  }
  function renderLibrary() {
    const ol = $('sermonList'); ol.innerHTML = '';
    if (!lib.length) { ol.innerHTML = '<li><p style="color:var(--dim)">Nothing saved yet.</p></li>'; }
    lib.forEach(s => {
      const li = document.createElement('li');
      const b = document.createElement('button'); b.className = 'row'; if (sermon && sermon.id === s.id) b.classList.add('current');
      b.innerHTML = '<span></span><small>' + s.lines.length + ' lines · ' + s.added + '</small>'; b.firstChild.textContent = s.title;
      b.addEventListener('click', () => { useSermon(s); closeMenu(); });
      const d = document.createElement('button'); d.className = 'quiet danger'; d.textContent = 'Remove'; d.setAttribute('aria-label', 'Remove ' + s.title);
      d.addEventListener('click', () => { if (d.dataset.armed) { removeSermon(s.id); } else { d.dataset.armed = '1'; d.textContent = 'Sure?'; setTimeout(() => { d.dataset.armed = ''; d.textContent = 'Remove'; }, 3000); } });
      li.appendChild(b); li.appendChild(d); ol.appendChild(li);
    });
    $('currentInfo').textContent = sermon.title + ' · ' + L.length + ' lines · line ' + (i + 1);
  }
  $('restart').addEventListener('click', () => { jumpTo(0); closeMenu(); });
  $('addPaste').addEventListener('click', () => {
    const txt = $('paste').value; if (!txt.trim()) { toast('Paste the sermon text first'); return; }
    try { addSermon(txt, $('newName').value.trim() || undefined); $('paste').value = ''; $('newName').value = ''; closeMenu(); }
    catch (e) { toast('Could not read that: ' + e.message); }
  });
  $('file').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try { addSermon(String(rd.result), $('newName').value.trim() || f.name.replace(/\.(txt|json)$/i, '').replace(/[-_]+/g, ' ')); closeMenu(); }
      catch (err) { toast('Could not read that file: ' + err.message); }
      e.target.value = '';
    };
    rd.readAsText(f);
  });
  // A sermon file next to the page (sermons/current.json) is offered when it exists; on the public site it does not.
  fetch('sermons/current.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => {
    if (!j) return; const b = $('serverLoad'); b.hidden = false;
    b.addEventListener('click', () => { try { addSermon(j, 'Jesus Sees You'); closeMenu(); } catch (e) { toast(e.message); } });
  }).catch(() => {});
  $('resetPlace').addEventListener('click', () => { jumpTo(0); toast('Back to line 1'); });
  $('followOn').checked = store.get('pv.follow', true);
  $('followOn').addEventListener('change', () => { store.set('pv.follow', $('followOn').checked); resetFeed(); renderMic(); });
  $('showHeard').checked = store.get('pv.showHeard', true);
  $('heard').hidden = !$('showHeard').checked;
  $('showHeard').addEventListener('change', () => { store.set('pv.showHeard', $('showHeard').checked); $('heard').hidden = !$('showHeard').checked; });
  $('version').textContent = VERSION;

  // ---------- toast ----------
  let toastT = 0;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }

  // ---------- Listener: wraps the browser's speech recognition and keeps a word stream ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const listener = {
    want: false, rec: null, state: SR ? 'off' : 'unsupported',
    words: [],            // [{w, t, final}] every word heard this page-load, t = ms since page load
    sessionBase: 0,       // index in words[] where the current recognizer session started
    stats: { sessions: 0, restarts: 0, results: 0, finals: 0, errors: [], lostMs: 0, maxQuiet: 0, listenStart: 0, lastResult: 0, endAt: 0 },
    onChange: () => {},
    start() {
      if (!SR) { this.state = 'unsupported'; this.onChange(); toast('This browser has no speech recognition'); return; }
      if (this.want) return;
      this.want = true; this.stats.listenStart = now(); this._spawn();
    },
    stop() { this.want = false; try { this.rec && this.rec.stop(); } catch (e) {} this.state = 'off'; this.onChange(); },
    _spawn() {
      const r = new SR(); r.continuous = true; r.interimResults = true; r.lang = 'en-US'; r.maxAlternatives = 1;
      this.rec = r; this.sessionBase = this.words.length; this.state = 'starting';
      r.onstart = () => {
        this.stats.sessions++; this.state = 'listening';
        if (this.stats.endAt) { this.stats.lostMs += now() - this.stats.endAt; this.stats.endAt = 0; }
        this.stats.lastResult = now(); this.onChange();
      };
      r.onresult = e => {
        let txt = '', finals = 0, finalWords = 0;
        for (let k = 0; k < e.results.length; k++) {
          const tr = e.results[k][0].transcript;
          txt += tr + ' ';
          if (e.results[k].isFinal) { finals++; finalWords += tr.trim().split(/\s+/).filter(Boolean).length; }
        }
        this._reconcile(txt, finalWords);
        const t = now(), q = t - this.stats.lastResult;
        if (q > this.stats.maxQuiet) this.stats.maxQuiet = q;
        this.stats.lastResult = t; this.stats.results++; this.stats.finals = Math.max(this.stats.finals, finals);
        this.onChange();
      };
      r.onerror = e => {
        this.stats.errors.push([new Date().toLocaleTimeString(), e.error]);
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { this.want = false; this.state = 'blocked'; }
        this.onChange();
      };
      r.onend = () => {
        this.stats.endAt = now();
        if (this.want) { this.stats.restarts++; this.state = 'restarting'; this.onChange(); setTimeout(() => { if (this.want) this._spawn(); }, 120); }
        else { if (this.state !== 'blocked') this.state = 'off'; this.onChange(); }
      };
      try { r.start(); } catch (e) { this.stats.errors.push([new Date().toLocaleTimeString(), 'start: ' + e.message]); this.onChange(); }
      // The phone can take a while to hand over the microphone (seen from the home-screen icon): say so instead of a silent "Starting".
      setTimeout(() => {
        if (this.rec !== r || this.state !== 'starting') return;
        this.state = 'stalled'; this.stats.errors.push([new Date().toLocaleTimeString(), 'microphone slow to answer (10s)']); this.onChange();
        toast('Still waiting for the microphone. Give it a moment; if nothing changes, tap Listen off and on.');
      }, 10000);
    },
    // Replace this session's words with the recognizer's latest full text, keeping first-seen times.
    _reconcile(txt, finalWords) {
      const ws = txt.trim() ? txt.trim().split(/\s+/) : [];
      const old = this.words.slice(this.sessionBase);
      let c = 0; while (c < old.length && c < ws.length && old[c].w === ws[c]) c++;
      this.words.length = this.sessionBase + c;
      const t = now();
      for (let k = c; k < ws.length; k++) this.words.push({ w: ws[k], t, final: false });
      for (let k = 0; k < ws.length; k++) this.words[this.sessionBase + k].final = k < finalWords;
    },
    clear() { this.words.length = 0; this.sessionBase = 0; }
  };
  // ---------- feeding heard words to the follower ----------
  // Words [fedBase, fedBase + fedN) of listener.words have been fed. Live recognition revises its last
  // few words, so each time we compare what we fed with what is there now and roll back the difference.
  let fedBase = 0, fedN = 0, fedW = [], tokEnd = [];
  function resetFeed() { fedBase = listener.words.length; fedN = 0; fedW = []; tokEnd = []; }
  const followOn = () => $('followOn').checked;
  function feedFollower() {
    if (!fol) return;
    const W = listener.words;
    if (!followOn() || W.length < fedBase) { resetFeed(); return; }
    const have = W.length - fedBase;
    let m = Math.max(0, fedN - 60);
    while (m < fedN && m < have && fedW[m] === W[fedBase + m].w) m++;
    if (m < fedN) { fol.truncate(m > 0 ? tokEnd[m - 1] : 0); fedN = m; fedW.length = m; tokEnd.length = m; }
    for (let k = fedN; k < have; k++) {
      const x = W[fedBase + k];
      const ev = fol.push(x.w, x.t / 1000);
      fedW[k] = x.w; tokEnd[k] = fol.heardLength; fedN = k + 1;
      if (ev) onVoiceMove(ev, x.w);
    }
  }
  function onVoiceMove(ev, word) {
    const to = fol.index;
    followLog.push({ at: new Date().toLocaleTimeString(), type: ev.type, from: ev.from, to, word });
    if (followLog.length > 40) followLog.shift();
    if (practicing) return;                       // the audio drives the lines while practicing
    if (to !== i) { i = to; render(); flashMoved(); }
  }
  let flashT = 0;
  function flashMoved() { $('mic').classList.add('moved'); clearTimeout(flashT); flashT = setTimeout(() => $('mic').classList.remove('moved'), 350); }
  listener.onChange = () => { feedFollower(); renderMic(); renderDiag(); };

  function micState() {
    if (listener.state === 'listening' && now() - listener.stats.lastResult > 8000) return 'quiet';
    return listener.state;
  }
  const MIC_LABEL = { off: 'Mic off', starting: 'Starting…', listening: 'Listening', quiet: 'Listening (quiet)', restarting: 'Restarting…', blocked: 'Mic blocked', stalled: 'Waiting for mic…', unsupported: 'No mic in this browser' };
  function renderMic() {
    const st = micState();
    $('mic').className = 'mic ' + st; $('micLabel').textContent = MIC_LABEL[st] || st;
    const on = listener.want;
    $('listen').classList.toggle('on', on); $('listen').setAttribute('aria-pressed', String(on)); $('listen').textContent = on ? (followOn() ? 'Following' : 'Listening') : 'Listen';
    $('micToggle').textContent = on ? 'Stop' : 'Start';
    const last = listener.words.slice(-10).map(x => x.w).join(' ');
    $('heardText').textContent = last;
    const tr = $('transcript');
    if (!$('pane-mic').hidden) {
      tr.innerHTML = '';
      listener.words.slice(-400).forEach(x => { const s = document.createElement('span'); s.className = x.final ? 'final' : 'interim'; s.textContent = x.w + ' '; tr.appendChild(s); });
      tr.scrollTop = tr.scrollHeight;
    }
  }
  function fmtMove(m) { return m.at + ' ' + m.type + ' ' + (m.from + 1) + ' \u2192 ' + (m.to + 1) + ' on "' + m.word + '": ' + (L[m.to] ? L[m.to].t : ''); }
  function fmt(ms) { return ms >= 60000 ? Math.floor(ms / 60000) + 'm ' + Math.round(ms % 60000 / 1000) + 's' : (ms / 1000).toFixed(1) + 's'; }
  function renderDiag() {
    if ($('pane-mic').hidden) return;
    const s = listener.stats, standalone = !!navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    const lines = [
      VERSION,
      'Device: ' + navigator.userAgent,
      'Opened from home-screen icon: ' + (standalone ? 'yes' : 'no'),
      'Secure page (https): ' + (window.isSecureContext ? 'yes' : 'NO - mic will not work'),
      'Internet: ' + (navigator.onLine ? 'online' : 'OFFLINE'),
      'Speech recognition in this browser: ' + (SR ? 'yes' : 'NO'),
      'Keep-awake supported: ' + (navigator.wakeLock ? 'yes' : 'no'),
      'State: ' + micState(),
      'Listening for: ' + (s.listenStart ? fmt(now() - s.listenStart) : '-'),
      'Sessions: ' + s.sessions + '   Restarts: ' + s.restarts + '   Time lost restarting: ' + fmt(s.lostMs),
      'Result updates: ' + s.results + '   Words heard: ' + listener.words.length,
      'Longest quiet stretch while on: ' + fmt(s.maxQuiet),
      'Errors: ' + (s.errors.length ? s.errors.slice(-8).map(e => e[0] + ' ' + e[1]).join(', ') : 'none'),
      'Following: ' + (followOn() ? 'on' : 'off') + '   Screen on line ' + (i + 1) + ' of ' + L.length + ': ' + (L[i] ? L[i].t : ''),
      'Voice moves: ' + followLog.length + (followLog.length ? '   last: ' + fmtMove(followLog[followLog.length - 1]) : ''),
      'Last words: ' + listener.words.slice(-25).map(x => x.w).join(' ')
    ];
    $('diag').textContent = lines.join('\n');
    $('followLog').textContent = followLog.length ? followLog.slice(-12).reverse().map(fmtMove).join('\n') : 'No voice moves yet.';
  }
  $('listen').addEventListener('click', () => { if (listener.want) listener.stop(); else { listener.start(); wake(); } });
  $('micToggle').addEventListener('click', () => { if (listener.want) listener.stop(); else { listener.start(); wake(); } });
  $('clearHeard').addEventListener('click', () => { listener.clear(); renderMic(); renderDiag(); });
  $('copyDiag').addEventListener('click', async () => {
    renderDiag();
    const text = $('diag').textContent + '\n\nVoice moves:\n' + followLog.map(fmtMove).join('\n') + '\n\nAll words heard:\n' + listener.words.map(x => x.w).join(' ');
    try { await navigator.clipboard.writeText(text); toast('Report copied. Paste it to Claude.'); }
    catch (e) { const r = document.createRange(); r.selectNodeContents($('diag')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast('Select the report and copy it'); }
  });
  setInterval(() => { if (listener.want) { renderMic(); renderDiag(); } }, 1000);
  window.addEventListener('online', renderDiag); window.addEventListener('offline', renderDiag);
  // Debug hook: PV.hear('some words') behaves as if the microphone heard them.
  function hear(text) { const t = now(); String(text).split(/\s+/).filter(Boolean).forEach(w => listener.words.push({ w, t, final: true })); listener.onChange(); }

  // ---------- practice mode: the sermon audio drives the lines ----------
  const audio = new Audio(); audio.preload = 'auto';
  let practicing = false, audioUrl = null, audioReady = false, pollT = 0, audioKey = '';
  const idb = {
    open() { return new Promise((res, rej) => { const r = indexedDB.open('pv', 1); r.onupgradeneeded = () => r.result.createObjectStore('audio'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
    async get(k) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('audio').objectStore('audio').get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); }); },
    async set(k, v) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('audio', 'readwrite'); t.objectStore('audio').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
    async del(k) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('audio', 'readwrite'); t.objectStore('audio').delete(k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
  };
  const hasTimes = () => L.some(l => l.a1 != null);
  const keyFor = s => 'audio:' + String(s.title || s.id).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const clock = t => { t = Math.max(0, Math.floor(t || 0)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
  async function loadAudioFor(s) {
    audioKey = keyFor(s); audioReady = false;
    if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
    audio.removeAttribute('src'); audio.load();
    try { const b = await idb.get(audioKey); if (b && audioKey === keyFor(s)) { audioUrl = URL.createObjectURL(b); audio.src = audioUrl; audioReady = true; } } catch (e) {}
    renderPractice();
  }
  function renderPractice() {
    $('practice').hidden = !hasTimes();
    $('forgetAudio').hidden = !audioReady;
    $('audioInfo').textContent = !hasTimes() ? 'This sermon file has no audio times, so Practice is off for it.'
      : audioReady ? 'Audio is saved on this phone' + (audio.duration ? ' (' + clock(audio.duration) + ')' : '') + '. Tap Practice on the main screen.'
      : 'This sermon has audio times. Choose its MP3 once; it stays on this phone.';
  }
  audio.addEventListener('loadedmetadata', renderPractice);
  $('audioFile').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try { await idb.set(audioKey, f); toast('Audio saved (' + Math.round(f.size / 1048576) + ' MB)'); await loadAudioFor(sermon); }
    catch (err) { toast('Could not save the audio: ' + err.message); }
    e.target.value = '';
  });
  $('forgetAudio').addEventListener('click', async () => { try { await idb.del(audioKey); } catch (e) {} await loadAudioFor(sermon); });
  function lineAt(t) {
    // the line whose audio span holds time t; lines without times inherit their neighbours
    let lo = 0, hi = L.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if ((L[mid].a0 != null ? L[mid].a0 : -1) <= t) lo = mid; else hi = mid - 1; }
    return lo;
  }
  function seekToLine() { const l = L[i]; if (l && l.a0 != null) { try { audio.currentTime = l.a0 + 0.01; } catch (e) {} } }
  function startPractice() {
    if (!hasTimes()) { toast('This sermon file has no audio times'); return; }
    if (!audioReady) { openMenu('sermon'); toast('Choose the sermon MP3 first'); return; }
    if (listener.want) { listener.stop(); toast('Mic off while practicing'); }
    practicing = true; $('pbar').hidden = false; $('heard').hidden = true; $('practice').classList.add('on');
    seekToLine();
    audio.play().catch(e => toast('Could not play: ' + e.message));
    clearInterval(pollT); pollT = setInterval(tickPractice, 120);
    wake();
  }
  function stopPractice() {
    practicing = false; clearInterval(pollT); audio.pause();
    $('pbar').hidden = true; $('heard').hidden = !$('showHeard').checked; $('practice').classList.remove('on');
    if (fol) fol.setIndex(i);
  }
  function tickPractice() {
    const t = audio.currentTime;
    const k = lineAt(t);
    if (k !== i) { i = k; render(); }
    $('ptime').textContent = clock(t) + ' / ' + clock(audio.duration);
    $('pfill').style.width = (audio.duration ? t / audio.duration * 100 : 0) + '%';
    $('pplay').innerHTML = audio.paused ? '&#9654;' : '&#10074;&#10074;';
  }
  audio.addEventListener('ended', () => { if (practicing) { stopPractice(); toast('End of the audio'); } });
  $('practice').addEventListener('click', () => { if (practicing) stopPractice(); else startPractice(); });
  $('pplay').addEventListener('click', () => { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); });
  $('pstop').addEventListener('click', stopPractice);

  window.PV = { listener, hear, audio, get practicing() { return practicing; }, get lines() { return L; }, get index() { return i; }, go, SermonSplit, get follower() { return fol; } };

  // ---------- start ----------
  const activeId = store.get('pv.active', null);
  useSermon(lib.find(s => s.id === activeId) || lib[lib.length - 1] || SAMPLE);
  renderMic();
  wake();
})();

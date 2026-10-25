// app.js — UI wiring. Owns the settings object, builds the panels, and
// connects controls to the audio engine.
//
// Sources: what the play button plays. 'metronome', 'groove' or 'builder'.
// Visiting the Metronome / Grooves / Builder tab makes it the source (the
// switch happens on the next bar line if already playing). The Trainer tab
// doesn't change the source, so trainers apply to whatever is playing.

import * as store from './storage.js';
import { Engine } from './engine.js';
import { VELOCITY, trainerBpm } from './sequencer.js';
import { GROOVES, STYLES, grooveToPattern } from './grooves.js';
import {
  KIT_VOICES, METERS, SUBDIVISIONS, subdivisionInfo, resolveSubdivision, metronomeSequence,
  toSequence, blankPattern, clonePattern, normalizePattern, setBars, setResolution,
  PatternLibrary, exportPatterns, importPatterns, newId,
} from './patterns.js';

const $ = id => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ===================================================================== state

const DEFAULTS = {
  bpm: 100, swing: 0, swingRes: 8,
  meter: '4/4', subdivision: 'quarter', accent: true,
  clickVol: 0.8, subVol: 0.45,
  trainer: { enabled: false, start: 80, target: 120, step: 5, every: 4 },
  gap: { enabled: false, play: 3, mute: 1, hideVisual: true },
  mix: {
    ride: { vol: 0.8, mute: false }, oh: { vol: 0.8, mute: false }, hh: { vol: 0.8, mute: false },
    rim: { vol: 0.9, mute: false }, snare: { vol: 0.9, mute: false }, kick: { vol: 1, mute: false },
    grooveClick: { vol: 0.6, mute: true },
  },
  master: 0.9, wakeLock: true,
  tab: 'metronome', source: 'metronome', grooveId: GROOVES[0].id, styleFilter: 'All',
};

// Deep-merge saved values over defaults, keeping only known keys of the
// right type (so an old or corrupt save can't break the app).
function merge(def, val) {
  if (def && typeof def === 'object') {
    const out = {};
    for (const k of Object.keys(def)) out[k] = merge(def[k], val && typeof val === 'object' ? val[k] : undefined);
    return out;
  }
  return typeof val === typeof def && (typeof val !== 'number' || Number.isFinite(val)) ? val : def;
}

const S = merge(DEFAULTS, store.load('settings', {}));
if (!METERS[S.meter]) S.meter = '4/4';
S.subdivision = resolveSubdivision(S.meter, S.subdivision);
if (!GROOVES.some(g => g.id === S.grooveId)) S.grooveId = GROOVES[0].id;
S.bpm = clamp(Math.round(S.bpm), 30, 300);

let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSettings, 250);
}
function flushSettings() {
  clearTimeout(saveTimer);
  saveTimer = null;
  store.save('settings', S);
}

const library = new PatternLibrary();
let draft, dirty;
{
  const d = store.load('draft', null);
  try { draft = normalizePattern(d && d.pattern); dirty = !!d.dirty; }
  catch (e) { draft = blankPattern(); dirty = false; }
}
let draftTimer = null;
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(flushDraft, 250);
}
function flushDraft() {
  clearTimeout(draftTimer);
  draftTimer = null;
  store.save('draft', { pattern: draft, dirty });
}
// Saves are debounced; write them out immediately when the page is hidden
// or closed (switching apps, closing the installed app, reloading).
function flushAll() { flushSettings(); flushDraft(); }
window.addEventListener('pagehide', flushAll);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });

// ==================================================================== engine

function getLevel(voice) {
  if (voice === 'accent' || voice === 'click') return S.clickVol;
  if (voice === 'sub') return S.subVol;
  const m = S.mix[voice];
  return m && !m.mute ? m.vol : 0;
}

const engine = new Engine({
  config: S,
  getLevel,
  // Optional beat click under grooves/patterns (the "Click" mixer channel).
  extraClick: () => S.source !== 'metronome' && getLevel('grooveClick') > 0,
});
engine.setMasterVolume(S.master);

function currentGroove() { return GROOVES.find(g => g.id === S.grooveId) || GROOVES[0]; }

function currentSequence() {
  if (S.source === 'groove') return toSequence(grooveToPattern(currentGroove()));
  if (S.source === 'builder') return toSequence(draft);
  return metronomeSequence(S);
}

let activeSeq = null; // what the transport display describes
function refreshSequence(immediate = false) {
  activeSeq = currentSequence();
  engine.setSequence(activeSeq, immediate);
  renderNowPlaying();
  renderSwing();
  if (!engine.playing) renderBeatDots(activeSeq.beatsPerBar);
}

function setSource(src) {
  if (S.source === src) return;
  S.source = src;
  saveSettings();
  refreshSequence();
}

// ================================================================= transport

const trainerOn = () => S.trainer.enabled;
let liveBpm = null; // tempo reported by the engine while playing

function renderBpm() {
  let v = S.bpm;
  if (trainerOn()) v = engine.playing && liveBpm ? liveBpm : S.trainer.start;
  $('bpmValue').textContent = v;
  $('bpmSlider').value = v;
  $('transport').classList.toggle('locked', trainerOn() && engine.playing);
  $('bpmUnit').textContent = S.source === 'metronome' ? METERS[S.meter].unit : '♩';
}

// BPM controls edit the normal tempo, or the trainer's start tempo when the
// trainer is on (locked while it is running).
function changeBpm(v) {
  v = clamp(Math.round(v), 30, 300);
  if (trainerOn()) {
    if (engine.playing) return;
    S.trainer.start = v;
    renderSteppers();
  } else {
    S.bpm = v;
  }
  renderBpm();
  saveSettings();
}
const shownBpm = () => Number($('bpmValue').textContent);

// Repeats `fn` while a button is held, speeding up.
function holdRepeat(btn, fn) {
  let timer = null;
  const stop = () => { clearTimeout(timer); timer = null; };
  btn.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    fn();
    let delay = 420;
    const loop = () => { timer = setTimeout(() => { fn(); delay = Math.max(45, delay * 0.82); loop(); }, delay); };
    stop();
    loop();
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => btn.addEventListener(t, stop));
  btn.addEventListener('click', e => { if (e.detail === 0) fn(); }); // keyboard activation
}

holdRepeat($('bpmDown'), () => changeBpm(shownBpm() - 1));
holdRepeat($('bpmUp'), () => changeBpm(shownBpm() + 1));
$('bpmSlider').addEventListener('input', e => changeBpm(Number(e.target.value)));

// Tap tempo: average of the last few intervals; a long pause starts over.
let taps = [];
function tap() {
  if (trainerOn() && engine.playing) return;
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
  taps.push(now);
  if (taps.length > 5) taps.shift();
  const btn = $('tapBtn');
  btn.classList.add('tapped');
  setTimeout(() => btn.classList.remove('tapped'), 90);
  if (taps.length >= 2) {
    const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    changeBpm(60000 / avg);
  }
}
$('tapBtn').addEventListener('pointerdown', e => { e.preventDefault(); tap(); });
$('tapBtn').addEventListener('click', e => { if (e.detail === 0) tap(); });

// Swing
function swingLabel(v) {
  if (v === 0) return 'Straight';
  if (v === 100) return 'Triplet';
  return v + '%';
}
function renderSwing() {
  const v = Math.round(S.swing * 100);
  $('swing').value = v;
  $('swingVal').textContent = swingLabel(v);
  setSeg($('swingRes'), String(S.swingRes));
  const spb = activeSeq ? activeSeq.spb : 4;
  const applies = spb === 2 || spb === 4;
  $('swing').closest('.swing-row').classList.toggle('na', !applies);
  $('swing').closest('.swing-row').title = applies ? '' : 'Swing only affects 8th/16th grids (triplet grids are already swung)';
}
$('swing').addEventListener('input', e => { S.swing = Number(e.target.value) / 100; renderSwing(); saveSettings(); });
segHandler($('swingRes'), v => { S.swingRes = Number(v); renderSwing(); saveSettings(); });

// Play / stop
let wakeLock = null;
async function requestWake() {
  if (!S.wakeLock || !('wakeLock' in navigator)) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* not allowed */ }
}
function releaseWake() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && engine.playing) requestWake();
});

async function togglePlay() {
  if (engine.playing) {
    engine.stop();
    releaseWake();
    liveBpm = null;
    clearVisuals();
  } else {
    refreshSequence(true);
    liveBpm = trainerOn() ? trainerBpm(S.trainer, 0) : null;
    const started = engine.start();
    requestWake();
    requestAnimationFrame(drawLoop);
    await started;
  }
  renderPlay();
  renderBpm();
  renderStatus(null);
}
function renderPlay() {
  const b = $('playBtn');
  b.classList.toggle('playing', engine.playing);
  b.textContent = engine.playing ? '■ STOP' : '▶ PLAY';
  b.setAttribute('aria-label', engine.playing ? 'Stop' : 'Play');
}
$('playBtn').addEventListener('click', togglePlay);

function renderNowPlaying() {
  const el = $('nowPlaying');
  const sub = subdivisionInfo(S.meter)[S.subdivision];
  if (S.source === 'groove') {
    const g = currentGroove();
    el.innerHTML = `<b></b> · ${g.style}`;
    el.querySelector('b').textContent = g.name;
  } else if (S.source === 'builder') {
    el.innerHTML = 'Pattern · <b></b>';
    el.querySelector('b').textContent = draft.name;
  } else {
    el.innerHTML = `<b>Metronome</b> · ${S.meter} · ${sub ? sub.label : ''}`;
  }
  document.querySelectorAll('.tabs button').forEach(b => {
    const src = b.dataset.tab === 'grooves' ? 'groove' : b.dataset.tab;
    b.classList.toggle('source', src === S.source);
  });
  renderBpm();
}

// ================================================================== visuals

let dotEls = [];
function renderBeatDots(n) {
  const box = $('beatDots');
  if (dotEls.length === n) return;
  box.innerHTML = '';
  dotEls = [];
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div');
    d.className = 'beat-dot' + (i === 0 ? ' first' : '');
    d.textContent = i + 1;
    box.appendChild(d);
    dotEls.push(d);
  }
}

let flashTimer = null;
function showEvent(ev) {
  renderBeatDots(ev.beatsPerBar);
  const hide = ev.muted && S.gap.hideVisual;
  $('beatDots').classList.toggle('silent', ev.muted);
  if (ev.stepInBeat === 0) {
    dotEls.forEach((d, i) => d.classList.toggle('on', !hide && i === ev.beat));
    if (!hide) {
      const t = $('transport');
      t.classList.remove('flash', 'flash-1');
      t.classList.add(ev.beat === 0 ? 'flash-1' : 'flash');
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => t.classList.remove('flash', 'flash-1'), 90);
    }
    if (ev.beat === 0) renderStatus(ev);
  }
  if (trainerOn() && ev.bpm !== liveBpm) { liveBpm = ev.bpm; renderBpm(); }
  if (S.source === 'builder') setPlayhead(ev.index);
}

function drawLoop() {
  if (!engine.playing) return;
  const due = engine.takeDueVisuals();
  // Only the latest step matters for display, but every bar start must be
  // seen so the status line updates even if a frame was skipped.
  for (const ev of due) if (ev.beat === 0 && ev.stepInBeat === 0) renderStatus(ev);
  if (due.length) showEvent(due[due.length - 1]);
  requestAnimationFrame(drawLoop);
}

function clearVisuals() {
  dotEls.forEach(d => d.classList.remove('on'));
  $('beatDots').classList.remove('silent');
  $('transport').classList.remove('flash', 'flash-1');
  setPlayhead(-1);
  renderBeatDots(activeSeq ? activeSeq.beatsPerBar : 4);
}

// Trainer / gap status line under the BPM.
function renderStatus(ev) {
  const parts = [];
  const tr = S.trainer, gap = S.gap;
  if (tr.enabled) {
    if (ev) {
      const cur = trainerBpm(tr, ev.barCount);
      if (cur === clamp(tr.target, 30, 300)) parts.push(`Target ${cur} reached ✓`);
      else {
        const every = Math.max(1, tr.every);
        const left = every - (ev.barCount % every);
        const next = trainerBpm(tr, ev.barCount + left);
        parts.push(`→ ${next} in ${left} bar${left > 1 ? 's' : ''}`);
      }
    } else {
      parts.push(`Trainer ${tr.start} → ${tr.target}, ${tr.target >= tr.start ? '+' : '−'}${tr.step} every ${tr.every}`);
    }
  }
  if (gap.enabled) {
    if (ev) {
      const cycle = gap.play + gap.mute;
      const pos = ev.barCount % cycle;
      parts.push(pos < gap.play ? `PLAY ${pos + 1}/${gap.play}` : `<span class="silent">SILENT ${pos - gap.play + 1}/${gap.mute}</span>`);
    } else {
      parts.push(`Gap: play ${gap.play}, silent ${gap.mute}`);
    }
  }
  $('statusLine').innerHTML = parts.join(' · ');
}

// ===================================================================== tabs

function showTab(tab) {
  S.tab = tab;
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + tab));
  if (tab === 'metronome') setSource('metronome');
  else if (tab === 'grooves') setSource('groove');
  else if (tab === 'builder') { setSource('builder'); renderGrid(); }
  saveSettings();
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ============================================================ shared widgets

// Segmented buttons: aria-pressed marks the selected one.
function setSeg(seg, value) {
  seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === value)));
}
function segHandler(seg, fn) {
  seg.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b && !b.disabled && seg.contains(b)) fn(b.dataset.value);
  });
}
function setToggle(btn, on) {
  btn.setAttribute('aria-pressed', String(on));
  btn.textContent = on ? 'On' : 'Off';
}

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// Modal prompt/confirm using <dialog>, with a fallback for old browsers.
// Resolves to the entered text (prompt), true (confirm) or null (cancel).
function ask(message, { input = null } = {}) {
  const dlg = $('dialog');
  if (typeof dlg.showModal !== 'function') {
    if (input == null) return Promise.resolve(window.confirm(message) ? true : null);
    const r = window.prompt(message, input);
    return Promise.resolve(r == null ? null : r.trim());
  }
  return new Promise(resolve => {
    $('dialogMsg').textContent = message;
    const inp = $('dialogInput');
    inp.hidden = input == null;
    inp.value = input || '';
    dlg.returnValue = '';
    dlg.addEventListener('close', () => {
      if (dlg.returnValue !== 'ok') resolve(null);
      else resolve(input == null ? true : inp.value.trim());
    }, { once: true });
    dlg.showModal();
    if (input != null) { inp.focus(); inp.select(); }
  });
}
$('dialogInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); $('dialog').close('ok'); }
});

// =============================================================== metronome

function renderMetronome() {
  const meterSeg = $('meterSeg');
  if (!meterSeg.children.length) {
    meterSeg.innerHTML = Object.keys(METERS).map(k => `<button data-value="${k}">${k}</button>`).join('');
  }
  setSeg(meterSeg, S.meter);
  const m = METERS[S.meter];
  $('meterHint').textContent = m.compound
    ? `The beat is the dotted quarter (♩.) — ${S.meter} counts ${m.beats} big beats. Choose 8ths to hear every eighth.`
    : m.groups ? 'The beat is the eighth note (♪), grouped 2+2+3. Group starts click louder.' : '';
  const info = subdivisionInfo(S.meter);
  $('subSeg').innerHTML = SUBDIVISIONS.map(s => {
    const i = info[s];
    const label = i ? i.label : { quarter: 'Quarters', eighth: '8ths', triplet: 'Triplets', sixteenth: '16ths' }[s];
    return `<button data-value="${s}" ${i ? '' : 'disabled'}>${label}</button>`;
  }).join('');
  setSeg($('subSeg'), S.subdivision);
  setToggle($('accentToggle'), S.accent);
  $('clickVol').value = Math.round(S.clickVol * 100);
  $('subVol').value = Math.round(S.subVol * 100);
}
function metronomeChanged() {
  renderMetronome();
  saveSettings();
  if (S.source === 'metronome') refreshSequence();
}
segHandler($('meterSeg'), v => { S.meter = v; S.subdivision = resolveSubdivision(v, S.subdivision); metronomeChanged(); });
segHandler($('subSeg'), v => { S.subdivision = v; metronomeChanged(); });
$('accentToggle').addEventListener('click', () => { S.accent = !S.accent; metronomeChanged(); });
$('clickVol').addEventListener('input', e => { S.clickVol = e.target.value / 100; saveSettings(); });
$('subVol').addEventListener('input', e => { S.subVol = e.target.value / 100; saveSettings(); });

// ================================================================== grooves

function applyFeel(p) {
  if (!trainerOn()) S.bpm = p.bpm;
  S.swing = p.swing;
  if (p.stepsPerBar === 16) S.swingRes = p.swingRes;
  renderBpm();
  renderSwing();
  saveSettings();
}

function renderGrooves() {
  const filter = $('styleFilter');
  if (!filter.children.length) {
    filter.innerHTML = ['All', ...STYLES].map(s => `<button data-value="${s}">${s}</button>`).join('');
  }
  setSeg(filter, S.styleFilter);
  const list = $('grooveList');
  list.innerHTML = '';
  for (const g of GROOVES) {
    if (S.styleFilter !== 'All' && g.style !== S.styleFilter) continue;
    const card = document.createElement('div');
    card.className = 'groove' + (g.id === S.grooveId ? ' selected' : '');
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.dataset.id = g.id;
    card.innerHTML = `
      <div class="g-head"><span class="g-name"></span><span class="g-meta">${g.bpm} BPM · ${g.steps === 12 ? 'triplet' : '16th'} grid</span></div>
      <div class="g-desc"><span class="g-style">${g.style}</span><span class="d"></span></div>`;
    card.querySelector('.g-name').textContent = g.name;
    card.querySelector('.d').textContent = g.desc;
    if (g.id === S.grooveId) {
      const actions = document.createElement('div');
      actions.className = 'groove-actions';
      actions.innerHTML = `<button data-act="play">▶ Play</button><button data-act="edit">Open in Builder</button>`;
      card.appendChild(actions);
    }
    list.appendChild(card);
  }
}

function selectGroove(id) {
  S.grooveId = id;
  const g = currentGroove();
  applyFeel(grooveToPattern(g));
  S.source = 'groove';
  saveSettings();
  refreshSequence();
  renderGrooves();
}

$('grooveList').addEventListener('click', async e => {
  const card = e.target.closest('.groove');
  if (!card) return;
  const act = e.target.closest('button[data-act]');
  if (act && act.dataset.act === 'edit') return openInBuilder(card.dataset.id);
  if (act && act.dataset.act === 'play') {
    if (!engine.playing) await togglePlay();
    return;
  }
  selectGroove(card.dataset.id); // tapping again reloads the groove's tempo and feel
});
$('grooveList').addEventListener('keydown', e => {
  const card = e.target.closest('.groove');
  if (card && e.key === 'Enter' && e.target === card) selectGroove(card.dataset.id);
});
segHandler($('styleFilter'), v => { S.styleFilter = v; saveSettings(); renderGrooves(); });

async function openInBuilder(grooveId) {
  if (dirty && !(await ask(`Replace the unsaved pattern "${draft.name}" in the builder?`))) return;
  const g = GROOVES.find(x => x.id === grooveId);
  draft = clonePattern(grooveToPattern(g));
  draft.id = newId();
  draft.name = g.name;
  dirty = true;
  saveDraft();
  showTab('builder');
  renderBuilder();
  toast(`"${g.name}" opened in the builder`);
}

// ==================================================================== mixer

const MIX_ROWS = [...KIT_VOICES, { id: 'grooveClick', label: 'Click' }];

function renderMixers() {
  document.querySelectorAll('[data-mixer]').forEach(box => {
    if (!box.children.length) {
      box.innerHTML = MIX_ROWS.map(v => `
        <div class="mix-row" data-voice="${v.id}">
          <span class="name">${v.label}</span>
          <button class="mute" aria-pressed="false">Mute</button>
          <input type="range" class="slider" min="0" max="100" aria-label="${v.label} volume">
        </div>`).join('');
    }
    box.querySelectorAll('.mix-row').forEach(row => {
      const m = S.mix[row.dataset.voice];
      row.classList.toggle('muted', m.mute);
      row.querySelector('.mute').setAttribute('aria-pressed', String(m.mute));
      row.querySelector('.slider').value = Math.round(m.vol * 100);
    });
  });
}
document.querySelectorAll('[data-mixer]').forEach(box => {
  box.addEventListener('click', e => {
    const b = e.target.closest('.mute');
    if (!b) return;
    const m = S.mix[b.closest('.mix-row').dataset.voice];
    m.mute = !m.mute;
    renderMixers();
    saveSettings();
  });
  box.addEventListener('input', e => {
    const row = e.target.closest('.mix-row');
    if (!row) return;
    const m = S.mix[row.dataset.voice];
    m.vol = e.target.value / 100;
    if (m.mute && m.vol > 0) m.mute = false; // moving a muted fader un-mutes it
    renderMixers();
    saveSettings();
  });
});

// ========================================================= pattern builder

function markDirty() {
  dirty = true;
  $('dirtyMark').classList.add('show');
  saveDraft();
}

function renderBuilder() {
  $('patternName').textContent = draft.name;
  $('dirtyMark').classList.toggle('show', dirty);
  const sel = $('patternSelect');
  const saved = library.get(draft.id);
  const sorted = [...library.patterns].sort((a, b) => a.name.localeCompare(b.name));
  sel.innerHTML = `<option value="">${library.patterns.length ? '— choose a saved pattern —' : '— no saved patterns yet —'}</option>` +
    sorted.map(p => `<option value="${p.id}"></option>`).join('');
  sorted.forEach((p, i) => { sel.options[i + 1].textContent = p.name; });
  sel.value = saved ? draft.id : '';
  $('pDelete').disabled = !saved;
  setSeg($('resSeg'), String(draft.stepsPerBar));
  setSeg($('barsSeg'), String(draft.bars));
  renderGrid();
  if (S.source === 'builder') renderNowPlaying();
}

// The grid is split into blocks that fit the screen width without
// horizontal scrolling: whole pattern, one bar, half a bar or one beat per
// row, whichever is the largest that keeps cells finger-sized.
let colCells = [];
let lastChunk = 0;
function chooseChunk() {
  const width = $('grid').clientWidth || window.innerWidth - 60;
  const labelW = width < 500 ? 52 : 92;
  const spb = draft.stepsPerBar / 4;
  const total = draft.stepsPerBar * draft.bars;
  const options = [total, draft.stepsPerBar, draft.stepsPerBar / 2, spb];
  const chunk = options.find(c => (width - labelW) / c >= 32) || spb;
  return { chunk, labelW };
}

function renderGrid() {
  const grid = $('grid');
  if (!grid.offsetParent && grid.children.length) return; // hidden; render on show
  const { chunk, labelW } = chooseChunk();
  lastChunk = chunk;
  const narrow = labelW < 60;
  const spb = draft.stepsPerBar / 4;
  const total = draft.stepsPerBar * draft.bars;
  const subLabels = spb === 4 ? ['', 'e', '&', 'a'] : ['', 'tri', 'let'];
  const shortNames = { ride: 'Ride', oh: 'OH', hh: 'HH', rim: 'Rim', snare: 'Snr', kick: 'Kick' };
  colCells = Array.from({ length: total }, () => []);
  const frag = document.createDocumentFragment();
  for (let start = 0; start < total; start += chunk) {
    const block = document.createElement('div');
    block.className = 'grid-block';
    block.style.gridTemplateColumns = `${labelW}px repeat(${chunk}, minmax(0, 1fr))`;
    const bar = Math.floor(start / draft.stepsPerBar);
    const corner = document.createElement('div');
    corner.className = 'grid-head bar';
    corner.textContent = start % draft.stepsPerBar === 0 ? `Bar ${bar + 1}` : '';
    block.appendChild(corner);
    for (let i = start; i < start + chunk; i++) {
      const h = document.createElement('div');
      const pos = i % spb;
      h.className = 'grid-head' + (pos === 0 ? ' beat' : '');
      h.textContent = pos === 0 ? (Math.floor(i / spb) % 4) + 1 : subLabels[pos];
      block.appendChild(h);
      colCells[i].push(h);
    }
    for (const v of KIT_VOICES) {
      const label = document.createElement('div');
      label.className = 'grid-label';
      label.dataset.voice = v.id;
      label.textContent = narrow ? shortNames[v.id] : v.label;
      block.appendChild(label);
      for (let i = start; i < start + chunk; i++) {
        const c = document.createElement('button');
        c.className = `cell v${draft.tracks[v.id][i]}` + (i % spb === 0 ? ' beat-start' : '');
        c.dataset.voice = v.id;
        c.dataset.i = i;
        c.setAttribute('aria-label', `${v.label}, bar ${Math.floor(i / draft.stepsPerBar) + 1}, step ${(i % draft.stepsPerBar) + 1}`);
        block.appendChild(c);
        colCells[i].push(c);
      }
    }
    frag.appendChild(block);
  }
  grid.innerHTML = '';
  grid.appendChild(frag);
  playheadIndex = -1;
}

const CELL_NAMES = ['off', 'hit', 'accent', 'ghost'];
$('grid').addEventListener('click', e => {
  const cell = e.target.closest('.cell');
  if (cell) {
    const { voice } = cell.dataset;
    const i = Number(cell.dataset.i);
    const v = (draft.tracks[voice][i] + 1) % 4; // off -> hit -> accent -> ghost -> off
    draft.tracks[voice][i] = v; // edited in place: heard on the next loop
    cell.className = cell.className.replace(/\bv\d\b/, 'v' + v);
    cell.title = CELL_NAMES[v];
    markDirty();
    if (v && !engine.playing) engine.preview(voice, VELOCITY[v]);
    return;
  }
  const label = e.target.closest('.grid-label');
  if (label) engine.preview(label.dataset.voice, VELOCITY[1]);
});

let playheadIndex = -1;
function setPlayhead(i) {
  if (i === playheadIndex) return;
  if (colCells[playheadIndex]) colCells[playheadIndex].forEach(c => c.classList.remove('now'));
  playheadIndex = i;
  if (colCells[i]) colCells[i].forEach(c => c.classList.add('now'));
}

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (S.tab === 'builder' && chooseChunk().chunk !== lastChunk) renderGrid(); }, 150);
});

// Structural changes (grid/bars) replace the track arrays, so hand the
// engine a fresh sequence (applied at the next bar line).
function structureChanged() {
  markDirty();
  renderBuilder();
  if (S.source === 'builder') refreshSequence();
}
segHandler($('resSeg'), v => { setResolution(draft, Number(v)); structureChanged(); });
segHandler($('barsSeg'), v => { setBars(draft, Number(v)); structureChanged(); });
$('pClear').addEventListener('click', async () => {
  if (!(await ask('Clear every note in this pattern?'))) return;
  for (const id in draft.tracks) draft.tracks[id].fill(0);
  markDirty();
  renderGrid();
});

async function confirmDiscard() {
  return !dirty || !!(await ask(`Discard unsaved changes to "${draft.name}"?`));
}

function loadIntoBuilder(p, isDirty = false) {
  draft = clonePattern(p);
  dirty = isDirty;
  saveDraft();
  renderBuilder();
  if (S.source === 'builder') refreshSequence();
}

$('patternSelect').addEventListener('change', async e => {
  const p = library.get(e.target.value);
  if (!p) return;
  if (!(await confirmDiscard())) { e.target.value = library.get(draft.id) ? draft.id : ''; return; }
  loadIntoBuilder(p);
  applyFeel(p);
});

$('pNew').addEventListener('click', async () => {
  if (!(await confirmDiscard())) return;
  loadIntoBuilder(blankPattern());
});

$('pSave').addEventListener('click', async () => {
  if (draft.name === 'New pattern' && !library.get(draft.id)) {
    const name = await ask('Name this pattern', { input: '' });
    if (!name) return;
    draft.name = name;
  }
  // Store the current tempo and feel with the pattern.
  draft.bpm = trainerOn() ? S.trainer.start : S.bpm;
  draft.swing = S.swing;
  draft.swingRes = S.swingRes;
  library.put(draft);
  dirty = false;
  saveDraft();
  renderBuilder();
  toast(`Saved "${draft.name}"`);
});

$('pRename').addEventListener('click', async () => {
  const name = await ask('Rename pattern', { input: draft.name });
  if (!name) return;
  draft.name = name;
  if (library.get(draft.id)) library.rename(draft.id, name);
  else markDirty();
  saveDraft();
  renderBuilder();
});

$('pDuplicate').addEventListener('click', () => {
  const copy = clonePattern(draft);
  copy.id = newId();
  copy.name = (draft.name + ' copy').slice(0, 60);
  library.put(copy);
  loadIntoBuilder(copy);
  toast(`Saved a copy: "${copy.name}"`);
});

$('pDelete').addEventListener('click', async () => {
  if (!library.get(draft.id)) return;
  if (!(await ask(`Delete "${draft.name}" from your saved patterns?`))) return;
  library.delete(draft.id);
  // Keep the notes on screen as an unsaved draft, so Save can undo this.
  draft.id = newId();
  markDirty();
  renderBuilder();
  toast('Deleted. Still open in the editor — Save to keep it.');
});

function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pattern';

$('pExport').addEventListener('click', () => {
  download(`${slug(draft.name)}.groove.json`, exportPatterns([draft]));
});
$('pExportAll').addEventListener('click', () => {
  if (!library.patterns.length) return toast('No saved patterns to export yet');
  const date = new Date().toISOString().slice(0, 10);
  download(`groove-trainer-patterns-${date}.json`, exportPatterns(library.patterns));
});
$('pImport').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const list = importPatterns(await file.text(), library.ids());
    library.addMany(list);
    if (!dirty) loadIntoBuilder(list[0]);
    else renderBuilder();
    toast(`Imported ${list.length} pattern${list.length > 1 ? 's' : ''}`);
  } catch (err) {
    toast('Import failed: ' + err.message);
  }
});

// ================================================================= trainer

function renderSteppers() {
  document.querySelectorAll('.stepper').forEach(st => {
    const [group, key] = st.dataset.key.split('.');
    if (!st.children.length) {
      st.innerHTML = `<div class="lbl">${st.dataset.label}</div>
        <div class="ctl"><button aria-label="Less">−</button>
        <input type="number" inputmode="numeric" min="${st.dataset.min}" max="${st.dataset.max}" aria-label="${st.dataset.label}">
        <button aria-label="More">+</button></div>`;
      const [down, up] = st.querySelectorAll('button');
      const inp = st.querySelector('input');
      const set = v => {
        S[group][key] = clamp(Math.round(v) || Number(st.dataset.min), Number(st.dataset.min), Number(st.dataset.max));
        renderSteppers();
        renderBpm();
        renderStatus(null);
        saveSettings();
      };
      holdRepeat(down, () => set(S[group][key] - 1));
      holdRepeat(up, () => set(S[group][key] + 1));
      inp.addEventListener('change', () => set(Number(inp.value)));
    }
    const inp = st.querySelector('input');
    if (document.activeElement !== inp) inp.value = S[group][key];
  });
}

function renderTrainer() {
  setToggle($('trainerToggle'), S.trainer.enabled);
  setToggle($('gapToggle'), S.gap.enabled);
  setToggle($('gapHideToggle'), S.gap.hideVisual);
  setToggle($('wakeToggle'), S.wakeLock);
  $('masterVol').value = Math.round(S.master * 100);
  renderSteppers();
}
$('trainerToggle').addEventListener('click', () => {
  S.trainer.enabled = !S.trainer.enabled;
  liveBpm = null;
  renderTrainer(); renderBpm(); renderStatus(null); saveSettings();
  if (engine.playing) toast('Trainer changes apply from the next bar — restart to begin from bar 1');
});
$('gapToggle').addEventListener('click', () => {
  S.gap.enabled = !S.gap.enabled;
  renderTrainer(); renderStatus(null); saveSettings();
});
$('gapHideToggle').addEventListener('click', () => { S.gap.hideVisual = !S.gap.hideVisual; renderTrainer(); saveSettings(); });
$('wakeToggle').addEventListener('click', () => {
  S.wakeLock = !S.wakeLock;
  if (!S.wakeLock) releaseWake(); else if (engine.playing) requestWake();
  renderTrainer(); saveSettings();
});
$('masterVol').addEventListener('input', e => { S.master = e.target.value / 100; engine.setMasterVolume(S.master); saveSettings(); });

// ================================================================ keyboard

function isTyping(el) {
  return el && (el.isContentEditable || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' ||
    (el.tagName === 'INPUT' && !['range', 'checkbox', 'button'].includes(el.type)));
}
document.addEventListener('keydown', e => {
  if ($('dialog').open || e.metaKey || e.ctrlKey || e.altKey) return;
  const typing = isTyping(e.target);
  if (e.code === 'Space' && !typing) {
    e.preventDefault(); // stop the focused button from also being "clicked"
    if (!e.repeat) togglePlay();
    return;
  }
  if (typing || e.target.type === 'range') return;
  if (e.key === 't' || e.key === 'T') tap();
  else if (e.key === 'ArrowUp') { e.preventDefault(); changeBpm(shownBpm() + (e.shiftKey ? 5 : 1)); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); changeBpm(shownBpm() - (e.shiftKey ? 5 : 1)); }
});
document.addEventListener('keyup', e => {
  if (e.code === 'Space' && !isTyping(e.target)) e.preventDefault();
});

// ==================================================================== start

renderMetronome();
renderGrooves();
renderMixers();
renderTrainer();
showTab(S.tab);
refreshSequence(true);
renderBuilder();
renderPlay();
renderBpm();
renderStatus(null);

// Offline support: register the service worker (needs http/https).
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

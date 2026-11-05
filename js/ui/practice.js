// practice.js (UI) — the Practice tab: routine builder and runner, the
// practice log (minutes per day, streak, best clean tempos) and the
// backup of routines, log and set lists.
//
// The runner drives the normal transport: each block sets what PLAY plays,
// the tempo and the trainers, and the timer counts only while playing. When
// a block's time is up, the engine stops at the next bar line and the next
// block starts exactly there (after its count-in, if the count-in is on).

import * as store from '../storage.js';
import { $, S, saveSettings, engine, bus, describeSource, onFlush } from './core.js';
import { toast, ask, download } from './widgets.js';
import { startPlayback, stopPlayback, stopAtNextBar } from './transport.js';
import { renderTrainer } from './trainer.js';
import { applyItem, itemLabel, itemEditor, currentItem, playingKey } from './items.js';
import * as P from '../practice.js';

export const panel = { id: 'practice', label: 'Practice', onShow: () => renderPractice() };

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// =================================================================== storage

let routines = store.load('routines', null);
if (!Array.isArray(routines)) { routines = P.starterRoutines(); store.save('routines', routines); }
routines = routines.map(P.normalizeRoutine);
let log = store.load('practiceLog', []);
log = Array.isArray(log) ? log.map(P.normalizeEntry) : [];
const prefs = store.load('practicePrefs', {}) || {};
let routineId = routines.some(r => r.id === prefs.routineId) ? prefs.routineId : (routines[0] && routines[0].id);

let saveTimer = null;
function saveRoutines() { clearTimeout(saveTimer); saveTimer = setTimeout(flushRoutines, 250); }
function flushRoutines() { clearTimeout(saveTimer); saveTimer = null; store.save('routines', routines); store.save('practicePrefs', { routineId }); }
onFlush(flushRoutines);
const saveLog = () => store.save('practiceLog', log);

export const getLog = () => log;
const current = () => routines.find(r => r.id === routineId) || null;

// ================================================================== routines

let openBlock = null; // id of the block whose editor is open

function blockMeta(b) {
  const parts = [];
  if (b.trainer.enabled) parts.push(`speed up to ${b.trainer.target} (+${b.trainer.step} every ${b.trainer.every} bars)`);
  if (b.gap.enabled) parts.push(`gap: play ${b.gap.play}, silent ${b.gap.mute}`);
  if (b.note) parts.push(esc(b.note));
  return parts.join(' · ');
}

function blockEditor(b) {
  const box = document.createElement('div');
  box.className = 'block-editor';
  box.appendChild(itemEditor(b.item, () => { saveRoutines(); renderBlockHeads(); }));
  const more = document.createElement('div');
  more.innerHTML = `
    <label class="field"><span>Minutes</span><input type="number" data-k="minutes" min="0.5" max="60" step="0.5" inputmode="decimal"></label>
    <label class="check"><input type="checkbox" data-k="trainer"> Speed up (tempo trainer)</label>
    <div class="sub-fields" data-sub="trainer">
      <label class="field"><span>To BPM</span><input type="number" data-k="target" min="30" max="300"></label>
      <label class="field"><span>+ BPM</span><input type="number" data-k="step" min="1" max="50"></label>
      <label class="field"><span>Every (bars)</span><input type="number" data-k="every" min="1" max="64"></label>
    </div>
    <label class="check"><input type="checkbox" data-k="gap"> Gap trainer (silent bars)</label>
    <div class="sub-fields" data-sub="gap">
      <label class="field"><span>Play (bars)</span><input type="number" data-k="play" min="1" max="32"></label>
      <label class="field"><span>Silent (bars)</span><input type="number" data-k="mute" min="1" max="32"></label>
    </div>
    <label class="field wide"><span>Note</span><input type="text" data-k="note" maxlength="200" placeholder="e.g. Keep the hats light"></label>
    <div class="btn-row"><button data-act="done" class="primary">Done</button></div>`;
  box.appendChild(more);
  const k = name => more.querySelector(`[data-k="${name}"]`);
  const sync = () => {
    k('minutes').value = Math.round(b.seconds / 30) / 2;
    k('trainer').checked = b.trainer.enabled;
    k('target').value = b.trainer.target; k('step').value = b.trainer.step; k('every').value = b.trainer.every;
    k('gap').checked = b.gap.enabled;
    k('play').value = b.gap.play; k('mute').value = b.gap.mute;
    k('note').value = b.note;
    more.querySelector('[data-sub="trainer"]').hidden = !b.trainer.enabled;
    more.querySelector('[data-sub="gap"]').hidden = !b.gap.enabled;
  };
  more.addEventListener('change', e => {
    const key = e.target.dataset.k;
    if (!key) return;
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    const n = Number(v);
    const raw = { ...b, trainer: { ...b.trainer }, gap: { ...b.gap } };
    if (key === 'minutes') raw.seconds = Math.round((n || 0.5) * 60);
    else if (key === 'trainer') raw.trainer.enabled = v;
    else if (key === 'gap') raw.gap.enabled = v;
    else if (['target', 'step', 'every'].includes(key)) raw.trainer[key] = n;
    else if (['play', 'mute'].includes(key)) raw.gap[key] = n;
    else if (key === 'note') raw.note = v;
    Object.assign(b, P.normalizeBlock(raw));
    sync();
    saveRoutines();
    renderBlockHeads();
  });
  sync();
  return box;
}

function renderBlockHeads() {
  const r = current();
  if (!r) return;
  r.blocks.forEach((b, i) => {
    const el = $('blockList').querySelector(`.block[data-id="${b.id}"]`);
    if (!el) return;
    el.querySelector('.b-name').textContent = `${i + 1}. ${itemLabel(b.item)}`;
    el.querySelector('.b-time').textContent = P.formatTime(b.seconds);
    el.querySelector('.b-meta').innerHTML = blockMeta(b);
  });
  $('routineTotal').textContent = `${r.blocks.length} block${r.blocks.length === 1 ? '' : 's'} · ${P.formatTime(P.routineSeconds(r))} in all`;
}

export function renderRoutines() {
  const sel = $('routineSelect');
  sel.innerHTML = routines.length ? '' : '<option value="">— no routines —</option>';
  for (const r of routines) {
    const o = document.createElement('option');
    o.value = r.id;
    o.textContent = `${r.name} · ${P.formatTime(P.routineSeconds(r))}`;
    sel.appendChild(o);
  }
  sel.value = routineId || '';
  const r = current();
  ['rRename', 'rDuplicate', 'rDelete', 'rAddBlock', 'rAddCurrent'].forEach(id => { $(id).disabled = !r; });
  $('rStart').disabled = !r || !r.blocks.length;
  const list = $('blockList');
  list.innerHTML = '';
  if (!r) { $('routineTotal').textContent = ''; return; }
  if (!r.blocks.length) list.innerHTML = '<p class="hint">No blocks yet. Add one, or pick a groove and press "Add what\'s playing".</p>';
  r.blocks.forEach((b, i) => {
    const el = document.createElement('div');
    el.className = 'block' + (run && run.routine.id === r.id && run.index === i ? ' now' : '');
    el.dataset.id = b.id;
    el.innerHTML = `<div class="b-head"><span class="b-name"></span><span class="b-time"></span></div>
      <div class="b-meta"></div>
      <div class="b-actions"><button data-act="edit">${openBlock === b.id ? 'Close' : 'Edit'}</button><button data-act="up" aria-label="Move up"${i ? '' : ' disabled'}>↑</button><button data-act="down" aria-label="Move down"${i < r.blocks.length - 1 ? '' : ' disabled'}>↓</button><button data-act="del" class="danger" aria-label="Remove">✕</button></div>`;
    if (openBlock === b.id) el.appendChild(blockEditor(b));
    list.appendChild(el);
  });
  renderBlockHeads();
}

$('blockList').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-act]');
  const el = e.target.closest('.block');
  const r = current();
  if (!btn || !el || !r || btn.closest('.block-editor') && btn.dataset.act !== 'done') return;
  const i = r.blocks.findIndex(b => b.id === el.dataset.id);
  if (i < 0) return;
  const act = btn.dataset.act;
  if (act === 'edit') openBlock = openBlock === el.dataset.id ? null : el.dataset.id;
  else if (act === 'done') openBlock = null;
  else if (act === 'up' && i > 0) [r.blocks[i - 1], r.blocks[i]] = [r.blocks[i], r.blocks[i - 1]];
  else if (act === 'down' && i < r.blocks.length - 1) [r.blocks[i + 1], r.blocks[i]] = [r.blocks[i], r.blocks[i + 1]];
  else if (act === 'del') {
    if (!(await ask(`Remove block ${i + 1} (${itemLabel(r.blocks[i].item)})?`))) return;
    r.blocks.splice(i, 1);
  }
  saveRoutines();
  renderRoutines();
});

$('routineSelect').addEventListener('change', e => { routineId = e.target.value; openBlock = null; saveRoutines(); renderRoutines(); });

$('rNew').addEventListener('click', async () => {
  const name = await ask('Name the new routine', { input: '' });
  if (!name) return;
  const r = P.normalizeRoutine({ name, blocks: [] });
  routines.push(r);
  routineId = r.id;
  saveRoutines();
  renderRoutines();
});
$('rRename').addEventListener('click', async () => {
  const r = current();
  const name = r && await ask('Rename routine', { input: r.name });
  if (!name) return;
  r.name = name.slice(0, 60);
  saveRoutines();
  renderRoutines();
});
$('rDuplicate').addEventListener('click', () => {
  const r = current();
  if (!r) return;
  const copy = P.normalizeRoutine({ name: (r.name + ' copy').slice(0, 60), blocks: r.blocks.map(b => ({ ...b, id: '' })) });
  routines.push(copy);
  routineId = copy.id;
  saveRoutines();
  renderRoutines();
});
$('rDelete').addEventListener('click', async () => {
  const r = current();
  if (!r || !(await ask(`Delete the routine "${r.name}"?`))) return;
  if (run && run.routine.id === r.id) endRun(false);
  routines = routines.filter(x => x.id !== r.id);
  routineId = routines[0] ? routines[0].id : null;
  saveRoutines();
  renderRoutines();
});
function addBlock(item) {
  const r = current();
  if (!r) return;
  const b = P.normalizeBlock({ item, seconds: 180 });
  r.blocks.push(b);
  openBlock = b.id;
  saveRoutines();
  renderRoutines();
}
$('rAddBlock').addEventListener('click', () => addBlock({ kind: 'groove', grooveId: S.grooveId }));
$('rAddCurrent').addEventListener('click', () => { addBlock(currentItem()); toast('Added what is selected now'); });

// ==================================================================== runner

// run: { routine (a copy), index, elapsed (s in this block), last, switching, snapshot }
let run = null;
export const getRun = () => run;

function applyBlock(b) {
  applyItem(b.item);
  S.trainer = { ...S.trainer, enabled: b.trainer.enabled, start: S.bpm, target: b.trainer.target, step: b.trainer.step, every: b.trainer.every };
  S.gap = { ...S.gap, enabled: b.gap.enabled, play: b.gap.play, mute: b.gap.mute };
  saveSettings();
  renderTrainer();
  bus.emit('tempo');
}

function goTo(index, { play = engine.playing, at = null } = {}) {
  if (!run) return;
  if (index < 0) index = 0;
  if (index >= run.routine.blocks.length) { endRun(true); return; }
  if (engine.playing) stopPlayback();
  run.index = index;
  run.elapsed = 0;
  run.switching = false;
  applyBlock(run.routine.blocks[index]);
  renderRun();
  renderRoutines();
  if (play) startPlayback({ at });
}

export function startRun() {
  const r = current();
  if (!r || !r.blocks.length) return;
  if (run) endRun(false);
  run = { routine: JSON.parse(JSON.stringify(r)), index: 0, elapsed: 0, last: performance.now(), switching: false, done: 0, snapshot: { trainer: { ...S.trainer }, gap: { ...S.gap } } };
  goTo(0, { play: true });
}

function endRun(finished) {
  if (!run) return;
  const r = run;
  run = null;
  if (engine.playing) stopPlayback();
  S.trainer = r.snapshot.trainer;
  S.gap = r.snapshot.gap;
  saveSettings();
  renderTrainer();
  bus.emit('tempo');
  renderRun();
  renderRoutines();
  if (finished) toast(`Routine finished: ${r.routine.name} ✓`);
}

function tickRun() {
  const now = performance.now();
  if (!run) return;
  const dt = (now - run.last) / 1000;
  run.last = now;
  if (engine.playing && !run.switching && !engine.seq.inCountIn) run.elapsed += Math.min(dt, 2);
  const b = run.routine.blocks[run.index];
  if (engine.playing && !run.switching && b && run.elapsed >= b.seconds) {
    // Time is up: finish the bar, then move on exactly at the bar line.
    run.switching = true;
    stopAtNextBar(time => goTo(run ? run.index + 1 : 0, { play: true, at: time }));
  }
  renderRun();
}
setInterval(tickRun, 200);

// Stopped by hand while waiting for the bar line: move on, wait for PLAY.
bus.on('stop', () => setTimeout(() => {
  if (run && run.switching && !engine.playing) goTo(run.index + 1, { play: false });
}, 0));

function renderRun() {
  const card = $('runCard');
  card.hidden = !run;
  if (!run) return;
  const r = run.routine, b = r.blocks[run.index];
  const pos = P.routinePosition(r, run.index, run.elapsed);
  $('runBlock').textContent = `Block ${run.index + 1} of ${r.blocks.length} · ${r.name}`;
  $('runName').textContent = itemLabel(b.item);
  $('runNote').textContent = [b.trainer.enabled ? `Speeding up to ${b.trainer.target}` : '', b.gap.enabled ? `Gap ${b.gap.play}/${b.gap.mute}` : '', b.note].filter(Boolean).join(' · ');
  $('runLeft').textContent = run.switching ? 'next…' : P.formatTime(pos.blockLeft);
  $('runBar').style.width = `${Math.round(pos.progress * 1000) / 10}%`;
  const next = r.blocks[run.index + 1];
  $('runNext').textContent = `${next ? `Next: ${itemLabel(next.item)} · ` : 'Last block · '}${P.formatTime(pos.totalLeft)} left in all`;
  $('runPause').textContent = engine.playing ? '❚❚ Pause' : '▶ Resume';
  $('runBack').disabled = false;
}

$('rStart').addEventListener('click', startRun);
$('runPause').addEventListener('click', () => { if (engine.playing) stopPlayback(); else startPlayback(); });
$('runSkip').addEventListener('click', () => goTo(run.index + 1));
$('runBack').addEventListener('click', () => goTo(run.elapsed > 5 ? run.index : run.index - 1));
$('runEnd').addEventListener('click', () => endRun(false));
bus.on('play', renderRun);
bus.on('stop', renderRun);

// ======================================================================= log

export const MIN_LOG_SECONDS = 10;
let session = null;
let pendingTake = null; // a feedback score that arrived just before the entry
let lastEntry = null;

const plainSource = () => { const d = document.createElement('div'); d.innerHTML = describeSource(); return d.textContent; };

bus.on('play', () => { session = { start: performance.now(), routine: run ? run.routine.name : '' }; });
bus.on('stop', () => {
  if (!session) return;
  const sec = (performance.now() - session.start) / 1000;
  const routine = session.routine;
  session = null;
  if (sec < MIN_LOG_SECONDS) return;
  const bpm = S.trainer.enabled ? (engine.seq.barBpm || S.trainer.start) : S.bpm;
  log = P.addEntry(log, { date: new Date().toISOString(), seconds: sec, key: playingKey(), label: plainSource(), bpm, routine });
  lastEntry = { id: log[0].id, at: Date.now() };
  if (pendingTake && Date.now() - pendingTake.at < 3000) attachScore(log[0], pendingTake.s);
  pendingTake = null;
  saveLog();
  renderLog();
});

function attachScore(e, s) {
  e.score = { mean: Math.round(s.mean * 10) / 10, sd: Math.round(s.sd * 10) / 10, within10: Math.round(s.within10 * 100), count: s.count };
  if (P.isCleanTake(s)) e.clean = true;
}

// The Feedback tab reports each scored take (mic or MIDI).
bus.on('take', s => {
  const e = lastEntry && Date.now() - lastEntry.at < 3000 && log.find(x => x.id === lastEntry.id);
  if (e) { attachScore(e, s); saveLog(); renderLog(); }
  else pendingTake = { s, at: Date.now() };
});

function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}
const mins = sec => (sec < 3600 ? `${Math.round(sec / 60)} min` : `${(sec / 3600).toFixed(1)} h`);

export function renderLog() {
  const t = P.totals(log);
  const st = P.streak(log);
  $('logStats').innerHTML = `
    <div class="fb-stat"><b>${mins(t.today)}</b><span>today</span></div>
    <div class="fb-stat"><b>${mins(t.week)}</b><span>last 7 days</span></div>
    <div class="fb-stat"><b>${st} day${st === 1 ? '' : 's'}</b><span>streak</span></div>
    <div class="fb-stat"><b>${mins(t.all)}</b><span>in all</span></div>`;
  const days = P.minutesByDay(log, 14);
  const max = Math.max(30, ...days.map(d => d.minutes));
  $('logDays').innerHTML = days.map(d => {
    const [, m, day] = d.day.split('-');
    return `<div class="day" title="${d.day}: ${d.minutes} min"><i style="height:${Math.round(d.minutes / max * 100)}%"></i><small>${Number(day)}</small></div>`;
  }).join('');
  const box = $('logList');
  box.innerHTML = log.length ? '' : '<p class="hint">Nothing logged yet. Every time you play for at least 10 seconds, it is logged here.</p>';
  for (const e of log.slice(0, 15)) {
    const row = document.createElement('div');
    row.className = 'log-row';
    row.dataset.id = e.id;
    const score = e.score ? ` · ${e.score.mean > 0 ? '+' : ''}${e.score.mean} ms ±${Math.round(e.score.sd)}` : '';
    row.innerHTML = `<span class="l-what"></span><span class="l-meta"></span><button class="clean-btn" aria-pressed="${e.clean}" title="Mark as played clean">✓ clean</button>`;
    row.querySelector('.l-what').textContent = e.label;
    row.querySelector('.l-meta').textContent = `${fmtDate(e.date)} · ${P.formatTime(e.seconds)} · ${e.bpm} BPM${score}${e.routine ? ' · ' + e.routine : ''}`;
    box.appendChild(row);
  }
  const best = P.bestTempos(log);
  $('bestList').innerHTML = best.length ? '' : '<p class="hint">Mark a session as clean (✓) — or play it with the Feedback tab listening — and your best clean tempo for that groove shows here.</p>';
  for (const b of best) {
    const row = document.createElement('div');
    row.className = 'best-row';
    row.dataset.key = b.key;
    row.dataset.bpm = b.bpm;
    row.innerHTML = `<span class="l-what"></span><b>${b.bpm} BPM</b><button data-act="practise">Practise</button>`;
    row.querySelector('.l-what').textContent = `${b.label} · ${new Date(b.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    $('bestList').appendChild(row);
  }
}

$('logList').addEventListener('click', e => {
  const btn = e.target.closest('.clean-btn');
  if (!btn) return;
  const entry = log.find(x => x.id === btn.closest('.log-row').dataset.id);
  if (!entry) return;
  entry.clean = !entry.clean;
  saveLog();
  renderLog();
});
$('bestList').addEventListener('click', e => {
  const row = e.target.closest('.best-row');
  if (!row || !e.target.closest('button')) return;
  const it = P.itemFromKey(row.dataset.key);
  it.bpm = Number(row.dataset.bpm);
  if (!applyItem(it)) toast('That pattern is no longer saved');
  else toast(`Loaded at ${it.bpm} BPM. Press Play`);
});

// ==================================================================== backup

const loadSetlists = () => { const l = store.load('setlists', []); return Array.isArray(l) ? l : []; };

export function exportBackup(parts = { routines: true, log: true, setlists: true }) {
  return P.exportPractice({
    routines: parts.routines ? routines : null,
    log: parts.log ? log : null,
    setlists: parts.setlists ? loadSetlists() : null,
  });
}

export function importBackup(text) {
  const data = P.importPractice(text);
  routines = P.mergeById(routines, data.routines);
  log = P.mergeLog(log, data.log);
  if (data.setlists.length) store.save('setlists', P.mergeById(loadSetlists().map(P.normalizeSetlist), data.setlists));
  if (!routineId && routines[0]) routineId = routines[0].id;
  flushRoutines();
  saveLog();
  renderPractice();
  bus.emit('setlists'); // the Gig tab reloads its set lists
  return data;
}

const today = () => new Date().toISOString().slice(0, 10);
$('bExport').addEventListener('click', () => download(`groove-trainer-practice-${today()}.json`, exportBackup()));
$('bImport').addEventListener('click', () => $('bImportFile').click());
$('bImportFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const d = importBackup(await file.text());
    toast(`Imported ${d.routines.length} routines, ${d.log.length} log entries, ${d.setlists.length} set lists`);
  } catch (err) {
    toast('Import failed: ' + err.message);
  }
});
$('bClearLog').addEventListener('click', async () => {
  if (!log.length || !(await ask('Clear the whole practice log? (Export it first if you want a copy.)'))) return;
  log = [];
  saveLog();
  renderLog();
});

export function renderPractice() {
  renderRoutines();
  renderRun();
  renderLog();
}

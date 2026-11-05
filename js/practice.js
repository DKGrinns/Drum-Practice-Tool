// practice.js — practice structure, pure functions (no DOM, tested in Node):
//
//   items      "what to play": the metronome, a library groove or a saved
//              pattern, at a tempo. Routine blocks and set-list songs both
//              hold one.
//   routines   a list of timed blocks (item + minutes + trainer settings)
//   log        practice sessions: minutes per day, streaks, best clean tempo
//   set lists  songs (item, key, notes, song form) for gigs
//   count-in   which words to speak on which count-in beats
//   backup     export/import of routines, log and set lists as one JSON file

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, lo, hi, def) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? clamp(Number(v), lo, hi) : def);
const str = (v, max = 200, def = '') => (typeof v === 'string' ? v.slice(0, max) : def);

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// --------------------------------------------------------------------- items

export const ITEM_KINDS = ['metronome', 'groove', 'pattern'];

// bpm null = use the groove's or pattern's own tempo.
export function normalizeItem(it) {
  it = it && typeof it === 'object' ? it : {};
  const kind = ITEM_KINDS.includes(it.kind) ? it.kind : 'metronome';
  return {
    kind,
    grooveId: str(it.grooveId, 60),
    patternId: str(it.patternId, 60),
    meter: str(it.meter, 6, '4/4') || '4/4',
    subdivision: str(it.subdivision, 12, 'quarter') || 'quarter',
    bpm: it.bpm == null || it.bpm === '' ? null : Math.round(num(it.bpm, 30, 300, 100)),
  };
}

// Key used to group log entries (best tempo per groove / pattern / meter).
export function itemKey(it) {
  if (it.kind === 'groove') return 'groove:' + it.grooveId;
  if (it.kind === 'pattern') return 'pattern:' + it.patternId;
  return 'metronome:' + (it.meter || '4/4');
}
export function itemFromKey(key) {
  const [kind, id] = String(key).split(/:(.*)/s);
  if (kind === 'groove') return normalizeItem({ kind, grooveId: id });
  if (kind === 'pattern') return normalizeItem({ kind, patternId: id });
  return normalizeItem({ kind: 'metronome', meter: id || '4/4' });
}

// ------------------------------------------------------------------ routines

export function normalizeBlock(b) {
  b = b && typeof b === 'object' ? b : {};
  const tr = b.trainer || {}, gap = b.gap || {};
  return {
    id: str(b.id, 40) || uid(),
    item: normalizeItem(b.item),
    seconds: Math.round(num(b.seconds, 10, 3600, 180)),
    trainer: { enabled: !!tr.enabled, target: Math.round(num(tr.target, 30, 300, 120)), step: Math.round(num(tr.step, 1, 50, 2)), every: Math.round(num(tr.every, 1, 64, 4)) },
    gap: { enabled: !!gap.enabled, play: Math.round(num(gap.play, 1, 32, 3)), mute: Math.round(num(gap.mute, 1, 32, 1)) },
    note: str(b.note, 200),
  };
}

export function normalizeRoutine(r) {
  r = r && typeof r === 'object' ? r : {};
  return {
    id: str(r.id, 40) || uid(),
    name: str(r.name, 60) || 'Routine',
    blocks: Array.isArray(r.blocks) ? r.blocks.slice(0, 60).map(normalizeBlock) : [],
  };
}

export const routineSeconds = r => r.blocks.reduce((s, b) => s + b.seconds, 0);

// 75 -> "1:15", 3600 -> "60:00"
export function formatTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

// Where a routine is after `elapsed` seconds of playing (for the runner
// display): block index, seconds left in it, seconds left in total.
export function routinePosition(r, index, elapsedInBlock) {
  const b = r.blocks[index];
  if (!b) return { index, blockLeft: 0, totalLeft: 0, done: true };
  const blockLeft = Math.max(0, b.seconds - elapsedInBlock);
  const after = r.blocks.slice(index + 1).reduce((s, x) => s + x.seconds, 0);
  return { index, blockLeft, totalLeft: blockLeft + after, done: false, progress: clamp(elapsedInBlock / b.seconds, 0, 1) };
}

// ----------------------------------------------------------------------- log

// Local calendar day, "YYYY-MM-DD".
export function dayKey(d = new Date()) {
  d = new Date(d);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + n, 12));
}

export const MAX_LOG = 3000;

export function normalizeEntry(e) {
  e = e && typeof e === 'object' ? e : {};
  const date = typeof e.date === 'string' && !Number.isNaN(Date.parse(e.date)) ? e.date : new Date().toISOString();
  const s = e.score && typeof e.score === 'object' ? e.score : null;
  return {
    id: str(e.id, 40) || uid(),
    date,
    day: /^\d{4}-\d\d-\d\d$/.test(e.day) ? e.day : dayKey(date),
    seconds: Math.round(num(e.seconds, 0, 24 * 3600, 0)),
    key: str(e.key, 80) || 'metronome:4/4',
    label: str(e.label, 100),
    bpm: Math.round(num(e.bpm, 30, 300, 100)),
    clean: e.clean === true,
    score: s ? { mean: num(s.mean, -999, 999, 0), sd: num(s.sd, 0, 999, 0), within10: num(s.within10, 0, 100, 0), count: Math.round(num(s.count, 0, 1e6, 0)) } : null,
    routine: str(e.routine, 60),
  };
}

// Newest first, capped.
export function addEntry(log, entry) {
  return [normalizeEntry(entry), ...log].slice(0, MAX_LOG);
}

// Minutes practised on each of the last `days` days, oldest first.
export function minutesByDay(log, days = 14, today = dayKey()) {
  const sums = {};
  for (const e of log) sums[e.day] = (sums[e.day] || 0) + e.seconds;
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = addDays(today, -i);
    out.push({ day, minutes: Math.round((sums[day] || 0) / 6) / 10 });
  }
  return out;
}

export const MIN_STREAK_SECONDS = 60;

// Days in a row with at least a minute of practice, ending today (or
// yesterday, so the streak isn't "lost" before you've practised today).
export function streak(log, today = dayKey()) {
  const sums = {};
  for (const e of log) sums[e.day] = (sums[e.day] || 0) + e.seconds;
  const ok = d => (sums[d] || 0) >= MIN_STREAK_SECONDS;
  let day = ok(today) ? today : addDays(today, -1);
  let n = 0;
  while (ok(day)) { n++; day = addDays(day, -1); }
  return n;
}

export function totals(log, today = dayKey()) {
  let todaySec = 0, weekSec = 0, allSec = 0;
  const weekStart = addDays(today, -6);
  for (const e of log) {
    allSec += e.seconds;
    if (e.day === today) todaySec += e.seconds;
    if (e.day >= weekStart && e.day <= today) weekSec += e.seconds;
  }
  return { today: todaySec, week: weekSec, all: allSec };
}

// A scored take counts as clean when it is steady and centred.
export function isCleanTake(s) {
  return !!s && s.count >= 16 && Math.abs(s.mean) <= 15 && s.sd <= 15;
}

// Best clean tempo for each groove / pattern / meter:
//   [{ key, label, bpm, date }], highest tempo per key.
export function bestTempos(log) {
  const best = {};
  for (const e of log) {
    if (!e.clean) continue;
    const b = best[e.key];
    if (!b || e.bpm > b.bpm || (e.bpm === b.bpm && e.date > b.date)) best[e.key] = { key: e.key, label: e.label || b?.label || e.key, bpm: e.bpm, date: e.date };
  }
  return Object.values(best).sort((a, b) => a.label.localeCompare(b.label));
}

// ----------------------------------------------------------------- set lists

export function normalizeSong(s) {
  s = s && typeof s === 'object' ? s : {};
  return {
    id: str(s.id, 40) || uid(),
    title: str(s.title, 80) || 'Song',
    item: normalizeItem(s.item),
    key: str(s.key, 4),
    notes: str(s.notes, 500),
    form: str(s.form, 300),
  };
}

export function normalizeSetlist(l) {
  l = l && typeof l === 'object' ? l : {};
  return {
    id: str(l.id, 40) || uid(),
    name: str(l.name, 60) || 'Set list',
    songs: Array.isArray(l.songs) ? l.songs.slice(0, 100).map(normalizeSong) : [],
  };
}

// Song form: "Intro 4, Verse 16, Chorus 8 x2, Solo 16, Outro 4".
// Sections are separated by commas, new lines, "|" or ";". Each is a name
// and a number of bars (before or after the name), optionally "x2" to
// repeat. A section without a number gets 8 bars.
export function parseForm(text) {
  const out = [];
  for (const raw of String(text || '').split(/[,;|\n]+/)) {
    let t = raw.trim();
    if (!t) continue;
    let times = 1;
    const rep = t.match(/\s*[x×]\s*(\d+)\s*$/i);
    if (rep) { times = clamp(Number(rep[1]), 1, 16); t = t.slice(0, rep.index).trim(); }
    t = t.replace(/(\d)\s*(bars?|b)$/i, '$1');
    let bars = null;
    const after = t.match(/^(.*?)\s+(\d+)$/);
    const before = t.match(/^(\d+)\s+(.*)$/);
    if (after) { bars = Number(after[2]); t = after[1]; }
    else if (before) { bars = Number(before[1]); t = before[2]; }
    else if (/^\d+$/.test(t)) { bars = Number(t); t = 'Section'; }
    bars = clamp(bars || 8, 1, 512);
    const name = t.trim().slice(0, 30) || 'Section';
    for (let i = 0; i < times; i++) out.push({ name, bars });
  }
  return out.slice(0, 64);
}

export const formBars = sections => sections.reduce((s, x) => s + x.bars, 0);

// Where bar `bar` (0-based since the song started) falls in the form.
export function formPosition(sections, bar) {
  let start = 0;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (bar < start + s.bars) {
      return { index: i, name: s.name, bar: bar - start + 1, bars: s.bars, last: bar === start + s.bars - 1, next: sections[i + 1] ? sections[i + 1].name : null };
    }
    start += s.bars;
  }
  return { index: -1, name: null, bar: 0, bars: 0, last: false, next: null, done: sections.length > 0 };
}

// ------------------------------------------------------------------ count-in

export const NUMBER_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

// Words to speak on each count-in beat (null = silent, the click still
// plays). One bar: every beat ("one two three four"). Two bars: the
// classic "one — two — | one two three four". At very fast tempos only the
// first and middle beat of each bar get a word.
export function countInWords(beatsPerBar, bars, beatDur) {
  const out = [];
  const mid = beatsPerBar % 2 === 0 ? beatsPerBar / 2 : Math.ceil(beatsPerBar / 2);
  const fast = beatDur < 0.25;
  for (let bar = 0; bar < bars; bar++) {
    const lastBar = bar === bars - 1;
    for (let beat = 0; beat < beatsPerBar; beat++) {
      if (!fast && lastBar) out.push(NUMBER_WORDS[beat] || null);
      else if (beatsPerBar > 1 && (beat === 0 || beat === mid)) out.push(beat === 0 ? 'one' : 'two');
      else if (beatsPerBar === 1) out.push(NUMBER_WORDS[bar] || null);
      else out.push(null);
    }
  }
  return out;
}

// -------------------------------------------------------------------- backup

export const PRACTICE_FORMAT = 'groove-trainer-practice';

export function exportPractice({ routines, log, setlists }) {
  const data = { format: PRACTICE_FORMAT, version: 1, exported: new Date().toISOString() };
  if (routines) data.routines = routines;
  if (log) data.log = log;
  if (setlists) data.setlists = setlists;
  return JSON.stringify(data, null, 2);
}

export function importPractice(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('Not a JSON file'); }
  if (!data || data.format !== PRACTICE_FORMAT) throw new Error('Not a Groove Trainer practice file');
  const list = (v, fn) => (Array.isArray(v) ? v.map(fn) : []);
  return {
    routines: list(data.routines, normalizeRoutine),
    log: list(data.log, normalizeEntry),
    setlists: list(data.setlists, normalizeSetlist),
  };
}

// Merge by id: incoming items with a new id are added; same id replaces.
export function mergeById(existing, incoming) {
  const out = existing.slice();
  for (const x of incoming) {
    const i = out.findIndex(y => y.id === x.id);
    if (i >= 0) out[i] = x; else out.push(x);
  }
  return out;
}

// Log entries: same id is the same session, keep one; newest first.
export function mergeLog(existing, incoming) {
  const seen = new Set(existing.map(e => e.id));
  const out = existing.concat(incoming.filter(e => !seen.has(e.id)));
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, MAX_LOG);
}

// -------------------------------------------------------- starter routines

// Shown the first time (they can be edited or deleted like any routine).
export function starterRoutines() {
  const g = (grooveId, bpm, min, extra = {}) => ({ item: { kind: 'groove', grooveId, bpm }, seconds: min * 60, ...extra });
  const m = (bpm, min, subdivision = 'quarter', extra = {}) => ({ item: { kind: 'metronome', meter: '4/4', subdivision, bpm }, seconds: min * 60, ...extra });
  return [
    { name: 'Reggae warm-up (15 min)', blocks: [
      m(70, 2, 'eighth', { note: 'Loose wrists, even 8ths on the hats' }),
      g('one-drop', 72, 3, { note: 'Kick and rim together on 3' }),
      g('one-drop', 72, 3, { gap: { enabled: true, play: 3, mute: 1 }, note: 'Keep the drop through the silent bar' }),
      g('rockers', 76, 3),
      g('steppers', 70, 4, { trainer: { enabled: true, target: 84, step: 2, every: 8 } }),
    ] },
    { name: 'Funk & soul ghost notes (15 min)', blocks: [
      m(80, 2, 'sixteenth', { note: 'Accent the beat, ghost the rest' }),
      g('funk-16-ghost', 80, 4, { trainer: { enabled: true, target: 96, step: 2, every: 8 } }),
      g('soul-backbeat', 92, 3),
      g('funk-sync-kick', 90, 3, { gap: { enabled: true, play: 2, mute: 2 } }),
      g('neo-soul', 76, 3, { note: 'Lay the snare back' }),
    ] },
    { name: 'Latin & Brazilian (12 min)', blocks: [
      g('bossa-nova', null, 3, { note: 'Cross-stick clave, light ride' }),
      g('samba', null, 3),
      g('partido-alto', null, 3),
      g('salsa-2-3', null, 3, { note: 'Feel it in 2' }),
    ] },
  ].map(normalizeRoutine);
}

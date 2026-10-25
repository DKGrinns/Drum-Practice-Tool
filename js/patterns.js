// patterns.js — the pattern data model shared by grooves, the pattern
// builder and the metronome.
//
// A pattern (as saved / exported) looks like:
//   {
//     id: 'p_abc123', name: 'My groove',
//     stepsPerBar: 16 | 12,      // 16 = 16th notes, 12 = 8th-note triplets
//     bars: 1..4,
//     bpm: 90,                   // suggested tempo
//     swing: 0..1, swingRes: 8 | 16,
//     tracks: { kick: [0,1,0,...], snare: [...], ... }   // one value per step
//   }
// Step values: 0 = off, 1 = normal hit, 2 = accent, 3 = ghost note.
//
// The sequencer plays a lighter "sequence" object:
//   { spb (steps per beat), beatsPerBar, bars, tracks }

import * as store from './storage.js';

export const OFF = 0, HIT = 1, ACCENT = 2, GHOST = 3;

// Kit voices, top-to-bottom as shown in the builder grid.
export const KIT_VOICES = [
  { id: 'ride',  label: 'Ride' },
  { id: 'oh',    label: 'Open HH' },
  { id: 'hh',    label: 'Closed HH' },
  { id: 'rim',   label: 'Rim / X-stick' },
  { id: 'snare', label: 'Snare' },
  { id: 'kick',  label: 'Kick' },
];
export const KIT_IDS = KIT_VOICES.map(v => v.id);

export const MAX_BARS = 4;

// ---------------------------------------------------------------------------
// Text notation used by the groove library (see grooves.js / README).
//   '-' or '.' = off, 'x' = hit, 'X' = accent, 'g' = ghost.
//   '|' and spaces are ignored, so bars and beats can be separated visually.
const CHAR_TO_VALUE = { '-': OFF, '.': OFF, x: HIT, X: ACCENT, g: GHOST };

export function parseTrack(str) {
  const out = [];
  for (const ch of str) {
    if (ch === '|' || ch === ' ') continue;
    if (!(ch in CHAR_TO_VALUE)) throw new Error(`Bad step character "${ch}" in "${str}"`);
    out.push(CHAR_TO_VALUE[ch]);
  }
  return out;
}

export function trackToString(arr) {
  const map = ['-', 'x', 'X', 'g'];
  return arr.map(v => map[v] || '-').join('');
}

// ---------------------------------------------------------------------------
// IDs, validation and normalisation

export function newId() {
  return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function emptyTracks(len) {
  const tracks = {};
  for (const id of KIT_IDS) tracks[id] = new Array(len).fill(OFF);
  return tracks;
}

export function blankPattern(name = 'New pattern') {
  return {
    id: newId(), name, stepsPerBar: 16, bars: 1, bpm: 90, swing: 0, swingRes: 16,
    tracks: emptyTracks(16),
  };
}

// Turn anything pattern-shaped (from storage, an imported file or the groove
// library) into a clean, valid pattern. Throws if it is hopeless.
export function normalizePattern(p) {
  if (!p || typeof p !== 'object') throw new Error('Not a pattern object');
  const stepsPerBar = Number(p.stepsPerBar) === 12 ? 12 : 16;
  const bars = clamp(Math.round(Number(p.bars) || 1), 1, MAX_BARS);
  const len = stepsPerBar * bars;
  const tracks = {};
  const src = p.tracks && typeof p.tracks === 'object' ? p.tracks : {};
  for (const id of KIT_IDS) {
    let t = src[id];
    if (typeof t === 'string') t = parseTrack(t);
    const arr = new Array(len).fill(OFF);
    if (Array.isArray(t)) {
      for (let i = 0; i < len && i < t.length; i++) {
        const v = Math.round(Number(t[i]) || 0);
        arr[i] = v >= 0 && v <= 3 ? v : OFF;
      }
    }
    tracks[id] = arr;
  }
  return {
    id: typeof p.id === 'string' && p.id ? p.id : newId(),
    name: String(p.name || 'Untitled').slice(0, 60),
    stepsPerBar, bars,
    bpm: clamp(Math.round(Number(p.bpm) || 90), 30, 300),
    swing: clamp(Number(p.swing) || 0, 0, 1),
    swingRes: Number(p.swingRes) === 8 ? 8 : 16,
    tracks,
  };
}

export function clonePattern(p) {
  return normalizePattern(JSON.parse(JSON.stringify(p)));
}

// Change the number of bars. New bars repeat the existing ones, which is
// usually what you want when extending a groove.
export function setBars(p, bars) {
  bars = clamp(bars, 1, MAX_BARS);
  const oldLen = p.stepsPerBar * p.bars;
  const newLen = p.stepsPerBar * bars;
  for (const id of KIT_IDS) {
    const old = p.tracks[id];
    const arr = new Array(newLen);
    for (let i = 0; i < newLen; i++) arr[i] = old[i % oldLen];
    p.tracks[id] = arr;
  }
  p.bars = bars;
  return p;
}

// Convert between 16 and 12 steps per bar. Each note moves to the nearest
// step on the new grid (by time position); collisions keep the stronger hit.
export function setResolution(p, stepsPerBar) {
  if (stepsPerBar === p.stepsPerBar) return p;
  const oldSpb = p.stepsPerBar / 4, newSpb = stepsPerBar / 4;
  const newLen = stepsPerBar * p.bars;
  const rank = [0, 2, 3, 1]; // strength order: off < ghost < hit < accent
  for (const id of KIT_IDS) {
    const old = p.tracks[id];
    const arr = new Array(newLen).fill(OFF);
    old.forEach((v, i) => {
      if (!v) return;
      const beats = i / oldSpb;
      const j = Math.round(beats * newSpb) % newLen;
      if (rank[v] > rank[arr[j]]) arr[j] = v;
    });
    p.tracks[id] = arr;
  }
  p.stepsPerBar = stepsPerBar;
  return p;
}

// The object the sequencer plays. Track arrays are shared by reference so
// tapping cells in the builder is heard immediately. The tracks object itself
// is copied: setBars/setResolution swap in new arrays, and the old sequence
// must keep its old arrays until the engine switches at the next bar line.
export function toSequence(p) {
  return { spb: p.stepsPerBar / 4, beatsPerBar: 4, bars: p.bars, tracks: { ...p.tracks } };
}

// ---------------------------------------------------------------------------
// Metronome: meters and click patterns.
//
// `beats` is the number of counted pulses per bar and `unit` describes what
// the BPM refers to. In 6/8 and 12/8 the beat is the dotted quarter (so 12/8
// counts four big beats, like a shuffle). In 7/8 every eighth is a beat,
// grouped 2+2+3.
export const METERS = {
  '4/4':  { beats: 4, compound: false, unit: '♩' },
  '3/4':  { beats: 3, compound: false, unit: '♩' },
  '5/4':  { beats: 5, compound: false, unit: '♩' },
  '6/8':  { beats: 2, compound: true,  unit: '♩.' },
  '12/8': { beats: 4, compound: true,  unit: '♩.' },
  '7/8':  { beats: 7, compound: false, unit: '♪', groups: [2, 2, 3] },
};

// Subdivision choices -> clicks per beat, per meter type. null = not offered.
export const SUBDIVISIONS = ['quarter', 'eighth', 'triplet', 'sixteenth'];
export function subdivisionInfo(meterKey) {
  const m = METERS[meterKey] || METERS['4/4'];
  if (m.compound) {
    return {
      quarter:   { spb: 1, label: 'Beats ♩.' },
      eighth:    { spb: 3, label: '8ths' },
      triplet:   null,
      sixteenth: { spb: 6, label: '16ths' },
    };
  }
  if (m.groups) {
    return {
      quarter:   null,
      eighth:    { spb: 1, label: '8ths' },
      triplet:   null,
      sixteenth: { spb: 2, label: '16ths' },
    };
  }
  return {
    quarter:   { spb: 1, label: 'Quarters' },
    eighth:    { spb: 2, label: '8ths' },
    triplet:   { spb: 3, label: 'Triplets' },
    sixteenth: { spb: 4, label: '16ths' },
  };
}

// Pick a valid subdivision for the meter (falls back to the first offered).
export function resolveSubdivision(meterKey, sub) {
  const info = subdivisionInfo(meterKey);
  if (info[sub]) return sub;
  return SUBDIVISIONS.find(s => info[s]);
}

// Build a one-bar click pattern. Voices: 'accent' (beat 1), 'click' (other
// beats) and 'sub' (subdivisions, with its own volume).
export function metronomeSequence({ meter = '4/4', subdivision = 'quarter', accent = true } = {}) {
  const m = METERS[meter] || METERS['4/4'];
  const sub = resolveSubdivision(meter, subdivision);
  const spb = subdivisionInfo(meter)[sub].spb;
  const len = m.beats * spb;
  const tracks = {
    accent: new Array(len).fill(OFF),
    click: new Array(len).fill(OFF),
    sub: new Array(len).fill(OFF),
  };
  // Beats that start a group in 7/8 (2+2+3) are clicked normally; the
  // in-between eighths are clicked softer so the grouping is audible.
  const groupStarts = new Set();
  if (m.groups) {
    let b = 0;
    for (const g of m.groups) { groupStarts.add(b); b += g; }
  }
  for (let beat = 0; beat < m.beats; beat++) {
    const i = beat * spb;
    if (beat === 0 && accent) tracks.accent[i] = ACCENT;
    else if (m.groups && !groupStarts.has(beat)) tracks.click[i] = GHOST;
    else tracks.click[i] = HIT;
    for (let s = 1; s < spb; s++) tracks.sub[i + s] = HIT;
  }
  return { spb, beatsPerBar: m.beats, bars: 1, tracks };
}

// ---------------------------------------------------------------------------
// Pattern library (saved user patterns) and JSON import/export.

export const EXPORT_FORMAT = 'groove-trainer-patterns';

export function exportPatterns(patterns) {
  return JSON.stringify({
    format: EXPORT_FORMAT,
    version: 1,
    exported: new Date().toISOString(),
    patterns: patterns.map(p => ({ ...p, tracks: Object.fromEntries(
      KIT_IDS.map(id => [id, trackToString(p.tracks[id])])) })),
  }, null, 2);
}

// Accepts our export format, a bare array of patterns, or a single pattern.
// Returns normalised patterns. IDs that clash with `existingIds` are replaced
// so an import never overwrites a saved pattern.
export function importPatterns(text, existingIds = new Set()) {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('File is not valid JSON'); }
  let list;
  if (Array.isArray(data)) list = data;
  else if (data && Array.isArray(data.patterns)) list = data.patterns;
  else if (data && data.tracks) list = [data];
  else throw new Error('No patterns found in file');
  const seen = new Set(existingIds);
  const out = [];
  for (const raw of list) {
    const p = normalizePattern(raw);
    if (seen.has(p.id)) p.id = newId();
    seen.add(p.id);
    out.push(p);
  }
  if (!out.length) throw new Error('No patterns found in file');
  return out;
}

// Saved patterns live in localStorage under one key, as an array.
export class PatternLibrary {
  constructor(key = 'patterns') {
    this.key = key;
    this.patterns = [];
    const raw = store.load(key, []);
    if (Array.isArray(raw)) {
      for (const p of raw) {
        try { this.patterns.push(normalizePattern(p)); } catch (e) { /* skip corrupt entry */ }
      }
    }
  }
  persist() { return store.save(this.key, this.patterns); }
  get(id) { return this.patterns.find(p => p.id === id) || null; }
  ids() { return new Set(this.patterns.map(p => p.id)); }

  // Insert or replace (by id). Stores a copy so later edits to the working
  // pattern don't silently change the saved one.
  put(pattern) {
    const copy = clonePattern(pattern);
    const i = this.patterns.findIndex(p => p.id === copy.id);
    if (i >= 0) this.patterns[i] = copy; else this.patterns.push(copy);
    this.persist();
    return copy;
  }
  rename(id, name) {
    const p = this.get(id);
    if (!p) return null;
    p.name = String(name).slice(0, 60);
    this.persist();
    return p;
  }
  duplicate(id) {
    const p = this.get(id);
    if (!p) return null;
    const copy = clonePattern(p);
    copy.id = newId();
    copy.name = (p.name + ' copy').slice(0, 60);
    this.patterns.push(copy);
    this.persist();
    return copy;
  }
  delete(id) {
    const before = this.patterns.length;
    this.patterns = this.patterns.filter(p => p.id !== id);
    this.persist();
    return this.patterns.length < before;
  }
  addMany(list) {
    for (const p of list) this.patterns.push(clonePattern(p));
    this.persist();
  }
}

// core.js — shared foundation for the UI modules.
//
//   S          the settings object (saved to localStorage, also the live
//              config the sequencer reads: bpm, swing, trainer, gap, ...)
//   engine     the audio engine
//   bus        tiny event bus so modules can react to each other without
//              importing each other. Events:
//                'step'     (ev)   a scheduled step reached the speakers
//                'play' / 'stop'
//                'sequence' (seq)  the playing source or its pattern changed
//                'tempo'           BPM / trainer settings changed
//                'mix'             a mixer level or mute changed
//   sources    what the play button can play (metronome, groove, builder,
//              and later features). registerSource() adds one.
//   panels     the tabs. registerPanel() adds one; the tab bar is built
//              from the registry, in registration order.

import * as store from '../storage.js';
import { Engine } from '../engine.js';
import { METERS, resolveSubdivision, KIT_VOICES } from '../patterns.js';
import { GROOVES } from '../grooves.js';
import { clickLayer } from '../sequencer.js';

export const $ = id => document.getElementById(id);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ===================================================================== state

const mixDefaults = {};
for (const v of KIT_VOICES) mixDefaults[v.id] = { vol: v.vol, mute: false };
mixDefaults.grooveClick = { vol: 0.6, mute: true };
mixDefaults.bass = { vol: 0.8, mute: false };   // backing band
mixDefaults.keys = { vol: 0.6, mute: false };

const DEFAULTS = {
  bpm: 100, swing: 0, swingRes: 8,
  meter: '4/4', subdivision: 'quarter', accent: true,
  clickVol: 0.8, subVol: 0.45,
  trainer: { enabled: false, start: 80, target: 120, step: 5, every: 4 },
  gap: { enabled: false, play: 3, mute: 1, hideVisual: true },
  // Time-feel trainers (see feel.js and sequencer.js)
  clickMode: 'all', sparseBars: 4,
  dropout: { enabled: false, amount: 25, progressive: false, max: 75, every: 4, keepOne: true },
  feel: { offset: 0, kick: 0, snare: 0, hats: 0, ride: 0, perc: 0, humanize: 0 },
  // Timing feedback: input ('mic' | 'midi'), mic sensitivity, grid (points
  // per beat) and whether to record takes.
  feedback: { input: 'mic', sensitivity: 60, res: 4, record: false },
  // Backing band: key (pitch class name), progression ('auto' = the style's
  // own, a preset, or 'custom' -> customProgression), style ('auto' = from
  // the groove).
  band: { enabled: false, key: 'A', progression: 'auto', customProgression: 'i iv i v', style: 'auto' },
  mix: mixDefaults,
  master: 0.9, wakeLock: true,
  tab: 'metronome', source: 'metronome', grooveId: GROOVES[0].id, styleFilter: 'All',
  builderAllDrums: false,
};

// Deep-merge saved values over defaults, keeping only known keys of the
// right type (so an old or corrupt save can't break the app, and new
// settings added later get their defaults).
function merge(def, val) {
  if (def && typeof def === 'object') {
    const out = {};
    for (const k of Object.keys(def)) out[k] = merge(def[k], val && typeof val === 'object' ? val[k] : undefined);
    return out;
  }
  return typeof val === typeof def && (typeof val !== 'number' || Number.isFinite(val)) ? val : def;
}

export const S = merge(DEFAULTS, store.load('settings', {}));
if (!METERS[S.meter]) S.meter = '4/4';
S.subdivision = resolveSubdivision(S.meter, S.subdivision);
if (!GROOVES.some(g => g.id === S.grooveId)) S.grooveId = GROOVES[0].id;
S.bpm = clamp(Math.round(S.bpm), 30, 300);

let saveTimer = null;
export function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSettings, 250);
}
function flushSettings() {
  clearTimeout(saveTimer);
  saveTimer = null;
  store.save('settings', S);
}

// Other modules with debounced saves register a flush function here.
// Everything is written out when the page is hidden or closed (switching
// apps, closing the installed app, reloading).
const flushers = [flushSettings];
export function onFlush(fn) { flushers.push(fn); }
const flushAll = () => flushers.forEach(f => f());
window.addEventListener('pagehide', flushAll);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });

// ======================================================================= bus

const listeners = {};
export const bus = {
  on(event, fn) { (listeners[event] ||= []).push(fn); },
  emit(event, data) { (listeners[event] || []).forEach(fn => fn(data)); },
};

// ==================================================================== engine

export function getLevel(voice) {
  if (voice === 'accent' || voice === 'click') return S.clickVol;
  if (voice === 'sub') return S.subVol;
  const m = S.mix[voice];
  return m && !m.mute ? m.vol : 0;
}

export const engine = new Engine({
  config: S,
  getLevel,
  // Optional click under grooves/patterns (the "Click" mixer channel),
  // following the click mode of the time-feel trainer.
  clickFor: ev => (S.source !== 'metronome' && getLevel('grooveClick') > 0 ? clickLayer(S.clickMode, ev, S.sparseBars) : null),
  getFeel: () => S.feel,
  band: ev => (bandProvider ? bandProvider(ev) : null),
});

// The Band tab supplies the band's notes per step (set by js/ui/band.js).
let bandProvider = null;
export function setBandProvider(fn) { bandProvider = fn; }
engine.setMasterVolume(S.master);

// =================================================================== sources

// id -> { sequence(): seq, describe(): html string for "now playing" }
const sources = {};
export function registerSource(id, def) { sources[id] = def; }

let activeSeq = null;
export const getActiveSeq = () => activeSeq;

// Rebuild the sequence for the current source and hand it to the engine.
// While playing, the engine switches at the next bar line.
export function refreshSequence(immediate = false) {
  const src = sources[S.source] || sources.metronome;
  activeSeq = src.sequence();
  engine.setSequence(activeSeq, immediate);
  bus.emit('sequence', activeSeq);
}

export function setSource(id) {
  if (S.source === id || !sources[id]) return;
  S.source = id;
  saveSettings();
  refreshSequence();
}

export function describeSource() {
  const src = sources[S.source] || sources.metronome;
  return src.describe();
}

// ==================================================================== panels

// def: { id, label, source?: source id this tab plays, onShow?: fn }
const panels = [];
export function registerPanel(def) {
  panels.push(def);
  const nav = $('tabs');
  const b = document.createElement('button');
  b.setAttribute('role', 'tab');
  b.dataset.tab = def.id;
  b.dataset.source = def.source || '';
  b.textContent = def.label;
  b.addEventListener('click', () => showTab(def.id));
  nav.appendChild(b);
}

export function showTab(id) {
  const def = panels.find(p => p.id === id) || panels[0];
  S.tab = def.id;
  document.querySelectorAll('#tabs button').forEach(b => {
    const on = b.dataset.tab === def.id;
    b.setAttribute('aria-selected', String(on));
    // Keep the selected tab visible when the tab bar scrolls sideways.
    if (on) b.parentNode.scrollTo({ left: b.offsetLeft - (b.parentNode.clientWidth - b.offsetWidth) / 2 });
  });
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + def.id));
  if (def.source) setSource(def.source);
  if (def.onShow) def.onShow();
  saveSettings();
}

// Mark which tab is currently feeding the play button.
bus.on('sequence', () => {
  document.querySelectorAll('#tabs button').forEach(b => {
    b.classList.toggle('source', b.dataset.source === S.source);
  });
});

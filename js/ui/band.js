// band.js (UI) — the Band tab: backing band on/off, key, chord progression
// and style, plus the live chord readout in the transport.

import { $, S, saveSettings, bus, setBandProvider } from './core.js';
import { setSeg, segHandler, setToggle } from './widgets.js';
import { renderMixers } from './mixer.js';
import { currentGroove } from './grooves.js';
import { GROOVES } from '../grooves.js';
import { NOTE_NAMES, PROGRESSIONS, BAND_STYLES, parseProgression, styleForGroove, bandNotes, chordAt } from '../band.js';

export const panel = { id: 'band', label: 'Band' }; // doesn't change the source

// Style in use: the chosen one, or the one that suits the current groove.
function activeStyle() {
  if (S.band.style !== 'auto' && BAND_STYLES[S.band.style]) return S.band.style;
  return S.source === 'groove' ? styleForGroove(currentGroove()) : 'rock';
}

function progressionText(style) {
  if (S.band.progression === 'custom') return S.band.customProgression;
  if (S.band.progression === 'auto') return BAND_STYLES[style].progression;
  return S.band.progression;
}

// Parsed chords are cached until a setting changes.
let cacheKey = '', chords = [];
function currentChords() {
  const style = activeStyle();
  const key = `${S.band.key}|${progressionText(style)}`;
  if (key !== cacheKey) {
    cacheKey = key;
    chords = parseProgression(progressionText(style), Math.max(0, NOTE_NAMES.indexOf(S.band.key)));
  }
  return chords;
}

const bandActive = () => S.band.enabled && S.source !== 'metronome';

setBandProvider(ev => (bandActive() ? bandNotes(ev, activeStyle(), currentChords()) : null));

// ----------------------------------------------------------------- display

function chordHtml(bar) {
  const c = currentChords();
  const now = chordAt(c, bar).name;
  const next = c.length > 1 ? chordAt(c, bar + 1).name : '';
  return `${now}${next ? `<span class="next">next: ${next}</span>` : ''}`;
}

function renderChordNow(bar = 0) {
  const show = bandActive();
  $('chordNow').hidden = !show;
  if (show) $('chordNow').innerHTML = chordHtml(bar);
  $('bandChord').innerHTML = S.band.enabled ? chordHtml(bar) : '';
}

// Update the chord readout at each bar line.
bus.on('step', ev => { if (ev.beat === 0 && ev.stepInBeat === 0 && !ev.countIn) renderChordNow(ev.barCount); });
bus.on('stop', () => renderChordNow(0));
bus.on('sequence', () => renderChordNow(0));

export function renderBand() {
  setToggle($('bandToggle'), S.band.enabled);
  const keys = $('bandKey');
  if (!keys.children.length) keys.innerHTML = NOTE_NAMES.map(n => `<button data-value="${n}">${n}</button>`).join('');
  setSeg(keys, S.band.key);
  const prog = $('bandProgression');
  if (!prog.options.length) {
    prog.innerHTML = `<option value="auto">Style's own chords</option>` +
      Object.entries(PROGRESSIONS).map(([v, label]) => `<option value="${v}">${label}</option>`).join('') +
      `<option value="custom">Your own chords…</option>`;
  }
  prog.value = S.band.progression;
  $('bandCustomRow').hidden = S.band.progression !== 'custom';
  $('bandCustom').value = S.band.customProgression;
  const style = $('bandStyle');
  if (!style.options.length) {
    style.innerHTML = `<option value="auto">Match the groove</option>` +
      Object.entries(BAND_STYLES).map(([v, s]) => `<option value="${v}">${s.label}</option>`).join('');
  }
  style.value = S.band.style;
  if (S.band.style === 'auto') {
    style.options[0].textContent = `Match the groove (${BAND_STYLES[activeStyle()].label})`;
  }
  renderChordNow(0);
}

function changed() {
  cacheKey = '';
  saveSettings();
  renderBand();
}

$('bandToggle').addEventListener('click', () => { S.band.enabled = !S.band.enabled; changed(); renderMixers(); });
segHandler($('bandKey'), v => { S.band.key = v; changed(); });
$('bandProgression').addEventListener('change', e => { S.band.progression = e.target.value; changed(); });
$('bandCustom').addEventListener('input', e => { S.band.customProgression = e.target.value; cacheKey = ''; saveSettings(); renderChordNow(0); });
$('bandStyle').addEventListener('change', e => { S.band.style = e.target.value; changed(); });
bus.on('sequence', () => { if (S.band.style === 'auto') renderBand(); });

// Kept for tests/debugging: which style each groove gets.
export const grooveStyles = () => Object.fromEntries(GROOVES.map(g => [g.id, styleForGroove(g)]));

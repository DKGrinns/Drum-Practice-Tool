// items.js — "what to play" for routine blocks and set-list songs: the
// metronome, a library groove or a saved pattern, at a tempo.
//
//   applyItem(item)        make it what PLAY plays (source, tempo, feel)
//   currentItem()          the item for what is selected now
//   itemLabel(item)        "One Drop · 72 BPM"
//   itemEditor(item, fn)   form fields to choose an item (edits it in place)
//
// Saved patterns play through their own source ('saved'), so a routine or
// set list never overwrites what is open in the builder.

import { S, clamp, saveSettings, registerSource, refreshSequence, bus } from './core.js';
import { renderBpm, renderSwing } from './transport.js';
import { library, currentDraft } from './builder.js';
import { renderGrooves } from './grooves.js';
import { renderMetronome } from './metronome.js';
import { GROOVES, FAMILIES, grooveToPattern } from '../grooves.js';
import { METERS, SUBDIVISIONS, subdivisionInfo, resolveSubdivision, toSequence, metronomeSequence, isTriplet } from '../patterns.js';
import { normalizeItem } from '../practice.js';

const savedPattern = () => library.get(S.savedPatternId);

registerSource('saved', {
  sequence: () => { const p = savedPattern(); return p ? toSequence(p) : metronomeSequence(S); },
  describe: () => {
    const p = savedPattern();
    const b = document.createElement('b');
    b.textContent = p ? p.name : 'Missing pattern';
    return `Pattern · ${b.outerHTML}`;
  },
});

const groove = id => GROOVES.find(g => g.id === id);

// Default tempo of an item when its bpm is null.
export function itemTempo(it) {
  if (it.bpm) return it.bpm;
  if (it.kind === 'groove') return (groove(it.grooveId) || GROOVES[0]).bpm;
  if (it.kind === 'pattern') { const p = library.get(it.patternId); return p ? p.bpm : 100; }
  return 100;
}

export function itemName(it) {
  if (it.kind === 'groove') { const g = groove(it.grooveId); return g ? g.name : 'Unknown groove'; }
  if (it.kind === 'pattern') { const p = library.get(it.patternId); return p ? p.name : 'Missing pattern'; }
  const sub = subdivisionInfo(it.meter)[resolveSubdivision(it.meter, it.subdivision)];
  return `Metronome ${it.meter}${sub && sub.spb > 1 ? ' ' + sub.label : ''}`;
}

export const itemLabel = it => `${itemName(it)} · ${itemTempo(it)} BPM`;

// Make `it` what PLAY plays. Returns false if a saved pattern is missing
// (then the metronome is used).
export function applyItem(it) {
  it = normalizeItem(it);
  let ok = true;
  const feel = p => { S.swing = p.swing || 0; if (!isTriplet(p)) S.swingRes = p.swingRes || 8; };
  if (it.kind === 'groove') {
    const g = groove(it.grooveId) || GROOVES[0];
    S.grooveId = g.id;
    feel(grooveToPattern(g));
    S.source = 'groove';
  } else if (it.kind === 'pattern' && library.get(it.patternId)) {
    S.savedPatternId = it.patternId;
    feel(library.get(it.patternId));
    S.source = 'saved';
  } else {
    if (it.kind === 'pattern') ok = false;
    S.meter = METERS[it.meter] ? it.meter : '4/4';
    S.subdivision = resolveSubdivision(S.meter, it.subdivision);
    S.source = 'metronome';
    S.swing = 0;
  }
  S.bpm = clamp(itemTempo(it), 30, 300);
  saveSettings();
  refreshSequence();
  renderGrooves();
  renderMetronome();
  renderBpm();
  renderSwing();
  bus.emit('tempo');
  return ok;
}

// What is selected right now, as an item (for "add current settings").
export function currentItem() {
  if (S.source === 'groove') return normalizeItem({ kind: 'groove', grooveId: S.grooveId, bpm: S.bpm });
  if (S.source === 'saved') return normalizeItem({ kind: 'pattern', patternId: S.savedPatternId, bpm: S.bpm });
  if (S.source === 'builder') {
    const d = currentDraft();
    if (library.get(d.id)) return normalizeItem({ kind: 'pattern', patternId: d.id, bpm: S.bpm });
  }
  return normalizeItem({ kind: 'metronome', meter: S.meter, subdivision: S.subdivision, bpm: S.bpm });
}

// Key for the practice log: what is playing now (the builder's draft counts
// as a pattern even if it was never saved).
export function playingKey() {
  if (S.source === 'builder') return 'pattern:' + currentDraft().id;
  const it = currentItem();
  return it.kind === 'groove' ? 'groove:' + it.grooveId : it.kind === 'pattern' ? 'pattern:' + it.patternId : 'metronome:' + it.meter;
}

// ------------------------------------------------------------------ editor

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function grooveOptions(sel) {
  return FAMILIES.map(f => `<optgroup label="${esc(f)}">${GROOVES.filter(g => g.style === f)
    .map(g => `<option value="${g.id}"${g.id === sel ? ' selected' : ''}>${esc(g.name)} (${g.bpm})</option>`).join('')}</optgroup>`).join('');
}

// Form fields for choosing an item. Edits `it` in place and calls
// onChange() after every change.
export function itemEditor(it, onChange = () => {}) {
  const box = document.createElement('div');
  box.className = 'item-editor';
  const patterns = [...library.patterns].sort((a, b) => a.name.localeCompare(b.name));
  box.innerHTML = `
    <label class="field"><span>Play</span><select data-f="kind">
      <option value="groove">A groove</option>
      <option value="pattern"${patterns.length ? '' : ' disabled'}>My pattern${patterns.length ? '' : ' (none saved yet)'}</option>
      <option value="metronome">Metronome</option></select></label>
    <label class="field" data-show="groove"><span>Groove</span><select data-f="grooveId">${grooveOptions(it.grooveId)}</select></label>
    <label class="field" data-show="pattern"><span>Pattern</span><select data-f="patternId">${patterns.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
    <label class="field" data-show="metronome"><span>Time</span><select data-f="meter">${Object.keys(METERS).map(m => `<option>${m}</option>`).join('')}</select></label>
    <label class="field" data-show="metronome"><span>Clicks</span><select data-f="subdivision"></select></label>
    <label class="field"><span>BPM</span><input type="number" data-f="bpm" min="30" max="300" inputmode="numeric"></label>`;
  const f = name => box.querySelector(`[data-f="${name}"]`);
  const sync = () => {
    f('kind').value = it.kind;
    if (it.kind === 'groove' && !groove(it.grooveId)) it.grooveId = GROOVES[0].id;
    if (it.kind === 'pattern' && !library.get(it.patternId) && patterns.length) it.patternId = patterns[0].id;
    f('grooveId').value = it.grooveId;
    f('patternId').value = it.patternId;
    f('meter').value = METERS[it.meter] ? it.meter : '4/4';
    const info = subdivisionInfo(f('meter').value);
    f('subdivision').innerHTML = SUBDIVISIONS.filter(s => info[s]).map(s => `<option value="${s}">${info[s].label}</option>`).join('');
    it.subdivision = resolveSubdivision(f('meter').value, it.subdivision);
    f('subdivision').value = it.subdivision;
    f('bpm').value = itemTempo(it);
    box.querySelectorAll('[data-show]').forEach(el => { el.hidden = el.dataset.show !== it.kind; });
  };
  box.addEventListener('change', e => {
    const k = e.target.dataset.f;
    if (!k) return;
    const v = e.target.value;
    if (k === 'bpm') it.bpm = clamp(Math.round(Number(v)) || itemTempo(it), 30, 300);
    else {
      it[k] = v;
      // A new groove or pattern brings its own tempo.
      if (k === 'kind' || k === 'grooveId' || k === 'patternId') it.bpm = null;
      if (k === 'kind' && v === 'metronome') it.bpm = 100;
    }
    sync();
    onChange();
  });
  sync();
  return box;
}

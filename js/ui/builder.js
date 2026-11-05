// builder.js — the pattern builder tab: step grid, saved patterns,
// export/import.
//
// The pattern being edited ("draft") is autosaved, so it survives reloads
// even if never saved to the library. `dirty` = has unsaved changes.

import * as store from '../storage.js';
import { $, S, saveSettings, engine, bus, onFlush, registerSource, refreshSequence, showTab } from './core.js';
import { setSeg, segHandler, toast, ask, download, slug } from './widgets.js';
import { applyFeel } from './transport.js';
import { VELOCITY } from '../sequencer.js';
import {
  KIT_VOICES, PATTERN_METERS, meterOf, beatsOf, stepsPerBeat, isTriplet, toSequence, blankPattern,
  clonePattern, normalizePattern, setBars, setResolution, setMeter,
  PatternLibrary, exportPatterns, importPatterns, newId,
} from '../patterns.js';

export const library = new PatternLibrary();
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
onFlush(flushDraft);

registerSource('builder', {
  sequence: () => toSequence(draft),
  describe: () => {
    const b = document.createElement('b');
    b.textContent = draft.name;
    return `Pattern · ${b.outerHTML}`;
  },
});
export const panel = { id: 'builder', label: 'Builder', source: 'builder', onShow: () => renderGrid() };
export const currentDraft = () => draft;

function markDirty() {
  dirty = true;
  $('dirtyMark').classList.add('show');
  saveDraft();
}

export function renderBuilder() {
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
  setSeg($('meterSegB'), draft.meter);
  $('resSeg').querySelector('[data-value="triplet"]').disabled = !meterOf(draft).triplet;
  setSeg($('resSeg'), isTriplet(draft) ? 'triplet' : 'straight');
  setSeg($('barsSeg'), String(draft.bars));
  $('allDrums').setAttribute('aria-pressed', String(S.builderAllDrums));
  renderGrid();
  // Rename/load/resize: refresh what's playing (applied at the next bar).
  if (S.source === 'builder') refreshSequence();
}

// ====================================================================== grid

// Which rows to show: the core kit always, plus any other drum the
// pattern uses, or every drum when "All drums" is on.
function visibleVoices() {
  return KIT_VOICES.filter(v => v.group === 'kit' || S.builderAllDrums || draft.tracks[v.id].some(x => x));
}

// Grid layout: the whole pattern on one row if it fits, else one bar per
// block, and if a bar is too wide for the screen it is split into rows of
// whole beats. Cells stay at least 32px wide (finger-sized) and the page
// never scrolls sideways.
let colCells = [];
let lastLayout = '';
function layout() {
  const width = $('grid').clientWidth || window.innerWidth - 60;
  const labelW = width < 500 ? 52 : 100;
  const fit = Math.max(1, Math.floor((width - labelW) / 32)); // cells per row
  const spb = stepsPerBeat(draft);
  const beats = beatsOf(draft);
  const total = draft.stepsPerBar * draft.bars;
  let cols, segments = [];
  if (total <= fit) {
    cols = total;
    segments = [[0, total]];
  } else {
    // Beats per row: as many as fit, spread evenly over the rows.
    const maxBeats = Math.max(1, Math.min(beats, Math.floor(fit / spb)));
    const rows = Math.ceil(beats / maxBeats);
    const rowBeats = Math.ceil(beats / rows);
    cols = rowBeats * spb;
    for (let bar = 0; bar < draft.bars; bar++) {
      for (let b = 0; b < beats; b += rowBeats) {
        const start = bar * draft.stepsPerBar + b * spb;
        segments.push([start, Math.min(rowBeats, beats - b) * spb]);
      }
    }
  }
  return { cols, segments, labelW, key: `${cols}:${labelW}:${total}` };
}

export function renderGrid() {
  const grid = $('grid');
  if (!grid.offsetParent && grid.children.length) return; // hidden; render on show
  const { cols, segments, labelW, key } = layout();
  lastLayout = key;
  const narrow = labelW < 60;
  const spb = stepsPerBeat(draft);
  const beats = beatsOf(draft);
  const total = draft.stepsPerBar * draft.bars;
  const subLabels = spb === 4 ? ['', 'e', '&', 'a'] : spb === 3 ? ['', 'tri', 'let'] : ['', '&'];
  const voices = visibleVoices();
  colCells = Array.from({ length: total }, () => []);
  const frag = document.createDocumentFragment();
  for (const [start, len] of segments) {
    const block = document.createElement('div');
    block.className = 'grid-block';
    block.style.gridTemplateColumns = `${labelW}px repeat(${cols}, minmax(0, 1fr))`;
    const bar = Math.floor(start / draft.stepsPerBar);
    const corner = document.createElement('div');
    corner.className = 'grid-head bar';
    corner.textContent = start % draft.stepsPerBar === 0 ? `Bar ${bar + 1}` : '';
    block.appendChild(corner);
    for (let i = start; i < start + len; i++) {
      const h = document.createElement('div');
      const pos = i % spb;
      h.className = 'grid-head' + (pos === 0 ? ' beat' : '');
      h.textContent = pos === 0 ? (Math.floor(i / spb) % beats) + 1 : subLabels[pos];
      block.appendChild(h);
      colCells[i].push(h);
    }
    voices.forEach((v, row) => {
      const firstPerc = v.group !== 'kit' && (row === 0 || voices[row - 1].group === 'kit');
      const label = document.createElement('div');
      label.className = 'grid-label' + (firstPerc ? ' sep' : '');
      label.style.gridColumn = '1'; // always starts a new row, even if the last row was short
      label.dataset.voice = v.id;
      label.textContent = narrow ? v.short : v.label;
      label.title = v.label;
      block.appendChild(label);
      for (let i = start; i < start + len; i++) {
        const c = document.createElement('button');
        c.className = `cell v${draft.tracks[v.id][i]}` + (i % spb === 0 ? ' beat-start' : '') + (firstPerc ? ' sep' : '');
        c.dataset.voice = v.id;
        c.dataset.i = i;
        c.setAttribute('aria-label', `${v.label}, bar ${Math.floor(i / draft.stepsPerBar) + 1}, step ${(i % draft.stepsPerBar) + 1}`);
        block.appendChild(c);
        colCells[i].push(c);
      }
    });
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
bus.on('step', ev => { if (S.source === 'builder') setPlayhead(ev.index); });
bus.on('stop', () => setPlayhead(-1));

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (S.tab === 'builder' && layout().key !== lastLayout) renderGrid(); }, 150);
});

$('allDrums').addEventListener('click', () => {
  S.builderAllDrums = !S.builderAllDrums;
  saveSettings();
  $('allDrums').setAttribute('aria-pressed', String(S.builderAllDrums));
  renderGrid();
});

// Structural changes (grid/bars) replace the track arrays, so hand the
// engine a fresh sequence (applied at the next bar line).
function structureChanged() {
  markDirty();
  renderBuilder();
}
segHandler($('resSeg'), v => {
  const m = meterOf(draft);
  setResolution(draft, v === 'triplet' ? m.triplet : m.straight);
  structureChanged();
});
segHandler($('meterSegB'), v => { setMeter(draft, v); structureChanged(); });
segHandler($('barsSeg'), v => { setBars(draft, Number(v)); structureChanged(); });
$('pClear').addEventListener('click', async () => {
  if (!(await ask('Clear every note in this pattern?'))) return;
  for (const id in draft.tracks) draft.tracks[id].fill(0);
  markDirty();
  renderGrid();
});

// ================================================================= library

async function confirmDiscard() {
  return !dirty || !!(await ask(`Discard unsaved changes to "${draft.name}"?`));
}

function loadIntoBuilder(p, isDirty = false) {
  draft = clonePattern(p);
  dirty = isDirty;
  saveDraft();
  renderBuilder();
}

// Open any pattern (e.g. a library groove) as a new unsaved draft.
export async function openInBuilder(pattern, name) {
  if (dirty && !(await ask(`Replace the unsaved pattern "${draft.name}" in the builder?`))) return false;
  const p = clonePattern(pattern);
  p.id = newId();
  p.name = name || p.name;
  loadIntoBuilder(p, true);
  showTab('builder');
  toast(`"${p.name}" opened in the builder`);
  return true;
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
  draft.bpm = S.trainer.enabled ? S.trainer.start : S.bpm;
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

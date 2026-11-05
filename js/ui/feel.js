// feel.js (UI) — the Feel tab: click modes, click dropout, push/pull and
// humanize. The rules themselves live in ../sequencer.js and ../feel.js.

import { $, clamp, S, saveSettings, bus, refreshSequence } from './core.js';
import { setSeg, segHandler, setToggle, holdRepeat } from './widgets.js';
import { renderMixers } from './mixer.js';
import { FEEL_PRESETS, MAX_OFFSET_MS } from '../feel.js';

export const panel = { id: 'feel', label: 'Feel' }; // doesn't change the source

const DRUMS = [['kick', 'Kick'], ['snare', 'Snare & rim'], ['hats', 'Hi-hats'], ['ride', 'Ride'], ['perc', 'Toms & percussion']];

function offsetLabel(ms) {
  if (!ms) return 'on the grid';
  return ms > 0 ? `${ms} ms behind` : `${-ms} ms ahead`;
}

export function renderFeel() {
  // Click
  setSeg($('clickModeSeg'), S.clickMode);
  $('sparseRow').hidden = S.clickMode !== 'sparse';
  $('sparseVal').textContent = S.sparseBars;
  setToggle($('grooveClickToggle'), !S.mix.grooveClick.mute);
  // Dropout
  const d = S.dropout;
  setToggle($('dropToggle'), d.enabled);
  $('dropAmount').value = d.amount;
  $('dropAmountVal').textContent = d.amount + '%';
  setToggle($('dropKeepOne'), d.keepOne);
  setToggle($('dropProgressive'), d.progressive);
  $('dropProgressiveOpts').hidden = !d.progressive;
  $('dropEveryVal').textContent = d.every;
  $('dropEveryVal2').textContent = d.every;
  $('dropMax').value = d.max;
  $('dropMaxVal').textContent = d.max + '%';
  // Push / pull
  const f = S.feel;
  $('feelOffset').value = f.offset;
  $('feelOffsetVal').textContent = offsetLabel(f.offset);
  const box = $('drumOffsets');
  if (!box.children.length) {
    box.innerHTML = DRUMS.map(([k, label]) => `
      <label class="slider-row"><span>${label} <b data-out="${k}"></b></span>
        <input type="range" class="slider" data-drum="${k}" min="${-MAX_OFFSET_MS}" max="${MAX_OFFSET_MS}" step="1"></label>`).join('');
  }
  for (const [k] of DRUMS) {
    box.querySelector(`[data-drum="${k}"]`).value = f[k];
    box.querySelector(`[data-out="${k}"]`).textContent = offsetLabel(f[k]);
  }
  const presets = $('feelPresets');
  if (!presets.children.length) {
    presets.innerHTML = Object.keys(FEEL_PRESETS).map(n => `<button data-preset="${n}">${n}</button>`).join('');
  }
  // Humanize
  $('humanize').value = f.humanize;
  $('humanizeVal').textContent = f.humanize + '%';
}

function changed({ rebuild = false } = {}) {
  renderFeel();
  saveSettings();
  bus.emit('tempo'); // refreshes the status line
  if (rebuild && S.source === 'metronome') refreshSequence();
}

// Click
segHandler($('clickModeSeg'), v => { S.clickMode = v; changed({ rebuild: true }); });
holdRepeat($('sparseDown'), () => { S.sparseBars = clamp(S.sparseBars - 1, 2, 16); changed({ rebuild: true }); });
holdRepeat($('sparseUp'), () => { S.sparseBars = clamp(S.sparseBars + 1, 2, 16); changed({ rebuild: true }); });
$('grooveClickToggle').addEventListener('click', () => {
  S.mix.grooveClick.mute = !S.mix.grooveClick.mute;
  if (!S.mix.grooveClick.mute && S.mix.grooveClick.vol === 0) S.mix.grooveClick.vol = 0.6;
  renderMixers();
  changed();
});

// Dropout
$('dropToggle').addEventListener('click', () => { S.dropout.enabled = !S.dropout.enabled; changed(); });
$('dropAmount').addEventListener('input', e => {
  S.dropout.amount = Number(e.target.value);
  if (S.dropout.max < S.dropout.amount) S.dropout.max = S.dropout.amount;
  changed();
});
$('dropKeepOne').addEventListener('click', () => { S.dropout.keepOne = !S.dropout.keepOne; changed(); });
$('dropProgressive').addEventListener('click', () => { S.dropout.progressive = !S.dropout.progressive; changed(); });
holdRepeat($('dropEveryDown'), () => { S.dropout.every = clamp(S.dropout.every - 1, 1, 32); changed(); });
holdRepeat($('dropEveryUp'), () => { S.dropout.every = clamp(S.dropout.every + 1, 1, 32); changed(); });
$('dropMax').addEventListener('input', e => { S.dropout.max = Math.max(Number(e.target.value), S.dropout.amount); changed(); });

// Push / pull
$('feelOffset').addEventListener('input', e => { S.feel.offset = Number(e.target.value); changed(); });
$('drumOffsets').addEventListener('input', e => {
  const k = e.target.dataset.drum;
  if (k) { S.feel[k] = Number(e.target.value); changed(); }
});
$('feelPresets').addEventListener('click', e => {
  const b = e.target.closest('[data-preset]');
  if (!b) return;
  Object.assign(S.feel, FEEL_PRESETS[b.dataset.preset]);
  changed();
});

// Keep the click toggle in step with the mixer's Click channel.
bus.on('mix', renderFeel);

// Humanize
$('humanize').addEventListener('input', e => { S.feel.humanize = Number(e.target.value); changed(); });

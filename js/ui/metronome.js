// metronome.js — the Metronome tab: time signature, subdivision, accent
// and click volumes.

import { $, S, saveSettings, registerSource, refreshSequence } from './core.js';
import { setSeg, segHandler, setToggle } from './widgets.js';
import { METERS, SUBDIVISIONS, subdivisionInfo, resolveSubdivision, metronomeSequence } from '../patterns.js';

registerSource('metronome', {
  sequence: () => metronomeSequence(S), // includes clickMode / sparseBars from the Trainer tab
  describe: () => {
    const sub = subdivisionInfo(S.meter)[S.subdivision];
    return `<b>Metronome</b> · ${S.meter} · ${sub ? sub.label : ''}`;
  },
});
export const panel = { id: 'metronome', label: 'Metronome', source: 'metronome' };

export function renderMetronome() {
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

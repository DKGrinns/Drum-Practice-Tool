// mixer.js — per-instrument volume/mute. Every element with [data-mixer]
// gets a copy; all copies stay in sync. The core kit is always shown;
// toms and percussion sit in a collapsible section.

import { S, saveSettings, bus } from './core.js';
import { KIT_VOICES } from '../patterns.js';

const row = v => `
  <div class="mix-row" data-voice="${v.id}">
    <span class="name">${v.label}</span>
    <button class="mute" aria-pressed="false">Mute</button>
    <input type="range" class="slider" min="0" max="100" aria-label="${v.label} volume">
  </div>`;

function build(box) {
  const core = KIT_VOICES.filter(v => v.group === 'kit');
  const perc = KIT_VOICES.filter(v => v.group !== 'kit');
  box.innerHTML = core.map(row).join('') + row({ id: 'grooveClick', label: 'Click' }) +
    row({ id: 'bass', label: 'Band: bass' }) + row({ id: 'keys', label: 'Band: chords' }) +
    `<details class="mix-more"><summary>Toms &amp; percussion</summary>${perc.map(row).join('')}</details>`;
}

export function renderMixers() {
  document.querySelectorAll('[data-mixer]').forEach(box => {
    if (!box.children.length) build(box);
    box.querySelectorAll('.mix-row').forEach(r => {
      const m = S.mix[r.dataset.voice];
      r.classList.toggle('muted', m.mute);
      r.querySelector('.mute').setAttribute('aria-pressed', String(m.mute));
      r.querySelector('.slider').value = Math.round(m.vol * 100);
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
    bus.emit('mix');
  });
  box.addEventListener('input', e => {
    const r = e.target.closest('.mix-row');
    if (!r) return;
    const m = S.mix[r.dataset.voice];
    m.vol = e.target.value / 100;
    if (m.mute && m.vol > 0) m.mute = false; // moving a muted fader un-mutes it
    renderMixers();
    saveSettings();
    bus.emit('mix');
  });
});

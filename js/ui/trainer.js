// trainer.js — the Trainer tab: tempo trainer, gap trainer and settings.

import { $, clamp, S, saveSettings, engine, bus } from './core.js';
import { setToggle, holdRepeat, toast } from './widgets.js';
import { updateWake } from './transport.js';

export const panel = { id: 'trainer', label: 'Trainer' }; // doesn't change the source

function renderSteppers() {
  document.querySelectorAll('.stepper').forEach(st => {
    const [group, key] = st.dataset.key.split('.');
    if (!st.children.length) {
      st.innerHTML = `<div class="lbl">${st.dataset.label}</div>
        <div class="ctl"><button aria-label="Less">−</button>
        <input type="number" inputmode="numeric" min="${st.dataset.min}" max="${st.dataset.max}" aria-label="${st.dataset.label}">
        <button aria-label="More">+</button></div>`;
      const [down, up] = st.querySelectorAll('button');
      const inp = st.querySelector('input');
      const set = v => {
        S[group][key] = clamp(Math.round(v) || Number(st.dataset.min), Number(st.dataset.min), Number(st.dataset.max));
        renderSteppers();
        saveSettings();
        bus.emit('tempo');
      };
      holdRepeat(down, () => set(S[group][key] - 1));
      holdRepeat(up, () => set(S[group][key] + 1));
      inp.addEventListener('change', () => set(Number(inp.value)));
    }
    const inp = st.querySelector('input');
    if (document.activeElement !== inp) inp.value = S[group][key];
  });
}
// The BPM controls edit the trainer's start tempo while the trainer is on.
bus.on('tempo', renderSteppers);

export function renderTrainer() {
  setToggle($('trainerToggle'), S.trainer.enabled);
  setToggle($('gapToggle'), S.gap.enabled);
  setToggle($('gapHideToggle'), S.gap.hideVisual);
  setToggle($('wakeToggle'), S.wakeLock);
  $('masterVol').value = Math.round(S.master * 100);
  renderSteppers();
}

$('trainerToggle').addEventListener('click', () => {
  S.trainer.enabled = !S.trainer.enabled;
  renderTrainer();
  saveSettings();
  bus.emit('tempo');
  if (engine.playing) toast('Trainer changes apply from the next bar — restart to begin from bar 1');
});
$('gapToggle').addEventListener('click', () => {
  S.gap.enabled = !S.gap.enabled;
  renderTrainer();
  saveSettings();
  bus.emit('tempo');
});
$('gapHideToggle').addEventListener('click', () => { S.gap.hideVisual = !S.gap.hideVisual; renderTrainer(); saveSettings(); });
$('wakeToggle').addEventListener('click', () => {
  S.wakeLock = !S.wakeLock;
  updateWake();
  renderTrainer();
  saveSettings();
});
$('masterVol').addEventListener('input', e => { S.master = e.target.value / 100; engine.setMasterVolume(S.master); saveSettings(); });

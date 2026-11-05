// widgets.js — small reusable UI helpers.

import { $ } from './core.js';

// Segmented buttons: aria-pressed marks the selected one.
export function setSeg(seg, value) {
  seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === value)));
}
export function segHandler(seg, fn) {
  seg.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b && !b.disabled && seg.contains(b)) fn(b.dataset.value);
  });
}
export function setToggle(btn, on) {
  btn.setAttribute('aria-pressed', String(on));
  btn.textContent = on ? 'On' : 'Off';
}

// Repeats `fn` while a button is held, speeding up.
export function holdRepeat(btn, fn) {
  let timer = null;
  const stop = () => { clearTimeout(timer); timer = null; };
  btn.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    fn();
    let delay = 420;
    const loop = () => { timer = setTimeout(() => { fn(); delay = Math.max(45, delay * 0.82); loop(); }, delay); };
    stop();
    loop();
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => btn.addEventListener(t, stop));
  btn.addEventListener('click', e => { if (e.detail === 0) fn(); }); // keyboard activation
}

let toastTimer = null;
export function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// Modal prompt/confirm using <dialog>, with a fallback for old browsers.
// Resolves to the entered text (prompt), true (confirm) or null (cancel).
export function ask(message, { input = null } = {}) {
  const dlg = $('dialog');
  if (typeof dlg.showModal !== 'function') {
    if (input == null) return Promise.resolve(window.confirm(message) ? true : null);
    const r = window.prompt(message, input);
    return Promise.resolve(r == null ? null : r.trim());
  }
  return new Promise(resolve => {
    $('dialogMsg').textContent = message;
    const inp = $('dialogInput');
    inp.hidden = input == null;
    inp.value = input || '';
    dlg.returnValue = '';
    dlg.addEventListener('close', () => {
      if (dlg.returnValue !== 'ok') resolve(null);
      else resolve(input == null ? true : inp.value.trim());
    }, { once: true });
    dlg.showModal();
    if (input != null) { inp.focus(); inp.select(); }
  });
}
$('dialogInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); $('dialog').close('ok'); }
});

// Save text as a file download.
export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'file';

// grooves.js (UI) — the Grooves tab: style filter, groove cards, and
// "Open in Builder".

import { $, S, saveSettings, engine, registerSource, refreshSequence } from './core.js';
import { setSeg, segHandler } from './widgets.js';
import { applyFeel, togglePlay } from './transport.js';
import { openInBuilder } from './builder.js';
import { GROOVES, STYLES, grooveToPattern } from '../grooves.js';
import { toSequence } from '../patterns.js';

export const currentGroove = () => GROOVES.find(g => g.id === S.grooveId) || GROOVES[0];

registerSource('groove', {
  sequence: () => toSequence(grooveToPattern(currentGroove())),
  describe: () => {
    const g = currentGroove();
    const b = document.createElement('b');
    b.textContent = g.name;
    return `${b.outerHTML} · ${g.style}`;
  },
});
export const panel = { id: 'grooves', label: 'Grooves', source: 'groove' };

export function renderGrooves() {
  const filter = $('styleFilter');
  if (!filter.children.length) {
    filter.innerHTML = ['All', ...STYLES].map(s => `<button data-value="${s}">${s}</button>`).join('');
  }
  setSeg(filter, S.styleFilter);
  const list = $('grooveList');
  list.innerHTML = '';
  for (const g of GROOVES) {
    if (S.styleFilter !== 'All' && g.style !== S.styleFilter) continue;
    const card = document.createElement('div');
    card.className = 'groove' + (g.id === S.grooveId ? ' selected' : '');
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.dataset.id = g.id;
    card.innerHTML = `
      <div class="g-head"><span class="g-name"></span><span class="g-meta">${g.bpm} BPM · ${g.steps === 12 ? 'triplet' : '16th'} grid</span></div>
      <div class="g-desc"><span class="g-style">${g.style}</span><span class="d"></span></div>`;
    card.querySelector('.g-name').textContent = g.name;
    card.querySelector('.d').textContent = g.desc;
    if (g.id === S.grooveId) {
      const actions = document.createElement('div');
      actions.className = 'groove-actions';
      actions.innerHTML = `<button data-act="play">▶ Play</button><button data-act="edit">Open in Builder</button>`;
      card.appendChild(actions);
    }
    list.appendChild(card);
  }
}

function selectGroove(id) {
  S.grooveId = id;
  applyFeel(grooveToPattern(currentGroove()));
  S.source = 'groove';
  saveSettings();
  refreshSequence();
  renderGrooves();
}

$('grooveList').addEventListener('click', async e => {
  const card = e.target.closest('.groove');
  if (!card) return;
  const act = e.target.closest('button[data-act]');
  if (act && act.dataset.act === 'edit') {
    const g = GROOVES.find(x => x.id === card.dataset.id);
    return openInBuilder(grooveToPattern(g), g.name);
  }
  if (act && act.dataset.act === 'play') {
    if (!engine.playing) await togglePlay();
    return;
  }
  selectGroove(card.dataset.id); // tapping again reloads the groove's tempo and feel
});
$('grooveList').addEventListener('keydown', e => {
  const card = e.target.closest('.groove');
  if (card && e.key === 'Enter' && e.target === card) selectGroove(card.dataset.id);
});
segHandler($('styleFilter'), v => { S.styleFilter = v; saveSettings(); renderGrooves(); });

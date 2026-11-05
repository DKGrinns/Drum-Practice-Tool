// grooves.js (UI) — the Grooves tab: style filter, groove cards, and
// "Open in Builder".

import { $, S, saveSettings, engine, registerSource, refreshSequence } from './core.js';
import { setSeg, segHandler } from './widgets.js';
import { applyFeel, togglePlay } from './transport.js';
import { openInBuilder } from './builder.js';
import { GROOVES, FAMILIES, grooveToPattern } from '../grooves.js';
import { toSequence, PATTERN_METERS } from '../patterns.js';

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

let query = '';

// Text searched by the search box: name, family, description and meter.
const haystack = g => `${g.name} ${g.style} ${g.desc} ${g.meter || ''}`.toLowerCase();

function gridLabel(g) {
  const m = PATTERN_METERS[g.meter || '4/4'];
  const triplet = g.steps === m.triplet;
  return `${g.meter && g.meter !== '4/4' ? g.meter + ' · ' : ''}${triplet ? 'triplet' : '16th'} grid`;
}

function card(g) {
  const el = document.createElement('div');
  el.className = 'groove' + (g.id === S.grooveId ? ' selected' : '');
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.dataset.id = g.id;
  el.innerHTML = `
    <div class="g-head"><span class="g-name"></span><span class="g-meta">${g.bpm} BPM · ${gridLabel(g)}</span></div>
    <div class="g-desc"><span class="g-style"></span><span class="d"></span></div>`;
  el.querySelector('.g-name').textContent = g.name;
  el.querySelector('.g-style').textContent = g.style;
  el.querySelector('.d').textContent = g.desc;
  if (g.id === S.grooveId) {
    const actions = document.createElement('div');
    actions.className = 'groove-actions';
    actions.innerHTML = `<button data-act="play">▶ Play</button><button data-act="edit">Open in Builder</button>`;
    el.appendChild(actions);
  }
  return el;
}

export function renderGrooves() {
  if (S.styleFilter !== 'All' && !FAMILIES.includes(S.styleFilter)) S.styleFilter = 'All';
  const filter = $('styleFilter');
  if (!filter.children.length) {
    filter.innerHTML = ['All', ...FAMILIES].map(f => {
      const n = f === 'All' ? GROOVES.length : GROOVES.filter(g => g.style === f).length;
      return `<button data-value="${f}">${f} <span class="count">${n}</span></button>`;
    }).join('');
  }
  setSeg(filter, S.styleFilter);
  const q = query.trim().toLowerCase();
  const shown = GROOVES.filter(g => (S.styleFilter === 'All' || g.style === S.styleFilter) && (!q || q.split(/\s+/).every(w => haystack(g).includes(w))));
  const list = $('grooveList');
  list.innerHTML = '';
  if (!shown.length) {
    list.innerHTML = '<p class="hint">No grooves match. Try another word or pick "All".</p>';
    return;
  }
  // Group by family, in family order.
  for (const fam of FAMILIES) {
    const group = shown.filter(g => g.style === fam);
    if (!group.length) continue;
    if (S.styleFilter === 'All') {
      const h = document.createElement('h3');
      h.className = 'g-family';
      h.textContent = `${fam} (${group.length})`;
      list.appendChild(h);
    }
    for (const g of group) list.appendChild(card(g));
  }
}

$('grooveSearch').addEventListener('input', e => { query = e.target.value; renderGrooves(); });

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

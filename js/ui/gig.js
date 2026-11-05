// gig.js — the Gig tab: set lists of songs (what to play, tempo, key,
// notes, song form), a stage view with previous/next song, keyboard keys
// for a Bluetooth page-turner pedal, and a song-form map that follows the
// bars while playing.

import * as store from '../storage.js';
import { $, S, saveSettings, engine, bus, onFlush } from './core.js';
import { toast, ask, download } from './widgets.js';
import { renderTrainer } from './trainer.js';
import { renderBand } from './band.js';
import { isTyping } from './keyboard.js';
import { applyItem, itemLabel, itemEditor, currentItem } from './items.js';
import { NOTE_NAMES } from '../band.js';
import * as P from '../practice.js';

export const panel = { id: 'gig', label: 'Gig', onShow: () => renderGig() };

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// =================================================================== storage

export const DEFAULT_KEYS = { next: ['PageDown', 'ArrowRight'], prev: ['PageUp', 'ArrowLeft'] };

let lists = [];
let prefs = {};
function load() {
  const raw = store.load('setlists', []);
  lists = Array.isArray(raw) ? raw.map(P.normalizeSetlist) : [];
  prefs = store.load('gigPrefs', {}) || {};
  if (!lists.some(l => l.id === prefs.listId)) prefs.listId = lists[0] ? lists[0].id : null;
  prefs.index = Number.isInteger(prefs.index) ? prefs.index : 0;
  const k = prefs.keys || {};
  prefs.keys = {
    next: Array.isArray(k.next) && k.next.length ? k.next.map(String).slice(0, 4) : DEFAULT_KEYS.next,
    prev: Array.isArray(k.prev) && k.prev.length ? k.prev.map(String).slice(0, 4) : DEFAULT_KEYS.prev,
  };
}
load();
bus.on('setlists', () => { load(); renderGig(); });

let saveTimer = null;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 250); }
function flush() { clearTimeout(saveTimer); saveTimer = null; store.save('setlists', lists); store.save('gigPrefs', prefs); }
onFlush(flush);

const list = () => lists.find(l => l.id === prefs.listId) || null;
const song = () => { const l = list(); return l && l.songs[prefs.index] || null; };

// ===================================================================== songs

// Make song i the current one: what PLAY plays, its tempo and key. The
// tempo trainer is turned off (a song has one tempo). While playing, the
// change happens at the next bar line.
export function loadSong(i) {
  const l = list();
  if (!l || !l.songs.length) return;
  prefs.index = Math.max(0, Math.min(l.songs.length - 1, i));
  const s = l.songs[prefs.index];
  S.trainer.enabled = false;
  if (s.key && NOTE_NAMES.includes(s.key)) { S.band.key = s.key; renderBand(); }
  if (!applyItem(s.item)) toast(`"${s.title}": its pattern is no longer saved — using the metronome`);
  saveSettings();
  renderTrainer();
  formStart = engine.playing ? null : 0; // the form restarts at the next bar line
  save();
  renderGig();
}

export function stepSong(d) {
  const l = list();
  if (!l || !l.songs.length) return;
  const i = Math.max(0, Math.min(l.songs.length - 1, prefs.index + d));
  if (i === prefs.index) { toast(d > 0 ? 'Last song in the set' : 'First song in the set'); return; }
  loadSong(i);
  toast(`${i + 1}. ${l.songs[i].title}`);
}

$('songPrev').addEventListener('click', () => stepSong(-1));
$('songNext').addEventListener('click', () => stepSong(1));

// ================================================================= form map

let formStart = 0;   // barCount where the current song's form started
let formBar = -1;    // bar in the form now (-1 = not playing)

function renderForm() {
  const s = song();
  const sections = s ? P.parseForm(s.form) : [];
  const box = $('formMap');
  box.hidden = !sections.length;
  if (!sections.length) { $('formNow').textContent = ''; return; }
  const pos = formBar >= 0 ? P.formPosition(sections, formBar) : null;
  if (box.dataset.form !== s.form) {
    box.dataset.form = s.form;
    box.innerHTML = sections.map((x, i) => `<div class="sec" data-i="${i}" style="flex-grow:${x.bars}"><b></b><small>${x.bars}</small></div>`).join('');
    box.querySelectorAll('.sec b').forEach((b, i) => { b.textContent = sections[i].name; });
  }
  box.querySelectorAll('.sec').forEach((el, i) => {
    el.classList.toggle('now', !!pos && pos.index === i);
    el.classList.toggle('soon', !!pos && pos.last && pos.index + 1 === i);
    el.classList.toggle('past', !!pos && (pos.done || (pos.index >= 0 && i < pos.index)));
  });
  const total = P.formBars(sections);
  $('formNow').innerHTML = !pos ? `${sections.length} sections · ${total} bars`
    : pos.done ? 'End of the form'
    : `<b>${esc(pos.name)}</b> · bar ${pos.bar} of ${pos.bars}${pos.last && pos.next ? ` · <span class="soon-text">→ ${esc(pos.next)} next</span>` : ''}`;
}

bus.on('step', ev => {
  if (ev.countIn || ev.beat !== 0 || ev.stepInBeat !== 0) return;
  if (formStart === null) formStart = ev.barCount;
  formBar = ev.barCount - formStart;
  if (S.tab === 'gig') renderForm();
});
bus.on('play', () => { formStart = 0; formBar = -1; });
bus.on('stop', () => { formBar = -1; formStart = 0; renderForm(); });

// ================================================================ rendering

let openSong = null; // id of the song whose editor is open

function songEditor(s) {
  const box = document.createElement('div');
  box.className = 'block-editor';
  const title = document.createElement('label');
  title.className = 'field wide';
  title.innerHTML = '<span>Title</span><input type="text" data-k="title" maxlength="80">';
  box.appendChild(title);
  box.appendChild(itemEditor(s.item, () => { save(); renderSongHeads(); renderStage(); }));
  const more = document.createElement('div');
  more.innerHTML = `
    <label class="field"><span>Key</span><select data-k="key"><option value="">—</option>${NOTE_NAMES.map(n => `<option>${n}</option>`).join('')}</select></label>
    <label class="field wide"><span>Form</span><input type="text" data-k="form" maxlength="300" placeholder="Intro 4, Verse 16, Chorus 8 x2, Outro 4"></label>
    <p class="hint">Sections and their length in bars, separated by commas. "x2" repeats a section. The map follows the bars while you play.</p>
    <label class="field wide"><span>Notes</span><textarea data-k="notes" maxlength="500" rows="3" placeholder="e.g. Rimshot fill into the chorus, half-time on the bridge"></textarea></label>
    <div class="btn-row"><button data-act="done" class="primary">Done</button></div>`;
  box.appendChild(more);
  const k = n => box.querySelector(`[data-k="${n}"]`);
  k('title').value = s.title;
  k('key').value = s.key;
  k('form').value = s.form;
  k('notes').value = s.notes;
  box.addEventListener('input', e => {
    const key = e.target.dataset.k;
    if (!key) return;
    s[key] = e.target.value.slice(0, Number(e.target.maxLength) > 0 ? Number(e.target.maxLength) : 500);
    if (key === 'title' && !s.title.trim()) return;
    save();
    renderSongHeads();
    renderStage();
  });
  return box;
}

function renderSongHeads() {
  const l = list();
  if (!l) return;
  l.songs.forEach((s, i) => {
    const el = $('songList').querySelector(`.block[data-id="${s.id}"]`);
    if (!el) return;
    el.querySelector('.b-name').textContent = `${i + 1}. ${s.title}`;
    el.querySelector('.b-meta').textContent = [itemLabel(s.item), s.key ? `key ${s.key}` : '', s.form ? `${P.formBars(P.parseForm(s.form))} bars` : ''].filter(Boolean).join(' · ');
  });
}

function renderLists() {
  const sel = $('setlistSelect');
  sel.innerHTML = lists.length ? '' : '<option value="">— no set lists yet —</option>';
  for (const l of lists) {
    const o = document.createElement('option');
    o.value = l.id;
    o.textContent = `${l.name} (${l.songs.length})`;
    sel.appendChild(o);
  }
  sel.value = prefs.listId || '';
  const l = list();
  ['sRename', 'sDuplicate', 'sDelete', 'sAddSong', 'sAddCurrent'].forEach(id => { $(id).disabled = !l; });
  const box = $('songList');
  box.innerHTML = '';
  if (!l) { box.innerHTML = '<p class="hint">Make a set list with New, then add songs.</p>'; return; }
  if (!l.songs.length) box.innerHTML = '<p class="hint">No songs yet. Pick a groove and tempo, then "Add what\'s playing" — or "Add song".</p>';
  l.songs.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'block song' + (i === prefs.index ? ' now' : '');
    el.dataset.id = s.id;
    el.innerHTML = `<div class="b-head"><span class="b-name"></span></div><div class="b-meta"></div>
      <div class="b-actions"><button data-act="load">Load</button><button data-act="edit">${openSong === s.id ? 'Close' : 'Edit'}</button><button data-act="up" aria-label="Move up"${i ? '' : ' disabled'}>↑</button><button data-act="down" aria-label="Move down"${i < l.songs.length - 1 ? '' : ' disabled'}>↓</button><button data-act="del" class="danger" aria-label="Remove">✕</button></div>`;
    if (openSong === s.id) el.appendChild(songEditor(s));
    box.appendChild(el);
  });
  renderSongHeads();
}

function renderStage() {
  const l = list(), s = song();
  $('songPos').textContent = l && l.songs.length ? `Song ${prefs.index + 1} of ${l.songs.length} · ${l.name}` : 'No set list';
  $('songTitle').textContent = s ? s.title : '—';
  $('songMeta').textContent = s ? [itemLabel(s.item), s.key ? `Key of ${s.key}` : ''].filter(Boolean).join(' · ') : 'Add songs below';
  $('songNotes').textContent = s ? s.notes : '';
  const next = l && l.songs[prefs.index + 1];
  $('songNextUp').textContent = next ? `Next: ${next.title}` : (s ? 'Last song' : '');
  $('songPrev').disabled = !l || prefs.index <= 0;
  $('songNext').disabled = !l || prefs.index >= l.songs.length - 1;
  renderForm();
}

const keyName = k => ({ ' ': 'Space', ArrowRight: '→', ArrowLeft: '←', ArrowUp: '↑', ArrowDown: '↓' }[k] || k);
function renderPedal() {
  $('pedalKeys').innerHTML = `Next song: <kbd>${prefs.keys.next.map(k => esc(keyName(k))).join('</kbd> or <kbd>')}</kbd> · Previous: <kbd>${prefs.keys.prev.map(k => esc(keyName(k))).join('</kbd> or <kbd>')}</kbd>`;
}

export function renderGig() {
  if (list() && prefs.index >= list().songs.length) prefs.index = Math.max(0, list().songs.length - 1);
  renderStage();
  renderLists();
  renderPedal();
}

// ================================================================== editing

$('songList').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-act]');
  const el = e.target.closest('.block');
  const l = list();
  if (!btn || !el || !l) return;
  const i = l.songs.findIndex(s => s.id === el.dataset.id);
  if (i < 0) return;
  const act = btn.dataset.act;
  if (act === 'load') { loadSong(i); return; }
  if (act === 'edit') openSong = openSong === el.dataset.id ? null : el.dataset.id;
  else if (act === 'done') openSong = null;
  else if (act === 'up' && i > 0) { [l.songs[i - 1], l.songs[i]] = [l.songs[i], l.songs[i - 1]]; if (prefs.index === i) prefs.index--; else if (prefs.index === i - 1) prefs.index++; }
  else if (act === 'down' && i < l.songs.length - 1) { [l.songs[i + 1], l.songs[i]] = [l.songs[i], l.songs[i + 1]]; if (prefs.index === i) prefs.index++; else if (prefs.index === i + 1) prefs.index--; }
  else if (act === 'del') {
    if (!(await ask(`Remove "${l.songs[i].title}" from the set list?`))) return;
    l.songs.splice(i, 1);
    if (prefs.index > i) prefs.index--;
  }
  save();
  renderGig();
});

$('setlistSelect').addEventListener('change', e => { prefs.listId = e.target.value; prefs.index = 0; openSong = null; save(); renderGig(); });
$('sNew').addEventListener('click', async () => {
  const name = await ask('Name the set list (e.g. the gig or the band)', { input: '' });
  if (!name) return;
  const l = P.normalizeSetlist({ name });
  lists.push(l);
  prefs.listId = l.id;
  prefs.index = 0;
  save();
  renderGig();
});
$('sRename').addEventListener('click', async () => {
  const l = list();
  const name = l && await ask('Rename set list', { input: l.name });
  if (!name) return;
  l.name = name.slice(0, 60);
  save();
  renderGig();
});
$('sDuplicate').addEventListener('click', () => {
  const l = list();
  if (!l) return;
  const copy = P.normalizeSetlist({ name: (l.name + ' copy').slice(0, 60), songs: l.songs.map(s => ({ ...s, id: '' })) });
  lists.push(copy);
  prefs.listId = copy.id;
  save();
  renderGig();
});
$('sDelete').addEventListener('click', async () => {
  const l = list();
  if (!l || !(await ask(`Delete the set list "${l.name}"?`))) return;
  lists = lists.filter(x => x.id !== l.id);
  prefs.listId = lists[0] ? lists[0].id : null;
  prefs.index = 0;
  save();
  renderGig();
});
async function addSong(item, askTitle) {
  const l = list();
  if (!l) return;
  const title = askTitle ? await ask('Song title', { input: '' }) : 'New song';
  if (askTitle && !title) return;
  const s = P.normalizeSong({ title, item });
  l.songs.push(s);
  if (!askTitle) openSong = s.id;
  save();
  renderGig();
}
$('sAddSong').addEventListener('click', () => addSong({ kind: 'groove', grooveId: S.grooveId }, false));
$('sAddCurrent').addEventListener('click', () => addSong(currentItem(), true));

$('sExport').addEventListener('click', () => {
  if (!lists.length) return toast('No set lists to export yet');
  download(`groove-trainer-setlists-${new Date().toISOString().slice(0, 10)}.json`, P.exportPractice({ setlists: lists }));
});
$('sImport').addEventListener('click', () => $('sImportFile').click());
$('sImportFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const d = P.importPractice(await file.text());
    if (!d.setlists.length) throw new Error('No set lists in this file');
    lists = P.mergeById(lists, d.setlists);
    if (!list()) prefs.listId = lists[0].id;
    flush();
    renderGig();
    toast(`Imported ${d.setlists.length} set list${d.setlists.length > 1 ? 's' : ''}`);
  } catch (err) {
    toast('Import failed: ' + err.message);
  }
});

// ===================================================== page-turner pedal

// Pedals act as a keyboard: most send PageDown/PageUp or the arrow keys.
// The keys work while the Gig tab is open. "Set pedal keys" learns
// whatever the pedal sends.
let learning = null; // 'next' | 'prev' | null

$('pedalLearn').addEventListener('click', () => {
  learning = 'next';
  $('pedalMsg').textContent = 'Press the pedal (or key) for NEXT song… (Esc to cancel)';
});
$('pedalReset').addEventListener('click', () => {
  prefs.keys = { next: DEFAULT_KEYS.next.slice(), prev: DEFAULT_KEYS.prev.slice() };
  learning = null;
  $('pedalMsg').textContent = 'Back to the standard keys.';
  save();
  renderPedal();
});

// Capture phase on window: runs before the app's other shortcuts, so a
// pedal that sends ↑/↓ or Space turns songs instead of changing the tempo.
window.addEventListener('keydown', e => {
  if (learning) {
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === 'Escape') { learning = null; $('pedalMsg').textContent = 'Cancelled.'; return; }
    if (e.repeat) return;
    if (learning === 'next') {
      prefs.keys.next = [e.key];
      learning = 'prev';
      $('pedalMsg').textContent = `Next = ${keyName(e.key)}. Now press the pedal for PREVIOUS song…`;
    } else {
      if (e.key === prefs.keys.next[0]) { $('pedalMsg').textContent = 'That is the Next key — press a different one for PREVIOUS…'; return; }
      prefs.keys.prev = [e.key];
      learning = null;
      $('pedalMsg').textContent = `Done: Next = ${keyName(prefs.keys.next[0])}, Previous = ${keyName(e.key)}.`;
    }
    save();
    renderPedal();
    return;
  }
  if (S.tab !== 'gig' || $('dialog').open || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
  const d = prefs.keys.next.includes(e.key) ? 1 : prefs.keys.prev.includes(e.key) ? -1 : 0;
  if (!d) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (!e.repeat) stepSong(d);
}, true);

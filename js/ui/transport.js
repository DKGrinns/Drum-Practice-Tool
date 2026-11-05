// transport.js — the always-visible top panel: tempo, tap, swing,
// play/stop, beat lights, trainer status line and "now playing".

import { $, clamp, S, saveSettings, engine, bus, refreshSequence, getActiveSeq, describeSource } from './core.js';
import { setSeg, segHandler, holdRepeat } from './widgets.js';
import { trainerBpm } from '../sequencer.js';
import { METERS, isTriplet } from '../patterns.js';

const trainerOn = () => S.trainer.enabled;
let liveBpm = null; // tempo reported by the engine while playing

// ===================================================================== tempo

export function renderBpm() {
  let v = S.bpm;
  if (trainerOn()) v = engine.playing && liveBpm ? liveBpm : S.trainer.start;
  $('bpmValue').textContent = v;
  $('bpmSlider').value = v;
  $('transport').classList.toggle('locked', trainerOn() && engine.playing);
  $('bpmUnit').textContent = S.source === 'metronome' ? METERS[S.meter].unit : '♩';
}

// BPM controls edit the normal tempo, or the trainer's start tempo when the
// trainer is on (locked while it is running).
export function changeBpm(v) {
  v = clamp(Math.round(v), 30, 300);
  if (trainerOn()) {
    if (engine.playing) return;
    S.trainer.start = v;
  } else {
    S.bpm = v;
  }
  renderBpm();
  saveSettings();
  bus.emit('tempo');
}
export const shownBpm = () => Number($('bpmValue').textContent);

holdRepeat($('bpmDown'), () => changeBpm(shownBpm() - 1));
holdRepeat($('bpmUp'), () => changeBpm(shownBpm() + 1));
$('bpmSlider').addEventListener('input', e => changeBpm(Number(e.target.value)));

// Tap tempo: average of the last few intervals; a long pause starts over.
let taps = [];
export function tap() {
  if (trainerOn() && engine.playing) return;
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
  taps.push(now);
  if (taps.length > 5) taps.shift();
  const btn = $('tapBtn');
  btn.classList.add('tapped');
  setTimeout(() => btn.classList.remove('tapped'), 90);
  if (taps.length >= 2) {
    const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    changeBpm(60000 / avg);
  }
}
$('tapBtn').addEventListener('pointerdown', e => { e.preventDefault(); tap(); });
$('tapBtn').addEventListener('click', e => { if (e.detail === 0) tap(); });

// ===================================================================== swing

function swingLabel(v) {
  if (v === 0) return 'Straight';
  if (v === 100) return 'Triplet';
  return v + '%';
}
export function renderSwing() {
  const v = Math.round(S.swing * 100);
  $('swing').value = v;
  $('swingVal').textContent = swingLabel(v);
  setSeg($('swingRes'), String(S.swingRes));
  const seq = getActiveSeq();
  const spb = seq ? seq.spb : 4;
  const applies = spb === 2 || spb === 4;
  const row = $('swing').closest('.swing-row');
  row.classList.toggle('na', !applies);
  row.title = applies ? '' : 'Swing only affects 8th/16th grids (triplet grids are already swung)';
}
$('swing').addEventListener('input', e => { S.swing = Number(e.target.value) / 100; renderSwing(); saveSettings(); });
segHandler($('swingRes'), v => { S.swingRes = Number(v); renderSwing(); saveSettings(); });

// Load a groove's or pattern's suggested tempo and feel.
export function applyFeel(p) {
  if (!trainerOn()) S.bpm = p.bpm;
  S.swing = p.swing;
  if (!isTriplet(p)) S.swingRes = p.swingRes;
  renderBpm();
  renderSwing();
  saveSettings();
}

// ================================================================ play/stop

let wakeLock = null;
async function requestWake() {
  if (!S.wakeLock || !('wakeLock' in navigator)) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* not allowed */ }
}
export function releaseWake() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}
export function updateWake() {
  if (!S.wakeLock) releaseWake(); else if (engine.playing) requestWake();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && engine.playing) requestWake();
});

export async function togglePlay() {
  if (engine.playing) {
    engine.stop();
    releaseWake();
    liveBpm = null;
    clearVisuals();
    bus.emit('stop');
  } else {
    refreshSequence(true);
    liveBpm = trainerOn() ? trainerBpm(S.trainer, 0) : null;
    const started = engine.start();
    requestWake();
    requestAnimationFrame(drawLoop);
    await started;
    bus.emit('play');
  }
  renderPlay();
  renderBpm();
  renderStatus(null);
}
export function renderPlay() {
  const b = $('playBtn');
  b.classList.toggle('playing', engine.playing);
  b.textContent = engine.playing ? '■ STOP' : '▶ PLAY';
  b.setAttribute('aria-label', engine.playing ? 'Stop' : 'Play');
}
$('playBtn').addEventListener('click', togglePlay);

export function renderNowPlaying() {
  $('nowPlaying').innerHTML = describeSource();
  renderBpm();
}

// =================================================================== visuals

let dotEls = [];
function renderBeatDots(n) {
  const box = $('beatDots');
  if (dotEls.length === n) return;
  box.innerHTML = '';
  dotEls = [];
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div');
    d.className = 'beat-dot' + (i === 0 ? ' first' : '');
    d.textContent = i + 1;
    box.appendChild(d);
    dotEls.push(d);
  }
}

let flashTimer = null;
function showEvent(ev) {
  renderBeatDots(ev.beatsPerBar);
  const hide = ev.muted && S.gap.hideVisual;
  $('beatDots').classList.toggle('silent', ev.muted);
  if (ev.stepInBeat === 0) {
    dotEls.forEach((d, i) => d.classList.toggle('on', !hide && i === ev.beat));
    if (!hide) {
      const t = $('transport');
      t.classList.remove('flash', 'flash-1');
      t.classList.add(ev.beat === 0 ? 'flash-1' : 'flash');
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => t.classList.remove('flash', 'flash-1'), 90);
    }
  }
  if (trainerOn() && ev.bpm !== liveBpm) { liveBpm = ev.bpm; renderBpm(); }
  bus.emit('step', ev);
}

function drawLoop() {
  if (!engine.playing) return;
  const due = engine.takeDueVisuals();
  // Only the latest step matters for display, but every bar start must be
  // seen so the status line updates even if a frame was skipped.
  for (const ev of due) if (ev.beat === 0 && ev.stepInBeat === 0) renderStatus(ev);
  if (due.length) showEvent(due[due.length - 1]);
  requestAnimationFrame(drawLoop);
}

function clearVisuals() {
  dotEls.forEach(d => d.classList.remove('on'));
  $('beatDots').classList.remove('silent');
  $('transport').classList.remove('flash', 'flash-1');
  const seq = getActiveSeq();
  renderBeatDots(seq ? seq.beatsPerBar : 4);
}

// Trainer / gap status line under the BPM.
export function renderStatus(ev) {
  const parts = [];
  const tr = S.trainer, gap = S.gap;
  if (tr.enabled) {
    if (ev) {
      const cur = trainerBpm(tr, ev.barCount);
      if (cur === clamp(tr.target, 30, 300)) parts.push(`Target ${cur} reached ✓`);
      else {
        const every = Math.max(1, tr.every);
        const left = every - (ev.barCount % every);
        const next = trainerBpm(tr, ev.barCount + left);
        parts.push(`→ ${next} in ${left} bar${left > 1 ? 's' : ''}`);
      }
    } else {
      parts.push(`Trainer ${tr.start} → ${tr.target}, ${tr.target >= tr.start ? '+' : '−'}${tr.step} every ${tr.every}`);
    }
  }
  if (gap.enabled) {
    if (ev) {
      const cycle = gap.play + gap.mute;
      const pos = ev.barCount % cycle;
      parts.push(pos < gap.play ? `PLAY ${pos + 1}/${gap.play}` : `<span class="silent">SILENT ${pos - gap.play + 1}/${gap.mute}</span>`);
    } else {
      parts.push(`Gap: play ${gap.play}, silent ${gap.mute}`);
    }
  }
  $('statusLine').innerHTML = parts.join(' · ');
}

bus.on('sequence', seq => {
  renderNowPlaying();
  renderSwing();
  if (!engine.playing) renderBeatDots(seq.beatsPerBar);
});
bus.on('tempo', () => { renderBpm(); renderStatus(null); });

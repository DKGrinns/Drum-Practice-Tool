// feedback.js (UI) — the Feedback tab: listens to you play through the
// microphone and scores every hit against the beat.
//
// Flow: Start listening -> (once per device) calibrate latency -> press
// Play on anything (metronome, groove, pattern, trainers) and play along.
// Each hit is matched to the nearest beat/8th/triplet/16th of what the app
// is playing, on the audio clock. A take runs from Play to Stop; the report
// appears when you stop.

import * as store from '../storage.js';
import { $, clamp, S, saveSettings, engine, bus } from './core.js';
import { setSeg, segHandler, toast } from './widgets.js';
import { togglePlay } from './transport.js';
import { MicInput } from '../mic.js';
import {
  gridPoints, matchHit, summarize, describeOffset, describeSpread, describeTrend, positionName,
  estimateLatency, tapLatency, isBleed,
} from '../timing-analysis.js';

// Doesn't change the source: scores whatever is playing.
export const panel = { id: 'feedback', label: 'Feedback', onShow: () => drawTimeline() };

const mic = new MicInput(engine);
mic.setSensitivity(S.feedback.sensitivity);

// Calibration is per device: { ms, method, bleedPeak, date }.
let calib = store.load('latency', null);
const latency = () => (calib ? calib.ms / 1000 : 0);

let take = { hits: [], ignored: 0 };
let calibrating = null; // { onsets: [] } while a calibration runs
let lastBeatsPerBar = 4;

// ===================================================================== mic

mic.onLevel = level => {
  $('micMeter').style.width = `${Math.min(100, Math.sqrt(level) * 100)}%`;
};

mic.onOnset = onset => {
  if (calibrating) { calibrating.onsets.push(onset); return; }
  if (!engine.playing) { flashLast('hit', 'Hit heard — press Play to score your timing'); return; }
  const lat = latency();
  if (calib && isBleed(onset, engine.soundsNear(onset.time - lat), lat, calib.bleedPeak)) { take.ignored++; return; }
  // Grid from the beats around this hit (the engine logs every beat).
  const t = onset.time - lat;
  const beats = engine.beatLog.filter(b => b.time > t - 2 && b.time < t + 1);
  if (!beats.length) return;
  lastBeatsPerBar = beats[beats.length - 1].beatsPerBar;
  const hit = matchHit(onset, gridPoints(beats, S.feedback.res, S.swing, S.swingRes), lat);
  if (!hit) return;
  take.hits.push(hit);
  showHit(hit);
  scheduleRender();
};

async function startMic() {
  $('micMsg').textContent = '';
  try {
    await mic.start();
  } catch (err) {
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    $('micMsg').textContent = denied
      ? 'Microphone permission was blocked. Allow it in the browser\'s site settings (the lock or "aA" icon by the address), then try again.'
      : `Couldn't open the microphone (${err && err.message ? err.message : err}).`;
  }
  renderMic();
}

function renderMic() {
  const b = $('micToggle');
  b.setAttribute('aria-pressed', String(mic.active));
  b.textContent = mic.active ? 'Stop listening' : 'Start listening';
  $('micSens').value = S.feedback.sensitivity;
  $('micSensVal').textContent = S.feedback.sensitivity;
  // Meter mark ≈ the quietest hit that will count.
  const thr = 0.2 * Math.pow(0.01, S.feedback.sensitivity / 100);
  $('micMark').style.left = `${Math.min(100, Math.sqrt(thr) * 100)}%`;
  if (!mic.active) $('micMeter').style.width = '0';
  $('speakerTest').disabled = $('tapTest').disabled = !mic.active;
}

$('micToggle').addEventListener('click', () => {
  if (mic.active) { mic.stop(); renderMic(); } else startMic();
});
$('micSens').addEventListener('input', e => {
  S.feedback.sensitivity = Number(e.target.value);
  mic.setSensitivity(S.feedback.sensitivity);
  saveSettings();
  renderMic();
});

// ============================================================= calibration

function renderCalib() {
  const el = $('calibStatus');
  if (!calib) {
    el.textContent = 'Not calibrated yet — scores will include your device\'s delay.';
    el.classList.add('warn');
  } else {
    const how = calib.method === 'speaker' ? 'speaker test' : calib.method === 'tap' ? 'tap test' : 'set by hand';
    el.textContent = `Latency ${Math.round(calib.ms)} ms (${how}${calib.date ? ', ' + calib.date : ''})`;
    el.classList.remove('warn');
  }
  $('latVal').textContent = calib ? Math.round(calib.ms) : 0;
}

function saveCalib(c) {
  calib = c;
  store.save('latency', calib);
  renderCalib();
}

const wait = ms => new Promise(r => setTimeout(r, ms));

// Play clicks at known times and collect what the mic hears.
async function playClicks(times, level) {
  calibrating = { onsets: [] };
  for (const t of times) engine.synth.play('accent', t, level);
  const end = times[times.length - 1] + 0.7;
  while (engine.ctx.currentTime < end) await wait(50);
  const onsets = calibrating.onsets;
  calibrating = null;
  return onsets;
}

async function prepareCalibration() {
  if (!mic.active) return false;
  if (engine.playing) await togglePlay(); // stop playback first
  engine.ensureAudio();
  return true;
}

$('speakerTest').addEventListener('click', async () => {
  if (!(await prepareCalibration())) return;
  $('micMsg').textContent = 'Speaker test: stay quiet for 6 seconds…';
  // The speaker's sound at the mic can be much quieter than a drum, so
  // listen at high sensitivity for the test (the room is quiet), then go
  // back to the player's setting.
  mic.setSensitivity(Math.max(S.feedback.sensitivity, 92));
  const t0 = engine.ctx.currentTime + 0.4;
  const times = Array.from({ length: 10 }, (_, i) => t0 + i * 0.55);
  const onsets = await playClicks(times, 1.0);
  mic.setSensitivity(S.feedback.sensitivity);
  const r = estimateLatency(onsets, times);
  if (!r) {
    $('micMsg').textContent = 'The mic couldn\'t hear the clicks. Turn the volume up, raise the sensitivity, or use the tap test (needed with headphones).';
    return;
  }
  if (r.spread > 0.004) {
    $('micMsg').textContent = `Results were uneven (±${Math.round(r.spread * 1000)} ms). Try again in a quieter moment.`;
    return;
  }
  saveCalib({ ms: r.latency * 1000, method: 'speaker', bleedPeak: r.bleedPeak, date: new Date().toLocaleDateString() });
  $('micMsg').textContent = `Done: ${Math.round(r.latency * 1000)} ms (heard ${r.matched} of 10 clicks).`;
});

$('tapTest').addEventListener('click', async () => {
  if (!(await prepareCalibration())) return;
  $('micMsg').textContent = 'Tap test: listen to 4 clicks, then hit a drum exactly with the next 16.';
  const t0 = engine.ctx.currentTime + 0.6;
  const times = Array.from({ length: 20 }, (_, i) => t0 + i * 0.6);
  const onsets = await playClicks(times, 0.9);
  const r = tapLatency(onsets.filter(o => o.time > times[3] + 0.3), times.slice(4));
  if (!r) {
    $('micMsg').textContent = 'Not enough hits heard. Raise the sensitivity and try again, hitting with each click.';
    return;
  }
  // With headphones the mic can't hear the app, so there's no bleed to filter.
  saveCalib({ ms: r.latency * 1000, method: 'tap', bleedPeak: 0, date: new Date().toLocaleDateString() });
  $('micMsg').textContent = `Done: ${Math.round(r.latency * 1000)} ms from ${r.matched} hits (±${Math.round(r.spread * 1000)} ms).`;
});

function nudge(d) {
  saveCalib({ ...(calib || { method: 'manual', bleedPeak: 0 }), ms: clamp((calib ? calib.ms : 0) + d, -200, 1000), method: 'manual', date: new Date().toLocaleDateString() });
}
$('latDown').addEventListener('click', () => nudge(-1));
$('latUp').addEventListener('click', () => nudge(1));

// ================================================================== display

const cls = e => (Math.abs(e) <= 10 ? 'ok' : Math.abs(e) <= 25 ? 'meh' : 'bad');
const fmt = e => `${e > 0 ? '+' : e < 0 ? '−' : ''}${Math.abs(Math.round(e))}`;

function flashLast(kind, text) {
  $('fbLast').innerHTML = `<span class="big">♪</span><span class="lbl"></span>`;
  $('fbLast').querySelector('.lbl').textContent = text;
}

function showHit(hit) {
  const e = hit.error;
  const word = Math.abs(e) < 4 ? 'on it' : e > 0 ? 'ms late' : 'ms early';
  $('fbLast').innerHTML = `<span class="big ${cls(e)}">${Math.abs(e) < 4 ? '✓' : fmt(e)}</span><span class="lbl">${word} · ${positionName(hit.beat, hit.sub, hit.res)}</span>`;
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderStats(); drawTimeline(); });
}

function stat(value, label, c = '') {
  return `<div class="fb-stat"><b class="${c}">${value}</b><span>${label}</span></div>`;
}

function renderStats() {
  const s = summarize(take.hits);
  if (!s.count) { $('fbStats').innerHTML = ''; return; }
  $('fbStats').innerHTML =
    stat(s.count, 'hits') +
    stat(`${fmt(s.mean)} ms`, s.mean >= 0 ? 'average (late)' : 'average (early)', cls(s.mean)) +
    stat(`±${Math.round(s.sd)} ms`, `spread · ${describeSpread(s.sd)}`, s.sd < 12 ? 'ok' : s.sd < 20 ? 'meh' : 'bad') +
    stat(`${Math.round(s.within10 * 100)}%`, 'within ±10 ms') +
    stat(describeTrend(s.trend, s.perBar.length).split(' ')[0], 'tempo drift');
}

// Recent hits: x = order, y = error (late up, early down). Bands at ±10 and ±25 ms.
function drawTimeline() {
  const cv = $('fbTimeline');
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w) return;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const range = 50; // ms shown above/below
  const y = ms => h / 2 - (clamp(ms, -range, range) / range) * (h / 2 - 8);
  g.fillStyle = 'rgba(46,230,197,0.10)';
  g.fillRect(0, y(10), w, y(-10) - y(10));
  g.fillStyle = 'rgba(255,209,102,0.06)';
  g.fillRect(0, y(25), w, y(10) - y(25));
  g.fillRect(0, y(-10), w, y(-25) - y(-10));
  g.strokeStyle = '#3a4656';
  g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  const n = 48;
  const recent = take.hits.slice(-n);
  const step = w / n;
  recent.forEach((hit, i) => {
    const x = w - (recent.length - i - 0.5) * step;
    const c = cls(hit.error);
    g.fillStyle = c === 'ok' ? '#2ee6c5' : c === 'meh' ? '#ffd166' : '#ff4d5e';
    g.beginPath();
    g.arc(x, y(hit.error), hit.sub === 0 ? 6 : 4, 0, Math.PI * 2);
    g.fill();
  });
}

// ================================================================= report

function renderReport() {
  const s = summarize(take.hits);
  const box = $('fbReport');
  if (s.count < 4) { box.hidden = true; return; }
  box.hidden = false;
  const bars = s.perBar.length;
  const lines = [
    `You played <b>${s.count}</b> hits over ${bars} bar${bars === 1 ? '' : 's'}, on average <b class="${cls(s.mean)}">${describeOffset(s.mean)}</b> (${fmt(s.mean)} ms).`,
    `Your timing was <b>${describeSpread(s.sd)}</b> (±${Math.round(s.sd)} ms); ${Math.round(s.within10 * 100)}% of hits within ±10 ms and ${Math.round(s.within20 * 100)}% within ±20 ms.`,
    `Tempo: <b>${describeTrend(s.trend, bars)}</b>.`,
  ];
  if (take.ignored) lines.push(`<span class="hint">${take.ignored} sounds from the speaker were ignored.</span>`);
  // Per-position average across the bar, e.g. which 16th you rush.
  const res = S.feedback.res;
  const cells = [];
  for (let beat = 0; beat < lastBeatsPerBar; beat++) {
    for (let sub = 0; sub < res; sub++) {
      const p = s.byPosition.find(q => q.beat === beat && q.sub === sub && q.res === res);
      cells.push(p && p.count >= 2
        ? `<div class="fb-pos"><small>${positionName(beat, sub, res)}</small><b class="${cls(p.mean)}">${fmt(p.mean)}</b></div>`
        : `<div class="fb-pos"><small>${positionName(beat, sub, res)}</small><b>·</b></div>`);
    }
  }
  const cols = Math.min(lastBeatsPerBar * res, 8);
  // Bar-by-bar average (last 32 bars): above the line = late.
  const recentBars = s.perBar.slice(-32);
  const barHtml = recentBars.map(b => {
    const v = clamp(b.mean, -30, 30) / 30 * 50; // % of half height
    const style = v >= 0 ? `bottom:50%;height:${Math.max(2, v)}%` : `top:50%;height:${Math.max(2, -v)}%`;
    const c = cls(b.mean);
    return `<div class="fb-bar" title="Bar ${b.bar + 1}: ${fmt(b.mean)} ms, ±${Math.round(b.sd)}"><i style="${style};background:${c === 'ok' ? '#2ee6c5' : c === 'meh' ? '#ffd166' : '#ff4d5e'}"></i></div>`;
  }).join('');
  $('fbReportBody').innerHTML = `
    <p class="fb-summary">${lines.join('<br>')}</p>
    <h3>Average by position (ms, + = late)</h3>
    <div class="fb-positions" style="grid-template-columns:repeat(${cols},1fr)">${cells.join('')}</div>
    <h3>Bar by bar (above the line = late)</h3>
    <div class="fb-bars">${barHtml}</div>`;
}

$('fbReportBtn').addEventListener('click', () => { renderReport(); if ($('fbReport').hidden) toast('Play a few bars first'); });
$('fbReset').addEventListener('click', () => { take = { hits: [], ignored: 0 }; $('fbReport').hidden = true; renderStats(); drawTimeline(); flashLast('', 'New take — start playing'); });
segHandler($('fbRes'), v => { S.feedback.res = Number(v); setSeg($('fbRes'), v); saveSettings(); });

// A take runs from Play to Stop.
bus.on('play', () => {
  if (!mic.active) return;
  take = { hits: [], ignored: 0 };
  $('fbReport').hidden = true;
  renderStats();
  drawTimeline();
  flashLast('', 'Listening… play along');
});
bus.on('stop', () => { if (take.hits.length) renderReport(); });
window.addEventListener('resize', () => drawTimeline());

export function renderFeedback() {
  $('fbUnsupported').hidden = MicInput.supported();
  setSeg($('fbRes'), String(S.feedback.res));
  renderMic();
  renderCalib();
  drawTimeline();
}

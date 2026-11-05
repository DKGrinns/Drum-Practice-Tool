// feedback.js (UI) — the Feedback tab: scores your playing against the beat.
//
// Inputs:
//   Microphone  hits found by the onset detector (needs latency calibration)
//   MIDI kit    pad hits with exact timestamps, drum and velocity
// Flow: choose the input -> (mic: calibrate once per device) -> press Play
// on anything (metronome, groove, pattern, trainers) and play along. Each hit
// is matched to the nearest beat/8th/triplet/16th of what the app is
// playing, on the audio clock. A take runs from Play to Stop; the report
// appears when you stop. With "Record takes" on, the mic audio of each take
// is kept so you can listen back, in time over the groove.

import * as store from '../storage.js';
import { $, clamp, S, saveSettings, engine, bus, refreshSequence, describeSource } from './core.js';
import { setSeg, segHandler, setToggle, toast, download, slug } from './widgets.js';
import { togglePlay, renderBpm, renderSwing } from './transport.js';
import { MicInput } from '../mic.js';
import { MidiInput } from '../midi.js';
import { TakeRecorder, encodeWav, alignTake } from '../recorder.js';
import { KIT_VOICES } from '../patterns.js';
import {
  gridPoints, matchHit, summarize, summarizeByVoice, dynamics, describeOffset, describeSpread,
  describeTrend, positionName, estimateLatency, tapLatency, isBleed,
} from '../timing-analysis.js';

// Doesn't change the source: scores whatever is playing.
export const panel = { id: 'feedback', label: 'Feedback', onShow: () => drawTimeline() };

const mic = new MicInput(engine);
mic.setSensitivity(S.feedback.sensitivity);
const midi = new MidiInput(engine);
const midiPrefs = store.load('midi', { custom: {}, offsetMs: 0, monitor: false });
midi.custom = midiPrefs.custom || {};
midi.offsetMs = midiPrefs.offsetMs || 0;
const saveMidiPrefs = () => store.save('midi', { custom: midi.custom, offsetMs: midi.offsetMs, monitor: midiPrefs.monitor });

// Mic calibration is per device: { ms, method, bleedPeak, date }.
let calib = store.load('latency', null);
const latency = () => (calib ? calib.ms / 1000 : 0);

const newTake = () => ({ hits: [], ignored: 0, beatsPerBar: 4, res: S.feedback.res });
let take = newTake();
let calibrating = null; // { onsets: [] } while a calibration runs
let replaying = null;   // { node, takeId } while a recording plays back
let learning = null;    // voice id while waiting for a pad to learn
let recorder = null;    // TakeRecorder for the take in progress
const takes = [];       // recorded takes (in memory, last 5)

const VOICE_LABEL = Object.fromEntries(KIT_VOICES.map(v => [v.id, v.label]));
VOICE_LABEL.other = 'Other pads';

// ================================================================== scoring

// Score one hit (from either input) against the beats around it.
function scoreHit(hit, lat) {
  if (!engine.playing || replaying) return null;
  const t = hit.time - lat;
  const beats = engine.beatLog.filter(b => b.time > t - 2 && b.time < t + 1);
  if (!beats.length) return null;
  take.beatsPerBar = beats[beats.length - 1].beatsPerBar;
  const m = matchHit(hit, gridPoints(beats, S.feedback.res, S.swing, S.swingRes), lat);
  if (!m) return null;
  take.hits.push(m);
  showHit(m);
  scheduleRender();
  return m;
}

// ===================================================================== mic

mic.onLevel = level => { $('micMeter').style.width = `${Math.min(100, Math.sqrt(level) * 100)}%`; };

mic.onOnset = onset => {
  if (calibrating) { calibrating.onsets.push(onset); return; }
  if (S.feedback.input !== 'mic' || replaying) return;
  if (!engine.playing) { flashLast('Hit heard — press Play to score your timing'); return; }
  const lat = latency();
  if (calib && isBleed(onset, engine.soundsNear(onset.time - lat), lat, calib.bleedPeak)) { take.ignored++; return; }
  scoreHit(onset, lat);
};

mic.onAudio = (data, frame) => { if (recorder && !recorder.add(data, frame)) stopRecording(); };

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
  const thr = 0.2 * Math.pow(0.01, S.feedback.sensitivity / 100); // quietest hit that counts
  $('micMark').style.left = `${Math.min(100, Math.sqrt(thr) * 100)}%`;
  if (!mic.active) $('micMeter').style.width = '0';
  $('speakerTest').disabled = $('tapTest').disabled = !mic.active;
  setToggle($('recToggle'), S.feedback.record);
}

$('micToggle').addEventListener('click', () => {
  if (mic.active) { stopRecording(); mic.stop(); renderMic(); } else startMic();
});
$('micSens').addEventListener('input', e => {
  S.feedback.sensitivity = Number(e.target.value);
  mic.setSensitivity(S.feedback.sensitivity);
  saveSettings();
  renderMic();
});

// ==================================================================== MIDI

midi.onHit = hit => {
  if (learning) {
    midi.custom[hit.note] = learning;
    $('learnMsg').textContent = `Note ${hit.note} → ${VOICE_LABEL[learning]}.`;
    learning = null;
    saveMidiPrefs();
    renderMidi();
    return;
  }
  if (midiPrefs.monitor && hit.voice !== 'other') engine.preview(hit.voice, Math.max(0.15, hit.velocity / 127));
  if (S.feedback.input !== 'midi') return;
  if (!engine.playing) { flashLast(`${VOICE_LABEL[hit.voice] || 'Pad'} — press Play to score your timing`); return; }
  scoreHit({ time: hit.time, peak: hit.velocity / 127, voice: hit.voice, velocity: hit.velocity }, 0);
};
midi.onDevices = names => {
  $('midiMsg').textContent = names.length ? `Connected: ${names.join(', ')}` : 'No MIDI device found. Plug in the kit (USB) and turn it on.';
};

async function startMidi() {
  $('midiMsg').textContent = '';
  try {
    await midi.start();
  } catch (err) {
    $('midiMsg').textContent = `MIDI access was refused or isn't available (${err && err.message ? err.message : err}).`;
  }
  renderMidi();
}

function renderMidi() {
  const ok = MidiInput.supported();
  $('midiToggle').disabled = !ok;
  if (!ok) $('midiMsg').textContent = 'This browser has no Web MIDI (Safari doesn\'t). Use Chrome or Edge on a computer, or Chrome on Android.';
  $('midiToggle').setAttribute('aria-pressed', String(midi.active));
  $('midiToggle').textContent = midi.active ? 'Disconnect' : 'Connect';
  setToggle($('midiMonitor'), midiPrefs.monitor);
  $('midiLatVal').textContent = midi.offsetMs;
  const sel = $('learnVoice');
  if (!sel.options.length) sel.innerHTML = KIT_VOICES.map(v => `<option value="${v.id}">${v.label}</option>`).join('');
  $('learnBtn').disabled = !midi.active;
  $('learnBtn').textContent = learning ? 'Hit the pad…' : 'Learn';
}

$('midiToggle').addEventListener('click', () => { if (midi.active) { midi.stop(); renderMidi(); } else startMidi(); });
$('midiMonitor').addEventListener('click', () => { midiPrefs.monitor = !midiPrefs.monitor; saveMidiPrefs(); renderMidi(); });
$('learnBtn').addEventListener('click', () => { learning = $('learnVoice').value; $('learnMsg').textContent = ''; renderMidi(); });
$('learnReset').addEventListener('click', () => { midi.custom = {}; saveMidiPrefs(); $('learnMsg').textContent = 'Back to the standard General MIDI mapping.'; });
$('midiLatDown').addEventListener('click', () => { midi.offsetMs = clamp(midi.offsetMs - 1, 0, 100); saveMidiPrefs(); renderMidi(); });
$('midiLatUp').addEventListener('click', () => { midi.offsetMs = clamp(midi.offsetMs + 1, 0, 100); saveMidiPrefs(); renderMidi(); });

function renderInput() {
  setSeg($('fbInput'), S.feedback.input);
  $('midiCard').hidden = S.feedback.input !== 'midi';
  $('micCard').hidden = S.feedback.input !== 'mic';
}
segHandler($('fbInput'), v => { S.feedback.input = v; saveSettings(); renderInput(); });

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
    $('micMsg').textContent = 'The mic couldn\'t hear the clicks. Turn the volume up, or use the tap test (needed with headphones).';
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
  saveCalib({ ...(calib || { bleedPeak: 0 }), ms: clamp((calib ? calib.ms : 0) + d, -200, 1000), method: 'manual', date: new Date().toLocaleDateString() });
}
$('latDown').addEventListener('click', () => nudge(-1));
$('latUp').addEventListener('click', () => nudge(1));

// ================================================================== display

const cls = e => (Math.abs(e) <= 10 ? 'ok' : Math.abs(e) <= 25 ? 'meh' : 'bad');
const colour = e => ({ ok: '#2ee6c5', meh: '#ffd166', bad: '#ff4d5e' })[cls(e)];
const fmt = e => `${e > 0 ? '+' : e < 0 ? '−' : ''}${Math.abs(Math.round(e))}`;

function flashLast(text) {
  $('fbLast').innerHTML = `<span class="big">♪</span><span class="lbl"></span>`;
  $('fbLast').querySelector('.lbl').textContent = text;
}

function showHit(hit) {
  const e = hit.error;
  const word = Math.abs(e) < 4 ? 'on it' : e > 0 ? 'ms late' : 'ms early';
  const drum = hit.voice ? ` · ${VOICE_LABEL[hit.voice] || hit.voice}` : '';
  $('fbLast').innerHTML = `<span class="big ${cls(e)}">${Math.abs(e) < 4 ? '✓' : fmt(e)}</span><span class="lbl">${word} · ${positionName(hit.beat, hit.sub, hit.res)}${drum}</span>`;
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderStats(); drawTimeline(); });
}

const stat = (value, label, c = '') => `<div class="fb-stat"><b class="${c}">${value}</b><span>${label}</span></div>`;

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
    g.fillStyle = colour(hit.error);
    g.beginPath();
    g.arc(x, y(hit.error), hit.sub === 0 ? 6 : 4, 0, Math.PI * 2);
    g.fill();
  });
}

// ================================================================== report

function reportHtml(t) {
  const s = summarize(t.hits);
  const bars = s.perBar.length;
  const lines = [
    `You played <b>${s.count}</b> hits over ${bars} bar${bars === 1 ? '' : 's'}, on average <b class="${cls(s.mean)}">${describeOffset(s.mean)}</b> (${fmt(s.mean)} ms).`,
    `Your timing was <b>${describeSpread(s.sd)}</b> (±${Math.round(s.sd)} ms); ${Math.round(s.within10 * 100)}% of hits within ±10 ms and ${Math.round(s.within20 * 100)}% within ±20 ms.`,
    `Tempo: <b>${describeTrend(s.trend, bars)}</b>.`,
  ];
  if (t.ignored) lines.push(`<span class="hint">${t.ignored} sounds from the speaker were ignored.</span>`);
  // Per-position average across the bar, e.g. which 16th you rush.
  const res = t.res;
  const cells = [];
  for (let beat = 0; beat < t.beatsPerBar; beat++) {
    for (let sub = 0; sub < res; sub++) {
      const p = s.byPosition.find(q => q.beat === beat && q.sub === sub && q.res === res);
      cells.push(`<div class="fb-pos"><small>${positionName(beat, sub, res)}</small><b class="${p && p.count >= 2 ? cls(p.mean) : ''}">${p && p.count >= 2 ? fmt(p.mean) : '·'}</b></div>`);
    }
  }
  const cols = Math.min(t.beatsPerBar * res, 8);
  // Bar-by-bar average (last 32 bars): above the line = late.
  const barHtml = s.perBar.slice(-32).map(b => {
    const v = clamp(b.mean, -30, 30) / 30 * 50;
    const style = v >= 0 ? `bottom:50%;height:${Math.max(2, v)}%` : `top:50%;height:${Math.max(2, -v)}%`;
    return `<div class="fb-bar" title="Bar ${b.bar + 1}: ${fmt(b.mean)} ms, ±${Math.round(b.sd)}"><i style="${style};background:${colour(b.mean)}"></i></div>`;
  }).join('');
  // Per drum (MIDI kits know which pad was hit).
  let drums = '';
  const byVoice = summarizeByVoice(t.hits);
  if (byVoice.length) {
    drums = `<h3>By drum</h3><table class="voice-table"><thead><tr><th>Drum</th><th>Hits</th><th>Average</th><th>Spread</th><th>Velocity</th></tr></thead><tbody>` +
      byVoice.map(v => `<tr><td>${VOICE_LABEL[v.voice] || v.voice}</td><td>${v.count}</td><td class="${cls(v.mean)}">${fmt(v.mean)} ms</td><td>±${Math.round(v.sd)} ms</td><td>${Math.round(v.velocity)} ±${Math.round(v.velocitySd)}</td></tr>`).join('') +
      `</tbody></table>`;
    const d = dynamics(t.hits.filter(h => h.voice === 'snare'));
    if (d.ghosts.count >= 4 && d.accents.count >= 2) {
      const even = x => (x < 6 ? 'very even' : x < 12 ? 'fairly even' : 'uneven');
      drums += `<p class="fb-summary">Snare dynamics: ghost notes ${Math.round(d.ghosts.mean)} (±${Math.round(d.ghosts.sd)}, ${even(d.ghosts.sd)}), accents ${Math.round(d.accents.mean)} (±${Math.round(d.accents.sd)}, ${even(d.accents.sd)}). Gap between them: ${Math.round(d.range)} velocity steps${d.middle.count ? `; ${d.middle.count} hits in between` : ''}.</p>`;
    }
  }
  return `
    <p class="fb-summary">${lines.join('<br>')}</p>
    ${drums}
    <h3>Average by position (ms, + = late)</h3>
    <div class="fb-positions" style="grid-template-columns:repeat(${cols},1fr)">${cells.join('')}</div>
    <h3>Bar by bar (above the line = late)</h3>
    <div class="fb-bars">${barHtml}</div>`;
}

function renderReport(t = take) {
  const box = $('fbReport');
  if (summarize(t.hits).count < 4) { box.hidden = true; return false; }
  $('fbReportBody').innerHTML = reportHtml(t);
  box.hidden = false;
  return true;
}

$('fbReportBtn').addEventListener('click', () => { if (!renderReport()) toast('Play a few bars first'); });
$('fbReset').addEventListener('click', () => { take = newTake(); $('fbReport').hidden = true; renderStats(); drawTimeline(); flashLast('New take — start playing'); });
segHandler($('fbRes'), v => { S.feedback.res = Number(v); take.res = S.feedback.res; setSeg($('fbRes'), v); saveSettings(); });

// ============================================================ takes/history

const HISTORY_KEY = 'takeHistory';
let history = store.load(HISTORY_KEY, []);
if (!Array.isArray(history)) history = [];

function plainSource() {
  const d = document.createElement('div');
  d.innerHTML = describeSource();
  return d.textContent;
}

// Settings needed to replay the same groove for "over the groove".
const sourceSnapshot = () => ({ source: S.source, grooveId: S.grooveId, bpm: S.bpm, meter: S.meter, subdivision: S.subdivision, swing: S.swing, swingRes: S.swingRes });

function finishTake() {
  const s = summarize(take.hits);
  if (s.count < 4) return;
  history.unshift({
    date: new Date().toISOString(), source: plainSource(),
    bpm: S.trainer.enabled ? `${S.trainer.start}→${S.trainer.target}` : S.bpm,
    input: S.feedback.input, count: s.count, mean: Math.round(s.mean * 10) / 10, sd: Math.round(s.sd * 10) / 10,
    within10: Math.round(s.within10 * 100),
  });
  history = history.slice(0, 50);
  store.save(HISTORY_KEY, history);
  renderHistory();
  bus.emit('take', s); // the practice log uses the score to mark clean takes
}

function renderHistory() {
  $('historyCard').hidden = !history.length;
  const box = $('historyList');
  box.innerHTML = '';
  for (const h of history.slice(0, 12)) {
    const when = new Date(h.date);
    const row = document.createElement('div');
    row.className = 'h-row';
    row.innerHTML = `<span></span><span class="${cls(h.mean)}">${fmt(h.mean)} ms</span><span>±${Math.round(h.sd)}</span><span>${h.within10}%</span>`;
    row.firstChild.textContent = `${when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · ${h.source} · ${h.bpm} BPM${h.input === 'midi' ? ' · MIDI' : ''}`;
    box.appendChild(row);
  }
}
$('historyClear').addEventListener('click', () => { history = []; store.save(HISTORY_KEY, history); renderHistory(); });

function startRecording() {
  if (!S.feedback.record || !mic.active) return;
  recorder = new TakeRecorder(engine.ctx.sampleRate);
  mic.record(true);
}

function stopRecording() {
  if (!recorder) return;
  mic.record(false);
  const r = recorder;
  recorder = null;
  if (r.duration < 1 || !engine.beatLog.length) return;
  takes.unshift({
    id: Date.now(), name: plainSource(), date: new Date(), recorder: r,
    firstBeat: engine.beatLog[0].time, snapshot: sourceSnapshot(),
    take: { ...take, hits: [...take.hits] }, latency: latency(),
  });
  takes.length = Math.min(takes.length, 5);
  renderTakes();
}

function renderTakes() {
  $('takesCard').hidden = !takes.length;
  const box = $('takesList');
  box.innerHTML = '';
  for (const t of takes) {
    const s = summarize(t.take.hits);
    const score = s.count ? `${fmt(s.mean)} ms · ±${Math.round(s.sd)} · ${Math.round(s.within10 * 100)}% within ±10` : 'no hits scored';
    const el = document.createElement('div');
    el.className = 'take' + (replaying && replaying.takeId === t.id ? ' playing' : '');
    el.dataset.id = t.id;
    el.innerHTML = `
      <div class="t-head"><span class="t-name"></span><span class="t-meta">${Math.round(t.recorder.duration)} s · ${t.date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span></div>
      <div class="t-meta">${score}</div>
      <div class="btn-row"><button data-act="play">▶ Listen</button><button data-act="groove">▶ Over the groove</button><button data-act="wav">⬇ WAV</button><button data-act="report">Report</button></div>`;
    el.querySelector('.t-name').textContent = t.name;
    box.appendChild(el);
  }
}

function stopReplay() {
  if (!replaying) return;
  const r = replaying;
  replaying = null;
  try { r.node.stop(); } catch (e) { /* already stopped */ }
  renderTakes();
}

async function playTake(t, withGroove) {
  stopReplay();
  if (engine.playing) await togglePlay();
  const ctx = engine.ensureAudio();
  if (ctx.state !== 'running') await ctx.resume();
  const node = ctx.createBufferSource();
  node.buffer = t.recorder.toAudioBuffer(ctx);
  node.connect(engine.master);
  let when = ctx.currentTime + 0.05, offset = 0;
  replaying = { node, takeId: t.id }; // the mic ignores hits while a take plays
  if (withGroove) {
    // Bring back the same groove and tempo, start it, then line the
    // recording up with its first beat.
    Object.assign(S, t.snapshot);
    refreshSequence(true);
    renderBpm();
    renderSwing();
    await togglePlay();
    ({ when, offset } = alignTake(t.recorder.startTime, t.firstBeat, engine.beatLog[0].time, t.latency, ctx.currentTime + 0.01));
  }
  node.onended = () => {
    if (!replaying || replaying.node !== node) return;
    replaying = null;
    renderTakes();
    if (withGroove && engine.playing) togglePlay();
  };
  node.start(when, offset);
  renderTakes();
}

$('takesList').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const t = takes.find(x => String(x.id) === b.closest('.take').dataset.id);
  if (!t) return;
  if (b.dataset.act === 'play') playTake(t, false);
  else if (b.dataset.act === 'groove') playTake(t, true);
  else if (b.dataset.act === 'wav') download(`${slug(t.name)}-${t.date.toISOString().slice(0, 16).replace(/[:T]/g, '-')}.wav`, encodeWav(t.recorder.samples(), t.recorder.sr), 'audio/wav');
  else if (b.dataset.act === 'report') { renderReport(t.take); $('fbReport').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
});

$('recToggle').addEventListener('click', () => {
  S.feedback.record = !S.feedback.record;
  saveSettings();
  renderMic();
  if (S.feedback.record && !mic.active) toast('Turn the microphone on to record takes');
});

// ================================================== a take = Play to Stop

bus.on('play', () => {
  if (replaying) return; // playing back a recorded take, not a new take
  take = newTake();
  $('fbReport').hidden = true;
  renderStats();
  drawTimeline();
  if (mic.active || midi.active) flashLast('Listening… play along');
  startRecording();
});
bus.on('stop', () => {
  if (replaying) { stopReplay(); return; }
  stopRecording();
  if (take.hits.length) { renderReport(); finishTake(); }
});
window.addEventListener('resize', () => drawTimeline());

export function renderFeedback() {
  $('fbUnsupported').hidden = MicInput.supported();
  setSeg($('fbRes'), String(S.feedback.res));
  renderInput();
  renderMic();
  renderMidi();
  renderCalib();
  renderHistory();
  drawTimeline();
}

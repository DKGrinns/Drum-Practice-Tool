// listen.js (UI) — the Listen tab: learn grooves from records.
//
// Sources: a Chrome tab (tab audio capture), an audio file, or the
// microphone. While listening live, the app keeps the last 30–60 s, shows
// the tempo with how sure it is, lights the beats and can click along,
// locked to the record. "Grab" turns what was just played into a clip: set
// a loop on its waveform (snapped to beats and bars), slow it down to
// 50–100% without changing the pitch, focus on the kick, snare or hats, and
// get a rough kick/snare/hat transcription to finish in the Builder.
//
// Timing: the capture tap stamps every chunk with its audio-clock frame,
// so beat times are on the same clock as the click. Live audio is heard
// through the app at that same moment (Chrome stops the tab playing by
// itself), so a click at a beat's capture time lands on the beat you hear.
// For loops, the stretch player reports which clip position it is playing
// at which frame, so clip beats map to exact output times at any speed.

import { $, clamp, S, saveSettings, engine } from './core.js';
import { setSeg, segHandler, setToggle, toast } from './widgets.js';
import { changeBpm } from './transport.js';
import { openInBuilder } from './builder.js';
import { DrumSynth } from '../synth.js';
import { LiveCapture, RollingBuffer, decodeFile, loadListenWorklet } from '../capture.js';
import {
  EnvelopeTracker, analyzeEnvelope, clipEnvelope, findTransients, fitBeats, confidenceWord,
} from '../tempo.js';
import { transcribe } from '../transcribe.js';
import { blankPattern, normalizePattern } from '../patterns.js';

export const panel = { id: 'listen', label: 'Listen', onShow: () => { drawLive(); drawClip(); } };

const L = S.listen;
const BEATS_PER_BAR = 4;
const MAX_FILE_SECONDS = 600;

const capture = new LiveCapture(engine);
let graph = null;      // audio nodes, made on first use
let rolling = null;    // RollingBuffer of the live audio
let tracker = null;    // EnvelopeTracker of the live audio
let nextFrame = null;  // expected frame of the next chunk
let peaks = null;      // live waveform: max level per 10 ms, ring
let liveTimer = null, tickTimer = null, rafOn = false;
let liveRes = null;    // last live analysis
let history = [];      // recent live BPMs (for a steady display)
let clip = null;       // { channels, sr, name, env, analysis, beats, peaks, duration }
let player = null;     // stretch-player node
let report = null;     // last position report from the player
let loopPlaying = false;
// What the tempo card shows and the click follows.
//   ratio: the user's ½× / 2× / ⅔× ... choice; shift: half a beat later;
//   oneTime (live) / oneIndex (clip): the user's "This is 1".
const user = { live: { ratio: 1, shift: false, oneTime: null }, clip: { ratio: 1, shift: false, oneIndex: null } };
let scheduled = [];    // [{ time, n }] beats scheduled for clicks / lights
let lastScheduled = -Infinity;
let transcript = null;
const loop = { start: 0, end: 0 }; // loop points in the clip (s)

// For the browser tests.
export const debug = { get graph() { return graph; }, get clip() { return clip; }, get report() { return report; }, get live() { return liveRes; }, get scheduled() { return scheduled; }, get loop() { return { ...loop }; }, get transcript() { return transcript; }, model: () => model() };

// ===================================================================== audio

function ensureGraph() {
  const ctx = engine.ensureAudio();
  if (graph) return graph;
  const input = ctx.createGain();
  const f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter();
  const makeup = ctx.createGain(), vol = ctx.createGain();
  input.connect(f1).connect(f2).connect(makeup).connect(vol).connect(ctx.destination);
  // The click goes straight out too (not through the engine's compressor,
  // which delays by a few ms), so it lines up with the record.
  const clickBus = ctx.createGain();
  clickBus.connect(ctx.destination);
  graph = { ctx, input, f1, f2, makeup, vol, clickBus, synth: new DrumSynth(ctx, clickBus) };
  applyFocus();
  applyVolumes();
  return graph;
}

// Drum focus filters: kick = low-pass, snare = band (cut lows, lift the
// crack), hats = high-pass. Makeup gain keeps the level similar.
const FOCUS = {
  all:   [['peaking', 1000, 0.7, 0], ['peaking', 1000, 0.7, 0], 1],
  kick:  [['lowpass', 150, 0.8, 0], ['lowpass', 150, 0.8, 0], 1.8],
  snare: [['highpass', 220, 0.7, 0], ['peaking', 2400, 0.9, 7], 1.1],
  hats:  [['highpass', 6500, 0.7, 0], ['highpass', 6500, 0.7, 0], 2.6],
};
function applyFocus() {
  if (!graph) return;
  const [a, b, g] = FOCUS[L.focus] || FOCUS.all;
  const t = graph.ctx.currentTime;
  for (const [f, [type, freq, q, gain]] of [[graph.f1, a], [graph.f2, b]]) {
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.Q.setValueAtTime(q, t);
    f.gain.setValueAtTime(gain, t);
  }
  graph.makeup.gain.setTargetAtTime(g, t, 0.02);
}
function applyVolumes() {
  if (!graph) return;
  const t = graph.ctx.currentTime;
  graph.vol.gain.setTargetAtTime(L.vol, t, 0.02);
  graph.clickBus.gain.setTargetAtTime(L.clickVol, t, 0.02);
}
const outLatency = () => (graph ? graph.ctx.outputLatency || graph.ctx.baseLatency || 0 : 0);

// ======================================================================= live

async function startLive() {
  const kind = L.source;
  ensureGraph();
  msg('');
  try {
    if (kind === 'tab') msg('Pick the tab with the music and tick “Also share tab audio”…');
    const info = await capture.start(kind, kind === 'tab' ? graph.input : null);
    // Live tab audio is heard through the app only when Chrome stopped the
    // tab playing by itself (otherwise you'd hear it twice). The mic never is.
    if (kind === 'tab' && !info.suppressed) capture.setMonitor(null);
    const sr = graph.ctx.sampleRate;
    rolling = new RollingBuffer(sr, L.bufferSec);
    peaks = { data: new Float32Array(L.bufferSec * 100), n: 0 };
    tracker = null;
    nextFrame = null;
    liveRes = null;
    history = [];
    user.live = { ratio: 1, shift: false, oneTime: null };
    capture.onChunk = onChunk;
    capture.onEnded = () => { stopLive(); msg('Sharing stopped.'); };
    if (kind === 'tab') {
      msg(info.suppressed
        ? `Listening to ${info.label ? `“${info.label}”` : 'the tab'}. Play the record there; you hear it through the app.`
        : 'Listening. (This browser keeps playing the tab itself, so the drum focus works on grabbed loops only.)');
    } else msg('Listening through the microphone. Play the record on a speaker near it.');
    liveTimer = setInterval(analyseLive, 1000);
    startTicking();
  } catch (e) {
    capture.stop();
    if (e.code === 'no-audio') msg('No sound was shared. Press Start again, choose the tab (Chrome Tab), and tick “Also share tab audio” before Share.', true);
    else if (e.code === 'denied') msg(kind === 'tab' ? 'Sharing was cancelled.' : 'Microphone permission was denied. Allow it in the address bar, then try again.', true);
    else if (e.code === 'unsupported') msg(kind === 'tab' ? 'Tab capture needs Chrome or Edge on a computer. Use an audio file or the microphone instead.' : 'This browser can’t use the microphone here.', true);
    else msg(`Couldn’t start: ${e.message}`, true);
  }
  applyVolumes();
  renderSourceUi();
}

function stopLive() {
  capture.stop();
  clearInterval(liveTimer);
  liveTimer = null;
  if (!loopPlaying) stopTicking();
  applyVolumes();
  renderSourceUi();
  drawLive();
}

function onChunk(channels, frame, peak) {
  const sr = graph.ctx.sampleRate;
  rolling.write(channels, frame);
  const n = channels[0].length;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = (channels[0][i] + channels[1][i]) * 0.5;
  // Restart the envelope after a gap, so its frame times stay right.
  if (!tracker || frame !== nextFrame) tracker = new EnvelopeTracker(sr, { startTime: frame / sr });
  tracker.push(mono);
  nextFrame = frame + n;
  // Live waveform: 10 ms peaks.
  const bin = Math.round(sr / 100);
  for (let i = 0; i < n; i += bin) {
    let m = 0;
    for (let j = i; j < Math.min(n, i + bin); j++) { const v = Math.abs(mono[j]); if (v > m) m = v; }
    peaks.data[peaks.n % peaks.data.length] = m;
    peaks.n++;
  }
  $('lsMeter').style.width = `${Math.min(100, Math.sqrt(peak) * 100)}%`;
}

function analyseLive() {
  if (!tracker || !capture.active) return;
  const rate = tracker.rate;
  const secs = tracker.length / rate;
  if (tracker.length > 75 * rate) tracker.trim(Math.round(70 * rate));
  if (secs < 4) { renderTempo(null, `Listening… ${Math.floor(secs)} s`); return; }
  // Silence (the record is paused): keep the last tempo, stop clicking.
  const recent = peaks.n > 300 ? Array.from({ length: 300 }, (_, i) => peaks.data[(peaks.n - 1 - i) % peaks.data.length]) : [];
  if (recent.length && Math.max(...recent) < 0.003) { liveRes = liveRes && { ...liveRes, silent: true }; renderTempo(liveRes, 'No sound — is the record playing?'); return; }
  const from = Math.max(0, tracker.length - Math.round(12 * rate));
  let res = analyzeEnvelope(tracker, { from });
  if (!res) { renderTempo(null, 'Listening…'); return; }
  const u = user.live;
  if (u.ratio !== 1) {
    const forced = analyzeEnvelope(tracker, { from, bpm: res.rawBpm * u.ratio });
    if (forced) res = { ...forced, confidence: res.confidence, alternatives: res.alternatives, rawBpm: res.rawBpm };
  }
  // A steady display: median of the last few estimates, reset when the
  // tempo really changes.
  if (history.length && Math.abs(res.bpm / history[history.length - 1] - 1) > 0.04) history = [];
  history.push(res.bpm);
  if (history.length > 5) history.shift();
  const sorted = history.slice().sort((a, b) => a - b);
  res.shownBpm = sorted[sorted.length >> 1];
  // Beats ahead: a line through the last 8 beats.
  const last = res.beats.slice(-8);
  res.line = fitBeats(last) || { period: 60 / res.bpm, t0: last[last.length - 1], lastIndex: 0 };
  if (u.shift) res.line = { ...res.line, t0: res.line.t0 + res.line.period / 2 };
  if (u.oneTime == null) res.oneTime = res.beats[res.downbeat] + (u.shift ? res.line.period / 2 : 0);
  else res.oneTime = u.oneTime;
  liveRes = res;
  renderTempo(res);
}

// ====================================================================== clips

async function makeClip(channels, sr, name) {
  msg('Analysing…');
  await new Promise(r => setTimeout(r, 20));
  const duration = channels[0].length / sr;
  const env = clipEnvelope(channels, sr);
  const transients = findTransients(channels, sr, env);
  clip = { channels, sr, name, env, transients, duration, peaks: clipPeaks(channels, sr) };
  user.clip = { ratio: 1, shift: false, oneIndex: null };
  analyseClip();
  // Default loop: the last 4 complete bars (or the whole clip).
  const ones = barLines();
  const bars = L.bars || 4;
  if (ones.length > bars) { loop.start = ones[ones.length - 1 - bars]; loop.end = ones[ones.length - 1]; }
  else { loop.start = 0; loop.end = duration; }
  if (L.bars) setLoopBars(L.bars, false);
  await sendClip();
  msg(clip.analysis ? `${name}: ${duration.toFixed(1)} s. Tap the waveform to move the loop.` : `${name}: no steady beat found; set the loop by hand (Free).`);
  $('lsLoopCard').hidden = false;
  $('lsTrCard').hidden = false;
  transcript = null;
  renderTranscript();
  renderTempo(clipModelRes());
  drawClip();
}

function analyseClip() {
  const u = user.clip;
  let a = analyzeEnvelope(clip.env);
  if (a && u.ratio !== 1) {
    const f = analyzeEnvelope(clip.env, { bpm: a.rawBpm * u.ratio });
    if (f) a = { ...f, confidence: a.confidence, alternatives: a.alternatives, rawBpm: a.rawBpm };
  }
  if (a && u.shift) {
    const P = 60 / a.bpm;
    a.beats = a.beats.map(b => b + P / 2).filter(b => b < clip.duration);
  }
  clip.analysis = a;
  clip.beats = a ? a.beats : [];
  clip.oneIndex = u.oneIndex != null ? u.oneIndex : a ? a.downbeat : 0;
}

// The clip's bar lines (times of every beat 1).
function barLines() {
  if (!clip || !clip.beats.length) return [];
  return clip.beats.filter((_, i) => ((i - clip.oneIndex) % BEATS_PER_BAR + BEATS_PER_BAR) % BEATS_PER_BAR === 0);
}

function clipPeaks(channels, sr) {
  const bin = Math.round(sr / 100), n = Math.ceil(channels[0].length / bin);
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let m = 0;
    for (const ch of channels) for (let i = k * bin; i < Math.min(ch.length, (k + 1) * bin); i++) { const v = Math.abs(ch[i]); if (v > m) m = v; }
    out[k] = m;
  }
  return out;
}

async function sendClip() {
  ensureGraph();
  await loadListenWorklet(graph.ctx);
  if (!player) {
    player = new AudioWorkletNode(graph.ctx, 'stretch-player', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    player.port.onmessage = e => { if (e.data.type === 'pos') report = { ...e.data, at: performance.now() }; };
    player.connect(graph.input);
  }
  stopLoop();
  const chs = clip.channels.map(c => c.slice());
  // Resample-free: the clip must be at the context's rate (files are
  // decoded to it, captures are recorded at it).
  player.port.postMessage({ type: 'clip', channels: chs, transients: clip.transients }, chs.map(c => c.buffer));
  sendLoop(false);
  player.port.postMessage({ type: 'speed', value: L.speed });
}

function sendLoop(restart) {
  if (!player || !clip) return;
  player.port.postMessage({ type: 'loop', start: loop.start * clip.sr, end: loop.end * clip.sr, restart });
  renderLoopInfo();
}

function playLoop() {
  if (!clip || !player) return;
  if (capture.active && capture.kind === 'tab') toast('Pause the record in its tab while you loop');
  player.port.postMessage({ type: 'play', pos: loop.start * clip.sr });
  report = null;
  scheduled = [];
  lastScheduled = -Infinity;
  loopPlaying = true;
  applyVolumes();
  startTicking();
  renderLoopButton();
  renderTempo(clipModelRes());
}
function stopLoop() {
  if (player) player.port.postMessage({ type: 'stop' });
  loopPlaying = false;
  report = null;
  if (!capture.active) stopTicking();
  applyVolumes();
  renderLoopButton();
}

// Loop length in bars from the loop start (0 = free).
function setLoopBars(bars, send = true) {
  L.bars = bars;
  if (bars && clip && clip.beats.length) {
    const i = nearestIndex(clip.beats, loop.start);
    const P = 60 / (clip.analysis ? clip.analysis.bpm : 100);
    loop.start = clip.beats[i];
    const j = i + bars * BEATS_PER_BAR;
    loop.end = j < clip.beats.length ? clip.beats[j] : clip.beats[clip.beats.length - 1] + (j - clip.beats.length + 1) * P;
    loop.end = Math.min(loop.end, clip.duration);
  }
  saveSettings();
  if (send) { sendLoop(true); drawClip(); }
  setSeg($('lsBars'), String(bars));
}

function moveLoopBars(dir) {
  if (!clip || !clip.beats.length) return;
  const ones = barLines();
  const len = loop.end - loop.start;
  let i = nearestIndex(ones, loop.start) + dir;
  i = clamp(i, 0, ones.length - 1);
  loop.start = ones[i];
  if (L.bars) setLoopBars(L.bars, false); else loop.end = Math.min(clip.duration, loop.start + len);
  sendLoop(true);
  drawClip();
}

function nearestIndex(arr, t) {
  let best = 0;
  for (let i = 1; i < arr.length; i++) if (Math.abs(arr[i] - t) < Math.abs(arr[best] - t)) best = i;
  return best;
}

// ============================================================ beats & clicks

// The tempo card's numbers for the clip.
function clipModelRes() {
  if (!clip || !clip.analysis) return null;
  return { ...clip.analysis, shownBpm: clip.analysis.bpm };
}

// What drives the tempo card right now: the loop while it plays or when
// there's no live capture; otherwise live.
function model() {
  if (clip && (loopPlaying || !capture.active)) return { mode: 'clip', res: clipModelRes() };
  return { mode: 'live', res: liveRes };
}

// Beats with heard times (audio clock, before the click offset) in [t0, t1).
function beatsBetween(t0, t1) {
  const out = [];
  if (loopPlaying && clip && report && clip.beats.length) {
    const sr = clip.sr, ls = report.loopStart, le = report.loopEnd, len = le - ls;
    const speed = report.speed;
    const base = report.frame / sr; // the clip is at report.pos at audio time `base`
    clip.beats.forEach((b, i) => {
      const x = b * sr;
      if (x < ls || x >= le) return;
      let d = x - report.pos;
      d = ((d % len) + len) % len;
      for (let t = base + d / speed / sr; t < t1; t += len / speed / sr) {
        if (t >= t0) out.push({ time: t, n: ((i - clip.oneIndex) % BEATS_PER_BAR + BEATS_PER_BAR) % BEATS_PER_BAR });
      }
    });
  } else if (!loopPlaying && liveRes && !liveRes.silent && capture.active) {
    const { period, t0: a } = liveRes.line;
    if (!(period > 0.2 && period < 2)) return out;
    for (let k = Math.ceil((t0 - a) / period); a + k * period < t1; k++) {
      const t = a + k * period;
      out.push({ time: t, n: ((Math.round((t - liveRes.oneTime) / period) % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR });
    }
  }
  return out.sort((x, y) => x.time - y.time);
}

function startTicking() {
  if (!tickTimer) tickTimer = setInterval(tick, 25);
  if (!rafOn) { rafOn = true; requestAnimationFrame(drawFrame); }
}
function stopTicking() {
  clearInterval(tickTimer);
  tickTimer = null;
  rafOn = false;
  scheduled = [];
  lastScheduled = -Infinity;
  renderDots(-1);
}

// Schedule clicks (and remember beats for the lights) ~150 ms ahead.
function tick() {
  if (!graph) return;
  const now = graph.ctx.currentTime;
  const off = L.clickOffset / 1000;
  const beats = beatsBetween(now + 0.02 - off, now + 0.15 - off);
  for (const b of beats) {
    const t = b.time + off;
    // One click per beat, even when the beat estimate moves a little.
    if (t <= lastScheduled + 0.25 * (60 / Math.max(40, currentBpm() || 100))) continue;
    lastScheduled = t;
    scheduled.push({ time: t, n: b.n });
    if (L.click) graph.synth.play(b.n === 0 ? 'accent' : 'click', t, 0.9);
  }
  if (scheduled.length > 32) scheduled.splice(0, scheduled.length - 32);
  // A big jump (new loop, seek, tempo change) re-arms the scheduler.
  if (lastScheduled > now + 2) lastScheduled = -Infinity;
}

function currentBpm() {
  const m = model();
  return m.res ? m.res.shownBpm || m.res.bpm : null;
}

function drawFrame() {
  if (!rafOn) return;
  if (graph) {
    const heard = graph.ctx.currentTime - outLatency();
    let cur = -1;
    for (const b of scheduled) if (b.time <= heard && heard - b.time < 0.6) cur = b.n;
    renderDots(cur);
    if (loopPlaying) drawClip();
  }
  requestAnimationFrame(drawFrame);
}

let shownDot = -2;
function renderDots(n) {
  if (n === shownDot) return;
  shownDot = n;
  $('lsDots').querySelectorAll('.beat-dot').forEach((d, i) => d.classList.toggle('on', i === n));
}

// ===================================================================== render

function msg(text, warn = false) {
  const m = $('lsMsg');
  m.textContent = text;
  m.classList.toggle('warn', warn);
}

function renderSourceUi() {
  setSeg($('lsSource'), L.source);
  const live = L.source !== 'file';
  $('lsTabHelp').hidden = L.source !== 'tab';
  $('lsMicHelp').hidden = L.source !== 'mic';
  $('lsFileRow').hidden = L.source !== 'file';
  $('lsStart').hidden = !live;
  $('lsStart').textContent = capture.active ? 'Stop listening' : 'Start listening';
  $('lsStart').classList.toggle('playing', capture.active);
  $('lsBufferCard').hidden = !live;
  $('lsGrab').disabled = !capture.active;
  setSeg($('lsBufSec'), String(L.bufferSec));
  $('lsBufLen').textContent = L.bufferSec;
  if (L.source === 'tab' && !LiveCapture.tabSupported()) msg('Tab capture needs Chrome or Edge on a computer. Use an audio file or the microphone instead.', true);
}

function renderTempo(res, note) {
  const u = model().mode === 'clip' ? user.clip : user.live;
  if (!res) {
    $('lsBpm').textContent = '—';
    $('lsConf').textContent = note || (L.source === 'file' ? 'Load a file' : 'Press Start listening');
    $('lsConfFill').style.width = '0%';
    $('lsUse').disabled = true;
    $('lsAlts').innerHTML = '';
    $('lsFeel').textContent = '';
    return;
  }
  const bpm = res.shownBpm || res.bpm;
  $('lsBpm').textContent = bpm.toFixed(bpm < 100 ? 1 : 0);
  $('lsConf').textContent = note || `${confidenceWord(res.confidence)} (${Math.round(res.confidence * 100)}%)` + (u.ratio !== 1 ? ` · you chose ${ratioName(u.ratio)}` : '');
  $('lsConfFill').style.width = `${Math.round(res.confidence * 100)}%`;
  $('lsConfFill').className = res.confidence >= 0.6 ? 'good' : res.confidence >= 0.35 ? 'ok' : 'low';
  $('lsUse').disabled = false;
  $('lsUse').textContent = `Use ${Math.round(bpm)} BPM`;
  const sw = res.swing;
  $('lsFeel').textContent = sw && sw.swing > 0 ? `Feel: swung ${sw.res === 16 ? '16ths' : '8ths'}, about ${Math.round(sw.swing * 100)}% (${sw.swing >= 0.85 ? 'shuffle / triplet' : 'light swing'})` : 'Feel: straight';
  // Other tempos that fit almost as well (3/2, 2/3, 4/3 ...).
  const alts = u.ratio === 1 ? (res.alternatives || []).filter(a => a.score >= 0.85 && ![0.5, 2].includes(a.ratio)) : [];
  $('lsAlts').innerHTML = alts.length ? 'Also fits: ' + alts.map(a => `<button class="chip" data-ratio="${a.ratio}">${Math.round(a.bpm)} BPM</button>`).join(' ') : '';
}
const ratioName = r => ({ 0.5: '½×', 2: '2×', 1.5: '1.5×', [2 / 3]: '⅔×', [4 / 3]: '4⁄3×', 0.75: '¾×' }[r] || `${r.toFixed(2)}×`);

function renderLoopButton() {
  const b = $('lsLoopPlay');
  b.textContent = loopPlaying ? '■ Stop loop' : '▶ Play loop';
  b.classList.toggle('playing', loopPlaying);
}

function renderLoopInfo() {
  if (!clip) return;
  const len = loop.end - loop.start;
  const P = clip.analysis ? 60 / clip.analysis.bpm : 0;
  const bars = P ? len / (P * BEATS_PER_BAR) : 0;
  $('lsLoopInfo').textContent = `${fmt(loop.start)}–${fmt(loop.end)}` + (P ? ` · ${Math.round(bars * 4) / 4} bar${Math.abs(bars - 1) < 0.01 ? '' : 's'}` : '');
}
const fmt = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

function renderTranscript() {
  const pre = $('lsTrPreview');
  $('lsOpenBuilder').disabled = !transcript;
  if (!transcript) { pre.textContent = ''; return; }
  const per = transcript.stepsPerBar / BEATS_PER_BAR;
  const row = (label, arr) => label.padEnd(6) + arr.map((v, i) => (i % per === 0 && i ? (i % transcript.stepsPerBar ? ' ' : ' | ') : '') + '-xXg'[v]).join('');
  pre.textContent = [row('Hats', transcript.tracks.hh), row('Snare', transcript.tracks.snare), row('Kick', transcript.tracks.kick)].join('\n');
}

// ================================================================ waveforms

function sizeCanvas(c) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return { w, h, dpr };
}

function drawLive() {
  const c = $('lsLive');
  if (!c.offsetParent) return;
  const { w, h } = sizeCanvas(c);
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  if (!peaks) return;
  const total = peaks.data.length, have = Math.min(peaks.n, total);
  g.fillStyle = '#2ee6c5';
  for (let x = 0; x < w; x++) {
    const a = Math.floor(x / w * total), b = Math.floor((x + 1) / w * total);
    let m = 0;
    for (let k = a; k < b; k++) {
      const age = total - k;           // bins from the newest
      if (age > have) continue;
      const v = peaks.data[(peaks.n - age) % total];
      if (v > m) m = v;
    }
    const y = Math.min(1, Math.sqrt(m)) * h * 0.48;
    g.fillRect(x, h / 2 - y, 1, Math.max(1, y * 2));
  }
  // Beat ticks from the live analysis.
  if (liveRes && rolling) {
    const endT = rolling.endFrame / rolling.sr, startT = endT - L.bufferSec;
    for (const b of liveRes.beats) {
      if (b < startT) continue;
      const x = (b - startT) / L.bufferSec * w;
      const one = Math.abs(((Math.round((b - liveRes.oneTime) / liveRes.line.period) % 4) + 4) % 4) === 0;
      g.fillStyle = one ? 'rgba(255,159,28,0.9)' : 'rgba(255,255,255,0.25)';
      g.fillRect(x, 0, one ? 2 : 1, h);
    }
  }
}
setInterval(() => { if (capture.active && S.tab === 'listen') drawLive(); }, 250);

// Clip view: the whole clip up to 60 s, otherwise the loop with 8 s around.
function clipView() {
  if (clip.duration <= 60) return [0, clip.duration];
  const a = Math.max(0, loop.start - 8), b = Math.min(clip.duration, loop.end + 8);
  return [a, Math.max(b, a + 1)];
}

function drawClip() {
  const c = $('lsWave');
  if (!clip || !c.offsetParent) return;
  const { w, h, dpr } = sizeCanvas(c);
  const g = c.getContext('2d');
  const [v0, v1] = clipView();
  const X = t => (t - v0) / (v1 - v0) * w;
  g.clearRect(0, 0, w, h);
  // Loop region.
  g.fillStyle = 'rgba(46,230,197,0.12)';
  g.fillRect(X(loop.start), 0, X(loop.end) - X(loop.start), h);
  // Waveform.
  const pk = clip.peaks;
  for (let x = 0; x < w; x++) {
    const a = Math.floor((v0 + x / w * (v1 - v0)) * 100), b = Math.max(a + 1, Math.floor((v0 + (x + 1) / w * (v1 - v0)) * 100));
    let m = 0;
    for (let k = a; k < b && k < pk.length; k++) if (pk[k] > m) m = pk[k];
    const inLoop = x >= X(loop.start) && x <= X(loop.end);
    g.fillStyle = inLoop ? '#2ee6c5' : '#4a5a6a';
    const y = Math.min(1, Math.sqrt(m)) * h * 0.46;
    g.fillRect(x, h / 2 - y, 1, Math.max(1, y * 2));
  }
  // Beats and bar lines.
  clip.beats.forEach((b, i) => {
    if (b < v0 || b > v1) return;
    const one = ((i - clip.oneIndex) % BEATS_PER_BAR + BEATS_PER_BAR) % BEATS_PER_BAR === 0;
    g.fillStyle = one ? 'rgba(255,159,28,0.95)' : 'rgba(255,255,255,0.22)';
    g.fillRect(X(b), 0, one ? 2 * dpr : dpr, one ? h : h * 0.18);
  });
  // Loop edges (handles).
  g.fillStyle = '#f4f7fa';
  for (const t of [loop.start, loop.end]) { g.fillRect(X(t) - dpr, 0, 2 * dpr, h); g.fillRect(X(t) - 5 * dpr, 0, 10 * dpr, 6 * dpr); }
  // Playhead.
  if (loopPlaying && report && graph) {
    const now = (graph.ctx.currentTime - outLatency()) * clip.sr;
    const len = report.loopEnd - report.loopStart;
    let p = report.pos + (now - report.frame) * report.speed;
    p = report.loopStart + ((((p - report.loopStart) % len) + len) % len);
    g.fillStyle = '#ff9f1c';
    g.fillRect(X(p / clip.sr) - dpr, 0, 2 * dpr, h);
  }
}

// Tap = move the loop to the nearest bar line (or beat when free); drag an
// edge = change that edge (snapped to beats).
let drag = null;
$('lsWave').addEventListener('pointerdown', e => {
  if (!clip) return;
  const c = $('lsWave');
  const r = c.getBoundingClientRect();
  const [v0, v1] = clipView();
  const t = v0 + (e.clientX - r.left) / r.width * (v1 - v0);
  const px = s => (s - v0) / (v1 - v0) * r.width;
  const nearStart = Math.abs(px(loop.start) - (e.clientX - r.left)) < 16;
  const nearEnd = Math.abs(px(loop.end) - (e.clientX - r.left)) < 16;
  if (nearStart || nearEnd) {
    drag = nearEnd && !nearStart ? 'end' : 'start';
    c.setPointerCapture(e.pointerId);
    return;
  }
  const snap = L.bars ? barLines() : clip.beats;
  const len = loop.end - loop.start;
  if (snap.length) {
    let i = 0;
    for (let k = 0; k < snap.length; k++) if (snap[k] <= t + 0.02) i = k;
    loop.start = snap[i];
  } else loop.start = clamp(t, 0, clip.duration - 0.5);
  if (L.bars) setLoopBars(L.bars, false); else loop.end = Math.min(clip.duration, loop.start + len);
  saveSettings();
  sendLoop(true);
  drawClip();
});
$('lsWave').addEventListener('pointermove', e => {
  if (!drag || !clip) return;
  const r = $('lsWave').getBoundingClientRect();
  const [v0, v1] = clipView();
  let t = clamp(v0 + (e.clientX - r.left) / r.width * (v1 - v0), 0, clip.duration);
  if (clip.beats.length) t = clip.beats[nearestIndex(clip.beats, t)];
  if (drag === 'start') loop.start = Math.min(t, loop.end - 0.25);
  else loop.end = Math.max(t, loop.start + 0.25);
  L.bars = 0;
  setSeg($('lsBars'), '0');
  renderLoopInfo();
  drawClip();
});
$('lsWave').addEventListener('pointerup', () => {
  if (!drag) return;
  drag = null;
  saveSettings();
  sendLoop(true);
});

// ===================================================================== wiring

segHandler($('lsSource'), v => {
  if (capture.active && v !== L.source) stopLive();
  L.source = v;
  saveSettings();
  msg('');
  renderSourceUi();
});

$('lsStart').addEventListener('click', () => (capture.active ? stopLive() : startLive()));

$('lsFile').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  ensureGraph();
  try {
    msg(`Opening “${f.name}”…`);
    let { channels, sampleRate } = await decodeFile(graph.ctx, f);
    if (sampleRate !== graph.ctx.sampleRate) throw new Error('unexpected sample rate');
    if (channels[0].length > MAX_FILE_SECONDS * sampleRate) {
      channels = channels.map(c => c.slice(0, MAX_FILE_SECONDS * sampleRate));
      toast('Only the first 10 minutes are used');
    }
    await makeClip(channels, sampleRate, f.name.replace(/\.[^.]+$/, ''));
  } catch (err) {
    msg(`Couldn’t read that file (${err.message}). Try an MP3, WAV, M4A or OGG.`, true);
  }
  e.target.value = '';
});

segHandler($('lsBufSec'), v => {
  L.bufferSec = Number(v);
  saveSettings();
  if (capture.active) {
    // Keep what we have, in a buffer of the new size.
    const old = rolling.read();
    rolling = new RollingBuffer(rolling.sr, L.bufferSec);
    const keep = Math.min(old.channels[0].length, rolling.size);
    const off = old.channels[0].length - keep;
    if (keep) rolling.write(old.channels.map(c => c.subarray(off)), old.startFrame + off);
    const np = { data: new Float32Array(L.bufferSec * 100), n: 0 };
    const have = Math.min(peaks.n, peaks.data.length, np.data.length);
    for (let i = have; i > 0; i--) { np.data[np.n % np.data.length] = peaks.data[(peaks.n - i) % peaks.data.length]; np.n++; }
    peaks = np;
  }
  renderSourceUi();
  drawLive();
});

$('lsGrab').addEventListener('click', async () => {
  if (!rolling || !rolling.length) return;
  const { channels } = rolling.read();
  if (channels[0].length < rolling.sr * 3) { toast('Listen a few seconds longer first'); return; }
  const now = new Date();
  await makeClip(channels, rolling.sr, `Grab ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`);
});

// Tempo card
$('lsHalf').addEventListener('click', () => changeRatio(0.5));
$('lsDouble').addEventListener('click', () => changeRatio(2));
$('lsAlts').addEventListener('click', e => { const b = e.target.closest('[data-ratio]'); if (b) changeRatio(Number(b.dataset.ratio), true); });
// k multiplies the current choice (½×, 2×); with `absolute` it replaces it
// (the "Also fits" tempos, relative to the detected one).
function changeRatio(k, absolute = false) {
  const m = model();
  const u = m.mode === 'clip' ? user.clip : user.live;
  const r = absolute ? k : u.ratio * k;
  if (r < 0.24 || r > 4.1) return;
  u.ratio = Math.abs(r - 1) < 1e-6 ? 1 : r;
  u.oneTime = null; u.oneIndex = null;
  refreshModel(m.mode);
}
$('lsShift').addEventListener('click', () => {
  const m = model();
  const u = m.mode === 'clip' ? user.clip : user.live;
  u.shift = !u.shift;
  u.oneTime = null; u.oneIndex = null;
  refreshModel(m.mode);
  toast(u.shift ? 'Beats moved half a beat later' : 'Beats back where they were');
});
$('lsOne').addEventListener('click', () => {
  if (!graph) return;
  const off = L.clickOffset / 1000;
  const heard = graph.ctx.currentTime - outLatency() - off;
  const m = model();
  if (m.mode === 'live' && liveRes) {
    const P = liveRes.line.period;
    const k = Math.round((heard - liveRes.line.t0) / P);
    user.live.oneTime = liveRes.line.t0 + k * P;
    liveRes.oneTime = user.live.oneTime;
    toast('Got it: that was beat 1');
  } else if (m.mode === 'clip' && clip && report && clip.beats.length) {
    const len = report.loopEnd - report.loopStart;
    let p = report.pos + (heard * clip.sr - report.frame) * report.speed;
    p = report.loopStart + ((((p - report.loopStart) % len) + len) % len);
    const i = nearestIndex(clip.beats, p / clip.sr);
    user.clip.oneIndex = ((i % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;
    clip.oneIndex = user.clip.oneIndex;
    toast('Got it: that was beat 1');
    drawClip();
  } else toast('Press this on a beat 1 while the music plays');
  scheduled = [];
  lastScheduled = -Infinity;
});
function refreshModel(mode) {
  scheduled = [];
  lastScheduled = -Infinity;
  if (mode === 'clip' && clip) {
    analyseClip();
    if (L.bars) setLoopBars(L.bars, false);
    sendLoop(false);
    renderTempo(clipModelRes());
    drawClip();
  } else analyseLive();
}
$('lsUse').addEventListener('click', () => {
  const bpm = currentBpm();
  if (!bpm) return;
  changeBpm(Math.round(bpm));
  toast(`Tempo set to ${Math.round(bpm)} BPM`);
});
$('lsClick').addEventListener('click', () => { L.click = !L.click; setToggle($('lsClick'), L.click); saveSettings(); });
$('lsClickVol').addEventListener('input', e => { L.clickVol = Number(e.target.value) / 100; applyVolumes(); saveSettings(); });
const setOffset = v => { L.clickOffset = clamp(Math.round(v), -200, 200); $('lsOffVal').textContent = L.clickOffset; saveSettings(); scheduled = []; lastScheduled = -Infinity; };
$('lsOffDown').addEventListener('click', () => setOffset(L.clickOffset - 5));
$('lsOffUp').addEventListener('click', () => setOffset(L.clickOffset + 5));

// Loop card
$('lsLoopPlay').addEventListener('click', () => (loopPlaying ? stopLoop() : playLoop()));
$('lsPrevBar').addEventListener('click', () => moveLoopBars(-1));
$('lsNextBar').addEventListener('click', () => moveLoopBars(1));
segHandler($('lsBars'), v => setLoopBars(Number(v)));
$('lsSpeed').addEventListener('input', e => {
  L.speed = Number(e.target.value) / 100;
  $('lsSpeedVal').textContent = `${Math.round(L.speed * 100)}%`;
  if (player) player.port.postMessage({ type: 'speed', value: L.speed });
  scheduled = [];
  lastScheduled = -Infinity;
  saveSettings();
});
segHandler($('lsSpeedQuick'), v => { $('lsSpeed').value = v; $('lsSpeed').dispatchEvent(new Event('input')); });
segHandler($('lsFocus'), v => { L.focus = v; setSeg($('lsFocus'), v); applyFocus(); saveSettings(); });
$('lsVol').addEventListener('input', e => { L.vol = Number(e.target.value) / 100; applyVolumes(); saveSettings(); });

// Transcription
segHandler($('lsGrid'), v => { L.grid = v; setSeg($('lsGrid'), v); saveSettings(); });
$('lsTranscribe').addEventListener('click', () => {
  if (!clip || !clip.beats.length) { toast('No beats found in this clip'); return; }
  const i = nearestIndex(clip.beats, loop.start);
  const beats = clip.beats.slice(i).filter(b => b <= loop.end + 0.05);
  const bars = clamp(Math.floor((beats.length - 1) / BEATS_PER_BAR) || 1, 1, 4);
  transcript = transcribe(clip.channels, clip.sr, clip.beats.slice(i), { bars, beatsPerBar: BEATS_PER_BAR, grid: L.grid, swing: clip.analysis.swing });
  renderTranscript();
  toast(transcript ? `Transcribed ${bars} bar${bars > 1 ? 's' : ''} from the loop start` : 'Nothing to transcribe');
});
$('lsOpenBuilder').addEventListener('click', async () => {
  if (!transcript) return;
  const bpm = Math.round(currentBpm() || 90);
  const p = blankPattern();
  p.stepsPerBar = transcript.stepsPerBar;
  p.bars = transcript.bars;
  p.bpm = bpm;
  p.swing = transcript.swing || 0;
  p.swingRes = transcript.swingRes === 16 ? 16 : 8;
  p.tracks = { kick: transcript.tracks.kick, snare: transcript.tracks.snare, hh: transcript.tracks.hh };
  const name = `${clip ? clip.name : 'Record'} (${bpm} BPM)`;
  await openInBuilder(normalizePattern(p), name);
});

// =================================================================== initial

export function renderListen() {
  renderSourceUi();
  setToggle($('lsClick'), L.click);
  $('lsClickVol').value = Math.round(L.clickVol * 100);
  $('lsOffVal').textContent = L.clickOffset;
  $('lsSpeed').value = Math.round(L.speed * 100);
  $('lsSpeedVal').textContent = `${Math.round(L.speed * 100)}%`;
  setSeg($('lsFocus'), L.focus);
  $('lsVol').value = Math.round(L.vol * 100);
  setSeg($('lsBars'), String(L.bars));
  setSeg($('lsGrid'), L.grid);
  renderTempo(null);
  renderLoopButton();
  if (!window.AudioWorkletNode) msg('This browser can’t run the Listen tools (no AudioWorklet). Use a recent Chrome, Edge, Safari or Firefox.', true);
}
window.addEventListener('resize', () => { if (S.tab === 'listen') { drawLive(); drawClip(); } });

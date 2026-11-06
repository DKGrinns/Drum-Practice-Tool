// Time-stretch (WSOLA) tests on synthetic signals: the slowed-down audio
// keeps its pitch and level, drum hits come out once each on the
// stretched grid, the loop wraps seamlessly, 100% speed is untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Stretcher } from '../js/listen-worklet.js';
import { OnsetDetector } from '../js/onset-worklet.js';
import { renderGroove } from './groove-audio.js';
import { findTransients } from '../js/tempo.js';

function run(st, seconds, sr, block = 128) {
  const n = Math.round(seconds * sr);
  const outL = new Float32Array(n), outR = new Float32Array(n);
  const positions = [];
  for (let i = 0; i < n; i += block) {
    const len = Math.min(block, n - i);
    const l = new Float32Array(len), r = new Float32Array(len);
    positions.push([i, st.position()]);
    st.process([l, r]);
    outL.set(l, i); outR.set(r, i);
  }
  return { outL, outR, positions };
}

function sine(sr, seconds, freqs, amp = 0.3) {
  const x = new Float32Array(Math.round(sr * seconds));
  for (let i = 0; i < x.length; i++) for (const f of freqs) x[i] += amp * Math.sin(2 * Math.PI * f * i / sr) / freqs.length;
  return x;
}

// Frequency from zero crossings (with interpolation) over [a, b) seconds.
function zcFreq(x, sr, a, b) {
  const cross = [];
  for (let i = Math.round(a * sr) + 1; i < Math.round(b * sr); i++) {
    if (x[i - 1] < 0 && x[i] >= 0) cross.push(i - 1 + x[i - 1] / (x[i - 1] - x[i]));
  }
  return (cross.length - 1) / ((cross[cross.length - 1] - cross[0]) / sr);
}

// Magnitude of frequency f in x[a..b) (single DFT bin, Hann window).
function bin(x, sr, f, a, b) {
  let re = 0, im = 0;
  const n = b - a;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
    re += w * x[a + i] * Math.cos(2 * Math.PI * f * i / sr);
    im += w * x[a + i] * Math.sin(2 * Math.PI * f * i / sr);
  }
  return Math.hypot(re, im) / n;
}

test('at 100% the clip plays back untouched (after a 15 ms fade-in)', () => {
  const sr = 44100;
  const { buf } = renderGroove({ bpm: 100, bars: 2, tracks: { kick: 'x---x---x---x---', snare: '----x-------x---', hh: 'xxxxxxxxxxxxxxxx' } });
  const st = new Stretcher(sr);
  st.setClip([buf]);
  const { outL } = run(st, 3, sr);
  let maxErr = 0;
  for (let i = st.hop; i < outL.length; i++) maxErr = Math.max(maxErr, Math.abs(outL[i] - buf[i]));
  assert.ok(maxErr < 1e-5, `max difference ${maxErr}`);
});

for (const sr of [44100, 48000]) {
  for (const speed of [0.5, 0.75]) {
    test(`a 440 Hz tone and a chord keep their pitch at ${speed * 100}% (${sr} Hz)`, () => {
      const st = new Stretcher(sr);
      st.setClip([sine(sr, 4, [440])]);
      st.setSpeed(speed);
      const { outL, positions } = run(st, 4, sr);
      const f = zcFreq(outL, sr, 0.5, 3.5);
      assert.ok(Math.abs(f - 440) < 1.5, `pitch ${f.toFixed(2)} Hz`);
      // Musical position advances at the chosen speed.
      const [i0, p0] = positions[100], [i1, p1] = positions[positions.length - 100];
      const rate = (p1 - p0) / (i1 - i0);
      assert.ok(Math.abs(rate - speed) < 0.01, `position rate ${rate}`);
      // No dips in level (phasing) in 20 ms windows.
      const rms = [];
      const w = Math.round(sr * 0.02);
      for (let a = Math.round(0.2 * sr); a + w < outL.length - sr * 0.2; a += w) {
        let s = 0;
        for (let i = a; i < a + w; i++) s += outL[i] * outL[i];
        rms.push(Math.sqrt(s / w));
      }
      const lo = Math.min(...rms), hi = Math.max(...rms);
      assert.ok(20 * Math.log10(hi / lo) < 1.5, `level varies ${(20 * Math.log10(hi / lo)).toFixed(2)} dB`);

      // A chord: each note stays, nothing appears between them.
      const st2 = new Stretcher(sr);
      st2.setClip([sine(sr, 4, [220, 277.2, 329.6])]);
      st2.setSpeed(speed);
      const c = run(st2, 4, sr).outL;
      const a = Math.round(sr), b = a + Math.round(sr * 0.5);
      const ref = bin(c, sr, 220, a, b);
      for (const fq of [277.2, 329.6]) assert.ok(bin(c, sr, fq, a, b) > ref * 0.8, `chord note ${fq} kept`);
      for (const fq of [200, 250, 300, 360]) assert.ok(bin(c, sr, fq, a, b) < ref * 0.1, `no stray tone at ${fq} Hz`);
    });
  }
}

for (const speed of [0.5, 0.6, 0.7, 0.75, 0.85, 0.9]) {
  test(`drum hits come out once each, exactly on the stretched grid, at ${speed * 100}%`, () => {
    const sr = 44100;
    // Funk groove at 100 BPM: 8th-note hats, kick and snare, ghost notes.
    const g = renderGroove({ bpm: 100, bars: 2, lead: 0.2, jitter: 0, noise: 0.0005, tracks: { kick: 'x-----x---x-----', snare: '----x-------x---', hh: 'x-x-x-x-x-x-x-x-' } });
    const st = new Stretcher(sr);
    st.setClip([g.buf], findTransients([g.buf], sr));
    st.setSpeed(speed);
    const seconds = (0.2 + 4.8) / speed;
    const { outL, positions } = run(st, seconds, sr);
    const found = [];
    const det = new OnsetDetector({ sampleRate: sr, sensitivity: 55, onOnset: o => found.push(o) });
    for (let i = 0; i < outL.length; i += 128) det.process(outL.subarray(i, i + 128), i);
    // Every 8th note in the source has a hit: 2 bars × 8 = 16, each heard
    // once, exactly at its slowed-down time.
    const expected = Array.from({ length: 16 }, (_, k) => (0.2 + k * 0.3) / speed);
    const main = expected.map(e => found.filter(f => Math.abs(f.time - e) < 0.004));
    main.forEach((m, k) => assert.equal(m.length, 1, `hit ${k} at ${expected[k].toFixed(3)} s heard ${m.length} times`));
    // The reported musical position (used for the click locked to the loop)
    // says each hit is where it is actually heard (within the 5 ms frames
    // the transients are found on).
    main.forEach((m, k) => {
      const src = (0.2 + k * 0.3) * sr;
      const j = positions.findIndex(([, p], i) => i > 0 && positions[i - 1][1] <= src && p > src);
      const [i0, p0] = positions[j - 1], [i1, p1] = positions[j];
      const heardAt = (i0 + (src - p0) / (p1 - p0) * (i1 - i0)) / sr;
      assert.ok(Math.abs(heardAt - m[0].time) < 0.0035, `hit ${k}: position says ${heardAt.toFixed(4)} s, heard at ${m[0].time.toFixed(4)} s`);
    });
    // Anything else is a faint echo of a decay being stretched, at least
    // 20 dB below the quietest hit (inaudible under the music).
    const quietest = Math.min(...main.map(m => m[0].peak));
    for (const f of found.filter(f => !expected.some(e => Math.abs(f.time - e) < 0.004))) {
      const db = 20 * Math.log10(f.peak / quietest);
      assert.ok(db < -20, `extra onset at ${f.time.toFixed(3)} s only ${db.toFixed(1)} dB below the hits`);
    }
  });
}

test('the loop wraps seamlessly and the position stays inside it', () => {
  const sr = 44100;
  const x = sine(sr, 5, [97.3]); // loop length not a whole number of cycles
  const st = new Stretcher(sr);
  st.setClip([x]);
  st.setLoop(sr * 1.0, sr * 2.37);
  st.reset(sr * 1.0);
  st.setSpeed(0.8);
  const { outL, positions } = run(st, 6, sr);
  for (const [, p] of positions) assert.ok(p >= sr * 1.0 - 1 && p < sr * 2.37 + 1, `position ${p}`);
  // No clicks: the biggest sample-to-sample step is close to the sine's own.
  const own = 0.3 * 2 * Math.PI * 97.3 / sr;
  let maxStep = 0;
  for (let i = st.hop + 1; i < outL.length; i++) maxStep = Math.max(maxStep, Math.abs(outL[i] - outL[i - 1]));
  assert.ok(maxStep < own * 2, `max step ${maxStep.toFixed(4)} vs sine ${own.toFixed(4)}`);
  assert.ok(outL.every(Number.isFinite));
});

test('stereo channels stay separate', () => {
  const sr = 48000;
  const st = new Stretcher(sr);
  st.setClip([sine(sr, 2, [330]), new Float32Array(sr * 2)]);
  st.setSpeed(0.5);
  const { outL, outR } = run(st, 2, sr);
  let l = 0, r = 0;
  for (let i = sr * 0.5; i < sr * 1.5; i++) { l = Math.max(l, Math.abs(outL[i])); r = Math.max(r, Math.abs(outR[i])); }
  assert.ok(l > 0.2 && r === 0, `left ${l} right ${r}`);
});

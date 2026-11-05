// Onset detector tests with synthetic drum audio at known times.
import test from 'node:test';
import assert from 'node:assert/strict';
import { OnsetDetector } from '../js/onset-worklet.js';

const SR = 48000;

// Deterministic noise.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296 * 2 - 1; };
}

// Render a drum-like hit: a click of noise + a decaying body.
//   kind 'snare': noisy, 'kick': low sine with pitch drop, 'hat': short noise
function addHit(buf, t, amp, kind, rand) {
  const start = Math.round(t * SR);
  const len = Math.round(0.35 * SR);
  for (let i = 0; i < len && start + i < buf.length; i++) {
    const s = i / SR;
    let v;
    if (kind === 'kick') v = Math.sin(2 * Math.PI * (55 * s + 60 * (1 - Math.exp(-s / 0.03)) * 0.03)) * Math.exp(-s / 0.12) + 0.3 * rand() * Math.exp(-s / 0.002);
    else if (kind === 'hat') v = rand() * Math.exp(-s / 0.02);
    // snare: a fast-decaying crack plus a quieter, longer ring (like a real snare)
    else v = (0.7 * rand() + 0.3 * Math.sin(2 * Math.PI * 190 * s)) * (Math.exp(-s / 0.015) + 0.15 * Math.exp(-s / 0.08));
    const attack = Math.min(1, i / (0.0008 * SR)); // 0.8 ms attack
    buf[start + i] += amp * v * attack;
  }
}

function detect(buf, sensitivity = 60) {
  const found = [];
  const det = new OnsetDetector({ sampleRate: SR, sensitivity, onOnset: o => found.push(o) });
  for (let i = 0; i < buf.length; i += 128) det.process(buf.subarray(i, i + 128), i);
  return found;
}

function scene(hits, seconds, noise = 0.001, seed = 1) {
  const rand = rng(seed);
  const buf = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < buf.length; i++) buf[i] = noise * rand();
  for (const h of hits) addHit(buf, h.t, h.amp, h.kind, rand);
  return buf;
}

function assertMatches(found, hits, tolMs = 1.5) {
  assert.equal(found.length, hits.length, `found ${found.length} hits, expected ${hits.length}: ${found.map(f => f.time.toFixed(4))}`);
  hits.forEach((h, i) => {
    const err = (found[i].time - h.t) * 1000;
    assert.ok(Math.abs(err) <= tolMs, `hit ${i} (${h.kind} @${h.t}s) off by ${err.toFixed(2)} ms`);
  });
}

test('finds a steady groove of kick, snare and hats to within ~1 ms', () => {
  const hits = [];
  // 100 BPM 8th notes for 4 bars: kick on 1/3, snare on 2/4, hats on 8ths between
  for (let n = 0; n < 32; n++) {
    const t = 0.2 + n * 0.3;
    const beat = Math.floor(n / 2) % 4;
    if (n % 2) hits.push({ t, amp: 0.25, kind: 'hat' });
    else hits.push({ t, amp: 0.8, kind: beat % 2 ? 'snare' : 'kick' });
  }
  assertMatches(detect(scene(hits, 10.2)), hits);
});

test('catches a ghost note 90 ms after a loud backbeat', () => {
  const hits = [
    { t: 0.3, amp: 0.9, kind: 'snare' },
    { t: 0.39, amp: 0.07, kind: 'snare' },   // ghost, ~22 dB quieter
    { t: 0.6, amp: 0.9, kind: 'snare' },
    { t: 0.69, amp: 0.07, kind: 'snare' },
  ];
  assertMatches(detect(scene(hits, 1.2), 75), hits);
});

test('fast 16ths at 160 BPM (94 ms apart) are all separated', () => {
  const hits = Array.from({ length: 24 }, (_, i) => ({ t: 0.2 + i * 0.09375, amp: i % 4 ? 0.3 : 0.7, kind: 'snare' }));
  assertMatches(detect(scene(hits, 2.6)), hits);
});

test('no false hits from room noise, slow swells or a single ringing hit', () => {
  // Noise only
  assert.equal(detect(scene([], 2, 0.004)).length, 0, 'room noise');
  // Slow swell (crescendo without an attack)
  const buf = new Float32Array(SR * 2);
  for (let i = 0; i < buf.length; i++) buf[i] = 0.3 * (i / buf.length) * Math.sin(2 * Math.PI * 220 * i / SR);
  assert.equal(detect(buf).length, 0, 'slow swell');
  // One long ringing hit counts once
  assert.equal(detect(scene([{ t: 0.2, amp: 0.9, kind: 'kick' }], 1.5)).length, 1, 'ringing kick');
});

test('sensitivity sets the quietest hit that counts', () => {
  const hits = [{ t: 0.2, amp: 0.02, kind: 'snare' }, { t: 0.6, amp: 0.5, kind: 'snare' }];
  assert.equal(detect(scene(hits, 1), 20).length, 1, 'low sensitivity ignores the quiet hit');
  assert.equal(detect(scene(hits, 1), 80).length, 2, 'high sensitivity hears it');
});

test('quiet speaker bleed of a click is ignored at a sensible sensitivity', () => {
  // App click through a phone speaker heard by the mic: small, short.
  const clicks = [0.2, 0.7, 1.2].map(t => ({ t, amp: 0.008, kind: 'hat' }));
  const drums = [0.45, 0.95].map(t => ({ t, amp: 0.7, kind: 'snare' }));
  const found = detect(scene([...clicks, ...drums].sort((a, b) => a.t - b.t), 1.6), 45);
  assertMatches(found, drums);
});

test('reports a peak level that follows how hard the hit was', () => {
  const hits = [{ t: 0.2, amp: 0.1, kind: 'snare' }, { t: 0.6, amp: 0.8, kind: 'snare' }];
  const f = detect(scene(hits, 1), 70);
  assert.equal(f.length, 2);
  assert.ok(f[1].peak > f[0].peak * 4, `${f[0].peak} vs ${f[1].peak}`);
});

test('time base follows the absolute sample index passed in', () => {
  const hits = [{ t: 0.25, amp: 0.6, kind: 'snare' }];
  const buf = scene(hits, 0.6);
  const found = [];
  const det = new OnsetDetector({ sampleRate: SR, onOnset: o => found.push(o) });
  const offset = SR * 100; // audio clock already at 100 s
  for (let i = 0; i < buf.length; i += 128) det.process(buf.subarray(i, i + 128), offset + i);
  assert.ok(Math.abs(found[0].time - 100.25) < 0.0015, String(found[0].time));
});

test('randomized 2-minute performance: no misses, no false hits, tight timing (44.1 and 48 kHz)', () => {
  for (const sr of [44100, 48000]) {
    const rand = rng(99);
    const hits = [];
    let t = 0.3;
    while (t < 120) {
      const r = (rand() + 1) / 2;
      const kind = r < 0.3 ? 'kick' : r < 0.6 ? 'snare' : 'hat';
      const ghost = kind === 'snare' && rand() > 0.5;
      hits.push({ t, amp: ghost ? 0.06 + 0.04 * Math.abs(rand()) : 0.3 + 0.6 * Math.abs(rand()), kind });
      t += 0.1 + 0.25 * Math.abs(rand()); // 100–350 ms apart, uneven like real playing
    }
    // render at this sample rate
    const buf = new Float32Array(Math.round(121 * sr));
    for (let i = 0; i < buf.length; i++) buf[i] = 0.0015 * rand();
    for (const h of hits) {
      const start = Math.round(h.t * sr);
      for (let i = 0; i < 0.35 * sr && start + i < buf.length; i++) {
        const s = i / sr;
        let v;
        // kick: low body plus the beater click every real kick has
        if (h.kind === 'kick') v = Math.sin(2 * Math.PI * 55 * s) * Math.exp(-s / 0.12) + 0.3 * rand() * Math.exp(-s / 0.002);
        else if (h.kind === 'hat') v = rand() * Math.exp(-s / 0.02);
        else v = (0.7 * rand() + 0.3 * Math.sin(2 * Math.PI * 190 * s)) * (Math.exp(-s / 0.015) + 0.15 * Math.exp(-s / 0.08));
        buf[start + i] += h.amp * v * Math.min(1, i / (0.0008 * sr));
      }
    }
    const found = [];
    const det = new OnsetDetector({ sampleRate: sr, sensitivity: 75, onOnset: o => found.push(o) });
    for (let i = 0; i < buf.length; i += 128) det.process(buf.subarray(i, i + 128), i);
    assert.equal(found.length, hits.length, `${sr} Hz: found ${found.length} of ${hits.length}`);
    const errs = hits.map((h, i) => Math.abs(found[i].time - h.t) * 1000).sort((a, b) => a - b);
    const p95 = errs[Math.floor(errs.length * 0.95)];
    assert.ok(p95 < 1.5, `${sr} Hz: 95% of hits within ${p95.toFixed(2)} ms`);
    assert.ok(errs[errs.length - 1] < 3, `${sr} Hz: worst ${errs[errs.length - 1].toFixed(2)} ms`);
  }
});

test('a loud hit 15 ms after a quiet speaker click is still caught (not swallowed)', () => {
  const hits = [
    { t: 0.3, amp: 0.02, kind: 'hat' },    // click from the speaker
    { t: 0.315, amp: 0.8, kind: 'snare' }, // your hit, 15 ms late
    { t: 0.8, amp: 0.02, kind: 'hat' },
    { t: 0.79, amp: 0.8, kind: 'snare' },  // your hit, 10 ms early (click lands in its tail)
  ].sort((a, b) => a.t - b.t);
  const found = detect(scene(hits, 1.2), 92);
  const near = t => found.some(f => Math.abs(f.time - t) < 0.0015);
  assert.ok(near(0.315), 'late hit after click found: ' + found.map(f => f.time.toFixed(4)));
  assert.ok(near(0.79), 'early hit found');
  // and a single loud hit still counts once
  assert.equal(detect(scene([{ t: 0.2, amp: 0.9, kind: 'snare' }], 1), 92).length, 1);
});

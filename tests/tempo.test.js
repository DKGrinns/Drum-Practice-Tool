// Tempo detection, beat tracking, downbeat, swing and drum transcription
// on synthetic "records" in the styles the app is built around: reggae
// (one-drop with an empty beat 1, steppers), funk with ghost notes, soul
// and blues shuffles, jazz, neo-soul 16th swing, Latin and Brazilian feels,
// with human timing and room noise. See tests/groove-audio.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderGroove, addNoise, FEELS } from './groove-audio.js';
import {
  analyzeClip, analyzeEnvelope, clipEnvelope, EnvelopeTracker, estimateTempo, fitBeats, rescaleBeats, findTransients, ENV_RATE,
} from '../js/tempo.js';
import { transcribe } from '../js/transcribe.js';

// Three takes of every feel: clean, and two noisy ones with sloppier time.
const TAKES = [
  { seed: 7, noise: 0, jitter: 0.004, label: 'clean' },
  { seed: 11, noise: 0.04, jitter: 0.007, label: 'noisy' },
  { seed: 99, noise: 0.03, jitter: 0.005, label: 'noisy 2' },
];
function take(name, t, extra = {}) {
  const r = renderGroove({ bars: 8, seed: t.seed, jitter: t.jitter, ...FEELS[name].g, ...extra });
  if (t.noise) addNoise(r.buf, t.noise, t.seed);
  return r;
}
const close = (a, b, tol = 0.02) => Math.abs(a / b - 1) < tol;

// Share of tracked beats within 25 ms of the true beat grid, and the median
// error (ms). At half tempo every other true beat counts; at double tempo
// the grid is halved.
function beatAccuracy(a, r, bpm) {
  const ratio = Math.round(a.bpm / bpm * 6) / 6;
  const per = ratio < 1 ? 60 / bpm : 60 / bpm / ratio;
  const lead = r.beats[0];
  const errs = a.beats.map(b => { const x = (b - lead) / per; return Math.abs(x - Math.round(x)) * per * 1000; });
  const sorted = errs.slice().sort((x, y) => x - y);
  return { good: errs.filter(e => e < 25).length / errs.length, median: sorted[sorted.length >> 1] };
}

// The tempo the app's groove library uses must come out first, and the
// beats must sit on the music.
const STRICT = ['rock100', 'funk96', 'funk105b', 'onedrop72', 'onedropSwing66', 'steppers76', 'shuffle90', 'samba100', 'neo84', 'chacha120', 'dembow95', 'afrobeat110'];
for (const name of STRICT) {
  test(`tempo and beats: ${name}`, () => {
    for (const t of TAKES) {
      const r = take(name, t);
      const a = analyzeClip([r.buf], r.sr);
      const want = FEELS[name].pref[0];
      assert.ok(close(a.bpm, want), `${t.label}: ${a.bpm.toFixed(2)} BPM, want ${want}`);
      const acc = beatAccuracy(a, r, FEELS[name].g.bpm);
      assert.ok(acc.good >= 0.85, `${t.label}: only ${(acc.good * 100).toFixed(0)}% of beats on the music`);
      if (!t.noise) assert.ok(acc.median <= 6, `${t.label}: median beat error ${acc.median.toFixed(1)} ms`);
    }
  });
}

// Fast or slow counts where either octave is a fair answer: the main
// estimate is one of them and the other is offered as ½× or 2×.
for (const name of ['jazz140', 'ska160', 'waltz3']) {
  test(`tempo octave is right or offered: ${name}`, () => {
    for (const t of TAKES) {
      const r = take(name, t);
      const a = analyzeClip([r.buf], r.sr);
      const { pref, ok } = FEELS[name];
      const all = [...pref, ...ok];
      assert.ok(all.some(b => close(a.bpm, b)), `${t.label}: ${a.bpm.toFixed(2)} BPM`);
      if (!pref.some(b => close(a.bpm, b))) {
        assert.ok(a.alternatives.some(x => pref.some(b => close(x.bpm, b))), `${t.label}: ${pref[0]} not offered`);
      }
      assert.ok(beatAccuracy(a, r, FEELS[name].g.bpm).good >= 0.85, `${t.label}: beats off the music`);
    }
  });
}

test('half-time shuffle (every triplet filled): 80 BPM is found or offered', () => {
  // With a ghost note on every middle triplet the groove also reads as 120
  // in straight 8ths; the right count must at least be offered.
  for (const t of TAKES) {
    const a = analyzeClip([take('halfshuffle80', t).buf], 44100);
    const ok = close(a.bpm, 80) || a.alternatives.some(x => close(x.bpm, 80) && x.score >= 0.8);
    assert.ok(ok, `${t.label}: ${a.bpm.toFixed(1)} BPM, alternatives ${a.alternatives.map(x => `${x.bpm.toFixed(0)}:${x.score}`).join(' ')}`);
  }
});

test('bossa nova: the tempo (or its half) is found', () => {
  // Kick and bass on 1, the "&" of 2, 3 and the "&" of 4 make the beat
  // phase genuinely ambiguous; the Listen tab has a "shift ½ beat" button.
  for (const t of TAKES) {
    const a = analyzeClip([take('bossa130', t).buf], 44100);
    assert.ok(close(a.bpm, 130) || close(a.bpm, 65), `${t.label}: ${a.bpm.toFixed(1)}`);
  }
});

test('confidence: high on clear grooves, low on noise and free time', () => {
  const confs = STRICT.map(n => analyzeClip([take(n, TAKES[0]).buf], 44100).confidence);
  const avg = confs.reduce((x, y) => x + y, 0) / confs.length;
  assert.ok(avg >= 0.6, `average confidence on clean grooves ${avg.toFixed(2)}`);
  assert.ok(confs.every(c => c >= 0.2), `lowest ${Math.min(...confs)}`);
  // Pure noise.
  const noise = addNoise(new Float32Array(44100 * 12), 0.2, 5);
  const an = analyzeClip([noise], 44100);
  assert.ok(!an || an.confidence < 0.3, `noise confidence ${an && an.confidence}`);
  // Random hits with no steady pulse (rubato / free time).
  const r = renderGroove({ bpm: 100, bars: 1, tracks: {}, noise: 0.002 });
  const buf = new Float32Array(44100 * 14);
  let rand = 1;
  const rnd = () => { rand = (rand * 16807) % 2147483647; return rand / 2147483647; };
  for (let t = 0.3; t < 13; t += 0.15 + rnd() * 0.6) {
    const s = Math.round(t * 44100);
    for (let i = 0; i < 4000 && s + i < buf.length; i++) buf[s + i] += (rnd() * 2 - 1) * 0.5 * Math.exp(-i / 600);
  }
  void r;
  const af = analyzeClip([buf], 44100);
  assert.ok(!af || af.confidence < 0.35, `free-time confidence ${af && af.confidence}`);
});

test('tempo is precise: 97.3 BPM within ±0.1, at 44.1 and 48 kHz', () => {
  for (const sr of [44100, 48000]) {
    const r = renderGroove({ bpm: 97.3, bars: 12, sr, jitter: 0.003, tracks: FEELS.rock100.g.tracks, chords: [0, 5] });
    const a = analyzeClip([r.buf], sr);
    assert.ok(Math.abs(a.bpm - 97.3) < 0.1, `${sr}: ${a.bpm.toFixed(3)}`);
  }
});

test('a band that speeds up (100 → 104 over 16 bars) is followed beat by beat', () => {
  const sr = 44100;
  // Render beat by beat with a rising tempo.
  const buf = new Float32Array(sr * 44);
  const parts = [];
  let t = 0.4;
  for (let b = 0; b < 64; b++) {
    const bpm = 100 + 4 * b / 63;
    parts.push({ t, dur: 60 / bpm, b });
    t += 60 / bpm;
  }
  for (const p of parts) {
    const one = renderGroove({ bpm: 60 / p.dur, bars: 1, beatsPerBar: 1, lead: 0, jitter: 0, noise: 0, seed: p.b + 1,
      tracks: { kick: p.b % 2 ? '----' : 'x---', snare: p.b % 2 ? 'x---' : '----', hh: 'x-x-' } });
    const s = Math.round(p.t * sr);
    for (let i = 0; i < one.buf.length && s + i < buf.length; i++) buf[s + i] += one.buf[i];
  }
  addNoise(buf, 0.003);
  const a = analyzeClip([buf], sr);
  const errs = a.beats.map(b => Math.min(...parts.map(p => Math.abs(p.t - b))) * 1000);
  const good = errs.filter(e => e < 25).length / errs.length;
  assert.ok(close(a.bpm, 102, 0.03), `bpm ${a.bpm.toFixed(2)}`);
  assert.ok(good >= 0.9, `${(good * 100).toFixed(0)}% of beats on the music`);
});

test('live: the last 10 s show the new tempo after the band changes tempo', () => {
  const sr = 44100;
  const a = renderGroove({ bpm: 90, bars: 8, lead: 0.3, tracks: FEELS.funk96.g.tracks });
  const b = renderGroove({ bpm: 110, bars: 10, lead: 0, tracks: FEELS.funk96.g.tracks, seed: 3 });
  const tr = new EnvelopeTracker(sr);
  // Stream in 2048-sample chunks, as the capture does.
  const all = new Float32Array(a.buf.length + b.buf.length);
  all.set(a.buf); all.set(b.buf, a.buf.length);
  for (let i = 0; i < all.length; i += 2048) tr.push(all.subarray(i, i + 2048));
  const res = analyzeEnvelope(tr, { from: tr.length - Math.round(10 * tr.rate) });
  assert.ok(close(res.bpm, 110), `live ${res.bpm.toFixed(2)}`);
  // Trimming old frames keeps the frame times right.
  const before = tr.frameTime(tr.length - 1);
  tr.trim(Math.round(12 * tr.rate));
  assert.ok(Math.abs(tr.frameTime(tr.length - 1) - before) < 1e-9);
  const res2 = analyzeEnvelope(tr, { from: tr.length - Math.round(10 * tr.rate) });
  assert.ok(Math.abs(res2.beats[3] - res.beats[3]) < 0.002, 'same beats after trimming');
  // Streaming gives the same envelope as the whole clip at once.
  const whole = clipEnvelope([all], sr);
  assert.equal(whole.length, tr.length + tr.dropped);
});

test('downbeat: beat 1 is found, including the one-drop (nothing on 1)', () => {
  // (A plain rock beat or shuffle, kick on 1 and 3 and snare on 2 and 4, is
  // the same from beat 1 or beat 3; there the chord changes of a real record
  // decide, or the "This is 1" button.)
  for (const name of ['onedrop72', 'steppers76', 'funk96', 'funk105b', 'afrobeat110', 'onedropSwing66']) {
    const r = take(name, TAKES[0]);
    const a = analyzeClip([r.buf], r.sr);
    const n = FEELS[name].g.beatsPerBar || 4;
    // A tracked beat on a true downbeat must have index ≡ a.downbeat (mod n).
    const ones = a.beats.map((b, i) => [b, i]).filter(([b]) => r.downbeats.some(d => Math.abs(d - b) < 0.03));
    assert.ok(ones.length >= 4, `${name}: downbeats tracked`);
    for (const [, i] of ones) assert.equal(((i - a.downbeat) % n + n) % n, 0, `${name}: guessed beat ${(((a.downbeat - i) % n) + n) % n + 1} as the 1`);
  }
});

test('swing: shuffle, half-swung one-drop, neo-soul 16ths, straight funk', () => {
  const sw = name => analyzeClip([take(name, TAKES[0]).buf], 44100).swing;
  const sh = sw('shuffle90');
  assert.ok(Math.abs(sh.ratio - 2 / 3) < 0.03 && sh.swing >= 0.85, `shuffle ${JSON.stringify(sh)}`);
  const od = sw('onedropSwing66');
  assert.ok(od.res === 8 && Math.abs(od.swing - 0.5) < 0.15, `one-drop ${JSON.stringify(od)}`);
  const neo = sw('neo84');
  assert.ok(neo.res === 16 && Math.abs(neo.swing - 0.6) < 0.15, `neo ${JSON.stringify(neo)}`);
  assert.equal(sw('funk96').swing, 0);
  assert.equal(sw('rock100').swing, 0);
});

test('fitBeats bridges a missed beat; rescaleBeats halves and doubles', () => {
  const ts = [0, 0.5, 1.0, 2.0, 2.5, 3.0, 3.5];
  const f = fitBeats(ts);
  assert.ok(Math.abs(f.period - 0.5) < 1e-9 && Math.abs(f.t0) < 1e-9);
  assert.deepEqual(rescaleBeats([0, 1, 2, 3], 2), [0, 0.5, 1, 1.5, 2, 2.5, 3]);
  assert.deepEqual(rescaleBeats([0, 1, 2, 3, 4], 0.5), [0, 2, 4]);
});

test('findTransients finds every hit of a groove once', () => {
  const r = renderGroove({ bpm: 100, bars: 2, lead: 0.2, jitter: 0, noise: 0.0005, tracks: { kick: 'x-----x---x-----', snare: '----x-------x---', hh: 'x-x-x-x-x-x-x-x-' } });
  const ts = findTransients([r.buf], r.sr).map(s => s / r.sr);
  const want = Array.from({ length: 16 }, (_, k) => 0.2 + k * 0.3);
  // Every hit once, within 4 ms; anything extra is part of a hit's attack
  // (under 60 ms after it), which the stretcher merges with the hit.
  for (const w of want) assert.equal(ts.filter(t => Math.abs(t - w) < 0.004).length, 1, `hit at ${w.toFixed(3)}: ${ts.map(t => t.toFixed(3)).join(' ')}`);
  for (const t of ts) assert.ok(want.some(w => t - w > -0.004 && t - w < 0.06), `stray transient at ${t.toFixed(3)}`);
});

// ------------------------------------------------------------ transcription

const CELL = v => (v === 0 ? '-' : v === 3 ? 'g' : 'x'); // accents count as hits
function expectTrack(src, len) {
  const s = (src || '').replace(/[ |]/g, '');
  return Array.from({ length: len }, (_, i) => (s ? { '-': '-', x: 'x', X: 'x', g: 'g' }[s[i % s.length]] : '-')).join('');
}
function score(got, want) {
  let ok = 0;
  for (let i = 0; i < want.length; i++) if (got[i] === want[i]) ok++;
  return ok / want.length;
}

const TRANSCRIBE = {
  rock100: { kick: 0.95, snare: 1, hh: 0.95 },
  funk96: { kick: 1, snare: 0.93, hh: 0.95 },        // stabs on the "e" may read as ghosts
  funk105b: { kick: 0.9, snare: 0.9, hh: 0.95 },
  onedrop72: { kick: 1, snare: 0.85, hh: 0.95 },     // the cross-stick on 3 is the "snare"; under heavy noise it can be lost or the skank taken for it
  steppers76: { kick: 1, snare: 0.93, hh: 0.95 },
  shuffle90: { kick: 0.95, snare: 1, hh: 0.95 },  // the bass on every beat can add a kick
  neo84: { kick: 1, snare: 0.93, hh: 0.95 },
  afrobeat110: { kick: 1, snare: 0.85, hh: 0.95 },
  dembow95: { kick: 1, snare: 0.93, hh: 0.95 },
};
for (const [name, need] of Object.entries(TRANSCRIBE)) {
  test(`transcription: ${name} (true beats, clean and noisy)`, () => {
    for (const t of TAKES.slice(0, 2)) {
      const r = take(name, t);
      const g = FEELS[name].g;
      const a = analyzeClip([r.buf], r.sr);
      const out = transcribe([r.buf], r.sr, r.beats.slice(4), { bars: 2, beatsPerBar: g.beatsPerBar || 4, swing: a.swing });
      assert.equal(out.grid, (g.sub || 4) === 3 ? 'triplets' : 'sixteenths', `${t.label}: grid`);
      for (const v of ['kick', 'snare', 'hh']) {
        const got = out.tracks[v].map(CELL).join('');
        const src = v === 'snare' ? (g.tracks.snare || g.tracks.rim) : g.tracks[v];
        const want = expectTrack(src, got.length);
        // Noisy takes may lose quiet ghost notes: count a missed ghost as fine.
        const s = t.noise ? score(got, want.replace(/g/g, '?').split('').map((c, i) => (c === '?' ? (got[i] === 'g' ? 'g' : got[i] === '-' ? '-' : 'g') : c)).join('')) : score(got, want);
        assert.ok(s >= need[v] - 1e-9, `${t.label} ${v}: ${(s * 100).toFixed(0)}%\n  got  ${got}\n  want ${want}`);
      }
    }
  });
}

test('transcription end to end: tracked beats from the downbeat, one-drop and funk', () => {
  for (const name of ['onedrop72', 'funk96']) {
    const r = take(name, TAKES[0]);
    const a = analyzeClip([r.buf], r.sr);
    const first = a.downbeat + 4; // the second bar
    const out = transcribe([r.buf], r.sr, a.beats.slice(first), { bars: 2, swing: a.swing });
    const g = FEELS[name].g;
    for (const v of ['kick', 'snare']) {
      const got = out.tracks[v].map(CELL).join('');
      const want = expectTrack(v === 'snare' ? (g.tracks.snare || g.tracks.rim) : g.tracks[v], got.length);
      assert.ok(score(got.replace(/g/g, '-'), want.replace(/g/g, '-')) >= 0.95, `${name} ${v}\n  got  ${got}\n  want ${want}`);
    }
  }
});

test('ENV_RATE is about 200 frames a second', () => {
  assert.ok(Math.abs(new EnvelopeTracker(44100).rate - ENV_RATE) < 1);
  assert.equal(estimateTempo(new Float32Array(100), 200), null);
});

// Timing analysis tests: grid, matching, summaries, latency and bleed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gridPoints, matchHit, matchHits, summarize, describeOffset, describeSpread, describeTrend,
  positionName, estimateLatency, tapLatency, isBleed,
} from '../js/timing-analysis.js';
import { Sequencer } from '../js/sequencer.js';
import { metronomeSequence } from '../js/patterns.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// Beats as the engine logs them: run the real sequencer.
function beatsFromSequencer(bpm, seconds, cfg = {}) {
  const beats = [];
  const s = new Sequencer({ bpm, swing: 0, swingRes: 8, trainer: { enabled: false }, gap: { enabled: false }, ...cfg },
    ev => { if (ev.stepInBeat === 0) beats.push({ time: ev.time, dur: ev.beatDur, barCount: ev.barCount, beat: ev.beat, beatsPerBar: ev.beatsPerBar }); });
  s.setSequence(metronomeSequence());
  s.start(1);
  s.scheduleUntil(1 + seconds);
  return beats;
}

test('grid points: beats, 16ths, triplets and swung 8ths', () => {
  const beats = [{ time: 10, dur: 0.5, barCount: 0, beat: 0 }];
  assert.deepEqual(gridPoints(beats, 4).map(g => g.time), [10, 10.125, 10.25, 10.375]);
  gridPoints(beats, 3).forEach((g, i) => near(g.time, 10 + i / 6, 1e-9, 'triplet'));
  const swung = gridPoints(beats, 2, 1, 8);
  near(swung[1].time, 10 + 0.5 * 2 / 3, 1e-9, 'fully swung & lands on the last triplet');
});

test('hits are matched to the nearest grid point with latency removed', () => {
  const grid = gridPoints(beatsFromSequencer(120, 4), 2); // 8ths at 120: 0.25 s apart
  const latency = 0.15;
  // a hit 12 ms late on the & of beat 1 (t = 1.25), heard 150 ms later by the mic
  const h = matchHit({ time: 1.25 + 0.012 + latency, peak: 0.5 }, grid, latency);
  near(h.error, 12, 1e-6, 'error ms');
  assert.deepEqual([h.beat, h.sub, h.barCount], [0, 1, 0]);
  // early hit on beat 3 of bar 2
  const e = matchHit({ time: 1 + 2 + 1 - 0.02 + latency, peak: 0.5 }, grid, latency);
  near(e.error, -20, 1e-6, 'early');
  assert.deepEqual([e.beat, e.sub, e.barCount], [2, 0, 1]);
  // outside the grid (before playback started)
  assert.equal(matchHit({ time: 0.5 + latency, peak: 1 }, grid, latency), null);
});

test('summary: average, spread, accuracy bands, per bar and per position', () => {
  const grid = gridPoints(beatsFromSequencer(100, 30), 4); // 50 beats = 200 points
  // Simulated drummer: 16ths, the "a" always 9 ms late, others on time +-3 ms
  const hits = grid.slice(0, 160).map((g, i) => ({ time: g.time + (g.sub === 3 ? 0.009 : ((i % 3) - 1) * 0.003), peak: 0.5 }));
  const s = summarize(matchHits(hits, grid, 0));
  assert.equal(s.count, 160);
  near(s.mean, 2.25, 0.5, 'mean');
  assert.ok(s.sd > 3 && s.sd < 6, 'sd ' + s.sd);
  assert.equal(s.within10, 1);
  assert.equal(s.perBar.length, 10);
  const aOf1 = s.byPosition.find(p => p.beat === 0 && p.sub === 3);
  near(aOf1.mean, 9, 0.01, '"a" of 1 is consistently late');
  assert.equal(positionName(0, 3, 4), '1a');
  assert.equal(positionName(1, 2, 4), '2&');
  assert.equal(positionName(3, 2, 3), '4 let');
});

test('trend detects rushing and dragging over a take', () => {
  const grid = gridPoints(beatsFromSequencer(120, 40), 1);
  const drag = summarize(matchHits(grid.map((g, i) => ({ time: g.time + 0.0005 * i, peak: 1 })), grid, 0));
  assert.ok(drag.trend > 0, 'getting later');
  assert.equal(describeTrend(drag.trend, drag.perBar.length), 'dragging (getting later)');
  const rush = summarize(matchHits(grid.map((g, i) => ({ time: g.time - 0.0005 * i, peak: 1 })), grid, 0));
  assert.equal(describeTrend(rush.trend, rush.perBar.length), 'rushing (getting earlier)');
  const steady = summarize(matchHits(grid.map(g => ({ time: g.time + 0.002, peak: 1 })), grid, 0));
  assert.equal(describeTrend(steady.trend, steady.perBar.length), 'steady');
});

test('verdict wording', () => {
  assert.equal(describeOffset(1), 'right on the beat');
  assert.equal(describeOffset(8), 'slightly behind the beat');
  assert.equal(describeOffset(-15), 'ahead of the beat');
  assert.equal(describeOffset(40), 'well behind the beat');
  assert.equal(describeSpread(4), 'very tight');
  assert.equal(describeSpread(30), 'loose');
});

test('scoring keeps working through tempo trainer changes and silent gap bars', () => {
  const beats = beatsFromSequencer(0, 30, {
    trainer: { enabled: true, start: 80, target: 140, step: 20, every: 1 },
    gap: { enabled: true, play: 1, mute: 1 },
  });
  const grid = gridPoints(beats, 1);
  // perfect playing, including in the silent bars
  const s = summarize(matchHits(grid.map(g => ({ time: g.time, peak: 1 })), grid, 0));
  near(s.mean, 0, 1e-6, 'mean');
  near(s.sd, 0, 1e-6, 'sd');
  assert.equal(s.count, grid.length);
});

test('speaker-test latency: median delay, robust to a missed click and a stray hit', () => {
  const clicks = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5];
  const onsets = clicks.filter((_, i) => i !== 3).map((c, i) => ({ time: c + 0.143 + (i % 2) * 0.001, peak: 0.02 }));
  onsets.push({ time: 3.3, peak: 0.5 }); // someone knocked the stand
  onsets.sort((a, b) => a.time - b.time);
  const r = estimateLatency(onsets, clicks);
  near(r.latency, 0.1435, 0.0011, 'latency');
  assert.equal(r.matched, 7);
  near(r.bleedPeak, 0.02, 1e-9, 'bleed level');
  assert.equal(estimateLatency(onsets.slice(0, 2), clicks), null, 'too few clicks heard');
});

test('tap-test latency', () => {
  const clicks = Array.from({ length: 16 }, (_, i) => 1 + i * 0.6);
  const taps = clicks.map((c, i) => ({ time: c + 0.09 + ((i % 5) - 2) * 0.004, peak: 0.6 }));
  near(tapLatency(taps, clicks).latency, 0.09, 0.002, 'tap latency');
  assert.equal(tapLatency(taps.slice(0, 3), clicks), null);
});

test('speaker bleed: quiet onsets that line up with app sounds are ignored, real hits are kept', () => {
  const sounds = [2, 2.5, 3];
  const latency = 0.1;
  assert.equal(isBleed({ time: 2.101, peak: 0.02 }, sounds, latency, 0.02), true, 'click heard through the mic');
  assert.equal(isBleed({ time: 2.101, peak: 0.6 }, sounds, latency, 0.02), false, 'loud real hit on the beat');
  assert.equal(isBleed({ time: 2.3, peak: 0.02 }, sounds, latency, 0.02), false, 'quiet ghost note between sounds');
  assert.equal(isBleed({ time: 2.101, peak: 0.02 }, sounds, latency, 0), false, 'no speaker test yet');
});

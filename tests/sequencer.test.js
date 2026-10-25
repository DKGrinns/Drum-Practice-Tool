// Timing tests for the lookahead sequencer (pure logic, no Web Audio).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sequencer, swingWarp, stepOffset, trainerBpm, gapMuted } from '../js/sequencer.js';
import { metronomeSequence } from '../js/patterns.js';
import { GROOVES, grooveToPattern } from '../js/grooves.js';
import { toSequence } from '../js/patterns.js';

const EPS = 1e-9;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);

function makeConfig(over = {}) {
  return {
    bpm: 120, swing: 0, swingRes: 8,
    trainer: { enabled: false, start: 80, target: 120, step: 5, every: 2 },
    gap: { enabled: false, play: 2, mute: 2 },
    ...over,
  };
}

// Simulate the engine: call scheduleUntil in small irregular slices, as the
// timer would, and collect events.
function run(cfg, seq, seconds, sliceFn = i => 0.025 + (i % 7) * 0.003) {
  const events = [];
  const s = new Sequencer(cfg, e => events.push(e));
  s.setSequence(seq);
  s.start(0.1);
  let t = 0, i = 0;
  while (t < seconds) { t += sliceFn(i++); s.scheduleUntil(t + 0.1); }
  return { events, s };
}

test('quarter notes at 120 BPM are exactly 0.5 s apart, no drift over 1000 bars', () => {
  const cfg = makeConfig();
  const { events } = run(cfg, metronomeSequence({ meter: '4/4', subdivision: 'quarter' }), 2005);
  assert.ok(events.length >= 4000);
  events.forEach((e, i) => near(e.time, 0.1 + i * 0.5, `event ${i}`));
  // Bar/beat bookkeeping
  assert.equal(events[4].beat, 0);
  assert.equal(events[4].barCount, 1);
  assert.equal(events[3999].barCount, 999);
});

test('events are emitted in time order and only within the lookahead window', () => {
  const cfg = makeConfig({ bpm: 300 });
  const events = [];
  const s = new Sequencer(cfg, e => events.push(e));
  s.setSequence(metronomeSequence({ subdivision: 'sixteenth' }));
  s.start(0);
  s.scheduleUntil(0.1);
  // 300 BPM 16ths = 0.05 s per step -> steps at 0 and 0.05 only
  assert.deepEqual(events.map(e => +e.time.toFixed(6)), [0, 0.05]);
  s.scheduleUntil(0.1); // calling again must not duplicate
  assert.equal(events.length, 2);
});

test('16th subdivision spacing and accent/sub voices', () => {
  const cfg = makeConfig({ bpm: 60 });
  const { events } = run(cfg, metronomeSequence({ subdivision: 'sixteenth', accent: true }), 5);
  near(events[1].time - events[0].time, 0.25, '16th at 60bpm');
  assert.deepEqual(events[0].hits.map(h => h.voice), ['accent']);
  assert.deepEqual(events[1].hits.map(h => h.voice), ['sub']);
  assert.deepEqual(events[4].hits.map(h => h.voice), ['click']);
});

test('accent off puts a normal click on beat 1', () => {
  const seq = metronomeSequence({ accent: false });
  assert.equal(seq.tracks.accent[0], 0);
  assert.equal(seq.tracks.click[0], 1);
});

test('meters: 6/8 has 2 dotted-quarter beats of 3, 7/8 groups 2+2+3', () => {
  const six = metronomeSequence({ meter: '6/8', subdivision: 'eighth' });
  assert.equal(six.beatsPerBar, 2);
  assert.equal(six.spb, 3);
  const twelve = metronomeSequence({ meter: '12/8', subdivision: 'eighth' });
  assert.equal(twelve.beatsPerBar, 4);
  const seven = metronomeSequence({ meter: '7/8', subdivision: 'quarter' }); // falls back to 8ths
  assert.equal(seven.beatsPerBar, 7);
  assert.equal(seven.spb, 1);
  // beats 3 and 5 (index 2, 4) are group starts -> normal clicks; others soft
  assert.deepEqual(seven.tracks.click, [0, 3, 1, 3, 1, 3, 3]);
  assert.equal(seven.tracks.accent[0], 2);
});

test('swing warp: 0 = straight, 1 = triplet, monotonic', () => {
  near(swingWarp(0.5, 0), 0.5, 'straight');
  near(swingWarp(0.5, 1), 2 / 3, 'full triplet');
  near(swingWarp(0, 1), 0, 'downbeat fixed');
  let prev = -1;
  for (let p = 0; p < 1; p += 0.01) { const w = swingWarp(p, 0.7); assert.ok(w > prev); prev = w; }
});

test('swing applied to 8th pairs and 16th pairs', () => {
  // 8th swing, 2 steps per beat: offbeat at 2/3
  near(stepOffset(1, 2, 1, 8), 2 / 3, '8th swing');
  // 16th swing, 4 steps per beat: e and a move, & stays
  near(stepOffset(1, 4, 1, 16), 1 / 3, 'e');
  near(stepOffset(2, 4, 1, 16), 0.5, '&');
  near(stepOffset(3, 4, 1, 16), 0.5 + 1 / 3, 'a');
  // triplet grid is never swung
  near(stepOffset(1, 3, 1, 8), 1 / 3, 'triplet unchanged');
});

test('swung 8ths in the sequencer at 120 BPM', () => {
  const cfg = makeConfig({ swing: 1, swingRes: 8 });
  const { events } = run(cfg, metronomeSequence({ subdivision: 'eighth' }), 3);
  near(events[1].time - events[0].time, 1 / 3, 'long');
  near(events[2].time - events[1].time, 1 / 6, 'short');
  near(events[2].time - events[0].time, 0.5, 'beat length unchanged');
});

test('BPM change takes effect at the next beat without a time jump', () => {
  const cfg = makeConfig({ bpm: 120 });
  const events = [];
  const s = new Sequencer(cfg, e => events.push(e));
  s.setSequence(metronomeSequence({ subdivision: 'sixteenth' }));
  s.start(0);
  s.scheduleUntil(0.26); // first 16ths of beat 1 (0, .125, .25)
  cfg.bpm = 60;
  s.scheduleUntil(3);
  const times = events.map(e => e.time);
  near(times[3], 0.375, 'rest of beat 1 keeps old tempo');
  near(times[4], 0.5, 'beat 2 starts on time');
  near(times[5] - times[4], 0.25, 'beat 2 at new tempo');
});

test('tempo trainer ramps BPM every N bars and holds at target', () => {
  const tr = { start: 80, target: 92, step: 5, every: 2 };
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 20].map(b => trainerBpm(tr, b)), [80, 80, 85, 85, 90, 90, 92, 92]);
  // decreasing
  assert.equal(trainerBpm({ start: 120, target: 100, step: 10, every: 1 }, 5), 100);
  // in the sequencer: bar lengths follow the trainer
  const cfg = makeConfig({ trainer: { enabled: true, start: 60, target: 120, step: 60, every: 1 } });
  const { events } = run(cfg, metronomeSequence(), 10);
  const barStarts = events.filter(e => e.beat === 0).map(e => e.time);
  near(barStarts[1] - barStarts[0], 4, 'bar 1 at 60');
  near(barStarts[2] - barStarts[1], 2, 'bar 2 at 120');
  assert.equal(events[0].bpm, 60);
  assert.equal(events[4].bpm, 120);
});

test('gap trainer mutes M bars after N played bars', () => {
  const gap = { play: 2, mute: 1 };
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(b => gapMuted(gap, b)), [false, false, true, false, false, true]);
  const cfg = makeConfig({ gap: { enabled: true, play: 1, mute: 1 } });
  const { events } = run(cfg, metronomeSequence(), 10);
  const mutedByBar = {};
  for (const e of events) mutedByBar[e.barCount] = e.muted;
  assert.equal(mutedByBar[0], false);
  assert.equal(mutedByBar[1], true);
  assert.equal(mutedByBar[2], false);
  // muted bars keep time: bar 2 still starts at exactly 4 s after bar 0 (120 bpm)
  const b2 = events.find(e => e.barCount === 2);
  near(b2.time, 0.1 + 4, 'timing kept through silence');
});

test('pattern switches wait for the bar line', () => {
  const cfg = makeConfig();
  const events = [];
  const s = new Sequencer(cfg, e => events.push(e));
  s.setSequence(metronomeSequence({ subdivision: 'quarter' }));
  s.start(0);
  s.scheduleUntil(0.6); // 2 beats
  s.setSequence(metronomeSequence({ subdivision: 'sixteenth' }));
  s.scheduleUntil(2.3);
  const bar0 = events.filter(e => e.barCount === 0);
  assert.equal(bar0.length, 4, 'first bar finished as quarters');
  near(events[4].time, 2, 'new pattern starts on bar 2 downbeat');
  near(events[5].time, 2.125, 'and plays 16ths');
});

test('multi-bar grooves play every bar in order and loop', () => {
  const g = GROOVES.find(x => x.id === 'reggae-hats-16');
  const p = grooveToPattern(g);
  assert.equal(p.bars, 2);
  const { events } = run(makeConfig(), toSequence(p), 9);
  const bars = events.filter(e => e.index % 16 === 0).map(e => e.bar);
  assert.deepEqual(bars.slice(0, 4), [0, 1, 0, 1]);
  // open hat only in bar 2
  const oh = events.filter(e => e.hits.some(h => h.voice === 'oh')).map(e => e.index);
  assert.ok(oh.length >= 1 && oh.every(i => i === 30));
});

test('one drop: kick and rim together on beat 3, nothing on 1', () => {
  const p = grooveToPattern(GROOVES.find(g => g.id === 'one-drop'));
  const { events } = run(makeConfig({ bpm: 72 }), toSequence(p), 4);
  const first = events[0].hits.map(h => h.voice);
  assert.ok(!first.includes('kick') && !first.includes('rim'));
  const beat3 = events.find(e => e.beat === 2 && e.stepInBeat === 0).hits.map(h => h.voice).sort();
  assert.deepEqual(beat3, ['hh', 'kick', 'rim']);
});

test('resync after the clock jumps (sleeping tab) skips instead of bursting', () => {
  const cfg = makeConfig();
  const events = [];
  const s = new Sequencer(cfg, e => events.push(e));
  s.setSequence(metronomeSequence());
  s.start(0);
  s.scheduleUntil(0.1);
  assert.ok(s.resyncIfLate(30));
  s.scheduleUntil(30.2);
  assert.ok(events.length <= 3, 'no burst of late notes');
  assert.ok(events[events.length - 1].time >= 30);
});

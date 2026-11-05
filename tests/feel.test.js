// Time-feel trainer tests: click modes, click dropout, push/pull, humanize.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sequencer, clickLayer, dropoutAmount, beatDropped, seededRandom } from '../js/sequencer.js';
import { metronomeSequence, toSequence } from '../js/patterns.js';
import { voiceOffset, humanize, CLICK_VOICES, feelGroup } from '../js/feel.js';
import { GROOVES, grooveToPattern } from '../js/grooves.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);
const cfg = (over = {}) => ({
  bpm: 120, swing: 0, swingRes: 8,
  trainer: { enabled: false }, gap: { enabled: false },
  dropout: { enabled: false, amount: 50, progressive: false, max: 80, every: 2, keepOne: true },
  ...over,
});
function run(config, seq, seconds, seed = 1) {
  const events = [];
  const s = new Sequencer(config, e => events.push(e));
  s.setSequence(seq);
  s.start(0, seed);
  for (let t = 0; t < seconds; t += 0.025) s.scheduleUntil(t + 0.1);
  return events;
}
const clicksOf = seq => seq.tracks.accent.map((a, i) => (a ? 'A' : seq.tracks.click[i] ? 'c' : seq.tracks.sub[i] ? 's' : '-')).join('');

test('metronome click modes', () => {
  assert.equal(clicksOf(metronomeSequence({ subdivision: 'eighth' })), 'AscscsCs'.replace('C', 'c'));
  assert.equal(clicksOf(metronomeSequence({ clickMode: 'backbeat' })), '-c-c');
  assert.equal(clicksOf(metronomeSequence({ clickMode: 'one', subdivision: 'sixteenth' })), 'A' + '-'.repeat(15));
  // offbeats on quarters gets an "&" step: 2 steps per beat, click on the &
  const off = metronomeSequence({ clickMode: 'offbeats' });
  assert.equal(off.spb, 2);
  assert.equal(clicksOf(off), '-c-c-c-c');
  // offbeats on a triplet subdivision: the last triplet
  assert.equal(clicksOf(metronomeSequence({ clickMode: 'offbeats', subdivision: 'triplet' })), '--c--c--c--c');
  // sparse: one click every N bars
  const sp = metronomeSequence({ clickMode: 'sparse', sparseBars: 3 });
  assert.equal(sp.bars, 3);
  assert.equal(clicksOf(sp), 'A' + '-'.repeat(11));
  // 3/4 backbeat: beat 2 only
  assert.equal(clicksOf(metronomeSequence({ meter: '3/4', clickMode: 'backbeat' })), '-c-');
});

test('sparse click keeps exact time over many bars', () => {
  const ev = run(cfg(), metronomeSequence({ clickMode: 'sparse', sparseBars: 4 }), 40);
  const clicks = ev.filter(e => e.hits.length).map(e => e.time);
  clicks.slice(1).forEach((t, i) => near(t - clicks[i], 8, 'one click per 4 bars at 120 bpm'));
});

test('click layer under grooves follows the click mode', () => {
  const ev = (beat, stepInBeat, spb = 4, barCount = 0) => ({ beat, stepInBeat, spb, barCount });
  assert.equal(clickLayer('all', ev(0, 0)), 'accent');
  assert.equal(clickLayer('all', ev(1, 0)), 'click');
  assert.equal(clickLayer('all', ev(1, 2)), null);
  assert.equal(clickLayer('backbeat', ev(0, 0)), null);
  assert.equal(clickLayer('backbeat', ev(1, 0)), 'click');
  assert.equal(clickLayer('backbeat', ev(3, 0)), 'click');
  assert.equal(clickLayer('offbeats', ev(0, 2)), 'click');
  assert.equal(clickLayer('offbeats', ev(0, 0)), null);
  assert.equal(clickLayer('offbeats', ev(2, 2, 3)), 'click', 'triplet grid: last triplet');
  assert.equal(clickLayer('one', ev(0, 0)), 'accent');
  assert.equal(clickLayer('one', ev(2, 0)), null);
  assert.equal(clickLayer('sparse', ev(0, 0, 4, 4), 4), 'accent');
  assert.equal(clickLayer('sparse', ev(0, 0, 4, 5), 4), null);
});

test('dropout amount: fixed, and progressive ramp capped at max', () => {
  const d = { amount: 20, progressive: true, max: 50, every: 2 };
  assert.deepEqual([0, 1, 2, 4, 6, 8, 40].map(b => dropoutAmount(d, b)), [20, 20, 30, 40, 50, 50, 50]);
  assert.equal(dropoutAmount({ ...d, progressive: false }, 40), 20);
});

test('dropout silences about the right share of beats, keeps beat 1, never moves time', () => {
  const config = cfg({ dropout: { enabled: true, amount: 40, progressive: false, keepOne: true } });
  const ev = run(config, metronomeSequence(), 400, 42); // 800 beats
  const beats = ev.filter(e => e.stepInBeat === 0);
  assert.ok(beats.filter(e => e.beat === 0).every(e => !e.muted), 'beat 1 never dropped');
  const others = beats.filter(e => e.beat !== 0);
  const share = others.filter(e => e.dropped).length / others.length;
  assert.ok(share > 0.33 && share < 0.47, `share ${share}`);
  beats.forEach((e, i) => near(e.time, i * 0.5, 'time unaffected by dropout'));
  // Same seed -> same silent beats (repeatable)
  const again = run(config, metronomeSequence(), 400, 42).filter(e => e.stepInBeat === 0);
  assert.deepEqual(again.map(e => e.dropped), beats.map(e => e.dropped));
});

test('dropout mutes every step of a dropped beat in a groove', () => {
  const p = grooveToPattern(GROOVES.find(g => g.id === 'funk-16-ghost'));
  const config = cfg({ dropout: { enabled: true, amount: 50, keepOne: false } });
  const ev = run(config, toSequence(p), 20, 7);
  const byBeat = new Map();
  for (const e of ev) {
    const k = `${e.barCount}:${e.beat}`;
    if (!byBeat.has(k)) byBeat.set(k, new Set());
    byBeat.get(k).add(e.muted);
  }
  for (const set of byBeat.values()) assert.equal(set.size, 1, 'a beat is all silent or all sounding');
  assert.ok([...byBeat.values()].some(s => s.has(true)));
});

test('beatDropped respects enabled and keepOne', () => {
  const always = () => 0;
  assert.equal(beatDropped({ enabled: false, amount: 90 }, 0, 1, always), false);
  assert.equal(beatDropped({ enabled: true, amount: 90, keepOne: true }, 0, 0, always), false);
  assert.equal(beatDropped({ enabled: true, amount: 90, keepOne: false }, 0, 0, always), true);
  const r = seededRandom(5);
  const vals = Array.from({ length: 1000 }, r);
  assert.ok(vals.every(v => v >= 0 && v < 1));
});

test('push/pull and per-drum offsets; clicks never move', () => {
  const feel = { offset: 10, kick: 5, snare: 15, hats: -4, ride: 0, perc: 2 };
  near(voiceOffset(feel, 'kick'), 0.015, 'kick');
  near(voiceOffset(feel, 'snare'), 0.025, 'snare');
  near(voiceOffset(feel, 'rim'), 0.025, 'rim follows snare');
  near(voiceOffset(feel, 'oh'), 0.006, 'open hat follows hats');
  near(voiceOffset(feel, 'congaH'), 0.012, 'percussion');
  for (const v of CLICK_VOICES) assert.equal(voiceOffset(feel, v), 0, v);
  near(voiceOffset({ offset: 500 }, 'kick'), 0.1, 'clamped');
  assert.equal(feelGroup('tom2'), 'perc');
});

test('humanize stays within its limits', () => {
  assert.deepEqual(humanize(0), { dt: 0, dv: 1 });
  const r = seededRandom(3);
  for (let i = 0; i < 500; i++) {
    const h = humanize(1, r);
    assert.ok(Math.abs(h.dt) <= 0.012 && h.dv >= 0.75 && h.dv <= 1.25);
  }
  const half = humanize(0.5, () => 1); // extreme random value
  near(half.dt, 0.006, 'half amount timing');
});

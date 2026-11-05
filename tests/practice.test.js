// Practice structure: routines, log, set lists, song form, count-in.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../js/practice.js';
import { Sequencer } from '../js/sequencer.js';
import { GROOVES, grooveToPattern } from '../js/grooves.js';
import { toSequence, metronomeSequence } from '../js/patterns.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);

test('items: normalize, keys and back', () => {
  const it = P.normalizeItem({ kind: 'groove', grooveId: 'one-drop', bpm: '72' });
  assert.deepEqual(it, { kind: 'groove', grooveId: 'one-drop', patternId: '', meter: '4/4', subdivision: 'quarter', bpm: 72 });
  assert.equal(P.normalizeItem({ kind: 'groove', bpm: null }).bpm, null, 'null = the groove tempo');
  assert.equal(P.normalizeItem({ bpm: 999 }).bpm, 300);
  assert.equal(P.normalizeItem({ kind: 'bogus' }).kind, 'metronome');
  assert.equal(P.itemKey(it), 'groove:one-drop');
  assert.equal(P.itemKey({ kind: 'metronome', meter: '7/8' }), 'metronome:7/8');
  assert.equal(P.itemFromKey('pattern:abc').patternId, 'abc');
  assert.equal(P.itemFromKey('metronome:12/8').meter, '12/8');
});

test('routines: normalize, total time, position', () => {
  const r = P.normalizeRoutine({ name: 'R', blocks: [{ seconds: 60 }, { seconds: 120, trainer: { enabled: 1, target: 500 } }, { seconds: 2 }] });
  assert.equal(r.blocks.length, 3);
  assert.equal(r.blocks[1].trainer.enabled, true);
  assert.equal(r.blocks[1].trainer.target, 300);
  assert.equal(r.blocks[2].seconds, 10, 'minimum 10 s');
  assert.equal(P.routineSeconds(r), 190);
  const p = P.routinePosition(r, 1, 30);
  assert.equal(p.blockLeft, 90);
  assert.equal(p.totalLeft, 100);
  near(p.progress, 0.25, 'progress');
  assert.ok(P.routinePosition(r, 3, 0).done);
  assert.equal(P.formatTime(75), '1:15');
  assert.equal(P.formatTime(3600), '60:00');
  assert.equal(P.formatTime(0.2), '0:01', 'rounds up so 0:00 means done');
});

test('starter routines use real grooves and valid blocks', () => {
  const ids = new Set(GROOVES.map(g => g.id));
  const rs = P.starterRoutines();
  assert.ok(rs.length >= 3);
  for (const r of rs) {
    assert.ok(r.blocks.length >= 4, r.name);
    for (const b of r.blocks) if (b.item.kind === 'groove') assert.ok(ids.has(b.item.grooveId), b.item.grooveId);
    assert.ok(P.routineSeconds(r) >= 600);
  }
});

test('log: minutes per day, totals, streak', () => {
  let log = [];
  const at = (day, seconds, extra = {}) => { log = P.addEntry(log, { date: `${day}T12:00:00`, day, seconds, ...extra }); };
  at('2026-11-01', 600);
  at('2026-11-03', 300);
  at('2026-11-04', 1200);
  at('2026-11-05', 30);   // under a minute: doesn't count for the streak
  at('2026-11-05', 45);   // ...but together they do (75 s)
  const days = P.minutesByDay(log, 7, '2026-11-05');
  assert.equal(days.length, 7);
  assert.equal(days[6].day, '2026-11-05');
  assert.equal(days[6].minutes, 1.3);
  assert.equal(days[5].minutes, 20);
  assert.equal(days[3].minutes, 0);
  assert.equal(P.streak(log, '2026-11-05'), 3, '3, 4, 5 Nov');
  assert.equal(P.streak(log, '2026-11-06'), 3, 'still alive the next day before practising');
  assert.equal(P.streak(log, '2026-11-07'), 0);
  const t = P.totals(log, '2026-11-05');
  assert.equal(t.today, 75);
  assert.equal(t.week, 2175);
  assert.equal(t.all, 2175);
  // Month boundary
  log = [];
  at('2026-10-31', 120); at('2026-11-01', 120);
  assert.equal(P.streak(log, '2026-11-01'), 2);
  assert.equal(P.minutesByDay(log, 2, '2026-11-01')[0].day, '2026-10-31');
});

test('log: clean takes and best tempo per groove', () => {
  assert.ok(P.isCleanTake({ count: 40, mean: 6, sd: 9 }));
  assert.ok(!P.isCleanTake({ count: 40, mean: 22, sd: 9 }), 'rushing');
  assert.ok(!P.isCleanTake({ count: 40, mean: 2, sd: 25 }), 'too uneven');
  assert.ok(!P.isCleanTake({ count: 8, mean: 0, sd: 1 }), 'too short');
  let log = [];
  const add = (key, bpm, clean, date) => { log = P.addEntry(log, { key, label: key, bpm, clean, seconds: 60, date }); };
  add('groove:one-drop', 72, true, '2026-11-01T10:00:00Z');
  add('groove:one-drop', 90, false, '2026-11-02T10:00:00Z'); // not clean: ignored
  add('groove:one-drop', 80, true, '2026-11-03T10:00:00Z');
  add('groove:samba', 100, true, '2026-11-03T11:00:00Z');
  const best = P.bestTempos(log);
  assert.deepEqual(best.map(b => [b.key, b.bpm]), [['groove:one-drop', 80], ['groove:samba', 100]]);
  assert.equal(log.length, 4);
  assert.ok(P.addEntry(new Array(P.MAX_LOG).fill(log[0]), {}).length === P.MAX_LOG, 'log is capped');
});

test('song form: parsing and position', () => {
  const f = P.parseForm('Intro 4, Verse 16, Chorus 8 x2 | 16 Solo; Outro');
  assert.deepEqual(f.map(s => `${s.name}:${s.bars}`), ['Intro:4', 'Verse:16', 'Chorus:8', 'Chorus:8', 'Solo:16', 'Outro:8']);
  assert.equal(P.formBars(f), 60);
  assert.deepEqual(P.parseForm('A 8 bars\nB 4b').map(s => `${s.name}:${s.bars}`), ['A:8', 'B:4']);
  assert.deepEqual(P.parseForm(''), []);
  let p = P.formPosition(f, 0);
  assert.equal(p.name, 'Intro'); assert.equal(p.bar, 1); assert.equal(p.bars, 4); assert.equal(p.last, false);
  p = P.formPosition(f, 3);
  assert.ok(p.last); assert.equal(p.next, 'Verse');
  p = P.formPosition(f, 4);
  assert.equal(p.name, 'Verse'); assert.equal(p.bar, 1);
  p = P.formPosition(f, 28);
  assert.equal(p.index, 3); assert.equal(p.name, 'Chorus'); assert.equal(p.bar, 1);
  assert.ok(P.formPosition(f, 60).done);
});

test('set lists normalize', () => {
  const l = P.normalizeSetlist({ name: 'Friday', songs: [{ title: 'Stir It Up', item: { kind: 'groove', grooveId: 'one-drop', bpm: 76 }, key: 'A', form: 'Intro 4' }, {}] });
  assert.equal(l.songs.length, 2);
  assert.equal(l.songs[0].item.bpm, 76);
  assert.equal(l.songs[1].title, 'Song');
  assert.ok(l.songs[0].id && l.songs[1].id && l.songs[0].id !== l.songs[1].id);
});

test('count-in words', () => {
  assert.deepEqual(P.countInWords(4, 1, 0.5), ['one', 'two', 'three', 'four']);
  assert.deepEqual(P.countInWords(4, 2, 0.5), ['one', null, 'two', null, 'one', 'two', 'three', 'four']);
  assert.deepEqual(P.countInWords(3, 1, 0.5), ['one', 'two', 'three']);
  assert.deepEqual(P.countInWords(4, 1, 0.2), ['one', null, 'two', null], 'very fast: half-time words');
  assert.equal(P.countInWords(7, 1, 0.3).length, 7);
});

test('backup: export, import and merge', () => {
  const routines = P.starterRoutines();
  const log = [P.normalizeEntry({ key: 'groove:one-drop', bpm: 72, seconds: 90 })];
  const setlists = [P.normalizeSetlist({ name: 'Gig', songs: [{ title: 'A' }] })];
  const text = P.exportPractice({ routines, log, setlists });
  const back = P.importPractice(text);
  assert.deepEqual(back.routines, routines);
  assert.deepEqual(back.log, log);
  assert.deepEqual(back.setlists, setlists);
  assert.throws(() => P.importPractice('{"format":"other"}'), /practice file/);
  assert.throws(() => P.importPractice('nope'), /JSON/);
  const only = P.importPractice(P.exportPractice({ setlists }));
  assert.equal(only.routines.length, 0);
  assert.equal(only.setlists.length, 1);
  const merged = P.mergeById(routines, [{ ...routines[0], name: 'Renamed' }, P.normalizeRoutine({ name: 'New' })]);
  assert.equal(merged.length, routines.length + 1);
  assert.equal(merged[0].name, 'Renamed');
  const l2 = P.mergeLog(log, [...log, P.normalizeEntry({ date: '2020-01-01T00:00:00Z' })]);
  assert.equal(l2.length, 2, 'same entry is not doubled');
  assert.equal(l2[1].date, '2020-01-01T00:00:00Z', 'newest first');
});

// ------------------------------------------------------- sequencer count-in

function runSeq(cfg, seq, seconds, countIn) {
  const events = [];
  const s = new Sequencer(cfg, e => events.push(e));
  s.setSequence(seq);
  s.start(0.1, 1, countIn);
  for (let t = 0; t < seconds; t += 0.025) s.scheduleUntil(t + 0.1);
  return { events, s };
}
const cfg = (over = {}) => ({ bpm: 120, swing: 0, swingRes: 8, trainer: { enabled: false, start: 80, target: 120, step: 5, every: 2 }, gap: { enabled: false, play: 1, mute: 1 }, dropout: { enabled: false }, ...over });

test('count-in: one bar of clicks, then the groove starts on bar 0', () => {
  const g = GROOVES.find(x => x.id === 'one-drop');
  const { events } = runSeq(cfg({ bpm: 120 }), toSequence(grooveToPattern(g)), 4, 1);
  const ci = events.filter(e => e.countIn);
  assert.equal(ci.length, 16, 'every step of the count-in bar is emitted');
  const clicks = ci.filter(e => e.hits.length);
  assert.equal(clicks.length, 4);
  assert.deepEqual(clicks.map(e => e.hits[0].voice), ['accent', 'click', 'click', 'click']);
  clicks.forEach((e, i) => near(e.time, 0.1 + i * 0.5, `count-in beat ${i}`));
  assert.ok(ci.every(e => e.barCount === -1 && e.index === -1 && !e.muted));
  const first = events.find(e => !e.countIn);
  near(first.time, 2.1, 'groove starts after one 4/4 bar at 120');
  assert.equal(first.barCount, 0);
  assert.equal(first.index, 0);
  // One drop: kick on beat 3 of the first real bar.
  const kick = events.find(e => !e.countIn && e.hits.some(h => h.voice === 'kick'));
  near(kick.time, 2.1 + 1.0, 'first kick on beat 3');
});

test('count-in: two bars, trainer and gap start after it', () => {
  const c = cfg({ trainer: { enabled: true, start: 80, target: 120, step: 10, every: 1 }, gap: { enabled: true, play: 1, mute: 1 } });
  const { events } = runSeq(c, metronomeSequence({ meter: '4/4' }), 12, 2);
  const beats = events.filter(e => e.stepInBeat === 0);
  const ci = beats.filter(e => e.countIn);
  assert.equal(ci.length, 8);
  assert.deepEqual([...new Set(ci.map(e => e.barCount))], [-2, -1]);
  assert.ok(ci.every(e => e.bpm === 80 && !e.muted), 'count-in at the start tempo, never silent');
  near(ci[7].time - ci[0].time, 7 * 0.75, 'count-in beats at 80 BPM');
  const bar = n => beats.find(e => !e.countIn && e.barCount === n && e.beat === 0);
  assert.equal(bar(0).bpm, 80);
  assert.equal(bar(0).muted, false, 'gap: bar 0 plays');
  assert.equal(bar(1).muted, true, 'gap: bar 1 silent');
  assert.equal(bar(1).bpm, 90, 'trainer steps from bar 0');
  near(bar(0).time, 0.1 + 8 * 0.75, 'bar 0 right after the count-in');
});

test('count-in: 6/8 counts the dotted-quarter beats', () => {
  const { events } = runSeq(cfg({ bpm: 60 }), metronomeSequence({ meter: '6/8', subdivision: 'eighth' }), 4, 1);
  const clicks = events.filter(e => e.countIn && e.hits.length);
  assert.equal(clicks.length, 2);
  near(clicks[1].time - clicks[0].time, 1, 'one per dotted quarter');
});

test('stopping inside onStep ends the scheduling loop at once', () => {
  const events = [];
  const s = new Sequencer(cfg(), e => { events.push(e); if (e.barCount === 1 && e.beat === 0) s.stop(); });
  s.setSequence(metronomeSequence({ meter: '4/4', subdivision: 'sixteenth' }));
  s.start(0);
  s.scheduleUntil(100);
  assert.equal(events.length, 17, 'one bar of 16ths, then the bar-line step that stopped it');
  near(events[16].time, 2, 'the bar line');
});

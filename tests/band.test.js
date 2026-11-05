// Backing band tests: chord theory, band parts and notes per step.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNumeral, parseProgression, PROGRESSIONS, BAND_STYLES, partsFor, bassNote, bassRoot,
  chordVoicing, bandNotes, styleForGroove, NOTE_NAMES,
} from '../js/band.js';
import { GROOVES, grooveToPattern } from '../js/grooves.js';
import { toSequence } from '../js/patterns.js';
import { Sequencer } from '../js/sequencer.js';

const A = 9, C = 0;

test('roman numerals in a key', () => {
  assert.deepEqual(parseNumeral('i', A), { root: 9, quality: 'min', name: 'Am' });
  assert.equal(parseNumeral('iv', A).name, 'Dm');
  assert.equal(parseNumeral('bVII', A).name, 'G');
  assert.equal(parseNumeral('V7', C).name, 'G7');
  assert.equal(parseNumeral('ii7', C).name, 'Dm7');
  assert.equal(parseNumeral('Imaj7', C).name, 'Cmaj7');
  assert.equal(parseNumeral('vii' + 'dim', C).name, 'Bdim');
  assert.equal(parseNumeral('#IV', C).name, 'F#');
  assert.equal(parseNumeral('hello', C), null);
});

test('progressions: presets parse, blues has 12 bars, junk falls back to the tonic', () => {
  for (const p of Object.keys(PROGRESSIONS)) assert.ok(parseProgression(p, 0).length >= 1, p);
  const blues = parseProgression('blues', A);
  assert.equal(blues.length, 12);
  assert.deepEqual(blues.map(c => c.name).slice(0, 5), ['A7', 'A7', 'A7', 'A7', 'D7']);
  assert.deepEqual(parseProgression('i, iv | v', A).map(c => c.name), ['Am', 'Dm', 'Em']);
  assert.deepEqual(parseProgression('??', C).map(c => c.name), ['C']);
});

test('every band style parses, each part fills its bar exactly', () => {
  for (const [id, s] of Object.entries(BAND_STYLES)) {
    for (const steps of [16, 12]) {
      if (!s[steps]) continue;
      const strip = x => x.replace(/[\s|]/g, '');
      assert.equal(strip(s[steps].bass).length, steps, `${id} ${steps} bass`);
      assert.equal(strip(s[steps].keys).length, steps, `${id} ${steps} keys`);
      assert.ok(/^[R345678a_-]+$/.test(strip(s[steps].bass)), `${id} bass characters`);
      assert.ok(/^[xXo_-]+$/.test(strip(s[steps].keys)), `${id} keys characters`);
    }
    assert.ok(parseProgression(s.progression, 0).length, id + ' default progression');
  }
});

test('bass notes follow the chord: thirds, sevenths, octave, approach', () => {
  const am = parseNumeral('i', A), d7 = parseNumeral('IV7', A), e = parseNumeral('V', A);
  const r = bassRoot(9);
  assert.ok(r >= 28 && r <= 39, 'bass register');
  assert.equal(bassNote('R', am), r);
  assert.equal(bassNote('3', am) - r, 3, 'minor third');
  assert.equal(bassNote('3', d7) - bassRoot(2), 4, 'major third');
  assert.equal(bassNote('7', d7) - bassRoot(2), 10, 'b7 on a dominant chord');
  assert.equal(bassNote('8', am) - r, 12);
  assert.equal(bassNote('a', am, e) % 12, (4 - 1 + 12) % 12, 'approach = a semitone under E');
  assert.ok(Math.abs(bassNote('a', am, e) - r) <= 7, 'approach stays close');
});

test('chord voicings sit in a sensible range', () => {
  for (let pc = 0; pc < 12; pc++) {
    const v = chordVoicing(parseNumeral('I7', pc));
    assert.ok(v[0] >= 52 && v[0] < 64 && v.length === 4, NOTE_NAMES[pc]);
    assert.deepEqual(v.map(n => n - v[0]), [0, 4, 7, 10]);
  }
  assert.equal(chordVoicing(parseNumeral('i', A), true)[0], chordVoicing(parseNumeral('i', A))[0] + 12);
});

test('one-drop band: bass on 1, skank on 2 and 4, chord changes each bar', () => {
  const chords = parseProgression('i iv', A);
  const p = grooveToPattern(GROOVES.find(g => g.id === 'one-drop'));
  const events = [];
  const s = new Sequencer({ bpm: 72, swing: 0, swingRes: 8, trainer: { enabled: false }, gap: { enabled: false } },
    ev => events.push({ ev, notes: bandNotes(ev, 'reggae', chords) }));
  s.setSequence(toSequence(p));
  s.start(0);
  s.scheduleUntil(6.7); // two bars at 72 bpm
  const skanks = events.filter(e => e.notes.some(n => n.part === 'keys'));
  assert.deepEqual(skanks.slice(0, 4).map(e => [e.ev.barCount, e.ev.beat]), [[0, 1], [0, 3], [1, 1], [1, 3]]);
  const bar1 = skanks[0].notes.find(n => n.part === 'keys').notes;
  const bar2 = skanks[2].notes.find(n => n.part === 'keys').notes;
  assert.equal(bar1[0] % 12, 9, 'Am in bar 1');
  assert.equal(bar2[0] % 12, 2, 'Dm in bar 2');
  const firstBass = events.find(e => e.notes.some(n => n.part === 'bass'));
  assert.deepEqual([firstBass.ev.beat, firstBass.ev.stepInBeat], [0, 0]);
  assert.equal(firstBass.notes[0].steps, 7, 'held for 7 sixteenths');
});

test('odd meters and unmatched grids get a generic part', () => {
  const g = partsFor('reggae', 2, 7); // 7/8
  assert.equal(g.steps, 14);
  assert.equal(g.bass[0].step, 0);
  assert.equal(g.keys[0].len, 14, 'chord held for the bar');
  const w = partsFor('jazz', 3, 3); // jazz waltz
  assert.equal(w.steps, 9);
  assert.equal(w.bass.length, 3, 'root, fifth, approach');
});

test('every library groove gets a band style that can play it', () => {
  const chords = parseProgression('I IV', 0);
  for (const gr of GROOVES) {
    const style = styleForGroove(gr);
    assert.ok(BAND_STYLES[style], `${gr.id} -> ${style}`);
    const seq = toSequence(grooveToPattern(gr));
    const parts = partsFor(style, seq.spb, seq.beatsPerBar);
    assert.equal(parts.steps, seq.spb * seq.beatsPerBar, gr.id);
    const ev = { beat: 0, stepInBeat: 0, spb: seq.spb, beatsPerBar: seq.beatsPerBar, barCount: 0 };
    assert.ok(Array.isArray(bandNotes(ev, style, chords)));
  }
  assert.equal(styleForGroove(GROOVES.find(g => g.id === 'bossa-nova')), 'bossa');
  assert.equal(styleForGroove(GROOVES.find(g => g.id === 'salsa-3-2')), 'latin');
  assert.equal(styleForGroove(GROOVES.find(g => g.id === 'blues-shuffle')), 'shuffle');
});

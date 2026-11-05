// MIDI mapping/clock conversion, per-drum + dynamics stats, take recording.
import test from 'node:test';
import assert from 'node:assert/strict';
import { noteToVoice, parseNoteOn, perfToContextTime, GM_DRUMS } from '../js/midi.js';
import { TakeRecorder, encodeWav, alignTake } from '../js/recorder.js';
import { gridPoints, matchHits, summarizeByVoice, dynamics } from '../js/timing-analysis.js';
import { KIT_IDS } from '../js/patterns.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('GM drum notes map to kit voices; custom mapping wins', () => {
  assert.equal(noteToVoice(36), 'kick');
  assert.equal(noteToVoice(38), 'snare');
  assert.equal(noteToVoice(37), 'rim');
  assert.equal(noteToVoice(42), 'hh');
  assert.equal(noteToVoice(46), 'oh');
  assert.equal(noteToVoice(51), 'ride');
  assert.equal(noteToVoice(43), 'tom3');
  assert.equal(noteToVoice(99), 'other');
  assert.equal(noteToVoice(99, { 99: 'cowbell' }), 'cowbell');
  for (const v of Object.values(GM_DRUMS)) assert.ok(KIT_IDS.includes(v), v);
});

test('MIDI messages: note-on, note-on with velocity 0, other messages', () => {
  assert.deepEqual(parseNoteOn([0x99, 38, 100]), { note: 38, velocity: 100 }); // channel 10
  assert.equal(parseNoteOn([0x99, 38, 0]), null);
  assert.equal(parseNoteOn([0x89, 38, 64]), null);
  assert.equal(parseNoteOn([0xb9, 4, 90]), null); // hi-hat pedal controller
});

test('performance.now() -> audio clock as heard', () => {
  const stamp = { contextTime: 12.5, performanceTime: 40000 };
  near(perfToContextTime(40100, stamp), 12.6, 1e-9, '100 ms later');
  near(perfToContextTime(39990, stamp), 12.49, 1e-9, 'slightly before the stamp');
});

test('per-drum timing and dynamics from MIDI hits', () => {
  const beats = Array.from({ length: 16 }, (_, i) => ({ time: i * 0.5, dur: 0.5, barCount: Math.floor(i / 4), beat: i % 4 }));
  const grid = gridPoints(beats, 2);
  const hits = [];
  beats.forEach((b, i) => {
    if (b.beat % 2 === 0) hits.push({ time: b.time + 0.004, voice: 'kick', velocity: 110 });
    else hits.push({ time: b.time + 0.018, voice: 'snare', velocity: 115 + (i % 2) });
    hits.push({ time: b.time + 0.25 - 0.006, voice: 'snare', velocity: 30 + (i % 3) * 2 }); // ghosts on the &s
  });
  const matched = matchHits(hits, grid, 0);
  const by = summarizeByVoice(matched);
  const kick = by.find(v => v.voice === 'kick');
  near(kick.mean, 4, 1e-6, 'kick average');
  const snare = by.find(v => v.voice === 'snare');
  assert.equal(snare.count, 24);
  const d = dynamics(matched.filter(h => h.voice === 'snare'));
  assert.equal(d.ghosts.count, 16);
  assert.equal(d.accents.count, 8);
  near(d.ghosts.mean, 32, 0.5, 'ghost velocity');
  assert.ok(d.ghosts.sd < 2.5 && d.range > 80, `ghost sd ${d.ghosts.sd}, range ${d.range}`);
});

test('take recorder keeps exact timing, fills dropped blocks with silence', () => {
  const r = new TakeRecorder(48000);
  r.add(new Float32Array(128).fill(0.5), 48000 * 10);   // starts at 10 s
  r.add(new Float32Array(128).fill(0.5), 48000 * 10 + 256); // one block missing
  assert.equal(r.startTime, 10);
  assert.equal(r.length, 384);
  const s = r.samples();
  assert.equal(s[127], 0.5);
  assert.equal(s[200], 0, 'gap is silent');
  assert.equal(s[300], 0.5, 'later block at its true position');
});

test('WAV export has a valid header and length', () => {
  const wav = new DataView(encodeWav(new Float32Array([0, 1, -1, 0.5]), 44100));
  const tag = o => String.fromCharCode(...[0, 1, 2, 3].map(i => wav.getUint8(o + i)));
  assert.equal(tag(0), 'RIFF');
  assert.equal(tag(8), 'WAVE');
  assert.equal(wav.getUint32(24, true), 44100);
  assert.equal(wav.getUint32(40, true), 8);
  assert.equal(wav.getInt16(46, true), 32767);
  assert.equal(wav.getInt16(48, true), -32768);
});

test('playback over the groove lines the take up with the new first beat', () => {
  // take: recording began at 5.0, first beat at 5.3, latency 0.1
  const a = alignTake(5.0, 5.3, 20.0, 0.1, 19.0);
  near(a.when, 19.6, 1e-9, 'start 0.3 s before the beat, minus latency');
  assert.equal(a.offset, 0);
  const late = alignTake(5.0, 5.3, 19.2, 0.1, 19.0); // would start in the past
  near(late.when, 19.0, 1e-9, 'starts now');
  near(late.offset, 0.2, 1e-9, 'skips the part already missed');
});

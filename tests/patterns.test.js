// Pattern model, library persistence and JSON import/export tests.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal in-memory localStorage for Node.
class MemoryStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}
globalThis.localStorage = new MemoryStorage();

const P = await import('../js/patterns.js');
const store = await import('../js/storage.js');
const { GROOVES, FAMILIES, grooveToPattern } = await import('../js/grooves.js');

beforeEach(() => { globalThis.localStorage = new MemoryStorage(); });

test('every built-in groove parses to a valid pattern with the right length', () => {
  const ids = new Set();
  for (const g of GROOVES) {
    for (const [voice, str] of Object.entries(g.tracks)) {
      const len = P.parseTrack(str).length * (g.eighths ? 2 : 1);
      assert.equal(len % g.steps, 0, `${g.id}.${voice} length ${len} not a multiple of ${g.steps}`);
      assert.ok(P.KIT_IDS.includes(voice), `${g.id}: unknown voice ${voice}`);
    }
    const p = grooveToPattern(g);
    assert.equal(p.stepsPerBar, g.steps, `${g.id}: ${g.steps} steps is not valid for ${g.meter || '4/4'}`);
    // every track in a groove has the same number of bars
    const lens = new Set(Object.values(g.tracks).map(t => P.parseTrack(t).length));
    assert.equal(lens.size, 1, `${g.id}: tracks have different lengths ${[...lens]}`);
    assert.ok(FAMILIES.includes(g.style), `${g.id}: unknown family ${g.style}`);
    for (const id of P.KIT_IDS) assert.equal(p.tracks[id].length, p.stepsPerBar * p.bars, `${g.id}.${id}`);
    assert.ok(g.desc && g.bpm >= 30 && g.bpm <= 300, g.id);
    assert.ok(!ids.has(g.id), 'duplicate id ' + g.id);
    ids.add(g.id);
  }
  const styles = new Set(GROOVES.map(g => g.style));
  for (const s of FAMILIES) assert.ok(styles.has(s), 'no grooves in family ' + s);
});

test('linear groove really is linear', () => {
  const p = grooveToPattern(GROOVES.find(g => g.id === 'linear'));
  for (let i = 0; i < 16; i++) {
    const n = P.KIT_IDS.filter(id => p.tracks[id][i]).length;
    assert.ok(n <= 1, `step ${i} has ${n} voices`);
  }
});

test('storage wrapper survives a throwing localStorage', () => {
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); } };
  assert.equal(store.load('x', 42), 42);
  assert.equal(store.save('x', 1), false);
  const lib = new P.PatternLibrary();
  assert.deepEqual(lib.patterns, []);
  lib.put(P.blankPattern('a')); // must not throw
});

test('storage wrapper handles corrupt JSON', () => {
  localStorage.setItem('grooveTrainer.patterns', '{not json');
  const lib = new P.PatternLibrary();
  assert.deepEqual(lib.patterns, []);
});

test('library save / reload / rename / duplicate / delete round-trip', () => {
  const lib = new P.PatternLibrary();
  const p = P.blankPattern('Groove A');
  p.tracks.kick[0] = P.ACCENT;
  p.tracks.snare[4] = P.HIT;
  p.tracks.snare[7] = P.GHOST;
  lib.put(p);

  // Saved copy must be independent of the working pattern.
  p.tracks.kick[0] = P.OFF;
  assert.equal(lib.get(p.id).tracks.kick[0], P.ACCENT);

  let lib2 = new P.PatternLibrary();
  assert.equal(lib2.patterns.length, 1);
  const r = lib2.get(p.id);
  assert.equal(r.name, 'Groove A');
  assert.equal(r.tracks.kick[0], P.ACCENT);
  assert.equal(r.tracks.snare[7], P.GHOST);

  lib2.rename(p.id, 'Renamed');
  const dup = lib2.duplicate(p.id);
  assert.notEqual(dup.id, p.id);
  assert.equal(dup.name, 'Renamed copy');
  dup.tracks.kick[1] = P.HIT; // editing the duplicate doesn't touch the original
  assert.equal(lib2.get(p.id).tracks.kick[1], P.OFF);

  lib2 = new P.PatternLibrary();
  assert.deepEqual(lib2.patterns.map(x => x.name), ['Renamed', 'Renamed copy']);
  assert.ok(lib2.delete(p.id));
  assert.deepEqual(new P.PatternLibrary().patterns.map(x => x.name), ['Renamed copy']);
});

test('put with existing id replaces instead of duplicating', () => {
  const lib = new P.PatternLibrary();
  const p = P.blankPattern('X');
  lib.put(p);
  p.name = 'Y';
  lib.put(p);
  assert.equal(lib.patterns.length, 1);
  assert.equal(new P.PatternLibrary().patterns[0].name, 'Y');
});

test('export -> import round-trip preserves every step and setting', () => {
  const a = grooveToPattern(GROOVES.find(g => g.id === 'funk-16-ghost'));
  const b = P.blankPattern('Trip');
  P.setResolution(b, 12);
  P.setBars(b, 3);
  b.tracks.ride[35] = P.ACCENT;
  b.swing = 0.4; b.swingRes = 8; b.bpm = 133;
  const json = P.exportPatterns([a, b]);
  const back = P.importPatterns(json);
  assert.equal(back.length, 2);
  assert.deepEqual(back[0].tracks, a.tracks);
  assert.deepEqual(back[1], b);
});

test('import gives new ids to clashes and accepts single objects / arrays', () => {
  const p = P.blankPattern('Mine');
  const json = P.exportPatterns([p]);
  const back = P.importPatterns(json, new Set([p.id]));
  assert.notEqual(back[0].id, p.id);
  assert.equal(P.importPatterns(JSON.stringify(p))[0].name, 'Mine');
  assert.equal(P.importPatterns(JSON.stringify([p, p])).length, 2);
  const two = P.importPatterns(JSON.stringify([p, p]));
  assert.notEqual(two[0].id, two[1].id, 'duplicate ids inside one file are fixed');
});

test('import rejects junk with a readable error', () => {
  assert.throws(() => P.importPatterns('hello'), /valid JSON/);
  assert.throws(() => P.importPatterns('{"foo":1}'), /No patterns/);
  assert.throws(() => P.importPatterns('[]'), /No patterns/);
});

test('normalize clamps bad values', () => {
  const p = P.normalizePattern({ name: 'z', stepsPerBar: 7, bars: 9, bpm: 999, swing: 5,
    tracks: { kick: [1, 9, -1, 'x', 2], didgeridoo: [1] } });
  assert.equal(p.stepsPerBar, 16);
  assert.equal(p.bars, 4);
  assert.equal(p.bpm, 300);
  assert.equal(p.swing, 1);
  assert.deepEqual(p.tracks.kick.slice(0, 6), [1, 0, 0, 0, 2, 0]);
  assert.equal(p.tracks.kick.length, 64);
  assert.ok(!('didgeridoo' in p.tracks));
  assert.deepEqual(p.tracks.cowbell, new Array(64).fill(0), 'known voices missing from input are silent');
});

test('setBars repeats existing bars; setResolution maps to nearest step', () => {
  const p = P.blankPattern();
  p.tracks.kick[0] = P.ACCENT;
  p.tracks.snare[4] = P.HIT;
  P.setBars(p, 2);
  assert.equal(p.tracks.kick.length, 32);
  assert.equal(p.tracks.kick[16], P.ACCENT);
  P.setBars(p, 1);
  assert.equal(p.tracks.kick.length, 16);
  P.setResolution(p, 12);
  assert.equal(p.tracks.snare.length, 12);
  assert.equal(p.tracks.snare[3], P.HIT, 'beat 2 stays on beat 2');
  P.setResolution(p, 16);
  assert.equal(p.tracks.snare[4], P.HIT);
});

test('files from version 1 (core kit only) still import, new voices silent', () => {
  const v1 = JSON.stringify({ format: 'groove-trainer-patterns', version: 1, patterns: [{
    id: 'p_old', name: 'Old', stepsPerBar: 16, bars: 1, bpm: 90, swing: 0, swingRes: 16,
    tracks: { ride: '----------------', oh: '----------------', hh: 'x-x-x-x-x-x-x-x-',
      rim: '----------------', snare: '----X-------X---', kick: 'X-------X-------' } }] });
  const [p] = P.importPatterns(v1);
  assert.equal(p.tracks.snare[4], P.ACCENT);
  for (const v of P.KIT_VOICES) assert.equal(p.tracks[v.id].length, 16, v.id);
  assert.ok(p.tracks.congaH.every(x => x === 0));
});

test('export leaves out silent tracks and keeps percussion', () => {
  const p = P.blankPattern('Perc');
  p.tracks.clave[0] = P.HIT;
  p.tracks.congaL[6] = P.ACCENT;
  const data = JSON.parse(P.exportPatterns([p]));
  assert.deepEqual(Object.keys(data.patterns[0].tracks).sort(), ['clave', 'congaL']);
  const [back] = P.importPatterns(JSON.stringify(data));
  assert.deepEqual(back.tracks, p.tracks);
});

test('every kit voice has a label, short name, group and default volume', () => {
  const ids = new Set();
  for (const v of P.KIT_VOICES) {
    assert.ok(v.label && v.short && ['kit', 'perc'].includes(v.group) && v.vol > 0 && v.vol <= 1, v.id);
    assert.ok(!ids.has(v.id), 'duplicate ' + v.id);
    ids.add(v.id);
  }
});

test('eighth-note grooves expand to 16ths: son clave 3-2 lands on the right steps', () => {
  const p = grooveToPattern(GROOVES.find(g => g.id === 'salsa-3-2'));
  assert.equal(p.bars, 2);
  const hits = p.tracks.clave.flatMap((v, i) => (v ? [i] : []));
  // eighths 0,3,6 | 10,12 -> 16th steps 0,6,12 | 20,24
  assert.deepEqual(hits, [0, 6, 12, 20, 24]);
});

test('time signatures: 3/4 and 7/8 grooves play with the right beats per bar', () => {
  const waltz = P.toSequence(grooveToPattern(GROOVES.find(g => g.id === 'jazz-waltz')));
  assert.deepEqual([waltz.beatsPerBar, waltz.spb], [3, 3]);
  const seven = P.toSequence(grooveToPattern(GROOVES.find(g => g.id === 'fusion-7-8')));
  assert.deepEqual([seven.beatsPerBar, seven.spb], [7, 2]);
  const five = P.toSequence(grooveToPattern(GROOVES.find(g => g.id === 'funk-5-4')));
  assert.deepEqual([five.beatsPerBar, five.spb], [5, 4]);
});

test('setMeter keeps notes in place and pads or cuts the bar', () => {
  const p = P.blankPattern();
  p.tracks.kick[0] = P.ACCENT;
  p.tracks.snare[12] = P.HIT;   // beat 4
  P.setBars(p, 2);
  P.setMeter(p, '3/4');
  assert.equal(p.stepsPerBar, 12);
  assert.equal(p.tracks.kick.length, 24);
  assert.equal(p.tracks.kick[12], P.ACCENT, 'bar 2 downbeat kept');
  assert.ok(p.tracks.snare.every(v => v === 0), 'beat 4 does not exist in 3/4');
  P.setMeter(p, '5/4');
  assert.equal(p.stepsPerBar, 20);
  assert.equal(p.tracks.kick[20], P.ACCENT);
  // a triplet pattern moving to 7/8 (no triplet grid) becomes straight
  const t = P.blankPattern();
  P.setResolution(t, 12);
  t.tracks.hh[3] = P.HIT; // beat 2 on the triplet grid
  P.setMeter(t, '7/8');
  assert.equal(t.stepsPerBar, 14);
  assert.equal(t.tracks.hh[4], P.HIT, 'beat 2 = 16th step 4');
  const back = P.normalizePattern(JSON.parse(P.exportPatterns([t])).patterns[0]);
  assert.equal(back.meter, '7/8');
  assert.deepEqual(back.tracks.hh, t.tracks.hh);
});

test('normalize rejects step counts that do not fit the meter', () => {
  assert.equal(P.normalizePattern({ meter: '3/4', stepsPerBar: 16, tracks: {} }).stepsPerBar, 12);
  assert.equal(P.normalizePattern({ meter: '3/4', stepsPerBar: 9, tracks: {} }).stepsPerBar, 9);
  assert.equal(P.normalizePattern({ meter: '7/8', stepsPerBar: 12, tracks: {} }).stepsPerBar, 14);
  assert.equal(P.normalizePattern({ meter: '9/4', tracks: {} }).meter, '4/4');
});

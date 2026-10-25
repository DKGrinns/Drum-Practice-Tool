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
const { GROOVES, grooveToPattern } = await import('../js/grooves.js');

beforeEach(() => { globalThis.localStorage = new MemoryStorage(); });

test('every built-in groove parses to a valid pattern with the right length', () => {
  const ids = new Set();
  for (const g of GROOVES) {
    for (const [voice, str] of Object.entries(g.tracks)) {
      const len = P.parseTrack(str).length;
      assert.equal(len % g.steps, 0, `${g.id}.${voice} length ${len} not a multiple of ${g.steps}`);
      assert.ok(P.KIT_IDS.includes(voice), `${g.id}: unknown voice ${voice}`);
    }
    const p = grooveToPattern(g);
    for (const id of P.KIT_IDS) assert.equal(p.tracks[id].length, p.stepsPerBar * p.bars, `${g.id}.${id}`);
    assert.ok(g.desc && g.bpm >= 30 && g.bpm <= 300, g.id);
    assert.ok(!ids.has(g.id), 'duplicate id ' + g.id);
    ids.add(g.id);
  }
  const styles = new Set(GROOVES.map(g => g.style));
  for (const s of ['Reggae', 'Funk', 'Soul', 'Fusion']) assert.ok(styles.has(s));
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
    tracks: { kick: [1, 9, -1, 'x', 2], cowbell: [1] } });
  assert.equal(p.stepsPerBar, 16);
  assert.equal(p.bars, 4);
  assert.equal(p.bpm, 300);
  assert.equal(p.swing, 1);
  assert.deepEqual(p.tracks.kick.slice(0, 6), [1, 0, 0, 0, 2, 0]);
  assert.equal(p.tracks.kick.length, 64);
  assert.ok(!('cowbell' in p.tracks));
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

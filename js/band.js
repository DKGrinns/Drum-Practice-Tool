// band.js — the backing band: chord progressions, bass lines and chord
// rhythms (pure functions, tested in tests/band.test.js).
//
// A band style has a bass line and a chord rhythm for a 16-step bar and/or
// a 12-step (triplet) bar, written like the drum notation:
//   bass:  R root  3 third  5 fifth  6 sixth  7 seventh  8 octave  4 fourth
//          a approach note (a semitone below the next chord's root)
//          _ hold the previous note   - rest
//   keys:  x chord stab  X accented stab  o held chord  _ hold  - rest
// Spaces are ignored. Grooves whose grid doesn't match a style (3/4, 5/4,
// 7/8 ...) get a simple generic part built from the beats.
//
// Progressions are Roman numerals, one chord per bar: upper case = major,
// lower case = minor, then optional 7 / maj7 / dim, and b/# for flat/sharp
// degrees. E.g. "i iv", "ii7 V7 Imaj7 Imaj7", "I bVII IV I".

export const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

const DEGREE = { I: 0, II: 2, III: 4, IV: 5, V: 7, VI: 9, VII: 11 };
const QUALITY = {
  maj:  { third: 4, fifth: 7, seventh: null, name: '' },
  min:  { third: 3, fifth: 7, seventh: null, name: 'm' },
  dom7: { third: 4, fifth: 7, seventh: 10, name: '7' },
  min7: { third: 3, fifth: 7, seventh: 10, name: 'm7' },
  maj7: { third: 4, fifth: 7, seventh: 11, name: 'maj7' },
  dim:  { third: 3, fifth: 6, seventh: null, name: 'dim' },
};

// Parse one numeral in a key (key = pitch class 0..11). Returns
// { root (pitch class), quality, name } or null if it isn't a numeral.
export function parseNumeral(token, key = 0) {
  const m = /^([b#]?)(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)(maj7|7|dim)?$/.exec(token.trim());
  if (!m) return null;
  const [, acc, num, suffix] = m;
  const minor = num === num.toLowerCase();
  let quality = minor ? 'min' : 'maj';
  if (suffix === '7') quality = minor ? 'min7' : 'dom7';
  else if (suffix === 'maj7') quality = 'maj7';
  else if (suffix === 'dim') quality = 'dim';
  const root = (key + DEGREE[num.toUpperCase()] + (acc === 'b' ? -1 : acc === '#' ? 1 : 0) + 12) % 12;
  return { root, quality, name: NOTE_NAMES[root] + QUALITY[quality].name };
}

export const PROGRESSIONS = {
  'i': 'One chord (minor)',
  'I': 'One chord (major)',
  'i7': 'Minor 7 vamp',
  'I7': 'Dominant 7 vamp',
  'i iv': 'i – iv',
  'i bVII': 'i – ♭VII',
  'i iv i v': 'i – iv – i – v',
  'I IV': 'I – IV',
  'I V': 'I – V',
  'I IV V IV': 'I – IV – V – IV',
  'I vi IV V': 'I – vi – IV – V',
  'I bVII IV I': 'I – ♭VII – IV – I',
  'ii7 V7 Imaj7 Imaj7': 'ii – V – I',
  'Imaj7 Imaj7 ii7 V7': 'I – I – ii – V',
  'blues': '12-bar blues',
};
const EXPAND = { blues: 'I7 I7 I7 I7 IV7 IV7 I7 I7 V7 IV7 I7 V7' };

// Progression text -> list of chords (one per bar). Unknown tokens are
// skipped; an empty result falls back to the tonic.
export function parseProgression(text, key = 0) {
  const src = EXPAND[text] || text || 'I';
  const chords = src.split(/[\s,|–-]+/).filter(Boolean).map(t => parseNumeral(t, key)).filter(Boolean);
  return chords.length ? chords : [parseNumeral('I', key)];
}

// ------------------------------------------------------------------ styles

export const BAND_STYLES = {
  reggae: {
    label: 'Reggae (one drop / roots)', sound: 'skank', tone: 'deep', progression: 'i iv',
    16: { bass: 'R___ ___- --5- R-a-', keys: '---- x--- ---- x---' },
    12: { bass: 'R__ ___ -5- R-a', keys: '--- x-- --- x--' },
  },
  rockers: {
    label: 'Reggae (rockers / steppers)', sound: 'skank', tone: 'deep', progression: 'i bVII',
    16: { bass: 'R-R- R-5- R-R- 5-a-', keys: '---- x--- ---- x---' },
    12: { bass: 'R-R R-5 R-R 5-a', keys: '--- x-- --- x--' },
  },
  ska: {
    label: 'Ska', sound: 'skank', tone: 'pluck', progression: 'I IV V IV',
    16: { bass: 'R-3- 5-6- 8-6- 5-a-', keys: '--x- --x- --x- --x-' },
  },
  caribbean: {
    label: 'Dancehall / soca', sound: 'stab', tone: 'deep', progression: 'i iv',
    16: { bass: 'R__R __R_ R__R __a_', keys: '--x- --x- --x- --x-' },
  },
  funk: {
    label: 'Funk', sound: 'stab', tone: 'pluck', progression: 'i7',
    16: { bass: 'R_-R --8- -R-7 --5a', keys: '--x- x--x --x- x---' },
    12: { bass: 'R-R --8 -R7 -5a', keys: '--x x-- --x x--' },
  },
  soul: {
    label: 'Soul / R&B', sound: 'keys', tone: 'pluck', progression: 'I vi IV V',
    16: { bass: 'R__- --5- R__- -3a-', keys: '---- o___ ---- o___' },
    12: { bass: 'R-- -5- R-- 3-a', keys: '--- o-- --- o--' },
  },
  shuffle: {
    label: 'Blues / shuffle', sound: 'organ', tone: 'pluck', progression: 'blues',
    12: { bass: 'R-3 5-6 7-6 5-3', keys: '--- o-- --- o--' },
    16: { bass: 'R-3- 5-6- 7-6- 5-3-', keys: '---- o--- ---- o---' },
  },
  jazz: {
    label: 'Jazz (walking bass)', sound: 'keys', tone: 'upright', progression: 'ii7 V7 Imaj7 Imaj7',
    12: { bass: 'R-- 3-- 5-- a--', keys: 'x-- --x --- ---' },
    16: { bass: 'R--- 3--- 5--- a---', keys: 'x--- --x- ---- ----' },
  },
  bossa: {
    label: 'Bossa nova', sound: 'keys', tone: 'upright', progression: 'Imaj7 Imaj7 ii7 V7',
    16: { bass: 'R___ __5_ 5___ __a_', keys: 'x--- --x- ---- x---' },
  },
  samba: {
    label: 'Samba', sound: 'stab', tone: 'pluck', progression: 'I vi ii7 V7',
    16: { bass: 'R--- 5___ R--- 5___', keys: 'x-xx -x-x x-xx -x-x' },
  },
  latin: {
    label: 'Salsa / Latin (tumbao)', sound: 'keys', tone: 'pluck', progression: 'I IV V IV',
    16: { bass: '---- --R_ ---- 5___', keys: 'x-x- -x-x -x-x x-x-' },
  },
  afro: {
    label: 'Afrobeat / highlife', sound: 'stab', tone: 'pluck', progression: 'i',
    16: { bass: 'R--R --5- -R-- 7-5-', keys: '-x-x -x-x -x-x -x-x' },
  },
  rock: {
    label: 'Rock / pop', sound: 'organ', tone: 'pluck', progression: 'I bVII IV I',
    16: { bass: 'R-R- R-R- R-R- 5-a-', keys: 'o___ ____ ____ ____' },
  },
};

// Which band style suits a library groove.
const BY_ID = {
  rockers: 'rockers', steppers: 'rockers', rocksteady: 'rockers', 'reggae-funk': 'rockers',
  ska: 'ska', 'bossa-nova': 'bossa', 'jazz-waltz': 'jazz',
  'half-time-shuffle': 'shuffle', 'soul-shuffle': 'shuffle', 'gospel-shuffle': 'shuffle', 'soul-ballad': 'soul',
  'boom-bap': 'soul', 'dilla-feel': 'soul', 'neo-soul': 'soul', 'bembe-6-8': 'afro',
};
const BY_FAMILY = {
  'Reggae': 'reggae', 'Caribbean': 'caribbean', 'Funk': 'funk', 'Soul & R&B': 'soul', 'Jazz': 'jazz',
  'Fusion': 'funk', 'Afro-Cuban': 'latin', 'Latin': 'latin', 'Brazilian': 'samba', 'African': 'afro',
  'Hip-hop': 'funk', 'Rock & Pop': 'rock', 'Blues & Country': 'shuffle',
};
export function styleForGroove(g) {
  if (!g) return 'rock';
  return BY_ID[g.id] || BY_FAMILY[g.style] || 'rock';
}

// ---------------------------------------------------------------- compiling

const strip = s => s.replace(/[\s|]/g, '');

// Template strings -> { bass: [{step, deg, len}], keys: [{step, kind, len}] }
function compileParts(bass, keys) {
  const events = (str, isNote) => {
    const s = strip(str);
    const out = [];
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '-' || c === '_') continue;
      let len = 1;
      while (s[i + len] === '_') len++;
      out.push(isNote(c) ? { step: i, deg: c, len } : { step: i, kind: c, len });
    }
    return { steps: s.length, events: out };
  };
  const b = events(bass, () => true);
  const k = events(keys, () => false);
  return { steps: b.steps, bass: b.events, keys: k.events };
}

// A simple part for any meter/grid: bass root on beat 1, fifth half-way,
// approach note on the last beat (if there are 3+ beats); chord held for the
// whole bar.
function genericParts(spb, beats) {
  const steps = spb * beats;
  const half = Math.floor(beats / 2) * spb;
  const bass = [{ step: 0, deg: 'R', len: Math.max(1, half - 1) }];
  if (beats >= 2) bass.push({ step: half, deg: '5', len: Math.max(1, (beats - 1) * spb - half) });
  if (beats >= 3) bass.push({ step: (beats - 1) * spb, deg: 'a', len: spb });
  return { steps, bass, keys: [{ step: 0, kind: 'o', len: steps }] };
}

const cache = new Map();
// Parts for a style on a given grid (falls back to the generic part).
export function partsFor(styleId, spb, beats) {
  const key = `${styleId}:${spb}:${beats}`;
  if (cache.has(key)) return cache.get(key);
  const style = BAND_STYLES[styleId];
  const steps = spb * beats;
  let parts;
  if (style && beats === 4 && style[steps]) parts = compileParts(style[steps].bass, style[steps].keys);
  else parts = genericParts(spb, beats);
  cache.set(key, parts);
  return parts;
}

// ------------------------------------------------------------------ pitches

const BASS_LOW = 28; // E1: bass roots sit between E1 and D#2

export function bassRoot(pc) {
  return BASS_LOW + ((pc - (BASS_LOW % 12) + 12) % 12);
}

// MIDI note for a bass degree over a chord. `next` = the next bar's chord
// (for approach notes).
export function bassNote(deg, chord, next) {
  const root = bassRoot(chord.root);
  const q = QUALITY[chord.quality];
  switch (deg) {
    case '3': return root + q.third;
    case '4': return root + 5;
    case '5': return root + q.fifth;
    case '6': return root + 9;
    case '7': return root + (q.seventh || 10);
    case '8': return root + 12;
    case 'a': {
      // A semitone below the next root, in the octave closest to this root.
      let target = bassRoot((next || chord).root);
      if (target - root > 6) target -= 12;
      if (root - target > 6) target += 12;
      return target - 1;
    }
    default: return root;
  }
}

// Chord voicing (MIDI notes), close position with the lowest note at or
// above E3 (52). Skanks and stabs sit an octave higher to cut through.
export function chordVoicing(chord, high = false) {
  const q = QUALITY[chord.quality];
  let root = 48 + chord.root;
  if (root < 52) root += 12;
  const notes = [root, root + q.third, root + q.fifth];
  if (q.seventh) notes.push(root + q.seventh);
  return high ? notes.map(n => n + 12) : notes;
}

// Notes the band plays on one sequencer step.
//   ev        the sequencer step event
//   styleId   band style
//   chords    parsed progression (one chord per bar)
// Returns [{ part: 'bass'|'keys', notes: [midi...], steps, accent, sound, tone }].
export function bandNotes(ev, styleId, chords) {
  const style = BAND_STYLES[styleId] || BAND_STYLES.rock;
  const parts = partsFor(styleId, ev.spb, ev.beatsPerBar);
  const step = ev.beat * ev.spb + ev.stepInBeat;
  const chord = chords[ev.barCount % chords.length];
  const next = chords[(ev.barCount + 1) % chords.length];
  const out = [];
  for (const b of parts.bass) {
    if (b.step === step) out.push({ part: 'bass', notes: [bassNote(b.deg, chord, next)], steps: b.len, accent: false, tone: style.tone });
  }
  for (const k of parts.keys) {
    if (k.step === step) {
      out.push({
        part: 'keys', notes: chordVoicing(chord, style.sound === 'skank' || style.sound === 'stab'),
        steps: k.len, accent: k.kind === 'X', held: k.kind === 'o', sound: style.sound,
      });
    }
  }
  return out;
}

export const chordAt = (chords, bar) => chords[bar % chords.length];

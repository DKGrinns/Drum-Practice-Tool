// groove-audio.js — renders synthetic "records" for the tempo, beat and
// transcription tests: kick, snare (+ ghosts), rim, closed/open hats, ride,
// a reggae/funk chord skank, a bass line and room noise, with swing and
// human timing. Not a test file itself (npm test runs tests/*.test.js).

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296 * 2 - 1; };
}

// One drum or instrument sound added into buf at time t (s).
export function addSound(buf, sr, t, kind, amp, rand, semis = 0) {
  const tr = Math.pow(2, semis / 12);
  const start = Math.round(t * sr);
  const dur = { kick: 0.35, snare: 0.25, ghost: 0.15, rim: 0.06, hh: 0.06, oh: 0.35, ride: 0.6, skank: 0.14, bass: 0.4, stab: 0.12 }[kind] || 0.2;
  const len = Math.round(dur * sr);
  let hp1 = 0, hp2 = 0, hp3 = 0, prevN = 0, prev2 = 0, prev3 = 0;
  for (let i = 0; i < len && start + i < buf.length; i++) {
    if (start + i < 0) continue;
    const s = i / sr;
    let v = 0;
    const n = rand();
    // A 3-stage difference filter makes "hat" noise mostly high-frequency.
    hp1 = n - prevN; prevN = n; hp2 = hp1 - prev2; prev2 = hp1; hp3 = hp2 - prev3; prev3 = hp2;
    switch (kind) {
      case 'kick':
        v = Math.sin(2 * Math.PI * (52 * s + 90 * 0.025 * (1 - Math.exp(-s / 0.025)))) * Math.exp(-s / 0.13) + 0.25 * n * Math.exp(-s / 0.0015);
        break;
      case 'snare': case 'ghost':
        v = (0.55 * n + 0.45 * Math.sin(2 * Math.PI * 185 * s)) * (Math.exp(-s / 0.03) + 0.2 * Math.exp(-s / 0.1));
        break;
      case 'rim':
        v = (Math.sin(2 * Math.PI * 1700 * s) * 0.6 + 0.4 * n) * Math.exp(-s / 0.008);
        break;
      case 'hh': v = hp3 * 0.18 * Math.exp(-s / 0.018); break;
      case 'oh': v = hp3 * 0.18 * Math.exp(-s / 0.15); break;
      case 'ride': v = (hp3 * 0.1 + 0.15 * Math.sin(2 * Math.PI * 5200 * s)) * Math.exp(-s / 0.25); break;
      case 'skank': case 'stab': {
        // A minor-ish chord with a few harmonics, short and choppy.
        const f = [220 * tr, 261.6 * tr, 329.6 * tr];
        for (const ff of f) for (let h = 1; h <= 4; h++) v += Math.sin(2 * Math.PI * ff * h * s) / (h * 3);
        v *= Math.exp(-s / 0.05) * Math.min(1, s / 0.004);
        break;
      }
      case 'bass':
        v = Math.sin(2 * Math.PI * 55 * tr * s) * Math.min(1, s / 0.02) * Math.exp(-s / 0.3);
        break;
    }
    const attack = kind === 'bass' ? 1 : Math.min(1, i / (0.0006 * sr));
    buf[start + i] += amp * v * attack;
  }
}

// Render a groove.
//   bpm, bars, beatsPerBar (4), sub (steps per beat: 4 = 16ths, 3 = triplets)
//   tracks: { voice: 'string per bar(s)' } using x X g - per step (the
//           string repeats to fill all bars)
//   swing: 0..1 (8th-note swing on a 16th grid, like the app)
//   jitter: random timing in seconds (±), noise: noise amplitude
//   lead: silence before the first beat (s)
//   chords: semitone shift of the skank/bass per bar (e.g. [0, 5, 7, 5])
// Returns { buf, sr, beats: [times of every beat], downbeats }.
export function renderGroove({ bpm, bars = 8, beatsPerBar = 4, sub = 4, tracks, swing = 0, swingRes = 8, jitter = 0.003, noise = 0.003, seed = 7, sr = 44100, lead = 0.37, gain = 1, chords = [0] }) {
  const rand = rng(seed);
  const beat = 60 / bpm;
  const total = lead + bars * beatsPerBar * beat + 1;
  const buf = new Float32Array(Math.round(total * sr));
  for (let i = 0; i < buf.length; i++) buf[i] = noise * rand();
  const beats = [];
  for (let b = 0; b < bars * beatsPerBar; b++) beats.push(lead + b * beat);
  const stepsPerBar = beatsPerBar * sub;
  for (const [voice, str] of Object.entries(tracks)) {
    const pat = str.replace(/[ |]/g, '');
    for (let s = 0; s < bars * stepsPerBar; s++) {
      const ch = pat[s % pat.length];
      if (!ch || ch === '-' || ch === '.') continue;
      const bIdx = Math.floor(s / sub), k = s % sub;
      let ph = k / sub;
      if (sub === 4 && swing) {
        const r = 0.5 + swing / 6; // 8th swing: the "&" moves to r of the beat
        if (swingRes === 8) { if (k === 2) ph = r; else if (k === 1) ph = r / 2; else if (k === 3) ph = r + (1 - r) / 2; }
        else if (swingRes === 16) { const r16 = 0.5 + swing / 6; if (k === 1) ph = 0.5 * r16; else if (k === 3) ph = 0.5 + 0.5 * r16; }
      }
      const t = lead + (bIdx + ph) * beat + jitter * rand();
      const amp = (ch === 'X' ? 1 : ch === 'g' ? 0.18 : 0.6) * gain;
      const kind = voice === 'snare' && ch === 'g' ? 'ghost' : voice;
      const scale = { kick: 0.9, snare: 0.7, rim: 0.5, hh: 0.8, oh: 0.6, ride: 0.6, skank: 0.35, stab: 0.35, bass: 0.5 }[voice] || 0.5;
      addSound(buf, sr, t, kind, amp * scale, rand, chords[Math.floor(bIdx / beatsPerBar) % chords.length]);
    }
  }
  return { buf, sr, beats, downbeats: beats.filter((_, i) => i % beatsPerBar === 0) };
}

export function addNoise(buf, amp, seed = 99) {
  const rand = rng(seed);
  for (let i = 0; i < buf.length; i++) buf[i] += amp * rand();
  return buf;
}

// Feels for the tempo tests. pref: the tempo as the app's groove library
// counts it; ok: an acceptable other octave.
export const FEELS = {
  rock100: { g: { bpm: 100, chords: [0, 5, 7, 5], tracks: { kick: 'x-------x-x-----', snare: '----x-------x---', hh: 'x-x-x-x-x-x-x-x-', bass: 'x-------x-x-----' } }, pref: [100], ok: [50, 200] },
  funk96: { g: { bpm: 96, chords: [0, 0, 5, 7], tracks: { stab: '--x-------x--x--', kick: 'x--x--x---x--x--', snare: '----X--g-g--X--g', hh: 'xxxxxxxxxxxxxxxx' } }, pref: [96], ok: [48, 192] },
  funk105b: { g: { bpm: 105, chords: [0, 3], tracks: { kick: 'x-x----x--x-----', snare: '-g--X-g--g-gX-g-', hh: 'x-x-x-x-x-x-x-xo'.replace(/o/g, 'x'), bass: 'x-x----x--x-----' } }, pref: [105], ok: [52.5, 210] },
  onedrop72: { g: { bpm: 72, chords: [0, 5, 0, 7], tracks: { kick: '--------x-------', rim: '--------x-------', hh: 'x-x-x-x-x-x-x-x-', skank: '----x-------x---', bass: 'x-----x---x-----' } }, pref: [72], ok: [144] },
  onedropSwing66: { g: { bpm: 66, swing: 0.5, chords: [0, 7], tracks: { kick: '--------x-------', rim: '--------x-------', hh: 'x-xxx-x-x-xxx-x-', skank: '----x-------x---', bass: 'x-----x---x-----' } }, pref: [66], ok: [132] },
  steppers76: { g: { bpm: 76, chords: [0, 0, 5, 5], tracks: { kick: 'x---x---x---x---', rim: '--------x-------', hh: 'x-x-x-x-x-x-x-x-', skank: '----x-------x---' } }, pref: [76], ok: [152, 38] },
  shuffle90: { g: { bpm: 90, sub: 3, chords: [0, 5], tracks: { bass: 'x--x--x--x--', kick: 'x-----x-----', snare: '---x-----x--', hh: 'x-xx-xx-xx-x' } }, pref: [90], ok: [45, 180] },
  jazz140: { g: { bpm: 140, sub: 3, chords: [2, 7, 0, 0], tracks: { ride: 'x--x-xx--x-x', hh: '---x-----x--', snare: '-g-----g----', kick: 'g--g--g--g--', bass: 'x--x--x--x--' } }, pref: [140], ok: [70] },
  halfshuffle80: { g: { bpm: 80, sub: 3, chords: [0, 5], tracks: { kick: 'x-------x---', snare: '-g--g-X--g--', hh: 'x-xx-xx-xx-x', bass: 'x-----x-----' } }, pref: [80], ok: [160, 40] },
  samba100: { g: { bpm: 100, beatsPerBar: 2, chords: [0, 0, 7, 7], tracks: { kick: 'x--xX---', snare: 'x-xx-x-xx-x-x-x-', hh: 'Xxxx' } }, pref: [100], ok: [50, 200] },
  neo84: { g: { bpm: 84, swing: 0.6, swingRes: 16, chords: [0, 5], tracks: { kick: 'x--x------x-----', snare: '----x-------x--g', hh: 'xxxxxxxxxxxxxxxx' } }, pref: [84], ok: [42, 168] },
  bossa130: { g: { bpm: 130, sub: 2, chords: [0, 0, 2, 7], tracks: { kick: 'x--xx--x', rim: 'x--x--x---x--x--', hh: 'xxxxxxxx', bass: 'x---x---' } }, pref: [130], ok: [65] },
  ska160: { g: { bpm: 160, chords: [0, 5], tracks: { kick: 'x-------x-------', snare: '----x-------x---', skank: '--x---x---x---x-', hh: '--x---x---x---x-' } }, pref: [160], ok: [80] },
  chacha120: { g: { bpm: 120, chords: [0, 7], tracks: { kick: 'x-------x-------', rim: 'x---x---x---x---', hh: 'x-x-x-x-x-x-x-xx', snare: '------------x-x-' } }, pref: [120], ok: [60, 240] },
  dembow95: { g: { bpm: 95, tracks: { kick: 'x---x---x---x---', snare: '---x--x----x--x-', hh: 'x-x-x-x-x-x-x-x-' } }, pref: [95], ok: [47.5, 190] },
  afrobeat110: { g: { bpm: 110, chords: [0, 0, 3, 3], tracks: { kick: 'x-----x-x-----x-', snare: '-g--X-g--g-gX--g', hh: 'xxxxxxxxxxxxxxxx', stab: 'x--x--x---x-x---' } }, pref: [110], ok: [55, 220] },
  waltz3: { g: { bpm: 150, beatsPerBar: 3, sub: 3, chords: [0, 5], tracks: { ride: 'x--x-xx--', hh: '---x--x--', bass: 'x--x--x--' } }, pref: [150], ok: [75, 50] },
};

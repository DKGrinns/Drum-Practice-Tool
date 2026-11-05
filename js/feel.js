// feel.js — microtiming for the time-feel trainers (pure functions).
//
//   offset    whole groove vs. the grid/click, in ms. Positive = laid back
//             (behind the beat), negative = pushing (ahead of the beat).
//   kick, snare, hats, ride, perc   extra per-drum offsets in ms, e.g.
//             snare +15 for a lazy backbeat.
//   humanize  0..100: random timing and velocity variation per hit.
// Clicks are never moved: they are the reference you play against.

export const CLICK_VOICES = new Set(['accent', 'click', 'sub']);
export const MAX_OFFSET_MS = 50;

// Which per-drum offset each voice uses.
// The band leans with the drums: bass with the kick, chords with the snare.
const GROUP = { kick: 'kick', snare: 'snare', rim: 'snare', hh: 'hats', oh: 'hats', ride: 'ride', bass: 'kick', keys: 'snare' };
export const feelGroup = voice => GROUP[voice] || 'perc';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Total timing offset for a voice, in seconds.
export function voiceOffset(feel, voice) {
  if (!feel || CLICK_VOICES.has(voice)) return 0;
  const ms = (feel.offset || 0) + (feel[feelGroup(voice)] || 0);
  return clamp(ms, -2 * MAX_OFFSET_MS, 2 * MAX_OFFSET_MS) / 1000;
}

// Random variation for one hit. amount 0..1. Timing up to ±12 ms and
// velocity up to ±25% at full amount. `rand` returns 0..1.
export function humanize(amount, rand = Math.random) {
  if (!amount) return { dt: 0, dv: 1 };
  const a = clamp(amount, 0, 1);
  return { dt: (rand() * 2 - 1) * a * 0.012, dv: 1 + (rand() * 2 - 1) * a * 0.25 };
}

// Ready-made feels for the Trainer tab.
export const FEEL_PRESETS = {
  'On the grid':      { offset: 0, kick: 0, snare: 0, hats: 0, ride: 0, perc: 0 },
  'Laid back':        { offset: 15, kick: 0, snare: 0, hats: 0, ride: 0, perc: 0 },
  'Pushing':          { offset: -12, kick: 0, snare: 0, hats: 0, ride: 0, perc: 0 },
  'Lazy backbeat':    { offset: 0, kick: 0, snare: 18, hats: 0, ride: 0, perc: 0 },
  'Reggae lean':      { offset: 10, kick: 5, snare: 15, hats: 0, ride: 0, perc: 5 },
  'Dilla drunk':      { offset: 0, kick: 22, snare: 8, hats: -6, ride: 0, perc: 0 },
};

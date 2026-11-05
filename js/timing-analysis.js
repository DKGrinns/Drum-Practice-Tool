// timing-analysis.js — scores your hits against the beat (pure functions,
// tested in tests/analysis.test.js).
//
// Inputs, all on the AudioContext clock (seconds):
//   beats   [{ time, dur, barCount, beat, beatsPerBar }] — every beat the
//           engine played (logged by Engine.handleStep)
//   onsets  [{ time, peak }] — hits found in the microphone signal
//   latency round-trip delay (speaker -> your ears/drum -> mic -> detector),
//           measured by the speaker test or the tap test. Subtracting it
//           lines your hit up with the beat you heard.
// Error sign: positive = late (behind the beat, dragging),
//             negative = early (ahead of the beat, rushing).

import { stepOffset } from './sequencer.js';

// Grid points to score against. res = points per beat:
//   1 beats, 2 8ths, 3 triplets, 4 16ths. 8ths/16ths follow the swing
//   setting so swung playing isn't scored as late.
export function gridPoints(beats, res, swing = 0, swingRes = 8) {
  const out = [];
  for (const b of beats) {
    for (let k = 0; k < res; k++) {
      const pos = res === 3 ? k / 3 : stepOffset(k, res, swing, swingRes);
      out.push({ time: b.time + pos * b.dur, barCount: b.barCount, beat: b.beat, sub: k, res, spacing: b.dur / res });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

// Index of the grid point nearest to t (binary search).
function nearestIndex(grid, t) {
  let lo = 0, hi = grid.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (grid[mid].time < t) lo = mid; else hi = mid;
  }
  return Math.abs(grid[lo].time - t) <= Math.abs(grid[hi].time - t) ? lo : hi;
}

// Match one hit to the grid. Returns null if it is outside the grid.
export function matchHit(onset, grid, latency = 0) {
  if (!grid.length) return null;
  const t = onset.time - latency;
  const g = grid[nearestIndex(grid, t)];
  const err = t - g.time;
  if (Math.abs(err) > g.spacing * 0.5 + 1e-9) return null; // before the first / after the last point
  return { time: t, error: err * 1000, barCount: g.barCount, beat: g.beat, sub: g.sub, res: g.res, peak: onset.peak,
    voice: onset.voice, velocity: onset.velocity };
}

export const matchHits = (onsets, grid, latency) => onsets.map(o => matchHit(o, grid, latency)).filter(Boolean);

const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
function sd(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
}
function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Least-squares slope of error (ms) against bar number: how much later
// (positive) or earlier (negative) you drift per bar.
function slope(hits) {
  if (hits.length < 4) return 0;
  const xs = hits.map(h => h.barCount), ys = hits.map(h => h.error);
  const mx = mean(xs), my = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den ? num / den : 0;
}

export function summarize(hits) {
  const errs = hits.map(h => h.error);
  const bars = new Map();
  const positions = new Map();
  for (const h of hits) {
    if (!bars.has(h.barCount)) bars.set(h.barCount, []);
    bars.get(h.barCount).push(h.error);
    const key = `${h.beat}:${h.sub}`;
    if (!positions.has(key)) positions.set(key, { beat: h.beat, sub: h.sub, res: h.res, errors: [] });
    positions.get(key).errors.push(h.error);
  }
  return {
    count: hits.length,
    mean: mean(errs),
    median: median(errs),
    sd: sd(errs),
    within10: hits.length ? errs.filter(e => Math.abs(e) <= 10).length / hits.length : 0,
    within20: hits.length ? errs.filter(e => Math.abs(e) <= 20).length / hits.length : 0,
    trend: slope(hits), // ms per bar
    perBar: [...bars.entries()].sort((a, b) => a[0] - b[0])
      .map(([bar, e]) => ({ bar, count: e.length, mean: mean(e), sd: sd(e) })),
    byPosition: [...positions.values()].sort((a, b) => a.beat - b.beat || a.sub - b.sub)
      .map(p => ({ beat: p.beat, sub: p.sub, res: p.res, count: p.errors.length, mean: mean(p.errors), sd: sd(p.errors) })),
  };
}

// Plain-language verdicts.
export function describeOffset(ms) {
  const a = Math.abs(ms);
  if (a < 4) return 'right on the beat';
  const side = ms > 0 ? 'behind' : 'ahead of';
  if (a < 12) return `slightly ${side} the beat`;
  if (a < 25) return `${side} the beat`;
  return `well ${side} the beat`;
}
export function describeSpread(sd) {
  if (sd < 6) return 'very tight';
  if (sd < 12) return 'tight';
  if (sd < 20) return 'fairly loose';
  return 'loose';
}
export function describeTrend(msPerBar, bars) {
  const total = msPerBar * Math.max(1, bars);
  if (bars < 4 || Math.abs(total) < 8) return 'steady';
  return msPerBar > 0 ? 'dragging (getting later)' : 'rushing (getting earlier)';
}

// Name of a grid position, e.g. "2&", "3a", "4 let".
export function positionName(beat, sub, res) {
  const names = { 1: [''], 2: ['', '&'], 3: ['', ' trip', ' let'], 4: ['', 'e', '&', 'a'] }[res] || [''];
  return `${beat + 1}${names[sub] || ''}`;
}

// ------------------------------------------------------------------ latency

// Speaker test: the app played clicks at clickTimes and the mic heard them.
// Delay of each click = first onset within maxDelay after it. Returns the
// median delay (seconds), its spread and the median peak level of the
// clicks as heard by the mic (used to ignore speaker bleed), or null if
// fewer than 4 clicks were heard.
export function estimateLatency(onsets, clickTimes, maxDelay = 0.5) {
  const delays = [], peaks = [];
  for (const c of clickTimes) {
    const o = onsets.find(x => x.time >= c && x.time <= c + maxDelay);
    if (o) { delays.push(o.time - c); peaks.push(o.peak); }
  }
  if (delays.length < 4) return null;
  const m = median(delays);
  return { latency: m, spread: median(delays.map(d => Math.abs(d - m))), matched: delays.length, bleedPeak: median(peaks) };
}

// Tap test: you hit along with clicks you hear. Each tap is matched to the
// nearest click; the median offset is the latency (it also absorbs your own
// habit of playing a little early or late, so the speaker test is better
// when you use speakers).
export function tapLatency(onsets, clickTimes, maxOffset = 0.5) {
  const offs = [];
  for (const o of onsets) {
    let best = null;
    for (const c of clickTimes) if (best === null || Math.abs(o.time - c) < Math.abs(o.time - best)) best = c;
    if (best !== null && Math.abs(o.time - best) <= maxOffset) offs.push(o.time - best);
  }
  if (offs.length < 6) return null;
  const m = median(offs);
  return { latency: m, spread: median(offs.map(d => Math.abs(d - m))), matched: offs.length };
}

// Speaker bleed: a quiet onset that lines up with a sound the app itself
// played (clicks or drums coming out of the speaker) is the app, not you.
// Real hits on the kit are much louder at the mic than the speaker.
export function isBleed(onset, soundTimes, latency, bleedPeak) {
  if (!bleedPeak) return false;
  if (onset.peak > bleedPeak * 2.5) return false;
  const t = onset.time - latency;
  return soundTimes.some(s => Math.abs(s - t) < 0.012);
}

// ------------------------------------------------------ per drum / dynamics
// (electronic kits over MIDI: each hit knows its drum and velocity 1..127)

// Timing summary for each drum that was hit.
export function summarizeByVoice(hits) {
  const groups = new Map();
  for (const h of hits) {
    if (!h.voice) continue;
    if (!groups.has(h.voice)) groups.set(h.voice, []);
    groups.get(h.voice).push(h);
  }
  return [...groups.entries()].map(([voice, hs]) => {
    const s = summarize(hs);
    const vels = hs.map(h => h.velocity).filter(v => v != null);
    return { voice, count: s.count, mean: s.mean, sd: s.sd, within10: s.within10, velocity: mean(vels), velocitySd: sd(vels) };
  }).sort((a, b) => b.count - a.count);
}

// Dynamics for one drum: splits hits into ghost notes (velocity < ghostMax)
// and accents (>= accentMin) and reports how even each group is. A small
// spread inside each group and a big gap between them = controlled
// dynamics.
export function dynamics(hits, ghostMax = 50, accentMin = 90) {
  const v = hits.map(h => h.velocity).filter(x => x != null);
  const ghosts = v.filter(x => x < ghostMax), accents = v.filter(x => x >= accentMin);
  const middle = v.filter(x => x >= ghostMax && x < accentMin);
  return {
    count: v.length,
    ghosts: { count: ghosts.length, mean: mean(ghosts), sd: sd(ghosts) },
    accents: { count: accents.length, mean: mean(accents), sd: sd(accents) },
    middle: { count: middle.length, mean: mean(middle), sd: sd(middle) },
    range: ghosts.length && accents.length ? mean(accents) - mean(ghosts) : 0,
  };
}

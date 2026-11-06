// tempo.js — tempo, beats and drum hits in recorded music (pure, no DOM;
// tested in Node with synthetic grooves, see tests/tempo.test.js).
//
// Pipeline:
//   1. EnvelopeTracker: short FFT frames every ~5 ms (ENV_RATE frames/s).
//      For each frame it measures the *spectral flux*: how much louder each
//      frequency got since the last frame (log-compressed, rises only), in
//      total and in three drum bands:
//        low  30–150 Hz      kick
//        mid  180–3500 Hz    snare (and the click of other drums)
//        high 6–16 kHz       hi-hats and cymbals
//   2. estimateTempo: autocorrelation of the onset envelope → a score for
//      every tempo (the beat period plus its multiples, so bar-level
//      repetition counts too) × a broad preference for 60–180 BPM. Returns
//      the BPM, a confidence (0..1) and the half/double alternatives.
//   3. trackBeats: dynamic-programming beat tracker (Ellis 2007): beats sit
//      on strong onsets and stay close to the period. A straight-line fit
//      through the beats gives a precise tempo and lets us predict future
//      beats (for the click locked to the record).
//   4. guessDownbeat / estimateSwing: which beat is "1" and how swung the
//      off-beats are. (The drum transcription is in transcribe.js.)

export const ENV_RATE = 200; // envelope frames per second (≈5 ms)

// --------------------------------------------------------------------- FFT

export function fftInPlace(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

// ---------------------------------------------------------- onset envelope

const BAND_HZ = { low: [30, 150], mid: [180, 3500], high: [6000, 16000] };
// Weights, tuned on the synthetic grooves in tests/tempo.test.js (rock,
// funk, one-drop, steppers, shuffle, jazz, half-time shuffle, samba, neo
// soul, bossa, ska, cha-cha, dembow, afrobeat, waltz; clean and noisy).
//   b2, b4: weight of 2 and 4 beat periods; sub: the 8th-note period;
//   center/width: tempo preference (BPM, octaves; 95 matches how the
//   groove library counts: one drop 72, funk 96, samba 100); pLow/pMid:
//   kick and snare emphasis in the beat-phase envelope; bands: score each
//   drum band's periodicity separately (bandW = weight of the bands).
export const W = { b2: 0.4, b4: 0.3, sub: 0.2, sub3: 0, center: 95, width: 0.8, pLow: 0, pMid: 0.6, bands: true, bandW: 0.5 };

class Grow {
  constructor() { this.a = new Float32Array(4096); this.n = 0; }
  push(v) {
    if (this.n === this.a.length) { const b = new Float32Array(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a[this.n++] = v;
  }
  view(from = 0, to = this.n) { return this.a.subarray(Math.max(0, from), Math.min(this.n, to)); }
  drop(k) { this.a.copyWithin(0, k, this.n); this.n -= k; }
}

// Streams mono samples in, produces envelope frames. Frame k describes the
// moment `frameTime(k)` (seconds from the first sample pushed, plus
// `startTime`).
export class EnvelopeTracker {
  constructor(sampleRate, { startTime = 0 } = {}) {
    this.sr = sampleRate;
    this.hop = Math.max(1, Math.round(sampleRate / ENV_RATE));
    this.rate = sampleRate / this.hop;
    let n = 512;
    while (n < sampleRate * 0.021) n *= 2;   // ≈21 ms window (1024 at 44.1/48 kHz)
    this.N = n;
    this.win = new Float32Array(n);
    for (let i = 0; i < n; i++) this.win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
    this.ring = new Float32Array(n);
    this.pos = 0;
    this.filled = 0;
    this.sinceHop = 0;
    this.re = new Float32Array(n);
    this.im = new Float32Array(n);
    this.prev = new Float32Array(n / 2);
    const bin = hz => Math.max(1, Math.min(n / 2 - 1, Math.round(hz * n / sampleRate)));
    this.bands = {};
    for (const [k, [lo, hi]] of Object.entries(BAND_HZ)) this.bands[k] = [bin(lo), bin(hi)];
    this.allBins = [bin(30), bin(16000)];
    // Band of each bin: 0 low, 1 mid, 2 upper mid (3.5–6 kHz), 3 high.
    this.bandOf = new Int8Array(n / 2).fill(-1);
    const edges = [this.bands.low, this.bands.mid, [bin(3500) + 1, bin(6000) - 1], this.bands.high];
    this.bandCount = edges.map(([lo, hi], i) => { for (let k = lo; k <= hi; k++) this.bandOf[k] = i; return hi - lo + 1; });
    this.sums = new Float64Array(4);
    // Pitch class of each bin from 80 Hz to 2 kHz (for chord changes).
    this.pc = new Int8Array(n / 2).fill(-1);
    for (let k = bin(80); k <= bin(2000); k++) this.pc[k] = ((Math.round(12 * Math.log2(k * sampleRate / n / 440)) + 9) % 12 + 12) % 12;
    this.chroma = new Grow();
    this.cv = new Float32Array(12);
    this.flux = new Grow(); this.low = new Grow(); this.mid = new Grow(); this.high = new Grow();
    this.startTime = startTime;
    this.samples = 0;
    this.dropped = 0;
  }

  get length() { return this.flux.n; }

  // Time (s) of frame k: where a sharp attack shows up as the biggest rise
  // (the centre of the window plus a hop; measured with synthetic hits).
  frameTime(k) { return this.startTime + ((k + this.dropped) * this.hop + this.N / 2 + this.hop) / this.sr; }
  frameAt(t) { return ((t - this.startTime) * this.sr - this.N / 2 - this.hop) / this.hop - this.dropped; }

  // Forget all but the last `keep` frames (for a rolling live analysis);
  // frame times stay right.
  trim(keep) {
    const d = this.length - keep;
    if (d <= 0) return;
    for (const g of [this.flux, this.low, this.mid, this.high]) g.drop(d);
    this.chroma.drop(d * 12);
    this.dropped += d;
  }

  push(block) {
    for (let i = 0; i < block.length; i++) {
      this.ring[this.pos] = block[i];
      this.pos = (this.pos + 1) % this.N;
      this.samples++;
      if (this.filled < this.N) { this.filled++; if (this.filled === this.N) this.frame(); continue; }
      if (++this.sinceHop >= this.hop) { this.sinceHop = 0; this.frame(); }
    }
  }

  frame() {
    const { N, re, im, win, ring, prev } = this;
    for (let i = 0; i < N; i++) { re[i] = ring[(this.pos + i) % N] * win[i]; im[i] = 0; }
    fftInPlace(re, im);
    const sums = this.sums.fill(0);
    const [a0, a1] = this.allBins;
    const cv = this.cv.fill(0);
    for (let k = a0; k <= a1; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      if (this.pc[k] >= 0) cv[this.pc[k]] += mag;
      const m = Math.log(1 + 100 * mag);
      const d = m - prev[k];
      prev[k] = m;
      if (d > 0 && this.bandOf[k] >= 0) sums[this.bandOf[k]] += d;
    }
    const c = this.bandCount;
    const low = sums[0] / c[0], mid = sums[1] / c[1], upper = sums[2] / c[2], high = sums[3] / c[3];
    // Total: each band counts the same, so the many hi-hat bins don't
    // drown the kick and snare.
    this.flux.push(low + mid + upper + high);
    this.low.push(low);
    this.mid.push(mid);
    this.high.push(high);
    for (let i = 0; i < 12; i++) this.chroma.push(cv[i]);
  }

  // Envelope arrays from frame `from` to `to` (views, don't keep them).
  arrays(from = 0, to = this.length) {
    return {
      flux: this.flux.view(from, to), low: this.low.view(from, to), mid: this.mid.view(from, to), high: this.high.view(from, to),
      chroma: this.chroma.view(from * 12, to * 12),
    };
  }
}

// Envelope of a whole clip (array of channel Float32Arrays → mono).
export function clipEnvelope(channels, sampleRate) {
  const tr = new EnvelopeTracker(sampleRate);
  const n = channels[0].length;
  const block = new Float32Array(4096);
  for (let i = 0; i < n; i += block.length) {
    const len = Math.min(block.length, n - i);
    for (let j = 0; j < len; j++) {
      let s = 0;
      for (const ch of channels) s += ch[i + j];
      block[j] = s / channels.length;
    }
    tr.push(len === block.length ? block : block.subarray(0, len));
  }
  return tr;
}

// ------------------------------------------------------------------ helpers

function mean(a) { let s = 0; for (const v of a) s += v; return a.length ? s / a.length : 0; }
function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = Array.from(arr).sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
}

// Remove the slow-moving level (≈0.5 s moving average), keep the rises,
// scale to unit standard deviation.
export function normalizeEnvelope(env, rate) {
  const n = env.length;
  const out = new Float32Array(n);
  const w = Math.max(1, Math.round(rate * 0.25));
  const cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + env[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - w), b = Math.min(n, i + w + 1);
    const v = env[i] - (cs[b] - cs[a]) / (b - a);
    out[i] = v > 0 ? v : 0;
  }
  let ss = 0;
  for (const v of out) ss += v * v;
  const sd = Math.sqrt(ss / Math.max(1, n)) || 1;
  for (let i = 0; i < n; i++) out[i] /= sd;
  return out;
}

function autocorr(x, maxLag) {
  const n = x.length;
  const r = new Float32Array(maxLag + 2);
  for (let l = 0; l <= maxLag + 1; l++) {
    let s = 0;
    for (let i = l; i < n; i++) s += x[i] * x[i - l];
    r[l] = n > l ? s / (n - l) : 0;
  }
  return r;
}
function interp(r, x) {
  const i = Math.floor(x), f = x - i;
  if (i + 1 >= r.length) return 0;
  return r[i] * (1 - f) + r[i + 1] * f;
}

// ------------------------------------------------------------------- tempo

// Broad preference for the tempos people count in: log-normal around
// 105 BPM, one octave wide.
const prior = bpm => Math.exp(-0.5 * (Math.log2(bpm / W.center) / W.width) ** 2);

// env: onset envelope (Float32Array), or the band envelopes { flux, low,
// mid, high } (then each band's autocorrelation counts the same, so the
// snare's backbeat and the kick get a say next to busy hi-hats).
// rate: frames per second. Returns { bpm, confidence, alternatives:
// [{ bpm, ratio, score }], periodicity } or null if there isn't enough
// signal.
export function estimateTempo(env, rate, { minBpm = 50, maxBpm = 220 } = {}) {
  const bands = env instanceof Float32Array ? [env] : W.bands ? [env.flux, env.low, env.mid, env.high] : [env.flux];
  const len = bands[0].length;
  if (len < rate * 3) return null;
  const maxLag = Math.min(Math.ceil(rate * 60 / 30 * 2), len - 2);
  const r = new Float32Array(maxLag + 2);
  let used = 0;
  for (const b of bands) {
    const x = normalizeEnvelope(b, rate);
    if (!x.some(v => v > 0)) continue;
    const rb = autocorr(x, maxLag);
    const w = b === bands[0] ? 1 : W.bandW;
    for (let i = 0; i < r.length; i++) r[i] += w * rb[i] / (rb[0] || 1);
    used++;
  }
  if (!used) return null;
  const r0 = r[0] || 1;
  // Score of a beat period L (frames): the period and its multiples (the
  // half bar and the bar), plus a little of the beat's subdivision
  // (8ths or triplets, whichever fits).
  const score = L => interp(r, L) + W.b2 * interp(r, 2 * L) + W.b4 * interp(r, 4 * L) + W.sub * Math.max(interp(r, L / 2), W.sub3 * interp(r, L / 3));
  const cands = [];
  for (let bpm = minBpm; bpm <= maxBpm + 1e-9; bpm += 0.25) {
    const L = rate * 60 / bpm;
    cands.push({ bpm, raw: score(L), score: score(L) * prior(bpm) });
  }
  let best = cands[0];
  for (const c of cands) if (c.score > best.score) best = c;
  // Fine peak: parabola through the neighbours.
  const i = cands.indexOf(best);
  let bpm = best.bpm;
  if (i > 0 && i < cands.length - 1) {
    const a = cands[i - 1].score, b = best.score, c = cands[i + 1].score;
    const den = a - 2 * b + c;
    if (den < 0) bpm += 0.25 * Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / den));
  }
  // Confidence: how periodic the envelope is at this tempo, and how far the
  // best tempo stands above the best unrelated one (not ×½, ×2, ×3/2, ×4/3
  // ...: those are the same pulse grouped differently).
  const related = b => [0.5, 2, 1 / 3, 3, 2 / 3, 1.5, 1, 0.25, 4, 4 / 3, 3 / 4].some(k => Math.abs(b / bpm / k - 1) < 0.04);
  let rival = 0;
  for (const c of cands) if (!related(c.bpm) && c.score > rival) rival = c.score;
  const periodic = Math.max(0, Math.min(1, interp(r, rate * 60 / bpm) / r0 * 1.6));
  const margin = Math.max(0, Math.min(1, (1 - rival / best.score) * 2.2));
  const confidence = Math.round(Math.sqrt(periodic * margin) * 100) / 100;
  const alternatives = [];
  for (const k of [0.5, 2, 1.5, 2 / 3, 4 / 3, 3 / 4]) {
    const b = bpm * k;
    if (b < 40 || b > 260) continue;
    const L = rate * 60 / b;
    alternatives.push({ bpm: b, ratio: k, score: Math.round(score(L) / Math.max(1e-9, score(rate * 60 / bpm)) * 100) / 100 });
  }
  return { bpm, confidence, alternatives, periodicity: periodic };
}

// -------------------------------------------------------------------- beats

// Ellis-style dynamic programming. env: onset envelope (phase envelope),
// rate: frames/s, bpm: tempo. Returns beat positions in frames (floats).
export function trackBeats(env, rate, bpm, { tightness = 300 } = {}) {
  const n = env.length;
  const P = rate * 60 / bpm;
  if (n < P * 2) return [];
  const o = normalizeEnvelope(env, rate);
  // Light smoothing (±10 ms) so a beat can sit a frame off a peak.
  const sm = new Float32Array(n);
  for (let i = 0; i < n; i++) sm[i] = (o[i] * 2 + (o[i - 1] || 0) + (o[i + 1] || 0)) / 4;
  const C = new Float32Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.round(P * 0.5), hi = Math.round(P * 2);
  for (let t = 0; t < n; t++) {
    let bestV = -Infinity, bestT = -1;
    for (let tau = t - hi; tau <= t - lo; tau++) {
      if (tau < 0) continue;
      const d = Math.log((t - tau) / P);
      const v = C[tau] - tightness * d * d;
      if (v > bestV) { bestV = v; bestT = tau; }
    }
    if (bestT >= 0 && bestV > 0) { C[t] = sm[t] + bestV; back[t] = bestT; }
    else C[t] = sm[t];
  }
  // Last beat: the best score in the final period.
  let end = n - 1, bv = -Infinity;
  for (let t = Math.max(0, n - Math.ceil(P)); t < n; t++) if (C[t] > bv) { bv = C[t]; end = t; }
  const beats = [];
  for (let t = end; t >= 0; t = back[t]) { beats.push(t); if (back[t] < 0) break; }
  beats.reverse();
  // Sub-frame position: parabola on the onset peak at each beat (if any).
  return beats.map(b => {
    const a = o[b - 1] || 0, c = o[b] || 0, d = o[b + 1] || 0;
    const den = a - 2 * c + d;
    return den < 0 && c > 0 ? b + Math.max(-0.5, Math.min(0.5, 0.5 * (a - d) / den)) : b;
  });
}

// Least-squares straight line through beat times: { period, t0 } so beat k
// is at t0 + k·period. Ignores beats more than 30% off the line.
export function fitBeats(times) {
  if (times.length < 3) return null;
  const fit = ts => {
    const n = ts.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    ts.forEach(([k, t]) => { sx += k; sy += t; sxx += k * k; sxy += k * t; });
    const period = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    return { period, t0: (sy - period * sx) / n };
  };
  // Number the beats by the median interval (so a skipped beat counts).
  const ints = [];
  for (let i = 1; i < times.length; i++) ints.push(times[i] - times[i - 1]);
  const med = percentile(ints, 0.5);
  let k = 0;
  const pts = [[0, times[0]]];
  for (let i = 1; i < times.length; i++) { k += Math.max(1, Math.round((times[i] - times[i - 1]) / med)); pts.push([k, times[i]]); }
  let f = fit(pts);
  const good = pts.filter(([kk, t]) => Math.abs(t - (f.t0 + kk * f.period)) < 0.3 * f.period);
  if (good.length >= 3 && good.length < pts.length) f = fit(good);
  const resid = good.map(([kk, t]) => t - (f.t0 + kk * f.period));
  f.jitter = Math.sqrt(mean(resid.map(v => v * v)));
  f.lastIndex = pts[pts.length - 1][0];
  return f;
}

// The envelope used for the beat phase: everything, plus extra kick (kicks
// are almost always on beats; skanks and hats are often off them).
export function phaseEnvelope(e) {
  const n = e.flux.length;
  const fl = normalizeEnvelope(e.flux, ENV_RATE), lo = normalizeEnvelope(e.low, ENV_RATE), mi = normalizeEnvelope(e.mid, ENV_RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = fl[i] + W.pLow * lo[i] + W.pMid * mi[i];
  return out;
}

// Strength of a band near a frame (max over ±w frames).
function bandAt(arr, f, w = 3) {
  let m = 0;
  const a = Math.max(0, Math.floor(f - w)), b = Math.min(arr.length - 1, Math.ceil(f + w));
  for (let i = a; i <= b; i++) if (arr[i] > m) m = arr[i];
  return m;
}

// Chord-change strength at each beat: how different the pitch content of
// the beat after is from the beat before (1 − cosine similarity).
function harmonyChanges(chroma, beatFrames) {
  const frames = chroma.length / 12;
  const avg = (f0, f1) => {
    const v = new Float64Array(12);
    for (let f = Math.max(0, Math.round(f0)); f < Math.min(frames, Math.round(f1)); f++) for (let i = 0; i < 12; i++) v[i] += chroma[f * 12 + i];
    return v;
  };
  const cos = (x, y) => {
    let d = 0, a = 0, b = 0;
    for (let i = 0; i < 12; i++) { d += x[i] * y[i]; a += x[i] * x[i]; b += y[i] * y[i]; }
    return a && b ? d / Math.sqrt(a * b) : 1;
  };
  return beatFrames.map((f, i) => {
    if (i === 0 || i + 1 >= beatFrames.length) return 0;
    return 1 - cos(avg(beatFrames[i - 1], f), avg(f, beatFrames[i + 1]));
  });
}

// Which beat is "1". Returns { index (0..beatsPerBar-1 into beatFrames),
// confidence 0..1 }. Cues, from the average of each beat position over the
// clip:
//   * snare/rim: on 2 and 4 (backbeat), or on 3 only (one-drop, steppers,
//     half-time: the one loud backbeat of the bar is beat 3);
//   * kick: favours 1;
//   * chord changes: usually on the 1 (the strongest cue in real records).
export function guessDownbeat(e, beatFrames, beatsPerBar = 4) {
  const n = beatsPerBar;
  if (beatFrames.length < n * 2) return { index: 0, confidence: 0 };
  const lo = normalizeEnvelope(e.low, ENV_RATE), mi = normalizeEnvelope(e.mid, ENV_RATE);
  const H = e.chroma ? harmonyChanges(e.chroma, beatFrames) : beatFrames.map(() => 0);
  const L = new Float64Array(n), M = new Float64Array(n), Hp = new Float64Array(n), cnt = new Float64Array(n);
  beatFrames.forEach((f, b) => { const p = b % n; L[p] += bandAt(lo, f, 2); M[p] += bandAt(mi, f, 2); Hp[p] += H[b]; cnt[p]++; });
  const norm = a => { for (let p = 0; p < n; p++) a[p] /= cnt[p] || 1; const mx = Math.max(...a) || 1; for (let p = 0; p < n; p++) a[p] /= mx; return a; };
  norm(L); norm(M);
  for (let p = 0; p < n; p++) Hp[p] /= cnt[p] || 1;
  const hMax = Math.max(...Hp);
  const at = (a, phi, p) => a[(phi + p) % n];
  const sorted = Array.from(M).sort((x, y) => y - x);
  const oneOfFour = n === 4 && sorted[0] - sorted[1] > 0.45 * (sorted[0] - sorted[3]) && sorted[0] - sorted[3] > 0.2;
  const scores = [];
  for (let phi = 0; phi < n; phi++) {
    let s = 0;
    if (n === 4) {
      if (oneOfFour) s += at(M, phi, 2) - (at(M, phi, 0) + at(M, phi, 1) + at(M, phi, 3)) / 3;
      else s += 0.5 * (at(M, phi, 1) + at(M, phi, 3) - at(M, phi, 0) - at(M, phi, 2));
      s += 0.3 * (at(L, phi, 0) - 0.5 * at(L, phi, 1) - 0.5 * at(L, phi, 3)) + 0.1 * (at(L, phi, 0) - at(L, phi, 2));
    } else {
      s += 0.4 * at(L, phi, 0) - 0.3 * at(M, phi, 0);
    }
    // Chord changes, weighted by how clearly they stand out.
    if (hMax > 0.02) { let rest = 0; for (let p = 1; p < n; p++) rest += at(Hp, phi, p); s += 1.2 * (at(Hp, phi, 0) - rest / (n - 1)) / hMax; }
    scores.push(s);
  }
  const order = scores.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]);
  const conf = Math.max(0, Math.min(1, (order[0][0] - order[1][0]) / (Math.abs(order[0][0]) + 0.2)));
  // beatFrames[k] with k ≡ index (mod n) is a "1".
  return { index: order[0][1], confidence: Math.round(conf * 100) / 100 };
}

// Drop beats before the music starts and after it ends (a clip with
// silence or noise around it): a run of beats at the start or end with
// almost no onset (in this beat or the half beat after it) is not music.
function trimBeats(frames, ph) {
  if (frames.length < 4) return frames;
  const P = (frames[frames.length - 1] - frames[0]) / (frames.length - 1);
  const str = frames.map(f => { let m = 0; for (let k = Math.floor(f - 2); k <= f + P * 0.75; k++) if ((ph[k] || 0) > m) m = ph[k]; return m; });
  const thr = percentile(str, 0.5) * 0.2;
  let a = 0, b = frames.length - 1;
  while (a < b && str[a] < thr) a++;
  while (b > a && str[b] < thr) b--;
  return frames.slice(a, b + 1);
}

// Swing: where the onsets between the beats land, as a fraction of the
// beat. 8th swing moves the "&" from 0.5 towards 0.667 (triplet); 16th
// swing moves the "e" from 0.25 towards 0.333. Returns { ratio (where the
// "&" is), swing (0..1 in the app's terms), res (8 or 16), clear }.
export function estimateSwing(e, beatFrames) {
  const fl = normalizeEnvelope(e.flux, ENV_RATE);
  const hist = new Float32Array(101); // phase 0..1 in 0.01 steps
  for (let b = 0; b + 1 < beatFrames.length; b++) {
    const a = beatFrames[b], len = beatFrames[b + 1] - a;
    for (let f = Math.ceil(a + 1); f < a + len - 1; f++) hist[Math.round((f - a) / len * 100)] += fl[f] || 0;
  }
  const peak = (lo, hi) => {
    let bi = lo;
    for (let k = lo; k <= hi; k++) if (hist[k] > hist[bi]) bi = k;
    let s = 0, w = 0;
    for (let k = Math.max(lo, bi - 3); k <= Math.min(hi, bi + 3); k++) { s += hist[k] * k; w += hist[k]; }
    let tot = 0;
    for (let k = lo; k <= hi; k++) tot += hist[k];
    return { at: (w ? s / w : bi) / 100, clear: tot > 0 && hist[bi] / (tot / (hi - lo + 1)) > 2.5, h: hist[bi] };
  };
  const and = peak(45, 72), e16 = peak(18, 40);
  // Straight if there is about as much right on the "&" as at the peak.
  let straight = 0;
  for (let k = 48; k <= 52; k++) straight = Math.max(straight, hist[k]);
  const sw8 = and.clear && straight < and.h * 0.6 ? Math.max(0, Math.min(1, (and.at - 0.5) * 6)) : 0;
  if (sw8 >= 0.12) return { ratio: and.at, swing: Math.round(sw8 * 100) / 100, res: 8, clear: true };
  const sw16 = e16.clear ? Math.max(0, Math.min(1, (e16.at - 0.25) * 12)) : 0;
  if (sw16 >= 0.15 && e16.h > and.h * 0.3) return { ratio: 0.5, swing: Math.round(sw16 * 100) / 100, res: 16, clear: true };
  return { ratio: and.clear ? and.at : 0.5, swing: 0, res: 8, clear: and.clear };
}

// ------------------------------------------------------------- whole clips

// Analyse a finished clip: envelope, tempo, beats (seconds), downbeat,
// swing. `channels`: Float32Array per channel.
export function analyzeClip(channels, sampleRate, opts = {}) {
  const env = opts.envelope || clipEnvelope(channels, sampleRate);
  return analyzeEnvelope(env, opts);
}

export function analyzeEnvelope(env, { from = 0, to = env.length, bpm: forceBpm = null, beatsPerBar = 4 } = {}) {
  const e = env.arrays(from, to);
  const rate = env.rate;
  const tempo = estimateTempo(e, rate);
  if (!tempo) return null;
  const bpm = forceBpm || tempo.bpm;
  const ph = phaseEnvelope(e);
  const frames = trimBeats(trackBeats(ph, rate, bpm), ph);
  if (frames.length < 3) return null;
  const times = frames.map(f => env.frameTime(f + from));
  const fit = fitBeats(times);
  const down = guessDownbeat(e, frames, beatsPerBar);
  const swing = estimateSwing(e, frames);
  // Tempo from the beats themselves (more precise than the autocorrelation),
  // unless the fit is poor.
  const fitBpm = fit && fit.period > 0 ? 60 / fit.period : bpm;
  const finalBpm = fit && Math.abs(fitBpm / bpm - 1) < 0.04 ? fitBpm : bpm;
  // Beat consistency raises or lowers the confidence a little.
  const steady = fit ? Math.max(0, 1 - fit.jitter / (0.08 * fit.period)) : 0;
  const confidence = Math.round(Math.min(1, tempo.confidence * (0.7 + 0.3 * steady)) * 100) / 100;
  return {
    bpm: finalBpm, rawBpm: tempo.bpm, confidence, alternatives: tempo.alternatives,
    beats: times, beatFrames: frames.map(f => f + from), fit, downbeat: down.index, downbeatConfidence: down.confidence,
    swing, beatsPerBar,
  };
}

// Drum attacks in a clip, as sample indices (where each attack starts), for
// the time-stretch: peaks of the onset envelope at least ~0.8× its RMS above
// the local level, 40 ms or more apart.
export function findTransients(channels, sampleRate, env = clipEnvelope(channels, sampleRate)) {
  const e = env.arrays();
  const x = normalizeEnvelope(e.flux, env.rate);
  const w = Math.max(1, Math.round(env.rate * 0.03));
  const out = [];
  for (let k = 1; k < x.length - 1; k++) {
    if (x[k] < 0.8) continue;
    let peak = true;
    for (let j = Math.max(0, k - w); j <= Math.min(x.length - 1, k + w) && peak; j++) if (x[j] > x[k] || (x[j] === x[k] && j < k)) peak = false;
    if (!peak) continue;
    const s = Math.max(0, Math.round(env.frameTime(k) * sampleRate));
    if (!out.length || s - out[out.length - 1] > 0.04 * sampleRate) out.push(s);
  }
  return out;
}

export function confidenceWord(c) {
  return c >= 0.6 ? 'sure' : c >= 0.35 ? 'fairly sure' : 'unsure';
}

// Halve or double a beat list (the "½×" / "2×" buttons).
export function rescaleBeats(beats, ratio) {
  if (ratio === 2) {
    const out = [];
    for (let i = 0; i < beats.length; i++) {
      out.push(beats[i]);
      if (i + 1 < beats.length) out.push((beats[i] + beats[i + 1]) / 2);
    }
    return out;
  }
  if (ratio === 0.5) return beats.filter((_, i) => i % 2 === 0);
  return beats.slice();
}

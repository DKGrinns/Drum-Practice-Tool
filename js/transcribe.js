// transcribe.js — rough kick / snare / hi-hat transcription of a loop
// (pure, no DOM; tested in Node, see tests/tempo.test.js).
//
// The loop's beats come from the beat tracker (tempo.js). Each beat is cut
// into 16ths (or triplets for swung/shuffle feels), and at every grid slot
// we measure how sharply the energy rises in three filtered bands:
//   kick   low-pass 110 Hz
//   snare  band-pass 1.2–2.5 kHz (the snare's crack and wires, where a
//          hi-hat is much weaker; rim clicks and claps land here too)
//   hats   high-pass 7 kHz (hi-hats, rides, shakers)
// What one drum leaks into another band (a kick's click in the snare band,
// a snare's noise in the hat band) is measured from the clip itself and
// taken off. A slot is a hit when its attack is a fair share of the band's
// loud hits and well above the band's background; quiet snare hits become
// ghost notes and much louder ones accents. The result is a starting point for
// the pattern builder, not a finished chart.

import { fftInPlace } from './tempo.js';

// RBJ biquad, applied in place.
function biquad(x, sr, type, freq, q = 0.707) {
  const w = 2 * Math.PI * freq / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  const a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
  if (type === 'lowpass') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; }
  else { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; }
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i];
    const y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    x[i] = y0;
  }
  return x;
}


// Band-filtered energy, smoothed (≈4 ms) and decimated to about 1 kHz.
// Returns { E, rate } (rate = the exact envelope sample rate).
function bandEnergy(mono, sr, filters) {
  const x = Float32Array.from(mono);
  for (const [type, f] of filters) biquad(x, sr, type, f);
  const hop = Math.max(1, Math.round(sr / 1000));
  const out = new Float32Array(Math.ceil(x.length / hop));
  const a = Math.exp(-1 / (0.004 * sr));
  let e = 0;
  for (let i = 0; i < x.length; i++) {
    e = a * e + (1 - a) * x[i] * x[i];
    if (i % hop === 0) out[i / hop] = e;
  }
  return { E: out, rate: sr / hop };
}

// Attack strength near time t (s): the peak energy just after a moment
// within ±w of t, minus the level just before it.
function attackAt({ E, rate }, t, w) {
  const c = Math.round(t * rate), ww = Math.round(w * rate), ms = rate / 1000;
  let best = 0, at = t;
  for (let k = c - ww; k <= c + ww; k += 1) {
    if (k < 12 * ms || k >= E.length) continue;
    let after = 0;
    for (let j = k; j < Math.min(E.length, k + 25 * ms); j++) if (E[j] > after) after = E[j];
    let before = 0;
    const b0 = Math.round(k - 12 * ms), b1 = Math.round(k - 2 * ms);
    for (let j = b0; j < b1; j++) before += E[j];
    before /= Math.max(1, b1 - b0);
    const v = after - 1.5 * before;
    if (v > best) { best = v; at = k / rate; }
  }
  return { v: best, at };
}

// Shape of a low-band attack near time t, from the low-passed signal x.
// Finds where the attack starts (the level first rises 15% of the way from
// what was ringing before to the peak), then measures, above that earlier
// level, how much of the peak it reaches in the first 10 ms (kicks ≈ 0.7,
// bass notes ≈ 0.3) and how much is left 50 ms later (kicks ring on; a
// snare's body leaking through the low-pass dies away), and the pitch
// drop: a kick's pitch falls fast after the hit (frequency from the zero
// crossings in the first 20 ms vs 40–80 ms later: 1.5–2× for kicks), a
// bass note holds its pitch (≈1×).
function lowShape(x, sr, t) {
  const amp = (a, b) => { let m = 0; for (let i = Math.max(0, Math.round(a * sr)); i < Math.min(x.length, Math.round(b * sr)); i++) { const v = Math.abs(x[i]); if (v > m) m = v; } return m; };
  const base = amp(t - 0.03, t - 0.018);
  const peak = amp(t - 0.015, t + 0.045);
  if (peak <= base * 1.05) return { early: 0, sustain: 0, drop: 0 };
  let on = t - 0.015;
  for (let u = t - 0.015; u < t + 0.04; u += 0.001) if (amp(u, u + 0.001) >= base + 0.15 * (peak - base)) { on = u; break; }
  const pk = amp(on, on + 0.045) - base;
  if (pk <= 0) return { early: 0, sustain: 0, drop: 0 };
  // Frequency from the interpolated zero crossings between a and b (s).
  const freq = (a, b) => {
    let first = -1, last = -1, n = 0;
    for (let i = Math.max(1, Math.round(a * sr)); i < Math.min(x.length, Math.round(b * sr)); i++) {
      if ((x[i] >= 0) === (x[i - 1] >= 0)) continue;
      const c = i - 1 + x[i - 1] / (x[i - 1] - x[i]);
      if (first < 0) first = c;
      last = c; n++;
    }
    return n >= 2 && last > first ? (n - 1) / 2 / ((last - first) / sr) : 0;
  };
  const late = freq(on + 0.04, on + 0.08);
  return { early: (amp(on, on + 0.01) - base) / pk, sustain: (amp(on + 0.05, on + 0.06) - base) / pk, drop: late ? freq(on, on + 0.02) / late : 0 };
}

// Spectral flatness (0..1) of fLo..fHi Hz in the 23 ms after time t: near
// 0.5 for noise (snare rattle, hats), near 0 for chords and notes.
function flatness(mono, sr, t, fLo, fHi) {
  let n = 512;
  while (n < sr * 0.023) n *= 2;
  const re = new Float32Array(n), im = new Float32Array(n);
  const s0 = Math.round(t * sr);
  for (let i = 0; i < n; i++) re[i] = (mono[s0 + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / n));
  fftInPlace(re, im);
  const k0 = Math.max(1, Math.round(fLo * n / sr)), k1 = Math.min(n / 2 - 1, Math.round(fHi * n / sr));
  let lg = 0, ar = 0;
  for (let k = k0; k <= k1; k++) { const p = re[k] * re[k] + im[k] * im[k] + 1e-20; lg += Math.log(p); ar += p; }
  const m = k1 - k0 + 1;
  return Math.exp(lg / m) / (ar / m);
}

const topRef = vals => { const s = vals.slice().sort((a, b) => b - a); return s[Math.min(1, s.length - 1)] || 0; };

function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = Array.from(arr).sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
}

// channels: Float32Array per channel; beats: beat times (s) starting on a
// "1"; swing: { ratio, swing, res } from tempo.js estimateSwing.
// Returns { stepsPerBar, bars, grid, swing, swingRes, tracks: { kick,
// snare, hh } } with step values 0 off, 1 hit, 2 accent, 3 ghost.
export function transcribe(channels, sampleRate, beats, { bars = 2, beatsPerBar = 4, grid = 'auto', swing = { ratio: 0.5, swing: 0, res: 8 } } = {}) {
  const need = bars * beatsPerBar;
  if (beats.length < 2) return null;
  const bt = beats.slice(0, need + 1);
  while (bt.length < need + 1) bt.push(bt[bt.length - 1] + (bt[bt.length - 1] - bt[bt.length - 2]));
  const n = channels[0].length;
  const mono = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) mono[i] += ch[i] / channels.length;
  const trip = grid === 'triplets' || (grid === 'auto' && swing.res === 8 && swing.ratio > 0.6);
  const per = trip ? 3 : 4;
  const slots = [];
  for (let b = 0; b < need; b++) {
    const a = bt[b], len = bt[b + 1] - bt[b];
    for (let k = 0; k < per; k++) {
      let ph = k / per;
      // A 16th grid under swung 8ths or 16ths: move the off-beats.
      if (!trip && swing.swing > 0) {
        if (swing.res === 8) { const r = swing.ratio; if (k === 2) ph = r; else if (k === 1) ph = r / 2; else if (k === 3) ph = r + (1 - r) / 2; }
        else { const q = 0.25 + swing.swing / 12; if (k === 1) ph = q; else if (k === 3) ph = 0.5 + q; }
      }
      slots.push(a + ph * len);
    }
  }
  const step = (bt[need] - bt[0]) / slots.length;
  const w = Math.min(0.02, step * 0.3);
  const EK = bandEnergy(mono, sampleRate, [['lowpass', 110], ['lowpass', 110]]);
  const ES = bandEnergy(mono, sampleRate, [['highpass', 1200], ['highpass', 1200], ['lowpass', 2500], ['lowpass', 2500]]);
  const EH = bandEnergy(mono, sampleRate, [['highpass', 7000], ['highpass', 7000]]);
  const KA = slots.map(t => attackAt(EK, t, w)), SA = slots.map(t => attackAt(ES, t, w)), HA = slots.map(t => attackAt(EH, t, w));
  // Kick: a low attack that rings on and falls in pitch (a bass note holds
  // its pitch, even when it plays with the kick; a snare's body dies away).
  const lowSig = biquad(biquad(Float32Array.from(mono), sampleRate, 'lowpass', 110), sampleRate, 'lowpass', 110);
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const K = KA.map(a => {
    if (a.v <= 0) return 0;
    const sh = lowShape(lowSig, sampleRate, a.at);
    return a.v * clamp01((sh.sustain - 0.2) / 0.2) * clamp01((sh.drop - 1.15) / 0.2);
  });
  // Snare / hats: noisy attacks (tonal ones are chords: skanks, stabs).
  const noisy = f => Math.max(0, Math.min(1, (f - 0.06) / 0.2));
  const Sn = SA.map(a => (a.v > 0 ? a.v * noisy(flatness(mono, sampleRate, a.at - 0.002, 1200, 4000)) : 0));
  const H = HA.map(a => a.v);

  // A slot is a hit when its attack is a fair share of the band's loud hits
  // (the second loudest, so one big accent doesn't decide) and well above
  // the band's background.
  const floorOf = ({ E }) => percentile(E.filter((_, k) => k % 7 === 0), 0.05);
  const hits = (vals, rel, floor, refVals = vals) => {
    const ref = topRef(refVals);
    if (ref < floor * 6) return vals.map(() => false);
    return vals.map(v => v >= ref * rel && v >= floor * 6);
  };
  // Leak = the smallest ratio seen on hits (a drum always leaks at least
  // that much into the other band); taking it off leaves what another drum
  // added.
  const leak = (from, to, mask) => {
    const r = [];
    from.forEach((v, k) => { if (mask[k] && v > 0) r.push(to[k] / v); });
    return r.length >= 2 ? percentile(r, 0.15) : 0;
  };
  const isKick = hits(K, 0.12, floorOf(EK));
  // Hats leak a little into the snare band too (measured on the loudest
  // half of the hat slots, most of which have no snare).
  const hLoud = H.map(v => v >= percentile(H, 0.5) && v > 0);
  const cHS = leak(H, Sn, hLoud);
  const cKS = leak(K, Sn, isKick);
  const S2 = Sn.map((v, k) => Math.max(0, v - (isKick[k] ? cKS * K[k] * 1.3 : 0) - cHS * H[k] * 1.3));
  const sFloor = floorOf(ES);
  const sRef = topRef(S2);
  const isSnare = hits(S2, 0.2, sFloor);
  // A snare's noise reaches the hat band too (ghost notes included). The
  // ratio is measured on every slot with snare in it; if all of them also
  // have a hat, it is capped by what plain noise gives (about 12× in these
  // two bands).
  const sMin = Math.max(sFloor * 8, sRef * 0.004);
  const hasSnare = S2.map(v => v >= sMin);
  const cSH = Math.min(leak(S2, H, hasSnare), 12);
  // A kick's beater click can reach it too (a few % of the kick; more than
  // that means hats were playing on the kicks).
  const cKH = Math.min(leak(K, H, isKick), 0.06);
  const H2 = H.map((v, k) => Math.max(0, v - (hasSnare[k] ? cSH * S2[k] * 1.2 : 0) - (isKick[k] ? cKH * K[k] * 1.2 : 0)));
  const isHat = hits(H2, 0.15, floorOf(EH), H2.filter((_, k) => !hasSnare[k]));
  // Under a loud snare (or a kick) the hat can't be told from the drum's own noise.
  // Hats usually keep a steady pulse, so: where the hats play at this spot
  // of the beat almost everywhere else, a hat-band attack at least half as
  // strong as a normal hat under a snare or kick is a hat too.
  const hMed0 = percentile(H.filter((_, k) => isHat[k] && !isSnare[k] && !isKick[k]), 0.5);
  for (let p = 0; p < per; p++) {
    let n = 0, on = 0;
    for (let k = p; k < slots.length; k += per) if (!isSnare[k] && !isKick[k]) { n++; if (isHat[k]) on++; }
    if (n < 2 || on / n < 0.75) continue;
    for (let k = p; k < slots.length; k += per) if ((isSnare[k] || isKick[k]) && !isHat[k] && H[k] >= hMed0 * 0.5) isHat[k] = true;
  }

  // Snare dynamics: ghosts are the quiet group (down to ~−20 dB from the
  // backbeat), accents clearly louder than the backbeat.
  const loud = S2.filter((v, k) => isSnare[k] && v >= sRef * 0.35);
  const sMain = percentile(loud, 0.5) || sRef;
  const snare = S2.map((v, k) => {
    if (isKick[k] && v < sMain * 0.35) return 0;        // what's left of a kick's click
    if (v >= sMain * 0.35) return v > sMain * 2 ? 2 : 1;
    return v >= sMain * 0.02 && v >= sFloor * 8 ? 3 : 0;
  });
  const hMed = percentile(H2.filter((_, k) => isHat[k]), 0.5);
  const hh = H2.map((v, k) => (isHat[k] ? (v > hMed * 2.5 && !isSnare[k] ? 2 : 1) : 0));
  const kick = isKick.map(b => (b ? 1 : 0));
  return {
    stepsPerBar: beatsPerBar * per, bars, grid: trip ? 'triplets' : 'sixteenths',
    swing: trip ? 0 : swing.swing, swingRes: swing.res,
    tracks: { kick, snare, hh },
  };
}

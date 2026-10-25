// synth.js — every drum sound is synthesised here with Web Audio nodes.
// No samples are loaded. Each `play*` method schedules one hit at an exact
// audio-clock time `t` with a velocity `v` (0..1).

// Ratios from the classic TR-808 cymbal/hat oscillator bank: six detuned
// square waves give a convincing metallic tone.
const METAL_RATIOS = [2, 3, 4.16, 5.43, 6.79, 8.21];

export class DrumSynth {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.out = destination;
    this.noise = makeNoiseBuffer(ctx, 1.0);
    this.openHat = null; // { choke: GainNode, start, end } for hi-hat choking
  }

  play(voice, t, v) {
    switch (voice) {
      case 'kick':   return this.kick(t, v);
      case 'snare':  return this.snare(t, v);
      case 'rim':    return this.rim(t, v);
      case 'hh':     return this.closedHat(t, v);
      case 'oh':     return this.openHatHit(t, v);
      case 'ride':   return this.ride(t, v);
      case 'accent': return this.click(t, v, 1700, 'square');
      case 'click':  return this.click(t, v, 1100, 'square');
      case 'sub':    return this.click(t, v * 0.8, 750, 'triangle');
      default: return undefined;
    }
  }

  // --- helpers -------------------------------------------------------------

  // Gain node with a fast attack and exponential decay to silence.
  env(t, peak, decay, attack = 0.002) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  noiseSource(t, dur) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    // Random offset so consecutive hits don't sound identical.
    const offset = Math.random() * (this.noise.duration - dur - 0.01);
    src.start(t, Math.max(0, offset), dur + 0.01);
    return src;
  }

  filter(type, freq, q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  // Bank of square oscillators summed into `dest`, for hats and ride.
  metal(t, dur, base, dest) {
    for (const r of METAL_RATIOS) {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = base * r;
      o.connect(dest);
      o.start(t);
      o.stop(t + dur);
    }
  }

  // --- voices --------------------------------------------------------------

  kick(t, v) {
    const ctx = this.ctx;
    // Body: sine with a fast downward pitch sweep.
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.11);
    const g = this.env(t, v * 0.92, 0.42, 0.003);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.5);
    // Beater click: a tiny burst of filtered noise.
    const n = this.noiseSource(t, 0.012);
    const f = this.filter('highpass', 1800);
    const ng = this.env(t, v * 0.25, 0.01, 0.001);
    n.connect(f).connect(ng).connect(this.out);
  }

  snare(t, v) {
    const ctx = this.ctx;
    const ghost = v < 0.4;
    // Wires: bright noise.
    const dur = ghost ? 0.09 : 0.2;
    const n = this.noiseSource(t, dur + 0.02);
    const hp = this.filter('highpass', 1200);
    const bp = this.filter('peaking', 3500, 1);
    bp.gain.value = 4;
    const ng = this.env(t, v * 0.55, dur, 0.001);
    n.connect(hp).connect(bp).connect(ng).connect(this.out);
    // Shell: short pitched body.
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(170, t + 0.06);
    const og = this.env(t, v * 0.45, ghost ? 0.05 : 0.09, 0.001);
    o.connect(og).connect(this.out);
    o.start(t);
    o.stop(t + 0.15);
  }

  // Cross-stick / rim click: woody "tock" — a resonant knock plus a click.
  rim(t, v) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(560, t);
    o.frequency.exponentialRampToValueAtTime(470, t + 0.04);
    const og = this.env(t, v * 0.75, 0.055, 0.001);
    o.connect(og).connect(this.out);
    o.start(t);
    o.stop(t + 0.08);

    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.value = 1750;
    const bp = this.filter('bandpass', 1750, 6);
    const o2g = this.env(t, v * 0.5, 0.02, 0.0005);
    o2.connect(bp).connect(o2g).connect(this.out);
    o2.start(t);
    o2.stop(t + 0.04);

    const n = this.noiseSource(t, 0.02);
    const nf = this.filter('bandpass', 2500, 1.5);
    const ng = this.env(t, v * 0.35, 0.015, 0.0005);
    n.connect(nf).connect(ng).connect(this.out);
  }

  hat(t, v, decay, dest) {
    const bp = this.filter('bandpass', 10000, 0.8);
    const hp = this.filter('highpass', 7000);
    const g = this.env(t, v * 0.35, decay, 0.001);
    this.metal(t, decay + 0.05, 40, bp);
    bp.connect(hp).connect(g).connect(dest);
    // A little noise for "air".
    const n = this.noiseSource(t, decay + 0.02);
    const nf = this.filter('highpass', 8000);
    const ng = this.env(t, v * 0.12, decay, 0.001);
    n.connect(nf).connect(ng).connect(dest);
  }

  chokeOpenHat(t) {
    const oh = this.openHat;
    if (oh && t > oh.start && t < oh.end) {
      oh.choke.gain.setValueAtTime(1, t);
      oh.choke.gain.linearRampToValueAtTime(0, t + 0.02);
    }
    this.openHat = null;
  }

  closedHat(t, v) {
    this.chokeOpenHat(t); // a closed hat cuts off a ringing open hat
    this.hat(t, v, v < 0.4 ? 0.03 : 0.055, this.out);
  }

  openHatHit(t, v) {
    this.chokeOpenHat(t);
    // Each open hat goes through its own choke gain so it can be cut off
    // cleanly without disturbing its envelope automation.
    const choke = this.ctx.createGain();
    choke.connect(this.out);
    const decay = 0.42;
    this.hat(t, v, decay, choke);
    this.openHat = { choke, start: t, end: t + decay };
  }

  ride(t, v) {
    const bp = this.filter('bandpass', 7500, 1.2);
    const hp = this.filter('highpass', 4200);
    const g = this.env(t, v * 0.22, 0.9, 0.001);
    this.metal(t, 1.0, 62, bp);
    bp.connect(hp).connect(g).connect(this.out);
    // Stick "ping" — stronger on accents (bell-like).
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 3150;
    const og = this.env(t, v * (v > 0.9 ? 0.16 : 0.09), 0.35, 0.001);
    o.connect(og).connect(this.out);
    o.start(t);
    o.stop(t + 0.4);
  }

  click(t, v, freq, type) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.env(t, v * 0.75, 0.03, 0.0005);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.05);
  }
}

function makeNoiseBuffer(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

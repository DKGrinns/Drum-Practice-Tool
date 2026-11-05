// onset-worklet.js — finds drum hits ("onsets") in microphone audio.
//
// This one file does two jobs:
//   * exports OnsetDetector, a plain class (tested in Node with synthetic
//     audio, see tests/onset.test.js);
//   * when loaded with audioWorklet.addModule() it registers an
//     AudioWorkletProcessor that runs the detector on the audio thread and
//     posts each hit to the page. (No imports, so it works in every browser
//     that has AudioWorklet.)
//
// How detection works:
//   1. Pre-emphasis (y = x - 0.9·x[n-1]) boosts the sharp attack of a hit
//      over room rumble and ringing.
//   2. Every `hop` samples (~1.4 ms) the energy of the last `win` samples is
//      measured.
//   3. A hit starts when the energy is above the absolute threshold (set by
//      the sensitivity), well above the recent background ("floor"), and
//      rising fast compared with a few milliseconds earlier.
//   4. The exact start is refined to the sample: the first sample in the
//      window that reaches 30% of the window's peak.
//   5. After a hit, the detector ignores new triggers for `refractory`
//      seconds (so a ringing snare doesn't count twice) unless a much louder
//      attack arrives, and measures the hit's peak level over the next 8 ms
//      for dynamics.
// Times are in seconds on the AudioContext clock: sample index / sampleRate.

export class OnsetDetector {
  constructor({ sampleRate, sensitivity = 60, refractory = 0.04, onOnset = () => {} } = {}) {
    this.sr = sampleRate;
    this.hop = 64;
    this.win = 128;
    this.refractory = refractory;
    this.onOnset = onOnset;
    this.setSensitivity(sensitivity);
    this.ring = new Float32Array(1024);   // recent pre-emphasised samples
    this.ringPos = 0;
    this.sampleIndex = 0;                 // absolute index of the next sample
    this.prevX = 0;
    this.sinceHop = 0;
    this.energyHist = new Array(8).fill(0); // energy of the last 8 hops (≈11 ms)
    this.floor = 1e-6;
    this.lastOnset = -Infinity;
    this.pending = null;                  // hit waiting for its peak level
    this.level = 0;                       // peak |x| since last read (meter)
  }

  // sensitivity 0..100 -> minimum amplitude of a hit, log scale from 0.2
  // (only very loud hits) down to 0.002 (very quiet ghost notes).
  setSensitivity(s) {
    const t = Math.min(100, Math.max(0, s)) / 100;
    this.threshold = 0.2 * Math.pow(0.01, t);
    this.minEnergy = this.threshold * this.threshold * 0.5;
  }

  // Feed a block of samples. `startIndex` = absolute sample index of
  // block[0] (pass it if blocks may be dropped; otherwise it is counted).
  process(block, startIndex = this.sampleIndex) {
    this.sampleIndex = startIndex;
    for (let i = 0; i < block.length; i++) {
      const x = block[i];
      const ax = x < 0 ? -x : x;
      if (ax > this.level) this.level = ax;
      const y = x - 0.9 * this.prevX;
      this.prevX = x;
      this.ring[this.ringPos] = y;
      this.ringPos = (this.ringPos + 1) & 1023;
      this.sampleIndex++;
      if (this.pending) {
        if (ax > this.pending.peak) this.pending.peak = ax;
        if (this.sampleIndex >= this.pending.until) {
          this.onOnset({ time: this.pending.time, peak: this.pending.peak });
          this.pending = null;
        }
      }
      if (++this.sinceHop >= this.hop) {
        this.sinceHop = 0;
        this.analyse();
      }
    }
  }

  analyse() {
    // Energy of the last `win` samples.
    let e = 0;
    for (let k = 1; k <= this.win; k++) {
      const v = this.ring[(this.ringPos - k) & 1023];
      e += v * v;
    }
    e /= this.win;
    // Loudest energy 3–11 ms ago. Using the max (not one moment) means the
    // cycles of a low drum's wave don't look like new attacks, while a real
    // hit still towers over a decaying tail.
    let earlier = 0;
    for (let k = 0; k < 6; k++) if (this.energyHist[k] > earlier) earlier = this.energyHist[k];
    const now = this.sampleIndex / this.sr;
    const since = now - this.lastOnset;
    const isHit = e > this.minEnergy &&
      e > this.floor * 3 &&              // ≈ 5 dB above the background
      e > earlier * 2.5 &&               // sharp rise (≈4 dB), not a slow swell
      // Normally one hit per `refractory` window (a ringing drum doesn't
      // count twice). A much louder attack may break through after 8 ms:
      // e.g. your hit 15 ms after the quieter speaker click it follows.
      (since >= this.refractory || (since >= 0.008 && e > earlier * 8));
    if (isHit) {
      this.lastOnset = now;
      this.pending = { time: this.refine(Math.sqrt(earlier)), peak: 0, until: this.sampleIndex + Math.round(0.008 * this.sr) };
    }
    // Background, tracked in decibels: drops quickly in quiet passages and
    // rises only slowly with loud ones, so it follows the room's noise floor
    // rather than the ringing tail of the last hit (which would hide the
    // next ghost note).
    const a = e < this.floor ? 0.2 : 0.004;
    this.floor = Math.exp(Math.log(this.floor) + a * (Math.log(Math.max(e, 1e-12)) - Math.log(this.floor)));
    if (this.floor < 1e-9) this.floor = 1e-9;
    this.energyHist.shift();
    this.energyHist.push(e);
  }

  // Sample-accurate start: first sample in the last 2 windows that reaches
  // 30% of their peak and stands clearly above what was sounding before
  // (`before` = RMS level just before the hit, e.g. the previous hit's tail).
  refine(before = 0) {
    const span = this.win * 2;
    let peak = 0;
    for (let k = 1; k <= span; k++) {
      const v = Math.abs(this.ring[(this.ringPos - k) & 1023]);
      if (v > peak) peak = v;
    }
    const level = Math.max(peak * 0.3, before * 2.5);
    for (let k = span; k >= 1; k--) {
      if (Math.abs(this.ring[(this.ringPos - k) & 1023]) >= level) {
        return (this.sampleIndex - k) / this.sr;
      }
    }
    return this.sampleIndex / this.sr;
  }

  // Peak input level since the last call (for the level meter).
  takeLevel() {
    const l = this.level;
    this.level = 0;
    return l;
  }
}

// ---------------------------------------------------------------------------
// AudioWorklet processor (only when loaded as a worklet).
if (typeof registerProcessor === 'function') {
  registerProcessor('onset-detector', class extends AudioWorkletProcessor {
    constructor(options) {
      super();
      const opts = (options && options.processorOptions) || {};
      this.det = new OnsetDetector({
        sampleRate, // global in AudioWorkletGlobalScope
        sensitivity: opts.sensitivity ?? 60,
        onOnset: o => this.port.postMessage({ type: 'onset', time: o.time, peak: o.peak }),
      });
      this.blocks = 0;
      // Recording: raw samples are batched (~43 ms) and sent with the audio
      // clock frame of their first sample.
      this.recording = false;
      this.rec = new Float32Array(2048);
      this.recLen = 0;
      this.recFrame = 0;
      this.port.onmessage = e => {
        if (e.data.type === 'sensitivity') this.det.setSensitivity(e.data.value);
        else if (e.data.type === 'record') { this.flushRec(); this.recording = e.data.value; }
      };
    }
    flushRec() {
      if (!this.recLen) return;
      const data = this.rec.slice(0, this.recLen);
      this.port.postMessage({ type: 'audio', frame: this.recFrame, data }, [data.buffer]);
      this.recLen = 0;
    }
    process(inputs) {
      const ch = inputs[0] && inputs[0][0];
      // currentFrame = audio-clock frame of this block, so onset times line up
      // with AudioContext.currentTime.
      if (ch) this.det.process(ch, currentFrame);
      if (ch && this.recording) {
        if (!this.recLen) this.recFrame = currentFrame;
        if (this.recLen + ch.length > this.rec.length) { this.flushRec(); this.recFrame = currentFrame; }
        this.rec.set(ch, this.recLen);
        this.recLen += ch.length;
      }
      if (++this.blocks % 8 === 0) this.port.postMessage({ type: 'level', value: this.det.takeLevel() });
      return true;
    }
  });
}

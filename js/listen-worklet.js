// listen-worklet.js — audio-thread parts of the Listen tab.
//
// This one file does two jobs (like onset-worklet.js):
//   * exports Stretcher, a plain class (tested in Node, see
//     tests/stretch.test.js);
//   * when loaded with audioWorklet.addModule() it registers two
//     processors:
//       'stretch-player'  plays a grabbed clip in a loop at 50–100% speed
//                         without changing the pitch (Stretcher);
//       'capture-tap'     sends the captured audio (Chrome tab, mic) to the
//                         page in ~46 ms chunks, stamped with the audio-clock
//                         frame of their first sample.
//   No imports, so it works in every browser with AudioWorklet.
//
// How the slow-down works (WSOLA, waveform-similarity overlap-add, with
// drum attacks kept whole):
//   The output is built from short overlapping grains (30 ms, Hann window,
//   half-overlapped, so two grains always sum to exactly 1). Each output
//   hop (15 ms) the read position in the clip advances less than 15 ms, so
//   the music lasts longer, but each grain itself plays at the normal rate,
//   so the pitch stays the same. Each grain is taken from within ±12 ms of
//   where it should be, at the offset whose waveform best matches the
//   natural continuation of the previous grain (normalised
//   cross-correlation, coarse search then fine), which avoids phasing.
//   Plain WSOLA repeats drum attacks (a flam-like double hit at slow
//   speeds), so the clip's transients (found by tempo.js findTransients)
//   are treated specially:
//     * grains before a transient never reach into it;
//     * the transient is played once, untouched (contiguous grains, as at
//       100%), placed exactly at its slowed-down time, followed by 45 ms of
//       its attack;
//     * the stretch happens in the decay between transients, at whatever
//       rate lands the next transient on time.
//   So hits stay crisp and on the stretched grid; the tails take the
//   stretching. At 100% the grains line up exactly and the clip plays
//   untouched.

export class Stretcher {
  constructor(sampleRate) {
    this.sr = sampleRate;
    let n = Math.round(sampleRate * 0.03);
    n += n % 2;
    this.N = n;                        // grain length
    this.hop = n / 2;                  // output hop
    this.tol = Math.round(sampleRate * 0.012);
    this.attack = Math.round(sampleRate * 0.045); // played untouched after a transient
    this.fade = Math.round(sampleRate * 0.006);  // crossfade at the loop point
    this.guard = Math.round(sampleRate * 0.004); // grains before a transient stop this far before it
    this.win = new Float32Array(n);
    for (let i = 0; i < n; i++) this.win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n); // periodic Hann
    this.channels = [new Float32Array(0)];
    this.mono = new Float32Array(0);
    this.transients = [];
    this.loopStart = 0;
    this.loopEnd = 0;
    this.speed = 1;
    this.reset(0);
  }

  // channels: Float32Array per channel. transients: sorted sample indices of
  // drum attacks (optional).
  setClip(channels, transients = []) {
    this.channels = channels.length ? channels : [new Float32Array(0)];
    const len = this.channels[0].length;
    this.mono = new Float32Array(len);
    for (const ch of this.channels) for (let i = 0; i < len; i++) this.mono[i] += ch[i] / this.channels.length;
    this.allTransients = transients.slice().sort((a, b) => a - b);
    this.setLoop(0, len);
    this.reset(0);
  }

  setLoop(start, end) {
    const len = this.channels[0].length;
    this.loopStart = Math.max(0, Math.min(len, Math.round(start)));
    this.loopEnd = Math.max(this.loopStart + 1, Math.min(len, Math.round(end)));
    // Transients inside the loop, merged when closer than a grain plus the
    // attack (a flam or a drag is kept together).
    const gap = this.N + this.attack;
    const ts = [];
    for (const t of this.allTransients || []) {
      if (t < this.loopStart || t >= this.loopEnd) continue;
      if (!ts.length || t - ts[ts.length - 1] >= gap) ts.push(t);
    }
    // ...and not right before the wrap (it would collide with the first).
    while (ts.length > 1 && ts[0] + this.loopLen - ts[ts.length - 1] < gap) ts.pop();
    this.transients = ts;
  }

  setSpeed(r) {
    r = Math.max(0.25, Math.min(1, r));
    if (r === this.speed) return;
    // Back to 100%: restart exactly where the music is (contiguous from there).
    if (r >= 0.999) { const p = this.position(); this.speed = r; this.reset(p); return; }
    // Keep the musical position continuous: re-anchor the time map here.
    this.anchor = { src: this.unwrappedPosition(), out: this.outIndex };
    this.speed = r;
  }

  get loopLen() { return this.loopEnd - this.loopStart; }

  // Wrap a clip position into the loop.
  wrap(p) {
    const L = this.loopLen;
    return this.loopStart + ((((p - this.loopStart) % L) + L) % L);
  }

  // Start (again) from clip position `pos`. Positions are kept "unwrapped"
  // (they keep growing past the loop end) and wrapped only when reading.
  reset(pos) {
    const p = this.channels[0].length ? this.wrap(pos || this.loopStart || 0) : 0;
    this.anaPos = p;                   // nominal read position of the next grain
    this.prevPos = null;               // where the previous grain was read from
    this.acc = new Float32Array(this.N * Math.max(1, this.channels.length));
    this.outIndex = 0;                 // samples handed out since reset
    this.grainOut = 0;                 // output index where the next grain starts
    this.anchor = { src: p, out: 0 };  // time map: clip pos `src` is heard at output `out`
    this.inAttack = null;              // unwrapped transient being played, or null
  }

  // Musical time: where in the clip the output sample about to be produced
  // is, advancing at `speed` (drum hits are heard exactly there).
  unwrappedPosition() { return this.anchor.src + (this.outIndex - this.anchor.out) * this.speed; }
  position() { return this.loopLen > 0 ? this.wrap(this.unwrappedPosition()) : 0; }

  // First transient at or after unwrapped position p (unwrapped), or
  // Infinity.
  nextTransient(p) {
    const ts = this.transients;
    if (!ts.length) return Infinity;
    const L = this.loopLen;
    const base = p - this.wrap(p); // loopStart + k·L - loopStart
    for (let k = 0; k < 2; k++) {
      for (const t of ts) { const u = t + base + k * L; if (u >= p) return u; }
    }
    return Infinity;
  }

  // One sample of channel `ch` at clip index i (integer, unwrapped), with
  // a short crossfade into the audio just before the loop start so the wrap
  // is seamless.
  sample(ch, i) {
    const idx = this.wrap(i);
    const F = Math.min(this.fade, this.loopStart, Math.floor(this.loopLen / 4));
    if (F > 0 && idx >= this.loopEnd - F) {
      const g = (idx - (this.loopEnd - F)) / F;
      return ch[idx] * (1 - g) + ch[this.loopStart - F + (idx - (this.loopEnd - F))] * g;
    }
    return ch[idx];
  }

  // Best read position near `nominal`, at most `maxPos`, matching the
  // continuation of the previous grain.
  align(nominal, maxPos) {
    const cont = this.prevPos + this.hop;
    const lo = nominal - this.tol, hi = Math.min(nominal + this.tol, maxPos);
    if (hi < lo) return Math.min(nominal, maxPos);
    const m = this.mono, len = this.hop;
    const ncc = (a, sstep) => {
      let d = 0, e = 0;
      for (let j = 0; j < len; j += sstep) {
        const x = this.sample(m, a + j), y = this.sample(m, cont + j);
        d += x * y; e += x * x;
      }
      return e > 1e-12 ? d / Math.sqrt(e) : (a === Math.round(nominal) ? 0 : -1);
    };
    let best = Math.round(Math.min(Math.max(nominal, lo), hi)), bv = -Infinity;
    for (let a = Math.ceil(lo); a <= hi; a += 4) { const v = ncc(a, 4); if (v > bv) { bv = v; best = a; } }
    let fine = best;
    for (let a = Math.max(Math.ceil(lo), best - 4); a <= Math.min(hi, best + 4); a++) { const v = ncc(a, 2); if (v > bv) { bv = v; fine = a; } }
    return fine;
  }

  // Where the next grain is read from.
  nextGrainPos() {
    const N = this.N, hop = this.hop, out = this.grainOut;
    if (this.prevPos == null) {
      // First grain: if a transient is right here, play it whole.
      const pos = Math.round(this.anaPos);
      const T = this.nextTransient(pos);
      if (this.speed < 0.999 && T - pos < N) {
        this.inAttack = T;
        this.anchor = { src: T, out: T - pos };
        this.anaPos = pos + hop;
      } else this.anaPos += this.speed * hop;
      return pos;
    }
    // At 100%, or while playing a transient's attack: contiguous.
    if (this.speed >= 0.999) { this.anaPos = this.prevPos + 2 * hop; return this.prevPos + hop; }
    if (this.inAttack != null) {
      const p = this.prevPos + hop;
      if (p < this.inAttack + this.attack) { this.anaPos = p + hop; return p; }
      // Attack done: the time map is anchored on the transient.
      this.inAttack = null;
    }
    const T = this.nextTransient(this.prevPos + hop);
    if (T !== Infinity) {
      const target = this.anchor.out + (T - this.anchor.src) / this.speed; // output index where T is heard
      const o = target - out;
      if (o < N) {
        // This grain carries the transient, at offset o (≥ hop, where the
        // contiguous grains that follow make the sum exact).
        this.inAttack = T;
        this.anchor = { src: T, out: Math.round(target) };
        const p = Math.round(T - Math.max(hop, o));
        this.anaPos = p + hop;
        return p;
      }
      // Decay before T: stretch at the rate that arrives in time, and
      // never reach into T.
      const stop = T - N - this.guard;
      const rate = Math.max(0.1, Math.min(2, (stop - this.anaPos) / Math.max(1, target - N - out)));
      const nominal = this.anaPos;
      this.anaPos += rate * hop;
      return this.align(Math.round(nominal), stop);
    }
    const nominal = this.anaPos;
    this.anaPos += this.speed * hop;
    return this.align(Math.round(nominal), Infinity);
  }

  // Overlap-add one grain at the start of the accumulator (everything
  // before the next grain's start has been handed out).
  addGrain() {
    const pos = this.nextGrainPos();
    const C = this.channels.length, N = this.N, A = this.acc;
    for (let c = 0; c < C; c++) {
      const ch = this.channels[c], off = c * N;
      for (let j = 0; j < N; j++) A[off + j] += this.win[j] * this.sample(ch, pos + j);
    }
    this.prevPos = pos;
    this.grainOut += this.hop;
  }

  // Fill `out` (array of Float32Array, one per output channel) with the next
  // frames. Mono clips go to every output channel.
  process(out) {
    const n = out[0].length;
    if (this.loopLen < this.N * 2) { for (const o of out) o.fill(0); return; }
    const C = this.channels.length, N = this.N, A = this.acc;
    let done = 0;
    while (done < n) {
      // Samples before the next grain's start are final.
      const avail = this.grainOut - this.outIndex;
      if (avail <= 0) { this.addGrain(); continue; }
      const take = Math.min(avail, n - done);
      for (let o = 0; o < out.length; o++) {
        const off = Math.min(o, C - 1) * N;
        out[o].set(A.subarray(off, off + take), done);
      }
      for (let c = 0; c < C; c++) {
        const off = c * N;
        A.copyWithin(off, off + take, off + N);
        A.fill(0, off + N - take, off + N);
      }
      this.outIndex += take;
      done += take;
    }
  }
}

// ---------------------------------------------------------------------------
// AudioWorklet processors (only when loaded as a worklet).
if (typeof registerProcessor === 'function') {
  registerProcessor('stretch-player', class extends AudioWorkletProcessor {
    constructor() {
      super();
      this.st = new Stretcher(sampleRate);
      this.playing = false;
      this.blocks = 0;
      this.port.onmessage = e => {
        const d = e.data;
        if (d.type === 'clip') { this.st.setClip(d.channels, d.transients || []); }
        else if (d.type === 'loop') { this.st.setLoop(d.start, d.end); if (d.restart) this.st.reset(d.start); }
        else if (d.type === 'speed') this.st.setSpeed(d.value);
        else if (d.type === 'play') { this.st.reset(d.pos != null ? d.pos : this.st.loopStart); this.playing = true; this.report(); }
        else if (d.type === 'stop') this.playing = false;
      };
    }
    report() {
      this.port.postMessage({ type: 'pos', frame: currentFrame, pos: this.st.position(), speed: this.st.speed, loopStart: this.st.loopStart, loopEnd: this.st.loopEnd });
    }
    process(inputs, outputs) {
      const out = outputs[0];
      if (!this.playing) { for (const o of out) o.fill(0); return true; }
      if (++this.blocks % 6 === 0) this.report(); // position for the page, before this block plays
      this.st.process(out);
      return true;
    }
  });

  registerProcessor('capture-tap', class extends AudioWorkletProcessor {
    constructor() {
      super();
      this.size = 2048;
      this.buf = [new Float32Array(this.size), new Float32Array(this.size)];
      this.len = 0;
      this.frame = 0;
      this.peak = 0;
    }
    process(inputs) {
      const inp = inputs[0];
      if (!inp || !inp.length) return true;
      const l = inp[0], r = inp[1] || inp[0];
      if (this.len === 0) this.frame = currentFrame;
      this.buf[0].set(l, this.len);
      this.buf[1].set(r, this.len);
      for (let i = 0; i < l.length; i++) { const v = Math.abs(l[i]); if (v > this.peak) this.peak = v; }
      this.len += l.length;
      if (this.len + 128 > this.size) {
        const a = this.buf[0].slice(0, this.len), b = this.buf[1].slice(0, this.len);
        this.port.postMessage({ type: 'audio', frame: this.frame, channels: [a, b], peak: this.peak }, [a.buffer, b.buffer]);
        this.len = 0;
        this.peak = 0;
      }
      return true;
    }
  });
}

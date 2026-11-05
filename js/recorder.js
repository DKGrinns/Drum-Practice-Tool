// recorder.js — records takes from the microphone as raw audio, aligned to
// the audio clock sample-for-sample, so a take can be played back exactly
// in time over the groove. Also exports WAV files.

export const MAX_TAKE_SECONDS = 180;

export class TakeRecorder {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.chunks = [];
    this.startTime = null; // audio-clock time of the first sample
    this.length = 0;
  }

  // Add a block that starts at audio-clock frame `frame`. Gaps (dropped
  // blocks) are filled with silence so timing stays exact.
  add(samples, frame) {
    const t = frame / this.sr;
    if (this.startTime === null) this.startTime = t;
    const expected = Math.round(this.startTime * this.sr) + this.length;
    const gap = frame - expected;
    if (gap > 0 && gap < this.sr) { this.chunks.push(new Float32Array(gap)); this.length += gap; }
    if (this.length + samples.length > MAX_TAKE_SECONDS * this.sr) return false; // full
    this.chunks.push(samples);
    this.length += samples.length;
    return true;
  }

  get duration() { return this.length / this.sr; }

  samples() {
    const out = new Float32Array(this.length);
    let pos = 0;
    for (const c of this.chunks) { out.set(c, pos); pos += c.length; }
    return out;
  }

  toAudioBuffer(ctx) {
    const buf = ctx.createBuffer(1, Math.max(1, this.length), this.sr);
    buf.getChannelData(0).set(this.samples());
    return buf;
  }
}

// 16-bit PCM mono WAV.
export function encodeWav(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

// When to start a recorded take so it lines up with a new playback of the
// same groove. The take's first beat was at `takeFirstBeat`; the recording
// began at `takeStart`; the new playback's first beat is at `newFirstBeat`.
// `latency` (round trip, from calibration) moves the recording earlier so
// your hits land where you played them relative to what you heard.
// Returns { when, offset } for AudioBufferSourceNode.start(when, offset).
export function alignTake(takeStart, takeFirstBeat, newFirstBeat, latency, now) {
  let when = newFirstBeat - (takeFirstBeat - takeStart) - latency;
  let offset = 0;
  if (when < now) { offset = now - when; when = now; }
  return { when, offset };
}

// capture.js — where the Listen tab's audio comes from.
//
//   LiveCapture   a Chrome tab (getDisplayMedia, "Also share tab audio") or
//                 the microphone, fed through the 'capture-tap' worklet,
//                 which hands over the audio in chunks stamped with the
//                 audio-clock frame of their first sample. Optionally also
//                 heard through the app (so the drum focus filters work and
//                 the click lines up exactly with what you hear).
//   decodeFile    an audio file from the device (decodeAudioData).
//   RollingBuffer the last 30–60 s of captured audio, for "Grab".
//
// Uses the engine's AudioContext, so capture times, the click and the
// app's own playback share one clock.

let moduleLoaded = null;
export function loadListenWorklet(ctx) {
  if (!ctx.audioWorklet) return Promise.reject(Object.assign(new Error('AudioWorklet is not available'), { code: 'unsupported' }));
  if (!moduleLoaded) moduleLoaded = ctx.audioWorklet.addModule('js/listen-worklet.js').catch(e => { moduleLoaded = null; throw e; });
  return moduleLoaded;
}

const err = (code, message) => Object.assign(new Error(message), { code });

export class LiveCapture {
  constructor(engine) {
    this.engine = engine;
    this.onChunk = () => {};   // (channels [L, R], frame, peak)
    this.onEnded = () => {};   // the user stopped sharing (Chrome's "Stop sharing" bar)
    this.active = false;
    this.kind = null;
  }

  static tabSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  }
  static micSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  // kind: 'tab' | 'mic'. `monitorOut`: node to connect the live audio to so
  // it is heard through the app (or null). Throws Error with .code:
  //   'unsupported' | 'denied' | 'no-audio' | 'failed'
  async start(kind, monitorOut) {
    if (this.active) this.stop();
    const ctx = this.engine.ensureAudio();
    if (ctx.state !== 'running') await ctx.resume();
    await loadListenWorklet(ctx);
    let stream;
    if (kind === 'tab') {
      if (!LiveCapture.tabSupported()) throw err('unsupported', 'Tab capture needs desktop Chrome or Edge');
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,  // Chrome requires video; it is stopped straight away
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: !!monitorOut },
          preferCurrentTab: false,
          selfBrowserSurface: 'exclude',
          systemAudio: 'include',
          surfaceSwitching: 'include',
        });
      } catch (e) {
        throw err(e && e.name === 'NotAllowedError' ? 'denied' : 'failed', (e && e.message) || 'Sharing was cancelled');
      }
      // Keep only the audio.
      for (const t of stream.getVideoTracks()) { try { t.stop(); stream.removeTrack(t); } catch (e) { /* ignore */ } }
      if (!stream.getAudioTracks().length) throw err('no-audio', 'No audio was shared');
    } else {
      if (!LiveCapture.micSupported()) throw err('unsupported', 'No microphone access in this browser');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      } catch (e) {
        throw err(e && e.name === 'NotAllowedError' ? 'denied' : 'failed', (e && e.message) || 'Microphone not available');
      }
    }
    const track = stream.getAudioTracks()[0];
    // Did Chrome stop the tab playing by itself? (Then it is only heard
    // through the app.)
    let settings = {};
    try { settings = track.getSettings ? track.getSettings() : {}; } catch (e) { /* ignore */ }
    this.localPlaybackSuppressed = kind === 'tab' && settings.suppressLocalAudioPlayback === true;
    track.addEventListener('ended', () => { if (this.active) { this.stop(); this.onEnded(); } });
    this.stream = stream;
    this.source = ctx.createMediaStreamSource(stream);
    this.tap = new AudioWorkletNode(ctx, 'capture-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    this.tap.port.onmessage = e => { if (e.data.type === 'audio') this.onChunk(e.data.channels, e.data.frame, e.data.peak); };
    // The tap must reach the output to keep running; a silent gain does it.
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    this.source.connect(this.tap).connect(this.sink).connect(ctx.destination);
    this.monitorOut = monitorOut || null;
    if (this.monitorOut) this.source.connect(this.monitorOut);
    this.active = true;
    this.kind = kind;
    return { label: track.label || '', suppressed: this.localPlaybackSuppressed };
  }

  // Hear the live audio through the app (node) or not (null).
  setMonitor(node) {
    if (!this.active) return;
    if (this.monitorOut) { try { this.source.disconnect(this.monitorOut); } catch (e) { /* ignore */ } }
    this.monitorOut = node || null;
    if (node) this.source.connect(node);
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    try { this.stream.getTracks().forEach(t => t.stop()); } catch (e) { /* ignore */ }
    try { this.source.disconnect(); this.tap.disconnect(); this.sink.disconnect(); } catch (e) { /* ignore */ }
    this.tap.port.onmessage = null;
    this.stream = this.source = this.tap = this.sink = null;
    this.kind = null;
  }
}

// Decode an audio file (File/Blob) to { channels: [Float32Array...], sampleRate }.
export async function decodeFile(ctx, file) {
  const data = await file.arrayBuffer();
  const buf = await new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(data, resolve, reject);
    if (p && p.then) p.then(resolve, reject);
  });
  const channels = [];
  for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) channels.push(buf.getChannelData(c).slice());
  return { channels, sampleRate: buf.sampleRate };
}

// The last `seconds` of stereo audio, in a ring. Frames are audio-clock
// frames (as stamped by the capture tap).
export class RollingBuffer {
  constructor(sampleRate, seconds) {
    this.sr = sampleRate;
    this.resize(seconds);
  }
  resize(seconds) {
    this.size = Math.round(this.sr * seconds);
    this.data = [new Float32Array(this.size), new Float32Array(this.size)];
    this.clear();
  }
  clear() {
    this.written = 0;   // frames written in total
    this.endFrame = 0;  // audio-clock frame just after the newest sample
  }
  get length() { return Math.min(this.written, this.size); }
  get startFrame() { return this.endFrame - this.length; }

  write(channels, frame) {
    const n = channels[0].length;
    // A gap (the tab was silent and Chrome sent nothing, or a hiccup):
    // fill it with silence so frames stay right.
    if (this.written && frame > this.endFrame) {
      const gap = Math.min(frame - this.endFrame, this.size);
      this.writeRaw([new Float32Array(gap), new Float32Array(gap)], gap);
    } else if (this.written && frame < this.endFrame) {
      // Overlap (shouldn't happen): skip what we already have.
      const skip = this.endFrame - frame;
      if (skip >= n) return;
      channels = channels.map(c => c.subarray(skip));
    }
    this.writeRaw(channels, channels[0].length);
    this.endFrame = frame + n;
  }
  writeRaw(channels, n) {
    for (let c = 0; c < 2; c++) {
      const src = channels[Math.min(c, channels.length - 1)], dst = this.data[c];
      let pos = this.written % this.size, i = 0;
      while (i < n) {
        const k = Math.min(n - i, this.size - pos);
        dst.set(src.subarray(i, i + k), pos);
        i += k; pos = (pos + k) % this.size;
      }
    }
    this.written += n;
  }

  // Copy of the audio between two audio-clock frames (clamped to what is
  // kept): { channels, startFrame }.
  read(from = this.startFrame, to = this.endFrame) {
    from = Math.max(from, this.startFrame);
    to = Math.min(to, this.endFrame);
    const n = Math.max(0, to - from);
    const out = [new Float32Array(n), new Float32Array(n)];
    const first = this.written - (this.endFrame - from); // index in the written stream
    for (let c = 0; c < 2; c++) {
      let pos = ((first % this.size) + this.size) % this.size, i = 0;
      while (i < n) {
        const k = Math.min(n - i, this.size - pos);
        out[c].set(this.data[c].subarray(pos, pos + k), i);
        i += k; pos = (pos + k) % this.size;
      }
    }
    return { channels: out, startFrame: from };
  }
}

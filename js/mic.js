// mic.js — microphone input for timing feedback.
//
// Opens the mic with every voice-call "enhancement" turned off (echo
// cancellation, noise suppression and auto gain all smear or delay drum
// attacks), and runs the onset detector on it:
//   * in an AudioWorklet (audio thread) where available — sample-accurate
//     times on the AudioContext clock;
//   * otherwise in a ScriptProcessor on the main thread (older browsers;
//     still consistent, and the latency calibration absorbs the offset).
// Uses the engine's AudioContext so mic times and beat times share a clock.

import { OnsetDetector } from './onset-worklet.js';

export class MicInput {
  constructor(engine) {
    this.engine = engine;
    this.onOnset = () => {};   // ({ time, peak }) per detected hit
    this.onLevel = () => {};   // (peak 0..1) about 40 times a second
    this.active = false;
    this.sensitivity = 60;
    this.moduleLoaded = false;
  }

  static supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && (window.AudioContext || window.webkitAudioContext));
  }

  async start() {
    if (this.active) return;
    const ctx = this.engine.ensureAudio();
    if (ctx.state !== 'running') await ctx.resume();
    // iOS: allow recording while playing (otherwise opening the mic can
    // pause or reroute playback).
    try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (e) { /* ignore */ }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    this.source = ctx.createMediaStreamSource(this.stream);
    // The detector must be connected to the output to keep running; a
    // silent gain makes sure nothing from the mic is heard.
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    this.sink.connect(ctx.destination);

    if (ctx.audioWorklet && window.AudioWorkletNode) {
      if (!this.moduleLoaded) {
        await ctx.audioWorklet.addModule('js/onset-worklet.js');
        this.moduleLoaded = true;
      }
      this.node = new AudioWorkletNode(ctx, 'onset-detector', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        processorOptions: { sensitivity: this.sensitivity },
      });
      this.node.port.onmessage = e => {
        const d = e.data;
        if (d.type === 'onset') this.onOnset({ time: d.time, peak: d.peak });
        else if (d.type === 'level') this.onLevel(d.value);
      };
    } else {
      const size = 1024;
      this.det = new OnsetDetector({ sampleRate: ctx.sampleRate, sensitivity: this.sensitivity, onOnset: o => this.onOnset(o) });
      this.node = ctx.createScriptProcessor(size, 1, 1);
      this.node.onaudioprocess = e => {
        // Best estimate of when this block was captured, on the audio clock.
        const start = Math.round(e.playbackTime * ctx.sampleRate) - 2 * size;
        this.det.process(e.inputBuffer.getChannelData(0), start);
        this.onLevel(this.det.takeLevel());
      };
    }
    this.source.connect(this.node);
    this.node.connect(this.sink);
    this.active = true;
  }

  setSensitivity(v) {
    this.sensitivity = v;
    if (this.node && this.node.port) this.node.port.postMessage({ type: 'sensitivity', value: v });
    if (this.det) this.det.setSensitivity(v);
  }

  stop() {
    if (!this.active) return;
    this.stream.getTracks().forEach(t => t.stop());
    try { this.source.disconnect(); this.node.disconnect(); this.sink.disconnect(); } catch (e) { /* ignore */ }
    this.node = this.det = this.source = this.sink = this.stream = null;
    this.active = false;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* ignore */ }
  }
}

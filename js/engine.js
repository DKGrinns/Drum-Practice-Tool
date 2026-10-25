// engine.js — owns the AudioContext and runs the lookahead scheduler.
//
// How timing works ("A Tale of Two Clocks" pattern):
//   * A worker timer wakes us every 25 ms. The timer is only a wake-up call;
//     it is never used to time a note.
//   * On each wake-up we ask the Sequencer for every step that starts within
//     the next LOOKAHEAD seconds of the audio clock, and schedule those notes
//     with exact AudioContext timestamps. Web Audio plays them
//     sample-accurately even if the main thread is busy.
//   * Each scheduled step is also queued for the UI, which pops it in
//     requestAnimationFrame when the audio clock reaches it.

import { Sequencer } from './sequencer.js';
import { DrumSynth } from './synth.js';

const TICK_MS = 25;
const LOOKAHEAD = 0.12; // seconds of audio scheduled ahead of the clock

// The wake-up timer runs in a worker so it keeps ticking in background tabs
// (main-thread timers there are throttled to 1/sec).
function createTicker(onTick) {
  try {
    const src = `let on=false;function loop(){if(!on)return;postMessage(0);setTimeout(loop,${TICK_MS});}
      onmessage=e=>{if(e.data==='start'&&!on){on=true;loop();}else if(e.data==='stop'){on=false;}};`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const w = new Worker(url);
    w.onmessage = onTick;
    return { start: () => w.postMessage('start'), stop: () => w.postMessage('stop') };
  } catch (e) {
    // Fallback: main-thread timeout chain.
    let id = null;
    const loop = () => { onTick(); id = setTimeout(loop, TICK_MS); };
    return { start: () => { if (id == null) loop(); }, stop: () => { clearTimeout(id); id = null; } };
  }
}

export class Engine {
  // config: live settings object (see Sequencer).
  // getLevel(voice) -> 0..1: current volume for a voice (0 = muted).
  // extraClick(event) -> boolean: add a beat click on this step (used to put
  //   a click under grooves).
  constructor({ config, getLevel, extraClick }) {
    this.ctx = null;
    this.getLevel = getLevel;
    this.extraClick = extraClick || (() => false);
    this.visualQueue = [];
    this.playing = false;
    this.seq = new Sequencer(config, ev => this.handleStep(ev));
    this.ticker = createTicker(() => this.tick());
    this.masterLevel = 0.9;
  }

  // The AudioContext must be created/resumed inside a user gesture.
  ensureAudio() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    // iOS: play through the silent switch like a music app.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* ignore */ }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.masterLevel;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 6;
    comp.ratio.value = 4;
    comp.attack.value = 0.002;
    comp.release.value = 0.12;
    this.master.connect(comp).connect(this.ctx.destination);
    this.synth = new DrumSynth(this.ctx, this.master);
    return this.ctx;
  }

  setMasterVolume(v) {
    this.masterLevel = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  setSequence(seq, immediate) { this.seq.setSequence(seq, immediate); }

  async start() {
    const ctx = this.ensureAudio();
    if (ctx.state !== 'running') {
      try { await ctx.resume(); } catch (e) { /* ignore */ }
    }
    this.visualQueue = [];
    this.seq.start(ctx.currentTime + 0.08);
    this.playing = true;
    this.tick();
    this.ticker.start();
  }

  stop() {
    this.playing = false;
    this.seq.stop();
    this.ticker.stop();
    this.visualQueue = [];
  }

  tick() {
    if (!this.playing || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.seq.resyncIfLate(now);
    this.seq.scheduleUntil(now + LOOKAHEAD);
  }

  handleStep(ev) {
    if (!ev.muted) {
      for (const h of ev.hits) {
        const level = this.getLevel(h.voice);
        if (level > 0) this.synth.play(h.voice, ev.time, h.velocity * level);
      }
      if (ev.stepInBeat === 0 && this.extraClick(ev)) {
        const voice = ev.beat === 0 ? 'accent' : 'click';
        const level = this.getLevel('grooveClick');
        if (level > 0) this.synth.play(voice, ev.time, 0.9 * level);
      }
    }
    this.visualQueue.push(ev);
  }

  // Steps whose time has been reached (allowing for output latency), for
  // the UI to draw. Call from requestAnimationFrame.
  takeDueVisuals() {
    if (!this.ctx || !this.visualQueue.length) return [];
    const heard = this.ctx.currentTime - (this.ctx.outputLatency || this.ctx.baseLatency || 0);
    let n = 0;
    while (n < this.visualQueue.length && this.visualQueue[n].time <= heard) n++;
    return n ? this.visualQueue.splice(0, n) : [];
  }

  // A short sound for previewing a cell in the builder.
  preview(voice, velocity) {
    const ctx = this.ensureAudio();
    if (ctx.state !== 'running') ctx.resume();
    const level = this.getLevel(voice);
    this.synth.play(voice, ctx.currentTime + 0.01, velocity * (level || 0.8));
  }
}

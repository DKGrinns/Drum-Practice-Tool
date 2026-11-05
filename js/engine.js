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
import { CLICK_VOICES, voiceOffset, humanize } from './feel.js';

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
  // clickFor(event) -> 'accent' | 'click' | null: an extra click on this
  //   step (the click layer under grooves).
  // getFeel() -> feel settings (see feel.js): push/pull, per-drum offsets,
  //   humanize.
  // band(event) -> band notes for this step (see band.js), or null.
  constructor({ config, getLevel, clickFor, getFeel, band }) {
    this.ctx = null;
    this.getLevel = getLevel;
    this.clickFor = clickFor || (() => null);
    this.band = band || (() => null);
    this.getFeel = getFeel || (() => null);
    this.visualQueue = [];
    // Logs for timing feedback: every beat played (the grid to score hits
    // against) and every sound sent to the speakers (to recognise speaker
    // bleed in the mic). Cleared on start, trimmed to recent history.
    this.beatLog = [];
    this.soundLog = [];
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

  // opts.at       audio-clock time of the first beat (e.g. a bar line of the
  //               previous block, for seamless routine changes)
  // opts.delay    seconds from now when `at` isn't given (default 0.08)
  // opts.countIn  bars of count-in clicks before bar 1
  async start(opts = {}) {
    const ctx = this.ensureAudio();
    if (ctx.state !== 'running') {
      try { await ctx.resume(); } catch (e) { /* ignore */ }
    }
    this.visualQueue = [];
    this.beatLog = [];
    this.soundLog = [];
    this.barStop = null;
    const delay = Math.max(0.03, opts.delay || 0.08);
    this.startTime = opts.at != null ? Math.max(opts.at, ctx.currentTime + 0.01) : ctx.currentTime + delay;
    this.seq.start(this.startTime, Date.now(), opts.countIn || 0);
    this.playing = true;
    this.tick();
    this.ticker.start();
  }

  stop() {
    this.playing = false;
    this.barStop = null;
    this.seq.stop();
    this.ticker.stop();
    this.visualQueue = [];
  }

  // Stop at the next bar line (after the count-in) and call cb(barTime)
  // with the audio-clock time of that bar line, so the next thing can start
  // exactly there. Notes before the bar line still play.
  stopAtNextBar(cb) { this.barStop = cb; }

  tick() {
    if (!this.playing || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.seq.resyncIfLate(now);
    this.seq.scheduleUntil(now + LOOKAHEAD);
  }

  handleStep(ev) {
    if (this.barStop && ev.beat === 0 && ev.stepInBeat === 0 && !ev.countIn) {
      const cb = this.barStop;
      this.barStop = null;
      this.playing = false;
      this.seq.stop();
      this.ticker.stop();
      // After the scheduler loop has unwound.
      Promise.resolve().then(() => cb(ev.time));
      return;
    }
    if (ev.countIn) {
      // Count-in clicks only: never moved, never muted by the mixer.
      for (const h of ev.hits) {
        const t = Math.max(ev.time, this.ctx.currentTime + 0.002);
        this.synth.play(h.voice, t, h.velocity * Math.max(0.5, this.getLevel(h.voice)));
        this.logSound(t);
      }
      this.visualQueue.push(ev);
      return;
    }
    if (ev.stepInBeat === 0) {
      this.beatLog.push({ time: ev.time, dur: ev.beatDur, barCount: ev.barCount, beat: ev.beat, beatsPerBar: ev.beatsPerBar, muted: ev.muted });
      if (this.beatLog.length > 6000) this.beatLog.splice(0, 1000);
    }
    if (!ev.muted) {
      const feel = this.getFeel();
      const human = feel && feel.humanize ? feel.humanize / 100 : 0;
      // Never schedule in the past (a negative "pushing" offset on a step
      // that is already close to now).
      const earliest = this.ctx.currentTime + 0.002;
      for (const h of ev.hits) {
        const level = this.getLevel(h.voice);
        if (level <= 0) continue;
        let t = ev.time, vel = h.velocity * level;
        if (!CLICK_VOICES.has(h.voice)) {
          t += voiceOffset(feel, h.voice);
          if (human) { const r = humanize(human); t += r.dt; vel *= r.dv; }
        }
        t = Math.max(t, earliest);
        this.synth.play(h.voice, t, Math.min(1.2, vel));
        this.logSound(t);
      }
      // Backing band (bass + chords) on the same step grid.
      const band = this.band(ev);
      if (band) {
        const stepDur = ev.beatDur / ev.spb;
        for (const n of band) {
          const level = this.getLevel(n.part);
          if (level <= 0) continue;
          const t = Math.max(ev.time + voiceOffset(feel, n.part), earliest);
          const dur = n.steps * stepDur * 0.95;
          if (n.part === 'bass') this.synth.bass(t, n.notes[0], dur, level, n.tone);
          else this.synth.chord(t, n.notes, dur, level * (n.accent ? 1 : 0.85), n.sound);
          this.logSound(t);
        }
      }
      const click = this.clickFor(ev);
      if (click) {
        const level = this.getLevel('grooveClick');
        if (level > 0) { this.synth.play(click, ev.time, 0.9 * level); this.logSound(ev.time); }
      }
    }
    this.visualQueue.push(ev);
  }

  logSound(t) {
    const last = this.soundLog[this.soundLog.length - 1];
    if (last === undefined || Math.abs(last - t) > 0.001) this.soundLog.push(t);
    if (this.soundLog.length > 4000) this.soundLog.splice(0, 1000);
  }

  // Sounds sent to the speakers around time t (for speaker-bleed checks).
  soundsNear(t, window = 0.05) {
    const out = [];
    for (let i = this.soundLog.length - 1; i >= 0; i--) {
      const s = this.soundLog[i];
      if (s < t - window) break;
      if (s <= t + window) out.push(s);
    }
    return out;
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

// sequencer.js — pure timing logic, no Web Audio here.
//
// The engine calls `scheduleUntil(t)` every ~25 ms with t = audio clock time
// plus a lookahead window. The sequencer walks forward through the pattern
// and emits every step whose start time falls before t, each with an exact
// audio-clock timestamp. Because times are computed from the beat start and
// beat length (never accumulated from timer callbacks), there is no drift.
//
// Tempo is read at each beat boundary, so BPM changes take effect on the next
// beat. The tempo trainer and gap (mute) trainer are evaluated at each bar
// boundary.

export const VELOCITY = [0, 0.78, 1.0, 0.28]; // off, hit, accent, ghost

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Swing time-warp inside one swing pair. `pos` is the straight position in
// the pair (0..1). The off-beat (0.5) moves to 0.5 + amount/6, so amount = 1
// lands it at 2/3: a full triplet shuffle. Notes in between are stretched
// proportionally, so 16ths inside a swung 8th pair stay evenly spread.
export function swingWarp(pos, amount) {
  const s = 0.5 + clamp(amount, 0, 1) / 6;
  return pos < 0.5 ? pos * 2 * s : s + (pos - 0.5) * 2 * (1 - s);
}

// Position (in beats, 0..1) of a step inside its beat, after swing.
// Swing applies only to duple grids (2 or 4 steps per beat); triplet grids
// are already "swung" by definition.
//   swingRes 8  -> swing pairs of 8th notes (pair = 1 beat)
//   swingRes 16 -> swing pairs of 16th notes (pair = half a beat)
export function stepOffset(stepInBeat, spb, swing, swingRes) {
  const pos = stepInBeat / spb;
  if (!swing || (spb !== 2 && spb !== 4)) return pos;
  if (swingRes === 16) {
    const half = pos < 0.5 ? 0 : 0.5;
    return half + swingWarp((pos - half) * 2, swing) / 2;
  }
  return swingWarp(pos, swing);
}

// Tempo trainer: BPM for a given bar number (0-based) since start.
// Moves from start toward target by `step` BPM every `every` bars, then holds.
export function trainerBpm(trainer, bar) {
  const { start, target } = trainer;
  const step = Math.abs(trainer.step) || 1;
  const every = Math.max(1, Math.round(trainer.every) || 1);
  const n = Math.floor(bar / every);
  const bpm = target >= start ? Math.min(target, start + n * step) : Math.max(target, start - n * step);
  return clamp(bpm, 30, 300);
}

// Gap trainer: is this bar silent? Plays `play` bars, then mutes `mute` bars.
export function gapMuted(gap, bar) {
  const play = Math.max(1, Math.round(gap.play) || 1);
  const mute = Math.max(0, Math.round(gap.mute) || 0);
  if (!mute) return false;
  return bar % (play + mute) >= play;
}

export class Sequencer {
  // `config` is a live object owned by the app:
  //   { bpm, swing, swingRes, trainer: {enabled,start,target,step,every},
  //     gap: {enabled, play, mute} }
  // `onStep(event)` is called once per step, in time order.
  constructor(config, onStep) {
    this.config = config;
    this.onStep = onStep;
    this.sequence = null;
    this.pending = null;
    this.running = false;
  }

  // Swap pattern. While running, the change waits for the next bar line so
  // the groove never breaks mid-bar.
  setSequence(seq, immediate = false) {
    if (!this.running || immediate || !this.sequence) {
      this.sequence = seq;
      this.pending = null;
      if (this.running) this.patternBar %= seq.bars;
    } else {
      this.pending = seq;
    }
  }

  start(time) {
    this.running = true;
    this.barCount = 0;      // bars since start (drives the trainers)
    this.patternBar = 0;    // bar inside the pattern
    this.beginBar(time);
  }

  stop() { this.running = false; }

  bpmForBar(bar) {
    const c = this.config;
    return c.trainer && c.trainer.enabled ? trainerBpm(c.trainer, bar) : clamp(c.bpm, 30, 300);
  }

  // Current tempo: the trainer owns tempo per bar; otherwise the live BPM.
  currentBpm() {
    return this.config.trainer && this.config.trainer.enabled ? this.barBpm : clamp(this.config.bpm, 30, 300);
  }

  beginBar(time) {
    if (this.pending) {
      this.sequence = this.pending;
      this.pending = null;
      this.patternBar = 0;
    }
    this.barBpm = this.bpmForBar(this.barCount);
    this.barMuted = !!(this.config.gap && this.config.gap.enabled && gapMuted(this.config.gap, this.barCount));
    this.beatInBar = 0;
    this.stepInBeat = 0;
    this.beatStart = time;
    this.beatDur = 60 / this.currentBpm();
    this.lastTime = -Infinity;
  }

  // Exact time of the step we are about to play.
  stepTime() {
    const { spb } = this.sequence;
    const c = this.config;
    const t = this.beatStart + stepOffset(this.stepInBeat, spb, c.swing, c.swingRes) * this.beatDur;
    // Guard against swing being changed mid-beat producing out-of-order times.
    return Math.max(t, this.lastTime);
  }

  // Emit every step that starts before `until`. Returns number emitted.
  scheduleUntil(until) {
    if (!this.running || !this.sequence) return 0;
    let count = 0;
    // Hard cap so a stalled clock can never hang the page.
    while (count < 1000) {
      const t = this.stepTime();
      if (t >= until) break;
      this.emit(t);
      this.lastTime = t;
      this.advance();
      count++;
    }
    return count;
  }

  emit(time) {
    const seq = this.sequence;
    const { spb, beatsPerBar } = seq;
    const stepsPerBar = spb * beatsPerBar;
    const bar = this.patternBar % seq.bars;
    const index = bar * stepsPerBar + this.beatInBar * spb + this.stepInBeat;
    const hits = [];
    for (const voice in seq.tracks) {
      const v = seq.tracks[voice][index];
      if (v) hits.push({ voice, value: v, velocity: VELOCITY[v] });
    }
    this.onStep({
      time,
      hits,
      index,                       // step index inside the pattern
      bar,                         // bar inside the pattern
      barCount: this.barCount,     // bars since start
      beat: this.beatInBar,
      beatsPerBar,
      stepInBeat: this.stepInBeat,
      spb,
      muted: this.barMuted,
      bpm: this.currentBpm(),
    });
  }

  advance() {
    const seq = this.sequence;
    this.stepInBeat++;
    if (this.stepInBeat < seq.spb) return;
    // Next beat.
    this.stepInBeat = 0;
    this.beatStart += this.beatDur;
    this.beatInBar++;
    if (this.beatInBar >= seq.beatsPerBar) {
      this.barCount++;
      this.patternBar = (this.patternBar + 1) % seq.bars;
      this.beginBar(this.beatStart);
    } else {
      this.beatDur = 60 / this.currentBpm();
    }
  }

  // If the audio clock jumped ahead (tab was asleep, device suspended),
  // move the schedule forward instead of firing a burst of late notes.
  resyncIfLate(now, margin = 0.05) {
    if (!this.running) return false;
    if (this.stepTime() < now - 0.2) {
      const shift = now + margin - this.beatStart;
      this.beatStart += shift;
      this.lastTime = -Infinity;
      return true;
    }
    return false;
  }
}

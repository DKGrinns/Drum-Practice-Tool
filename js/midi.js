// midi.js — electronic drum kit input over Web MIDI.
//
// Works in Chrome, Edge, Opera and Android browsers (and Firefox after a
// permission prompt). Safari on iPhone/iPad/Mac has no Web MIDI.
//
// Each note-on becomes a hit { time, note, velocity, voice }, with `time`
// converted to the AudioContext clock *as heard*: getOutputTimestamp()
// tells us which audio-clock time was coming out of the speakers at a given
// performance.now(), so a pad hit lines up with the click you heard — no
// mic-style latency calibration needed (an optional offset covers the kit
// module's own delay).

// General MIDI drum notes, plus common extra notes sent by Roland, Yamaha
// and Alesis kits (rims, edges, bells). Unknown notes count as 'other'.
export const GM_DRUMS = {
  35: 'kick', 36: 'kick',
  37: 'rim', 38: 'snare', 40: 'snare', 39: 'snare',
  42: 'hh', 44: 'hh', 22: 'hh', 46: 'oh', 26: 'oh',
  51: 'ride', 59: 'ride', 53: 'ride', 49: 'ride', 57: 'ride', 52: 'ride', 55: 'ride',
  48: 'tom1', 50: 'tom1', 45: 'tom2', 47: 'tom2', 41: 'tom3', 43: 'tom3', 58: 'tom3',
  56: 'cowbell', 54: 'tamb', 75: 'clave', 76: 'clave', 77: 'clave',
  70: 'shaker', 82: 'shaker', 69: 'shaker',
  62: 'congaH', 63: 'congaH', 64: 'congaL',
  67: 'agogoH', 68: 'agogoL',
};

export function noteToVoice(note, custom = {}) {
  return custom[note] || GM_DRUMS[note] || 'other';
}

// Parse a raw MIDI message. Returns { note, velocity } for a note-on, else
// null (note-on with velocity 0 is a note-off).
export function parseNoteOn(data) {
  if (!data || data.length < 3) return null;
  const status = data[0] & 0xf0;
  if (status !== 0x90 || data[2] === 0) return null;
  return { note: data[1], velocity: data[2] };
}

// Convert an event timestamp (performance.now() ms) to AudioContext time as
// heard. `stamp` = ctx.getOutputTimestamp() taken near the event.
export function perfToContextTime(eventMs, stamp) {
  return stamp.contextTime + (eventMs - stamp.performanceTime) / 1000;
}

export class MidiInput {
  constructor(engine) {
    this.engine = engine;
    this.onHit = () => {};
    this.onDevices = () => {};
    this.access = null;
    this.custom = {};       // note -> voice overrides (from "learn")
    this.offsetMs = 0;      // extra delay of the drum module, if any
  }

  static supported() { return typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess; }

  async start() {
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    const attach = () => {
      for (const input of this.access.inputs.values()) input.onmidimessage = e => this.handle(e);
      this.onDevices([...this.access.inputs.values()].map(i => i.name || 'MIDI device'));
    };
    this.access.onstatechange = attach;
    attach();
  }

  stop() {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) input.onmidimessage = null;
    this.access.onstatechange = null;
    this.access = null;
  }

  get active() { return !!this.access; }

  // Audio-clock time (as heard) for an event timestamp.
  contextTime(eventMs) {
    const ctx = this.engine.ensureAudio();
    let t;
    if (ctx.getOutputTimestamp) {
      const stamp = ctx.getOutputTimestamp();
      t = stamp.performanceTime ? perfToContextTime(eventMs, stamp) : null;
    }
    if (t == null) t = ctx.currentTime - (performance.now() - eventMs) / 1000 - (ctx.outputLatency || ctx.baseLatency || 0);
    return t - this.offsetMs / 1000;
  }

  handle(e) {
    const n = parseNoteOn(e.data);
    if (!n) return;
    const ms = e.timeStamp || performance.now();
    this.onHit({ time: this.contextTime(ms), note: n.note, velocity: n.velocity, voice: noteToVoice(n.note, this.custom) });
  }
}

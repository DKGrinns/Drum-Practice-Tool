// countin.js — spoken count-in ("one, two, three, four") with
// speechSynthesis, on top of the count-in clicks the engine plays.
//
// The clicks are scheduled on the audio clock and are always exact. Speech
// can't be scheduled on the audio clock, so each word is started early by
// the voice's measured start-up delay ("lead"), learned from the
// utterance's start event and saved per device. If the browser has no
// speech voices, the clicks alone count you in.

import * as store from '../storage.js';
import { S, engine } from './core.js';
import { countInWords } from '../practice.js';

const synth = () => (typeof window !== 'undefined' && window.speechSynthesis) || null;

let voices = [];
function loadVoices() {
  const s = synth();
  if (!s) return;
  try { voices = s.getVoices() || []; } catch (e) { voices = []; }
}
loadVoices();
if (synth() && 'onvoiceschanged' in synth()) synth().addEventListener('voiceschanged', loadVoices);

// An English voice, preferring local (offline, quicker to start) ones.
function pickVoice() {
  loadVoices();
  const en = voices.filter(v => /^en/i.test(v.lang));
  const pool = en.length ? en : voices;
  return pool.find(v => v.localService && v.default) || pool.find(v => v.localService) || pool[0] || null;
}

export const speechAvailable = () => !!synth() && typeof window.SpeechSynthesisUtterance === 'function';

// Seconds a voice takes from speak() to sound. Learned as we go.
let lead = Number(store.load('speechLead', 0.15));
if (!Number.isFinite(lead)) lead = 0.15;
export const speechLead = () => lead;
function learn(lag) {
  if (!(lag >= 0 && lag < 1)) return;
  lead = Math.min(0.5, Math.max(0.02, lead * 0.6 + lag * 0.4));
  store.save('speechLead', Math.round(lead * 1000) / 1000);
}

let timers = [];
let utterances = []; // kept referenced: Chrome can drop unreferenced utterances mid-speech
export function cancelSpeech() {
  timers.forEach(clearTimeout);
  timers = [];
  utterances = [];
  try { if (synth()) synth().cancel(); } catch (e) { /* ignore */ }
}

// Does PLAY speak the count-in? (Needs the setting and a voice.)
export const speaking = () => S.countIn.enabled && S.countIn.voice === 'speech' && speechAvailable();

// Extra start delay so the first word can be started early enough.
export const startDelay = () => (speaking() ? Math.min(0.6, lead + 0.12) : 0.08);

// Audio-clock time -> performance.now() time at which it is heard.
function heardAt(t) {
  const ctx = engine.ctx;
  try {
    const ts = ctx.getOutputTimestamp && ctx.getOutputTimestamp();
    if (ts && ts.performanceTime > 0) return ts.performanceTime + (t - ts.contextTime) * 1000;
  } catch (e) { /* fall through */ }
  return performance.now() + (t - ctx.currentTime + (ctx.outputLatency || ctx.baseLatency || 0)) * 1000;
}

// Schedule the words for a count-in that starts at audio time `start`.
// Returns the planned words with their audio times (used by the tests).
export function speakCountIn({ start, bars, beatsPerBar, beatDur }) {
  cancelSpeech();
  if (!speaking() || !bars) return [];
  const words = countInWords(beatsPerBar, bars, beatDur);
  const voice = pickVoice();
  const rate = beatDur < 0.4 ? 1.5 : beatDur < 0.6 ? 1.25 : 1.05;
  const plan = [];
  words.forEach((word, i) => {
    if (!word) return;
    const t = start + i * beatDur;
    plan.push({ word, time: t });
    const wait = heardAt(t) - lead * 1000 - performance.now();
    if (wait < -60) return; // too late to be useful; the click is there
    timers.push(setTimeout(() => {
      const u = new window.SpeechSynthesisUtterance(word);
      if (voice) u.voice = voice;
      u.lang = voice ? voice.lang : 'en-US';
      u.rate = rate;
      u.volume = 1;
      const asked = performance.now();
      // Learn the delay only when nothing was queued ahead of this word.
      const idle = !synth().speaking && !synth().pending;
      u.onstart = () => { if (idle) learn((performance.now() - asked) / 1000); };
      utterances.push(u);
      try { synth().speak(u); } catch (e) { /* ignore */ }
    }, Math.max(0, wait)));
  });
  return plan;
}

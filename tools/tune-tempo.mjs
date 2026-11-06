// Re-tunes the tempo-score weights (W in js/tempo.js) on the synthetic feels
// in tests/groove-audio.js, 3 takes each (clean and noisy).
//   node tools/tune-tempo.mjs        score the current weights
//   node tools/tune-tempo.mjs tune   grid search (several minutes)
// Copy the best line into W in js/tempo.js, then run npm test.
import { renderGroove, addNoise } from '../tests/groove-audio.js';
import { analyzeClip, clipEnvelope, W } from '../js/tempo.js';
import { FEELS as SET } from '../tests/groove-audio.js';
const cases = [];
for (const [name, c] of Object.entries(SET)) for (const [seed, noise, jit] of [[7, 0, 0.004], [11, 0.04, 0.007], [99, 0.03, 0.005]]) {
  const r = renderGroove({ bars: 8, seed, jitter: jit, ...c.g });
  if (noise) addNoise(r.buf, noise, seed);
  cases.push({ name: name + (noise ? '+n' : ''), c, r, env: clipEnvelope([r.buf], r.sr) });
}
function evaluate(verbose, mode = 'both') {
  let total = 0;
  for (const k of cases) {
    const a = analyzeClip(null, k.r.sr, { envelope: k.env });
    const close = (x, y) => Math.abs(x / y - 1) < 0.02;
    let ts = k.c.pref.some(p => close(a.bpm, p)) ? 1 : k.c.ok.some(p => close(a.bpm, p)) ? 0.5 : 0;
    // phase: true grid at the detected tempo
    const beat = 60 / k.c.g.bpm;
    const ratio = Math.round(a.bpm / k.c.g.bpm * 6) / 6;
    let ps = 0;
    if (ts && mode !== 'tempo') {
      const per = ratio < 1 ? beat : beat / ratio;
      const lead = 0.37;
      const errs = a.beats.map(b => { const x = (b - lead) / per; return Math.abs(x - Math.round(x)) * per * 1000; });
      const good = errs.filter(e => e < 25).length / errs.length;
      ps = good > 0.85 ? 1 : 0;
      if (verbose) k.errs = errs.slice().sort((x, y) => x - y)[errs.length >> 1].toFixed(1);
    }
    total += ts + ps;
    if (verbose) console.log(k.name.padEnd(18), a.bpm.toFixed(2).padStart(7), 'conf', a.confidence.toFixed(2), 'T', ts, 'P', ps, 'med', k.errs || '-', 'swing', a.swing.ratio.toFixed(2), 'down', a.downbeat, a.downbeatConfidence);
  }
  return total;
}
if (process.argv[2] === 'tune') {
  let best = -1, bw = null;
  for (const bands of [false, true]) for (const bandW of (bands ? [0.5, 1] : [0])) for (const b2 of [0.2, 0.4]) for (const b4 of [0.15, 0.3]) for (const sub of [0.2, 0.4]) for (const width of [0.8, 1.1]) for (const center of [95, 110]) {
    Object.assign(W, { bands, bandW, b2, b4, sub, width, center });
    const sc = evaluate(false, 'tempo');
    if (sc > best) { best = sc; bw = { ...W }; console.log(sc, JSON.stringify(bw)); }
  }
  Object.assign(W, bw); best = -1;
  for (const pLow of [0, 0.3]) for (const pMid of [0.3, 0.6, 1]) {
    Object.assign(W, { pLow, pMid });
    const sc = evaluate(false);
    if (sc > best) { best = sc; bw = { ...W }; console.log(sc, JSON.stringify(bw)); }
  }
  Object.assign(W, bw);
}
console.log('score', evaluate(true), 'of', cases.length * 2, JSON.stringify(W));

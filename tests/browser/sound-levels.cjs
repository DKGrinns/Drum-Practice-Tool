const { chromium } = require('playwright');
const { startServer, OUT } = require('./helpers.cjs');
(async () => {
  const srv = await startServer(); const BASE = srv.url;
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto(BASE);
  const r = await p.evaluate(async () => {
    const { DrumSynth } = await import('./js/synth.js');
    const out = {};
    for (const v of ['kick','snare','rim','hh','oh','ride','accent','click','sub']) {
      const ctx = new OfflineAudioContext(1, 44100 * 1.2, 44100);
      const s = new DrumSynth(ctx, ctx.destination);
      s.play(v, 0.01, 1.0);
      const buf = await ctx.startRendering();
      const d = buf.getChannelData(0); let pk = 0, rms = 0;
      for (const x of d) { pk = Math.max(pk, Math.abs(x)); rms += x * x; }
      out[v] = { peak: +pk.toFixed(2), rms: +Math.sqrt(rms / d.length).toFixed(3) };
    }
    // choke: open hat then closed hat 0.1s later -> energy after 0.2s should be tiny
    const ctx = new OfflineAudioContext(1, 44100, 44100); const s = new DrumSynth(ctx, ctx.destination);
    s.play('oh', 0.0, 1); s.play('hh', 0.1, 1);
    const d = (await ctx.startRendering()).getChannelData(0);
    let tail = 0; for (let i = 44100 * 0.2; i < 44100 * 0.4; i++) tail = Math.max(tail, Math.abs(d[i]));
    out.chokeTail = +tail.toFixed(4);
    return out;
  });
  console.log(JSON.stringify(r, null, 0)); await b.close(); srv.close();
})();

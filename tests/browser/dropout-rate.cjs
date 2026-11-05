const { chromium } = require('playwright');
const { startServer, OUT } = require('./helpers.cjs');
(async () => {
  const srv = await startServer(); const BASE = srv.url;
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const p = await b.newPage();
  await p.addInitScript(() => { if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', 1); localStorage.clear(); } });
  await p.goto(BASE);
  await p.evaluate(() => import('./js/ui/core.js').then(({ S }) => { S.bpm = 300; S.dropout.enabled = true; S.dropout.amount = 50; S.dropout.keepOne = true; }));
  await p.click('#playBtn');
  await p.evaluate(() => import('./js/ui/core.js').then(({ engine }) => {
    window.__h = []; const o = engine.synth.play.bind(engine.synth);
    engine.synth.play = (v, t, x) => { window.__h.push(v); return o(v, t, x); };
  }));
  await p.waitForTimeout(16000);
  const h = await p.evaluate(() => window.__h);
  const a = h.filter(v => v === 'accent').length, c = h.filter(v => v === 'click').length;
  console.log('bars', a, 'non-downbeat clicks kept', c, 'of', a * 3, '=', (100 * c / (a * 3)).toFixed(0) + '%');
  await b.close(); srv.close();
})();

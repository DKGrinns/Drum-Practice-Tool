const { chromium } = require('playwright');
const { startServer, OUT } = require('./helpers.cjs');
const SP = OUT;
(async () => {
  const srv = await startServer(); const BASE = srv.url;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  // Simulate a user upgrading from v1: old settings without new mixer keys,
  // written before any app code runs.
  await page.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1');
    localStorage.clear(); localStorage.setItem('grooveTrainer.settings', JSON.stringify({
    bpm: 133, tab: 'builder', source: 'builder', mix: { kick: { vol: 0.3, mute: true } } })); } });
  await page.goto(BASE);
  console.log('tabs', await page.$$eval('#tabs button', b => b.map(x => x.textContent)));
  console.log('upgrade: bpm', await page.textContent('#bpmValue'), 'kick muted', await page.evaluate(() =>
    document.querySelector('#panel-builder .mix-row[data-voice="kick"] .mute').getAttribute('aria-pressed')),
    'conga row exists', await page.evaluate(() => !!document.querySelector('.mix-row[data-voice="congaH"]')));
  const rows = () => page.evaluate(() => [...new Set([...document.querySelectorAll('.grid-label')].map(l => l.textContent))]);
  console.log('default rows', await rows());
  await page.click('#allDrums');
  console.log('all drums rows', (await rows()).length, await rows());
  await page.click('.cell[data-voice="clave"][data-i="0"]');
  await page.click('.cell[data-voice="clave"][data-i="6"]');
  await page.click('#allDrums'); // off again: clave stays because it's used
  console.log('rows after using clave', await rows());
  await page.screenshot({ path: SP + '/step1-builder.png', fullPage: true });
  // Play pattern with clave and check no errors while playing.
  await page.click('#playBtn'); await page.waitForTimeout(1500); await page.click('#playBtn');
  // Tab navigation still sets the source
  await page.click('#tabs button[data-tab="grooves"]');
  console.log('source dot on', await page.$eval('#tabs button.source', b => b.dataset.tab));
  // Synth levels for the new voices
  const levels = await page.evaluate(async () => {
    const { DrumSynth } = await import('./js/synth.js');
    const out = {};
    for (const v of ['tom1','tom2','tom3','cowbell','agogoH','agogoL','clave','shaker','tamb','congaH','congaL','kick']) {
      const c = new OfflineAudioContext(1, 44100, 44100);
      new DrumSynth(c, c.destination).play(v, 0.01, 1);
      const d = (await c.startRendering()).getChannelData(0);
      let pk = 0; for (const x of d) pk = Math.max(pk, Math.abs(x));
      out[v] = +pk.toFixed(2);
    }
    return out;
  });
  console.log('peaks', JSON.stringify(levels));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.click('#tabs button[data-tab="builder"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: SP + '/step1-desktop.png' });
  console.log('ERRORS', errors);
  await browser.close(); srv.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });

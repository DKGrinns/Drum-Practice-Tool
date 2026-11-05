const { chromium } = require('playwright');
const { startServer, OUT } = require('./helpers.cjs');
const SP = OUT;
(async () => {
  const srv = await startServer(); const BASE = srv.url;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => { if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', 1); localStorage.clear(); } });
  await page.goto(BASE);
  console.log('tabs', await page.$$eval('#tabs button', b => b.map(x => x.textContent).join(', ')));

  // Capture every scheduled sound: [voice, time]
  const capture = async (ms) => {
    await page.evaluate(() => {
      window.__hits = [];
      import('./js/ui/core.js').then(({ engine }) => {
        const orig = engine.synth.play.bind(engine.synth);
        if (!engine.synth.__wrapped) {
          engine.synth.play = (v, t, vel) => { window.__hits && window.__hits.push([v, t, vel]); return orig(v, t, vel); };
          engine.synth.__wrapped = true;
        }
      });
    });
    await page.waitForTimeout(ms);
    return page.evaluate(() => window.__hits);
  };

  // 1) Metronome with "2 & 4" click mode, 120 bpm
  await page.click('#bpmDown'); // ensure audio + engine exists after play
  await page.click('#tabs button[data-tab="feel"]');
  await page.click('#clickModeSeg button[data-value="backbeat"]');
  console.log('status', await page.textContent('#statusLine'));
  await page.click('#tabs button[data-tab="metronome"]');
  await page.evaluate(() => import('./js/ui/core.js').then(({ S }) => { S.bpm = 120; }));
  await page.click('#playBtn');
  await page.waitForTimeout(300);
  let hits = await capture(2600);
  const ct = hits.map(h => h[1]);
  console.log('2&4 clicks', hits.length, 'voices', [...new Set(hits.map(h => h[0]))], 'gaps', ct.slice(1).map((t, i) => (t - ct[i]).toFixed(3)).join(' '));
  await page.click('#playBtn');

  // 2) Groove with click under it + push/pull: kick laid back 20 ms + snare +15
  await page.click('#tabs button[data-tab="feel"]');
  await page.click('#clickModeSeg button[data-value="all"]');
  await page.click('#grooveClickToggle');
  await page.$eval('#feelOffset', el => { el.value = 20; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('.drum-offsets summary');
  await page.$eval('[data-drum="snare"]', el => { el.value = 15; el.dispatchEvent(new Event('input', { bubbles: true })); });
  console.log('offset label', await page.textContent('#feelOffsetVal'), '| snare', await page.textContent('[data-out="snare"]'));
  await page.click('#tabs button[data-tab="grooves"]');
  await page.click('.groove[data-id="soul-backbeat"]'); // kick on 1, snare 2 & 4, click on every beat
  await page.evaluate(() => import('./js/ui/core.js').then(({ S }) => { S.bpm = 100; }));
  await page.click('#playBtn');
  await page.waitForTimeout(300);
  hits = await capture(3000);
  await page.click('#playBtn');
  const clicks = hits.filter(h => h[0] === 'accent' || h[0] === 'click').map(h => h[1]);
  const kicks = hits.filter(h => h[0] === 'kick').map(h => h[1]);
  const snares = hits.filter(h => h[0] === 'snare').map(h => h[1]);
  const nearest = t => clicks.reduce((b, c) => (Math.abs(c - t) < Math.abs(b - t) ? c : b), Infinity);
  const ms = arr => arr.map(t => Math.round((t - nearest(t)) * 1000));
  console.log('kick offsets vs click (ms)', ms(kicks).filter(x => Math.abs(x) < 100).join(' '));
  console.log('snare offsets vs click (ms)', ms(snares).filter(x => Math.abs(x) < 100).join(' '));

  // 3) Humanize 100%: kicks vary a bit around +20
  await page.click('#tabs button[data-tab="feel"]');
  await page.$eval('#humanize', el => { el.value = 100; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#playBtn'); await page.waitForTimeout(300);
  hits = await capture(4000);
  await page.click('#playBtn');
  const kc = hits.filter(h => h[0] === 'kick').map(h => h[1]);
  const clicks2 = hits.filter(h => h[0] === 'accent' || h[0] === 'click').map(h => h[1]);
  const near2 = t => clicks2.reduce((b, c) => (Math.abs(c - t) < Math.abs(b - t) ? c : b), Infinity);
  const hk = kc.map(t => Math.round((t - near2(t)) * 1000)).filter(x => Math.abs(x) < 100);
  const vels = hits.filter(h => h[0] === 'hh').map(h => h[2].toFixed(2));
  console.log('humanized kick offsets', hk.join(' '), '| hh velocities', [...new Set(vels)].length, 'distinct');
  // reset feel
  await page.click('#feelPresets button[data-preset="On the grid"]');
  await page.$eval('#humanize', el => { el.value = 0; el.dispatchEvent(new Event('input', { bubbles: true })); });

  // 4) Dropout 50% on metronome, keep beat 1
  await page.click('#dropToggle');
  await page.$eval('#dropAmount', el => { el.value = 50; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#tabs button[data-tab="metronome"]');
  await page.evaluate(() => import('./js/ui/core.js').then(({ S }) => { S.bpm = 240; }));
  await page.click('#playBtn'); await page.waitForTimeout(300);
  hits = await capture(6000);
  console.log('status while playing', await page.textContent('#statusLine'));
  await page.click('#playBtn');
  const accents = hits.filter(h => h[0] === 'accent').length, others = hits.filter(h => h[0] === 'click').length;
  console.log(`dropout: beat-1 accents ${accents}, other clicks ${others} (≈${(accents * 3)} expected without dropout → ~50% kept)`);
  await page.click('#tabs button[data-tab="feel"]');
  await page.click('#dropProgressive');
  console.log('progressive opts visible', await page.isVisible('#dropProgressiveOpts'), '| sparse row hidden', !(await page.isVisible('#sparseRow')));
  await page.screenshot({ path: SP + '/step3-feel.png', fullPage: true });
  console.log('ERRORS', errors);
  await browser.close(); srv.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });

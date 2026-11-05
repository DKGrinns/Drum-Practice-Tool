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
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', 1); localStorage.clear(); }
    // Virtual microphone: a MediaStream built inside the app's AudioContext.
    navigator.mediaDevices.getUserMedia = async () => {
      const { engine } = await import('./js/ui/core.js');
      const { DrumSynth } = await import('./js/synth.js');
      const ac = engine.ctx;
      const micBus = ac.createGain();
      const delay = ac.createDelay(1); delay.delayTime.value = 0.08;          // simulated device latency
      const dest = ac.createMediaStreamDestination();
      micBus.connect(delay).connect(dest);
      const bleed = ac.createGain(); bleed.gain.value = 0.04;               // quiet speaker bleed
      engine.master.connect(bleed).connect(micBus);
      const noise = ac.createBufferSource(); const nb = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.002;
      noise.buffer = nb; noise.loop = true; noise.connect(micBus); noise.start(); // room noise
      const drummer = new DrumSynth(ac, micBus);
      window.__drummer = { play: (t, v = 0.9) => drummer.play('snare', t, v) };
      return dest.stream;
    };
  });
  await page.goto(BASE);
  console.log('tabs', await page.$$eval('#tabs button', b => b.map(x => x.textContent).join(', ')));
  await page.click('#tabs button[data-tab="feedback"]');
  await page.click('#micToggle');
  await page.waitForTimeout(800);
  console.log('mic on', await page.textContent('#micToggle'), '| msg', await page.textContent('#micMsg'));

  // Speaker test (the app hears its own clicks through the bleed path)
  await page.click('#speakerTest');
  await page.waitForTimeout(7500);
  console.log('speaker test:', await page.textContent('#micMsg'), '|', await page.textContent('#calibStatus'));

  // Virtual drummer: plays every 8th note, beats 15 ms late, "&"s 5 ms early.
  await page.evaluate(() => {
    window.__drumLoop = setInterval(async () => {
      const { engine } = await import('./js/ui/core.js');
      window.__done = window.__done || new Set();
      for (const b of engine.beatLog) {
        if (window.__done.has(b.time) || b.time < engine.ctx.currentTime + 0.03) continue;
        window.__done.add(b.time);
        window.__drummer.play(b.time + 0.015, 0.9);                 // on the beat, 15 ms late
        window.__drummer.play(b.time + b.dur / 2 - 0.005, 0.5);     // the "&", 5 ms early
      }
    }, 20);
  });
  await page.click('#fbRes button[data-value="2"]'); // score against 8ths
  await page.evaluate(() => import('./js/ui/core.js').then(({ S }) => { S.bpm = 100; }));
  await page.click('#playBtn');
  await page.waitForTimeout(12000);
  console.log('live last:', await page.textContent('#fbLast'));
  await page.click('#playBtn');
  await page.waitForTimeout(300);
  console.log('stats:', (await page.$$eval('.fb-stat', s => s.map(x => x.textContent.replace(/\s+/g, ' ').trim()))).join(' | '));
  console.log('report:', await page.textContent('.fb-summary'));
  console.log('positions:', (await page.$$eval('.fb-pos', p => p.map(x => x.textContent.replace(/\s+/g, '')))).join(' '));
  await page.screenshot({ path: SP + '/step4-feedback.png', fullPage: true });

  // Same take scored against 16ths with a swung groove must not break
  await page.click('#fbReset');
  await page.click('#fbRes button[data-value="4"]');
  await page.click('#tabs button[data-tab="grooves"]');
  await page.click('.groove[data-id="funk-16-ghost"]');
  await page.click('#playBtn'); await page.waitForTimeout(5000); await page.click('#playBtn');
  await page.click('#tabs button[data-tab="feedback"]');
  console.log('groove take:', await page.textContent('.fb-summary'));
  console.log('ERRORS', errors);
  await browser.close(); srv.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });

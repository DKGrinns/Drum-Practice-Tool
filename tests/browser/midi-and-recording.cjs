const { chromium } = require('playwright');
const { startServer, OUT } = require('./helpers.cjs');
const SP = OUT;
(async () => {
  const srv = await startServer(); const BASE = srv.url;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', 1); localStorage.clear(); }
    // Virtual e-kit over Web MIDI
    const input = { name: 'Virtual E-Kit', onmidimessage: null };
    window.__kit = input;
    navigator.requestMIDIAccess = async () => ({ inputs: new Map([['1', input]]), onstatechange: null });
    // Virtual mic (as in step 4) for recording
    navigator.mediaDevices.getUserMedia = async () => {
      const { engine } = await import('./js/ui/core.js'); const { DrumSynth } = await import('./js/synth.js');
      const ac = engine.ctx; const micBus = ac.createGain(); const delay = ac.createDelay(1); delay.delayTime.value = 0.08;
      const dest = ac.createMediaStreamDestination(); micBus.connect(delay).connect(dest);
      const bleed = ac.createGain(); bleed.gain.value = 0.04; engine.master.connect(bleed).connect(micBus);
      const drummer = new DrumSynth(ac, micBus); window.__drummer = { play: (t, v = 0.9) => drummer.play('snare', t, v) };
      return dest.stream;
    };
    // Log buffer playback starts (for checking take alignment)
    const orig = AudioBufferSourceNode.prototype.start;
    window.__starts = [];
    AudioBufferSourceNode.prototype.start = function (when, offset) {
      if (this.buffer && this.buffer.duration > 2) window.__starts.push({ when, offset: offset || 0, now: this.context.currentTime });
      return orig.apply(this, arguments);
    };
  });
  await page.goto(BASE);
  await page.click('#tabs button[data-tab="feedback"]');
  await page.click('#fbInput button[data-value="midi"]');
  console.log('cards: midi visible', await page.isVisible('#midiCard'), '| mic card hidden', !(await page.isVisible('#micCard')));
  await page.click('#midiToggle');
  await page.waitForTimeout(300);
  console.log('midi:', await page.textContent('#midiMsg'));

  // Learn: map note 99 to cowbell
  await page.click('#midiCard .drum-offsets summary');
  await page.selectOption('#learnVoice', 'cowbell');
  await page.click('#learnBtn');
  await page.evaluate(() => window.__kit.onmidimessage({ data: [0x99, 99, 100], timeStamp: performance.now() }));
  console.log('learn:', await page.textContent('#learnMsg'));

  // Virtual drummer on the e-kit: kick 1/3 +4 ms, snare 2/4 +18 ms, ghost snares on &s -6 ms
  await page.evaluate(() => {
    window.__pending = [];
    setInterval(async () => {
      const { engine } = await import('./js/ui/core.js');
      if (!engine.ctx) return;
      window.__seen = window.__seen || new Set();
      for (const b of engine.beatLog) {
        if (window.__seen.has(b.time)) continue;
        window.__seen.add(b.time);
        const add = (t, note, vel) => window.__pending.push({ t, note, vel });
        if (b.beat % 2 === 0) add(b.time + 0.004, 36, 110); else add(b.time + 0.018, 38, 115 + (b.beat % 2));
        add(b.time + b.dur / 2 - 0.006, 38, 30 + (Math.round(b.time * 10) % 3) * 2);
      }
      // Send each hit when its moment arrives, with a timestamp converted from the audio clock.
      const st = engine.ctx.getOutputTimestamp ? engine.ctx.getOutputTimestamp() : null;
      const heard = engine.ctx.currentTime - (engine.ctx.outputLatency || engine.ctx.baseLatency || 0);
      window.__pending = window.__pending.filter(p => {
        if (p.t > heard) return true;
        const ms = st && st.performanceTime ? st.performanceTime + (p.t - st.contextTime) * 1000
          : performance.now() - (heard - p.t) * 1000;
        window.__kit.onmidimessage({ data: [0x99, p.note, p.vel], timeStamp: ms });
        return false;
      });
    }, 5);
  });
  await page.evaluate(() => import('./js/ui/core.js').then(({ S }) => { S.bpm = 100; }));
  await page.click('#fbRes button[data-value="2"]');
  await page.click('#playBtn');
  await page.waitForTimeout(10000);
  await page.click('#playBtn');
  await page.waitForTimeout(300);
  console.log('MIDI report:', await page.textContent('.fb-summary'));
  console.log('by drum:', (await page.$$eval('.voice-table tbody tr', r => r.map(x => x.textContent.replace(/\s+/g, ' ')))).join(' | '));
  console.log('dynamics:', await page.$$eval('.fb-summary', p => p[1] ? p[1].textContent : '(none)'));
  console.log('positions:', (await page.$$eval('.fb-pos', p => p.map(x => x.textContent.replace(/\s+/g, '')))).join(' '));
  console.log('history rows:', await page.$$eval('.h-row', r => r.length));

  // Recording with the mic
  await page.click('#fbInput button[data-value="mic"]');
  await page.click('#micToggle'); await page.waitForTimeout(700);
  await page.click('#speakerTest'); await page.waitForTimeout(7500);
  await page.click('#recToggle');
  await page.evaluate(() => {
    setInterval(async () => {
      const { engine } = await import('./js/ui/core.js');
      window.__done = window.__done || new Set();
      for (const b of engine.beatLog) {
        if (window.__done.has(b.time) || b.time < engine.ctx.currentTime + 0.03) continue;
        window.__done.add(b.time);
        window.__drummer.play(b.time + 0.012, 0.9);
      }
    }, 20);
  });
  await page.click('#playBtn'); await page.waitForTimeout(6000); await page.click('#playBtn');
  await page.waitForTimeout(400);
  console.log('takes:', await page.$$eval('.take', t => t.map(x => x.textContent.replace(/\s+/g, ' ').trim())));
  const takeInfo = await page.evaluate(() => import('./js/ui/core.js').then(({ engine }) => ({ first: engine.beatLog[0] && engine.beatLog[0].time })));
  await page.click('.take button[data-act="groove"]');
  await page.waitForTimeout(800);
  const res = await page.evaluate(() => import('./js/ui/core.js').then(({ engine }) => ({ starts: window.__starts, newFirst: engine.beatLog[0].time, playing: engine.playing })));
  console.log('replay over groove: playing', res.playing, 'start', JSON.stringify(res.starts[res.starts.length - 1]), 'new first beat', res.newFirst.toFixed(3), '(take first beat was', takeInfo.first.toFixed(3) + ')');
  await page.waitForTimeout(1500);
  console.log('replay: take highlighted', await page.$$eval('.take.playing', t => t.length));
  await page.click('#playBtn');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.take button[data-act="wav"]')]);
  await dl.saveAs(SP + '/take.wav');
  console.log('wav', dl.suggestedFilename(), require('fs').statSync(SP + '/take.wav').size, 'bytes');
  await page.screenshot({ path: SP + '/step5.png', fullPage: true });
  console.log('ERRORS', errors);
  await browser.close(); srv.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });

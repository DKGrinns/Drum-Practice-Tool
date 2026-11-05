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
  const capture = async ms => {
    await page.evaluate(() => import('./js/ui/core.js').then(({ engine }) => {
      window.__band = [];
      if (!engine.synth.__bandWrapped) {
        const b = engine.synth.bass.bind(engine.synth), c = engine.synth.chord.bind(engine.synth);
        engine.synth.bass = (t, m, d, v, tone) => { window.__band.push({ part: 'bass', t, notes: [m], d, tone }); return b(t, m, d, v, tone); };
        engine.synth.chord = (t, n, d, v, s) => { window.__band.push({ part: 'keys', t, notes: n, d, s }); return c(t, n, d, v, s); };
        engine.synth.__bandWrapped = true;
      }
    }));
    await page.waitForTimeout(ms);
    return page.evaluate(() => ({ band: window.__band, beats: window.__beats || [] }));
  };
  // Band on, key A, one drop
  await page.click('#tabs button[data-tab="band"]');
  await page.click('#bandToggle');
  console.log('band style label:', await page.$eval('#bandStyle', s => s.options[s.selectedIndex].textContent));
  await page.click('#tabs button[data-tab="grooves"]');
  await page.click('.groove[data-id="one-drop"]');
  await page.click('#playBtn');
  await page.waitForTimeout(200);
  const r = await capture(7000);
  const info = await page.evaluate(() => import('./js/ui/core.js').then(({ engine }) => engine.beatLog.map(b => ({ t: b.time, bar: b.barCount, beat: b.beat }))));
  console.log('chord readout:', await page.textContent('#chordNow'));
  await page.click('#playBtn');
  const name = m => ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'][m % 12];
  const nearestBeat = t => info.reduce((b, x) => (Math.abs(x.t - t) < Math.abs(b.t - t) ? x : b));
  const keys = r.band.filter(x => x.part === 'keys').slice(0, 4).map(x => { const b = nearestBeat(x.t); return `bar${b.bar + 1} beat${b.beat + 1} ${name(x.notes[0])} (${x.s}, ${((x.t - b.t) * 1000).toFixed(1)}ms)`; });
  console.log('skanks:', keys.join(' | '));
  const bass = r.band.filter(x => x.part === 'bass').slice(0, 4).map(x => `${name(x.notes[0])}${x.notes[0]} ${x.d.toFixed(2)}s ${x.tone}`);
  console.log('bass:', bass.join(' | '));

  // Key change to E + progression ii-V-I + jazz swing
  await page.click('#tabs button[data-tab="band"]');
  await page.click('#bandKey button[data-value="C"]');
  await page.selectOption('#bandProgression', 'ii7 V7 Imaj7 Imaj7');
  console.log('band panel chord:', await page.textContent('#bandChord'));
  await page.click('#tabs button[data-tab="grooves"]');
  await page.click('.groove[data-id="swing-medium"]');
  await page.click('#playBtn'); await page.waitForTimeout(200);
  const j = await capture(6000);
  await page.click('#playBtn');
  console.log('jazz bass walk:', j.band.filter(x => x.part === 'bass').slice(0, 8).map(x => name(x.notes[0])).join(' '));
  console.log('jazz comp chords:', [...new Set(j.band.filter(x => x.part === 'keys').map(x => x.notes.map(name).join('-')))].join(' | '));

  // Custom progression + gap trainer: no band notes in silent bars
  await page.click('#tabs button[data-tab="band"]');
  await page.selectOption('#bandProgression', 'custom');
  await page.fill('#bandCustom', 'I IV');
  await page.click('#tabs button[data-tab="trainer"]');
  await page.click('#gapToggle');
  await page.evaluate(() => import('./js/ui/core.js').then(({ S }) => { S.gap.play = 1; S.gap.mute = 1; S.bpm = 120; }));
  await page.click('#tabs button[data-tab="grooves"]');
  await page.click('.groove[data-id="rock-beat"]');
  await page.evaluate(() => import('./js/ui/core.js').then(({ S }) => { S.bpm = 120; }));
  await page.click('#playBtn'); await page.waitForTimeout(200);
  const g = await capture(8200);
  const log = await page.evaluate(() => import('./js/ui/core.js').then(({ engine }) => engine.beatLog.filter(b => b.beat === 0).map(b => ({ t: b.time, muted: b.muted }))));
  await page.click('#playBtn');
  const barOf = t => log.filter(b => b.t <= t + 0.001).pop();
  const inMuted = g.band.filter(x => { const b = barOf(x.t); return b && b.muted; }).length;
  console.log('gap: band notes in silent bars =', inMuted, '| in played bars =', g.band.length - inMuted);
  await page.click('#tabs button[data-tab="trainer"]'); await page.click('#gapToggle');

  // Sound levels of the band voices
  const lv = await page.evaluate(async () => {
    const { DrumSynth } = await import('./js/synth.js');
    const out = {};
    for (const [k, fn] of Object.entries({
      bassDeep: s => s.bass(0.01, 33, 0.5, 1, 'deep'), bassPluck: s => s.bass(0.01, 33, 0.5, 1, 'pluck'), bassUpright: s => s.bass(0.01, 33, 0.5, 1, 'upright'),
      skank: s => s.chord(0.01, [69, 72, 76], 0.2, 1, 'skank'), stab: s => s.chord(0.01, [69, 72, 76, 79], 0.2, 1, 'stab'),
      organ: s => s.chord(0.01, [57, 60, 64, 67], 0.6, 1, 'organ'), keys: s => s.chord(0.01, [57, 60, 64, 67], 0.6, 1, 'keys'),
    })) {
      const c = new OfflineAudioContext(1, 44100, 44100); fn(new DrumSynth(c, c.destination));
      const d = (await c.startRendering()).getChannelData(0); let pk = 0; for (const x of d) pk = Math.max(pk, Math.abs(x)); out[k] = +pk.toFixed(2);
    }
    return out;
  });
  console.log('peaks', JSON.stringify(lv));
  await page.click('#tabs button[data-tab="band"]');
  await page.screenshot({ path: SP + '/step6-band.png', fullPage: true });
  console.log('ERRORS', errors);
  await browser.close(); srv.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });

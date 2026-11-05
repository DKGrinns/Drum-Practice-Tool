const { chromium } = require('playwright');
const { startServer, OUT } = require('./helpers.cjs');
const SP = OUT;
(async () => {
  const srv = await startServer(); const BASE = srv.url;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  await page.goto(BASE);
  await page.waitForTimeout(500);
  await page.screenshot({ path: SP + '/phone-metronome.png', fullPage: true });

  // Play metronome
  await page.click('#playBtn');
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => ({
    btn: document.getElementById('playBtn').textContent,
    dotsOn: document.querySelectorAll('.beat-dot.on').length,
    dots: document.querySelectorAll('.beat-dot').length,
  }));
  console.log('playing state', JSON.stringify(state));
  await page.screenshot({ path: SP + '/phone-playing.png' });
  // Change meter while playing
  await page.click('#meterSeg button[data-value="7/8"]');
  await page.waitForTimeout(3000);
  console.log('dots after 7/8', await page.evaluate(() => document.querySelectorAll('.beat-dot').length));
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  console.log('after space', await page.textContent('#playBtn'));

  // Grooves
  await page.click('.tabs button[data-tab="grooves"]');
  await page.click('.groove[data-id="one-drop"]');
  console.log('bpm after one drop', await page.textContent('#bpmValue'), 'now', await page.textContent('#nowPlaying'));
  await page.screenshot({ path: SP + '/phone-grooves.png', fullPage: true });
  // mute kick
  await page.click('#panel-grooves .mix-row[data-voice="kick"] .mute');
  await page.click('.groove[data-id="one-drop"] button[data-act="play"]');
  await page.waitForTimeout(1500);
  await page.click('#playBtn');

  // Open in builder
  await page.click('.groove[data-id="one-drop"] button[data-act="edit"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: SP + '/phone-builder.png', fullPage: true });
  const cells = await page.evaluate(() => document.querySelectorAll('.cell').length);
  console.log('cells', cells);
  // tap a cell 3 times -> accent? off->hit->accent
  const c = page.locator('.cell[data-voice="snare"][data-i="4"]');
  await c.click(); await c.click();
  console.log('cell class', await c.getAttribute('class'));
  // save -> name already "One Drop"
  await page.click('#pSave');
  await page.waitForTimeout(300);
  console.log('toast', await page.textContent('#toast'));
  // rename through dialog
  await page.click('#pRename');
  await page.fill('#dialogInput', 'My Drop');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  console.log('name', await page.textContent('#patternName'));
  // Duplicate
  await page.click('#pDuplicate');
  console.log('select options', await page.evaluate(() => [...document.querySelectorAll('#patternSelect option')].map(o => o.textContent)));
  // Bars to 2 and triplets
  await page.click('#barsSeg button[data-value="2"]');
  await page.click('#resSeg button[data-value="triplet"]');
  console.log('cells after 2 bars triplets', await page.evaluate(() => document.querySelectorAll('.cell').length));
  // play builder pattern
  await page.click('#playBtn');
  await page.waitForTimeout(2000);
  console.log('playhead', await page.evaluate(() => document.querySelectorAll('.cell.now').length));
  await page.screenshot({ path: SP + '/phone-builder-playing.png' });
  await page.click('#playBtn');

  // Export
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#pExportAll')]);
  const file = SP + '/export.json';
  await dl.saveAs(file);
  console.log('exported', dl.suggestedFilename(), require('fs').readFileSync(file, 'utf8').length, 'bytes');
  // Delete current
  page.once('dialog', d => d.accept());
  await page.click('#pDelete');
  await page.click('#dialogOk');
  await page.waitForTimeout(200);
  console.log('after delete options', await page.evaluate(() => [...document.querySelectorAll('#patternSelect option')].map(o => o.textContent)));
  // Import
  await page.setInputFiles('#importFile', file);
  await page.waitForTimeout(300);
  console.log('after import', await page.textContent('#toast'), await page.evaluate(() => [...document.querySelectorAll('#patternSelect option')].map(o => o.textContent)));

  // Trainer
  await page.click('.tabs button[data-tab="trainer"]');
  await page.click('#trainerToggle');
  await page.click('#gapToggle');
  await page.screenshot({ path: SP + '/phone-trainer.png', fullPage: true });
  console.log('bpm display w/ trainer', await page.textContent('#bpmValue'), '|', await page.textContent('#statusLine'));

  // Reload and check persistence
  await page.reload();
  await page.waitForTimeout(500);
  console.log('after reload: tab', await page.evaluate(() => document.querySelector('.tabs [aria-selected=true]').dataset.tab),
    'trainer', await page.textContent('#trainerToggle'),
    'patterns', await page.evaluate(() => [...document.querySelectorAll('#patternSelect option')].map(o => o.textContent)));
  const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!r; });
  console.log('sw registered', sw);

  // Landscape tablet + desktop screenshots
  await page.setViewportSize({ width: 844, height: 390 });
  await page.click('.tabs button[data-tab="builder"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: SP + '/phone-landscape.png' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.click('.tabs button[data-tab="grooves"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: SP + '/desktop.png' });

  // Offline: kill network, reload
  await page.waitForTimeout(1000);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForTimeout(500);
  console.log('offline title', await page.title(), 'groove cards', await page.evaluate(() => document.querySelectorAll('.groove').length));

  console.log('ERRORS:', JSON.stringify(errors, null, 1));
  await browser.close(); srv.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });

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
  await page.click('#tabs button[data-tab="grooves"]');
  console.log('chips', await page.$$eval('#styleFilter button', b => b.map(x => x.textContent.trim()).join(' | ')));
  console.log('cards (All)', await page.$$eval('.groove', c => c.length), 'headings', await page.$$eval('.g-family', h => h.length));
  await page.click('#styleFilter button[data-value="Brazilian"]');
  console.log('Brazilian', await page.$$eval('.g-name', n => n.map(x => x.textContent)));
  await page.click('#styleFilter button[data-value="All"]');
  await page.fill('#grooveSearch', 'clave');
  console.log('search clave', await page.$$eval('.g-name', n => n.map(x => x.textContent)));
  await page.fill('#grooveSearch', '6/8');
  console.log('search 6/8', await page.$$eval('.g-name', n => n.map(x => x.textContent)));
  await page.fill('#grooveSearch', 'zzzz');
  console.log('no match msg', await page.textContent('#grooveList'));
  await page.fill('#grooveSearch', '');

  // Play every groove for ~0.6 s each, through the real UI.
  const ids = await page.evaluate(async () => (await import('./js/grooves.js')).GROOVES.map(g => g.id));
  await page.click('#playBtn');
  const bad = [];
  for (const id of ids) {
    await page.click(`.groove[data-id="${id}"]`);
    await page.waitForTimeout(600);
    const st = await page.evaluate(() => ({ now: document.getElementById('nowPlaying').textContent, dots: document.querySelectorAll('.beat-dot').length }));
    if (!st.now) bad.push(id);
  }
  // 7/8 groove: 7 beat dots
  await page.click('.groove[data-id="fusion-7-8"]'); await page.waitForTimeout(2500);
  console.log('7/8 dots', await page.$$eval('.beat-dot', d => d.length), 'bpm', await page.textContent('#bpmValue'));
  await page.click('.groove[data-id="jazz-waltz"]'); await page.waitForTimeout(1500);
  console.log('waltz dots', await page.$$eval('.beat-dot', d => d.length));
  await page.click('#playBtn');
  console.log('played all', ids.length, 'bad', bad);
  await page.screenshot({ path: SP + '/step2-grooves.png' });

  // Open a Brazilian groove in the builder (percussion rows appear)
  await page.click('.groove[data-id="batucada"]');
  await page.click('.groove[data-id="batucada"] button[data-act="edit"]');
  await page.waitForTimeout(300);
  console.log('builder rows', await page.evaluate(() => [...new Set([...document.querySelectorAll('.grid-label')].map(l => l.textContent))]));
  // Meter switching in the builder
  await page.click('#meterSegB button[data-value="3/4"]');
  console.log('3/4 cells/row-voice', await page.evaluate(() => document.querySelectorAll('.cell[data-voice="kick"]').length), 'heads', await page.$$eval('.grid-block:first-child .grid-head', h => h.map(x => x.textContent).join(' ')));
  await page.click('#meterSegB button[data-value="7/8"]');
  console.log('7/8 kick cells', await page.evaluate(() => document.querySelectorAll('.cell[data-voice="kick"]').length), 'triplet disabled', await page.$eval('#resSeg [data-value="triplet"]', b => b.disabled));
  await page.screenshot({ path: SP + '/step2-builder-78.png', fullPage: true });
  await page.click('#meterSegB button[data-value="5/4"]');
  console.log('5/4 blocks', await page.$$eval('.grid-block', b => b.map(x => x.querySelectorAll('.cell[data-voice="kick"]').length)));
  await page.click('#playBtn'); await page.waitForTimeout(1500);
  console.log('5/4 dots', await page.$$eval('.beat-dot', d => d.length), 'playhead', await page.$$eval('.cell.now', c => c.length));
  await page.click('#playBtn');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.click('#tabs button[data-tab="grooves"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: SP + '/step2-desktop.png' });
  console.log('ERRORS', errors);
  await browser.close(); srv.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });

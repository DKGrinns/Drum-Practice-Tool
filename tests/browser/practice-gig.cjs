// Step 7: count-in (clicks + spoken), routine runner (seamless block
// changes at bar lines), practice log (clean takes, best tempos), set lists
// with page-turner keys and the song-form map, backup export/import.
const { chromium } = require('playwright');
const fs = require('fs');
const { startServer, OUT } = require('./helpers.cjs');

const near = (a, b, tol = 0.0005) => Math.abs(a - b) <= tol;

(async () => {
  const srv = await startServer();
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  // Fresh storage once, plus a short test routine (10 s blocks).
  await page.addInitScript(() => {
    if (sessionStorage.getItem('s')) return;
    sessionStorage.setItem('s', 1);
    localStorage.clear();
    const b = (item, seconds, extra = {}) => ({ item, seconds, ...extra });
    localStorage.setItem('grooveTrainer.routines', JSON.stringify([{ id: 'test', name: 'Test routine', blocks: [
      b({ kind: 'groove', grooveId: 'one-drop', bpm: 120 }, 10),
      b({ kind: 'metronome', meter: '4/4', subdivision: 'quarter', bpm: 100 }, 10, { trainer: { enabled: true, target: 110, step: 5, every: 1 } }),
      b({ kind: 'groove', grooveId: 'rockers', bpm: 90 }, 10, { gap: { enabled: true, play: 1, mute: 1 } }),
    ] }]));
    localStorage.setItem('grooveTrainer.practicePrefs', JSON.stringify({ routineId: 'test' }));
  });
  await page.goto(srv.url);
  console.log('tabs', await page.$$eval('#tabs button', b => b.map(x => x.textContent).join(', ')));

  // Record every sound the synth is asked to play, and fake speech.
  await page.evaluate(() => import('./js/ui/core.js').then(({ engine, bus }) => {
    window.__snd = [];
    window.__events = [];
    bus.on('play', () => window.__events.push(['play', engine.startTime]));
    bus.on('stop', () => window.__events.push(['stop', engine.ctx ? engine.ctx.currentTime : 0]));
    window.__spoken = [];
    speechSynthesis.speak = u => {
      const ctxNow = engine.ctx.currentTime, perf = performance.now();
      window.__spoken.push({ w: u.text, perf, ctxNow });
      setTimeout(() => u.onstart && u.onstart(), 90); // a voice that takes 90 ms to start
    };
    speechSynthesis.getVoices = () => [];
  }));
  const wrap = () => page.evaluate(() => import('./js/ui/core.js').then(({ engine }) => {
    if (engine.synth.__wrapped) return;
    const p = engine.synth.play.bind(engine.synth);
    engine.synth.play = (v, t, vel) => { window.__snd.push({ v, t }); return p(v, t, vel); };
    engine.synth.__wrapped = true;
  }));

  // ------------------------------------------------- count-in: clicks
  await page.click('#tabs button[data-tab="trainer"]');
  await page.click('#countInToggle');
  await page.click('#countInVoice button[data-value="clicks"]');
  await page.click('#tabs button[data-tab="grooves"]');
  await page.click('.groove[data-id="one-drop"]');
  await page.evaluate(() => import('./js/ui/transport.js').then(m => m.changeBpm(120)));
  await page.click('#playBtn');
  await wrap();
  await page.waitForTimeout(700);
  const statusCount = await page.textContent('#statusLine');
  await page.waitForTimeout(2750);
  await page.click('#playBtn');
  let r = await page.evaluate(() => import('./js/ui/core.js').then(({ engine }) => ({ snd: window.__snd, start: engine.startTime })));
  const clicks = r.snd.filter(s => s.v === 'accent' || s.v === 'click');
  const kicks = r.snd.filter(s => s.v === 'kick');
  // The wrapper went in just after start; the first click may be missed if
  // it was scheduled before, so check spacing from the start time.
  const ciTimes = clicks.filter(s => s.t < r.start + 1.99).map(s => +(s.t - r.start).toFixed(4));
  console.log('count-in clicks at', ciTimes.join(' '), 's | first kick at +', (kicks[0].t - r.start).toFixed(4), 's | status during count-in:', JSON.stringify(statusCount));
  if (!ciTimes.every(t => near(t % 0.5, 0) || near(t % 0.5, 0.5)) || !near(kicks[0].t - r.start, 3.0)) console.log('FAIL count-in timing');

  // ------------------------------------------------- count-in: spoken
  await page.click('#tabs button[data-tab="trainer"]');
  await page.click('#countInVoice button[data-value="speech"]');
  console.log('count-in hint:', await page.textContent('#countInHint'));
  await page.evaluate(() => { window.__spoken = []; window.__snd = []; });
  const lead0 = await page.evaluate(() => import('./js/ui/countin.js').then(m => m.speechLead()));
  await page.click('#playBtn');
  await page.waitForTimeout(2600);
  await page.click('#playBtn');
  r = await page.evaluate(() => import('./js/ui/core.js').then(({ engine }) => {
    const ts = engine.ctx.getOutputTimestamp();
    const heard = t => ts.performanceTime + (t - ts.contextTime) * 1000;
    return { spoken: window.__spoken, start: engine.startTime, beats: [0, 1, 2, 3].map(i => heard(engine.startTime + i * 0.5)) };
  }));
  const lead1 = await page.evaluate(() => import('./js/ui/countin.js').then(m => m.speechLead()));
  const early = r.spoken.map((s, i) => Math.round(r.beats[i] - s.perf));
  console.log('spoken words:', r.spoken.map(s => s.w).join(' '), '| started ms before each heard click:', early.join(' '), `| lead ${Math.round(lead0 * 1000)} -> ${Math.round(lead1 * 1000)} ms`);
  if (r.spoken.map(s => s.w).join(' ') !== 'one two three four') console.log('FAIL spoken words');
  if (!early.every(e => Math.abs(e - lead0 * 1000) < 30)) console.log('FAIL speech lead');
  if (!(lead1 < lead0 && lead1 > 0.09)) console.log('FAIL lead learning');
  await page.click('#countInVoice button[data-value="clicks"]');

  // ------------------------------------------------- routine runner
  await page.click('#tabs button[data-tab="practice"]');
  console.log('routines:', (await page.$$eval('#routineSelect option', o => o.map(x => x.textContent))).join(' | '));
  await page.evaluate(() => { window.__snd = []; window.__events = []; });
  await page.click('#rStart');
  await page.waitForTimeout(400);
  const run1 = await page.evaluate(() => [document.getElementById('runBlock').textContent, document.getElementById('runName').textContent, document.getElementById('runLeft').textContent]);
  await page.screenshot({ path: OUT + '/step7-routine-running.png', fullPage: true });
  // 3 blocks of 10 s, each after a count-in bar: about 42 s.
  const t0 = Date.now();
  await page.waitForFunction(() => document.getElementById('runCard').hidden, null, { timeout: 70000, polling: 250 });
  console.log(`routine finished after ${((Date.now() - t0) / 1000).toFixed(1)} s; toast: ${await page.textContent('#toast')}`);
  r = await page.evaluate(() => import('./js/ui/core.js').then(({ S }) => ({ snd: window.__snd, ev: window.__events, trainer: S.trainer.enabled, gap: S.gap.enabled, runHidden: document.getElementById('runCard').hidden })));
  console.log('runner showed:', run1.join(' / '));
  const plays = r.ev.filter(e => e[0] === 'play').map(e => e[1]);
  console.log('blocks started at (audio s):', plays.map(t => t.toFixed(4)).join(' '), '| events', r.ev.map(e => e[0]).join(','));
  if (plays.length !== 3 || r.ev.map(e => e[0]).join(',') !== 'play,stop,play,stop,play,stop') console.log('FAIL expected 3 block starts and a stop at the end');
  else {
    // Block 1: one drop at 120 with a 1-bar count-in -> bars every 2 s.
    const b1 = (plays[1] - plays[0]) / 2;
    // Block 2: 1-bar count-in at 100 (2.4 s), then trainer 100 -> 105 -> 110.
    const ci2 = 2.4, bar = [2.4, 60 / 105 * 4];
    const b2bars = [];
    let t = plays[1] + ci2;
    for (let i = 0; t < plays[2] - 1e-6 && i < 20; i++) { b2bars.push(+(t - plays[1]).toFixed(4)); t += 60 / Math.min(110, 100 + 5 * i) * 4; }
    console.log(`block 1 -> 2 at bar line: ${b1.toFixed(6)} bars of one drop (whole number = seamless)`);
    console.log(`block 2 -> 3 lands on a trainer bar line: ${near(t - plays[2], 0, 0.001) ? 'yes' : 'NO'} (${b2bars.length} bars after count-in)`);
    if (!near(b1, Math.round(b1), 1e-6) || !near(t - plays[2], 0, 0.001)) console.log('FAIL block changes not on bar lines');
    // Count-in at the start of block 2: accent exactly at its start, clicks 0.6 s apart.
    const c2 = r.snd.filter(s => (s.v === 'accent' || s.v === 'click') && s.t >= plays[1] - 1e-6 && s.t < plays[1] + 2.39).map(s => +(s.t - plays[1]).toFixed(4));
    console.log('block 2 count-in clicks:', c2.join(' '));
    // Block 3 (gap 1/1): no rockers notes in bar 1 (silent) after its count-in.
    const b3Start = plays[2] + 4 * 60 / 90;
    const silent = r.snd.filter(s => !['accent', 'click'].includes(s.v) && s.t >= b3Start + 60 / 90 * 4 - 1e-6 && s.t < b3Start + 60 / 90 * 8 - 1e-3).length;
    console.log('block 3 gap: drum notes in the silent bar =', silent);
    if (silent) console.log('FAIL gap in routine');
  }
  console.log('after routine: trainer', r.trainer, 'gap', r.gap, '(restored) | runner hidden', r.runHidden);
  if (r.trainer || r.gap || !r.runHidden) console.log('FAIL routine end');

  // ------------------------------------------------- practice log
  let logInfo = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('#logList .log-row')].map(x => x.querySelector('.l-what').textContent + ' | ' + x.querySelector('.l-meta').textContent),
    stats: document.getElementById('logStats').textContent.replace(/\s+/g, ' ').trim(),
  }));
  console.log('log rows:', logInfo.rows.length, '\n  ' + logInfo.rows.slice(0, 5).join('\n  '));
  console.log('log stats:', logInfo.stats);
  // A scored take arriving with the stop marks the entry clean.
  await page.click('#tabs button[data-tab="grooves"]');
  await page.click('.groove[data-id="steppers"]');
  await page.click('#playBtn');
  await page.waitForTimeout(11000);
  await page.evaluate(() => import('./js/ui/core.js').then(({ bus }) => { document.getElementById('playBtn').click(); bus.emit('take', { count: 40, mean: 4.2, sd: 8.1, within10: 0.82 }); }));
  await page.click('#tabs button[data-tab="practice"]');
  const best = await page.$$eval('#bestList .best-row', rows => rows.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  console.log('best clean tempos after a steady scored take:', best.join(' | '));
  if (!best.some(b => b.includes('Steppers'))) console.log('FAIL auto clean');
  // Mark the one drop entry clean by hand.
  const oneDropRow = await page.$$eval('#logList .log-row', rows => rows.findIndex(x => x.textContent.includes('One Drop')));
  await page.click(`#logList .log-row:nth-child(${oneDropRow + 1}) .clean-btn`);
  console.log('best after marking One Drop clean:', (await page.$$eval('#bestList .best-row', rows => rows.map(x => x.textContent.replace(/\s+/g, ' ').trim()))).join(' | '));
  await page.screenshot({ path: OUT + '/step7-practice.png', fullPage: true });

  // ------------------------------------------------- set list + pedal
  const dialog = async text => { await page.waitForSelector('#dialog[open]'); await page.fill('#dialogInput', text); await page.click('#dialogOk'); };
  await page.click('#tabs button[data-tab="gig"]');
  await page.click('#sNew'); await dialog('Friday gig');
  await page.click('#tabs button[data-tab="grooves"]'); await page.click('.groove[data-id="one-drop"]');
  await page.evaluate(() => import('./js/ui/transport.js').then(m => m.changeBpm(150)));
  await page.click('#tabs button[data-tab="gig"]'); await page.click('#sAddCurrent'); await dialog('Stir It Up');
  await page.click('#tabs button[data-tab="grooves"]'); await page.click('.groove[data-id="samba"]');
  await page.click('#tabs button[data-tab="gig"]'); await page.click('#sAddCurrent'); await dialog('Mas Que Nada');
  await page.click('#sAddSong');  // opens the editor for a third song
  await page.fill('#songList .block:nth-child(3) [data-k="title"]', 'Chameleon');
  await page.selectOption('#songList .block:nth-child(3) [data-f="grooveId"]', 'funk-16-ghost');
  await page.click('#songList .block:nth-child(3) [data-act="done"]');
  // Song 1: form and key.
  await page.click('#songList .block:nth-child(1) [data-act="edit"]');
  await page.fill('#songList .block:nth-child(1) [data-k="form"]', 'Intro 1, Verse 2, Chorus 1');
  await page.selectOption('#songList .block:nth-child(1) [data-k="key"]', 'G');
  await page.fill('#songList .block:nth-child(1) [data-k="notes"]', 'Drop on 3, rim click');
  await page.click('#songList .block:nth-child(1) [data-act="done"]');
  console.log('songs:', (await page.$$eval('#songList .block', b => b.map(x => x.querySelector('.b-name').textContent + ' (' + x.querySelector('.b-meta').textContent + ')'))).join(' | '));
  await page.click('#songList .block:nth-child(1) [data-act="load"]');
  const state = () => page.evaluate(() => import('./js/ui/core.js').then(({ S }) => `${document.getElementById('songTitle').textContent} · ${S.grooveId} ${S.bpm} · band key ${S.band.key}`));
  console.log('stage:', await state());
  await page.keyboard.press('PageDown'); console.log('PageDown ->', await state());
  await page.keyboard.press('ArrowRight'); console.log('ArrowRight ->', await state());
  await page.keyboard.press('ArrowRight'); console.log('ArrowRight at the end ->', await state());
  await page.keyboard.press('PageUp'); await page.keyboard.press('ArrowLeft'); console.log('PageUp, ArrowLeft ->', await state());
  // Learn a pedal that sends ↓ / ↑ (normally the tempo keys).
  await page.click('#pedalLearn');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  console.log('pedal:', await page.textContent('#pedalMsg'), '|', await page.textContent('#pedalKeys'));
  await page.keyboard.press('ArrowDown'); console.log('pedal ↓ ->', await state(), '(the song\'s tempo, not a tempo change)');
  await page.keyboard.press('ArrowUp'); console.log('pedal ↑ ->', await state());
  // The tempo keys still work on other tabs.
  await page.click('#tabs button[data-tab="metronome"]');
  await page.keyboard.press('ArrowUp');
  console.log('↑ on the Metronome tab -> bpm', await page.textContent('#bpmValue'));
  await page.keyboard.press('ArrowDown');

  // Form map follows the bars (one drop at 150: 1.6 s per bar).
  await page.click('#tabs button[data-tab="gig"]');
  await page.click('#playBtn');
  const seen = [];
  for (let i = 0; i < 55; i++) { // count-in + 4 bars at 151 BPM ≈ 8 s
    const t = (await page.textContent('#formNow')).trim();
    const soon = await page.$('.form-map .sec.soon');
    const s = t + (soon ? ' [next lit]' : '');
    if (seen[seen.length - 1] !== s) seen.push(s);
    await page.waitForTimeout(200);
  }
  await page.screenshot({ path: OUT + '/step7-gig.png', fullPage: true });
  await page.click('#playBtn');
  console.log('form map while playing:', seen.join(' → '));
  if (!seen.some(s => s.startsWith('Intro')) || !seen.some(s => s.startsWith('Verse · bar 2 of 2 · → Chorus next [next lit]')) || !seen.includes('End of the form')) console.log('FAIL form map');

  // ------------------------------------------------- backup
  await page.click('#tabs button[data-tab="practice"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#bExport')]);
  const file = OUT + '/' + dl.suggestedFilename();
  await dl.saveAs(file);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`backup ${dl.suggestedFilename()}: ${data.routines.length} routines, ${data.log.length} log entries, ${data.setlists.length} set lists (${data.setlists[0].songs.length} songs)`);
  const before = data.log.length;
  await page.click('#bClearLog'); await page.waitForSelector('#dialog[open]'); await page.click('#dialogOk');
  await page.waitForFunction(() => !document.querySelector('#logList .log-row'), null, { timeout: 3000 }).catch(() => {});
  console.log('log rows after clear:', await page.$$eval('#logList .log-row', r => r.length));
  await page.setInputFiles('#bImportFile', file);
  await page.waitForTimeout(300);
  const after = await page.$$eval('#logList .log-row', r => r.length);
  console.log('after import:', await page.textContent('#toast'), '| log rows shown', after, 'of', before);
  if (after !== Math.min(before, 15)) console.log('FAIL backup import');

  // ------------------------------------------------- reload keeps it all
  await page.reload();
  await page.click('#tabs button[data-tab="gig"]');
  console.log('after reload:', await page.textContent('#songPos'), '·', await page.textContent('#songTitle'), '|', await page.textContent('#pedalKeys'));
  await page.click('#tabs button[data-tab="trainer"]');
  console.log('count-in after reload:', await page.getAttribute('#countInToggle', 'aria-pressed'));
  console.log('ERRORS', errors);
  await browser.close(); srv.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });

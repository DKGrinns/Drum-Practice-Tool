// Listen tab: learning from records.
// A virtual Chrome tab (getDisplayMedia replaced by a MediaStream with a
// synthesized funk record at a known tempo, plus a video track the app must
// stop), a virtual microphone, and a WAV file. Checks the live tempo,
// confidence, beat lights, the click locked to the record, "use this
// tempo", grab, the loop at 75% speed, the focus filters, the rough
// transcription into the Builder, the "no audio shared" message, the audio
// file source and the microphone fallback.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { startServer, OUT } = require('./helpers.cjs');

const PATTERN = { kick: 'x--x--x---x--x--', snare: '----X--g-g--X--g', hh: 'x-x-x-x-x-x-x-x-' };

function initScript() {
  // Runs in the page. A "record" played by the app's own drum synth into a
  // MediaStream, scheduled a couple of seconds ahead as it goes.
  const makeRecord = async (bpm, pattern) => {
    const { engine } = await import('./js/ui/core.js');
    const { DrumSynth } = await import('./js/synth.js');
    const ac = engine.ensureAudio();
    if (ac.state !== 'running') await ac.resume();
    const bus = ac.createGain();
    const dest = ac.createMediaStreamDestination();
    bus.connect(dest);
    const nb = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.004;
    const noise = ac.createBufferSource(); noise.buffer = nb; noise.loop = true; noise.connect(bus); noise.start();
    const drums = new DrumSynth(ac, bus);
    const beat = 60 / bpm, t0 = ac.currentTime + 0.3;
    let step = 0;
    const rec = { t0, beat, bpm, stop: false };
    const pump = () => {
      if (rec.stop) return;
      while (t0 + step * beat / 4 < ac.currentTime + 2) {
        const t = t0 + step * beat / 4, k = step % 16;
        for (const [v, s] of Object.entries(pattern)) {
          const c = s[k];
          if (c && c !== '-') drums.play(v, t, c === 'X' ? 1 : c === 'g' ? 0.25 : 0.75);
        }
        step++;
      }
      setTimeout(pump, 200);
    };
    pump();
    return { stream: dest.stream, rec };
  };
  navigator.mediaDevices.getDisplayMedia = async opts => {
    window.__dmOpts = opts;
    const { stream, rec } = await makeRecord(window.__recBpm || 96, window.__pattern);
    window.__rec = rec;
    const canvas = document.createElement('canvas');
    canvas.width = 16; canvas.height = 16;
    const v = canvas.captureStream(1).getVideoTracks()[0];
    window.__videoTrack = v;
    // Like Chrome: the tab stops playing by itself when asked to.
    const a = stream.getAudioTracks()[0];
    const gs = a.getSettings.bind(a);
    a.getSettings = () => ({ ...gs(), suppressLocalAudioPlayback: !!(opts.audio && opts.audio.suppressLocalAudioPlayback) });
    return new MediaStream([...(window.__noAudio ? [] : [a]), v]);
  };
  navigator.mediaDevices.getUserMedia = async () => {
    const { stream, rec } = await makeRecord(window.__micBpm || 100, window.__pattern);
    window.__rec = rec;
    return stream;
  };
}

// 16-bit PCM WAV.
function wav(buf, sr) {
  const b = Buffer.alloc(44 + buf.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + buf.length * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(buf.length * 2, 40);
  for (let i = 0; i < buf.length; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(buf[i] * 32767))), 44 + i * 2);
  return b;
}

(async () => {
  const srv = await startServer(); const BASE = srv.url;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  const newPage = async (setup = '') => {
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript(`(${initScript.toString()})(); window.__pattern = ${JSON.stringify(PATTERN)}; ${setup}`);
    await page.goto(BASE);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.click('#tabs button[data-tab="listen"]');
    return page;
  };
  const dbg = (page, fn) => page.evaluate(`import('./js/ui/listen.js').then(m => (${fn})(m.debug))`);

  // ------------------------------------------------------------ live tab
  const page = await newPage();
  console.log('tabs', await page.$$eval('#tabs button', b => b.map(x => x.textContent).join(', ')));
  await page.click('#lsStart');
  await page.waitForTimeout(1200);
  console.log('started:', await page.textContent('#lsStart'), '| msg:', await page.textContent('#lsMsg'));
  console.log('asked for audio:', await page.evaluate(() => !!window.__dmOpts.audio), '| video track stopped:', await page.evaluate(() => window.__videoTrack.readyState));
  await page.waitForTimeout(14000);
  const bpm = Number(await page.textContent('#lsBpm'));
  console.log('live bpm', bpm, '| confidence', await page.textContent('#lsConf'), '|', await page.textContent('#lsFeel'));
  if (Math.abs(bpm - 96) > 0.6) console.log('FAIL live tempo', bpm);

  // Beats vs the record: the capture adds a fixed delay; what matters is
  // that every beat sits on the record (small spread) and on the beat.
  const live = await dbg(page, d => ({ beats: d.live.beats, line: d.live.line, oneTime: d.live.oneTime }));
  const rec = await page.evaluate(() => ({ t0: window.__rec.t0, beat: window.__rec.beat }));
  const offs = live.beats.map(b => { const k = Math.round((b - rec.t0) / rec.beat); return (b - (rec.t0 + k * rec.beat)) * 1000; });
  const med = offs.slice().sort((a, b) => a - b)[offs.length >> 1];
  const spread = Math.max(...offs.map(o => Math.abs(o - med)));
  console.log(`live beats: ${offs.length}, capture delay ${med.toFixed(1)} ms, worst beat ${spread.toFixed(1)} ms from it`);
  if (spread > 6) console.log('FAIL live beats spread', spread);
  const one = ((Math.round((live.oneTime - rec.t0) / rec.beat) % 4) + 4) % 4;
  console.log('downbeat guess on record beat', one + 1, one === 0 ? '(the 1)' : '');
  // The record is heard through the app (Chrome stopped the tab's own playback).
  const level = await dbg(page, async d => { const an = d.graph.ctx.createAnalyser(); an.fftSize = 2048; d.graph.vol.connect(an); let m = 0; for (let i = 0; i < 10; i++) { await new Promise(r => setTimeout(r, 50)); const b = new Float32Array(2048); an.getFloatTimeDomainData(b); for (const v of b) m = Math.max(m, Math.abs(v)); } d.graph.vol.disconnect(an); return m; });
  console.log('record heard through the app: peak', level.toFixed(3));
  if (level < 0.02) console.log('FAIL record not heard through the app');

  // Click along: the scheduled clicks land on the record's beats (plus the
  // same capture delay), with beat 1 accented.
  await page.click('#lsClick');
  await page.waitForTimeout(4000);
  const clicks = await dbg(page, d => d.scheduled.slice());
  const cerr = clicks.map(c => { const k = Math.round((c.time - med / 1000 - rec.t0) / rec.beat); return { e: (c.time - med / 1000 - (rec.t0 + k * rec.beat)) * 1000, n: c.n, k }; });
  const worstClick = Math.max(...cerr.map(c => Math.abs(c.e)));
  console.log(`clicks: ${clicks.length}, worst ${worstClick.toFixed(2)} ms off the record's beats; accents on record beats`, cerr.filter(c => c.n === 0).map(c => (c.k % 4) + 1).join(','));
  if (worstClick > 5) console.log('FAIL click not locked', worstClick);
  let lit = 0;
  for (let i = 0; i < 12; i++) { lit += await page.$$eval('#lsDots .beat-dot.on', d => d.length); await page.waitForTimeout(110); }
  console.log('beat lights lit in', lit, 'of 12 samples');
  if (!lit) console.log('FAIL beat lights');

  // Use this tempo
  await page.click('#lsUse');
  console.log('app tempo now', await page.evaluate(() => import('./js/ui/core.js').then(m => m.S.bpm)), '| main display', await page.textContent('#bpmValue'));

  // ½× / 2× buttons
  await page.click('#lsHalf'); await page.waitForTimeout(1300);
  const half = await page.textContent('#lsBpm');
  await page.click('#lsDouble'); await page.waitForTimeout(1300);
  console.log('½× ->', half, '| 2× back ->', await page.textContent('#lsBpm'));

  // Grab -> loop
  await page.click('#lsGrab');
  await page.waitForSelector('#lsLoopCard:not([hidden])', { timeout: 15000 });
  await page.waitForTimeout(300);
  const clip = await dbg(page, d => ({ bpm: d.clip.analysis.bpm, dur: d.clip.duration, beats: d.clip.beats.length, trans: d.clip.transients.length, loop: d.loop }));
  console.log(`grab: ${clip.dur.toFixed(1)} s, ${clip.bpm.toFixed(2)} BPM, ${clip.beats} beats, ${clip.trans} transients | loop`, await page.textContent('#lsLoopInfo'));
  if (Math.abs(clip.bpm - 96) > 0.5) console.log('FAIL grabbed clip tempo', clip.bpm);
  await page.screenshot({ path: OUT + '/step8-listen.png', fullPage: true });

  // Loop at 75%: the player's position moves at 0.75× real time and the
  // clicks follow the stretched beat.
  await page.click('#lsSpeedQuick button[data-value="75"]');
  await page.click('#lsLoopPlay');
  await page.waitForTimeout(1500);
  const r1 = await dbg(page, d => ({ ...d.report, now: d.graph.ctx.currentTime, sr: d.graph.ctx.sampleRate }));
  await page.waitForTimeout(1000);
  const r2 = await dbg(page, d => ({ ...d.report, now: d.graph.ctx.currentTime, sr: d.graph.ctx.sampleRate }));
  const len = r2.loopEnd - r2.loopStart;
  let dp = r2.pos - r1.pos; if (dp < 0) dp += len;
  const rate = dp / (r2.frame - r1.frame);
  console.log(`loop speed ${r2.speed} | position rate ${rate.toFixed(3)}`);
  if (Math.abs(rate - 0.75) > 0.02) console.log('FAIL loop rate', rate);
  await page.waitForTimeout(2000);
  const lc = await dbg(page, d => d.scheduled.slice());
  const gaps = []; for (let i = 1; i < lc.length; i++) gaps.push((lc[i].time - lc[i - 1].time) * 1000);
  const want = 60 / clip.bpm / 0.75 * 1000;
  const badGap = gaps.filter(g => Math.abs(g - want) > 5 && Math.abs(g - want) < 400);
  console.log(`loop clicks every ${(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1)} ms (want ${want.toFixed(1)}), odd gaps:`, badGap.map(g => g.toFixed(1)).join(' ') || 'none');
  console.log('loop button:', await page.textContent('#lsLoopPlay'));

  // Focus filters
  await page.click('#lsFocus button[data-value="kick"]');
  const f = await dbg(page, d => [d.graph.f1.type, d.graph.f1.frequency.value, d.graph.f2.type]);
  await page.click('#lsFocus button[data-value="hats"]');
  const f2 = await dbg(page, d => [d.graph.f1.type, d.graph.f1.frequency.value]);
  await page.click('#lsFocus button[data-value="all"]');
  console.log('focus kick', f.join(' '), '| hats', f2.join(' '));

  // Transcription -> Builder
  await page.click('#lsTranscribe');
  await page.waitForTimeout(500);
  console.log('transcription:\n' + await page.textContent('#lsTrPreview'));
  const tr = await dbg(page, d => d.transcript);
  const row = (arr) => arr.map(v => '-xXg'[v]).join('');
  const match = (got, pat) => { let ok = 0; for (let i = 0; i < got.length; i++) { const w = pat[i % 16]; const a = got[i] === '-' ? '-' : got[i] === 'g' ? 'g' : 'x'; const b = w === '-' ? '-' : w === 'g' ? 'g' : 'x'; if (a === b) ok++; } return ok / got.length; };
  // The loop may start on a different beat than the record's 1: try all 4.
  let best = { s: 0 };
  for (let rot = 0; rot < 16; rot += 4) {
    const rp = Object.fromEntries(Object.entries(PATTERN).map(([k, v]) => [k, v.slice(rot) + v.slice(0, rot)]));
    const s = ['kick', 'snare', 'hh'].map(v => match(row(tr.tracks[v]), rp[v]));
    if (s[0] + s[1] + s[2] > best.s) best = { s: s[0] + s[1] + s[2], rot, parts: s };
  }
  console.log(`transcription vs the record: kick ${(best.parts[0] * 100).toFixed(0)}%, snare ${(best.parts[1] * 100).toFixed(0)}%, hats ${(best.parts[2] * 100).toFixed(0)}% (loop starts on record beat ${best.rot / 4 + 1})`);
  if (best.parts[0] < 0.9 || best.parts[1] < 0.85 || best.parts[2] < 0.9) console.log('FAIL transcription');
  await page.click('#lsOpenBuilder');
  await page.waitForTimeout(500);
  const b = await page.evaluate(() => ({ tab: document.querySelector('#tabs button[aria-selected=true]').dataset.tab, kick: document.querySelectorAll('.cell[data-voice="kick"]:not(.v0)').length, snare: document.querySelectorAll('.cell[data-voice="snare"]:not(.v0)').length, hh: document.querySelectorAll('.cell[data-voice="hh"]:not(.v0)').length, toast: document.getElementById('toast').textContent }));
  console.log('builder:', JSON.stringify(b));
  if (b.tab !== 'builder' || !b.kick || !b.snare || !b.hh) console.log('FAIL open in builder');
  await page.click('#tabs button[data-tab="listen"]');
  await page.click('#lsLoopPlay');
  await page.click('#lsStart');
  console.log('stopped:', await page.textContent('#lsStart'), '|', await page.textContent('#lsLoopPlay'));
  await page.close();

  // ------------------------------------------------- forgot "share audio"
  const p2 = await newPage('window.__noAudio = true;');
  await p2.click('#lsStart');
  await p2.waitForTimeout(1000);
  const noAudioMsg = await p2.textContent('#lsMsg');
  console.log('no audio shared ->', noAudioMsg, '| button', await p2.textContent('#lsStart'));
  if (!/Also share tab audio/.test(noAudioMsg)) console.log('FAIL no-audio message');
  await p2.close();

  // ------------------------------------------------------------ file
  const ga = await import(pathToFileURL(path.join(__dirname, '..', 'groove-audio.js')).href);
  const od = ga.renderGroove({ bars: 12, seed: 5, jitter: 0.004, ...ga.FEELS.onedrop72.g, sr: 44100 });
  const file = path.join(OUT, 'one-drop-72.wav');
  fs.writeFileSync(file, wav(od.buf, 44100));
  const p3 = await newPage();
  await p3.click('#lsSource button[data-value="file"]');
  await p3.setInputFiles('#lsFile', file);
  await p3.waitForSelector('#lsLoopCard:not([hidden])', { timeout: 20000 });
  const fc = await dbg(p3, d => ({ bpm: d.clip.analysis.bpm, conf: d.clip.analysis.confidence, one: d.clip.beats[d.clip.oneIndex], first: d.clip.beats[0] }));
  // In the file the record's bar lines are at 0.37 s + k × 3.333 s.
  const barPos = ((fc.one - 0.37) / (4 * 60 / 72)) % 1;
  console.log(`file: ${await p3.textContent('#lsBpm')} BPM (${fc.bpm.toFixed(2)}), ${await p3.textContent('#lsConf')} | bar line ${Math.min(barPos, 1 - barPos) < 0.02 ? 'on the 1 (one-drop: nothing on 1)' : 'off by ' + (barPos * 4).toFixed(2) + ' beats'} | ${await p3.textContent('#lsMsg')}`);
  if (Math.abs(fc.bpm - 72) > 0.5) console.log('FAIL file tempo', fc.bpm);
  await p3.click('#lsLoopPlay');
  await p3.waitForTimeout(1200);
  console.log('file loop playing:', !!(await dbg(p3, d => d.report)));
  await p3.click('#lsLoopPlay');
  await p3.close();

  // ------------------------------------------------------------ microphone
  const p4 = await newPage('window.__micBpm = 100;');
  await p4.click('#lsSource button[data-value="mic"]');
  await p4.click('#lsStart');
  await p4.waitForTimeout(14000);
  const micBpm = Number(await p4.textContent('#lsBpm'));
  console.log('mic bpm', micBpm, '|', await p4.textContent('#lsConf'), '|', await p4.textContent('#lsMsg'));
  if (Math.abs(micBpm - 100) > 0.6) console.log('FAIL mic tempo', micBpm);
  await p4.click('#lsStart');
  await p4.close();

  console.log('ERRORS', errors);
  await browser.close(); srv.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });

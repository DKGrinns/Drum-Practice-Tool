const { chromium } = require('playwright');
const { startServer, OUT } = require('./helpers.cjs');
(async () => {
  const srv = await startServer(); const BASE = srv.url;
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const page = await b.newPage();
  await page.addInitScript(() => {
    localStorage.clear();
    navigator.mediaDevices.getUserMedia = async () => {
      const { engine } = await import('./js/ui/core.js'); const { DrumSynth } = await import('./js/synth.js');
      const ac = engine.ctx; const micBus = ac.createGain(); const delay = ac.createDelay(1); delay.delayTime.value = 0.2; // e.g. Bluetooth-ish
      const dest = ac.createMediaStreamDestination(); micBus.connect(delay).connect(dest);
      const drummer = new DrumSynth(ac, micBus);
      // Headphones: the mic does NOT hear the app. The drummer taps along with each click, 0-6 ms scatter.
      const orig = engine.synth.play.bind(engine.synth);
      engine.synth.play = (v, t, x) => { if (v === 'accent') drummer.play('snare', t + Math.random() * 0.006, 0.8); return orig(v, t, x); };
      return dest.stream;
    };
  });
  await page.goto(BASE);
  await page.click('#tabs button[data-tab="feedback"]'); await page.click('#micToggle'); await page.waitForTimeout(600);
  await page.click('#speakerTest'); await page.waitForTimeout(500);
  await page.waitForTimeout(7000);
  console.log('speaker test with headphones (drummer taps though):', await page.textContent('#micMsg'));
  await page.click('#tapTest'); await page.waitForTimeout(13500);
  console.log('tap test:', await page.textContent('#micMsg'), '|', await page.textContent('#calibStatus'));
  await b.close(); srv.close();
})();

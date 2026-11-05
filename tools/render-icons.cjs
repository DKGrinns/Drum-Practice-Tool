// Renders the PNG app icons from icons/icon.svg and icons/icon-maskable.svg.
// Usage: node tools/render-icons.cjs   (needs Playwright, see tests/browser/README.md)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const dir = process.argv[2] || require('path').join(__dirname, '..', 'icons');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const jobs = [
    ['icon.svg', 'icon-192.png', 192],
    ['icon.svg', 'icon-512.png', 512],
    ['icon-maskable.svg', 'icon-maskable-512.png', 512],
    ['icon-maskable.svg', 'apple-touch-icon.png', 180],
  ];
  for (const [src, out, size] of jobs) {
    const svg = fs.readFileSync(path.join(dir, src), 'utf8');
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: path.join(dir, out), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  }
  await browser.close();
})();

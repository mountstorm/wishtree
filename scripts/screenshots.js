// Takes desktop and phone screenshots of the local site into screenshots/.
// Usage: node scripts/screenshots.js [name]
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { startServer, memoryService } from './serve.js';
import { sampleWishes } from '../test/fixtures/sampleWishes.js';

const name = process.argv[2] || 'shot';
const server = await startServer(5199, { api: await memoryService(sampleWishes) });
await mkdir(new URL('../screenshots/', import.meta.url), { recursive: true });
const browser = await chromium.launch();
const sizes = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'phone', width: 390, height: 844, isMobile: true, deviceScaleFactor: 3, hasTouch: true },
];
const problems = [];
for (const s of sizes) {
  const page = await browser.newPage({ viewport: { width: s.width, height: s.height }, isMobile: s.isMobile, deviceScaleFactor: s.deviceScaleFactor || 1, hasTouch: s.hasTouch });
  page.on('pageerror', (e) => problems.push(`${s.label}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`${s.label}: ${m.text()}`));
  await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const scrollX = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (scrollX > 0) problems.push(`${s.label}: page scrolls sideways by ${scrollX}px`);
  const minFont = await page.evaluate(() => Math.min(...[...document.querySelectorAll('.tree text')].map((t) => t.getBoundingClientRect().height ? parseFloat(t.getAttribute('font-size')) * t.getCTM().a : Infinity)));
  console.log(`${s.label}: ${await page.locator('.tree text').count()} branches, smallest text ${minFont.toFixed(1)}px`);
  // Real-browser overlap check: glyph centres from different branches closer
  // than 0.7em (in tree units) mean the text visibly collides.
  const overlaps = await page.evaluate(() => {
    const glyphs = [];
    document.querySelectorAll('.tree text').forEach((t, ti) => {
      const fs = parseFloat(t.getAttribute('font-size'));
      for (let i = 0; i < t.getNumberOfChars(); i++) {
        if (t.textContent[i] === ' ') continue;
        const e = t.getExtentOfChar(i);
        glyphs.push({ ti, fs, x: e.x + e.width / 2, y: e.y + e.height / 2 });
      }
    });
    let hits = 0;
    for (let a = 0; a < glyphs.length; a++) for (let b = a + 1; b < glyphs.length; b++) {
      const g = glyphs[a], h = glyphs[b];
      if (g.ti !== h.ti && Math.hypot(g.x - h.x, g.y - h.y) < 0.35 * (g.fs + h.fs)) hits++;
    }
    return hits;
  });
  if (overlaps) problems.push(`${s.label}: ${overlaps} overlapping glyph pairs`);
  const file = `${process.env.SHOTS_DIR || 'screenshots'}/${name}-${s.label}.png`;
  await page.screenshot({ path: file });
  console.log('saved', file);
  await page.close();
}
await browser.close();
server.close();
if (problems.length) { console.log('PROBLEMS:\n' + problems.join('\n')); process.exitCode = 1; }

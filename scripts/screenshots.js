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
  const info = await page.evaluate(() => {
    const texts = [...document.querySelectorAll('.slip.open .slip-text')];
    const px = (t) => { const m = t.getScreenCTM(); return parseFloat(t.getAttribute('font-size')) * Math.hypot(m.a, m.b); };
    // Real-browser check: each slip's rendered words stay inside its paper.
    const spill = texts.filter((t) => {
      const b = t.getBBox();
      const paper = t.parentNode.querySelectorAll('rect')[1].getBBox();
      return b.x < paper.x - 0.5 || b.x + b.width > paper.x + paper.width + 0.5 || b.y < paper.y - 0.5 || b.y + b.height > paper.y + paper.height + 0.5;
    }).map((t) => t.textContent);
    return { open: texts.length, folded: document.querySelectorAll('.slip.folded').length, minFont: Math.min(...texts.map(px)), spill };
  });
  console.log(`${s.label}: ${info.open} open slips, ${info.folded} folded, smallest text ${info.minFont.toFixed(1)}px`);
  if (info.spill.length) problems.push(`${s.label}: text spills off ${info.spill.length} slips: ${info.spill.slice(0, 3).join(' | ')}`);
  if (info.minFont < 11) problems.push(`${s.label}: text below 11px`);
  const file = `${process.env.SHOTS_DIR || 'screenshots'}/${name}-${s.label}.png`;
  await page.screenshot({ path: file });
  console.log('saved', file);
  await page.close();
}
await browser.close();
server.close();
if (problems.length) { console.log('PROBLEMS:\n' + problems.join('\n')); process.exitCode = 1; }

// Types a wish and screenshots its journey at several moments, on desktop and
// phone, then once more with prefers-reduced-motion. Output: screenshots/ (or
// $SHOTS_DIR). Usage: node scripts/journey-shots.js [name]
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.js';

const name = process.argv[2] || 'journey';
const dir = process.env.SHOTS_DIR || 'screenshots';
await mkdir(dir, { recursive: true });
const server = await startServer(5196);
const browser = await chromium.launch();
const WISH = 'That everyone at our table feels at home this year';
const sizes = [
  { label: 'desktop', viewport: { width: 1440, height: 900 } },
  { label: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
];
const moments = [['1-sky', 400], ['2-falling', 1900], ['3-landing', 3500], ['4-rising', 4300], ['5-growing', 5400], ['6-grown', 9000]];
const problems = [];

async function open(size, reducedMotion = 'no-preference') {
  const page = await browser.newPage({ ...size, reducedMotion });
  page.on('pageerror', (e) => problems.push(`${size.label}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`${size.label}: ${m.text()}`));
  await page.goto('http://localhost:5196/', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  return page;
}

async function grownState(page) {
  return page.evaluate((wish) => {
    const t = document.querySelector('.tree text[data-id^="local-"]');
    if (!t) return { found: false };
    const r = t.getBoundingClientRect();
    return {
      found: true,
      text: t.textContent,
      fullText: t.textContent === wish,
      visible: r.width > 0 && r.height > 0,
      offset: t.querySelector('textPath').getAttribute('startOffset'),
      scrollX: document.documentElement.scrollWidth - innerWidth,
      message: document.getElementById('wish-message').textContent,
    };
  }, WISH);
}

for (const size of sizes) {
  const page = await open(size);
  await page.screenshot({ path: `${dir}/${name}-${size.label}-0-form.png` });
  await page.fill('#wish-text', WISH);
  await page.fill('#wish-name', 'Muzaffar');
  await page.screenshot({ path: `${dir}/${name}-${size.label}-0-typed.png` });
  const snapshot = () => page.evaluate(() => [...document.querySelectorAll('.tree text')].map((t) => `${t.dataset.id}@${t.querySelector('textPath').getAttribute('startOffset')}`));
  const before = await snapshot();
  await page.press('#wish-text', 'Enter');
  const t0 = Date.now();
  for (const [label, at] of moments) {
    await page.waitForTimeout(Math.max(0, at - (Date.now() - t0)));
    await page.screenshot({ path: `${dir}/${name}-${size.label}-${label}.png` });
  }
  const after = new Set(await snapshot());
  const moved = before.filter((b) => !after.has(b));
  if (moved.length) problems.push(`${size.label}: ${moved.length} existing branches changed when the wish was added`);
  const s = await grownState(page);
  console.log(size.label, JSON.stringify(s));
  if (!s.found || !s.visible) problems.push(`${size.label}: new branch not visible`);
  if (s.scrollX > 0) problems.push(`${size.label}: sideways scroll ${s.scrollX}px`);
  await page.close();

  const calm = await open(size, 'reduce');
  await calm.fill('#wish-text', WISH);
  await calm.press('#wish-text', 'Enter');
  await calm.waitForTimeout(150);
  await calm.screenshot({ path: `${dir}/${name}-${size.label}-reduced.png` });
  const r = await grownState(calm);
  console.log(size.label, 'reduced', JSON.stringify(r), 'falling elements:', await calm.locator('.falling-wish, .seed').count());
  if (!r.found || !r.visible) problems.push(`${size.label} reduced: branch not shown in place`);
  await calm.close();
}
await browser.close();
server.close();
if (problems.length) { console.log('PROBLEMS:\n' + problems.join('\n')); process.exitCode = 1; }

// Types a wish and screenshots its journey at several moments, on desktop and
// phone, then once more with prefers-reduced-motion. Output: screenshots/ (or
// $SHOTS_DIR). Usage: node scripts/journey-shots.js [name]
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { startServer, memoryService } from './serve.js';
import { sampleWishes } from '../test/fixtures/sampleWishes.js';

const name = process.argv[2] || 'journey';
const dir = process.env.SHOTS_DIR || 'screenshots';
await mkdir(dir, { recursive: true });
const server = await startServer(5196, { api: await memoryService(sampleWishes) });
const browser = await chromium.launch();
const WISH = 'That everyone at our table feels at home this year';
const sizes = [
  { label: 'desktop', viewport: { width: 1440, height: 900 } },
  { label: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
];
const moments = [['1-sky', 400], ['2-falling', 1800], ['3-mouth', 3050], ['4-dropping', 3650], ['5-landed', 4700], ['6-done', 8000]];
const problems = [];

let visitor = 0;
async function open(size, reducedMotion = 'no-preference') {
  // Each page is a different visitor, so the 3-per-hour limit does not interfere.
  const page = await browser.newPage({ ...size, reducedMotion });
  const ip = `198.51.100.${++visitor}`;
  await page.route('**/api/**', (route) => route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': ip } }));
  page.on('pageerror', (e) => problems.push(`${size.label}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`${size.label}: ${m.text()}`));
  await page.goto('http://localhost:5196/', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  return page;
}

async function landedState(page) {
  return page.evaluate((wish) => {
    const t = [...document.querySelectorAll('.slip.mine')].at(-1);
    if (!t) return { found: false };
    const r = t.getBoundingClientRect();
    return {
      found: true,
      text: t.querySelector('.slip-text')?.getAttribute('aria-label') ?? '',
      fullText: t.querySelector('.slip-text')?.getAttribute('aria-label') === wish,
      visible: r.width > 0 && r.height > 0,
      transform: t.getAttribute('transform'),
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
  const snapshot = () => page.evaluate(() => [...document.querySelectorAll('.slip')].map((t) => `${t.dataset.id}@${t.getAttribute('transform')}`));
  const before = await snapshot();
  await page.press('#wish-text', 'Enter');
  await page.waitForSelector('.falling-wish', { timeout: 5000 });
  const t0 = Date.now();
  // A full jar re-picks which wishes are open and cross-fades; only then may
  // slips already in the jar change.
  const repicked = (await page.locator('.fading-out').count()) > 0;
  for (const [label, at] of moments) {
    await page.waitForTimeout(Math.max(0, at - (Date.now() - t0)));
    await page.screenshot({ path: `${dir}/${name}-${size.label}-${label}.png` });
  }
  const after = new Set(await snapshot());
  const moved = before.filter((b) => !after.has(b));
  if (moved.length && !repicked) problems.push(`${size.label}: ${moved.length} slips already in the jar moved when the wish was added`);
  if (repicked) console.log(`${size.label}: jar re-picked its open slips (cross-faded)`);
  const s = await landedState(page);
  console.log(size.label, JSON.stringify(s));
  if (!s.found || !s.visible) problems.push(`${size.label}: new slip not visible`);
  if (s.scrollX > 0) problems.push(`${size.label}: sideways scroll ${s.scrollX}px`);
  await page.close();

  const calm = await open(size, 'reduce');
  await calm.fill('#wish-text', WISH);
  await calm.press('#wish-text', 'Enter');
  await calm.waitForFunction(() => document.getElementById('wish-message').textContent.includes('in the jar'));
  await calm.screenshot({ path: `${dir}/${name}-${size.label}-reduced.png` });
  const r = await landedState(calm);
  console.log(size.label, 'reduced', JSON.stringify(r), 'falling elements:', await calm.locator('.falling-wish, .seed').count());
  if (!r.found || !r.visible) problems.push(`${size.label} reduced: slip not shown in place`);
  await calm.close();
}
await browser.close();
server.close();
if (problems.length) { console.log('PROBLEMS:\n' + problems.join('\n')); process.exitCode = 1; }

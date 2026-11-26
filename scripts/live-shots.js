// Screens for Phase 3's live behaviour, at desktop and phone size:
//   empty      a brand-new tree
//   first      the first wish grown as the trunk
//   arrival    a wish from another visitor grows in by polling
//   limited    the kind 429 after 3 wishes in an hour
//   resting    the API is down
// Output: screenshots/ (or $SHOTS_DIR). Usage: node scripts/live-shots.js [name]
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { startServer, memoryService } from './serve.js';
import { createWishService } from '../lib/wishes.js';

const name = process.argv[2] || 'live';
const dir = process.env.SHOTS_DIR || 'screenshots';
await mkdir(dir, { recursive: true });
const browser = await chromium.launch();
const problems = [];
const sizes = [
  { label: 'desktop', viewport: { width: 1440, height: 900 } },
  { label: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
];
let port = 5300;

// Pretend each page is a visitor at `ip` (only on API calls, so fonts still load).
async function page(size, ip) {
  const p = await browser.newPage(size);
  p.visitorIp = ip;
  await p.route('**/api/**', (route) => route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': p.visitorIp } }));
  p.on('console', (m) => m.type() === 'error' && !/the server responded with a status of (4|5)\d\d/.test(m.text()) && problems.push(`${size.label}: ${m.text()}`));
  p.on('pageerror', (e) => problems.push(`${size.label}: ${e.message}`));
  return p;
}
const shot = (p, size, what) => p.screenshot({ path: `${dir}/${name}-${size.label}-${what}.png` });
const message = (p) => p.evaluate(() => document.getElementById('wish-message').textContent);

for (const size of sizes) {
  // ---- empty tree, then the first wish
  const url = `http://localhost:${++port}/`;
  const server = await startServer(port, { api: await memoryService() });
  const p = await page(size, '203.0.113.10');
  await p.goto(url, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => document.getElementById('status-title').textContent.includes('first'));
  await p.waitForTimeout(400);
  await shot(p, size, 'empty');

  await p.fill('#wish-text', 'That this table is always full of laughter');
  await p.fill('#wish-name', 'Muzaffar');
  await p.press('#wish-text', 'Enter');
  await p.waitForFunction(() => document.getElementById('wish-message').textContent.includes('grown'), null, { timeout: 15000 });
  await p.waitForTimeout(300);
  await shot(p, size, 'first');
  if (!(await p.locator('#tree-status').isHidden())) problems.push(`${size.label}: empty-state text still showing after the first wish`);

  // ---- another visitor's wish arrives by polling
  const other = await fetch(`${url}api/wishes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.77' },
    body: JSON.stringify({ text: 'A warm kitchen and somebody to share it with', name: 'Ana' }),
  });
  if (other.status !== 201) problems.push(`other visitor POST ${other.status}`);
  const t0 = Date.now();
  await p.waitForFunction(() => document.querySelectorAll('.tree text').length === 2, null, { timeout: 20000 });
  console.log(`${size.label}: other visitor's wish appeared after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await p.waitForTimeout(1200);
  await shot(p, size, 'arrival');

  // ---- rate limit: two more wishes are fine, the fourth this hour is kindly refused
  for (const text of ['Second wish of the hour', 'Third wish of the hour']) {
    await p.fill('#wish-text', text);
    await p.press('#wish-text', 'Enter');
    await p.waitForFunction(() => !document.getElementById('wish-send').disabled, null, { timeout: 15000 });
  }
  await p.fill('#wish-text', 'Fourth wish of the hour');
  await p.press('#wish-text', 'Enter');
  await p.waitForFunction(() => document.getElementById('wish-message').classList.contains('error'), null, { timeout: 5000 });
  await shot(p, size, 'limited');
  const limitMsg = await message(p);
  console.log(`${size.label}: 429 says "${limitMsg}"`);
  if (!/planted 3 wishes/.test(limitMsg)) problems.push(`${size.label}: rate-limit message missing`);
  if ((await p.inputValue('#wish-text')) !== 'Fourth wish of the hour') problems.push(`${size.label}: refused wish text was cleared`);

  // ---- a profane wish is refused with its own message
  p.visitorIp = '203.0.113.200';
  await p.fill('#wish-text', 'what the fuck');
  await p.press('#wish-text', 'Enter');
  await p.waitForFunction(() => /kind/.test(document.getElementById('wish-message').textContent), null, { timeout: 5000 });
  const sx = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (sx > 0) problems.push(`${size.label}: sideways scroll ${sx}px`);
  await p.close();
  server.close();

  // ---- API down: the tree is resting
  const downPort = ++port;
  const down = await startServer(downPort, { api: createWishService({ redis: null, log: () => {} }) });
  const q = await page(size, '203.0.113.11');
  await q.goto(`http://localhost:${downPort}/`, { waitUntil: 'networkidle' });
  await q.waitForFunction(() => document.getElementById('status-title').textContent.includes('resting'));
  await shot(q, size, 'resting');
  await q.fill('#wish-text', 'Hope');
  await q.press('#wish-text', 'Enter');
  await q.waitForFunction(() => document.getElementById('wish-message').classList.contains('error'));
  console.log(`${size.label}: when down, POST says "${await message(q)}"`);
  await q.close();
  down.close();
}
await browser.close();
if (problems.length) { console.log('PROBLEMS:\n' + problems.join('\n')); process.exitCode = 1; }

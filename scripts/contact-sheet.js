// Tiles screenshots into one image for quick review.
// Usage: node scripts/contact-sheet.js out.png columns width img1.png img2.png ...
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const [out, cols, width, ...files] = process.argv.slice(2);
const tiles = await Promise.all(files.map(async (f) => ({ name: basename(f), src: `data:image/png;base64,${(await readFile(f)).toString('base64')}` })));
const html = `<body style="margin:0;background:#222;font:13px sans-serif;color:#ddd">
<div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:6px;padding:6px;width:${width}px">
${tiles.map((t) => `<figure style="margin:0"><img src="${t.src}" style="width:100%;display:block"><figcaption>${t.name}</figcaption></figure>`).join('')}
</div></body>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(width) + 12, height: 400 } });
await page.setContent(html);
await page.screenshot({ path: out, fullPage: true });
await browser.close();

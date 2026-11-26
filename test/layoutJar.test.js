import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutJar, chooseJar, fitJar, jarSize, wrapText, MAX_SHOWN, MIN_FONT_PX, PAPERS } from '../js/layoutJar.js';
import { textWidthEm } from '../js/fontMetrics.js';
import { sampleWishes } from './fixtures/sampleWishes.js';

// ---------------------------------------------------------------- fixtures

const WORDS = ('thank you for the warm table family health peace love home friends winter hope ' +
  'kindness gratitude joy pumpkin pie and to my all of every grandma safe travels brother sister ' +
  'new job rest laughter snow music garden a cure courage patience').split(' ');

function makeWishes(n, salt = 0) {
  return Array.from({ length: n }, (_, i) => {
    let k = (i * 7919 + salt * 104729 + 13) >>> 0;
    const target = 1 + ((i * 37 + salt) % 80);
    let text = '';
    while (text.length < target) {
      k = (Math.imul(k, 1103515245) + 12345) >>> 0;
      text += (text ? ' ' : '') + WORDS[k % WORDS.length];
    }
    return {
      id: `wish-${salt}-${i}-${(k % 46656).toString(36)}`,
      text: text.slice(0, 80).trim(),
      name: i % 3 ? `Guest ${i}` : '',
      createdAt: new Date(Date.UTC(2026, 10, 1) + i * 60_000).toISOString(),
    };
  });
}

function shuffle(list, seed = 7) {
  const out = [...list];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const DESKTOP = { width: 1440, height: 640 };
const PHONE = { width: 390, height: 560 };

// ---------------------------------------------------------------- independent geometry
// Built from the public output only: centre, size and angle of each slip.

function corners(s) {
  const r = (s.angle * Math.PI) / 180, c = Math.cos(r), n = Math.sin(r);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
    const x = (a * s.width) / 2, y = (b * s.height) / 2;
    return { x: s.x + x * c - y * n, y: s.y + x * n + y * c };
  });
}

function separated(a, b) {
  for (const poly of [a, b]) {
    for (let i = 0; i < 4; i++) {
      const p = poly[i], q = poly[(i + 1) % 4];
      const nx = q.y - p.y, ny = p.x - q.x;
      const proj = (pts) => pts.map((v) => v.x * nx + v.y * ny);
      const pa = proj(a), pb = proj(b);
      if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return true;
    }
  }
  return false;
}

function findOverlap(slips) {
  const polys = slips.map((s) => ({ s, c: corners(s) }));
  for (let i = 0; i < polys.length; i++) {
    for (let j = i + 1; j < polys.length; j++) {
      const a = polys[i], b = polys[j];
      if (Math.hypot(a.s.x - b.s.x, a.s.y - b.s.y) > (a.s.width + b.s.width) / 2 + (a.s.height + b.s.height) / 2) continue;
      if (!separated(a.c, b.c)) return `${a.s.id} overlaps ${b.s.id}`;
    }
  }
  return null;
}

/** Inside the glass: above the floor, below the shoulder, within the rounded walls. */
function inside(jar, p, floor) {
  if (p.y > floor + 1e-6 || p.y < -jar.height - 1e-6) return false;
  let half = jar.width / 2;
  const cy = -jar.corner;
  if (p.y > cy) half = jar.width / 2 - jar.corner + Math.sqrt(Math.max(0, jar.corner ** 2 - (p.y - cy) ** 2));
  return Math.abs(p.x) <= half + 1e-6;
}

// ---------------------------------------------------------------- tests

test('the same wishes always fill the same jar', () => {
  const wishes = makeWishes(150);
  assert.deepEqual(layoutJar(wishes), layoutJar(wishes));
  assert.deepEqual(layoutJar(wishes, { compact: true }), layoutJar(wishes, { compact: true }));
});

test('input order does not matter', () => {
  const wishes = makeWishes(90);
  assert.deepEqual(layoutJar(shuffle(wishes)), layoutJar(wishes));
});

test('layout does not use Math.random and does not mutate its input', () => {
  const wishes = makeWishes(60);
  const copy = structuredClone(wishes);
  const original = Math.random;
  Math.random = () => { throw new Error('Math.random was called'); };
  try {
    layoutJar(wishes);
    chooseJar(wishes, PHONE);
  } finally {
    Math.random = original;
  }
  assert.deepEqual(wishes, copy);
});

test('an empty jar', () => {
  const empty = layoutJar([]);
  assert.deepEqual(empty.slips, []);
  assert.equal(empty.total, 0);
  assert.equal(empty.confetti.count, 0);
  assert.equal(chooseJar([], PHONE).layout.slips.length, 0);
});

for (const n of [50, 200, 500]) {
  test(`no slip overlaps another and all stay inside the glass with ${n} wishes`, () => {
    for (const box of [DESKTOP, PHONE]) {
      const { layout } = chooseJar(makeWishes(n, n), box);
      assert.equal(findOverlap(layout.slips), null);
      for (const s of layout.slips) {
        for (const p of corners(s)) assert.ok(inside(layout.jar, p, -layout.confetti.height), `${s.id} pokes out of the jar`);
      }
    }
  });
}

test('the sample wishes fill a jar with no overlaps', () => {
  for (const box of [DESKTOP, PHONE]) assert.equal(findOverlap(chooseJar(sampleWishes, box).layout.slips), null);
});

test('the newest wishes are open slips on top; older ones are folded below', () => {
  const wishes = makeWishes(120, 3);
  const { layout } = chooseJar(wishes, DESKTOP);
  const open = layout.slips.filter((s) => s.kind === 'open');
  const folded = layout.slips.filter((s) => s.kind === 'folded');
  assert.ok(open.length >= 8, `only ${open.length} open slips`);
  assert.ok(folded.length > 0);
  const newest = new Set(wishes.slice(-open.length).map((w) => w.id));
  for (const s of open) assert.ok(newest.has(s.id), `${s.id} is open but not among the newest`);
  // Slips are listed in the order they dropped: folded first, then open.
  assert.equal(layout.slips.findIndex((s) => s.kind === 'open'), folded.length);
  // On average, open slips rest higher in the jar (smaller y) than folded ones.
  const mean = (l) => l.reduce((t, s) => t + s.y, 0) / l.length;
  assert.ok(mean(open) < mean(folded));
});

test('open slips carry the full wish, wrapped to fit the paper', () => {
  const wishes = makeWishes(40, 4);
  const byId = new Map(wishes.map((w) => [w.id, w]));
  const { layout } = chooseJar(wishes, DESKTOP);
  for (const s of layout.slips.filter((x) => x.kind === 'open')) {
    assert.equal(s.lines.join(' '), byId.get(s.id).text);
    assert.ok(s.lines.length >= 1 && s.lines.length <= 4);
    for (const line of s.lines) {
      assert.ok(textWidthEm(line) * s.fontSize <= s.width - s.fontSize, `"${line}" is wider than its slip`);
    }
    assert.ok(s.height >= s.lines.length * s.fontSize * 1.2, 'slip is tall enough for its lines');
    assert.ok(PAPERS.some((p) => p.color === s.color && p.ink === s.ink));
  }
});

test('wrapText breaks lines at spaces and splits words longer than a line', () => {
  assert.deepEqual(wrapText('peace and quiet', 14, 1000), ['peace and quiet']);
  const lines = wrapText('a b c d e f g h i j k l m n o p', 14, 40);
  assert.ok(lines.length > 1 && lines.every((l) => textWidthEm(l) * 14 <= 40));
  const long = wrapText('Supercalifragilisticexpialidocious', 14, 60);
  assert.ok(long.length > 1);
  assert.equal(long.join(''), 'Supercalifragilisticexpialidocious');
});

test(`never draws more than ${MAX_SHOWN} slips; the oldest become confetti`, () => {
  const wishes = makeWishes(500, 8);
  const { layout } = chooseJar(wishes, DESKTOP);
  assert.ok(layout.slips.length <= MAX_SHOWN);
  assert.equal(layout.slips.length + layout.confetti.count + layout.overflow, 500);
  assert.equal(layout.overflow, 0);
  assert.ok(layout.confetti.height > 0);
  const shown = new Set(layout.slips.map((s) => s.id));
  const newest = new Set(wishes.slice(-shown.size).map((w) => w.id));
  for (const id of shown) assert.ok(newest.has(id), `${id} is old but drawn as a slip`);
  // More wishes, a deeper bed of confetti.
  assert.ok(layoutJar(makeWishes(900, 8)).confetti.height > layout.confetti.height);
});

test('text is at least 11px on phones and on desktop', () => {
  for (const wishes of [sampleWishes, makeWishes(5), makeWishes(300, 2)]) {
    for (const box of [DESKTOP, PHONE, { width: 360, height: 520 }]) {
      const { fit } = chooseJar(wishes, box);
      assert.ok(fit.minFontPx >= MIN_FONT_PX, `${box.width}px: ${fit.minFontPx.toFixed(1)}px`);
    }
  }
});

test('phones open fewer slips than desktop', () => {
  const phone = chooseJar(sampleWishes, PHONE).layout.slips.filter((s) => s.kind === 'open').length;
  const desk = chooseJar(sampleWishes, DESKTOP).layout.slips.filter((s) => s.kind === 'open').length;
  assert.ok(phone >= 3 && phone < desk, `phone ${phone}, desktop ${desk}`);
});

test('the jar fits inside its box', () => {
  for (const box of [DESKTOP, PHONE]) {
    const { layout, fit } = chooseJar(sampleWishes, box);
    const size = jarSize(layout);
    assert.ok(size.width * fit.scale <= box.width);
    assert.ok(size.height * fit.scale <= box.height);
    assert.deepEqual(fitJar(layout, box), fit);
  }
});

test('a new wish lands on top without moving any other slip', () => {
  for (const box of [DESKTOP, PHONE]) {
    const wishes = makeWishes(70, 9);
    const chosen = chooseJar(wishes, box);
    assert.deepEqual(layoutJar(wishes, chosen.options), chosen.layout, 'the returned options reproduce the jar');
    const newest = { id: 'zz-new', text: 'That everyone at our table feels at home this year', name: '', createdAt: '2027-01-01T00:00:00.000Z' };
    const after = layoutJar([...wishes, newest], chosen.options);
    if (after.overflow) continue; // a full jar re-picks instead (covered below)
    assert.deepEqual(after.slips.slice(0, -1), chosen.layout.slips);
    assert.equal(after.slips.at(-1).id, 'zz-new');
    assert.equal(after.slips.at(-1).kind, 'open');
  }
});

test('when the jar is too full for one more open slip, the layout says so', () => {
  const wishes = makeWishes(60, 10);
  const chosen = chooseJar(wishes, PHONE);
  let all = [...wishes];
  let overflowed = false;
  for (let i = 0; i < 40 && !overflowed; i++) {
    all = [...all, { id: `more-${i}`, text: 'Another long wish that needs a whole lot of room in this jar', name: '', createdAt: new Date(Date.UTC(2027, 0, 1) + i * 1000).toISOString() }];
    overflowed = layoutJar(all, chosen.options).overflow > 0;
  }
  assert.ok(overflowed, 'adding many open slips eventually overflows');
  const repicked = chooseJar(all, PHONE);
  assert.equal(repicked.layout.overflow, 0);
});

test('500 wishes lay out quickly', () => {
  const t = performance.now();
  chooseJar(makeWishes(500, 11), DESKTOP);
  chooseJar(makeWishes(500, 11), PHONE);
  assert.ok(performance.now() - t < 3000);
});

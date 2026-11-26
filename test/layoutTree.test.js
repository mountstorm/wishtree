import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutTree, chooseLayout, fitTree, MAX_BRANCHES, TRUNK_COUNT } from '../js/layoutTree.js';
import { sampleWishes } from './fixtures/sampleWishes.js';

// ---------------------------------------------------------------- fixtures

const WORDS = ('thank you for the warm table family health peace love home friends winter hope ' +
  'kindness gratitude joy pumpkin pie and to my all of every grandma safe travels brother sister ' +
  'new job rest laughter snow music garden a cure courage patience').split(' ');

/** n wishes with lengths from 1 to 80 characters, one minute apart. */
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

// ---------------------------------------------------------------- an independent text model
// These helpers read only the layout's public output (SVG path strings and
// text offsets), not its internals.

function parsePath(d) {
  const nums = d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi).map(Number);
  assert.match(d, /^M[^MC]+(C[^MC]+)+$/, `unexpected path shape: ${d.slice(0, 40)}`);
  const segs = [];
  let p = { x: nums[0], y: nums[1] };
  for (let i = 2; i + 5 < nums.length + 0; i += 6) {
    const seg = [p, { x: nums[i], y: nums[i + 1] }, { x: nums[i + 2], y: nums[i + 3] }, { x: nums[i + 4], y: nums[i + 5] }];
    segs.push(seg);
    p = seg[3];
  }
  return segs;
}

function polyline(d) {
  const pts = [];
  for (const [a, b, c, e] of parsePath(d)) {
    for (let i = pts.length ? 1 : 0; i <= 50; i++) {
      const t = i / 50, u = 1 - t;
      const x = u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * e.x;
      const y = u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * e.y;
      const prev = pts.at(-1);
      pts.push({ x, y, s: prev ? prev.s + Math.hypot(x - prev.x, y - prev.y) : 0 });
    }
  }
  return pts;
}

function pointAt(pts, s) {
  let i = 1;
  while (i < pts.length - 1 && pts[i].s < s) i++;
  const a = pts[i - 1], b = pts[i];
  const t = b.s === a.s ? 0 : Math.max(0, Math.min(1, (s - a.s) / (b.s - a.s)));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Glyph discs along a branch's text: centred on the path (the text is drawn
 * with dy=0.34em, i.e. centred), radius 0.45em, from the first to the last
 * glyph centre.
 */
function glyphDiscs(branch) {
  const pts = polyline(branch.path);
  const f = branch.fontSize;
  const out = [];
  const from = branch.textStart + 0.25 * f;
  const to = branch.textStart + branch.textLength - 0.25 * f;
  for (let s = from; s <= to + 1e-6; s += 0.1 * f) out.push({ ...pointAt(pts, s), r: 0.45 * f });
  return { discs: out, length: pts.at(-1).s };
}

function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function findOverlap(branches) {
  const cell = 30;
  const grid = new Map();
  const all = branches.map((b) => ({ b, ...glyphDiscs(b) }));
  for (const { b, discs } of all) {
    for (const d of discs) {
      const k = `${Math.floor(d.x / cell)},${Math.floor(d.y / cell)}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push({ ...d, id: b.id });
    }
  }
  for (const { b, discs } of all) {
    for (const d of discs) {
      const cx = Math.floor(d.x / cell), cy = Math.floor(d.y / cell);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        for (const o of grid.get(`${cx + i},${cy + j}`) || []) {
          if (o.id === b.id) continue;
          if (Math.hypot(o.x - d.x, o.y - d.y) < o.r + d.r) {
            return `${b.id} overlaps ${o.id} at (${d.x.toFixed(1)}, ${d.y.toFixed(1)})`;
          }
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------- tests

test('the same wishes always give the same tree', () => {
  const wishes = makeWishes(120);
  assert.deepEqual(layoutTree(wishes), layoutTree(wishes));
});

test('input order does not matter', () => {
  const wishes = makeWishes(80);
  assert.deepEqual(layoutTree(shuffle(wishes)), layoutTree(wishes));
});

test('layout does not use Math.random', () => {
  const original = Math.random;
  Math.random = () => { throw new Error('Math.random was called'); };
  try {
    layoutTree(makeWishes(40));
    layoutTree(makeWishes(40), { compact: true });
  } finally {
    Math.random = original;
  }
});

test('does not mutate its input', () => {
  const wishes = makeWishes(30);
  const copy = structuredClone(wishes);
  layoutTree(wishes);
  assert.deepEqual(wishes, copy);
});

test('empty and tiny inputs', () => {
  const empty = layoutTree([]);
  assert.deepEqual(empty.branches, []);
  assert.equal(empty.total, 0);
  const one = layoutTree(makeWishes(1));
  assert.equal(one.branches.length, 1);
  assert.equal(one.branches[0].depth, 0);
});

for (const n of [50, 200, 500]) {
  test(`no branch text overlaps another with ${n} wishes`, () => {
    const layout = layoutTree(makeWishes(n, n));
    assert.equal(findOverlap(layout.branches), null);
  });
}

test('no overlaps in the sample tree or in compact trees', () => {
  assert.equal(findOverlap(layoutTree(sampleWishes).branches), null);
  for (const n of [60, 300]) {
    assert.equal(findOverlap(layoutTree(makeWishes(n, 3), { compact: true }).branches), null);
  }
});

test('every wish up to 400 grows its own branch with its full text', () => {
  const wishes = makeWishes(200, 9);
  const layout = layoutTree(wishes);
  assert.equal(layout.branches.length, 200);
  assert.equal(layout.hidden, 0);
  const byId = new Map(wishes.map((w) => [w.id, w]));
  for (const b of layout.branches) assert.equal(b.text, byId.get(b.id).text);
  assert.equal(new Set(layout.branches.map((b) => b.id)).size, 200);
});

test('text fits on its branch path', () => {
  for (const b of layoutTree(makeWishes(150, 4)).branches) {
    const { length } = glyphDiscs(b);
    assert.ok(b.textStart >= 0, `${b.id} starts before its path`);
    assert.ok(b.textStart + b.textLength <= length + 0.5, `${b.id} text runs past its path`);
  }
});

test('the trunk is the earliest wishes and branches attach to earlier ones', () => {
  const wishes = makeWishes(100, 2);
  const layout = layoutTree(wishes);
  const trunk = layout.branches.filter((b) => b.depth === 0);
  assert.equal(trunk.length, TRUNK_COUNT);
  const earliest = new Set(wishes.slice(0, 12).map((w) => w.id));
  for (const t of trunk) assert.ok(earliest.has(t.id), `${t.id} is not one of the earliest wishes`);
  assert.ok(trunk.every((t) => t.fontSize > layout.branches.at(-1).fontSize), 'trunk text is thicker');

  const seen = new Map();
  for (const b of layout.branches) {
    if (b.depth > 0) {
      assert.ok(seen.has(b.parentId), `${b.id} attaches to a branch that does not exist yet`);
      assert.equal(b.depth, seen.get(b.parentId).depth + 1);
    }
    seen.set(b.id, b);
  }
});

test('branches grow upward and the tree stays above ground', () => {
  for (const b of layoutTree(makeWishes(200, 5)).branches) {
    const pts = polyline(b.path);
    const base = b.reversed ? pts.at(-1) : pts[0];
    assert.ok(b.leaf.y < base.y, `${b.id} grows downward`);
    if (b.depth > 0) assert.ok(pts.every((p) => p.y < 0), `${b.id} dips below the ground`);
  }
});

test('growth is balanced left and right', () => {
  for (const n of [60, 200]) {
    const branches = layoutTree(makeWishes(n, 6)).branches.filter((b) => b.depth > 0);
    const left = branches.filter((b) => b.leaf.x < 0).length;
    const right = branches.length - left;
    assert.ok(Math.abs(left - right) <= Math.max(4, branches.length * 0.2), `left ${left} vs right ${right}`);
  }
});

test('past 400 wishes the newest are branches and older ones thicken the trunk', () => {
  const wishes = makeWishes(500, 8);
  const layout = layoutTree(wishes);
  assert.equal(layout.branches.length, MAX_BRANCHES);
  assert.equal(layout.hidden, 100);
  assert.equal(layout.total, 500);

  const trunkIds = new Set(layout.branches.filter((b) => b.depth === 0).map((b) => b.id));
  const newest = new Set(wishes.slice(-(MAX_BRANCHES - TRUNK_COUNT)).map((w) => w.id));
  for (const b of layout.branches) {
    if (!trunkIds.has(b.id)) assert.ok(newest.has(b.id), `${b.id} is an old wish drawn as a branch`);
  }
  const at400 = layoutTree(wishes.slice(0, 400));
  assert.equal(at400.bark.length, 0);
  assert.ok(layout.bark.length > 0);
  assert.ok(layout.trunkWidth > at400.trunkWidth);
});

test('fitTree keeps the whole tree inside the box', () => {
  const layout = layoutTree(makeWishes(90));
  const box = { width: 800, height: 500 };
  const fit = fitTree(layout, box);
  const { minX, maxX, minY } = layout.bounds;
  assert.ok(fit.x + minX * fit.scale >= 0);
  assert.ok(fit.x + maxX * fit.scale <= box.width);
  assert.ok(fit.y + minY * fit.scale >= 0);
});

test('on a phone, text is never smaller than 11px and twigs are fewer and shorter', () => {
  const phone = { width: 390, height: 600 };
  for (const wishes of [sampleWishes, makeWishes(50), makeWishes(500, 1)]) {
    const { layout, fit } = chooseLayout(wishes, phone);
    for (const b of layout.branches) {
      assert.ok(b.fontSize * fit.scale >= 11, `${b.id} renders at ${(b.fontSize * fit.scale).toFixed(1)}px`);
    }
    const full = layoutTree(wishes);
    assert.ok(layout.branches.length < full.branches.length, 'phone tree has fewer branches');
    assert.ok(Math.max(...layout.branches.map((b) => b.depth)) < Math.max(...full.branches.map((b) => b.depth)));
    assert.ok(layout.branches.filter((b) => b.depth > 0).every((b) => [...b.text].length <= 24));
  }
});

test('desktop keeps the full tree', () => {
  const { layout } = chooseLayout(sampleWishes, { width: 1440, height: 640 });
  assert.equal(layout.branches.length, 60);
});

test('400 branches lay out in reasonable time', () => {
  const t = performance.now();
  layoutTree(makeWishes(500, 11));
  assert.ok(performance.now() - t < 5000);
});

test('trunk strands never overlap, across many mixes of early wish lengths', () => {
  for (let salt = 100; salt < 160; salt++) {
    const wishes = shuffle(makeWishes(30, salt), salt).map((w, i) => ({
      ...w,
      createdAt: new Date(Date.UTC(2026, 10, 1) + i * 60_000).toISOString(),
    }));
    for (const compact of [false, true]) {
      const overlap = findOverlap(layoutTree(wishes, { compact }).branches);
      assert.equal(overlap, null, `salt ${salt}${compact ? ' compact' : ''}: ${overlap}`);
    }
  }
});

test('once the trunk has formed, a newer wish adds one branch and never moves the existing ones', () => {
  // The trunk is chosen from the earliest 12 wishes, so it settles at 12.
  for (const n of [12, 13, 59, 250]) {
    const wishes = makeWishes(n + 1, 12);
    const before = layoutTree(wishes.slice(0, n));
    const after = layoutTree(wishes);
    const newest = wishes.at(-1).id;
    assert.deepEqual(after.branches.filter((b) => b.id !== newest), before.branches, `with ${n} existing wishes`);
    const added = after.branches.find((b) => b.id === newest);
    assert.ok(added, 'the newest wish has a branch');
    assert.ok(added.depth > 0, 'it grows as a branch');
  }
});

test('each branch grows from its parent or from the ground', () => {
  const layout = layoutTree(makeWishes(80, 13));
  const byId = new Map(layout.branches.map((b) => [b.id, b]));
  for (const b of layout.branches) {
    const pts = polyline(b.path);
    const start = b.reversed ? pts.at(-1) : pts[0];
    assert.ok(Math.hypot(start.x - b.base.x, start.y - b.base.y) < 0.2, `${b.id} base is not where its path starts`);
    if (b.depth === 0) {
      assert.ok(b.base.y >= 0, `${b.id} trunk does not start at the ground`);
    } else {
      const parentPts = polyline(byId.get(b.parentId).path);
      let near = Infinity;
      for (let i = 1; i < parentPts.length; i++) near = Math.min(near, distToSegment(b.base, parentPts[i - 1], parentPts[i]));
      assert.ok(near < 1, `${b.id} does not start on its parent`);
    }
  }
});

test('a phone tree keeps its branches as new wishes arrive', () => {
  const phone = { width: 390, height: 600 };
  const wishes = makeWishes(120, 14);
  const chosen = chooseLayout(wishes, phone);
  assert.deepEqual(layoutTree(wishes, chosen.options), chosen.layout, 'the returned options reproduce the layout');

  const more = [...wishes, ...makeWishes(3, 15).map((w, i) => ({ ...w, createdAt: new Date(Date.UTC(2026, 11, 1) + i * 1000).toISOString() }))];
  const after = layoutTree(more, chosen.options);
  const newIds = new Set(more.slice(-3).map((w) => w.id));
  assert.deepEqual(after.branches.filter((b) => !newIds.has(b.id)), chosen.layout.branches);
  assert.equal(after.branches.filter((b) => newIds.has(b.id)).length, 3);
});

test('growPath starts where a branch\'s text starts', () => {
  for (const b of layoutTree(makeWishes(60, 16)).branches) {
    if (b.depth === 0) {
      assert.equal(b.growPath, null);
      continue;
    }
    const full = polyline(b.path);
    const grow = polyline(b.growPath);
    // The text's first glyph sits at the same point on both paths.
    const onFull = pointAt(full, b.textStart);
    const onGrow = pointAt(grow, b.reversed ? b.textStart : 0);
    assert.ok(Math.hypot(onFull.x - onGrow.x, onFull.y - onGrow.y) < 0.6, `${b.id} growPath is offset`);
    const textEnd = b.textStart + b.textLength;
    const endFull = pointAt(full, textEnd);
    const endGrow = pointAt(grow, b.reversed ? textEnd : b.textLength);
    assert.ok(Math.hypot(endFull.x - endGrow.x, endFull.y - endGrow.y) < 0.6, `${b.id} growPath bends differently`);
  }
});

test('a young tree is not blown up to fill the screen', async () => {
  const { MAX_FONT_PX } = await import('../js/layoutTree.js');
  for (const n of [1, 3, 8]) {
    for (const box of [{ width: 1440, height: 640 }, { width: 390, height: 560 }]) {
      const { layout, fit } = chooseLayout(makeWishes(n, 17), box);
      const biggest = Math.max(...layout.branches.map((b) => b.fontSize)) * fit.scale;
      assert.ok(biggest <= MAX_FONT_PX + 1e-9, `${n} wishes at ${box.width}px: ${biggest.toFixed(1)}px text`);
    }
  }
});

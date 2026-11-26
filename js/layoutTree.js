// layoutTree: grows one tree out of a list of wishes.
//
// Pure and deterministic: the same wishes (in any order) always give the same
// tree on every device. All randomness is seeded from wish ids, and text width
// comes from a fixed Fraunces width table rather than the browser.
//
// Coordinates are SVG-style world units with the tree's base at (0, 0) and the
// tree growing toward negative y. One world unit is one pixel at scale 1.

import { textWidthEm } from './fontMetrics.js';

export const MAX_BRANCHES = 400;
export const TRUNK_COUNT = 6;
export const LEAF_COLORS = ['#e8762b', '#a4243b', '#e3b23c', '#7a8b3a']; // pumpkin, cranberry, gold, olive

const DEG = Math.PI / 180;
// Collision radius of a line of text around its centre line, in em, sampled
// every SAMPLE_STEP_EM. Glyphs reach about 0.45em either side of the centre;
// radius minus half a step stays above that, so no gap between samples can
// hide an overlap.
const TEXT_RADIUS_EM = 0.58;
const SAMPLE_STEP_EM = 0.22;

const FULL = {
  fonts: [21, 16, 14, 12.5, 12, 12], // font size by depth: trunk, limbs, branches, twigs
  maxDepth: 9,
  maxChildren: [8, 6, 4],
  maxChars: Infinity,
  trunkChars: Infinity,
  maxBranches: MAX_BRANCHES,
  aspect: 1.9, // crown width : height, for landscape screens
};
const COMPACT = {
  fonts: [14, 12.5, 12, 12],
  maxDepth: 3,
  maxChildren: [6, 4, 3],
  maxChars: 24,
  trunkChars: 34,
  maxBranches: 40,
  aspect: 0.75, // tall and narrow for phones
};
// A trunk strand should be long enough to rise and flare; shorter early
// wishes grow as branches instead of being stretched.
const TRUNK_MIN_CHARS = 20;
const PASS_NORMAL = { fracs: [0.22, 0.4, 0.58, 0.76, 0.92], phis: [30, 44, 58, 72], maxDown: 0.12 };
const TRUNK_SEARCH = 12;

// ---------------------------------------------------------------- randomness

export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Integer hash for deterministic tie-breaking. */
function mix(x) {
  x = Math.imul((x >>> 16) ^ x, 0x45d9f3b);
  x = Math.imul((x >>> 16) ^ x, 0x45d9f3b);
  return ((x >>> 16) ^ x) >>> 0;
}

export function seededRandom(seed) {
  let a = seed >>> 0;
  return function mulberry32() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- geometry

const round = (v) => Math.round(v * 10) / 10;
const dir = (a) => ({ x: Math.cos(a), y: Math.sin(a) });

/** Angle difference b - a wrapped into (-PI, PI]. */
function angleDiff(a, b) {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Point and heading at arc length s along a constant-curvature arc. */
function arcAt(p0, a0, sweep, len, s) {
  if (Math.abs(sweep) < 1e-6) {
    return { x: p0.x + Math.cos(a0) * s, y: p0.y + Math.sin(a0) * s, a: a0 };
  }
  const k = sweep / len;
  const a = a0 + k * s;
  return {
    x: p0.x + (Math.sin(a) - Math.sin(a0)) / k,
    y: p0.y - (Math.cos(a) - Math.cos(a0)) / k,
    a,
  };
}

/** A constant-curvature arc as one cubic Bezier segment [p0, p1, p2, p3]. */
function arcToCubic(p0, a0, sweep, len) {
  const end = arcAt(p0, a0, sweep, len, len);
  const h = Math.abs(sweep) < 1e-6 ? len / 3 : (4 / 3) * Math.tan(sweep / 4) * (len / sweep);
  const d0 = dir(a0);
  const d1 = dir(end.a);
  return [
    p0,
    { x: p0.x + d0.x * h, y: p0.y + d0.y * h },
    { x: end.x - d1.x * h, y: end.y - d1.y * h },
    { x: end.x, y: end.y },
  ];
}

function cubicAt([p0, p1, p2, p3], t) {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

/** Flattens cubic segments into a polyline with cumulative arc length. */
function flatten(segs, steps = 32) {
  const pts = [{ ...segs[0][0], s: 0 }];
  for (const seg of segs) {
    for (let i = 1; i <= steps; i++) {
      const p = cubicAt(seg, i / steps);
      const prev = pts[pts.length - 1];
      pts.push({ x: p.x, y: p.y, s: prev.s + Math.hypot(p.x - prev.x, p.y - prev.y) });
    }
  }
  return pts;
}

/** Point and heading at arc length s on a flattened polyline. */
function polyAt(pts, s) {
  let lo = 0, hi = pts.length - 1;
  if (s <= 0) lo = 0, hi = 1;
  else if (s >= pts[hi].s) lo = hi - 1;
  else {
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].s <= s) lo = mid; else hi = mid;
    }
  }
  const a = pts[lo], b = pts[lo + 1];
  const t = b.s === a.s ? 0 : Math.min(1, Math.max(0, (s - a.s) / (b.s - a.s)));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, a: Math.atan2(b.y - a.y, b.x - a.x) };
}

function segsToPath(segs, reversed) {
  const list = reversed
    ? segs.slice().reverse().map(([a, b, c, d]) => [d, c, b, a])
    : segs;
  let d = `M${round(list[0][0].x)} ${round(list[0][0].y)}`;
  for (const [, p1, p2, p3] of list) {
    d += `C${round(p1.x)} ${round(p1.y)} ${round(p2.x)} ${round(p2.y)} ${round(p3.x)} ${round(p3.y)}`;
  }
  return d;
}

// ---------------------------------------------------------------- collisions

class Grid {
  constructor(cell = 40) {
    this.cell = cell;
    this.map = new Map();
  }
  key(cx, cy) {
    return cx * 100003 + cy;
  }
  add(c) {
    const k = this.key(Math.floor(c.x / this.cell), Math.floor(c.y / this.cell));
    let list = this.map.get(k);
    if (!list) this.map.set(k, (list = []));
    list.push(c);
  }
  hits(c) {
    const cx = Math.floor(c.x / this.cell), cy = Math.floor(c.y / this.cell);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const list = this.map.get(this.key(cx + i, cy + j));
        if (!list) continue;
        for (const o of list) {
          const dx = o.x - c.x, dy = o.y - c.y, r = o.r + c.r;
          if (dx * dx + dy * dy < r * r) return true;
        }
      }
    }
    return false;
  }
}

/** Collision circles for a branch's text and its leaf, in growth order. */
function circlesFor(at, textStart, textLen, font, leaf) {
  const r = font * TEXT_RADIUS_EM;
  const step = font * SAMPLE_STEP_EM;
  const out = [];
  for (let s = textStart + r * 0.6; s <= textStart + textLen - r * 0.6 + 1e-6; s += step) {
    const p = at(s);
    out.push({ x: p.x, y: p.y, r });
  }
  const end = at(textStart + textLen - r * 0.6);
  out.push({ x: end.x, y: end.y, r });
  if (leaf) out.push({ x: leaf.x, y: leaf.y, r: leaf.size * 0.55 });
  return out;
}

// ---------------------------------------------------------------- input

function compareWishes(a, b) {
  const ta = Date.parse(a.createdAt) || 0, tb = Date.parse(b.createdAt) || 0;
  if (ta !== tb) return ta - tb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function displayText(text, maxChars) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  const chars = [...clean];
  if (chars.length <= maxChars) return clean;
  return chars.slice(0, maxChars - 1).join('').trimEnd() + '…';
}

// ---------------------------------------------------------------- layout

/**
 * Grows a tree from wishes.
 *
 * @param {Array<{id:string,text:string,name?:string,createdAt:string}>} wishes
 * @param {{compact?: boolean, maxBranches?: number, since?: object}} [options]
 *   compact: narrow-screen tree with bigger relative text, shortened text and
 *   fewer, shallower twigs. maxBranches: how many wishes to draw as branches;
 *   the rest (oldest after the trunk) become extra trunk thickness.
 *   since: instead of maxBranches, draw every wish from this one onward
 *   (returned by chooseLayout so a phone's tree stays stable as wishes arrive).
 * @returns {{
 *   branches: Array<{id:string, parentId:string|null, depth:number, text:string,
 *     path:string, width:number, fontSize:number, textStart:number,
 *     textLength:number, stem:string|null, leaf:{x:number,y:number,angle:number,
 *     size:number,color:string}, base:{x:number,y:number}, growPath:string|null,
 *     reversed:boolean}>,
 *   bark: Array<{path:string, width:number}>,
 *   bounds: {minX:number, minY:number, maxX:number, maxY:number},
 *   hidden: number, total: number, trunkWidth: number, minFontSize: number
 * }}
 *   `path` is the full branch curve (reversed for left-leaning branches so text
 *   always reads left to right); the text runs from `textStart` for
 *   `textLength` along it. `width` is the branch's thickness, its font size.
 *   `base` is where the branch grows from (on its parent, or the ground).
 *   `growPath` is the branch from where its text starts; the text sits at
 *   offset 0 on it (or `textStart` when reversed). Null for trunk strands.
 */
export function layoutTree(wishes, options = {}) {
  const cfg = { ...(options.compact ? COMPACT : FULL) };
  if (options.maxBranches != null) cfg.maxBranches = Math.max(1, options.maxBranches);

  const sorted = [...wishes].sort(compareWishes);
  const trunkTarget = Math.min(TRUNK_COUNT, cfg.maxBranches, sorted.length);
  const early = sorted.slice(0, TRUNK_SEARCH);
  const trunkWishes = early.filter((w) => [...String(w.text).trim()].length >= TRUNK_MIN_CHARS).slice(0, trunkTarget);
  for (const w of early) {
    if (trunkWishes.length >= trunkTarget) break;
    if (!trunkWishes.includes(w)) trunkWishes.push(w);
  }
  // Longest strands stand in the middle and split off highest, shorter ones
  // flank them; ties keep time order. (Deterministic: depends only on text.)
  trunkWishes.sort(compareWishes);
  {
    const byLength = trunkWishes
      .map((w, i) => ({ w, i, len: textWidthEm(displayText(w.text, cfg.trunkChars)) }))
      .sort((a, b) => b.len - a.len || a.i - b.i);
    const slots = [];
    byLength.forEach((item, rank) => (rank % 2 === 0 ? slots.push(item.w) : slots.unshift(item.w)));
    trunkWishes.splice(0, trunkWishes.length, ...slots);
  }
  const rest = sorted.filter((w) => !trunkWishes.includes(w));
  const room = cfg.maxBranches - trunkWishes.length;
  // `since` pins which wishes a narrow tree shows: every wish from that one on.
  // Unlike a count, it stays put as new wishes arrive, so nothing moves.
  const pool = options.since ? rest.filter((w) => compareWishes(w, options.since) >= 0) : rest;
  const cap = options.since ? MAX_BRANCHES - trunkWishes.length : room;
  const branchWishes = cap > 0 ? pool.slice(Math.max(0, pool.length - cap)) : [];
  const hidden = rest.length - branchWishes.length;

  const grid = new Grid();
  const nodes = [];
  const bark = [];
  const trunkFont = cfg.fonts[0];
  const n = trunkWishes.length;
  const spacing = trunkFont * 1.18;
  // Wishes beyond the global cap of 400 thicken the trunk. (Wishes left out
  // only to keep a phone-sized tree readable do not: the trunk is the same tree.)
  const overCap = Math.max(0, sorted.length - MAX_BRANCHES);
  const trunkWidth = n * spacing + Math.sqrt(overCap) * 4;

  // ---- trunk: the earliest wishes rise side by side, then flare into limbs.
  const trunkTexts = trunkWishes.map((w) => displayText(w.text, cfg.trunkChars));
  const trunkLens = trunkTexts.map((t) => textWidthEm(t) * trunkFont);
  const riseTop = Math.min(trunkFont * 6, Math.max(trunkFont * 2.5, Math.min(...trunkLens, Infinity) * 0.4));
  // Split heights must rise toward the middle so no strand flares across a
  // neighbour that is still climbing.
  const splits = trunkWishes.map((w, k) => {
    const o = k - (n - 1) / 2;
    const rng = seededRandom(hashString(w.id + '#split'));
    return Math.min(
      riseTop + ((n - 1) / 2 - Math.abs(o)) * trunkFont * 1.6 + rng() * trunkFont * 0.5,
      Math.max(riseTop, trunkLens[k] * 0.55),
    );
  });
  const mid = (n - 1) / 2;
  for (let k = Math.floor(mid) - 1; k >= 0; k--) splits[k] = Math.min(splits[k], splits[k + 1] - trunkFont * 0.8);
  for (let k = Math.ceil(mid) + 1; k < n; k++) splits[k] = Math.min(splits[k], splits[k - 1] - trunkFont * 0.8);
  for (let k = 0; k < n; k++) splits[k] = Math.max(riseTop * 0.6, splits[k]);

  for (let k = 0; k < n; k++) {
    const wish = trunkWishes[k];
    const rng = seededRandom(hashString(wish.id));
    const o = k - (n - 1) / 2;
    const maxO = (n - 1) / 2;
    const text = trunkTexts[k];
    const font = trunkFont;
    const textLen = trunkLens[k];
    const leafSize = font * 1.1;
    const xb = o * spacing * 1.5;
    const xm = o * spacing;
    const split = splits[k];
    const rise = Math.min(riseTop, split);
    const segs = [[{ x: xb, y: 8 }, { x: xb, y: 8 - rise * 0.5 }, { x: xm, y: -rise * 0.5 }, { x: xm, y: -rise }]];
    if (split > rise + 1) {
      segs.push([{ x: xm, y: -rise }, { x: xm, y: -rise - (split - rise) / 3 }, { x: xm, y: -split + (split - rise) / 3 }, { x: xm, y: -split }]);
    }
    const riseLen = flatten(segs).at(-1).s;
    const flareLen = Math.max(trunkFont * 2, textLen + 4 + leafSize * 1.2 - riseLen);
    const sweep = n === 1 ? 0 : (o / maxO) * 58 * DEG;
    segs.push(arcToCubic({ x: xm, y: -split }, -90 * DEG, sweep, flareLen));
    nodes.push(makeNode({ wish, text, font, depth: 0, parent: null, segs, gap: 4, textLen, leafSize, attachMin: split + trunkFont, rng }));
  }

  // ---- older wishes past the cap: bark rings hugging the trunk.
  if (overCap > 0 && n > 0) {
    const strands = 2 * Math.min(5, Math.ceil(Math.log2(1 + overCap) / 1.6));
    const half = (n - 1) / 2;
    const width = Math.min(5, 2 + Math.log2(1 + overCap) * 0.25);
    for (let i = 0; i < strands; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const layer = Math.floor(i / 2);
      const off = (half + 0.85) * spacing + layer * (width + 2.5);
      const xb = side * off * 1.5;
      const xm = side * off;
      const top = riseTop * (1 - layer * 0.08);
      const segs = [[{ x: xb, y: 8 }, { x: xb, y: 8 - top * 0.5 }, { x: xm, y: -top * 0.5 }, { x: xm, y: -top }]];
      bark.push({ path: segsToPath(segs, false), width: round(width) });
      for (const p of flatten(segs, 16)) grid.add({ x: p.x, y: p.y, r: width / 2 + 2 });
    }
  }

  // ---- branches: each later wish attaches where it fits best.
  let left = 0, right = 0;
  let area = 0;
  for (const node of nodes) area += node.textLen * node.font * 1.2;

  for (const wish of branchWishes) {
    const rng = seededRandom(hashString(wish.id));
    const jitter = rng() * 2 - 1;
    const bendFrac = 0.25 + rng() * 0.35;
    const tieSeed = hashString(wish.id + '#c');
    const targetR = Math.sqrt(area / Math.PI) * 1.5 + trunkFont * 4;
    const rx = targetR * Math.sqrt(cfg.aspect);
    const ry = targetR / Math.sqrt(cfg.aspect);
    const crownY = -(riseTop + ry * 0.85);

    const text = displayText(wish.text, cfg.maxChars);
    const wide = { fracs: [0.12, 0.25, 0.38, 0.5, 0.62, 0.74, 0.86, 0.96], phis: [18, 28, 38, 50, 62, 76, 90], maxDown: 0.45 };
    const placed = tryPlace(PASS_NORMAL) || tryPlace(wide);

    // Same circles as circlesFor, but checked lazily from coarse to fine so a
    // blocked candidate is usually rejected after a few lookups.
    function fits(c) {
      const r = c.font * TEXT_RADIUS_EM;
      const step = c.font * SAMPLE_STEP_EM;
      const from = c.gap + r * 0.6;
      const to = c.gap + c.textW - r * 0.6;
      const floor = -c.font * 1.5;
      const probe = (s, rad) => {
        const p = arcAt(c.at, c.a0, c.sweep, c.len, s);
        return p.y <= floor && !grid.hits({ x: p.x, y: p.y, r: rad });
      };
      if (!probe(c.gap + c.textW + c.leafSize * 0.7, c.leafSize * 0.55)) return false;
      if (!probe(to, r)) return false;
      const count = Math.floor((to - from) / step + 1e-6) + 1;
      for (const k of [8, 4, 2, 1]) {
        // k = 8 checks every 8th sample; each finer pass fills the gaps between.
        for (let i = k === 8 ? 0 : k; i < count; i += k === 8 ? 8 : 2 * k) {
          if (!probe(from + i * step, r)) return false;
        }
      }
      return true;
    }

    function tryPlace(pass) {
      const candidates = [];
      for (const parent of nodes) {
        const depth = parent.depth + 1;
        if (depth > cfg.maxDepth) continue;
        if (parent.children >= cfg.maxChildren[Math.min(parent.depth, cfg.maxChildren.length - 1)]) continue;
        const font = cfg.fonts[Math.min(depth, cfg.fonts.length - 1)];
        const textW = textWidthEm(text) * font;
        const leafSize = font * 1.15;
        for (const frac of pass.fracs) {
          const s = parent.gap + frac * parent.textLen;
          if (s < parent.attachMin) continue;
          const at = polyAt(parent.pts, s);
          for (const side of [-1, 1]) {
            for (const phiDeg of pass.phis) {
              const phi = (phiDeg + jitter * 5) * DEG;
              const a0 = at.a + side * phi;
              const d0 = dir(a0);
              if (d0.y > pass.maxDown) continue; // grow up and out, not down
              const gap = (TEXT_RADIUS_EM * (parent.font + font)) / Math.sin(phi) + 3;
              const len = gap + textW + leafSize * 1.25;
              const sweep = angleDiff(a0, -90 * DEG) * bendFrac;
              const tip = arcAt(at, a0, sweep, len, len);
              const mid = arcAt(at, a0, sweep, len, len / 2);

              // Score: upward and outward, balanced, and close to the crown's shape.
              const up = -Math.sin(tip.a) * 0.6 - d0.y * 0.5;
              const outward = Math.sign(mid.x || side) * d0.x * 0.25 * cfg.aspect;
              const lean = (right - left) / (right + left + 6);
              const balance = -Math.sign(tip.x) * lean * 3;
              const dist = Math.hypot(tip.x / rx, (tip.y - crownY) / ry);
              const spread = -Math.max(0, dist - 1) * 4 - dist * 0.25;
              const low = tip.y > -riseTop ? -2 : 0;
              const crowd = -parent.children * 0.12 - depth * 0.08;
              const tie = (mix(tieSeed + candidates.length) / 4294967296) * 0.35;
              const score = up + outward + balance + spread + low + crowd + tie;
              candidates.push({ score, parent, at, a0, sweep, len, gap, font, textW, leafSize, depth, i: candidates.length });
            }
          }
        }
      }
      candidates.sort((a, b) => b.score - a.score || a.i - b.i);

      for (const c of candidates) {
        if (fits(c)) return c;
      }
      return null;
    }
    if (!placed) continue; // nowhere left without overlap: it thickens the trunk instead
    const segs = [arcToCubic(placed.at, placed.a0, placed.sweep, placed.len)];
    // The same arc from where the text starts: words grow out along this one
    // so they never pass over the parent's letters.
    const growSeg = arcToCubic(
      arcAt(placed.at, placed.a0, placed.sweep, placed.len, placed.gap),
      arcAt(placed.at, placed.a0, placed.sweep, placed.len, placed.gap).a,
      (placed.sweep * (placed.len - placed.gap)) / placed.len,
      placed.len - placed.gap,
    );
    const node = makeNode({
      wish, text, font: placed.font, depth: placed.depth, parent: placed.parent,
      segs, gap: placed.gap, textLen: placed.textW, leafSize: placed.leafSize, attachMin: 0, rng,
    });
    node.growSeg = growSeg;
    placed.parent.children++;
    nodes.push(node);
    area += node.textLen * node.font * 1.2;
    if (node.leaf.x < -2) left++;
    else if (node.leaf.x > 2) right++;
  }

  function makeNode({ wish, text, font, depth, parent, segs, gap, textLen, leafSize, attachMin, rng }) {
    const pts = flatten(segs);
    const total = pts.at(-1).s;
    const tipAt = polyAt(pts, Math.min(total, gap + textLen + leafSize * 0.7));
    const leaf = {
      x: round(tipAt.x), y: round(tipAt.y),
      angle: round(tipAt.a / DEG),
      size: round(leafSize),
      color: LEAF_COLORS[Math.floor(rng() * LEAF_COLORS.length)],
    };
    const textStart = gap;
    const chord = { x: polyAt(pts, textStart + textLen).x - polyAt(pts, textStart).x };
    const reversed = chord.x < -1;
    const node = {
      wish, text, font, depth, parent, segs, pts, total, gap, textLen, leafSize, attachMin, leaf,
      reversed, children: 0,
    };
    for (const c of circlesFor((s) => polyAt(pts, s), gap, textLen, font, leaf)) grid.add(c);
    return node;
  }

  // ---- output
  const branches = nodes.map((nd) => {
    let stem = null;
    if (nd.depth > 0) {
      // From just outside the parent's letters to just before this branch's.
      const pf = nd.parent.font;
      const from = nd.gap * (pf / (pf + nd.font)) * 0.9;
      const to = nd.gap - nd.font * 0.3;
      stem = '';
      for (let i = 0; i <= 6; i++) {
        const p = polyAt(nd.pts, from + ((to - from) * i) / 6);
        stem += `${stem ? 'L' : 'M'}${round(p.x)} ${round(p.y)}`;
      }
    }
    return {
      id: nd.wish.id,
      parentId: nd.parent ? nd.parent.wish.id : null,
      depth: nd.depth,
      text: nd.text,
      path: segsToPath(nd.segs, nd.reversed),
      width: nd.font,
      fontSize: nd.font,
      textStart: round(nd.reversed ? nd.total - nd.gap - nd.textLen : nd.gap),
      textLength: round(nd.textLen),
      stem,
      leaf: nd.leaf,
      base: { x: round(nd.pts[0].x), y: round(nd.pts[0].y) },
      growPath: nd.growSeg ? segsToPath([nd.growSeg], nd.reversed) : null,
      reversed: nd.reversed,
    };
  });

  const bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  for (const nd of nodes) {
    const pad = nd.font * 0.6;
    for (const p of nd.pts) {
      bounds.minX = Math.min(bounds.minX, p.x - pad);
      bounds.maxX = Math.max(bounds.maxX, p.x + pad);
      bounds.minY = Math.min(bounds.minY, p.y - pad);
      bounds.maxY = Math.max(bounds.maxY, p.y + pad);
    }
    bounds.minX = Math.min(bounds.minX, nd.leaf.x - nd.leafSize);
    bounds.maxX = Math.max(bounds.maxX, nd.leaf.x + nd.leafSize);
    bounds.minY = Math.min(bounds.minY, nd.leaf.y - nd.leafSize);
  }
  for (const k of Object.keys(bounds)) bounds[k] = round(bounds[k]);

  return {
    branches,
    bark,
    bounds,
    hidden: hidden + (branchWishes.length - (nodes.length - trunkWishes.length)),
    total: sorted.length,
    trunkWidth: round(trunkWidth),
    minFontSize: nodes.length ? Math.min(...nodes.map((nd) => nd.font)) : trunkFont,
  };
}

// ---------------------------------------------------------------- fitting

/**
 * Scale and offset that fit a layout into a box with the tree's base at the
 * bottom centre. Returns the on-screen size of the smallest text too.
 */
export function fitTree(layout, box, pad = 16) {
  const { minX, minY, maxX } = layout.bounds;
  const halfW = Math.max(1, -minX, maxX);
  const height = Math.max(1, -minY);
  const scale = Math.min((box.width / 2 - pad) / halfW, (box.height - pad) / height);
  return {
    scale,
    x: box.width / 2,
    y: box.height,
    minFontPx: layout.minFontSize * scale,
  };
}

export const MIN_FONT_PX = 11;
export const COMPACT_BREAKPOINT = 640;

/**
 * Picks the layout for a box: the full tree on wide screens; on narrow ones a
 * compact tree with as many branches as fit while text stays >= 11px.
 * `layout` can be a memoised layoutTree. Returns the options used, so a
 * session can keep the same tree as new wishes arrive: layoutTree(wishes, options).
 */
export function chooseLayout(wishes, box, layout = layoutTree) {
  const layoutTreeFn = layout;
  if (box.width >= COMPACT_BREAKPOINT) {
    const layout = layoutTreeFn(wishes);
    return { layout, fit: fitTree(layout, box), options: {} };
  }
  let best = null;
  const byId = new Map(wishes.map((w) => [w.id, w]));
  for (const maxBranches of [40, 32, 26, 20, 15, 11, 8, 6, 4, 2, 1]) {
    const layout = layoutTreeFn(wishes, { compact: true, maxBranches });
    const fit = fitTree(layout, box);
    const oldest = layout.branches.filter((b) => b.depth > 0).reduce((min, b) => {
      const w = byId.get(b.id);
      return !min || compareWishes(w, min) < 0 ? w : min;
    }, null);
    const since = oldest ? { id: oldest.id, createdAt: oldest.createdAt } : null;
    best = { layout, fit, options: { compact: true, maxBranches, ...(since && { since }) } };
    if (fit.minFontPx >= MIN_FONT_PX) break;
  }
  return best;
}

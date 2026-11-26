// layoutJar: where every wish rests inside the jar.
//
// Pure and deterministic: the same wishes (in any order) give the same jar on
// every device. Wishes drop in one at a time, oldest first, and come to rest
// on the pile without overlapping anything. The newest are open paper slips
// you can read; older ones are small folded slips beneath them; the oldest of
// all settle as a layer of paper confetti at the bottom.
//
// Coordinates are SVG-style world units: (0, 0) is the middle of the jar's
// inside floor and the jar rises toward negative y.

import { textWidthEm } from './fontMetrics.js';
import { hashString, seededRandom } from './random.js';

export const MAX_SHOWN = 400;
export const MIN_FONT_PX = 11;
export const COMPACT_BREAKPOINT = 640;

// Paper colours with an ink that reads on each.
export const PAPERS = [
  { name: 'pumpkin', color: '#e07a2e', ink: '#2b1206' },
  { name: 'cranberry', color: '#9e2b3f', ink: '#fcebd9' },
  { name: 'gold', color: '#e2b13c', ink: '#2b1a06' },
  { name: 'olive', color: '#6f7f35', ink: '#f6eedb' },
  { name: 'cinnamon', color: '#8a4b2a', ink: '#fbe9d6' },
  { name: 'maple', color: '#c8552a', ink: '#fff1e0' },
];

const FULL = {
  jar: { width: 760, height: 600, corner: 90 },
  font: 14,
  lineWidth: 230, // longest line on an open slip
  maxLines: 3,
  folds: 80, // folded slips shown below the open ones
  fold: { w: [30, 42], h: 14 },
  openChoices: [64, 52, 44, 36, 30, 25, 20, 16, 12, 9, 6, 4, 2, 1],
};
const COMPACT = {
  jar: { width: 440, height: 640, corner: 70 },
  font: 17,
  lineWidth: 250,
  maxLines: 4,
  folds: 36,
  fold: { w: [28, 38], h: 13 },
  openChoices: [30, 24, 19, 15, 12, 9, 7, 5, 3, 2, 1],
};
export const JAR_PRESETS = { full: FULL, compact: COMPACT };

const GAP = 1.5; // clearance between slips, world units

// ---------------------------------------------------------------- input

function compareWishes(a, b) {
  const ta = Date.parse(a.createdAt) || 0, tb = Date.parse(b.createdAt) || 0;
  if (ta !== tb) return ta - tb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const round = (v) => Math.round(v * 10) / 10;

/** Breaks text into lines no wider than `width` at `font`. */
export function wrapText(text, font, width) {
  const words = String(text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  const fits = (s) => textWidthEm(s) * font <= width;
  for (let word of words) {
    // A word longer than a whole line is broken by characters.
    while (!fits(word)) {
      let cut = [...word];
      let n = cut.length - 1;
      while (n > 1 && !fits(cut.slice(0, n).join(''))) n--;
      if (line) { lines.push(line); line = ''; }
      lines.push(cut.slice(0, n).join(''));
      word = cut.slice(n).join('');
    }
    const next = line ? `${line} ${word}` : word;
    if (fits(next)) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// ---------------------------------------------------------------- geometry

function cornersOf(s) {
  const c = Math.cos(s.rad), n = Math.sin(s.rad);
  const hw = s.w / 2 + GAP / 2, hh = s.h / 2 + GAP / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => ({ x: s.x + x * c - y * n, y: s.y + x * n + y * c }));
}

function overlaps(a, b) {
  // Separating axis test for two rotated rectangles.
  for (const poly of [a, b]) {
    for (let i = 0; i < 2; i++) {
      const p = poly[i], q = poly[i + 1];
      const ax = q.y - p.y, ay = p.x - q.x;
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const v of a) { const d = v.x * ax + v.y * ay; minA = Math.min(minA, d); maxA = Math.max(maxA, d); }
      for (const v of b) { const d = v.x * ax + v.y * ay; minB = Math.min(minB, d); maxB = Math.max(maxB, d); }
      if (maxA <= minB || maxB <= minA) return false;
    }
  }
  return true;
}

/** True if a point is inside the jar's body above `floor` (a negative y). */
export function insideJar(jar, p, floor = 0) {
  const { width, height, corner } = jar;
  if (p.y > floor + 1e-9 || p.y < -height) return false;
  let half = width / 2;
  if (p.y > -corner) {
    const dy = p.y + corner;
    half = width / 2 - corner + Math.sqrt(Math.max(0, corner * corner - dy * dy));
  }
  return Math.abs(p.x) <= half + 1e-9;
}

// ---------------------------------------------------------------- the pile

class Pile {
  constructor(jar, floor) {
    this.jar = jar;
    this.floor = floor;
    this.cell = 80;
    this.grid = new Map();
  }
  keys(box) {
    const out = [];
    for (let i = Math.floor(box.x0 / this.cell); i <= Math.floor(box.x1 / this.cell); i++) {
      for (let j = Math.floor(box.y0 / this.cell); j <= Math.floor(box.y1 / this.cell); j++) out.push(`${i},${j}`);
    }
    return out;
  }
  fits(corners) {
    for (const p of corners) if (!insideJar(this.jar, p, this.floor)) return false;
    const box = bbox(corners);
    const seen = new Set();
    for (const k of this.keys(box)) {
      for (const other of this.grid.get(k) || []) {
        if (seen.has(other)) continue;
        seen.add(other);
        if (box.x1 <= other.box.x0 || other.box.x1 <= box.x0 || box.y1 <= other.box.y0 || other.box.y1 <= box.y0) continue;
        if (overlaps(corners, other.corners)) return false;
      }
    }
    return true;
  }
  add(corners) {
    const item = { corners, box: bbox(corners) };
    for (const k of this.keys(item.box)) {
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(item);
    }
  }
  /**
   * Drops a slip (w, h, rad) straight down at several x positions and keeps
   * the one that comes to rest lowest, nudged toward its own preferred spot.
   * Returns {x, y} or null when the jar is too full for it.
   */
  drop(slip, preferX, rng) {
    const { width, height } = this.jar;
    // Half the rotated slip's extent, including the clearance gap.
    const w = slip.w + GAP, h = slip.h + GAP;
    const reach = (Math.abs(Math.cos(slip.rad)) * w + Math.abs(Math.sin(slip.rad)) * h) / 2;
    const tall = (Math.abs(Math.sin(slip.rad)) * w + Math.abs(Math.cos(slip.rad)) * h) / 2;
    const span = width / 2 - reach - 1;
    if (span < 0) return null;
    const xs = [preferX];
    const columns = 13;
    for (let i = 0; i < columns; i++) xs.push(-span + ((i + 0.3 + rng() * 0.4) / columns) * 2 * span);

    let best = null;
    for (const raw of xs) {
      const x = Math.max(-span, Math.min(span, raw));
      const at = (y) => cornersOf({ ...slip, x, y });
      let y = -height + tall + 1;
      if (!this.fits(at(y))) continue; // this column is full to the brim
      const step = 6;
      while (y + step <= this.floor && this.fits(at(y + step))) y += step;
      let lo = y, hi = y + step;
      for (let i = 0; i < 5; i++) {
        const mid = (lo + hi) / 2;
        if (this.fits(at(mid))) lo = mid; else hi = mid;
      }
      const score = lo - Math.abs(x - preferX) * 0.04;
      if (!best || score > best.score) best = { x, y: lo, score };
    }
    return best;
  }
}

function bbox(corners) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of corners) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}

// ---------------------------------------------------------------- layout

/**
 * @param {Array<{id:string,text:string,name?:string,createdAt:string}>} wishes
 * @param {{compact?: boolean, open?: number, since?: {id:string, createdAt:string}}} [options]
 *   compact: the narrow-screen jar. open: how many of the newest wishes are
 *   open, readable slips. since: instead, every wish from this one on is open
 *   (so a session's jar keeps its slips as new wishes arrive).
 * @returns {{
 *   jar: {width:number, height:number, corner:number},
 *   slips: Array<{id:string, kind:'open'|'folded', x:number, y:number, angle:number,
 *     width:number, height:number, color:string, ink:string, paper:string,
 *     fontSize:number, lines:string[], text:string}>,
 *   confetti: {count:number, height:number},
 *   overflow: number, total:number, fontSize:number
 * }}
 *   Slips are in drop order (bottom of the pile first). `overflow` counts
 *   open or folded slips that found no room; a caller should open fewer.
 */
export function layoutJar(wishes, options = {}) {
  const cfg = options.compact ? COMPACT : FULL;
  const jar = { ...cfg.jar };
  const sorted = [...wishes].sort(compareWishes);

  let openCount;
  if (options.since) openCount = sorted.filter((w) => compareWishes(w, options.since) >= 0).length;
  else openCount = options.open ?? cfg.openChoices[0];
  openCount = Math.min(openCount, sorted.length, MAX_SHOWN);
  const foldCount = Math.min(cfg.folds, sorted.length - openCount, MAX_SHOWN - openCount);
  const confettiCount = sorted.length - openCount - foldCount;

  const open = sorted.slice(sorted.length - openCount);
  const folded = sorted.slice(sorted.length - openCount - foldCount, sorted.length - openCount);

  // The oldest wishes become a bed of paper confetti; it grows slowly.
  const confettiHeight = confettiCount ? round(Math.min(150, 12 + 9 * Math.log2(1 + confettiCount))) : 0; // 404 -> 90, 10k -> 132
  const pile = new Pile(jar, -confettiHeight);

  const slips = [];
  let overflow = 0;
  const place = (wish, kind) => {
    const rng = seededRandom(hashString(wish.id));
    const paper = PAPERS[Math.floor(rng() * PAPERS.length)];
    let w, h, lines = [], fontSize = 0, deg;
    if (kind === 'open') {
      fontSize = cfg.font;
      lines = wrapText(wish.text, fontSize, cfg.lineWidth);
      if (lines.length > cfg.maxLines) lines = wrapText(wish.text, fontSize, (cfg.lineWidth * lines.length) / cfg.maxLines + fontSize);
      const longest = Math.max(...lines.map((l) => textWidthEm(l) * fontSize));
      w = longest + fontSize * 1.5;
      h = lines.length * fontSize * 1.25 + fontSize * 0.9;
      deg = (rng() * 2 - 1) * 11;
    } else {
      w = cfg.fold.w[0] + rng() * (cfg.fold.w[1] - cfg.fold.w[0]);
      h = cfg.fold.h;
      deg = (rng() * 2 - 1) * 35;
    }
    const preferX = (rng() * 2 - 1) * jar.width * 0.4;
    const slip = { w, h, rad: (deg * Math.PI) / 180 };
    const spot = pile.drop(slip, preferX, rng);
    if (!spot) {
      overflow++;
      return;
    }
    pile.add(cornersOf({ ...slip, x: spot.x, y: spot.y }));
    slips.push({
      id: wish.id, kind,
      x: round(spot.x), y: round(spot.y), angle: round(deg),
      width: round(w), height: round(h),
      color: paper.color, ink: paper.ink, paper: paper.name,
      fontSize, lines, text: wish.text,
    });
  };
  for (const w of folded) place(w, 'folded');
  for (const w of open) place(w, 'open');

  return {
    jar,
    slips,
    confetti: { count: confettiCount, height: confettiHeight },
    overflow,
    total: sorted.length,
    fontSize: cfg.font,
  };
}

// ---------------------------------------------------------------- fitting

// The glass around the inside of the jar, in world units.
export const GLASS = { wall: 16, floor: 18, neck: 74, rim: 18 };

/** The jar's outer size for a layout. */
export function jarSize(layout) {
  const { width, height } = layout.jar;
  return { width: width + GLASS.wall * 2, height: height + GLASS.floor + GLASS.neck + GLASS.rim };
}

/**
 * Scale and position that fit the jar into a box, standing on its bottom
 * centre. `x, y` is where the jar's inside floor centre lands.
 */
export function fitJar(layout, box, pad = 16) {
  const size = jarSize(layout);
  const scale = Math.min((box.width - pad * 2) / size.width, (box.height - pad) / size.height, 1.25);
  return {
    scale,
    x: box.width / 2,
    y: box.height - GLASS.floor * scale,
    minFontPx: layout.fontSize * scale,
  };
}

/**
 * Picks the jar for a box: as many open slips as fit, with text >= 11px.
 * Returns the options used, so a session can keep the same jar as wishes
 * arrive: layoutJar(wishes, options).
 */
export function chooseJar(wishes, box, layout = layoutJar) {
  const compact = box.width < COMPACT_BREAKPOINT;
  const cfg = compact ? COMPACT : FULL;
  const sorted = [...wishes].sort(compareWishes);
  let best = null;
  for (const open of cfg.openChoices) {
    const result = layout(wishes, { compact, open });
    best = { layout: result, fit: fitJar(result, box), open };
    if (!result.overflow) break;
  }
  const opened = Math.min(best.open, sorted.length);
  const oldestOpen = sorted[sorted.length - opened];
  const options = { compact, ...(oldestOpen ? { since: { id: oldestOpen.id, createdAt: oldestOpen.createdAt } } : { open: best.open }) };
  return { layout: best.layout, fit: best.fit, options };
}

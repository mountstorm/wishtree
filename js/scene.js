// The backdrop and the glass: a near-black room, a warm candle-like glow,
// a few drifting leaves, and the jar itself (drawn behind and in front of
// the slips so they sit inside the glass).

import { seededRandom } from './random.js';
import { GLASS } from './layoutJar.js';

export const SVG_NS = 'http://www.w3.org/2000/svg';

export function el(name, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (parent) parent.appendChild(node);
  return node;
}

// A leaf one unit long pointing along +x from its stem at the origin.
export const LEAF_PATH = 'M0 0C.25-.42.78-.42 1 0 .78.42.25.42 0 0Z';
export const FALL_COLORS = ['#e07a2e', '#9e2b3f', '#e2b13c', '#6f7f35', '#8a4b2a', '#c8552a'];

/** Glow and drifting leaves, in screen pixels. `jarCentre` is where the glow sits. */
export function drawRoom(svg, width, height, jarCentre, jarWidth) {
  const defs = el('defs', {}, svg);
  const glow = el('radialGradient', { id: 'candle' }, defs);
  el('stop', { offset: 0, 'stop-color': '#ffb25e', 'stop-opacity': 0.34 }, glow);
  el('stop', { offset: 0.45, 'stop-color': '#e2702a', 'stop-opacity': 0.12 }, glow);
  el('stop', { offset: 1, 'stop-color': '#c8552a', 'stop-opacity': 0 }, glow);
  const r = Math.max(jarWidth * 0.95, 260);
  el('ellipse', { cx: jarCentre.x, cy: jarCentre.y, rx: r, ry: r * 1.05, fill: 'url(#candle)', class: 'candle' }, svg);

  // A few leaves drifting down through the dark, always the same ones.
  const leaves = el('g', { class: 'drift', 'aria-hidden': 'true' }, svg);
  const rng = seededRandom(1126);
  const count = Math.round(Math.min(14, Math.max(6, width / 110)));
  for (let i = 0; i < count; i++) {
    const x = rng() * width;
    const size = 7 + rng() * 9;
    const g = el('g', { transform: `translate(${x.toFixed(1)} 0)` }, leaves);
    el('path', {
      d: LEAF_PATH,
      fill: FALL_COLORS[i % FALL_COLORS.length],
      class: 'drift-leaf',
      style: [
        `--fall:${(height + 60).toFixed(0)}px`,
        `--start:${(-40 + rng() * height).toFixed(0)}px`,
        `--spin:${Math.round(rng() * 360)}deg`,
        `--size:${size.toFixed(1)}`,
        `animation-duration:${(22 + rng() * 22).toFixed(1)}s`,
        `animation-delay:${(-rng() * 40).toFixed(1)}s`,
        `opacity:${(0.18 + rng() * 0.22).toFixed(2)}`,
      ].join(';'),
    }, g);
  }
  return defs;
}

/** The jar's outline in world units around an inside of width x height. */
export function jarPath(jar) {
  const { width, height, corner } = jar;
  const w = width / 2, wall = GLASS.wall;
  const R = corner + wall;
  const neckHalf = width * (width > 600 ? 0.33 : 0.38);
  const top = -height;
  const shoulder = GLASS.neck * 0.55;
  const neckTop = top - GLASS.neck;
  const n = neckHalf + wall;
  return [
    `M${-n} ${neckTop}`,
    `L${-n} ${top - shoulder}`,
    `C${-n} ${top - shoulder * 0.35} ${-w - wall} ${top - shoulder * 0.45} ${-w - wall} ${top + shoulder * 0.4}`,
    `L${-w - wall} ${-corner}`,
    `A${R} ${R} 0 0 0 ${-(w - corner)} ${wall}`,
    `L${w - corner} ${wall}`,
    `A${R} ${R} 0 0 0 ${w + wall} ${-corner}`,
    `L${w + wall} ${top + shoulder * 0.4}`,
    `C${w + wall} ${top - shoulder * 0.45} ${n} ${top - shoulder * 0.35} ${n} ${top - shoulder}`,
    `L${n} ${neckTop}`,
  ].join('');
}

/** The inside of the jar's body, for clipping the confetti bed. */
function insidePath(jar) {
  const { width, height, corner } = jar;
  const w = width / 2;
  return `M${-w} ${-height}L${-w} ${-corner}A${corner} ${corner} 0 0 0 ${-(w - corner)} 0L${w - corner} 0A${corner} ${corner} 0 0 0 ${w} ${-corner}L${w} ${-height}Z`;
}

/** Where wishes enter: just inside the neck, below the rim. */
export function mouthOf(jar) {
  return { x: 0, y: -jar.height - GLASS.neck * 0.45 };
}

/** Glass behind the slips: the faint body and the back of the rim. */
export function drawJarBack(group, defs, jar) {
  const glass = el('linearGradient', { id: 'glass-body', x1: 0, x2: 1, y1: 0, y2: 0 }, defs);
  el('stop', { offset: 0, 'stop-color': '#fff1dc', 'stop-opacity': 0.1 }, glass);
  el('stop', { offset: 0.5, 'stop-color': '#fff1dc', 'stop-opacity': 0.025 }, glass);
  el('stop', { offset: 1, 'stop-color': '#fff1dc', 'stop-opacity': 0.08 }, glass);
  el('path', { d: `${jarPath(jar)}Z`, fill: 'url(#glass-body)', class: 'jar-back' }, group);
  el('clipPath', { id: 'jar-inside' }, defs).appendChild(el('path', { d: insidePath(jar) }));
}

/** The bed of confetti that the oldest wishes become. */
export function drawConfetti(group, jar, confetti) {
  if (!confetti.count) return;
  const bed = el('g', { 'clip-path': 'url(#jar-inside)', class: 'confetti', 'aria-hidden': 'true' }, group);
  const h = confetti.height;
  el('rect', { x: -jar.width / 2, y: -h, width: jar.width, height: h + 2, fill: '#3a1d10' }, bed);
  const rng = seededRandom(7 + confetti.count);
  const specks = Math.round(Math.min(900, (jar.width * h) / 26));
  for (let i = 0; i < specks; i++) {
    const w = 5 + rng() * 9, ht = 3 + rng() * 4;
    el('rect', {
      x: (-jar.width / 2 + rng() * jar.width).toFixed(1),
      y: (-h + rng() * h).toFixed(1),
      width: w.toFixed(1), height: ht.toFixed(1),
      fill: FALL_COLORS[Math.floor(rng() * FALL_COLORS.length)],
      opacity: (0.45 + rng() * 0.45).toFixed(2),
      transform: `rotate(${Math.round(rng() * 180 - 90)})`,
      'transform-origin': 'center', 'transform-box': 'fill-box',
    }, bed);
  }
}

/** Glass in front of the slips: highlights, outline, rim, twine and a tag. */
export function drawJarFront(group, defs, jar) {
  const front = el('g', { class: 'jar-front', 'aria-hidden': 'true' }, group);
  const shine = el('linearGradient', { id: 'glass-shine', x1: 0, x2: 1, y1: 0, y2: 0 }, defs);
  el('stop', { offset: 0, 'stop-color': '#fff6ea', 'stop-opacity': 0 }, shine);
  el('stop', { offset: 0.5, 'stop-color': '#fff6ea', 'stop-opacity': 0.2 }, shine);
  el('stop', { offset: 1, 'stop-color': '#fff6ea', 'stop-opacity': 0 }, shine);
  const { width, height, corner } = jar;
  const w = width / 2;
  // Two soft vertical reflections.
  el('rect', { x: -w + 18, y: -height + 30, width: 26, height: height - corner - 20, rx: 13, fill: 'url(#glass-shine)' }, front);
  el('rect', { x: w - 40, y: -height + 60, width: 12, height: height * 0.45, rx: 6, fill: 'url(#glass-shine)', opacity: 0.7 }, front);
  el('path', { d: jarPath(jar), class: 'jar-outline' }, front);

  // The rim: a lip of glass at the mouth.
  const neckHalf = width * (width > 600 ? 0.33 : 0.38) + GLASS.wall;
  const neckTop = -height - GLASS.neck;
  el('rect', { x: -neckHalf - 8, y: neckTop - GLASS.rim, width: (neckHalf + 8) * 2, height: GLASS.rim, rx: GLASS.rim / 2, class: 'jar-rim' }, front);

  // Twine wrapped around the neck, with a little tag.
  const twineY = neckTop + GLASS.neck * 0.32;
  for (let i = 0; i < 3; i++) {
    const y = twineY + i * 5;
    el('path', { d: `M${-neckHalf - 2} ${y}Q0 ${y + 7} ${neckHalf + 2} ${y}`, class: 'twine' }, front);
  }
  const knotX = neckHalf * 0.45;
  el('path', { d: `M${knotX} ${twineY + 6}q-14 18 -6 40`, class: 'twine' }, front);
  el('path', { d: `M${knotX} ${twineY + 6}q12 16 22 30`, class: 'twine' }, front);
  const tag = el('g', { transform: `translate(${knotX + 12} ${twineY + 34}) rotate(-8)` }, front);
  el('rect', { x: 0, y: 0, width: 74, height: 30, rx: 3, class: 'tag' }, tag);
  el('circle', { cx: 8, cy: 15, r: 2.6, class: 'tag-hole' }, tag);
  const label = el('text', { x: 43, y: 20, class: 'tag-text', 'text-anchor': 'middle' }, tag);
  label.textContent = 'wishes';
}

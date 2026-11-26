// The backdrop: stars in the dusk sky and the curve of a small autumn Earth.
// Sky colour itself is a CSS gradient on the page.

import { seededRandom } from './layoutTree.js';

export const SVG_NS = 'http://www.w3.org/2000/svg';

export function el(name, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (parent) parent.appendChild(node);
  return node;
}

/** Where the ground sits for a viewport: the top of the Earth's curve. */
export function groundFor(width, height, minGround = 0) {
  const groundH = Math.round(Math.max(minGround, Math.min(150, Math.max(78, height * 0.13))));
  const radius = Math.max(width * 0.78, 460);
  return { groundY: height - groundH, radius, cx: width / 2 };
}

export function drawScene(svg, width, height, minGround = 0) {
  const { groundY, radius, cx } = groundFor(width, height, minGround);
  const defs = el('defs', {}, svg);

  const earth = el('radialGradient', { id: 'earth-fill', cx: 0.5, cy: 0, r: 0.6, fx: 0.5, fy: 0 }, defs);
  el('stop', { offset: 0, 'stop-color': '#c9772f' }, earth);
  el('stop', { offset: 0.06, 'stop-color': '#9c4a22' }, earth);
  el('stop', { offset: 0.22, 'stop-color': '#5e2a18' }, earth);
  el('stop', { offset: 1, 'stop-color': '#2a1410' }, earth);

  const glow = el('radialGradient', { id: 'horizon-glow' }, defs);
  el('stop', { offset: 0, 'stop-color': '#ffc37a', 'stop-opacity': 0.55 }, glow);
  el('stop', { offset: 1, 'stop-color': '#ffc37a', 'stop-opacity': 0 }, glow);

  // Stars: a fixed pattern scaled to the viewport, thinning toward the horizon.
  const stars = el('g', { class: 'stars', 'aria-hidden': 'true' }, svg);
  const rng = seededRandom(20261126);
  const count = Math.round(Math.min(70, Math.max(28, (width * height) / 22000)));
  for (let i = 0; i < count; i++) {
    const x = rng() * width;
    const y = Math.pow(rng(), 1.6) * groundY * 0.72;
    const r = 0.5 + rng() * 1.1;
    el('circle', {
      cx: x.toFixed(1), cy: y.toFixed(1), r: r.toFixed(2),
      class: 'star', style: `animation-delay:${(-rng() * 6).toFixed(2)}s;animation-duration:${(3 + rng() * 4).toFixed(2)}s`,
    }, stars);
  }

  // Warm light along the horizon, then the planet.
  el('ellipse', { cx, cy: groundY + 10, rx: Math.max(width * 0.7, 360), ry: Math.max(120, height * 0.2), fill: 'url(#horizon-glow)' }, svg);
  el('circle', { cx, cy: groundY + radius, r: radius + 3, fill: '#f6b86b', opacity: 0.45 }, svg);
  el('circle', { cx, cy: groundY + radius, r: radius, fill: 'url(#earth-fill)', class: 'earth' }, svg);

  // Fallen leaves scattered on the ground.
  const ground = el('g', { 'aria-hidden': 'true' }, svg);
  const leafColors = ['#e8762b', '#a4243b', '#e3b23c', '#7a8b3a'];
  const leaves = Math.round(Math.min(40, width / 30));
  for (let i = 0; i < leaves; i++) {
    const x = rng() * width;
    const dx = x - cx;
    const surface = groundY + radius - Math.sqrt(Math.max(0, radius * radius - dx * dx));
    const y = surface + 6 + rng() * Math.min(60, height - surface - 8);
    const size = 4 + rng() * 4;
    el('path', {
      d: LEAF_PATH,
      fill: leafColors[i % 4],
      opacity: (0.55 + rng() * 0.35).toFixed(2),
      transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${Math.round(rng() * 360)}) scale(${size.toFixed(1)})`,
    }, ground);
  }

  return { defs, groundY };
}

// A leaf one unit long pointing along +x from its stem at the origin.
export const LEAF_PATH = 'M0 0C.25-.42.78-.42 1 0 .78.42.25.42 0 0Z';

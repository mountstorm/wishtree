// Draws a layout from layoutTree into an SVG group. Wish text is only ever set
// with textContent.

import { el, LEAF_PATH } from './scene.js';

export function treeTransform({ scale, x, y }) {
  return `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${scale.toFixed(4)})`;
}

/**
 * @returns {{group: SVGGElement, parts: Map<string, {text, textPath, path, stem, leaf, branch}>}}
 */
let generation = 0;

// A four-point sparkle one unit across, centred on the origin.
const SPARKLE = 'M0-1C.08-.3.3-.08 1 0 .3.08.08.3 0 1-.08.3-.3.08-1 0-.3-.08-.08-.3 0-1Z';

/** Marks a branch as the visitor's own: a lasting soft glow and a sparkle by its leaf. */
export function markMine(part) {
  if (part.text.classList.contains('mine')) return;
  part.text.classList.add('mine');
  const { leaf, fontSize } = part.branch;
  const a = (leaf.angle * Math.PI) / 180;
  const d = leaf.size * 1.25;
  const x = leaf.x + Math.cos(a) * d + Math.sin(a) * leaf.size * 0.5;
  const y = leaf.y + Math.sin(a) * d - Math.cos(a) * leaf.size * 0.5;
  const g = part.text.ownerSVGElement.querySelector('.markers') || part.text.parentNode;
  const spark = el('g', { class: 'mine-marker', transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})`, 'aria-hidden': 'true' }, g);
  el('path', { d: SPARKLE, transform: `scale(${(fontSize * 0.55).toFixed(2)})` }, spark);
}

export function drawTree(parent, defs, layout, fit, sky, { mine = new Set() } = {}) {
  // Ids are unique per drawing, so an old copy of the tree can fade out on top
  // of the new one without their paths getting mixed up.
  const prefix = `t${++generation}-`;
  const { scale, y } = fit;
  const group = el('g', { class: 'tree', transform: treeTransform(fit) }, parent);

  // Text colour follows the sky behind it: cream against the indigo, deep
  // bark against the amber near the horizon. Coordinates are tree-local.
  const ink = el('linearGradient', {
    id: `${prefix}ink`, gradientUnits: 'userSpaceOnUse',
    x1: 0, x2: 0, y1: ((sky.top - y) / scale).toFixed(1), y2: ((sky.bottom - y) / scale).toFixed(1),
  }, defs);
  el('stop', { offset: 0, 'stop-color': '#fff3e2' }, ink);
  el('stop', { offset: 0.5, 'stop-color': '#fbe3c4' }, ink);
  // A hard switch: any blend in between would match the sky and vanish.
  el('stop', { offset: 0.715, 'stop-color': '#f7d3a4' }, ink);
  el('stop', { offset: 0.715, 'stop-color': '#3d1c0f' }, ink);
  el('stop', { offset: 1, 'stop-color': '#3a1a0e' }, ink);

  const bark = el('g', { class: 'bark', 'aria-hidden': 'true' }, group);
  for (const b of layout.bark) el('path', { d: b.path, 'stroke-width': b.width }, bark);

  const stems = el('g', { class: 'stems', 'aria-hidden': 'true' }, group);
  const words = el('g', { class: 'words' }, group);
  const leaves = el('g', { class: 'leaves', 'aria-hidden': 'true' }, group);
  el('g', { class: 'markers', 'aria-hidden': 'true' }, group);

  const parts = new Map();
  layout.branches.forEach((b, i) => {
    const pathId = `${prefix}branch-${i}`;
    const path = el('path', { id: pathId, d: b.path, fill: 'none' }, defs);
    const growPath = b.growPath ? el('path', { id: `${prefix}grow-${i}`, d: b.growPath, fill: 'none' }, defs) : null;
    const stem = b.stem ? el('path', { d: b.stem, 'stroke-width': (b.fontSize / 9).toFixed(2) }, stems) : null;

    const text = el('text', {
      class: `branch depth-${Math.min(b.depth, 3)}`,
      'font-size': b.fontSize,
      dy: '0.34em',
      fill: `url(#${prefix}ink)`,
      'data-id': b.id,
    }, words);
    const textPath = el('textPath', {
      href: `#${pathId}`,
      startOffset: b.textStart,
      textLength: b.textLength,
      lengthAdjust: 'spacing',
    }, text);
    textPath.textContent = b.text;

    const leafPos = el('g', { transform: `translate(${b.leaf.x} ${b.leaf.y}) rotate(${b.leaf.angle})` }, leaves);
    const leaf = el('path', { d: LEAF_PATH, fill: b.leaf.color, transform: `scale(${b.leaf.size})` }, leafPos);

    const part = { text, textPath, path, growPath, stem, leaf, branch: b };
    parts.set(b.id, part);
  });
  for (const id of mine) if (parts.has(id)) markMine(parts.get(id));
  return { group, parts };
}

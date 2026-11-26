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

export function drawTree(parent, defs, layout, fit, sky) {
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

    parts.set(b.id, { text, textPath, path, growPath, stem, leaf, branch: b });
  });
  return { group, parts };
}

// Draws a layout from layoutTree into an SVG group. Wish text is only ever set
// with textContent.

import { el, LEAF_PATH } from './scene.js';

export function drawTree(parent, defs, layout, fit, sky) {
  const { scale, x, y } = fit;
  const g = el('g', { class: 'tree', transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${scale.toFixed(4)})` }, parent);

  // Text colour follows the sky behind it: cream against the indigo, deep
  // bark against the amber near the horizon. Coordinates are tree-local.
  const ink = el('linearGradient', {
    id: 'ink', gradientUnits: 'userSpaceOnUse',
    x1: 0, x2: 0, y1: ((sky.top - y) / scale).toFixed(1), y2: ((sky.bottom - y) / scale).toFixed(1),
  }, defs);
  el('stop', { offset: 0, 'stop-color': '#fff3e2' }, ink);
  el('stop', { offset: 0.5, 'stop-color': '#fbe3c4' }, ink);
  el('stop', { offset: 0.72, 'stop-color': '#f7d3a4' }, ink);
  el('stop', { offset: 0.735, 'stop-color': '#4a2414' }, ink);
  el('stop', { offset: 1, 'stop-color': '#3a1a0e' }, ink);

  const bark = el('g', { class: 'bark', 'aria-hidden': 'true' }, g);
  for (const b of layout.bark) el('path', { d: b.path, 'stroke-width': b.width }, bark);

  const stems = el('g', { class: 'stems', 'aria-hidden': 'true' }, g);
  const words = el('g', { class: 'words' }, g);
  const leaves = el('g', { class: 'leaves', 'aria-hidden': 'true' }, g);

  layout.branches.forEach((b, i) => {
    const pathId = `branch-${i}`;
    el('path', { id: pathId, d: b.path, fill: 'none' }, defs);
    if (b.stem) el('path', { d: b.stem, 'stroke-width': (b.fontSize / 9).toFixed(2) }, stems);

    const text = el('text', {
      class: `branch depth-${Math.min(b.depth, 3)}`,
      'font-size': b.fontSize,
      dy: '0.34em',
      fill: 'url(#ink)',
      'data-id': b.id,
    }, words);
    const tp = el('textPath', {
      href: `#${pathId}`,
      startOffset: b.textStart,
      textLength: b.textLength,
      lengthAdjust: 'spacing',
    }, text);
    tp.textContent = b.text;

    el('path', {
      d: LEAF_PATH,
      fill: b.leaf.color,
      transform: `translate(${b.leaf.x} ${b.leaf.y}) rotate(${b.leaf.angle}) scale(${b.leaf.size})`,
    }, leaves);
  });
  return g;
}

// Draws a jar layout's slips. Wish text is only ever set with textContent.

import { el } from './scene.js';

// A four-point sparkle one unit across, centred on the origin.
const SPARKLE = 'M0-1C.08-.3.3-.08 1 0 .3.08.08.3 0 1-.08.3-.3.08-1 0-.3-.08-.08-.3 0-1Z';

export const slipTransform = (x, y, angle, scale = 1) =>
  `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${angle.toFixed(2)})${scale !== 1 ? ` scale(${scale.toFixed(3)})` : ''}`;

/** Marks a slip as the visitor's own: a lasting glow and a sparkle at its corner. */
export function markMine(part) {
  if (part.node.classList.contains('mine')) return;
  part.node.classList.add('mine');
  const { width, height, fontSize } = part.slip;
  const size = Math.max(7, (fontSize || 12) * 0.6);
  el('path', { d: SPARKLE, class: 'mine-spark', transform: `translate(${(width / 2 - 2).toFixed(1)} ${(-height / 2 - 2).toFixed(1)}) scale(${size.toFixed(1)})` }, part.node);
}

/**
 * @returns {Map<string, {node: SVGGElement, slip: object}>}
 */
export function drawSlips(group, defs, layout, { mine = new Set() } = {}) {
  const paper = el('linearGradient', { id: 'paper-light', x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
  el('stop', { offset: 0, 'stop-color': '#fff', 'stop-opacity': 0.16 }, paper);
  el('stop', { offset: 0.55, 'stop-color': '#fff', 'stop-opacity': 0 }, paper);
  el('stop', { offset: 1, 'stop-color': '#000', 'stop-opacity': 0.12 }, paper);

  const slips = el('g', { class: 'slips' }, group);
  const parts = new Map();
  for (const s of layout.slips) {
    const node = el('g', {
      class: `slip ${s.kind}`,
      transform: slipTransform(s.x, s.y, s.angle),
      'data-id': s.id,
    }, slips);
    const x = -s.width / 2, y = -s.height / 2;
    el('rect', { x: x + 1.2, y: y + 2, width: s.width, height: s.height, rx: 2.5, class: 'slip-shadow' }, node);
    el('rect', { x, y, width: s.width, height: s.height, rx: s.kind === 'open' ? 2.5 : 1.8, fill: s.color }, node);
    el('rect', { x, y, width: s.width, height: s.height, rx: 2.5, fill: 'url(#paper-light)' }, node);
    if (s.kind === 'open') {
      // One soft crease where the slip was folded before it was opened.
      el('line', { x1: x + s.width * 0.36, y1: y + 1, x2: x + s.width * 0.36, y2: y + s.height - 1, class: 'crease' }, node);
      const text = el('text', { class: 'slip-text', fill: s.ink, 'font-size': s.fontSize, 'text-anchor': 'middle' }, node);
      // The lines are separate tspans; give assistive tech the wish as one phrase.
      text.setAttribute('aria-label', s.text);
      const lineH = s.fontSize * 1.25;
      const top = -(s.lines.length * lineH) / 2;
      s.lines.forEach((line, i) => {
        const span = el('tspan', { x: 0, y: (top + i * lineH + lineH * 0.74).toFixed(1) }, text);
        span.textContent = line;
      });
    } else {
      // A folded slip: a diagonal fold line and nothing to read.
      el('line', { x1: x + s.width * 0.3, y1: y, x2: x + s.width * 0.62, y2: y + s.height, class: 'crease' }, node);
    }
    const part = { node, slip: s };
    parts.set(s.id, part);
    if (mine.has(s.id)) markMine(part);
  }
  return parts;
}

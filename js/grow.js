// The journey of a new wish: it falls from the sky with a gentle sway, lands
// on the Earth as a glowing seed, rises to its branch and grows along it.
// Cosmetic randomness (where it starts, how it sways) may use Math.random;
// the tree itself never does.

import { treeTransform } from './treeView.js';

const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
const lerp = (a, b, t) => a + (b - a) * t;

/** Runs fn(progress) every frame for `ms`; resolves false if cancelled. */
function tween(ms, fn, token) {
  return new Promise((resolve) => {
    const start = performance.now();
    function frame(now) {
      if (token.cancelled) return resolve(false);
      const t = Math.min(1, (now - start) / ms);
      fn(t);
      if (t < 1) requestAnimationFrame(frame);
      else resolve(true);
    }
    requestAnimationFrame(frame);
  });
}

/**
 * Where the words wait before growing: on the branch's growPath (which starts
 * where the text starts), just past the end that touches the parent. Text
 * positioned off a path is not drawn, so the words slide out from there
 * without ever crossing the parent's letters.
 */
function growGeometry(part) {
  const { branch, path, growPath } = part;
  const on = growPath || path;
  const len = on.getTotalLength();
  const settled = growPath ? (branch.reversed ? branch.textStart : 0) : branch.textStart;
  const hidden = branch.reversed ? len + 2 : settled - branch.textLength - 2;
  return { on, settled, hidden };
}

const refTo = (node) => `#${node.id}`;

/** Puts a freshly drawn branch into its "not grown yet" state. */
export function hideBranch(part) {
  const { textPath, stem, leaf } = part;
  const g = growGeometry(part);
  textPath.setAttribute('href', refTo(g.on));
  textPath.setAttribute('startOffset', g.hidden);
  if (stem) {
    const len = stem.getTotalLength();
    stem.style.strokeDasharray = `${len} ${len}`;
    stem.style.strokeDashoffset = String(len);
  }
  leaf.setAttribute('transform', 'scale(0)');
}

export function showBranch(part, { withLeaf = true } = {}) {
  const { textPath, path, stem, leaf, branch } = part;
  textPath.setAttribute('href', refTo(path));
  textPath.setAttribute('startOffset', branch.textStart);
  if (stem) stem.style.strokeDashoffset = '0';
  if (withLeaf) leaf.setAttribute('transform', `scale(${branch.leaf.size})`);
}

export function glow(part, ms = 6000) {
  part.text.classList.add('fresh');
  setTimeout(() => part.text.classList.remove('fresh'), ms);
}

/**
 * Plays the whole journey. `scene` gives screen geometry:
 * { stage, top, groundY, width, fromFit, toFit, group }.
 */
export async function playWish(wish, part, scene, token) {
  const { stage, top, groundY, width } = scene;

  // Ease the tree to its new size while the wish is still high in the sky.
  if (scene.fromFit && scene.group) {
    const { fromFit: a, toFit: b, group } = scene;
    tween(900, (t) => {
      const e = easeInOutSine(t);
      group.setAttribute('transform', treeTransform({ scale: lerp(a.scale, b.scale, e), x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e) }));
    }, token);
  }

  // 1. The falling line of text.
  const falling = document.createElement('div');
  falling.className = 'falling-wish';
  falling.setAttribute('aria-hidden', 'true');
  falling.textContent = wish.text;
  stage.appendChild(falling);
  const w = falling.offsetWidth, h = falling.offsetHeight;
  const land = { x: width / 2, y: groundY - 4 };
  const x0 = width / 2 + (Math.random() - 0.5) * Math.min(width * 0.3, 260);
  const y0 = top + h / 2 + 8;
  const sway = Math.min(70, width * 0.09);
  const phase = Math.random() * Math.PI * 2;
  const place = (x, y, rot, s, o) => {
    falling.style.transform = `translate(${(x - w / 2).toFixed(1)}px, ${(y - h / 2).toFixed(1)}px) rotate(${rot.toFixed(2)}deg) scale(${s.toFixed(3)})`;
    falling.style.opacity = o.toFixed(3);
  };
  place(x0, y0, 0, 1, 0);

  const fell = await tween(3600, (t) => {
    const calm = Math.pow(1 - t, 0.8); // the sway settles as it nears the ground
    const x = lerp(x0, land.x, easeInOutSine(t)) + Math.sin(t * Math.PI * 3 + phase) * sway * calm;
    const y = lerp(y0, land.y, easeInOutSine(t));
    const rot = Math.cos(t * Math.PI * 3 + phase) * 7 * calm;
    const collapse = t < 0.82 ? 0 : (t - 0.82) / 0.18; // folds into a seed at the end
    const scale = lerp(1, 0.06, easeOutCubic(collapse));
    const fadeIn = Math.min(1, t / 0.08);
    place(x, y, rot, scale, fadeIn * (1 - collapse * 0.9));
  }, token);
  falling.remove();
  if (!fell) return;

  // 2. A glowing seed lands, then rises to where the branch begins.
  const seed = document.createElement('div');
  seed.className = 'seed landed';
  seed.setAttribute('aria-hidden', 'true');
  stage.appendChild(seed);
  const moveSeed = (x, y) => { seed.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`; };
  moveSeed(land.x, land.y);
  await tween(450, () => {}, token);

  const fit = scene.toFit;
  const base = { x: fit.x + part.branch.base.x * fit.scale, y: fit.y + part.branch.base.y * fit.scale };
  const rise = Math.hypot(base.x - land.x, base.y - land.y);
  if (rise > 4) {
    const ctrl = { x: land.x, y: base.y };
    await tween(Math.min(1300, 500 + rise * 1.4), (t) => {
      const e = easeInOutSine(t), u = 1 - e;
      moveSeed(u * u * land.x + 2 * u * e * ctrl.x + e * e * base.x, u * u * land.y + 2 * u * e * ctrl.y + e * e * base.y);
    }, token);
  }
  seed.classList.add('pop');
  setTimeout(() => seed.remove(), 600);
  if (token.cancelled) return;

  // 3. The branch grows.
  await growBranch(part, fit.scale, token);
}

/** Grows a hidden branch in place: stem, then the words slide out, then the leaf opens. */
export async function growBranch(part, scale, token, { glowMs = 5000 } = {}) {
  const { stem, textPath, leaf, branch } = part;
  if (stem) {
    const len = stem.getTotalLength();
    await tween(260, (t) => { stem.style.strokeDashoffset = String(len * (1 - t)); }, token);
  }
  const g = growGeometry(part);
  const growMs = Math.min(2400, 1100 + branch.textLength * scale * 1.6);
  if (glowMs) glow(part, growMs + glowMs);
  await tween(growMs, (t) => {
    textPath.setAttribute('startOffset', lerp(g.hidden, g.settled, easeOutCubic(t)).toFixed(2));
  }, token);
  showBranch(part, { withLeaf: false }); // same spot, back on the full path
  await tween(520, (t) => {
    leaf.setAttribute('transform', `scale(${(branch.leaf.size * Math.max(0, easeOutBack(t))).toFixed(3)})`);
  }, token);
}

// The journey of a wish: it falls through the dark with a gentle sway into
// the jar's mouth, turns into its paper slip and drops onto the pile.
// Cosmetic randomness (where it starts, how it sways) may use Math.random;
// the layout itself never does.

import { slipTransform } from './jarView.js';

const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const lerp = (a, b, t) => a + (b - a) * t;
// Falls with gravity, then settles with a small bounce.
function dropEase(t) {
  if (t < 0.78) return Math.pow(t / 0.78, 2) * 1.0;
  const u = (t - 0.78) / 0.22;
  return 1 - Math.sin(u * Math.PI) * 0.035 * (1 - u);
}

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

/** Hides a slip at the jar's mouth, waiting to drop in. */
export function hideSlip(part, mouth) {
  part.node.setAttribute('transform', slipTransform(mouth.x, mouth.y, 0, 0.35));
  part.node.style.opacity = '0';
}

export function showSlip(part) {
  const { x, y, angle } = part.slip;
  part.node.setAttribute('transform', slipTransform(x, y, angle));
  part.node.style.opacity = '';
}

export function glow(part, ms = 6000) {
  part.node.classList.add('fresh');
  setTimeout(() => part.node.classList.remove('fresh'), ms);
}

/** Drops a hidden slip from the mouth onto its place on the pile. */
export async function dropSlip(part, mouth, token, { glowMs = 5000 } = {}) {
  const { x, y, angle } = part.slip;
  const spin = angle + (x < 0 ? -1 : 1) * 70; // tumbles a little on the way down
  if (glowMs) glow(part, 1100 + glowMs);
  part.node.style.opacity = '';
  const ok = await tween(1100, (t) => {
    const d = dropEase(t);
    const s = lerp(0.35, 1, easeOutCubic(Math.min(1, t * 1.8)));
    const px = lerp(mouth.x, x, easeOutCubic(t));
    const py = lerp(mouth.y, y, d);
    const a = lerp(0, spin, easeOutCubic(Math.min(1, t * 1.2))) - (spin - angle) * easeOutCubic(Math.max(0, (t - 0.45) / 0.55));
    part.node.setAttribute('transform', slipTransform(px, py, a, s));
  }, token);
  if (ok) showSlip(part);
  return ok;
}

/**
 * The visitor's own wish: falls from the sky into the mouth, then drops in.
 * scene: { stage, top, width, mouthScreen, mouth, fromFit, toFit, group, transform }.
 */
export async function playWish(wish, part, scene, token) {
  const { stage, top, width, mouthScreen } = scene;

  // Ease the jar to its new size while the wish is still high up.
  if (scene.fromFit && scene.group) {
    const { fromFit: a, toFit: b, group, transform } = scene;
    tween(900, (t) => {
      const e = easeInOutSine(t);
      group.setAttribute('transform', transform({ scale: lerp(a.scale, b.scale, e), x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e) }));
    }, token);
  }

  const falling = document.createElement('div');
  falling.className = 'falling-wish';
  falling.setAttribute('aria-hidden', 'true');
  falling.textContent = wish.text;
  stage.appendChild(falling);
  const w = falling.offsetWidth, h = falling.offsetHeight;
  const x0 = width / 2 + (Math.random() - 0.5) * Math.min(width * 0.3, 260);
  const y0 = top + h / 2 + 8;
  const end = { x: mouthScreen.x, y: mouthScreen.y - 6 };
  const sway = Math.min(70, width * 0.09);
  const phase = Math.random() * Math.PI * 2;
  const place = (x, y, rot, s, o) => {
    falling.style.transform = `translate(${(x - w / 2).toFixed(1)}px, ${(y - h / 2).toFixed(1)}px) rotate(${rot.toFixed(2)}deg) scale(${s.toFixed(3)})`;
    falling.style.opacity = o.toFixed(3);
  };
  place(x0, y0, 0, 1, 0);

  const fell = await tween(3200, (t) => {
    const calm = Math.pow(1 - t, 0.8);
    const x = lerp(x0, end.x, easeInOutSine(t)) + Math.sin(t * Math.PI * 3 + phase) * sway * calm;
    const y = lerp(y0, end.y, easeInOutSine(t));
    const rot = Math.cos(t * Math.PI * 3 + phase) * 7 * calm;
    const fold = t < 0.8 ? 0 : (t - 0.8) / 0.2; // folds into a slip at the mouth
    place(x, y, rot, lerp(1, 0.2, easeOutCubic(fold)), Math.min(1, t / 0.08) * (1 - fold));
  }, token);
  falling.remove();
  if (!fell) return;
  await dropSlip(part, scene.mouth, token);
}

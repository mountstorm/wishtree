import { chooseLayout, layoutTree, fitTree, MIN_FONT_PX } from './layoutTree.js';
import { drawScene, el } from './scene.js';
import { drawTree } from './treeView.js';
import { playWish, hideBranch, showBranch, glow } from './grow.js';
import { sampleWishes } from './sampleWishes.js';

const stage = document.getElementById('stage');
const svg = document.getElementById('world');
const masthead = document.querySelector('.masthead');
const form = document.getElementById('wish-form');
const textInput = document.getElementById('wish-text');
const nameInput = document.getElementById('wish-name');
const sendButton = document.getElementById('wish-send');
const counter = document.getElementById('wish-count');
const message = document.getElementById('wish-message');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const MAX_TEXT = 80;
const MAX_NAME = 24;

const state = {
  wishes: [...sampleWishes],
  version: 0,
  current: null, // { layout, fit, group, parts, geometry }
  journey: null, // the wish animation in progress
  lastSize: '',
  options: null, // layout options picked for this screen; kept while wishes arrive
};

// Layouts only change when the wishes do, so resizing never recomputes them.
const layoutCache = new Map();
function cachedLayout(wishes, options = {}) {
  const key = `${state.version}|${JSON.stringify(options)}`;
  if (!layoutCache.has(key)) layoutCache.set(key, layoutTree(wishes, options));
  return layoutCache.get(key);
}

function geometry() {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  const stageTop = stage.getBoundingClientRect().top;
  const top = masthead.getBoundingClientRect().bottom - stageTop + 8;
  const formTop = form.getBoundingClientRect().top - stageTop;
  return { width, height, top, minGround: height - formTop + 18 };
}

/** Draws the scene and tree. Branches in `pending` are drawn ungrown. */
function render(pending = null) {
  const g = geometry();
  if (!g.width || !g.height) return null;
  state.lastSize = `${g.width}x${g.height}`;

  svg.setAttribute('viewBox', `0 0 ${g.width} ${g.height}`);
  svg.replaceChildren();
  const { defs, groundY } = drawScene(svg, g.width, g.height, g.minGround);
  const box = { width: g.width, height: groundY - g.top };
  let chosen = null;
  if (state.options) {
    // Same screen, more wishes: keep the same tree and let new branches join it.
    const layout = cachedLayout(state.wishes, state.options);
    const fit = fitTree(layout, box);
    if (!state.options.compact || fit.minFontPx >= MIN_FONT_PX) chosen = { layout, fit };
  }
  if (!chosen) {
    chosen = chooseLayout(state.wishes, box, cachedLayout);
    state.options = chosen.options;
  }
  const { layout, fit } = chosen;
  const placed = { ...fit, y: groundY };
  const { group, parts } = drawTree(el('g', {}, svg), defs, layout, placed, { top: 0, bottom: g.height });
  if (pending && parts.has(pending)) hideBranch(parts.get(pending));
  state.current = { layout, fit: placed, group, parts, geometry: { ...g, groundY } };
  return state.current;
}

function onResize() {
  const size = `${stage.clientWidth}x${stage.clientHeight}`;
  if (size === state.lastSize) return;
  finishJourney(); // a resize mid-animation simply shows the grown tree
  state.options = null; // a new screen size picks its own tree
  render();
}

/** Fades an old copy of the picture out over the new one. */
function crossFade(oldPicture) {
  oldPicture.removeAttribute('id');
  oldPicture.classList.add('fading-out');
  oldPicture.setAttribute('aria-hidden', 'true');
  stage.appendChild(oldPicture);
  requestAnimationFrame(() => requestAnimationFrame(() => oldPicture.classList.add('gone')));
  setTimeout(() => oldPicture.remove(), 1200);
}

function finishJourney() {
  if (!state.journey) return;
  state.journey.token.cancelled = true;
  stage.querySelectorAll('.falling-wish, .seed, .fading-out').forEach((n) => n.remove());
  const part = state.current?.parts.get(state.journey.id);
  if (part) showBranch(part);
  state.journey = null;
  setBusy(false);
}

// ---------------------------------------------------------------- the form

function updateCounter() {
  const left = MAX_TEXT - [...textInput.value].length;
  counter.textContent = `${left} left`;
  counter.classList.toggle('low', left <= 10);
}

function say(text, isError = false) {
  message.textContent = text;
  message.classList.toggle('error', isError);
}

function setBusy(busy) {
  sendButton.disabled = busy;
  sendButton.textContent = busy ? 'Falling…' : 'Let it fall';
}

function makeId() {
  const rand = crypto.getRandomValues(new Uint32Array(2));
  return `local-${Date.now().toString(36)}-${rand[0].toString(36)}${rand[1].toString(36)}`;
}

async function submitWish(event) {
  event.preventDefault();
  if (state.journey) return;
  const text = textInput.value.replace(/\s+/g, ' ').trim();
  const name = nameInput.value.replace(/\s+/g, ' ').trim();
  if (!text) {
    say('Your wish is empty. Type a few words first.', true);
    textInput.focus();
    return;
  }
  if ([...text].length > MAX_TEXT || [...name].length > MAX_NAME) {
    say(`Please keep wishes to ${MAX_TEXT} characters and names to ${MAX_NAME}.`, true);
    return;
  }

  say('Thank you. Soon your wish will fall onto the tree.');
  textInput.value = '';
  updateCounter();
}

textInput.addEventListener('input', () => { updateCounter(); if (message.classList.contains('error')) say(''); });
form.addEventListener('submit', submitWish);
updateCounter();

new ResizeObserver(onResize).observe(stage);
// The title's real height is known once fonts load; pick the tree for it then.
document.fonts?.ready.then(() => {
  if (state.journey) return;
  state.options = null;
  render();
});

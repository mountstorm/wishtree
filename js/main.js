import { chooseLayout, layoutTree, fitTree, MIN_FONT_PX } from './layoutTree.js';
import { drawScene, drawSeedling, el } from './scene.js';
import { drawTree, markMine } from './treeView.js';
import { playWish, growBranch, hideBranch, showBranch, glow } from './grow.js';
import { fetchWishes, sendWish, ApiError } from './api.js';

const POLL_MS = 15_000;
const SERVER_LIMIT = 400;
const MAX_TEXT = 80;
const MAX_NAME = 24;

const stage = document.getElementById('stage');
const svg = document.getElementById('world');
const masthead = document.querySelector('.masthead');
const form = document.getElementById('wish-form');
const textInput = document.getElementById('wish-text');
const nameInput = document.getElementById('wish-name');
const sendButton = document.getElementById('wish-send');
const counter = document.getElementById('wish-count');
const message = document.getElementById('wish-message');
const status = document.getElementById('tree-status');
const statusTitle = document.getElementById('status-title');
const statusLine = document.getElementById('status-line');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const state = {
  wishes: [],
  total: 0,
  phase: 'loading', // loading | ready | resting (could not load)
  version: 0,
  current: null, // { layout, fit, group, parts, geometry }
  journey: null, // the visitor's wish animation in progress
  growing: null, // other visitors' wishes growing in place
  queued: null, // a poll result waiting for an animation to finish
  lastSize: '',
  options: null, // layout options picked for this screen; kept while wishes arrive
  mine: loadMine(),
};

// ---------------------------------------------------------------- the visitor's own wishes

// Their wishes stay marked for the rest of the visit (and across a reload).
// Storage can be unavailable; the marker is a nicety, not a need.
function loadMine() {
  try {
    return new Set(JSON.parse(sessionStorage.getItem('wishtree:mine') || '[]'));
  } catch {
    return new Set();
  }
}
function rememberMine(id) {
  state.mine.add(id);
  try {
    sessionStorage.setItem('wishtree:mine', JSON.stringify([...state.mine].slice(-20)));
  } catch { /* private mode: keep it for this page only */ }
}

// ---------------------------------------------------------------- drawing

// Layouts only change when the wishes do, so resizing never recomputes them.
const layoutCache = new Map();
function cachedLayout(wishes, options = {}) {
  const key = `${state.version}|${JSON.stringify(options)}`;
  if (!layoutCache.has(key)) {
    if (layoutCache.size > 12) layoutCache.clear();
    layoutCache.set(key, layoutTree(wishes, options));
  }
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

/** Draws the scene and tree. Branches whose ids are in `pending` are drawn ungrown. */
function render(pending = new Set()) {
  const g = geometry();
  if (!g.width || !g.height) return null;
  state.lastSize = `${g.width}x${g.height}`;

  svg.setAttribute('viewBox', `0 0 ${g.width} ${g.height}`);
  svg.replaceChildren();
  const { defs, groundY } = drawScene(svg, g.width, g.height, g.minGround);
  updateStatus();

  if (!state.wishes.length) {
    if (state.phase === 'ready') drawSeedling(svg, g.width / 2, groundY, Math.min(1.3, Math.max(0.9, g.width / 900)));
    state.current = { layout: null, fit: null, group: null, parts: new Map(), geometry: { ...g, groundY } };
    return state.current;
  }

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
  const mine = new Set([...state.mine].filter((id) => !pending.has(id)));
  const { group, parts } = drawTree(el('g', {}, svg), defs, layout, placed, { top: 0, bottom: g.height }, { mine });
  for (const id of pending) if (parts.has(id)) hideBranch(parts.get(id));
  state.current = { layout, fit: placed, group, parts, geometry: { ...g, groundY } };
  return state.current;
}

function updateStatus() {
  let title = '', line = '', quiet = false;
  if (state.phase === 'loading') {
    title = 'Gathering wishes…';
    quiet = true;
  } else if (state.phase === 'resting' && !state.wishes.length) {
    title = 'The tree is resting.';
    line = 'We will keep trying to reach it.';
    quiet = true;
  } else if (!state.wishes.length && !state.journey) {
    title = 'Be the first wish.';
    line = 'The tree starts from you.';
  }
  status.hidden = !title;
  status.classList.toggle('quiet', quiet);
  if (statusTitle.textContent !== title) statusTitle.textContent = title;
  if (statusLine.textContent !== line) statusLine.textContent = line;
}

/** Fades an old copy of the picture out over the new one. */
function crossFade(oldPicture) {
  if (reducedMotion.matches) return;
  oldPicture.removeAttribute('id');
  oldPicture.classList.add('fading-out');
  oldPicture.setAttribute('aria-hidden', 'true');
  stage.appendChild(oldPicture);
  requestAnimationFrame(() => requestAnimationFrame(() => oldPicture.classList.add('gone')));
  setTimeout(() => oldPicture.remove(), 1200);
}

const sameBranches = (before, now) => !!before?.layout && !!now?.layout
  && before.layout.branches.every((b, i) => now.layout.branches[i]?.id === b.id);

function onResize() {
  const size = `${stage.clientWidth}x${stage.clientHeight}`;
  if (size === state.lastSize) return;
  finishAnimations(); // a resize mid-animation simply shows the grown tree
  state.options = null; // a new screen size picks its own tree
  render();
}

function finishAnimations() {
  for (const run of [state.journey, state.growing]) if (run) run.token.cancelled = true;
  stage.querySelectorAll('.falling-wish, .seed, .fading-out').forEach((n) => n.remove());
  if (state.journey) {
    const part = state.current?.parts.get(state.journey.id);
    if (part) {
      showBranch(part);
      markMine(part);
    }
    say('Your wish has grown into the tree.');
  }
  for (const id of state.growing?.ids || []) {
    const part = state.current?.parts.get(id);
    if (part) showBranch(part);
  }
  state.journey = null;
  state.growing = null;
  setBusy(false);
  applyQueued();
}

// ---------------------------------------------------------------- wishes from the server

function byTime(a, b) {
  const d = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  return d || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Folds a server list into ours: adds new wishes and drops moderated ones. */
function reconcile(serverWishes) {
  const incoming = new Map(serverWishes.map((w) => [w.id, w]));
  const sorted = [...serverWishes].sort(byTime);
  const oldest = sorted[0], newest = sorted.at(-1);
  const removed = new Set();
  for (const w of state.wishes) {
    if (incoming.has(w.id)) continue;
    // A wish missing from the server's list was deleted, unless it is newer
    // than that list (cached for a few seconds) or older than its window.
    const newer = !newest || byTime(w, newest) > 0;
    const older = serverWishes.length >= SERVER_LIMIT && oldest && byTime(w, oldest) < 0;
    if (!newer && !older) removed.add(w.id);
  }
  const known = new Set(state.wishes.map((w) => w.id));
  const added = serverWishes.filter((w) => !known.has(w.id)).sort(byTime);
  return { added, removed };
}

function applyServerList({ wishes, total }) {
  if (state.journey || state.growing) {
    state.queued = { wishes, total };
    return;
  }
  const first = state.phase !== 'ready';
  state.phase = 'ready';
  state.total = Math.max(total, wishes.length);
  const { added, removed } = reconcile(wishes);
  if (!added.length && !removed.size) {
    if (first) render();
    return;
  }

  const before = state.current;
  const oldPicture = svg.cloneNode(true);
  state.wishes = [...state.wishes.filter((w) => !removed.has(w.id)), ...added].sort(byTime);
  state.version++;
  if (removed.size) state.options = null; // the tree has to regrow without them

  // On first load everything simply appears; later arrivals grow in place.
  const animate = !first && !removed.size && !reducedMotion.matches && added.length <= 12;
  const now = render(animate ? new Set(added.map((w) => w.id)) : new Set());
  if (!first && !sameBranches(before, now)) crossFade(oldPicture);
  if (animate && now) growArrivals(added.map((w) => w.id));
}

async function growArrivals(ids) {
  const token = { cancelled: false };
  state.growing = { ids, token };
  const scale = state.current.fit.scale;
  await Promise.all(ids.map(async (id, i) => {
    const part = state.current.parts.get(id);
    if (!part) return;
    await new Promise((r) => setTimeout(r, i * 450));
    if (!token.cancelled) await growBranch(part, scale, token, { glowMs: 1500 });
  }));
  if (token.cancelled) return;
  state.growing = null;
  applyQueued();
}

function applyQueued() {
  if (!state.queued || state.journey || state.growing) return;
  const next = state.queued;
  state.queued = null;
  applyServerList(next);
}

let polling = null;
async function poll() {
  if (polling) return polling;
  polling = (async () => {
    try {
      applyServerList(await fetchWishes());
    } catch {
      if (state.phase === 'loading') {
        state.phase = 'resting';
        render();
      }
    } finally {
      polling = null;
    }
  })();
  return polling;
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

function setBusy(busy, label = 'Falling…') {
  sendButton.disabled = busy;
  sendButton.textContent = busy ? label : 'Let it fall';
}

async function submitWish(event) {
  event.preventDefault();
  if (state.journey || sendButton.disabled) return;
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

  setBusy(true, 'Planting…');
  say('');
  let wish;
  try {
    wish = await sendWish(text, name);
  } catch (err) {
    setBusy(false);
    const e = err instanceof ApiError ? err : new ApiError('Something went wrong. Please try again.');
    say(e.message, true);
    (e.field === 'name' ? nameInput : textInput).focus();
    return;
  }

  // Saved. Now it falls, lands and grows.
  finishAnimations();
  textInput.value = '';
  updateCounter();
  rememberMine(wish.id);
  const before = state.current;
  const oldPicture = svg.cloneNode(true);
  state.wishes = [...state.wishes, wish].sort(byTime);
  state.total += 1;
  state.version++;

  const now = render(new Set([wish.id]));
  const part = now?.parts.get(wish.id);
  if (!now || !part || reducedMotion.matches) {
    // Reduced motion: the branch simply appears in place, briefly aglow.
    if (part) {
      showBranch(part);
      glow(part);
      markMine(part);
    }
    setBusy(false);
    say(part ? 'Your wish has grown into the tree.' : 'Your wish has joined the trunk.');
    return;
  }

  // Keep the tree at its old size and ease it to the new one during the fall,
  // as long as the existing branches are the same ones.
  const same = sameBranches(before, now);
  if (same) now.group.setAttribute('transform', before.group.getAttribute('transform'));
  else if (before?.layout) crossFade(oldPicture);

  setBusy(true);
  say('Your wish is falling…');
  const token = { cancelled: false };
  state.journey = { id: wish.id, token };
  await playWish(wish, part, {
    stage,
    top: now.geometry.top,
    groundY: now.geometry.groundY,
    width: now.geometry.width,
    fromFit: same ? before.fit : null,
    toFit: now.fit,
    group: now.group,
  }, token);
  if (token.cancelled) return;
  markMine(part);
  state.journey = null;
  setBusy(false);
  say('Your wish has grown into the tree.');
  applyQueued();
}

textInput.addEventListener('input', () => {
  updateCounter();
  if (message.classList.contains('error')) say('');
});
form.addEventListener('submit', submitWish);
updateCounter();

// ---------------------------------------------------------------- start

new ResizeObserver(onResize).observe(stage);
// The title's real height is known once fonts load; pick the tree for it then.
document.fonts?.ready.then(() => {
  if (state.journey || state.growing) return;
  state.options = null;
  render();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) poll();
});
setInterval(() => {
  if (!document.hidden) poll();
}, POLL_MS);
poll();

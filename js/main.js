import { chooseJar, layoutJar, fitJar, jarSize, MIN_FONT_PX } from './layoutJar.js';
import { drawRoom, drawJarBack, drawConfetti, drawJarFront, mouthOf, el } from './scene.js';
import { drawSlips, markMine } from './jarView.js';
import { playWish, dropSlip, hideSlip, showSlip, glow } from './drop.js';
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
const status = document.getElementById('jar-status');
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
  growing: null, // other visitors' wishes dropping in
  queued: null, // a poll result waiting for an animation to finish
  lastSize: '',
  options: null, // jar options picked for this screen; kept while wishes arrive
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
    layoutCache.set(key, layoutJar(wishes, options));
  }
  return layoutCache.get(key);
}

function geometry() {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  const stageTop = stage.getBoundingClientRect().top;
  const top = masthead.getBoundingClientRect().bottom - stageTop + 8;
  const formTop = form.getBoundingClientRect().top - stageTop;
  return { width, height, top, bottom: formTop - 10 };
}

const jarTransform = ({ scale, x, y }) => `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${scale.toFixed(4)})`;

/** Draws the room, the jar and its slips. Slips whose ids are in `pending` wait at the mouth. */
function render(pending = new Set()) {
  const g = geometry();
  if (!g.width || !g.height) return null;
  state.lastSize = `${g.width}x${g.height}`;
  const box = { width: g.width, height: Math.max(120, g.bottom - g.top) };

  let chosen = null;
  if (state.options) {
    // Same screen, more wishes: keep the same jar and let new slips land on top.
    const layout = cachedLayout(state.wishes, state.options);
    const fit = fitJar(layout, box);
    if (!layout.overflow && fit.minFontPx >= MIN_FONT_PX) chosen = { layout, fit };
  }
  if (!chosen) {
    chosen = chooseJar(state.wishes, box, cachedLayout);
    state.options = chosen.options;
  }
  const { layout, fit } = chosen;
  const placed = { scale: fit.scale, x: fit.x, y: g.top + fit.y };
  const size = jarSize(layout);

  svg.setAttribute('viewBox', `0 0 ${g.width} ${g.height}`);
  svg.replaceChildren();
  const jarCentre = { x: placed.x, y: placed.y - (layout.jar.height / 2) * placed.scale };
  const defs = drawRoom(svg, g.width, g.height, jarCentre, size.width * placed.scale);
  const group = el('g', { class: 'jar', transform: jarTransform(placed) }, svg);
  drawJarBack(group, defs, layout.jar);
  drawConfetti(group, layout.jar, layout.confetti);
  const mine = new Set([...state.mine].filter((id) => !pending.has(id)));
  const parts = drawSlips(group, defs, layout, { mine });
  drawJarFront(group, defs, layout.jar);
  const mouth = mouthOf(layout.jar);
  for (const id of pending) if (parts.has(id)) hideSlip(parts.get(id), mouth);

  state.current = { layout, fit: placed, group, parts, mouth, geometry: { ...g, jarCentre } };
  updateStatus();
  return state.current;
}

function updateStatus() {
  let title = '', line = '', quiet = false;
  if (state.phase === 'loading') {
    title = 'Gathering wishes…';
    quiet = true;
  } else if (state.phase === 'resting' && !state.wishes.length) {
    title = 'The jar is resting.';
    line = 'We will keep trying to reach it.';
    quiet = true;
  } else if (!state.wishes.length && !state.journey) {
    title = 'Be the first wish.';
    line = 'The jar starts with you.';
  }
  status.hidden = !title;
  // Sit the words inside the empty jar.
  const centre = state.current?.geometry?.jarCentre;
  if (centre) status.style.top = `${Math.round(centre.y)}px`;
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

// The jar only changed by gaining slips on top: everything already there is the same.
const sameSlips = (before, now) => !!before?.layout && !!now?.layout
  && before.layout.slips.every((s, i) => now.layout.slips[i]?.id === s.id && now.layout.slips[i].kind === s.kind);

function onResize() {
  const size = `${stage.clientWidth}x${stage.clientHeight}`;
  if (size === state.lastSize) return;
  finishAnimations(); // a resize mid-animation simply shows the finished jar
  state.options = null; // a new screen size picks its own jar
  render();
}

function finishAnimations() {
  for (const run of [state.journey, state.growing]) if (run) run.token.cancelled = true;
  stage.querySelectorAll('.falling-wish, .seed, .fading-out').forEach((n) => n.remove());
  if (state.journey) {
    const part = state.current?.parts.get(state.journey.id);
    if (part) {
      showSlip(part);
      markMine(part);
    }
    say('Your wish is in the jar.');
  }
  for (const id of state.growing?.ids || []) {
    const part = state.current?.parts.get(id);
    if (part) showSlip(part);
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
  if (removed.size) state.options = null; // the jar settles again without them

  // On first load everything simply appears; later arrivals drop in.
  const animate = !first && !removed.size && !reducedMotion.matches && added.length <= 12;
  const now = render(animate ? new Set(added.map((w) => w.id)) : new Set());
  if (!first && !sameSlips(before, now)) crossFade(oldPicture);
  if (animate && now) dropArrivals(added.map((w) => w.id));
}

async function dropArrivals(ids) {
  const token = { cancelled: false };
  state.growing = { ids, token };
  const { mouth } = state.current;
  // One after another, in the order they were made.
  for (const id of ids) {
    const part = state.current.parts.get(id);
    if (part && !token.cancelled) await dropSlip(part, mouth, token, { glowMs: 1500 });
  }
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
    // Reduced motion: the slip simply appears in place, briefly aglow.
    if (part) {
      showSlip(part);
      glow(part);
      markMine(part);
    }
    setBusy(false);
    say('Your wish is in the jar.');
    return;
  }

  // Keep the jar at its old size and ease it to the new one during the fall,
  // as long as the slips already there are the same ones.
  const same = sameSlips(before, now);
  if (same) now.group.setAttribute('transform', before.group.getAttribute('transform'));
  else if (before?.layout) crossFade(oldPicture);

  setBusy(true);
  say('Your wish is falling…');
  const token = { cancelled: false };
  state.journey = { id: wish.id, token };
  await playWish(wish, part, {
    stage,
    top: now.geometry.top,
    width: now.geometry.width,
    mouth: now.mouth,
    mouthScreen: { x: now.fit.x + now.mouth.x * now.fit.scale, y: now.fit.y + now.mouth.y * now.fit.scale },
    fromFit: same ? before.fit : null,
    toFit: now.fit,
    group: now.group,
    transform: jarTransform,
  }, token);
  if (token.cancelled) return;
  markMine(part);
  state.journey = null;
  setBusy(false);
  say('Your wish is in the jar.');
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
// The title's real height is known once fonts load; pick the jar for it then.
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

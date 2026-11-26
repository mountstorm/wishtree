import { chooseLayout } from './layoutTree.js';
import { drawScene, el } from './scene.js';
import { drawTree } from './treeView.js';
import { sampleWishes } from './sampleWishes.js';

const stage = document.getElementById('stage');
const svg = document.getElementById('world');
const masthead = document.querySelector('.masthead');

let lastSize = '';

function render(force = false) {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  const key = `${width}x${height}`;
  if (!width || !height || (key === lastSize && !force)) return;
  lastSize = key;

  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.replaceChildren();
  const { defs, groundY } = drawScene(svg, width, height);

  // The tree gets the space between the title and the ground.
  const top = masthead.getBoundingClientRect().bottom - stage.getBoundingClientRect().top + 8;
  const box = { width, height: groundY - top };
  const { layout, fit } = chooseLayout(sampleWishes, box);
  drawTree(el('g', {}, svg), defs, layout, { ...fit, y: groundY }, { top: 0, bottom: height });
}

new ResizeObserver(() => render()).observe(stage);
document.fonts?.ready.then(() => render(true));

import { drawScene } from './scene.js';

const stage = document.getElementById('stage');
const svg = document.getElementById('world');

function render() {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  if (!width || !height) return;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.replaceChildren();
  drawScene(svg, width, height);
}

new ResizeObserver(render).observe(stage);

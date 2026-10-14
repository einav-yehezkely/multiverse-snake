import { Game, GHOST_MS } from './game.js';
import { TOPOLOGIES } from './topology.js';
import { THEMES } from './themes.js';
import { Audio } from './audio.js';

const $ = (id) => document.getElementById(id);
const ui = {
  score: $('score'), best: $('best'), world: $('world'), ghostBar: $('ghostBar'), ghostFill: $('ghostFill'), ghostSecs: $('ghostSecs'),
  pauseBtn: $('pauseBtn'), muteBtn: $('muteBtn'), toast: $('toast'),
  modeBtns: [...document.querySelectorAll('[data-mode]')], modeHelp: $('modeHelp'),
  start: $('startScreen'), pause: $('pauseScreen'), over: $('overScreen'), startBest: $('startBest'),
  finalScore: $('finalScore'), finalBest: $('finalBest'), finalLen: $('finalLen'), finalWorlds: $('finalWorlds'), newBest: $('newBest'),
};

function fatal(msg) {
  const el = $('fatal');
  el.textContent = msg;
  el.hidden = false;
}

let storage = null;
try { storage = window.localStorage; } catch { /* private mode */ }
const MODE_KEY = 'multiverse-snake-mode';
let mode = 'cube';
try { if (TOPOLOGIES[storage?.getItem(MODE_KEY)]) mode = storage.getItem(MODE_KEY); } catch { /* ignore */ }
let game = new Game({ storage, topology: TOPOLOGIES[mode] });
const audio = new Audio();
let renderer = null;

try {
  const { Renderer } = await import('./render.js');
  renderer = new Renderer($('scene'), TOPOLOGIES[mode]);
  window.__renderer = renderer;
} catch (err) {
  console.error(err);
  fatal('Multiverse Snake needs WebGL, which is not available in this browser.');
}

// Expose for debugging / automated checks.
window.__game = game;
window.__cube = await import('./cube.js');
window.__topologies = TOPOLOGIES;

// ---------- UI sync ----------
let lastWorld = -1;
const visited = new Set([0]);
function setWorld(id, announce) {
  const th = THEMES[game.topo.themeOf(id)];
  document.documentElement.style.setProperty('--world', th.color);
  ui.world.querySelector('b').textContent = th.name;
  audio.setWorld(id);
  visited.add(id);
  if (announce) {
    ui.toast.innerHTML = `${th.name}<small>world ${id + 1} of ${game.topo.faceCount}</small>`;
    ui.toast.classList.remove('show');
    void ui.toast.offsetWidth;
    ui.toast.classList.add('show');
  }
}

function syncOverlays() {
  const s = game.status;
  ui.start.hidden = s !== 'ready';
  ui.pause.hidden = s !== 'paused';
  ui.over.hidden = s !== 'over';
  ui.startBest.textContent = game.best;
  if (s === 'over') {
    ui.finalScore.textContent = game.score;
    ui.finalBest.textContent = game.best;
    ui.finalLen.textContent = game.snake.length;
    ui.finalWorlds.textContent = `${visited.size}/${game.topo.faceCount}`;
    ui.newBest.hidden = !game.newBest;
  }
}

function updateHud() {
  ui.score.textContent = game.score;
  ui.best.textContent = Math.max(game.best, game.score);
  const w = game.headFace;
  if (w !== lastWorld) { setWorld(w, lastWorld !== -1 && game.status === 'running'); lastWorld = w; }
  if (game.ghost) {
    ui.ghostBar.hidden = false;
    ui.ghostFill.style.width = `${(game.ghostMs / GHOST_MS) * 100}%`;
    ui.ghostSecs.textContent = (game.ghostMs / 1000).toFixed(1);
    ui.ghostBar.classList.toggle('warn', game.ghostMs < 1500);
  } else ui.ghostBar.hidden = true;
}

// ---------- mode selection ----------
const HELP = {
  cube: 'Classic grid on six square worlds. Crawl over an edge to wrap onto the next face.',
  dodeca: 'Twelve pentagon worlds, each split into five kite-shaped grids. Follow the glowing lines. Press an arrow or swipe to turn toward that direction (glowing dots show your next options), and going straight bends gently across each face.',
};
function setMode(m) {
  if (!TOPOLOGIES[m] || (m === mode && game.topo === TOPOLOGIES[m])) return;
  mode = m;
  try { storage?.setItem(MODE_KEY, m); } catch { /* ignore */ }
  game = new Game({ storage, topology: TOPOLOGIES[m] });
  window.__game = game;
  renderer?.setTopology(TOPOLOGIES[m]);
  visited.clear(); visited.add(0); lastWorld = -1;
  syncMode();
  syncOverlays();
}
function syncMode() {
  for (const b of ui.modeBtns) {
    const on = b.dataset.mode === mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
    const g = new Game({ storage, topology: TOPOLOGIES[b.dataset.mode] });
    b.querySelector('.mode-best').textContent = `Best ${g.best}`;
  }
  ui.modeHelp.textContent = HELP[mode];
}
for (const b of ui.modeBtns) b.addEventListener('click', () => setMode(b.dataset.mode));
function toMenu() {
  game.reset();
  visited.clear(); visited.add(0); lastWorld = -1;
  audio.setMusicLevel(0.6);
  syncMode();
  syncOverlays();
}
syncMode();

// ---------- actions ----------
function startOrRestart() {
  audio.unlock();
  audio.startMusic();
  audio.setMusicLevel(1);
  if (game.status === 'over') { game.reset(); visited.clear(); visited.add(0); lastWorld = -1; }
  if (game.status === 'ready') game.start();
  else if (game.status === 'paused') game.resume();
  syncOverlays();
}
function restart() {
  audio.unlock(); audio.startMusic(); audio.setMusicLevel(1);
  game.restart(); visited.clear(); visited.add(0); lastWorld = -1;
  syncOverlays();
}
function togglePause() {
  if (game.status === 'running' || game.status === 'paused') {
    game.togglePause();
    audio.setMusicLevel(game.status === 'paused' ? 0.25 : 1);
    syncOverlays();
  }
}
function toggleMute() {
  audio.unlock();
  audio.setMuted(!audio.muted);
  ui.muteBtn.classList.toggle('muted', audio.muted);
}
ui.muteBtn.classList.toggle('muted', audio.muted);

$('playBtn').addEventListener('click', startOrRestart);
$('restartBtn').addEventListener('click', restart);
$('restartBtn2').addEventListener('click', restart);
$('resumeBtn').addEventListener('click', togglePause);
$('menuBtn').addEventListener('click', toMenu);
$('menuBtn2').addEventListener('click', toMenu);
ui.pauseBtn.addEventListener('click', (e) => { e.currentTarget.blur(); togglePause(); });
ui.muteBtn.addEventListener('click', (e) => { e.currentTarget.blur(); toggleMute(); });

// ---------- input ----------
const KEYS = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
};
window.addEventListener('keydown', (e) => {
  const dir = KEYS[e.code];
  if (dir) {
    e.preventDefault();
    if (game.status === 'running') game.queueTurn(dir);
    else if (game.status === 'ready' && (dir === 'left' || dir === 'right')) setMode(dir === 'left' ? 'cube' : 'dodeca');
    return;
  }
  switch (e.code) {
    case 'Space':
      e.preventDefault();
      if (game.status === 'ready' || game.status === 'over') startOrRestart(); else togglePause();
      break;
    case 'Enter': case 'NumpadEnter':
      e.preventDefault();
      if (game.status === 'over') restart(); else startOrRestart();
      break;
    case 'KeyP': case 'Escape': togglePause(); break;
    case 'KeyM': toggleMute(); break;
    case 'KeyR': if (game.status !== 'ready') restart(); break;
    case 'Digit1': if (game.status === 'ready') setMode('cube'); break;
    case 'Digit2': if (game.status === 'ready') setMode('dodeca'); break;
  }
});

// Swipe anywhere on the scene
let touch0 = null;
const canvas = $('scene');
canvas.addEventListener('pointerdown', (e) => { touch0 = { x: e.clientX, y: e.clientY, used: false }; });
canvas.addEventListener('pointermove', (e) => {
  if (!touch0 || touch0.used || e.pointerType === 'mouse') return;
  const dx = e.clientX - touch0.x, dy = e.clientY - touch0.y;
  if (Math.hypot(dx, dy) < 26) return;
  game.queueTurn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  touch0 = { x: e.clientX, y: e.clientY, used: false }; // allow chained swipes
});
window.addEventListener('pointerup', () => { touch0 = null; });
for (const b of document.querySelectorAll('.dpad button')) {
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); audio.unlock(); game.queueTurn(b.dataset.dir); });
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.status === 'running') togglePause();
});

// ---------- title-screen preview placement ----------
/** Free area beside (landscape) or above (portrait) the menu panel, below the HUD. */
function previewArea() {
  if (ui.start.hidden) return null;
  const W = window.innerWidth, H = window.innerHeight;
  const panel = ui.start.querySelector('.panel').getBoundingClientRect();
  const hudBottom = Math.max(...[...document.querySelectorAll('.hud-block')].map((e) => e.getBoundingClientRect().bottom));
  let x0 = 0, x1 = W, y0 = hudBottom, y1 = H;
  if (panel.right < W * 0.75) x0 = panel.right; // panel on the left
  else y1 = panel.top; // panel along the bottom
  const r = Math.max(60, Math.min(x1 - x0, y1 - y0) * 0.33);
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, r };
}

// ---------- loop ----------
const SFX = { eat: 'eat', ghost: 'ghost', ghostEnd: 'ghostEnd', portal: 'portal', edge: 'edge', turn: 'turn', start: 'start', death: 'death' };
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  game.update(dt * 1000);
  for (const e of game.drainEvents()) {
    if (SFX[e.type]) audio.sfx(SFX[e.type]);
    if (e.type === 'death') { audio.setMusicLevel(0.2); setTimeout(syncOverlays, 650); }
    renderer?.handleEvent(e, game);
  }
  audio.intensity = Math.min(1, game.eaten / 20);
  updateHud();
  if (renderer) {
    const pv = previewArea();
    if (pv) renderer.preview = pv; // keep the last target while the preview animates away
    renderer.render(game, dt);
  }
  requestAnimationFrame(frame);
}
syncOverlays();
updateHud();
requestAnimationFrame(frame);

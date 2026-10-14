import { Game, GHOST_MS } from './game.js';
import { faceOf } from './cube.js';
import { THEMES } from './themes.js';
import { Audio } from './audio.js';

const $ = (id) => document.getElementById(id);
const ui = {
  score: $('score'), best: $('best'), world: $('world'), ghostBar: $('ghostBar'), ghostFill: $('ghostFill'), ghostSecs: $('ghostSecs'),
  pauseBtn: $('pauseBtn'), muteBtn: $('muteBtn'), toast: $('toast'),
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
const game = new Game({ storage });
const audio = new Audio();
let renderer = null;

try {
  const { Renderer } = await import('./render.js');
  renderer = new Renderer($('scene'));
  window.__renderer = renderer;
} catch (err) {
  console.error(err);
  fatal('Multiverse Snake needs WebGL, which is not available in this browser.');
}

// Expose for debugging / automated checks.
window.__game = game;
window.__cube = await import('./cube.js');

// ---------- UI sync ----------
let lastWorld = -1;
const visited = new Set([0]);
function setWorld(id, announce) {
  const th = THEMES[id];
  document.documentElement.style.setProperty('--world', th.color);
  ui.world.querySelector('b').textContent = th.name;
  audio.setWorld(id);
  visited.add(id);
  if (announce) {
    ui.toast.innerHTML = `${th.name}<small>world ${id + 1} of 6</small>`;
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
    ui.finalWorlds.textContent = `${visited.size}/6`;
    ui.newBest.hidden = !game.newBest;
  }
}

function updateHud() {
  ui.score.textContent = game.score;
  ui.best.textContent = Math.max(game.best, game.score);
  const w = faceOf(game.head).id;
  if (w !== lastWorld) { setWorld(w, lastWorld !== -1 && game.status === 'running'); lastWorld = w; }
  if (game.ghost) {
    ui.ghostBar.hidden = false;
    ui.ghostFill.style.width = `${(game.ghostMs / GHOST_MS) * 100}%`;
    ui.ghostSecs.textContent = (game.ghostMs / 1000).toFixed(1);
    ui.ghostBar.classList.toggle('warn', game.ghostMs < 1500);
  } else ui.ghostBar.hidden = true;
}

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
  renderer?.render(game, dt);
  requestAnimationFrame(frame);
}
syncOverlays();
updateHud();
requestAnimationFrame(frame);

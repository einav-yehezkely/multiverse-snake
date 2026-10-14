import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, screenToDir, BEST_KEY, START_LENGTH, START_INTERVAL, MIN_INTERVAL, GHOST_MS, CRYSTAL_COUNT,
} from '../src/game.js';
import {
  N, step, key, eq, neg, cross, cellToPoint, faceOf, normalOf, isValidCell, allCells, dot,
} from '../src/cube.js';

function rng(seed = 1) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
}
function newGame(opts = {}) {
  const g = new Game({ rng: rng(opts.seed ?? 7), storage: opts.storage ?? memStorage() });
  // Keep tests deterministic: no crystals / portals unless a test places them.
  g.crystals = []; g.portals = null;
  g.fillCrystals = () => {}; // and no automatic refills
  g.start();
  return g;
}
function adjacent(a, b) {
  // b is reachable from a in one step?
  const n = normalOf(a);
  for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    if (dot(d, n) !== 0) continue;
    if (eq(step(a, d).p, b)) return true;
  }
  return false;
}
function assertContinuous(g) {
  for (let k = 0; k + 1 < g.snake.length; k++) {
    if (g.links[k] === 'portal') continue;
    assert.ok(adjacent(g.snake[k + 1], g.snake[k]), `segments ${k}/${k + 1} not adjacent`);
  }
}

test('initial state', () => {
  const g = newGame();
  assert.equal(g.snake.length, START_LENGTH);
  assert.equal(g.status, 'running');
  assert.equal(g.score, 0);
  assertContinuous(g);
});

test('screenToDir: right = up × n, all four distinct and in-plane', () => {
  const view = { n: [0, 0, 1], up: [0, 1, 0] };
  assert.deepEqual(screenToDir(view, 'right'), [1, 0, 0]);
  assert.deepEqual(screenToDir(view, 'left'), [-1, 0, 0]);
  assert.deepEqual(screenToDir(view, 'up'), [0, 1, 0]);
  assert.deepEqual(screenToDir(view, 'down'), [0, -1, 0]);
});

test('reversal into own body is ignored; perpendicular turn applies', () => {
  const g = newGame();
  const before = g.dir.slice();
  g.queueTurn('left'); // opposite of initial heading (right)
  g.tick();
  assert.deepEqual(g.dir, before);
  assert.equal(g.status, 'running');
  g.queueTurn('up');
  g.tick();
  assert.deepEqual(g.dir, [0, 1, 0]);
});

test('quick double-turn (up, left) cannot be used to reverse in one tick', () => {
  const g = newGame();
  g.queueTurn('up'); g.queueTurn('left');
  g.tick();
  assert.deepEqual(g.dir, [0, 1, 0]); // only the first turn per tick
  g.tick();
  assert.deepEqual(g.dir, [-1, 0, 0]);
  assert.equal(g.status, 'running');
});

test('controls stay screen-relative after crossing every kind of edge', () => {
  // Drive "up" on screen repeatedly across 4 edges; screen-up must keep meaning
  // "away from the previous face" (i.e. the snake keeps going straight).
  const g = newGame();
  g.queueTurn('up'); g.tick();
  for (let k = 0; k < 4 * N; k++) {
    const viewBefore = { n: g.view.n.slice(), up: g.view.up.slice() };
    g.tick();
    // Snake heading is always screen-up while we never turned again.
    assert.deepEqual(g.dir, g.view.up, 'heading drifted from screen-up');
    assert.deepEqual(g.view.n, normalOf(g.head), 'camera must face head');
    // Camera basis stays orthonormal and in-plane.
    assert.equal(dot(g.view.up, g.view.n), 0);
    if (!eq(viewBefore.n, g.view.n)) assert.deepEqual(g.view.up, neg(viewBefore.n));
  }
  assert.equal(g.status, 'running');
  assertContinuous(g);

  // Now go sideways (screen-right) across the edges in that direction.
  g.queueTurn('right'); g.tick();
  for (let k = 0; k < 4 * N; k++) {
    g.tick();
    assert.deepEqual(g.dir, cross(g.view.up, g.view.n), 'heading drifted from screen-right');
  }
  assert.equal(g.status, 'running');
});

test('after crossing an edge, pressing "left" turns left on screen', () => {
  const g = newGame();
  // Run right until crossing onto the jungle face.
  while (faceOf(g.head).id === 0) g.tick();
  assert.equal(faceOf(g.head).id, 1);
  g.queueTurn('up'); g.tick();
  assert.deepEqual(g.dir, g.view.up);
  g.queueTurn('left'); g.tick();
  assert.deepEqual(g.dir, neg(cross(g.view.up, g.view.n)));
});

test('body is continuous while wrapping across several faces', () => {
  const g = newGame();
  g.grow = 30; // long snake spanning faces
  for (let k = 0; k < 20; k++) g.tick();
  g.queueTurn('up');
  for (let k = 0; k < 20; k++) g.tick();
  const faces = new Set(g.snake.map((p) => faceOf(p).id));
  assert.ok(faces.size >= 2, 'snake should span multiple faces');
  assert.equal(new Set(g.snake.map(key)).size, g.snake.length, 'no overlapping segments');
  assertContinuous(g);
});

test('eating grows by 2, scores, speeds up and respawns crystal', () => {
  const g = newGame();
  g.crystals = [step(g.head, g.dir).p];
  delete g.fillCrystals; // real refill behaviour
  const len = g.snake.length;
  g.tick();
  assert.equal(g.score, 10);
  assert.equal(g.snake.length, len + 1);
  g.tick();
  assert.equal(g.snake.length, len + 2);
  g.tick();
  assert.equal(g.snake.length, len + 2);
  assert.ok(g.interval < START_INTERVAL);
  assert.equal(g.crystals.length, CRYSTAL_COUNT, 'board topped back up');
  assert.ok(!g.crystals.some((c) => g.snake.some((p) => eq(p, c))));
});

test('speed is capped', () => {
  const g = newGame();
  for (let k = 0; k < 200; k++) {
    g.crystals = [step(g.head, g.dir).p];
    g.grow = 0;
    g.tick();
    if (g.status !== 'running') break;
    if (k % 10 === 9) { g.queueTurn(k % 20 === 9 ? 'up' : 'down'); }
  }
  assert.ok(g.interval >= MIN_INTERVAL);
});

test('self collision ends the run and saves best score', () => {
  const storage = memStorage();
  const g = newGame({ storage });
  g.score = 50;
  g.grow = 6;
  for (let k = 0; k < 4; k++) g.tick();
  g.queueTurn('up'); g.tick();
  g.queueTurn('left'); g.tick();
  g.queueTurn('down'); g.tick(); // into own body
  assert.equal(g.status, 'over');
  assert.equal(g.best, 50);
  assert.equal(storage.m.get(BEST_KEY), '50');
  const g2 = new Game({ storage });
  assert.equal(g2.best, 50);
});

test('moving into the tail cell is legal (tail moves away)', () => {
  const g = newGame();
  // A length-4 snake can chase its own tail in a 2×2 loop.
  g.snake = [cellToPoint(0, 5, 5), cellToPoint(0, 4, 5), cellToPoint(0, 4, 4), cellToPoint(0, 5, 4)];
  g.links = ['step', 'step', 'step', 'step'];
  g.dir = [0, -1, 0];
  g.tick();
  assert.equal(g.status, 'running');
  assert.deepEqual(g.head, cellToPoint(0, 5, 4));
});

test('ghost mode lets the snake pass through itself, then expires', () => {
  const g = newGame();
  g.grow = 6;
  for (let k = 0; k < 4; k++) g.tick();
  g.ghostCrystal = { p: step(g.head, g.dir).p, ms: 5000 };
  g.tick();
  assert.ok(g.ghost);
  assert.equal(g.score, 25);
  g.queueTurn('up'); g.tick();
  g.queueTurn('left'); g.tick();
  g.queueTurn('down'); g.tick(); // through body
  assert.equal(g.status, 'running');
  g.update(GHOST_MS + 10);
  assert.ok(!g.ghost);
});

test('pause / resume / restart', () => {
  const g = newGame();
  const head = g.head.slice();
  g.pause();
  assert.equal(g.status, 'paused');
  g.update(5000);
  assert.deepEqual(g.head, head, 'no movement while paused');
  g.queueTurn('up');
  assert.equal(g.turns.length, 0, 'input ignored while paused');
  g.resume();
  g.update(START_INTERVAL + 1);
  assert.notDeepEqual(g.head, head);
  g.score = 30;
  g.restart();
  assert.equal(g.score, 0);
  assert.equal(g.status, 'running');
  assert.equal(g.snake.length, START_LENGTH);
});

test('best score survives broken storage', () => {
  const bad = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); } };
  const g = new Game({ storage: bad });
  assert.equal(g.best, 0);
  g.start(); g.score = 10; g.die(g.head);
  assert.equal(g.best, 10);
});

test('crystal spawns on free reachable cells (many seeds)', () => {
  for (let seed = 1; seed < 60; seed++) {
    const g = new Game({ rng: rng(seed), storage: memStorage() });
    const occ = new Set(g.snake.map(key));
    assert.equal(g.crystals.length, CRYSTAL_COUNT);
    assert.equal(new Set(g.crystals.map(key)).size, CRYSTAL_COUNT, 'no stacked crystals');
    for (const c of g.crystals) {
      assert.ok(isValidCell(c));
      assert.ok(!occ.has(key(c)));
      if (g.portals) assert.ok(!eq(c, g.portals.a) && !eq(c, g.portals.b));
    }
    // Spread: 10 crystals over 6 faces → every face has 1 or 2.
    const per = [0, 0, 0, 0, 0, 0];
    for (const c of g.crystals) per[faceOf(c).id]++;
    assert.ok(per.every((n) => n >= 1 && n <= 2), `uneven spread ${per}`);
  }
});

test('crystal never spawns in an enclosed pocket', () => {
  const g = newGame();
  // Wall off a corner cell (0,0) of face 0 with body segments at (1,0) and (0,1)... plus the other faces' neighbours.
  const pocket = cellToPoint(4, 0, 0); // a corner cell on top face
  const walls = [];
  for (const d of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
    walls.push(step(pocket, d).p);
  }
  g.snake = [g.head, ...walls];
  g.links = g.snake.map(() => 'step');
  for (let k = 0; k < 300; k++) {
    const c = g.spawnCrystal();
    assert.ok(!eq(c, pocket), 'crystal placed in unreachable pocket');
  }
});

test('portals: placed on two different faces, free, away from the head', () => {
  for (let seed = 1; seed < 40; seed++) {
    const g = new Game({ rng: rng(seed), storage: memStorage() });
    const { a, b } = g.portals;
    assert.notEqual(faceOf(a).id, faceOf(b).id);
    const occ = new Set(g.snake.map(key));
    assert.ok(!occ.has(key(a)) && !occ.has(key(b)));
    assert.ok(!g.crystals.some((c) => eq(c, a) || eq(c, b)));
    const dist = g.surfaceDistances(g.head, occ);
    assert.ok(dist.get(key(a)) >= 5 && dist.get(key(b)) >= 5);
  }
});

test('portal teleports head; body follows over subsequent ticks; camera retargets', () => {
  const g = newGame();
  const entry = step(g.head, g.dir).p;
  const exit = cellToPoint(4, 6, 6); // top face (Frost Peak)
  g.portals = { a: entry, b: exit, active: true };
  g.grow = 0;
  g.tick();
  assert.deepEqual(g.head, exit);
  assert.equal(g.links[0], 'portal');
  assert.deepEqual(g.view.n, [0, 1, 0]);
  assert.equal(dot(g.dir, g.view.n), 0, 'exit heading lies on destination face');
  assert.deepEqual(g.dir, g.view.up.length ? g.dir : null);
  assert.ok(!g.portals.active, 'portals close after use');
  const ev = g.drainEvents();
  assert.ok(ev.some((e) => e.type === 'portal' && e.toFace === 4));
  // Heading is preserved relative to the screen (we were going screen-right).
  assert.deepEqual(g.dir, cross(g.view.up, g.view.n));
  // Body follows the head through the portal one tick at a time.
  for (let k = 1; k < START_LENGTH; k++) {
    g.tick();
    assert.equal(g.status, 'running');
    assert.equal(g.snake.filter((p) => faceOf(p).id === 4).length, k + 1);
    assertContinuous(g);
  }
  // Once the whole body is through, portals relocate.
  g.tick();
  assert.ok(g.portals.active);
  assert.ok(!eq(g.portals.a, entry) || !eq(g.portals.b, exit));
});

test('portal exit avoids an immediately fatal heading', () => {
  const g = newGame();
  const entry = step(g.head, g.dir).p;
  const exit = cellToPoint(4, 6, 6);
  g.portals = { a: entry, b: exit, active: true };
  // Preferred exit (screen-right on top face = +X) is blocked by a body segment.
  const block = cellToPoint(4, 7, 6);
  g.snake.push(block, cellToPoint(4, 8, 6));
  g.links.push('step', 'step');
  g.tick();
  assert.deepEqual(g.head, exit);
  for (let k = 0; k < 3; k++) { g.tick(); assert.equal(g.status, 'running', 'died right after portal'); }
});

test('portal with no safe exit behaves as a normal cell', () => {
  const g = newGame();
  const entry = step(g.head, g.dir).p;
  const exit = cellToPoint(4, 6, 6);
  g.portals = { a: entry, b: exit, active: true };
  // Surround the exit completely.
  for (const d of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
    g.snake.push(step(exit, d).p);
    g.links.push('step');
  }
  g.snake.push(cellToPoint(2, 0, 0)); g.links.push('step'); // spare tail segment
  g.tick();
  assert.deepEqual(g.head, entry);
  assert.equal(g.status, 'running');
});

test('fuzz: random play never produces invalid or discontinuous state', () => {
  const dirs = ['up', 'down', 'left', 'right'];
  for (let seed = 1; seed <= 25; seed++) {
    const r = rng(seed * 31);
    const g = new Game({ rng: rng(seed), storage: memStorage() });
    g.start();
    for (let k = 0; k < 600 && g.status === 'running'; k++) {
      if (r() < 0.3) g.queueTurn(dirs[Math.floor(r() * 4)]);
      g.tick();
      for (const p of g.snake) assert.ok(isValidCell(p));
      assert.equal(g.links.length, g.snake.length);
      assert.deepEqual(g.view.n, normalOf(g.head));
      assert.equal(dot(g.dir, g.view.n), 0);
      if (!g.ghost && g.status === 'running') {
        assert.equal(new Set(g.snake.map(key)).size, g.snake.length);
      }
      assertContinuous(g);
      for (const c of g.crystals) assert.ok(!g.snake.some((p) => eq(p, c)) || g.ghost);
      assert.equal(new Set(g.crystals.map(key)).size, g.crystals.length);
      if (g.status === 'running') assert.equal(g.crystals.length, CRYSTAL_COUNT);
    }
  }
});

test('eating any of the crystals scores, grows, and is replaced immediately', () => {
  const g = new Game({ rng: rng(3), storage: memStorage() });
  g.start();
  g.portals = null;
  // Put one of the 10 crystals directly in front of the head.
  const target = step(g.head, g.dir).p;
  g.crystals = g.crystals.filter((c) => !eq(c, target));
  g.crystals[4] = target;
  const others = g.crystals.filter((c) => !eq(c, target)).map(key);
  const len = g.snake.length;
  g.tick();
  assert.equal(g.score, 10);
  assert.equal(g.snake.length, len + 1);
  assert.equal(g.crystals.length, CRYSTAL_COUNT);
  assert.ok(!g.crystals.some((c) => eq(c, target)), 'eaten crystal removed');
  for (const k of others) assert.ok(g.crystals.some((c) => key(c) === k), 'other crystals untouched');
  g.tick();
  assert.equal(g.snake.length, len + 2);
});

test('when fewer than 10 cells are free, uses what is available without blocking', () => {
  const g = new Game({ rng: rng(5), storage: memStorage() });
  g.start();
  g.portals = null;
  g.ghostCrystal = null;
  // Fill almost the whole cube with "body" so only 3 reachable cells remain.
  const head = g.head;
  const keep = [];
  let p = head, d = g.dir;
  for (let k = 0; k < 5; k++) { const s = step(p, d); p = s.p; d = s.d; keep.push(p); }
  const keepKeys = new Set([key(head), ...keep.map(key)]);
  g.snake = [head, ...allCells().filter((c) => !keepKeys.has(key(c)))];
  g.links = g.snake.map(() => 'step');
  g.crystals = [];
  g.fillCrystals();
  // keep[0] is adjacent to the head (distance 1) so it's skipped; 4 remain.
  assert.equal(g.crystals.length, 4);
  assert.equal(new Set(g.crystals.map(key)).size, 4);
  for (const c of g.crystals) assert.ok(keep.some((q) => eq(q, c)));
  assert.equal(g.spawnCrystal(), null);
});

test('update() advances at the configured tick rate', () => {
  const g = newGame();
  const t0 = g.tickCount;
  g.update(START_INTERVAL * 3 + 1);
  assert.equal(g.tickCount - t0, 3);
});

test('all cells is 864', () => assert.equal(allCells().length, 864));

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DODECA as D, CUBE, screenVector } from '../src/topology.js';
import { Game, CRYSTAL_COUNT, START_LENGTH } from '../src/game.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(...a);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const pk = (p) => p.map((x) => Math.round(x * 1e4)).join(',');

function rng(seed = 1) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
}
function adjacent(a, b) {
  return D.cellData[a].nbr.some((nb) => nb.cell === b);
}

// ---------- the solid ----------
test('12 faces, all regular pentagons; 20 vertices; 30 edges', () => {
  assert.equal(D.faces.length, 12);
  const vset = new Set(), eset = new Set();
  for (const f of D.faces) {
    assert.equal(f.ring.length, 5, 'pentagon');
    for (let k = 0; k < 5; k++) {
      const a = f.ring[k], b = f.ring[(k + 1) % 5], c = f.ring[(k + 2) % 5];
      assert.ok(near(len(sub(b, a)), D.edge, 1e-9), 'equal edges');
      // interior angle 108°
      const ang = Math.acos(dot(sub(a, b), sub(c, b)) / (len(sub(a, b)) * len(sub(c, b))));
      assert.ok(near(ang, (108 * Math.PI) / 180, 1e-9), 'regular angle');
      assert.ok(near(dot(sub(a, f.c), f.n), 0, 1e-9), 'planar');
      assert.ok(dot(cross(sub(b, a), sub(c, b)), f.n) > 0, 'CCW seen from outside');
      vset.add(pk(a));
      eset.add([pk(a), pk(b)].sort().join('|'));
    }
  }
  assert.equal(vset.size, 20);
  assert.equal(eset.size, 30);
});

// ---------- the cell mesh ----------
test('960 quad cells, 80 per face, planar and CCW', () => {
  assert.equal(D.cells.length, 12 * 5 * D.K * D.K);
  const perFace = new Array(12).fill(0);
  for (const c of D.cellData) {
    perFace[c.face]++;
    const n = D.faces[c.face].n;
    for (let e = 0; e < 4; e++) {
      const a = c.corners[e], b = c.corners[(e + 1) % 4], q = c.corners[(e + 2) % 4];
      assert.ok(near(dot(sub(a, D.faces[c.face].c), n), 0, 1e-9));
      assert.ok(dot(cross(sub(b, a), sub(q, b)), n) > 1e-6, 'convex CCW quad');
    }
  }
  assert.ok(perFace.every((x) => x === 5 * D.K * D.K));
});

test('every cell has 4 neighbours and adjacency is symmetric', () => {
  for (const c of D.cellData) {
    assert.equal(c.nbr.length, 4);
    for (let e = 0; e < 4; e++) {
      const nb = c.nbr[e];
      assert.notEqual(nb.cell, c.id);
      const back = D.cellData[nb.cell].nbr[nb.edge];
      assert.equal(back.cell, c.id);
      assert.equal(back.edge, e);
      assert.ok(len(sub(c.center, D.cellData[nb.cell].center)) < 2.2, 'neighbours are close');
    }
  }
});

test('cell mesh is a closed sphere: V − E + F = 2, and fully connected', () => {
  const V = new Set(), E = new Set();
  for (const c of D.cellData) for (let e = 0; e < 4; e++) {
    const a = pk(c.corners[e]), b = pk(c.corners[(e + 1) % 4]);
    V.add(a); E.add([a, b].sort().join('|'));
  }
  assert.equal(V.size - E.size + D.cells.length, 2);
  const g = new Game({ topology: D, storage: memStorage() });
  const dist = g.surfaceDistances(0, new Set());
  assert.equal(dist.size, D.cells.length);
});

test('every move is reversible and lands on a neighbour', () => {
  for (const c of D.cells) for (const d of D.dirs(c)) {
    const s = D.step(c, d);
    assert.ok(adjacent(c, s.p));
    const back = D.step(s.p, (s.d + 2) % 4);
    assert.equal(back.p, c);
    assert.equal(back.d, (d + 2) % 4);
    assert.ok(D.isReverse(s.p, (s.d + 2) % 4, s.d));
  }
});

test('all 30 pentagon edges are crossable, onto the geometrically adjacent face', () => {
  const pairs = new Set();
  let crossings = 0;
  const cosDihedralNormals = 1 / Math.sqrt(5); // angle between adjacent face normals ≈ 63.43°
  for (const c of D.cells) for (const d of D.dirs(c)) {
    const s = D.step(c, d);
    if (!s.crossed) { assert.equal(s.from, s.to); continue; }
    crossings++;
    assert.ok(near(dot(D.faces[s.from].n, D.faces[s.to].n), cosDihedralNormals, 1e-9), 'adjacent faces only');
    pairs.add([s.from, s.to].sort((a, b) => a - b).join('-'));
    // The shared edge midpoint lies on both face planes.
    const m = D.edgeMid(c, s.p);
    for (const f of [s.from, s.to]) assert.ok(near(dot(sub(m, D.faces[f].c), D.faces[f].n), 0, 1e-6));
  }
  assert.equal(pairs.size, 30);
  assert.equal(crossings, 30 * 2 * D.K * 2); // 2K cells along each edge, both directions
});

test('heading is continuous across a face edge (unfolded bend < 45°)', () => {
  for (const c of D.cells) for (const d of D.dirs(c)) {
    const s = D.step(c, d);
    if (!s.crossed) continue;
    const out = D.dirVector(c, d);
    const view = D.crossView({ n: D.faces[s.from].n, up: out }, s); // carry "out" across like the camera
    assert.ok(dot(view.up, D.dirVector(s.p, s.d)) > Math.cos(Math.PI / 4));
    assert.ok(near(dot(view.up, view.n), 0, 1e-9));
    assert.deepEqual(view.n, D.faces[s.to].n);
  }
});

test('going straight traces a closed loop', () => {
  for (const c0 of [0, 77, 345, 959]) for (const d0 of D.dirs(c0)) {
    let c = c0, d = d0, k = 0;
    do { const s = D.step(c, d); c = s.p; d = s.d; k++; } while ((c !== c0 || d !== d0) && k < 5000);
    assert.equal(c, c0);
    assert.ok(k < 5000);
  }
});

// ---------- controls ----------
test('screen-relative controls: straight / left / right / reversal on every cell', () => {
  for (const c of D.cells) for (const d of D.dirs(c)) {
    const n = D.normal(c);
    const h = D.dirVector(c, d);
    const view = { n, up: cross(n, h) }; // heading is exactly screen-right
    assert.equal(D.resolveTurn(view, 'right', c, d), d, 'pressing the heading keeps going');
    assert.equal(D.resolveTurn(view, 'up', c, d), (d + 1) % 4, 'up turns left (CCW)');
    assert.equal(D.resolveTurn(view, 'down', c, d), (d + 3) % 4, 'down turns right');
    const back = D.resolveTurn(view, 'left', c, d);
    assert.ok(back === null || !D.isReverse(c, back, d), 'never reverses');
  }
});

test('camera basis stays orthonormal and on the head face during play', () => {
  const g = new Game({ topology: D, rng: rng(4), storage: memStorage() });
  g.crystals = []; g.portals = null; g.fillCrystals = () => {};
  g.start();
  for (let k = 0; k < 400 && g.status === 'running'; k++) {
    if (k % 7 === 0) g.queueTurn(['up', 'down'][k % 2]);
    g.tick();
    assert.deepEqual(g.view.n, D.normal(g.head));
    assert.ok(near(len(g.view.up), 1, 1e-9));
    assert.ok(near(dot(g.view.up, g.view.n), 0, 1e-9));
  }
});

// ---------- full game rules on the dodecahedron ----------
function newGame(seed = 7) {
  const g = new Game({ topology: D, rng: rng(seed), storage: memStorage() });
  g.start();
  return g;
}

test('start state: 4 segments on face 0, heading screen-right, crystals & portals placed', () => {
  const g = newGame();
  assert.equal(g.snake.length, START_LENGTH);
  assert.ok(g.snake.every((c) => D.faceOf(c) === 0));
  for (let k = 0; k + 1 < g.snake.length; k++) assert.ok(adjacent(g.snake[k], g.snake[k + 1]));
  assert.ok(dot(D.dirVector(g.head, g.dir), screenVector(g.view, 'right')) > 0.99);
  assert.equal(g.crystals.length, CRYSTAL_COUNT);
  const faces = new Set(g.crystals.map(D.faceOf));
  assert.equal(faces.size, CRYSTAL_COUNT, 'crystals spread over 10 different faces');
  const occ = new Set(g.snake);
  for (const c of g.crystals) assert.ok(!occ.has(c) && c !== g.portals.a && c !== g.portals.b);
  assert.notEqual(D.faceOf(g.portals.a), D.faceOf(g.portals.b));
});

test('crystals and portals are reachable and unoccupied (many seeds)', () => {
  for (let seed = 1; seed < 30; seed++) {
    const g = newGame(seed);
    const occ = new Set(g.snake);
    const dist = g.surfaceDistances(g.head, occ);
    for (const c of [...g.crystals, g.portals.a, g.portals.b]) {
      assert.ok(!occ.has(c));
      assert.ok(dist.has(c), 'reachable');
    }
    assert.ok(dist.get(g.portals.a) >= 5 && dist.get(g.portals.b) >= 5);
  }
});

test('eating grows by 2, scores 10, replaces the crystal', () => {
  const g = newGame();
  g.portals = null;
  const t = D.step(g.head, g.dir).p;
  g.crystals = g.crystals.filter((c) => c !== t);
  g.crystals[0] = t;
  const len0 = g.snake.length;
  g.tick(); g.tick();
  assert.equal(g.score, 10);
  assert.equal(g.snake.length, len0 + 2);
  assert.equal(g.crystals.length, CRYSTAL_COUNT);
  assert.ok(!g.crystals.includes(t));
});

test('reversal is impossible; body collision ends the run', () => {
  const g = newGame();
  g.portals = null; g.crystals = []; g.fillCrystals = () => {};
  const d0 = g.dir;
  g.queueTurn('left'); // straight back
  g.tick();
  assert.ok(!D.isReverse(g.snake[1], g.dir, d0) || g.dir === d0);
  assert.equal(g.status, 'running');
  // Keep turning left (CCW) – the head must run into its own body.
  g.grow = 10;
  let k = 0;
  while (g.status === 'running' && k++ < 40) { g.dir = (g.dir + 1) % 4; g.tick(); }
  assert.equal(g.status, 'over');
});

test('portal: head jumps faces, body follows tick by tick, camera retargets', () => {
  const g = newGame();
  g.crystals = []; g.fillCrystals = () => {};
  const entry = D.step(g.head, g.dir).p;
  const exit = D.cells.find((c) => D.faceOf(c) === 6 && D.cellData[c].i === 1 && D.cellData[c].j === 1);
  g.portals = { a: entry, b: exit, active: true };
  g.tick();
  assert.equal(g.head, exit);
  assert.equal(g.links[0], 'portal');
  assert.deepEqual(g.view.n, D.faces[6].n);
  assert.ok(!g.portals.active);
  for (let k = 1; k < START_LENGTH; k++) {
    g.tick();
    assert.equal(g.status, 'running');
    for (let q = 0; q + 1 < g.snake.length; q++) if (g.links[q] !== 'portal') assert.ok(adjacent(g.snake[q + 1], g.snake[q]));
  }
  g.tick();
  assert.ok(g.portals.active, 'portals relocate once the snake is through');
});

test('separate best scores for cube and dodecahedron', () => {
  const storage = memStorage();
  const gd = new Game({ topology: D, storage });
  gd.start(); gd.score = 70; gd.die(gd.head);
  const gc = new Game({ topology: CUBE, storage });
  assert.equal(gc.best, 0);
  gc.start(); gc.score = 30; gc.die(gc.head);
  assert.equal(new Game({ topology: D, storage }).best, 70);
  assert.equal(new Game({ topology: CUBE, storage }).best, 30);
  assert.notEqual(D.bestKey, CUBE.bestKey);
});

test('pause / restart on the dodecahedron', () => {
  const g = newGame();
  g.pause();
  const h = g.head;
  g.update(3000);
  assert.equal(g.head, h);
  g.resume(); g.score = 40; g.restart();
  assert.equal(g.score, 0);
  assert.equal(g.status, 'running');
});

test('fuzz: random play keeps a valid, continuous snake', () => {
  const dirs = ['up', 'down', 'left', 'right'];
  for (let seed = 1; seed <= 20; seed++) {
    const r = rng(seed * 17);
    const g = newGame(seed);
    for (let k = 0; k < 700 && g.status === 'running'; k++) {
      if (r() < 0.3) g.queueTurn(dirs[Math.floor(r() * 4)]);
      g.tick();
      assert.equal(g.links.length, g.snake.length);
      if (g.status !== 'running') break;
      if (!g.ghost) assert.equal(new Set(g.snake).size, g.snake.length);
      for (let q = 0; q + 1 < g.snake.length; q++) if (g.links[q] !== 'portal') assert.ok(adjacent(g.snake[q + 1], g.snake[q]));
      assert.equal(g.crystals.length, CRYSTAL_COUNT);
      for (const c of g.crystals) assert.ok(g.ghost || !g.snake.includes(c));
    }
  }
});

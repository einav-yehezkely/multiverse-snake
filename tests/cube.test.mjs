import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  N, FACES, step, cellToPoint, pointToCell, isValidCell, normalOf, faceOf, faceDirs,
  allCells, neg, eq, dot, cross, key, rotateFaceToFace,
} from '../src/cube.js';

test('faces form a right-handed, consistent frame', () => {
  assert.equal(FACES.length, 6);
  const normals = new Set(FACES.map((f) => key(f.n)));
  assert.equal(normals.size, 6);
  for (const f of FACES) {
    assert.deepEqual(cross(f.u, f.v), f.n, `${f.name} u×v must equal n`);
  }
});

test('cell <-> point round trip covers 864 unique valid cells', () => {
  const cells = allCells();
  assert.equal(cells.length, 6 * N * N);
  assert.equal(new Set(cells.map(key)).size, cells.length);
  for (const f of FACES) {
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const p = cellToPoint(f.id, i, j);
      assert.ok(isValidCell(p));
      assert.deepEqual(pointToCell(p), { face: f.id, i, j });
    }
  }
});

test('every move from every cell in every direction lands on a valid neighbour', () => {
  for (const p of allCells()) {
    for (const d of faceDirs(p)) {
      const s = step(p, d);
      assert.ok(isValidCell(s.p), `invalid result from ${p} dir ${d}`);
      assert.equal(dot(s.d, normalOf(s.p)), 0, 'new direction must lie on new face');
      // Neighbouring cell centres are always 2 doubled-units apart in L1 along the path.
      const l1 = Math.abs(s.p[0] - p[0]) + Math.abs(s.p[1] - p[1]) + Math.abs(s.p[2] - p[2]);
      assert.equal(l1, 2);
      // Reverse transform returns exactly to the start, heading the opposite way.
      const back = step(s.p, neg(s.d));
      assert.deepEqual(back.p, p);
      assert.deepEqual(back.d, neg(d));
    }
  }
});

test('all 24 directed edges are crossed, each onto the correct neighbouring face', () => {
  const seen = new Set();
  for (const p of allCells()) {
    for (const d of faceDirs(p)) {
      const s = step(p, d);
      if (!s.crossed) continue;
      assert.deepEqual(s.to, d, 'crossing in direction d lands on the face with normal d');
      assert.deepEqual(s.d, neg(s.from), 'after crossing you head away from the old face');
      assert.deepEqual(normalOf(s.p), d);
      seen.add(key(s.from) + '>' + key(s.to));
    }
  }
  assert.equal(seen.size, 24);
});

test('explicit edge example: front face right edge → jungle face left column', () => {
  // Front (+Z) face, rightmost column, row 3, moving +X.
  const p = cellToPoint(0, N - 1, 3);
  const s = step(p, [1, 0, 0]);
  assert.ok(s.crossed);
  const c = pointToCell(s.p);
  assert.equal(c.face, 1); // +X Emerald Jungle
  // Jungle face u = -Z, so the column touching the front face is i = 0.
  assert.equal(c.i, 0);
  assert.equal(c.j, 3); // the shared Y axis keeps the row
  assert.deepEqual(s.d, [0, 0, -1]);
});

test('walking straight 4N cells loops around the cube back to the start', () => {
  for (const p0 of [cellToPoint(0, 3, 7), cellToPoint(4, 0, 11), cellToPoint(5, 6, 2)]) {
    for (const d0 of faceDirs(p0)) {
      let p = p0, d = d0, crossings = 0;
      for (let k = 0; k < 4 * N; k++) { const s = step(p, d); p = s.p; d = s.d; if (s.crossed) crossings++; }
      assert.deepEqual(p, p0);
      assert.deepEqual(d, d0);
      assert.equal(crossings, 4);
    }
  }
});

test('rotateFaceToFace carries normals correctly', () => {
  for (const a of FACES) for (const b of FACES) {
    const hint = a.v;
    if (eq(a.n, neg(b.n))) {
      const r = rotateFaceToFace(a.n, a.n, b.n, hint);
      assert.deepEqual(r, b.n);
      assert.deepEqual(rotateFaceToFace(hint, a.n, b.n, hint), hint);
    } else {
      assert.deepEqual(rotateFaceToFace(a.n, a.n, b.n, hint), b.n);
    }
    // In-plane vectors of a map to in-plane vectors of b.
    assert.equal(dot(rotateFaceToFace(a.u, a.n, b.n, hint), b.n), 0);
  }
});

test('faceOf identifies the face', () => {
  assert.equal(faceOf(cellToPoint(3, 1, 1)).id, 3);
});

// Cube surface geometry for an N×N grid on every face.
//
// Representation: every cell centre is an integer 3D point in "doubled" units,
// where the cube spans [-N, N] on every axis. A cell on face with outward
// normal n, column i and row j sits at
//     P = n·N + u·(2i + 1 − N) + v·(2j + 1 − N)
// so exactly one coordinate is ±N (the face) and the other two are odd.
// A direction is always a unit axis vector lying in the face plane.
//
// Moving one cell is P + 2d. If that leaves the face, the snake wraps over the
// edge onto the face whose normal is d, travelling in direction −n:
//     P' = P + d − n,   n' = d,   d' = −n
// One rule covers all 24 directed edges – no per-face special cases.

export const N = 12;

export const vec = (x, y, z) => [x, y, z];
// `+ 0` normalises -0 to 0 so vectors compare cleanly.
export const add = (a, b) => [a[0] + b[0] + 0, a[1] + b[1] + 0, a[2] + b[2] + 0];
export const sub = (a, b) => [a[0] - b[0] + 0, a[1] - b[1] + 0, a[2] - b[2] + 0];
export const scale = (a, s) => [a[0] * s + 0, a[1] * s + 0, a[2] * s + 0];
export const neg = (a) => [0 - a[0], 0 - a[1], 0 - a[2]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + 0;
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1] + 0,
  a[2] * b[0] - a[0] * b[2] + 0,
  a[0] * b[1] - a[1] * b[0] + 0,
];
export const eq = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
export const key = (p) => p[0] + ',' + p[1] + ',' + p[2];

// Six faces. u/v are the in-face column/row axes with u × v = n.
export const FACES = [
  { id: 0, name: 'Neon City', n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { id: 1, name: 'Emerald Jungle', n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { id: 2, name: 'Void Nebula', n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  { id: 3, name: 'Molten Core', n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { id: 4, name: 'Frost Peak', n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { id: 5, name: 'Dune Sea', n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
];

/** Face whose outward normal equals n. */
export function faceByNormal(n) {
  for (const f of FACES) if (eq(f.n, n)) return f;
  throw new Error('not a face normal: ' + n);
}

/** Outward normal of the face containing cell point p. */
export function normalOf(p) {
  for (let a = 0; a < 3; a++) {
    if (Math.abs(p[a]) === N) {
      const n = [0, 0, 0];
      n[a] = Math.sign(p[a]);
      return n;
    }
  }
  throw new Error('point not on cube surface: ' + p);
}

export function faceOf(p) {
  return faceByNormal(normalOf(p));
}

export function cellToPoint(faceId, i, j) {
  const f = FACES[faceId];
  return add(add(scale(f.n, N), scale(f.u, 2 * i + 1 - N)), scale(f.v, 2 * j + 1 - N));
}

export function pointToCell(p) {
  const f = faceOf(p);
  return { face: f.id, i: (dot(p, f.u) + N - 1) / 2, j: (dot(p, f.v) + N - 1) / 2 };
}

export function isValidCell(p) {
  let onFace = 0;
  for (let a = 0; a < 3; a++) {
    const c = p[a];
    if (Math.abs(c) === N) onFace++;
    else if (!(Math.abs(c) < N && Math.abs(c) % 2 === 1)) return false;
  }
  return onFace === 1;
}

/**
 * Advance one cell from point p in direction d (d must lie in p's face plane).
 * Returns { p, d, crossed, from, to } where from/to are face normals.
 */
export function step(p, d) {
  const n = normalOf(p);
  if (dot(n, d) !== 0 || Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2]) !== 1) {
    throw new Error('direction not in face plane');
  }
  const q = add(p, scale(d, 2));
  if (Math.abs(dot(q, d)) < N) return { p: q, d, crossed: false, from: n, to: n };
  return { p: sub(add(p, d), n), d: neg(n), crossed: true, from: n, to: d };
}

/** The four in-plane directions of the face containing p. */
export function faceDirs(p) {
  const f = faceOf(p);
  return [f.u, neg(f.u), f.v, neg(f.v)];
}

/** All cell points on the cube, N*N*6 of them. */
export function allCells() {
  const out = [];
  for (const f of FACES) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) out.push(cellToPoint(f.id, i, j));
  return out;
}

/**
 * Rotate vector x by the 90°/180° rotation that carries unit normal a onto b.
 * For a == b it is the identity; for b == −a it is a half-turn about `axisHint`
 * (a vector perpendicular to a), which keeps axisHint fixed.
 */
export function rotateFaceToFace(x, a, b, axisHint) {
  if (eq(a, b)) return x.slice();
  if (eq(a, neg(b))) {
    // 180° about axisHint k: x → 2(k·x)k − x
    return sub(scale(axisHint, 2 * dot(axisHint, x)), x);
  }
  // 90° about k = a × b (Rodrigues with cos = 0, sin = 1): x → k×x + k(k·x)
  const k = cross(a, b);
  return add(cross(k, x), scale(k, dot(k, x)));
}

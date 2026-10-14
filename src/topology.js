// Board topologies. The game engine only talks to this interface, so the
// cube and dodecahedron share every rule (food, portals, ghost, scoring).
//
// A topology provides:
//   id, name, faceCount, bestKey, cells[]
//   key(c), eq(a,b), sameDir(a,b), faceOf(c) → face index
//   dirs(c) → exit directions, step(c,d) → {p, d, crossed, from, to}
//   isReverse(c, d, cur), resolveTurn(view, screenDir, c, cur) → dir | null
//   crossView(view, st), portalTransfer(entry, target, dir, view) → {view, dir}
//   start() → {snake (START_LENGTH cells + the cell behind the tail), dir, view}
//   Geometry (world units) for the renderer: center(c), normal(c), dirVector(c,d),
//   edgeMid(a,b), faceBasis(f) → {n,u,v}, inradius, faceRadius, viewFit, segScale
import * as C from './cube.js';

// ---------- float vector helpers ----------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => mul(a, 1 / len(a));

/** Rotate x about unit axis k by angle θ (Rodrigues). */
function rotate(x, k, th) {
  const c = Math.cos(th), s = Math.sin(th);
  return add(add(mul(x, c), mul(cross(k, x), s)), mul(k, dot(k, x) * (1 - c)));
}
/** Rotate x by the minimal rotation taking unit a onto unit b (half-turn about `hint` if opposite). */
export function rotateOnto(x, a, b, hint) {
  const d = Math.max(-1, Math.min(1, dot(a, b)));
  if (d > 1 - 1e-9) return x.slice();
  if (d < -1 + 1e-9) return rotate(x, norm(hint), Math.PI);
  return rotate(x, norm(cross(a, b)), Math.acos(d));
}
/** Make `up` exactly tangent to the plane with normal n. */
const tangent = (up, n) => norm(sub(up, mul(n, dot(up, n))));

// ======================================================================
// Cube: thin adapter over cube.js (unchanged integer maths).
// ======================================================================
export const CUBE = {
  id: 'cube',
  name: 'Cube',
  faceCount: 6,
  themeOf: (f) => f,
  bestKey: 'multiverse-snake-best',
  cells: C.allCells(),
  key: C.key,
  eq: C.eq,
  sameDir: C.eq,
  faceOf: (p) => C.faceOf(p).id,
  dirs: C.faceDirs,
  step: C.step,
  isReverse: (p, d, cur) => C.eq(d, C.neg(cur)),
  resolveTurn: (view, s) => screenVector(view, s),
  crossView: (view, st) => ({ n: st.to.slice(), up: C.rotateFaceToFace(view.up, st.from, st.to, view.up) }),
  portalTransfer(entry, target, dir, view) {
    const nIn = C.normalOf(entry), nOut = C.normalOf(target);
    return {
      view: { n: nOut.slice(), up: C.rotateFaceToFace(view.up, nIn, nOut, view.up) },
      dir: C.rotateFaceToFace(dir, nIn, nOut, view.up),
    };
  },
  start() {
    const f = C.FACES[0];
    const j = Math.floor(C.N / 2);
    const snake = [];
    for (let k = 0; k < 5; k++) snake.push(C.cellToPoint(f.id, 5 - k, j)); // 4 segments + the cell behind the tail
    return { snake, dir: f.u.slice(), view: { n: f.n.slice(), up: f.v.slice() } };
  },
  // geometry
  center: (p) => mul(p, 0.5),
  normal: C.normalOf,
  dirVector: (p, d) => d,
  edgeMid: (a, b) => mul(add(a, C.normalOf(b)), 0.5),
  faceBasis: (f) => C.FACES[f],
  inradius: C.N / 2,
  faceRadius: C.N / 2,
  viewFit: 19,
  segScale: 1,
  boundRadius: (C.N / 2) * Math.sqrt(3), // centre → corner
};

/** Screen-relative direction → 3D vector for a camera basis {n, up}. */
export function screenVector(view, s) {
  const right = cross(view.up, view.n).map((x) => x + 0);
  switch (s) {
    case 'up': return view.up.slice();
    case 'down': return view.up.map((x) => 0 - x);
    case 'right': return right;
    case 'left': return right.map((x) => 0 - x);
  }
  throw new Error('bad screen dir ' + s);
}

// ======================================================================
// Dodecahedron: 12 regular pentagons. Each pentagon is split into 5 kites
// (centre → edge midpoint → corner → edge midpoint), and each kite into a
// K×K grid of quads. The whole surface becomes a pure quad mesh: every cell
// has exactly 4 edges, so "straight / left / right / no reversing" works
// everywhere. Directions are local edge indices 0..3 (CCW seen from outside);
// moving out through edge d lands in the neighbour, entering via edge e, and
// "straight on" there is (e + 2) % 4. Adjacency is derived from shared corner
// coordinates, never hand-written, so every seam and face edge is consistent.
// ======================================================================
export function buildDodecahedron(K = 4, edge = 7) {
  const phi = (1 + Math.sqrt(5)) / 2;
  const s = (edge * phi) / 2; // canonical dodecahedron has edge 2/φ
  const V = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) V.push([x, y, z]);
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    V.push([0, a / phi, b * phi]);
    V.push([a / phi, b * phi, 0]);
    V.push([a * phi, 0, b / phi]);
  }
  const verts = V.map((v) => mul(v, s));
  const normals = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    normals.push(norm([a, 0, b * phi]));
    normals.push(norm([0, a * phi, b]));
    normals.push(norm([a * phi, b, 0]));
  }
  // Order faces so face 0 faces the viewer (+Z-ish) and neighbours follow.
  normals.sort((p, q) => (q[2] - p[2]) || (q[1] - p[1]) || (q[0] - p[0]));

  const faces = normals.map((n, id) => {
    const ds = verts.map((v) => dot(v, n));
    const top = Math.max(...ds);
    const ring = verts.filter((v, k) => ds[k] > top - 1e-6);
    if (ring.length !== 5) throw new Error('dodecahedron face construction failed');
    const c = mul(n, top);
    const u = norm(sub(ring[0], c));
    const v = cross(n, u);
    ring.sort((p, q) => Math.atan2(dot(sub(p, c), v), dot(sub(p, c), u)) - Math.atan2(dot(sub(q, c), v), dot(sub(q, c), u)));
    // Texture basis: "up" points at the first corner, so pentagons stand upright.
    const vUp = norm(sub(ring[0], c));
    const uRight = cross(vUp, n);
    return { id, n, u: uRight, v: vUp, c, ring };
  });

  // Cells
  const cells = [];
  const bil = (A, B, Cc, D, x, y) => add(add(mul(A, (1 - x) * (1 - y)), mul(B, x * (1 - y))), add(mul(Cc, x * y), mul(D, (1 - x) * y)));
  for (const f of faces) {
    const P = f.ring;
    const Q = P.map((p, k) => mul(add(p, P[(k + 1) % 5]), 0.5));
    for (let k = 0; k < 5; k++) {
      const A = f.c, B = Q[(k + 4) % 5], Cc = P[k], D = Q[k]; // CCW kite
      for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) {
        const corners = [
          bil(A, B, Cc, D, i / K, j / K), bil(A, B, Cc, D, (i + 1) / K, j / K),
          bil(A, B, Cc, D, (i + 1) / K, (j + 1) / K), bil(A, B, Cc, D, i / K, (j + 1) / K),
        ];
        const center = mul(corners.reduce(add), 0.25);
        cells.push({ id: cells.length, face: f.id, kite: k, i, j, corners, center });
      }
    }
  }
  // Adjacency by shared edge endpoints
  const pk = (p) => p.map((x) => Math.round(x * 1e4)).join(',');
  const edgeMap = new Map();
  for (const c of cells) {
    c.nbr = [];
    c.mids = [];
    for (let e = 0; e < 4; e++) {
      const a = c.corners[e], b = c.corners[(e + 1) % 4];
      const ka = pk(a), kb = pk(b);
      const k = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      if (!edgeMap.has(k)) edgeMap.set(k, []);
      edgeMap.get(k).push([c.id, e]);
      c.mids.push(mul(add(a, b), 0.5));
    }
  }
  for (const [k, list] of edgeMap) {
    if (list.length !== 2) throw new Error(`edge ${k} shared by ${list.length} cells`);
    const [[c1, e1], [c2, e2]] = list;
    cells[c1].nbr[e1] = { cell: c2, edge: e2 };
    cells[c2].nbr[e2] = { cell: c1, edge: e1 };
  }
  for (const c of cells) c.dirs = c.mids.map((m) => norm(sub(m, c.center)));

  const pentInradius = edge / (2 * Math.tan(Math.PI / 5));
  const topo = {
    id: 'dodeca',
    name: 'Dodecahedron',
    faceCount: 12,
    themeOf: (f) => f,
    bestKey: 'multiverse-snake-best-dodeca',
    K,
    edge,
    faces,
    cellData: cells,
    cells: cells.map((c) => c.id),
    key: (c) => c,
    eq: (a, b) => a === b,
    sameDir: (a, b) => a === b,
    faceOf: (c) => cells[c].face,
    dirs: () => [0, 1, 2, 3],
    step(c, d) {
      const nb = cells[c].nbr[d];
      const from = cells[c].face, to = cells[nb.cell].face;
      return { p: nb.cell, d: (nb.edge + 2) % 4, crossed: from !== to, from, to };
    },
    isReverse: (c, d, cur) => d === (cur + 2) % 4,
    /** Pick the exit (straight/left/right) that best matches the pressed screen direction. */
    resolveTurn(view, s, c, cur) {
      const w = screenVector(view, s);
      let best = null, bestDot = 0.35; // ignore presses that point nowhere useful
      for (let d = 0; d < 4; d++) {
        if (d === (cur + 2) % 4) continue;
        const dd = dot(cells[c].dirs[d], w);
        if (dd > bestDot) { best = d; bestDot = dd; }
      }
      return best;
    },
    crossView(view, st) {
      const a = faces[st.from].n, b = faces[st.to].n;
      return { n: b.slice(), up: tangent(rotateOnto(view.up, a, b, view.up), b) };
    },
    portalTransfer(entry, target, dir, view) {
      const a = faces[cells[entry].face].n, b = faces[cells[target].face].n;
      const up = tangent(rotateOnto(view.up, a, b, view.up), b);
      const h = rotateOnto(cells[entry].dirs[dir], a, b, view.up);
      let best = 0, bd = -2;
      for (let d = 0; d < 4; d++) { const x = dot(cells[target].dirs[d], h); if (x > bd) { bd = x; best = d; } }
      return { view: { n: b.slice(), up }, dir: best };
    },
    start() {
      // A cell on face 0 whose tail (and the cell behind it) and the next 2 cells ahead
      // all stay on face 0, heading as close to screen-right as possible.
      let found = null, bestAlign = -1;
      for (const c of cells) {
        if (c.face !== 0) continue;
        for (let d = 0; d < 4; d++) {
          const back = [c.id];
          let p = c.id, bd = (d + 2) % 4, ok = true;
          for (let k = 0; k < 4; k++) { const st = topo.step(p, bd); p = st.p; bd = st.d; if (cells[p].face !== 0) ok = false; back.push(p); }
          p = c.id; let fd = d;
          for (let k = 0; k < 2; k++) { const st = topo.step(p, fd); p = st.p; fd = st.d; if (cells[p].face !== 0) ok = false; }
          if (!ok) continue;
          const align = dot(cells[c.id].dirs[d], faces[0].u);
          if (align > bestAlign) { bestAlign = align; found = { snake: back, dir: d }; }
        }
      }
      if (!found) throw new Error('no start cell');
      const n = faces[0].n;
      const h = cells[found.snake[0]].dirs[found.dir];
      return { ...found, view: { n: n.slice(), up: tangent(cross(n, h), n) } };
    },
    // geometry
    center: (c) => cells[c].center,
    normal: (c) => faces[cells[c].face].n,
    dirVector: (c, d) => cells[c].dirs[d],
    edgeMid(a, b) {
      const e = cells[a].nbr.findIndex((nb) => nb.cell === b);
      return e >= 0 ? cells[a].mids[e] : mul(add(cells[a].center, cells[b].center), 0.5);
    },
    faceBasis: (f) => faces[f],
    inradius: dot(faces[0].c, faces[0].n),
    faceRadius: pentInradius,
    viewFit: 17.5,
    segScale: 0.85,
    boundRadius: len(verts[0]),
  };
  return topo;
}

export const DODECA = buildDodecahedron();
export const TOPOLOGIES = { cube: CUBE, dodeca: DODECA };

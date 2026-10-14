// Pure game state + rules. No DOM, no Three.js – fully unit-testable.
import {
  N, FACES, add, neg, cross, eq, key, step, normalOf, faceOf, faceDirs,
  allCells, cellToPoint, rotateFaceToFace,
} from './cube.js';

export const BEST_KEY = 'multiverse-snake-best';
export const START_INTERVAL = 165; // ms per tick
export const MIN_INTERVAL = 72;
export const INTERVAL_STEP = 5;
export const GHOST_MS = 6000;
export const GHOST_CRYSTAL_MS = 11000;
export const GHOST_EVERY = 4; // a ghost crystal appears after every 4th energy crystal
export const START_LENGTH = 4;
export const PORTAL_SAFE_RUN = 3; // free cells required in front of a portal exit

/** Screen-relative direction → 3D direction for a camera basis {n, up}. */
export function screenToDir(view, screenDir) {
  const right = cross(view.up, view.n);
  switch (screenDir) {
    case 'up': return view.up.slice();
    case 'down': return neg(view.up);
    case 'right': return right;
    case 'left': return neg(right);
  }
  throw new Error('bad screen dir ' + screenDir);
}

function safeStorage(storage) {
  return {
    get() {
      try { return Number(storage?.getItem(BEST_KEY)) || 0; } catch { return 0; }
    },
    set(v) {
      try { storage?.setItem(BEST_KEY, String(v)); } catch { /* storage unavailable */ }
    },
  };
}

export class Game {
  constructor({ rng = Math.random, storage = null } = {}) {
    this.rng = rng;
    this.store = safeStorage(storage);
    this.best = this.store.get();
    this.reset();
  }

  reset() {
    const f = FACES[0];
    const j = Math.floor(N / 2);
    // Head in the middle of the front face, body trailing to the left, moving right.
    this.snake = [];
    for (let k = 0; k < START_LENGTH; k++) this.snake.push(cellToPoint(f.id, 5 - k, j));
    this.dir = f.u.slice();
    this.view = { n: f.n.slice(), up: f.v.slice() };
    // links[k]: how segment k got to its cell from snake[k+1] (or from `tailFrom` for the last).
    this.links = this.snake.map(() => 'step');
    this.tailFrom = add(this.snake[this.snake.length - 1], neg(add(f.u, f.u)));
    this.turns = [];
    this.grow = 0;
    this.score = 0;
    this.eaten = 0;
    this.interval = START_INTERVAL;
    this.acc = 0;
    this.ghostMs = 0;
    this.ghostCrystal = null;
    this.portals = null;
    this.status = 'ready';
    this.newBest = false;
    this.events = [];
    this.tickCount = 0;
    this.crystal = this.spawnCrystal();
    this.placePortals();
  }

  // ---------- lifecycle ----------
  start() {
    if (this.status === 'over') this.reset();
    if (this.status === 'ready') { this.status = 'running'; this.events.push({ type: 'start' }); }
  }
  restart() { this.reset(); this.start(); }
  pause() { if (this.status === 'running') { this.status = 'paused'; this.events.push({ type: 'pause' }); } }
  resume() { if (this.status === 'paused') { this.status = 'running'; this.events.push({ type: 'resume' }); } }
  togglePause() { this.status === 'paused' ? this.resume() : this.pause(); }

  /** Queue a screen-relative turn: 'up' | 'down' | 'left' | 'right'. */
  queueTurn(screenDir) {
    if (this.status !== 'running') return;
    if (this.turns.length >= 3) return;
    if (this.turns[this.turns.length - 1] === screenDir) return;
    this.turns.push(screenDir);
  }

  get head() { return this.snake[0]; }
  get headFace() { return faceOf(this.head); }
  get ghost() { return this.ghostMs > 0; }
  get progress() { return Math.min(1, this.acc / this.interval); }

  occupied(excludeTail = false) {
    const s = new Set();
    const len = excludeTail ? this.snake.length - 1 : this.snake.length;
    for (let k = 0; k < len; k++) s.add(key(this.snake[k]));
    return s;
  }

  /** Advance real time (ms). Runs as many ticks as are due. */
  update(dt) {
    if (this.status !== 'running') return;
    if (this.ghostMs > 0) {
      this.ghostMs = Math.max(0, this.ghostMs - dt);
      if (this.ghostMs === 0) this.events.push({ type: 'ghostEnd' });
    }
    if (this.ghostCrystal) {
      this.ghostCrystal.ms -= dt;
      if (this.ghostCrystal.ms <= 0) { this.ghostCrystal = null; this.events.push({ type: 'ghostCrystalFade' }); }
    }
    this.acc += dt;
    let guard = 0;
    while (this.acc >= this.interval && this.status === 'running' && guard++ < 5) {
      this.acc -= this.interval;
      this.tick();
    }
    if (guard >= 5) this.acc = 0;
  }

  // ---------- one movement step ----------
  tick() {
    if (this.status !== 'running') return;
    this.tickCount++;

    // Resolve buffered turns against the current camera basis.
    while (this.turns.length) {
      const d = screenToDir(this.view, this.turns.shift());
      if (eq(d, this.dir) || eq(d, neg(this.dir))) continue; // no-op or reversal
      this.dir = d;
      this.events.push({ type: 'turn' });
      break;
    }

    const st = step(this.head, this.dir);
    let next = st.p;
    let dir = st.d;
    let link = 'step';
    let view = this.view;
    if (st.crossed) {
      view = {
        n: st.to.slice(),
        up: rotateFaceToFace(view.up, st.from, st.to, view.up),
      };
      link = 'edge';
    }

    // Portal?
    let portalEvent = null;
    if (this.portals && this.portals.active) {
      const { a, b } = this.portals;
      const target = eq(next, a) ? b : eq(next, b) ? a : null;
      if (target) {
        const exit = this.portalExit(next, target, dir, view);
        if (exit) {
          portalEvent = { type: 'portal', from: next, to: target, fromFace: faceOf(next).id, toFace: faceOf(target).id };
          view = exit.view;
          next = target;
          dir = exit.dir;
          link = 'portal';
        }
      }
    }

    const willEat = this.crystal && eq(next, this.crystal);
    const willGhost = this.ghostCrystal && eq(next, this.ghostCrystal.p);
    const growing = this.grow > 0 || willEat;

    // Self-collision (the tail vacates its cell this tick unless we grow).
    if (!this.ghost) {
      const body = this.occupied(!growing);
      if (body.has(key(next))) {
        this.die(next);
        return;
      }
    }

    this.dir = dir;
    this.view = view;
    if (link === 'portal') this.portals.active = false;
    const oldTail = this.snake[this.snake.length - 1];
    this.snake.unshift(next);
    this.links.unshift(link);
    if (growing) {
      if (this.grow > 0) this.grow--;
      this.tailFrom = oldTail; // tail stays put while growing
      this.links[this.links.length - 1] = 'stay';
    } else {
      this.tailFrom = this.snake.pop();
      this.links.pop();
    }
    if (portalEvent) this.events.push(portalEvent);
    if (link === 'edge') this.events.push({ type: 'edge', toFace: faceOf(next).id });

    if (willEat) {
      this.eaten++;
      this.score += 10;
      this.grow += 1; // +2 total: the eating tick plus one more
      this.interval = Math.max(MIN_INTERVAL, START_INTERVAL - this.eaten * INTERVAL_STEP);
      this.events.push({ type: 'eat', at: next, score: this.score });
      this.crystal = this.spawnCrystal();
      if (this.eaten % GHOST_EVERY === 0 && !this.ghostCrystal && !this.ghost) {
        const p = this.spawnCrystal();
        if (p) { this.ghostCrystal = { p, ms: GHOST_CRYSTAL_MS }; this.events.push({ type: 'ghostCrystal', at: p }); }
      }
    }
    if (willGhost) {
      this.ghostCrystal = null;
      this.ghostMs = GHOST_MS;
      this.score += 25;
      this.events.push({ type: 'ghost', at: next, score: this.score });
    }

    // Recycle used portals once the snake has fully left both cells.
    if (this.portals && !this.portals.active) {
      const occ = this.occupied();
      if (!occ.has(key(this.portals.a)) && !occ.has(key(this.portals.b))) this.placePortals();
    }
  }

  die(at) {
    this.status = 'over';
    this.newBest = this.score > this.best;
    if (this.newBest) { this.best = this.score; this.store.set(this.best); }
    this.events.push({ type: 'death', at });
  }

  // ---------- portals ----------
  /**
   * Work out the exit state when entering portal cell `entry` heading `dir`.
   * Keeps screen-relative heading if the run ahead is clear; otherwise picks the
   * clearest direction. Returns null if every exit would be immediately fatal.
   */
  portalExit(entry, target, dir, curView = this.view) {
    const nIn = normalOf(entry);
    const nOut = normalOf(target);
    // Relative to the current view: rotate the camera basis the way the face rotates.
    const hint = curView.up;
    const view = {
      n: nOut.slice(),
      up: rotateFaceToFace(curView.up, nIn, nOut, hint),
    };
    const preferred = rotateFaceToFace(dir, nIn, nOut, hint);
    const body = this.occupied(true);
    body.add(key(entry)); // nothing should be considered free behind us
    const run = (d) => {
      let p = target;
      let dd = d;
      let k = 0;
      for (; k < PORTAL_SAFE_RUN; k++) {
        const s = step(p, dd);
        if (body.has(key(s.p))) break;
        p = s.p; dd = s.d;
      }
      return k;
    };
    if (body.has(key(target))) return null;
    if (run(preferred) >= PORTAL_SAFE_RUN) return { dir: preferred, view };
    let best = null;
    let bestRun = 0;
    for (const d of faceDirs(target)) {
      const r = run(d);
      if (r > bestRun) { best = d; bestRun = r; }
    }
    return bestRun >= PORTAL_SAFE_RUN ? { dir: best, view } : null;
  }

  surfaceDistances(from, blocked) {
    const dist = new Map([[key(from), 0]]);
    const q = [from];
    for (let qi = 0; qi < q.length; qi++) {
      const p = q[qi];
      const d0 = dist.get(key(p));
      for (const d of faceDirs(p)) {
        const s = step(p, d);
        const k = key(s.p);
        if (dist.has(k) || blocked.has(k)) continue;
        dist.set(k, d0 + 1);
        q.push(s.p);
      }
    }
    return dist;
  }

  placePortals() {
    const occ = this.occupied();
    const dist = this.surfaceDistances(this.head, occ);
    const reserved = new Set(occ);
    if (this.crystal) reserved.add(key(this.crystal));
    if (this.ghostCrystal) reserved.add(key(this.ghostCrystal.p));
    const headFace = this.headFace.id;
    const ok = (p) => {
      const k = key(p);
      if (reserved.has(k)) return false;
      const d = dist.get(k);
      if (d === undefined || d < 5) return false; // reachable, but not right under the head
      // At least one direction must offer a clear run as an exit.
      return faceDirs(p).some((dd) => {
        let q = p; let qd = dd;
        for (let s = 0; s < PORTAL_SAFE_RUN + 1; s++) {
          const r = step(q, qd);
          if (occ.has(key(r.p))) return false;
          q = r.p; qd = r.d;
        }
        return true;
      });
    };
    const candidates = allCells().filter(ok);
    const onHeadFace = candidates.filter((p) => faceOf(p).id === headFace);
    const pick = (list) => list[Math.floor(this.rng() * list.length)];
    const a = pick(onHeadFace.length ? onHeadFace : candidates);
    if (!a) { this.portals = null; return; }
    const fa = faceOf(a).id;
    const others = candidates.filter((p) => faceOf(p).id !== fa);
    const b = pick(others);
    if (!b) { this.portals = null; return; }
    this.portals = { a, b, active: true };
    this.events.push({ type: 'portalsSpawn', a, b });
  }

  // ---------- crystals ----------
  /** A random free cell reachable from the head (body treated as walls). */
  spawnCrystal() {
    const occ = this.occupied();
    const dist = this.surfaceDistances(this.head, occ);
    const reserved = new Set();
    if (this.crystal) reserved.add(key(this.crystal));
    if (this.ghostCrystal) reserved.add(key(this.ghostCrystal.p));
    if (this.portals) { reserved.add(key(this.portals.a)); reserved.add(key(this.portals.b)); }
    const free = [];
    for (const p of allCells()) {
      const k = key(p);
      if (occ.has(k) || reserved.has(k)) continue;
      const d = dist.get(k);
      if (d === undefined || d < 2) continue;
      free.push(p);
    }
    if (!free.length) return null;
    // Favour the face the player is looking at, so the first crystals are easy to find.
    const headFace = this.headFace.id;
    const near = free.filter((p) => faceOf(p).id === headFace);
    const pool = near.length && this.rng() < 0.45 ? near : free;
    return pool[Math.floor(this.rng() * pool.length)];
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}

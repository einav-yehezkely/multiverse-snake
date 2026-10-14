// Pure game state + rules. No DOM, no Three.js – fully unit-testable.
import { CUBE, screenVector } from './topology.js';

export const BEST_KEY = CUBE.bestKey; // cube best score key (kept from v1)
export const START_INTERVAL = 165; // ms per tick
export const MIN_INTERVAL = 72;
export const INTERVAL_STEP = 5;
export const GHOST_MS = 6000;
export const GHOST_CRYSTAL_MS = 11000;
export const GHOST_EVERY = 4; // a ghost crystal appears after every 4th energy crystal
export const START_LENGTH = 4;
export const CRYSTAL_COUNT = 10; // energy crystals kept on the board at once
export const PORTAL_SAFE_RUN = 3; // free cells required in front of a portal exit

/** Screen-relative direction → 3D direction for a camera basis {n, up}. */
export const screenToDir = screenVector;

function safeStorage(storage, bestKey) {
  return {
    get() {
      try { return Number(storage?.getItem(bestKey)) || 0; } catch { return 0; }
    },
    set(v) {
      try { storage?.setItem(bestKey, String(v)); } catch { /* storage unavailable */ }
    },
  };
}

export class Game {
  constructor({ rng = Math.random, storage = null, topology = CUBE } = {}) {
    this.rng = rng;
    this.topo = topology;
    this.store = safeStorage(storage, topology.bestKey);
    this.best = this.store.get();
    this.reset();
  }

  reset() {
    // Head on face 0, body trailing behind, moving screen-right.
    const s0 = this.topo.start();
    this.snake = s0.snake.slice(0, START_LENGTH);
    this.tailFrom = s0.snake[START_LENGTH];
    this.dir = s0.dir;
    this.view = s0.view;
    // links[k]: how segment k got to its cell from snake[k+1] (or from `tailFrom` for the last).
    this.links = this.snake.map(() => 'step');
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
    this.crystals = [];
    this.fillCrystals();
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
  get headFace() { return this.topo.faceOf(this.head); }
  get ghost() { return this.ghostMs > 0; }
  get progress() { return Math.min(1, this.acc / this.interval); }

  occupied(excludeTail = false) {
    const s = new Set();
    const len = excludeTail ? this.snake.length - 1 : this.snake.length;
    for (let k = 0; k < len; k++) s.add(this.topo.key(this.snake[k]));
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
    const T = this.topo;
    while (this.turns.length) {
      const d = T.resolveTurn(this.view, this.turns.shift(), this.head, this.dir);
      if (d === null || T.sameDir(d, this.dir) || T.isReverse(this.head, d, this.dir)) continue; // no-op or reversal
      this.dir = d;
      this.events.push({ type: 'turn' });
      break;
    }

    const st = T.step(this.head, this.dir);
    let next = st.p;
    let dir = st.d;
    let link = 'step';
    let view = this.view;
    if (st.crossed) {
      view = T.crossView(view, st);
      link = 'edge';
    }

    // Portal?
    let portalEvent = null;
    if (this.portals && this.portals.active) {
      const { a, b } = this.portals;
      const target = this.topo.eq(next, a) ? b : this.topo.eq(next, b) ? a : null;
      if (target) {
        const exit = this.portalExit(next, target, dir, view);
        if (exit) {
          portalEvent = { type: 'portal', from: next, to: target, fromFace: this.topo.faceOf(next), toFace: this.topo.faceOf(target) };
          view = exit.view;
          next = target;
          dir = exit.dir;
          link = 'portal';
        }
      }
    }

    const eatIdx = this.crystals.findIndex((c) => this.topo.eq(c, next));
    const willEat = eatIdx !== -1;
    const willGhost = this.ghostCrystal && this.topo.eq(next, this.ghostCrystal.p);
    const growing = this.grow > 0 || willEat;

    // Self-collision (the tail vacates its cell this tick unless we grow).
    if (!this.ghost) {
      const body = this.occupied(!growing);
      if (body.has(this.topo.key(next))) {
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
    if (link === 'edge') this.events.push({ type: 'edge', toFace: this.topo.faceOf(next) });

    if (willEat) {
      this.eaten++;
      this.score += 10;
      this.grow += 1; // +2 total: the eating tick plus one more
      this.interval = Math.max(MIN_INTERVAL, START_INTERVAL - this.eaten * INTERVAL_STEP);
      this.events.push({ type: 'eat', at: next, score: this.score });
      this.crystals.splice(eatIdx, 1);
      this.fillCrystals();
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

    // Top up if an earlier refill ran short of room.
    if (!willEat && this.crystals.length < CRYSTAL_COUNT) this.fillCrystals();

    // Recycle used portals once the snake has fully left both cells.
    if (this.portals && !this.portals.active) {
      const occ = this.occupied();
      if (!occ.has(this.topo.key(this.portals.a)) && !occ.has(this.topo.key(this.portals.b))) this.placePortals();
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
    // Relative to the current view: rotate the camera basis the way the face rotates.
    const { view, dir: preferred } = this.topo.portalTransfer(entry, target, dir, curView);
    const body = this.occupied(true);
    body.add(this.topo.key(entry)); // nothing should be considered free behind us
    const run = (d) => {
      let p = target;
      let dd = d;
      let k = 0;
      for (; k < PORTAL_SAFE_RUN; k++) {
        const s = this.topo.step(p, dd);
        if (body.has(this.topo.key(s.p))) break;
        p = s.p; dd = s.d;
      }
      return k;
    };
    if (body.has(this.topo.key(target))) return null;
    if (run(preferred) >= PORTAL_SAFE_RUN) return { dir: preferred, view };
    let best = null;
    let bestRun = 0;
    for (const d of this.topo.dirs(target)) {
      const r = run(d);
      if (r > bestRun) { best = d; bestRun = r; }
    }
    return bestRun >= PORTAL_SAFE_RUN ? { dir: best, view } : null;
  }

  surfaceDistances(from, blocked) {
    const dist = new Map([[this.topo.key(from), 0]]);
    const q = [from];
    for (let qi = 0; qi < q.length; qi++) {
      const p = q[qi];
      const d0 = dist.get(this.topo.key(p));
      for (const d of this.topo.dirs(p)) {
        const s = this.topo.step(p, d);
        const k = this.topo.key(s.p);
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
    for (const c of this.crystals) reserved.add(this.topo.key(c));
    if (this.ghostCrystal) reserved.add(this.topo.key(this.ghostCrystal.p));
    const headFace = this.headFace;
    const ok = (p) => {
      const k = this.topo.key(p);
      if (reserved.has(k)) return false;
      const d = dist.get(k);
      if (d === undefined || d < 5) return false; // reachable, but not right under the head
      // At least one direction must offer a clear run as an exit.
      return this.topo.dirs(p).some((dd) => {
        let q = p; let qd = dd;
        for (let s = 0; s < PORTAL_SAFE_RUN + 1; s++) {
          const r = this.topo.step(q, qd);
          if (occ.has(this.topo.key(r.p))) return false;
          q = r.p; qd = r.d;
        }
        return true;
      });
    };
    const candidates = this.topo.cells.filter(ok);
    const onHeadFace = candidates.filter((p) => this.topo.faceOf(p) === headFace);
    const pick = (list) => list[Math.floor(this.rng() * list.length)];
    const a = pick(onHeadFace.length ? onHeadFace : candidates);
    if (!a) { this.portals = null; return; }
    const fa = this.topo.faceOf(a);
    const others = candidates.filter((p) => this.topo.faceOf(p) !== fa);
    const b = pick(others);
    if (!b) { this.portals = null; return; }
    this.portals = { a, b, active: true };
    this.events.push({ type: 'portalsSpawn', a, b });
  }

  // ---------- crystals ----------
  /**
   * A random free cell reachable from the head (body treated as walls), never on
   * the snake, a portal or another crystal. Picks from the faces holding the
   * fewest crystals so they stay spread across the cube. Returns null if full.
   */
  spawnCrystal() {
    const occ = this.occupied();
    const dist = this.surfaceDistances(this.head, occ);
    const reserved = new Set(this.crystals.map((c) => this.topo.key(c)));
    if (this.ghostCrystal) reserved.add(this.topo.key(this.ghostCrystal.p));
    if (this.portals) { reserved.add(this.topo.key(this.portals.a)); reserved.add(this.topo.key(this.portals.b)); }
    const perFace = new Array(this.topo.faceCount).fill(0);
    for (const c of this.crystals) perFace[this.topo.faceOf(c)]++;
    const free = [];
    for (const p of this.topo.cells) {
      const k = this.topo.key(p);
      if (occ.has(k) || reserved.has(k)) continue;
      const d = dist.get(k);
      if (d === undefined || d < 2) continue;
      free.push(p);
    }
    if (!free.length) return null;
    const least = Math.min(...free.map((p) => perFace[this.topo.faceOf(p)]));
    const pool = free.filter((p) => perFace[this.topo.faceOf(p)] === least);
    return pool[Math.floor(this.rng() * pool.length)];
  }

  /** Spawn crystals until CRYSTAL_COUNT are on the board or no valid cell is left. */
  fillCrystals() {
    while (this.crystals.length < CRYSTAL_COUNT) {
      const p = this.spawnCrystal();
      if (!p) break;
      this.crystals.push(p);
    }
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}

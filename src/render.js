// Three.js presentation layer. Reads game state; never mutates rules.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { N, FACES, normalOf, cross } from './cube.js';
import { CRYSTAL_COUNT } from './game.js';
import { THEMES, paintFace } from './themes.js';

const H = 0.5; // doubled cube units → world units (cube spans ±N/2)
const LIFT = 0.42; // segment centre height above the face
const MAX_SEG = 6 * N * N;

const v3 = (p) => new THREE.Vector3(p[0], p[1], p[2]);
const smooth = (x) => x * x * (3 - 2 * x);

function glowTexture(inner = 'rgba(255,255,255,1)', mid = 'rgba(255,255,255,0.25)') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.25, mid);
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function swirlTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.translate(128, 128);
  for (let k = 0; k < 6; k++) {
    g.rotate(Math.PI / 3);
    const gr = g.createLinearGradient(0, 0, 120, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.strokeStyle = gr;
    g.lineWidth = 10;
    g.beginPath();
    for (let a = 0; a < 2.4; a += 0.05) {
      const r = a * 50;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Quaternion whose local frame (x=right, y=up, z=toward viewer) matches a view basis. */
function viewQuat(view) {
  const n = v3(view.n), up = v3(view.up), right = v3(cross(view.up, view.n));
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, n));
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.toneMapping = THREE.NoToneMapping;
    this.gl = r;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#03030a');
    this.camera = new THREE.PerspectiveCamera(46, 1, 3, 1500);
    this.qCam = new THREE.Quaternion();
    this.qTarget = new THREE.Quaternion();
    this.look = new THREE.Vector3();
    this.shake = 0;
    this.time = 0;
    this.attract = 1; // 1 = slowly orbiting title view, 0 = gameplay view

    this.buildSpace();
    this.buildCube();
    this.buildSnake();
    this.buildItems();
    this.buildFx();

    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.4, 0.78);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.gl.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Keep the active face comfortably large whatever the aspect ratio.
    const fitH = 19 / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.camDist = 6 + fitH / Math.min(1, this.camera.aspect * 1.02);
  }

  // ---------- scene construction ----------
  buildSpace() {
    const count = 2600;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let k = 0; k < count; k++) {
      const d = new THREE.Vector3().randomDirection().multiplyScalar(250 + Math.random() * 350);
      pos.set([d.x, d.y, d.z], k * 3);
      c.setHSL(0.55 + Math.random() * 0.25, 0.6, 0.55 + Math.random() * 0.35);
      col.set([c.r, c.g, c.b], k * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({
      size: 2.2, sizeAttenuation: true, vertexColors: true, map: glowTexture(), transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8,
    }));
    this.scene.add(this.stars);

    // Soft nebula sprites far away
    const neb = glowTexture('rgba(255,255,255,0.5)', 'rgba(255,255,255,0.12)');
    const hues = ['#5b2bff', '#ff2bd0', '#1fb8ff', '#7a2bff'];
    for (let k = 0; k < 7; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: neb, color: hues[k % hues.length], transparent: true, opacity: 0.14,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      s.position.copy(new THREE.Vector3().randomDirection().multiplyScalar(420));
      s.scale.setScalar(260 + Math.random() * 260);
      this.scene.add(s);
    }

    this.scene.add(new THREE.HemisphereLight('#b9c8ff', '#20102a', 1.4));
    this.camLight = new THREE.DirectionalLight('#ffffff', 1.6);
    this.scene.add(this.camLight);
    this.scene.add(this.camLight.target);
  }

  buildCube() {
    this.cube = new THREE.Group();
    this.scene.add(this.cube);
    this.faceMeshes = [];
    const half = N * H;
    for (const f of FACES) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 768;
      paintFace(cv.getContext('2d'), f.id, 768, N);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const mat = new THREE.MeshStandardMaterial({
        map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.55, roughness: 0.75, metalness: 0.1,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(N, N), mat);
      m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(v3(f.u), v3(f.v), v3(f.n)));
      m.position.copy(v3(f.n).multiplyScalar(half));
      this.cube.add(m);
      this.faceMeshes.push(m);
    }
    // Inner core so nothing shows through seams
    this.cube.add(new THREE.Mesh(new THREE.BoxGeometry(N - 0.6, N - 0.6, N - 0.6), new THREE.MeshBasicMaterial({ color: '#000000' })));
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(N + 0.06, N + 0.06, N + 0.06)),
      new THREE.LineBasicMaterial({ color: '#9fe8ff', transparent: true, opacity: 0.7 }),
    );
    this.cube.add(edges);

    // Ambient particles hovering above each world
    this.ambient = [];
    const dot = glowTexture();
    for (const f of FACES) {
      const th = THEMES[f.id].particles;
      const n = 46;
      const local = [];
      const pos = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) local.push({ x: (Math.random() - 0.5) * N, y: (Math.random() - 0.5) * N, h: Math.random() * 3, ph: Math.random() * 6.28 });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({
        size: th.size * 2.2, map: dot, color: th.color, transparent: true, opacity: 0.85,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      this.cube.add(pts);
      this.ambient.push({ f, th, local, pts, u: v3(f.u), v: v3(f.v), n: v3(f.n) });
    }
  }

  buildSnake() {
    const geo = new THREE.SphereGeometry(1, 20, 14);
    this.bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.1, emissive: '#ffffff', emissiveIntensity: 0.0, transparent: true });
    this.bodyMat.onBeforeCompile = (sh) => {
      // Luminous body: emissive follows the per-instance colour.
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\n totalEmissiveRadiance = vColor * 1.1;\n#endif',
      );
    };
    this.body = new THREE.InstancedMesh(geo, this.bodyMat, MAX_SEG * 2);
    this.body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.body.setColorAt(0, new THREE.Color());
    this.body.frustumCulled = false;
    this.cube.add(this.body);

    this.head = new THREE.Group();
    const headMat = new THREE.MeshStandardMaterial({ color: '#8ffbff', emissive: '#3fe9ff', emissiveIntensity: 0.35, roughness: 0.35 });
    this.headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 28, 20), headMat);
    this.headMesh.scale.set(1, 0.85, 1.12);
    this.head.add(this.headMesh);
    const eyeW = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const eyeB = new THREE.MeshBasicMaterial({ color: '#05040a' });
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), eyeW);
      e.position.set(0.22 * s, 0.24, 0.3);
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 8), eyeB);
      p.position.set(0.24 * s, 0.29, 0.39);
      this.head.add(e, p);
    }
    this.headLight = new THREE.PointLight('#7ff6ff', 3, 4.5, 1.8);
    this.headLight.position.set(0, 0.6, 0);
    this.head.add(this.headLight);
    this.cube.add(this.head);
    this.headPos = new THREE.Vector3();
  }

  buildItems() {
    const halo = glowTexture();
    const mkCrystal = (color, emissive) => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.36, 0), new THREE.MeshStandardMaterial({
        color, emissive, emissiveIntensity: 2.2, roughness: 0.1, metalness: 0.3, flatShading: true,
      }));
      m.scale.set(1, 1.5, 1);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, color: emissive, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.scale.setScalar(2.3);
      g.add(m, s);
      g.userData.gem = m;
      g.userData.halo = s;
      g.visible = false;
      this.cube.add(g);
      return g;
    };
    this.crystalPool = Array.from({ length: CRYSTAL_COUNT }, () => mkCrystal('#7affd8', '#2dffc4'));
    this.ghostGem = mkCrystal('#f2e8ff', '#c08bff');
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.04, 8, 40), new THREE.MeshBasicMaterial({ color: '#d9b8ff' }));
    this.ghostGem.add(ring);
    this.ghostGem.userData.ring = ring;

    const swirl = swirlTexture();
    const fc = document.createElement('canvas');
    fc.width = 4; fc.height = 128;
    const fg = fc.getContext('2d');
    const grd = fg.createLinearGradient(0, 0, 0, 128);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(1, 'rgba(255,255,255,0.8)');
    fg.fillStyle = grd; fg.fillRect(0, 0, 4, 128);
    const fade = new THREE.CanvasTexture(fc);
    const mkPortal = (color) => {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.08, 10, 48), new THREE.MeshBasicMaterial({ color }));
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.44, 40), new THREE.MeshBasicMaterial({
        map: swirl, color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      disc.position.z = 0.01;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.45, 2.2, 24, 1, true), new THREE.MeshBasicMaterial({
        map: fade, color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      beam.rotation.x = Math.PI / 2;
      beam.position.z = 1.1;
      g.add(ring, disc, beam);
      g.userData = { ring, disc, beam };
      g.visible = false;
      this.cube.add(g);
      return g;
    };
    this.portalA = mkPortal('#ff8a1f');
    this.portalB = mkPortal('#2fa8ff');
  }

  buildFx() {
    const max = 900;
    this.fx = { max, n: 0, items: [] };
    const g = new THREE.BufferGeometry();
    this.fxPos = new Float32Array(max * 3);
    this.fxCol = new Float32Array(max * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.fxPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.fxCol, 3));
    this.fxPoints = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.38, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.fxPoints.frustumCulled = false;
    this.cube.add(this.fxPoints);
    this.rings = [];
  }

  // ---------- helpers ----------
  /** World position of a cell centre lifted above its face. */
  cellWorld(p, lift = LIFT) {
    const n = normalOf(p);
    return new THREE.Vector3(p[0] * H + n[0] * lift, p[1] * H + n[1] * lift, p[2] * H + n[2] * lift);
  }

  orientOnFace(obj, p, lift) {
    const n = normalOf(p);
    obj.position.copy(this.cellWorld(p, lift));
    const f = FACES.find((x) => x.n[0] === n[0] && x.n[1] === n[1] && x.n[2] === n[2]);
    obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(v3(f.u), v3(f.v), v3(f.n)));
  }

  /** Point along the move from cell a to cell b (param s∈[0,1]); returns {pos, nrm, scale}. */
  linkPoint(a, b, link, s, out) {
    const nb = normalOf(b);
    if (link === 'stay' || s >= 1) {
      out.pos.copy(this.cellWorld(b)); out.nrm.set(nb[0], nb[1], nb[2]); out.scale = 1; return out;
    }
    if (link === 'portal') {
      out.pos.copy(this.cellWorld(b)); out.nrm.set(nb[0], nb[1], nb[2]); out.scale = smooth(Math.min(1, s * 1.6)); return out;
    }
    const na = normalOf(a);
    const A = this.cellWorld(a);
    const B = this.cellWorld(b);
    out.scale = 1;
    if (link === 'edge') {
      // Pivot over the cube edge: a → edge corner → b.
      const E = new THREE.Vector3(
        (a[0] + nb[0]) * H + (na[0] + nb[0]) * LIFT,
        (a[1] + nb[1]) * H + (na[1] + nb[1]) * LIFT,
        (a[2] + nb[2]) * H + (na[2] + nb[2]) * LIFT,
      );
      if (s < 0.5) { out.pos.lerpVectors(A, E, s * 2); out.nrm.set(na[0], na[1], na[2]); }
      else { out.pos.lerpVectors(E, B, s * 2 - 1); out.nrm.set(nb[0], nb[1], nb[2]); }
      return out;
    }
    out.pos.lerpVectors(A, B, s);
    out.nrm.set(nb[0], nb[1], nb[2]);
    return out;
  }

  /** Position on the snake trail: segment k at param s∈[-1,1] (negative = into the next link). */
  trail(game, k, s, out) {
    const sn = game.snake;
    while (s < 0 && k + 1 < sn.length) { k++; s += 1; }
    if (s < 0) s = 0;
    const from = k + 1 < sn.length ? sn[k + 1] : game.tailFrom;
    return this.linkPoint(from, sn[k], game.links[k], s, out);
  }

  // ---------- effects ----------
  burst(p, color, count = 40, speed = 4, life = 0.8) {
    const at = this.cellWorld(p);
    const n = v3(normalOf(p));
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const d = new THREE.Vector3().randomDirection().addScaledVector(n, 0.9).normalize().multiplyScalar(speed * (0.3 + Math.random()));
      if (this.fx.items.length >= this.fx.max) this.fx.items.shift();
      this.fx.items.push({ p: at.clone(), v: d, life, max: life, c });
    }
  }

  ring(p, color, maxScale = 3.2) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.55, 48), new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.orientOnFace(m, p, 0.06);
    this.cube.add(m);
    this.rings.push({ m, t: 0, maxScale });
  }

  handleEvent(e, game) {
    switch (e.type) {
      case 'eat': this.burst(e.at, '#4dffd2', 46, 4.5); this.ring(e.at, '#4dffd2', 2.5); break;
      case 'ghost': this.burst(e.at, '#d8b8ff', 60, 5); this.ring(e.at, '#c08bff', 4); break;
      case 'portal':
        this.burst(e.from, '#ff9a3d', 50, 4); this.burst(e.to, '#4dc0ff', 50, 4);
        this.ring(e.from, '#ff8a1f', 4); this.ring(e.to, '#2fa8ff', 4);
        break;
      case 'portalsSpawn': this.ring(e.a, '#ff8a1f', 2); this.ring(e.b, '#2fa8ff', 2); break;
      case 'death':
        this.shake = 0.6;
        for (const p of game.snake) this.burst(p, '#ff3d6a', 6, 3, 1.1);
        this.burst(game.head, '#ffffff', 60, 6, 1.2);
        break;
    }
  }

  // ---------- per-frame ----------
  render(game, dt) {
    this.time += dt;
    const t = this.time;
    const over = game.status === 'over';
    const prog = game.status === 'running' ? game.progress : over ? 1 : game.progress;

    // Camera
    this.qTarget.copy(viewQuat(game.view));
    const wantAttract = game.status === 'ready' ? 1 : 0;
    this.attract += (wantAttract - this.attract) * (1 - Math.exp(-dt * 2.5));
    this.qCam.slerp(this.qTarget, 1 - Math.exp(-dt * 5.5));
    const q = this.qCam.clone();
    if (this.attract > 0.001) {
      const spin = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.45 * this.attract, t * 0.25 * this.attract, 0.15 * this.attract));
      q.premultiply(spin);
    }
    // Look slightly ahead toward the head so the next face is visible near edges.
    const headLocal = this.headPos.clone().applyQuaternion(this.qCam.clone().invert());
    const ahead = new THREE.Vector3(
      THREE.MathUtils.clamp(headLocal.x, -6, 6), THREE.MathUtils.clamp(headLocal.y, -6, 6), 0,
    ).multiplyScalar(1 - this.attract);
    this.look.lerp(ahead, 1 - Math.exp(-dt * 2.2));
    const dist = this.camDist * (1 + this.attract * 0.35);
    const camLocal = new THREE.Vector3(1.4 + this.look.x * 1.7, -2.2 + this.look.y * 1.7, dist);
    this.camera.position.copy(camLocal.applyQuaternion(q));
    this.camera.up.set(0, 1, 0).applyQuaternion(q);
    const lookW = this.look.clone().multiplyScalar(0.3).applyQuaternion(q);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      const a = this.shake * 0.7;
      this.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a));
    }
    this.camera.lookAt(lookW);
    this.camLight.position.copy(this.camera.position);

    // Snake body
    const tmp = { pos: new THREE.Vector3(), nrm: new THREE.Vector3(), scale: 1 };
    const mtx = new THREE.Matrix4();
    const qI = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const col = new THREE.Color();
    const len = game.snake.length;
    const ghost = game.ghost;
    const ghostLeft = game.ghostMs / 1000;
    let idx = 0;
    const cHead = new THREE.Color('#00f0ff');
    const cTail = new THREE.Color('#c400ff');
    const cDead = new THREE.Color('#ff2b4a');
    for (let k = 0; k < len; k++) {
      const f = len > 1 ? k / (len - 1) : 0;
      const radius = 0.4 - f * 0.12;
      col.copy(cHead).lerp(cTail, f);
      if (ghost) col.lerp(new THREE.Color('#e6dcff'), 0.55 + 0.25 * Math.sin(t * 12 + k * 0.5));
      if (over) col.lerp(cDead, 0.75);
      const pulse = 1 + 0.06 * Math.sin(t * 8 - k * 0.6);
      if (k > 0) {
        this.trail(game, k, prog, tmp);
        sc.setScalar(radius * pulse * tmp.scale);
        mtx.compose(tmp.pos, qI, sc);
        this.body.setMatrixAt(idx, mtx); this.body.setColorAt(idx, col); idx++;
      }
      // Connector halfway back toward the next segment for a continuous tube.
      if (k + 1 < len) {
        const back = prog - 0.5;
        const viaPortal = back >= 0 ? game.links[k] === 'portal' : game.links[k + 1] === 'portal';
        this.trail(game, k, back, tmp);
        sc.setScalar(viaPortal ? 0 : radius * 0.88 * pulse);
        mtx.compose(tmp.pos, qI, sc);
        this.body.setMatrixAt(idx, mtx); this.body.setColorAt(idx, col); idx++;
      }
    }
    this.body.count = idx;
    this.body.instanceMatrix.needsUpdate = true;
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
    this.bodyMat.opacity = ghost ? (ghostLeft < 1.5 ? 0.35 + 0.35 * (Math.sin(t * 30) > 0 ? 1 : 0) : 0.5) : 1;
    this.bodyMat.depthWrite = !ghost;

    // Head
    this.trail(game, 0, prog, tmp);
    this.headPos.copy(tmp.pos);
    this.head.position.copy(tmp.pos);
    this.head.scale.setScalar(tmp.scale * (over ? 0.9 : 1));
    const ahead2 = { pos: new THREE.Vector3(), nrm: new THREE.Vector3(), scale: 1 };
    this.trail(game, 0, Math.min(1, prog + 0.08), ahead2);
    let fwd = ahead2.pos.clone().sub(tmp.pos);
    if (fwd.lengthSq() < 1e-6) fwd = v3(game.dir);
    this.head.up.copy(tmp.nrm);
    this.head.lookAt(this.head.position.clone().add(fwd));
    this.headMesh.material.emissive.set(over ? '#ff2b4a' : ghost ? '#b89cff' : '#3fe9ff');
    this.headLight.color.set(over ? '#ff2b4a' : ghost ? '#c08bff' : '#7ff6ff');

    // Crystal
    const bob = (g, p, lift, ph = 0) => {
      this.orientOnFace(g, p, lift + Math.sin(t * 3 + ph) * 0.08);
      g.userData.gem.rotation.set(Math.PI / 2, t * 2 + ph, 0);
    };
    this.crystalPool.forEach((g, k) => {
      const p = game.crystals[k];
      g.visible = !!p;
      if (!p) return;
      bob(g, p, 0.55, k * 1.7);
      g.userData.halo.material.opacity = 0.65 + 0.25 * Math.sin(t * 5 + k * 1.7);
    });
    if (game.ghostCrystal) {
      this.ghostGem.visible = true;
      bob(this.ghostGem, game.ghostCrystal.p, 0.6);
      this.ghostGem.userData.ring.rotation.set(t * 2, t * 1.3, 0);
      const fading = game.ghostCrystal.ms < 3000;
      this.ghostGem.userData.halo.material.opacity = fading ? (Math.sin(t * 20) > 0 ? 0.9 : 0.2) : 0.85;
    } else this.ghostGem.visible = false;

    // Portals
    const pr = game.portals;
    for (const [g, p] of [[this.portalA, pr?.a], [this.portalB, pr?.b]]) {
      if (!p) { g.visible = false; continue; }
      g.visible = true;
      this.orientOnFace(g, p, 0.04);
      const active = pr.active;
      g.userData.disc.rotation.z = -t * (active ? 4 : 0.8);
      const s = active ? 1 + 0.06 * Math.sin(t * 6) : 0.65;
      g.userData.ring.scale.setScalar(s);
      g.userData.disc.scale.setScalar(s);
      g.userData.disc.material.opacity = active ? 0.95 : 0.25;
      g.userData.beam.material.opacity = active ? 0.45 + 0.15 * Math.sin(t * 4) : 0.06;
      g.userData.ring.material.opacity = active ? 1 : 0.4;
      g.userData.ring.material.transparent = true;
    }

    // Ambient particles
    for (const a of this.ambient) {
      const arr = a.pts.geometry.attributes.position.array;
      const half = N * H;
      a.local.forEach((p, k) => {
        p.h += a.th.rise * dt;
        p.x += Math.sin(t * 0.7 + p.ph) * a.th.drift * dt;
        p.y += Math.cos(t * 0.5 + p.ph * 1.3) * a.th.drift * dt;
        if (p.h > 3.2) p.h = 0;
        if (p.h < 0) p.h = 3.2;
        if (p.x > half) p.x -= N; if (p.x < -half) p.x += N;
        if (p.y > half) p.y -= N; if (p.y < -half) p.y += N;
        const w = a.n.clone().multiplyScalar(half + 0.1 + p.h).addScaledVector(a.u, p.x).addScaledVector(a.v, p.y);
        arr[k * 3] = w.x; arr[k * 3 + 1] = w.y; arr[k * 3 + 2] = w.z;
      });
      a.pts.geometry.attributes.position.needsUpdate = true;
      a.pts.material.opacity = 0.55 + 0.3 * Math.sin(t * 2 + a.f.id);
    }

    // FX particles
    const items = this.fx.items;
    for (let k = items.length - 1; k >= 0; k--) {
      const it = items[k];
      it.life -= dt;
      if (it.life <= 0) { items.splice(k, 1); continue; }
      it.v.multiplyScalar(Math.exp(-dt * 2.2));
      it.p.addScaledVector(it.v, dt);
    }
    for (let k = 0; k < this.fx.max; k++) {
      const it = items[k];
      if (it) {
        this.fxPos.set([it.p.x, it.p.y, it.p.z], k * 3);
        const f = it.life / it.max;
        this.fxCol.set([it.c.r * f, it.c.g * f, it.c.b * f], k * 3);
      } else { this.fxCol.set([0, 0, 0], k * 3); }
    }
    this.fxPoints.geometry.setDrawRange(0, items.length);
    this.fxPoints.geometry.attributes.position.needsUpdate = true;
    this.fxPoints.geometry.attributes.color.needsUpdate = true;
    for (let k = this.rings.length - 1; k >= 0; k--) {
      const r = this.rings[k];
      r.t += dt / 0.7;
      if (r.t >= 1) { this.cube.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); this.rings.splice(k, 1); continue; }
      r.m.scale.setScalar(1 + r.t * r.maxScale);
      r.m.material.opacity = 1 - r.t;
    }

    this.stars.rotation.y = t * 0.004;
    this.composer.render();
  }
}

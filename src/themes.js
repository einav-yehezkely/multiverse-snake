// Visual + musical identity of each world. Indexed by face id (see cube.js).
// Everything is procedural – no external textures.

export const THEMES = [
  { // 0 +Z
    name: 'Neon City', color: '#ff3df0', accent: '#2ef2ff', base: ['#120626', '#1d0b3d'],
    particles: { color: '#ff5cf4', rise: 0.25, drift: 0.05, size: 0.16 },
    music: { root: 57, scale: [0, 2, 3, 5, 7, 8, 10], prog: [0, 5, 2, 6], wave: 'sawtooth' }, // A minor
  },
  { // 1 +X
    name: 'Emerald Jungle', color: '#4dff7a', accent: '#d8ff4d', base: ['#03170b', '#0a2f16'],
    particles: { color: '#d8ff6b', rise: 0.05, drift: 0.35, size: 0.14 },
    music: { root: 50, scale: [0, 2, 3, 5, 7, 9, 10], prog: [0, 3, 0, 6], wave: 'triangle' }, // D dorian
  },
  { // 2 -Z
    name: 'Void Nebula', color: '#a879ff', accent: '#5c7cff', base: ['#030208', '#0d0820'],
    particles: { color: '#b89cff', rise: 0.02, drift: 0.18, size: 0.12 },
    music: { root: 51, scale: [0, 2, 3, 5, 7, 8, 11], prog: [0, 5, 3, 4], wave: 'sine' }, // Eb harmonic minor
  },
  { // 3 -X
    name: 'Molten Core', color: '#ff6a1a', accent: '#ffd23d', base: ['#1a0402', '#2e0903'],
    particles: { color: '#ffae3d', rise: 0.9, drift: 0.12, size: 0.15 },
    music: { root: 52, scale: [0, 1, 3, 5, 7, 8, 10], prog: [0, 1, 0, 6], wave: 'sawtooth' }, // E phrygian
  },
  { // 4 +Y
    name: 'Frost Peak', color: '#7fe8ff', accent: '#ffffff', base: ['#06243a', '#0d3d5c'],
    particles: { color: '#e6fbff', rise: -0.35, drift: 0.2, size: 0.13 },
    music: { root: 54, scale: [0, 2, 3, 5, 7, 9, 10], prog: [0, 4, 5, 3], wave: 'square' }, // F# minor
  },
  { // 5 -Y
    name: 'Dune Sea', color: '#ffc861', accent: '#ff8a3d', base: ['#2a1606', '#47270b'],
    particles: { color: '#ffd89a', rise: 0.04, drift: 0.6, size: 0.1 },
    music: { root: 50, scale: [0, 1, 4, 5, 7, 8, 10], prog: [0, 1, 6, 0], wave: 'triangle' }, // D hijaz
  },
];

function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw a face texture onto a canvas. `cells` is the grid size. */
export function paintFace(ctx, id, size, cells) {
  const t = THEMES[id];
  const r = mulberry(1000 + id * 77);
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, t.base[0]);
  g.addColorStop(1, t.base[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  ctx.save();
  switch (id) {
    case 0: { // Neon city – rooftops, lit windows, neon streets
      for (let k = 0; k < 60; k++) {
        const w = 20 + r() * 70, h = 20 + r() * 70, x = r() * size, y = r() * size;
        ctx.fillStyle = `rgba(${40 + r() * 40},${15 + r() * 20},${80 + r() * 60},0.85)`;
        ctx.fillRect(x, y, w, h);
        for (let q = 0; q < 6; q++) {
          ctx.fillStyle = r() < 0.5 ? 'rgba(255,90,240,0.55)' : 'rgba(70,240,255,0.5)';
          ctx.fillRect(x + r() * w, y + r() * h, 3, 3);
        }
      }
      ctx.lineWidth = 3;
      for (let k = 0; k < 7; k++) {
        ctx.strokeStyle = k % 2 ? 'rgba(46,242,255,0.35)' : 'rgba(255,61,240,0.35)';
        ctx.beginPath();
        const p = r() * size;
        if (k % 2) { ctx.moveTo(p, 0); ctx.lineTo(p, size); } else { ctx.moveTo(0, p); ctx.lineTo(size, p); }
        ctx.stroke();
      }
      break;
    }
    case 1: { // Jungle – layered leaves and vines
      for (let k = 0; k < 140; k++) {
        ctx.save();
        ctx.translate(r() * size, r() * size);
        ctx.rotate(r() * Math.PI * 2);
        const l = 14 + r() * 40;
        ctx.fillStyle = `rgba(${20 + r() * 50},${90 + r() * 110},${30 + r() * 40},${0.35 + r() * 0.4})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, l, l * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,30,10,0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-l, 0); ctx.lineTo(l, 0); ctx.stroke();
        ctx.restore();
      }
      ctx.strokeStyle = 'rgba(120,255,140,0.25)';
      ctx.lineWidth = 3;
      for (let k = 0; k < 8; k++) {
        ctx.beginPath();
        let x = r() * size, y = 0;
        ctx.moveTo(x, y);
        while (y < size) { y += 30; x += (r() - 0.5) * 50; ctx.quadraticCurveTo(x + 20, y - 15, x, y); }
        ctx.stroke();
      }
      break;
    }
    case 2: { // Void – nebula clouds, a spiral and stars
      for (let k = 0; k < 7; k++) {
        const x = r() * size, y = r() * size, rad = 80 + r() * 160;
        const ng = ctx.createRadialGradient(x, y, 0, x, y, rad);
        ng.addColorStop(0, k % 2 ? 'rgba(120,70,255,0.28)' : 'rgba(60,110,255,0.22)');
        ng.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = ng;
        ctx.fillRect(0, 0, size, size);
      }
      ctx.strokeStyle = 'rgba(170,130,255,0.25)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let a = 0; a < 26; a += 0.05) {
        const rr = a * 9;
        const x = size / 2 + Math.cos(a) * rr, y = size / 2 + Math.sin(a) * rr;
        a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      for (let k = 0; k < 260; k++) {
        ctx.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.7})`;
        const s = r() < 0.9 ? 1.2 : 2.6;
        ctx.fillRect(r() * size, r() * size, s, s);
      }
      break;
    }
    case 3: { // Lava – dark crust with glowing cracks
      for (let k = 0; k < 40; k++) {
        ctx.fillStyle = `rgba(${10 + r() * 30},${r() * 8},0,0.6)`;
        ctx.beginPath();
        ctx.arc(r() * size, r() * size, 20 + r() * 50, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let k = 0; k < 26; k++) {
        let x = r() * size, y = r() * size, a = r() * Math.PI * 2;
        const w = 1.5 + r() * 4;
        ctx.strokeStyle = `rgba(255,${80 + r() * 100},20,0.8)`;
        ctx.shadowColor = '#ff5a00';
        ctx.shadowBlur = 12;
        ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(x, y);
        for (let s = 0; s < 12; s++) { a += (r() - 0.5) * 1.2; x += Math.cos(a) * 18; y += Math.sin(a) * 18; ctx.lineTo(x, y); }
        ctx.stroke();
      }
      break;
    }
    case 4: { // Ice – crystalline facets and frost cracks
      for (let k = 0; k < 90; k++) {
        ctx.fillStyle = `rgba(${150 + r() * 100},${220 + r() * 35},255,${0.05 + r() * 0.12})`;
        ctx.beginPath();
        const x = r() * size, y = r() * size;
        ctx.moveTo(x, y);
        ctx.lineTo(x + (r() - 0.5) * 120, y + (r() - 0.5) * 120);
        ctx.lineTo(x + (r() - 0.5) * 120, y + (r() - 0.5) * 120);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(230,250,255,0.45)';
      ctx.lineWidth = 1.2;
      for (let k = 0; k < 22; k++) {
        let x = r() * size, y = r() * size;
        ctx.beginPath(); ctx.moveTo(x, y);
        for (let s = 0; s < 5; s++) { x += (r() - 0.5) * 70; y += (r() - 0.5) * 70; ctx.lineTo(x, y); }
        ctx.stroke();
      }
      break;
    }
    case 5: { // Desert – dune ridges
      for (let k = 0; k < 22; k++) {
        const y0 = (k / 22) * size * 1.1;
        ctx.strokeStyle = `rgba(255,${190 + r() * 40},${110 + r() * 40},${0.12 + r() * 0.15})`;
        ctx.lineWidth = 2 + r() * 6;
        ctx.beginPath();
        for (let x = -10; x <= size + 10; x += 8) {
          const y = y0 + Math.sin(x / (40 + k * 3) + k) * 14 + Math.sin(x / 13 + k * 2) * 3;
          x === -10 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      for (let k = 0; k < 500; k++) {
        ctx.fillStyle = `rgba(255,220,160,${r() * 0.15})`;
        ctx.fillRect(r() * size, r() * size, 2, 2);
      }
      break;
    }
  }
  ctx.restore();

  // Grid
  const c = size / cells;
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let k = 1; k < cells; k++) {
    ctx.moveTo(k * c, 0); ctx.lineTo(k * c, size);
    ctx.moveTo(0, k * c); ctx.lineTo(size, k * c);
  }
  ctx.stroke();
  // Cell inset dots for readability
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    ctx.fillRect(i * c + c / 2 - 1.5, j * c + c / 2 - 1.5, 3, 3);
  }
  // Glowing border in the world colour
  ctx.strokeStyle = t.color;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, size - 6, size - 6);
  ctx.globalAlpha = 1;
}

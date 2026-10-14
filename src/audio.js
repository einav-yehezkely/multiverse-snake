// Procedural synthwave soundtrack + SFX via Web Audio. Started only after a user gesture.
import { THEMES } from './themes.js';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const MUTE_KEY = 'multiverse-snake-muted';

export class Audio {
  constructor() {
    this.ctx = null;
    this.world = 0;
    this.nextWorld = 0;
    this.intensity = 0;
    this.playing = false;
    try { this.muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { this.muted = false; }
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window['webkitAudioContext'];
      if (!AC) return;
      const c = new AC();
      this.ctx = c;
      this.master = c.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 4;
      this.master.connect(comp).connect(c.destination);
      this.musicBus = c.createGain(); this.musicBus.gain.value = 0.5; this.musicBus.connect(this.master);
      this.sfxBus = c.createGain(); this.sfxBus.gain.value = 0.75; this.sfxBus.connect(this.master);
      // Echo for arps
      this.delay = c.createDelay(1); this.delay.delayTime.value = 0.32;
      const fb = c.createGain(); fb.gain.value = 0.32;
      const dl = c.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2400;
      this.delay.connect(dl).connect(fb).connect(this.delay);
      dl.connect(this.musicBus);
      const len = c.sampleRate * 1;
      this.noise = c.createBuffer(1, len, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let k = 0; k < len; k++) d[k] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* ignore */ }
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  setWorld(id) { this.nextWorld = id; }

  startMusic() {
    if (!this.ctx || this.playing) return;
    this.playing = true;
    this.bpm = 112;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stopMusic() {
    this.playing = false;
    clearInterval(this.timer);
  }

  setMusicLevel(v) { // 0..1 duck for pause/game-over
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(0.5 * v, this.ctx.currentTime, 0.15);
  }

  schedule() {
    const c = this.ctx;
    const sixteenth = 60 / this.bpm / 4;
    while (this.nextTime < c.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime, sixteenth);
      this.nextTime += sixteenth;
      this.step++;
    }
  }

  playStep(s, t, dur) {
    if (s % 64 === 0) this.world = this.nextWorld; // change key on phrase boundaries
    const th = THEMES[this.world].music;
    const bar = Math.floor(s / 16) % 4;
    const deg = th.prog[bar];
    const sc = th.scale;
    const note = (d, oct = 0) => th.root + sc[((d % 7) + 7) % 7] + 12 * (Math.floor(d / 7) + oct);
    const i16 = s % 16;
    // Kick on beats, snare on 2 & 4, hats on offbeats
    if (i16 % 4 === 0) this.kick(t);
    if (i16 === 4 || i16 === 12) this.snare(t);
    if (i16 % 2 === 1 || (this.intensity > 0.4 && i16 % 4 === 2)) this.hat(t, i16 % 4 === 2 ? 0.05 : 0.08);
    // Bass: driving 8ths on the root
    if (i16 % 2 === 0) this.tone(mtof(note(deg, -2)), t, dur * 1.8, 'sawtooth', 0.16, 420 + this.intensity * 600, this.musicBus);
    // Arp: chord tones
    const arp = [0, 2, 4, 7, 4, 2, 4, 9];
    const a = note(deg + arp[i16 % 8], i16 >= 8 ? 1 : 0);
    this.tone(mtof(a), t, dur * 0.9, th.wave, th.wave === 'sine' ? 0.12 : 0.06, 2600, this.delay, this.musicBus);
    // Pad on each bar
    if (i16 === 0) for (const d of [0, 2, 4]) this.tone(mtof(note(deg + d, -1)), t, dur * 15, 'sawtooth', 0.03, 900, this.musicBus, null, 0.3);
  }

  tone(freq, t, dur, type, vol, cutoff, dest, dest2 = null, attack = 0.005) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type; o.frequency.value = freq;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 3;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(dest);
    if (dest2) g.connect(dest2);
    o.start(t); o.stop(t + dur + 0.05);
  }

  kick(t) {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(g).connect(this.musicBus);
    o.start(t); o.stop(t + 0.3);
  }

  noiseHit(t, dur, vol, type, freq, dest) {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
    return f;
  }

  snare(t) { this.noiseHit(t, 0.16, 0.18, 'bandpass', 1800, this.musicBus); }
  hat(t, v) { this.noiseHit(t, 0.04, v, 'highpass', 7000, this.musicBus); }

  // ---------- SFX ----------
  sfx(name) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + 0.005;
    const b = this.sfxBus;
    switch (name) {
      case 'eat':
        this.tone(880, t, 0.12, 'triangle', 0.25, 6000, b);
        this.tone(1320, t + 0.06, 0.18, 'triangle', 0.22, 6000, b);
        this.tone(1760, t + 0.12, 0.25, 'sine', 0.16, 6000, b);
        break;
      case 'ghost':
        for (let k = 0; k < 6; k++) this.tone(660 * Math.pow(1.26, k), t + k * 0.04, 0.5, 'sine', 0.12, 8000, b, this.delay);
        break;
      case 'ghostEnd':
        this.tone(520, t, 0.15, 'square', 0.06, 2000, b);
        this.tone(390, t + 0.12, 0.2, 'square', 0.06, 2000, b);
        break;
      case 'portal': {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(220, t);
        o.frequency.exponentialRampToValueAtTime(1800, t + 0.35);
        g.gain.setValueAtTime(0.3, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        o.connect(g).connect(b); o.connect(g).connect(this.delay);
        o.start(t); o.stop(t + 0.55);
        const f = this.noiseHit(t, 0.5, 0.25, 'bandpass', 600, b);
        f.frequency.exponentialRampToValueAtTime(5000, t + 0.45);
        break;
      }
      case 'edge': {
        const f = this.noiseHit(t, 0.28, 0.12, 'bandpass', 300, b);
        f.frequency.exponentialRampToValueAtTime(1400, t + 0.25);
        break;
      }
      case 'turn': this.tone(1200, t, 0.03, 'square', 0.025, 3000, b); break;
      case 'start':
        [0, 4, 7, 12].forEach((s, k) => this.tone(mtof(69 + s), t + k * 0.07, 0.3, 'sawtooth', 0.12, 3000, b, this.delay));
        break;
      case 'death': {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(440, t);
        o.frequency.exponentialRampToValueAtTime(40, t + 0.9);
        g.gain.setValueAtTime(0.3, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1);
        o.connect(g).connect(b);
        o.start(t); o.stop(t + 1.05);
        this.noiseHit(t, 0.7, 0.4, 'lowpass', 900, b);
        break;
      }
    }
  }
}

// Auto quality scaler: measures frame time over a window and steps pixel ratio / shadow map / shadow on-off / mover count.
// `?quality=low|medium|high` pins a level and disables the auto scaler.
import { CFG, LIFE } from './config.js';

const NAMES = ['low', 'medium', 'high'];

/**
 * Ground-texture / starting quality tier (0 low, 1 medium, 2 high) chosen BEFORE the world is built:
 * `?quality=` pins it; otherwise phones (coarse pointer + small screen) and <= 2 GB devices get low, tablets / <= 4 GB / <= 4 cores medium.
 */
export function groundTier() {
  try {
    const q = new URLSearchParams(location.search).get('quality');
    if (NAMES.includes(q)) return NAMES.indexOf(q);
    const mem = navigator.deviceMemory || 0, cores = navigator.hardwareConcurrency || 8;
    const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    const small = Math.min(screen.width, screen.height) <= 820;
    if ((coarse && small) || (mem && mem <= 2)) return 0;
    if (coarse || (mem && mem <= 4) || cores <= 4) return 1;
  } catch (e) { /* default */ }
  return 2;
}

export class Quality {
  constructor({ renderer, light, world, canvas }) {
    this.renderer = renderer; this.light = light; this.world = world; this.canvas = canvas;
    const q = new URLSearchParams(location.search).get('quality');
    this.auto = !NAMES.includes(q);
    this.level = this.auto ? groundTier() : NAMES.indexOf(q);
    this.frames = 0; this.sum = 0; this.hiccup = 0;
    this.upLock = 0; this.lastUp = -999; this.goodWindows = 0; this.badWindows = 0;
    this.t = 0;
    this.history = [];
    this.avgMs = 0;
    this._last = performance.now();
    this.apply(this.level, true);
    this._raf = (now) => this.frame(now);
    requestAnimationFrame(this._raf);
  }

  get name() { return NAMES[this.level]; }

  apply(level, force = false) {
    level = Math.max(0, Math.min(2, level));
    if (level === this.level && !force) return;
    this.level = level;
    const Q = LIFE.quality;
    const dpr = window.devicePixelRatio || 1;
    const pr = Math.min(dpr, CFG.pixelRatioCap, Q.pixelRatio[level]);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.canvas.clientWidth || window.innerWidth, this.canvas.clientHeight || window.innerHeight, false);
    const sm = Q.shadowMap[level];
    const sun = this.light.sun, s = sun.shadow;
    sun.castShadow = sm > 0;
    if (sm > 0 && s.mapSize.x !== sm) {
      s.mapSize.set(sm, sm);
      if (s.map) { s.map.dispose(); s.map = null; }
      this.light.shadowSize = sm;
    }
    if (sm > 0) this.light.shadowSize = sm;
    this.world.traffic.setFraction(Q.moverFrac[level]);
    if (this.world.setDetail) this.world.setDetail(level);
    for (const m of this.world.treeMeshes || []) m.castShadow = level >= 1; // tree shadows are the costliest shadow casters
    this.history.push({ t: +this.t.toFixed(1), level: NAMES[level] });
    this.sum = 0; this.frames = 0; this.hiccup = 20; // let things settle
  }

  frame(now) {
    const dt = now - this._last;
    this._last = now;
    this.t += dt / 1000;
    requestAnimationFrame(this._raf);
    if (!this.auto || document.hidden) return;
    if (dt > 250) { this.sum = 0; this.frames = 0; return; } // tab switch / stall
    if (this.hiccup > 0) { this.hiccup--; return; }
    this.sum += dt; this.frames++;
    if (this.frames < LIFE.quality.window) return;
    const avg = this.avgMs = this.sum / this.frames;
    this.sum = 0; this.frames = 0;
    const Q = LIFE.quality;
    if (avg > 1000 / Q.downFps) {
      this.badWindows++; this.goodWindows = 0;
      if (this.badWindows >= 2 && this.level > 0) {
        if (this.t - this.lastUp < 20) this.upLock = this.t + 60; // stepping up did not hold
        this.apply(this.level - 1); this.badWindows = 0;
      }
    } else if (avg < 1000 / Q.upFps) {
      this.goodWindows++; this.badWindows = 0;
      if (this.goodWindows >= 4 && this.level < 2 && this.t > this.upLock) {
        this.lastUp = this.t; this.apply(this.level + 1); this.goodWindows = 0;
      }
    } else { this.badWindows = 0; this.goodWindows = 0; }
  }

  info(renderer = this.renderer) {
    const i = renderer.info;
    return { level: this.name, auto: this.auto, avgMs: +this.avgMs.toFixed(1), calls: i.render.calls, triangles: i.render.triangles, history: this.history };
  }
}

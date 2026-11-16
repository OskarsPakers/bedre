// Auto quality scaler: measures frame time over a window and steps pixel ratio / shadow map / shadow on-off / mover count.
// `?quality=low|medium|high` pins a level and disables the auto scaler.
import { CFG, LIFE } from './config.js';
import { isTouchUi } from './mobile.js';

const NAMES = ['low', 'medium', 'high'];

const QKEY = 'bedre.quality';
/** Graphics choice: `?quality=` beats the remembered start-screen choice (localStorage, set by src/ui.js) beats auto (null). */
export function qualityChoice() {
  try { const q = new URLSearchParams(location.search).get('quality'); if (NAMES.includes(q)) return q; } catch { /* ignore */ }
  try { const v = localStorage.getItem(QKEY); if (NAMES.includes(v)) return v; } catch { /* storage blocked */ }
  return null;
}
/** Remember (or with 'auto' forget) the graphics choice made on the start screen. */
export function rememberQuality(v) { try { if (NAMES.includes(v)) localStorage.setItem(QKEY, v); else localStorage.removeItem(QKEY); } catch { /* ignore */ } }

/**
 * Ground-texture / starting quality tier (0 low, 1 medium, 2 high) chosen BEFORE the world is built:
 * `?quality=` pins it; otherwise phones (coarse pointer + small screen) and <= 2 GB devices get low, tablets / <= 4 GB / <= 4 cores medium.
 */
export function groundTier() {
  try {
    const q = qualityChoice();
    if (q) return NAMES.indexOf(q);
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
    const q = qualityChoice();
    this.auto = !q;
    this.level = this.auto ? groundTier() : NAMES.indexOf(q);
    this.rung = (2 - this.level) * 3;                 // 0 = everything high .. 6 = everything low (see RUNG_STEPS)
    this.downFps = isTouchUi() ? 52 : LIFE.quality.downFps;   // phones: step down as soon as ~55 fps is not held
    this.frames = 0; this.sum = 0; this.hiccup = 0;
    this.upLock = 0; this.lastUp = -999; this.goodWindows = 0; this.badWindows = 0;
    this.failedUps = 0; this.minRung = 0; // an up-step that does not hold doubles the wait (60, 120, ... s); the second failure pins the lower level for the session
    this.t = 0;
    this.history = [];
    this.avgMs = 0;
    this._last = performance.now();
    this.apply(this.level, true);
    this._raf = (now) => this.frame(now);
    requestAnimationFrame(this._raf);
  }

  get name() { return NAMES[this.level]; }

  /** Quality level 0..2 (also pins the ladder to that level's rung). */
  apply(level, force = false) {
    level = Math.max(0, Math.min(2, level));
    if (level === this.level && this.rung === (2 - level) * 3 && !force) return;
    this._rung((2 - level) * 3, force);
  }

  /**
   * The auto scaler moves one resource at a time along a 6-step ladder: pixel ratio first, then the shadows, then the mover counts
   * (each from high to medium, then from medium to low). rung 0 = all high, 6 = all low; `level` (ground detail, themes, names) is derived.
   */
  _rung(r, force = false) {
    r = Math.max(0, Math.min(6, r));
    if (r === this.rung && !force) return;
    this.rung = r;
    // resource levels (2 high, 1 medium, 0 low): pixel ratio drops first, then the shadows, then the movers
    const prL = r >= 4 ? 0 : r >= 1 ? 1 : 2, shL = r >= 5 ? 0 : r >= 2 ? 1 : 2, mvL = r >= 6 ? 0 : r >= 3 ? 1 : 2;
    const level = Math.ceil((6 - r) / 3);
    this.level = level;
    const Q = LIFE.quality;
    const dpr = window.devicePixelRatio || 1;
    const pr = Math.min(dpr, CFG.pixelRatioCap, Q.pixelRatio[prL]);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.canvas.clientWidth || window.innerWidth, this.canvas.clientHeight || window.innerHeight, false);
    const sm = Q.shadowMap[shL];
    const sun = this.light.sun, s = sun.shadow;
    sun.castShadow = sm > 0;
    if (sm > 0 && s.mapSize.x !== sm) {
      s.mapSize.set(sm, sm);
      if (s.map) { s.map.dispose(); s.map = null; }
      this.light.shadowSize = sm;
    }
    if (sm > 0) this.light.shadowSize = sm;
    this.world.traffic.setFraction(Q.moverFrac[mvL]);
    if (this.world.setDetail) this.world.setDetail(level);
    for (const m of this.world.treeMeshes || []) m.castShadow = shL >= 1; // tree shadows are the costliest shadow casters
    this.history.push({ t: +this.t.toFixed(1), level: NAMES[level], rung: r });
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
    if (avg > 1000 / this.downFps) {
      this.badWindows++; this.goodWindows = 0;
      if (this.badWindows >= 2 && this.rung < 6) {
        if (this.t - this.lastUp < 20) { // stepping up did not hold: back off exponentially, then give up on that rung (no oscillation)
          this.failedUps++; this.upLock = this.t + 60 * Math.pow(2, this.failedUps - 1);
          if (this.failedUps >= 2) this.minRung = this.rung + 1;
        }
        this._rung(this.rung + 1); this.badWindows = 0;
      }
    } else if (avg < 1000 / Q.upFps) {
      this.goodWindows++; this.badWindows = 0;
      if (this.goodWindows >= 4 && this.rung > this.minRung && this.t > this.upLock) {
        this.lastUp = this.t; this._rung(this.rung - 1); this.goodWindows = 0;
      }
    } else { this.badWindows = 0; this.goodWindows = 0; }
  }

  /** Highest level (0..2) the scaler may climb back to (it is lowered when a step up keeps failing). */
  get ceiling() { return Math.ceil((6 - this.minRung) / 3); }

  info(renderer = this.renderer) {
    const i = renderer.info;
    return { level: this.name, auto: this.auto, ceiling: this.ceiling, failedUps: this.failedUps, avgMs: +this.avgMs.toFixed(1), calls: i.render.calls, triangles: i.render.triangles, history: this.history };
  }
}

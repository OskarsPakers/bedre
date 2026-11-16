// Pointer (mouse -> ground point; touch -> floating thumb joystick or "hole follows the finger") and keyboard input.
//
// Touch: the first finger that lands on the play area OWNS the gesture until it lifts (pointer capture), so steering never presses a HUD
// button and a HUD button never steers. Joystick scheme: a soft base appears under the thumb, the hole steers by the thumb's offset from
// that origin (direction + analogue magnitude, small dead zone, max radius; past the radius the base follows the thumb). Releasing keeps a
// short, decaying bit of momentum. A second finger never steers: it pinches (zoom) with the first one, and while the distance between the
// two changes the steering offset is frozen (the origin travels with the steering finger), so a pinch cannot cause a steering jump.
// Double-tap toggles the wide view.
import * as THREE from 'three';
import { prefs } from './mobile.js';

const DEAD = 7;                       // px: no steering inside this ring
const RADIUS = [84, 64, 48];          // px for full speed per sensitivity step 1..3 (low .. high)
const COAST_S = 0.3;                  // seconds of fading momentum after release
const TAP_MS = 280, TAP_MOVE = 14, DTAP_MS = 340, DTAP_DIST = 56;

export class Input {
  constructor(dom) {
    this.dom = dom;
    this.keys = new Set();
    this.ndc = new THREE.Vector2();
    this.hasPointer = false;
    this.mouseActive = false;
    this.touch = null;                // steering finger: { id, ox, oy, x, y } (origin, current)
    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.hit = new THREE.Vector3();
    this.joyEl = document.getElementById('joystick');
    this.knobEl = document.getElementById('joy-knob');
    this.enabled = false;
    this.onZoom = null;               // (factor) => void; wheel / pinch
    this.onDoubleTap = null;          // () => void
    this.pts = new Map();             // active touch pointers: id -> { x, y, sx, sy, t, moved }
    this.pinchD = 0;
    this.coast = null;                // { x, z, t0 } fading momentum after release
    this.lastTap = null;              // { t, x, y }
    this.stats = { zooms: 0, taps: 0, doubleTaps: 0 };

    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) {
        this.keys.add(k); this.mouseActive = false;
        if (this.enabled) e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      this._setNdc(e); this.mouseActive = true;
    });
    dom.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') { this._setNdc(e); this.mouseActive = true; return; }
      this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false });
      try { dom.setPointerCapture && dom.setPointerCapture(e.pointerId); } catch { /* synthetic / already released pointer */ }
      if (!this.touch) {
        this.touch = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
        this.coast = null;
        this._setNdc(e);
        this._joy(true);
      }
      if (this.pts.size >= 2) this.pinchD = this._pinchDist();
    });
    const move = (e) => {
      const p = this.pts.get(e.pointerId);
      if (!p) return;
      const ddx = e.clientX - p.x, ddy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (Math.hypot(p.x - p.sx, p.y - p.sy) > TAP_MOVE) p.moved = true;
      let zooming = false;
      if (this.pts.size >= 2) {
        const d = this._pinchDist();
        if (this.pinchD > 0 && d > 0 && Math.abs(d - this.pinchD) > 0.75) {
          zooming = true;
          if (this.onZoom) this.onZoom(this.pinchD / d);
          this.stats.zooms++;
        }
        this.pinchD = d;
      }
      const s = this.touch;
      if (s && e.pointerId === s.id) {
        s.x = e.clientX; s.y = e.clientY;
        if (zooming) { s.ox += ddx; s.oy += ddy; }       // pinch: the offset stays as it was, no steering jump
        else this._follow(s);
        this._setNdc(e);
        this._joy(true);
      }
    };
    const up = (e) => {
      const p = this.pts.get(e.pointerId);
      const wasOnly = this.pts.size === 1;
      this.pts.delete(e.pointerId);
      this.pinchD = this.pts.size >= 2 ? this._pinchDist() : 0;
      if (p && e.type === 'pointerup' && wasOnly) this._tap(p, e);
      const s = this.touch;
      if (s && e.pointerId === s.id) {
        const out = this._stickVec(s);
        this.touch = null;
        const next = [...this.pts.entries()][0];
        if (next) {                                         // the other finger takes over, from where it stands (offset 0: no jump)
          this.touch = { id: next[0], ox: next[1].x, oy: next[1].y, x: next[1].x, y: next[1].y };
        } else if (out && Math.hypot(out.x, out.z) > 0.05) this.coast = { x: out.x, z: out.z, t0: performance.now() };
        this._joy(!!this.touch);
      }
    };
    dom.addEventListener('pointermove', move);
    dom.addEventListener('pointerup', up);
    dom.addEventListener('pointercancel', up);
    dom.addEventListener('lostpointercapture', (e) => { if (e.pointerType === 'touch' && this.pts.has(e.pointerId)) up({ pointerId: e.pointerId, type: 'pointercancel' }); });
    dom.addEventListener('wheel', (e) => { e.preventDefault(); if (this.onZoom) this.onZoom(Math.exp(Math.max(-120, Math.min(120, e.deltaY)) * 0.0012)); }, { passive: false });
    // the screen edge belongs to the game while playing: keeps iOS' edge back-swipe from navigating away mid-round
    dom.addEventListener('touchstart', (e) => {
      const t0 = e.touches[0];
      if (this.enabled && t0 && (t0.clientX < 20 || t0.clientX > window.innerWidth - 20) && e.cancelable) e.preventDefault();
    }, { passive: false });
  }

  /** Drop every touch (pause, panel opened, orientation change): the hole coasts to a stop instead of steering on stale data. */
  releaseTouches() {
    this.pts.clear(); this.pinchD = 0; this.touch = null; this.coast = null; this._joy(false);
  }

  _tap(p, e) {
    const now = performance.now();
    if (p.moved || now - p.t > TAP_MS) { this.lastTap = null; return; }
    this.stats.taps++;
    const lt = this.lastTap;
    if (lt && now - lt.t < DTAP_MS && Math.hypot(lt.x - p.x, lt.y - p.y) < DTAP_DIST) {
      this.lastTap = null; this.stats.doubleTaps++;
      if (this.onDoubleTap) this.onDoubleTap();
    } else this.lastTap = { t: now, x: p.x, y: p.y };
  }

  get radius() { return RADIUS[prefs.sens - 1] || RADIUS[1]; }

  /** Past the max radius the base follows the thumb. */
  _follow(s) {
    const dx = s.x - s.ox, dy = s.y - s.oy, l = Math.hypot(dx, dy), R = this.radius;
    if (l > R) { const k = (l - R) / l; s.ox += dx * k; s.oy += dy * k; }
  }

  /** Joystick output { x, z } in -1..1 (camera is north-up: screen right = +x, screen down = +z). */
  _stickVec(s) {
    const dx = s.x - s.ox, dy = s.y - s.oy, l = Math.hypot(dx, dy), R = this.radius;
    if (l <= DEAD) return { x: 0, z: 0 };
    const m = Math.min(1, (l - DEAD) / (R - DEAD));
    return { x: (dx / l) * m, z: (dy / l) * m };
  }

  _pinchDist() {
    const [a, b] = [...this.pts.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  _setNdc(e) {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.hasPointer = true;
  }

  _joy(show) {
    if (!this.joyEl) return;
    const on = show && this.touch && prefs.control === 'stick';
    this.joyEl.style.display = on ? 'block' : 'none';
    if (on) {
      const t = this.touch, R = this.radius;
      this.joyEl.style.left = t.ox + 'px'; this.joyEl.style.top = t.oy + 'px';
      this.joyEl.style.setProperty('--joy-r', R + 'px');
      const dx = t.x - t.ox, dy = t.y - t.oy, l = Math.hypot(dx, dy), m = Math.min(l, R);
      const k = l > 0 ? m / l : 0;
      this.knobEl.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    }
  }

  /** Returns a control descriptor for the player hole. */
  getControl(camera) {
    let x = 0, z = 0;
    const k = this.keys;
    if (k.has('a') || k.has('arrowleft')) x -= 1;
    if (k.has('d') || k.has('arrowright')) x += 1;
    if (k.has('w') || k.has('arrowup')) z -= 1;
    if (k.has('s') || k.has('arrowdown')) z += 1;
    if (x || z) return { mode: 'dir', x, z };
    if (this.touch) {
      if (prefs.control === 'finger') {          // the hole follows the finger's position on the ground
        this.ray.setFromCamera(this.ndc, camera);
        if (this.ray.ray.intersectPlane(this.plane, this.hit)) return { mode: 'target', x: this.hit.x, z: this.hit.z };
        return { mode: 'dir', x: 0, z: 0 };
      }
      const v = this._stickVec(this.touch);
      return { mode: 'dir', x: v.x, z: v.z };
    }
    if (this.coast) {
      const age = (performance.now() - this.coast.t0) / 1000;
      if (age < COAST_S) { const f = (1 - age / COAST_S) ** 2; return { mode: 'dir', x: this.coast.x * f, z: this.coast.z * f }; }
      this.coast = null;
    }
    if (this.mouseActive && this.hasPointer) {
      this.ray.setFromCamera(this.ndc, camera);
      if (this.ray.ray.intersectPlane(this.plane, this.hit)) return { mode: 'target', x: this.hit.x, z: this.hit.z };
    }
    return { mode: 'dir', x: 0, z: 0 };
  }
}

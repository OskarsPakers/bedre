// Pointer (mouse -> ground point, touch -> virtual joystick) and keyboard input.
import * as THREE from 'three';

export class Input {
  constructor(dom) {
    this.dom = dom;
    this.keys = new Set();
    this.ndc = new THREE.Vector2();
    this.hasPointer = false;
    this.mouseActive = false;
    this.touch = null; // { id, ox, oy, x, y }
    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.hit = new THREE.Vector3();
    this.joyEl = document.getElementById('joystick');
    this.knobEl = document.getElementById('joy-knob');
    this.enabled = false;
    this.onZoom = null; // (factor) => void; wheel / pinch
    this.pts = new Map(); // active touch pointers (for pinch)
    this.pinchD = 0;

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
      if (e.pointerType === 'touch') {
        this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pts.size >= 2) { this.touch = null; this._joy(false); this.pinchD = this._pinchDist(); return; }
        this.touch = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
        dom.setPointerCapture?.(e.pointerId);
        this._joy(true);
      } else { this._setNdc(e); this.mouseActive = true; }
    });
    const move = (e) => {
      if (this.pts.has(e.pointerId)) {
        this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pts.size >= 2) {
          const d = this._pinchDist();
          if (this.pinchD > 0 && d > 0 && this.onZoom) this.onZoom(this.pinchD / d);
          this.pinchD = d;
          return;
        }
      }
      if (this.touch && e.pointerId === this.touch.id) { this.touch.x = e.clientX; this.touch.y = e.clientY; this._joy(true); } };
    const up = (e) => { this.pts.delete(e.pointerId); if (this.pts.size < 2) this.pinchD = 0; if (this.touch && e.pointerId === this.touch.id) { this.touch = null; this._joy(false); } };
    dom.addEventListener('pointermove', move);
    dom.addEventListener('pointerup', up);
    dom.addEventListener('pointercancel', up);
    dom.addEventListener('wheel', (e) => { e.preventDefault(); if (this.onZoom) this.onZoom(Math.exp(Math.max(-120, Math.min(120, e.deltaY)) * 0.0012)); }, { passive: false });
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
    this.joyEl.style.display = show && this.touch ? 'block' : 'none';
    if (show && this.touch) {
      const t = this.touch;
      this.joyEl.style.left = t.ox + 'px'; this.joyEl.style.top = t.oy + 'px';
      const dx = t.x - t.ox, dy = t.y - t.oy, l = Math.hypot(dx, dy), m = Math.min(l, 48);
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
      const dx = this.touch.x - this.touch.ox, dy = this.touch.y - this.touch.oy;
      const l = Math.hypot(dx, dy);
      if (l < 6) return { mode: 'dir', x: 0, z: 0 };
      const m = Math.min(1, l / 60);
      return { mode: 'dir', x: (dx / l) * m, z: (dy / l) * m }; // camera is north-up
    }
    if (this.mouseActive && this.hasPointer) {
      this.ray.setFromCamera(this.ndc, camera);
      if (this.ray.ray.intersectPlane(this.plane, this.hit)) return { mode: 'target', x: this.hit.x, z: this.hit.z };
    }
    return { mode: 'dir', x: 0, z: 0 };
  }
}

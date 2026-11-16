// Follow camera: north-up, elevated; pulls back as the hole grows.
import * as THREE from 'three';
import { CFG } from './config.js';
import { camShake } from './effects.js';

// Touch layout tuning (phones only: body.tui). Everything is a continuous function of the aspect ratio, no portrait / landscape switch:
//   p = how portrait (0 at aspect >= 0.95, 1 at <= 0.46),  l = how landscape (0 at <= 1.95, 1 at >= 2.2; ordinary desktop windows stay at 0).
const TUNE = {
  pAspect: [0.95, 0.46], lAspect: [1.95, 2.2],
  wide: { p: 0.22, l: 0.10 },        // extra camera distance: more of the city on screen
  pitchDeg: { p: -2.5, l: -5 },        // flatter camera = further ahead
  holeY: { base: 0.10, p: 0.16, l: 0.85 }, // hole sits at 50 % + this share of half the height (p: 62 % down in portrait), landscape: centred
  lead: { px: 1.4, pz: 0.3 },        // look-ahead gain, sideways / forwards, per unit of p
  southKeep: 0.6,                    // heading south (screen down) lifts the hole back towards the middle so there is room ahead
  wideZoom: 1.7,                     // double-tap view
};
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ramp = (v, a, b) => clamp01((v - a) / (b - a));

export class FollowCamera {
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(CFG.camera.fov, aspect, 1, 14000);
    this.focus = new THREE.Vector3();
    this.dist = 30;
    this.elev = THREE.MathUtils.degToRad(CFG.camera.elevationDeg);
    this.elevTarget = this.elev;
    this._look = new THREE.Vector3();
    this.zoom = 1;
    try { const z = parseFloat(sessionStorage.getItem('bedre.zoom')); if (z > 0) this.zoom = Math.min(CFG.camera.zoomMax, Math.max(CFG.camera.zoomMin, z)); } catch (e) { /* ignore */ }
    this.aspect = aspect;
    this.touchUi = false;            // phone layout: portrait / landscape tuning below (set by Game.resize)
    this.tp = 0; this.tl = 0;        // portrait-ness / landscape-ness (0..1)
    this.elevNow = this.elev;        // eased towards the tuned pitch (an orientation flip glides instead of jumping)
    this.lead = new THREE.Vector3(); // smoothed look-ahead offset (movement direction)
    this.ease = 0;                   // 0..~1.6: theme.js eases the pitch down / zoom out a little while fireworks are in the sky (see Theme.frame)
  }

  /** Wheel / pinch zoom multiplier (clamped, remembered for the session). factor > 1 zooms out. */
  zoomBy(factor) {
    const Z = CFG.camera;
    this.zoom = Math.min(Z.zoomMax, Math.max(Z.zoomMin, this.zoom * factor));
    try { sessionStorage.setItem('bedre.zoom', String(this.zoom)); } catch (e) { /* storage blocked */ }
  }

  /** Double-tap: between the normal and the wide view. */
  toggleWide() {
    const Z = CFG.camera;
    this.zoom = this.zoom >= 1.35 ? 1 : Math.min(Z.zoomMax, TUNE.wideZoom);
    try { sessionStorage.setItem('bedre.zoom', String(this.zoom)); } catch (e) { /* storage blocked */ }
  }

  _retune() {
    if (!this.touchUi) { this.tp = 0; this.tl = 0; this.elevTarget = this.elev; return; }
    this.tp = ramp(this.aspect, TUNE.pAspect[0], TUNE.pAspect[1]);
    this.tl = ramp(this.aspect, TUNE.lAspect[0], TUNE.lAspect[1]);
    this.elevTarget = this.elev + THREE.MathUtils.degToRad(TUNE.pitchDeg.p * this.tp + TUNE.pitchDeg.l * this.tl);
  }

  targetDist(radius) { return (CFG.camera.distBase + CFG.camera.distPerRadius * radius) * this.zoom * (1 + TUNE.wide.p * this.tp + TUNE.wide.l * this.tl); }

  snap(hole) {
    this._retune(); this.elevNow = this.elevTarget;
    this.lead.set(0, 0, 0);
    this.focus.set(hole.x, 0, hole.z);
    this.dist = this.targetDist(hole.radius);
    this.apply();
  }

  update(dt, hole) {
    const kf = 1 - Math.exp(-CFG.camera.smooth * dt);
    const kz = 1 - Math.exp(-CFG.camera.zoomSmooth * dt);
    // look-ahead: lean towards where the hole is heading (capped relative to zoom), smoothly
    const kl = 1 - Math.exp(-CFG.camera.leadSmooth * dt);
    if (this.touchUi) {
      // phones: per-axis, with more sideways reach in portrait (the screen is narrow there)
      const base = this.dist * CFG.camera.lookAhead;
      const tf = Math.tan(THREE.MathUtils.degToRad(CFG.camera.fov / 2));
      const halfW = this.dist * tf * this.aspect, halfH = this.dist * tf / Math.sin(this.elevNow);   // half the visible ground, roughly
      const yBase = (TUNE.holeY.base + TUNE.holeY.p * this.tp) * (1 - TUNE.holeY.l * this.tl);       // hole's resting height below centre (NDC)
      // the look-ahead may shift the hole at most ~half-way to the screen edge (never under the thumbs / size bar)
      const capX = Math.min(base * (1 + TUNE.lead.px * this.tp), halfW * 0.5), capZs = base * (1 + TUNE.lead.pz * this.tp), capZn = Math.min(capZs, Math.max(0, (0.5 - yBase) * halfH));
      const tx = Math.max(-capX, Math.min(capX, hole.vx * CFG.camera.leadTime * (1 + TUNE.lead.px * this.tp)));
      const rz = hole.vz * CFG.camera.leadTime * (1 + TUNE.lead.pz * this.tp);
      const tz = rz < 0 ? Math.max(-capZn, rz) : Math.min(capZs, rz);
      this.lead.x += (tx - this.lead.x) * kl;
      this.lead.z += (tz - this.lead.z) * kl;
      const capZ = capZs;
      this._capZ = capZ;
    } else {
      const sp = Math.hypot(hole.vx, hole.vz);
      const cap = this.dist * CFG.camera.lookAhead;
      const k = sp > 0.01 ? Math.min(1, (sp * CFG.camera.leadTime) / Math.max(0.01, cap)) * cap / sp : 0;
      this.lead.x += (hole.vx * k - this.lead.x) * kl;
      this.lead.z += (hole.vz * k - this.lead.z) * kl;
    }
    this._retune();
    this.elevNow += (this.elevTarget - this.elevNow) * kz;
    this.focus.x += (hole.x + this.lead.x - this.focus.x) * kf;
    this.focus.z += (hole.z + this.lead.z - this.focus.z) * kf;
    this.dist += (this.targetDist(hole.radius) - this.dist) * kz;
    this.apply();
  }

  apply() {
    const d = this.dist * (1 + this.ease * 0.14), c = this.camera;
    const el = (this.touchUi ? this.elevNow : this.elev) - this.ease * 0.2;   // fireworks: up to ~11 deg flatter per 1.0 of ease
    c.position.set(this.focus.x, this.focus.y + Math.sin(el) * d, this.focus.z + Math.cos(el) * d);
    // look slightly ahead (north) so the hole sits a bit below screen centre; on phones the hole is placed at a tuned height of the screen
    let ahead = d * 0.08;
    if (this.touchUi) {
      const south = clamp01((this.lead.z / Math.max(1e-3, this._capZ || 1)));
      const yT = (TUNE.holeY.base + TUNE.holeY.p * this.tp) * (1 - TUNE.holeY.l * this.tl) * (1 - TUNE.southKeep * south);  // hole's NDC height below centre
      const off = Math.atan(yT * Math.tan(THREE.MathUtils.degToRad(CFG.camera.fov / 2)));
      ahead = d * (Math.cos(el) - Math.sin(el) / Math.tan(el + off));
    }
    this._look.set(this.focus.x, 0, this.focus.z - ahead);
    if (camShake.amp > 0) { const k = d * 0.01; c.position.x += camShake.x * k; c.position.y += camShake.y * k; c.position.z += camShake.z * k; this._look.x += camShake.x * k; this._look.z += camShake.z * k; }
    c.lookAt(this._look);
    c.near = Math.max(0.5, d * 0.05);
    c.far = Math.max(6000, d * 8);
    c.updateProjectionMatrix();
  }

  resize(aspect, touchUi = this.touchUi) {
    this.camera.aspect = aspect; this.aspect = aspect; this.touchUi = touchUi;
    this._retune();
    this.camera.updateProjectionMatrix();
  }
}

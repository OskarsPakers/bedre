// Follow camera: north-up, elevated; pulls back as the hole grows.
import * as THREE from 'three';
import { CFG } from './config.js';
import { camShake } from './effects.js';

export class FollowCamera {
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(CFG.camera.fov, aspect, 1, 14000);
    this.focus = new THREE.Vector3();
    this.dist = 30;
    this.elev = THREE.MathUtils.degToRad(CFG.camera.elevationDeg);
    this._look = new THREE.Vector3();
    this.zoom = 1;
    try { const z = parseFloat(sessionStorage.getItem('bedre.zoom')); if (z > 0) this.zoom = Math.min(CFG.camera.zoomMax, Math.max(CFG.camera.zoomMin, z)); } catch (e) { /* ignore */ }
    this.lead = new THREE.Vector3(); // smoothed look-ahead offset (movement direction)
  }

  /** Wheel / pinch zoom multiplier (clamped, remembered for the session). factor > 1 zooms out. */
  zoomBy(factor) {
    const Z = CFG.camera;
    this.zoom = Math.min(Z.zoomMax, Math.max(Z.zoomMin, this.zoom * factor));
    try { sessionStorage.setItem('bedre.zoom', String(this.zoom)); } catch (e) { /* storage blocked */ }
  }

  targetDist(radius) { return (CFG.camera.distBase + CFG.camera.distPerRadius * radius) * this.zoom; }

  snap(hole) {
    this.lead.set(0, 0, 0);
    this.focus.set(hole.x, 0, hole.z);
    this.dist = this.targetDist(hole.radius);
    this.apply();
  }

  update(dt, hole) {
    const kf = 1 - Math.exp(-CFG.camera.smooth * dt);
    const kz = 1 - Math.exp(-CFG.camera.zoomSmooth * dt);
    // look-ahead: lean towards where the hole is heading (capped relative to zoom), smoothly
    const sp = Math.hypot(hole.vx, hole.vz);
    const cap = this.dist * CFG.camera.lookAhead;
    const k = sp > 0.01 ? Math.min(1, (sp * CFG.camera.leadTime) / Math.max(0.01, cap)) * cap / sp : 0;
    const kl = 1 - Math.exp(-CFG.camera.leadSmooth * dt);
    this.lead.x += (hole.vx * k - this.lead.x) * kl;
    this.lead.z += (hole.vz * k - this.lead.z) * kl;
    this.focus.x += (hole.x + this.lead.x - this.focus.x) * kf;
    this.focus.z += (hole.z + this.lead.z - this.focus.z) * kf;
    this.dist += (this.targetDist(hole.radius) - this.dist) * kz;
    this.apply();
  }

  apply() {
    const d = this.dist, c = this.camera;
    c.position.set(this.focus.x, this.focus.y + Math.sin(this.elev) * d, this.focus.z + Math.cos(this.elev) * d);
    // look slightly ahead (north) so the hole sits a bit below screen centre
    this._look.set(this.focus.x, 0, this.focus.z - d * 0.08);
    if (camShake.amp > 0) { const k = d * 0.01; c.position.x += camShake.x * k; c.position.y += camShake.y * k; c.position.z += camShake.z * k; this._look.x += camShake.x * k; this._look.z += camShake.z * k; }
    c.lookAt(this._look);
    c.near = Math.max(0.5, d * 0.05);
    c.far = Math.max(6000, d * 8);
    c.updateProjectionMatrix();
  }

  resize(aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
}

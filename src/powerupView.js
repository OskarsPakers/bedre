// Power-up visuals (three.js + canvas art, no assets): floating low-poly tokens with a soft ground glow, the pull / shield / double auras around
// holes, and the shared icon art used by the HUD badges and the pickup toast. Rules live in src/powerups.js.
import * as THREE from 'three';
import { PU_TYPES, PU } from './powerups.js';

export const PU_COLOR = { magnet: '#e0507a', speed: '#2fc47a', double: '#f5b82e', shield: '#4c8df0' };
export const PU_DARK = { magnet: '#a62a52', speed: '#188a52', double: '#b57d0c', shield: '#2a5fba' };

/** Icon art (own drawing): glyph on a disc. size px square. Returns a canvas. */
export function iconCanvas(type, size = 96, bg = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d'), k = size / 96;
  g.scale(k, k);
  g.translate(48, 48);
  if (bg) {
    const grd = g.createRadialGradient(-10, -14, 6, 0, 0, 48);
    grd.addColorStop(0, PU_COLOR[type]); grd.addColorStop(1, PU_DARK[type]);
    g.fillStyle = grd; g.beginPath(); g.arc(0, 0, 46, 0, 6.2832); g.fill();
    g.lineWidth = 5; g.strokeStyle = 'rgba(255,255,255,.92)'; g.stroke();
  }
  g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  if (type === 'magnet') {          // horseshoe magnet with striped tips
    g.lineWidth = 13; g.beginPath(); g.arc(0, -2, 20, Math.PI, 0, false); g.lineTo(20, 20); g.moveTo(-20, -2); g.lineTo(-20, 20); g.stroke();
    g.fillStyle = bg ? '#2b2118' : '#e0507a'; g.fillRect(-26.5, 14, 13, 8); g.fillRect(13.5, 14, 13, 8);
  } else if (type === 'speed') {    // lightning bolt
    g.beginPath(); g.moveTo(8, -32); g.lineTo(-17, 5); g.lineTo(-2, 5); g.lineTo(-9, 32); g.lineTo(19, -9); g.lineTo(3, -9); g.closePath(); g.fill();
  } else if (type === 'double') {   // x2
    g.font = '900 46px "Avenir Next", "Segoe UI", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('×2', 0, 3);
  } else {                          // shield
    g.beginPath(); g.moveTo(0, -30); g.lineTo(24, -20); g.quadraticCurveTo(24, 14, 0, 32); g.quadraticCurveTo(-24, 14, -24, -20); g.closePath(); g.fill();
    g.fillStyle = PU_COLOR.shield; g.beginPath(); g.moveTo(0, -17); g.lineTo(13, -12); g.quadraticCurveTo(13, 8, 0, 20); g.closePath(); g.fill();
  }
  return c;
}

const glowTex = (() => {
  let t = null;
  return () => {
    if (t) return t;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grd.addColorStop(0, 'rgba(255,255,255,.95)'); grd.addColorStop(0.35, 'rgba(255,255,255,.4)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
})();

/** Ring textures of the auras, drawn polar so a plain quad shows them. */
const auraTex = {};
function aura(type) {
  if (auraTex[type]) return auraTex[type];
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), col = PU_COLOR[type];
  g.translate(S / 2, S / 2);
  if (type === 'shield') {
    const grd = g.createRadialGradient(0, 0, 0.78 * S / 2, 0, 0, 0.96 * S / 2);
    grd.addColorStop(0, 'rgba(76,141,240,0)'); grd.addColorStop(1, 'rgba(120,175,255,.34)');
    g.fillStyle = grd; g.beginPath(); g.arc(0, 0, 0.96 * S / 2, 0, 6.2832); g.arc(0, 0, 0.78 * S / 2, 0, 6.2832, true); g.fill();
    g.lineWidth = 7; g.strokeStyle = 'rgba(190,220,255,.95)'; g.beginPath(); g.arc(0, 0, 0.95 * S / 2, 0, 6.2832); g.stroke();
  } else if (type === 'magnet') {
    g.lineWidth = 6; g.strokeStyle = col; g.lineCap = 'round';
    const n = 18;
    for (let i = 0; i < n; i++) { const a = (i / n) * 6.2832; g.beginPath(); g.arc(0, 0, 0.94 * S / 2, a, a + 6.2832 / n * 0.5); g.stroke(); }
  } else {
    g.lineWidth = 6; g.strokeStyle = col; g.beginPath(); g.arc(0, 0, 0.95 * S / 2, 0, 6.2832); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return (auraTex[type] = t);
}

const _col = new THREE.Color();

export class PowerupView {
  constructor(scene, fx = null) {
    this.scene = scene;
    this.fx = fx;                       // effects.js particles (optional: set by the game)
    this.group = new THREE.Group(); this.group.name = 'powerups';
    scene.add(this.group);
    this.items = new Map();             // slot -> { slot, type, x, z, mesh, glow, t, leave }
    this.leaving = [];
    this.auras = new Map();             // `${holeId}:${type}` -> mesh
    this.faces = {}; this.rim = {};
    this.geo = new THREE.CylinderGeometry(1, 1, 0.32, 8).rotateX(Math.PI / 2);   // coin standing on its edge: faces towards +-z
    this.glowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.quadGeo = this.glowGeo;
    for (const type of PU_TYPES) {
      const tex = new THREE.CanvasTexture(iconCanvas(type, 128)); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      this.faces[type] = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
      this.rim[type] = new THREE.MeshBasicMaterial({ color: PU_DARK[type], toneMapped: false });
    }
    this.time = 0;
  }

  clear() {
    for (const it of this.items.values()) this.group.remove(it.mesh), this.group.remove(it.glow);
    for (const l of this.leaving) this.group.remove(l.mesh), this.group.remove(l.glow);
    this.items.clear(); this.leaving.length = 0;
  }

  /** A pickup appeared: e = { slot, type, x, z }. */
  spawn(e) {
    this.remove(e.slot, false, null, true);
    const mesh = new THREE.Mesh(this.geo, [this.rim[e.type], this.faces[e.type], this.faces[e.type]]);
    mesh.renderOrder = 6;
    const glow = new THREE.Mesh(this.glowGeo, new THREE.MeshBasicMaterial({ map: glowTex(), color: PU_COLOR[e.type], transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    glow.renderOrder = 3;
    this.group.add(mesh, glow);
    this.items.set(e.slot, { slot: e.slot, type: e.type, x: e.x, z: e.z, mesh, glow, t: 0, appear: 0 });
    if (this.fx) this._sparkle(e.x, 2, e.z, PU_COLOR[e.type], 10, 1.2);
  }

  /** The pickup is gone (collected by `hole`, or expired / replaced). */
  remove(slot, collected, hole = null, silent = false) {
    const it = this.items.get(slot);
    if (!it) return;
    this.items.delete(slot);
    it.leave = { t: 0, hole: collected ? hole : null };
    if (collected && this.fx) this._sparkle(it.x, 2.2, it.z, PU_COLOR[it.type], 22, 2.4);
    this.leaving.push(it);
    if (silent) { this.group.remove(it.mesh, it.glow); this.leaving.pop(); }
  }

  _sparkle(x, y, z, hex, n, sp) {
    _col.set(hex);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, v = (0.5 + Math.random()) * sp * 3;
      this.fx.emit(x, y, z, Math.cos(a) * v, 1.5 + Math.random() * 3, Math.sin(a) * v, 0.5, 0.12, 0.6 + Math.random() * 0.5, 1, 1, _col.r, _col.g, _col.b, 1.5, 1.6);
    }
  }

  /** Minimap dots: [{ x, z, type }]. */
  dots() { const o = []; for (const it of this.items.values()) o.push(it); return o; }
  /** Rows [slot, type, x, z] (tests / the online client). */
  list() { const o = []; for (const it of this.items.values()) o.push([it.slot, it.type, it.x, it.z]); return o; }

  update(holes, dt, camDist, time) {
    this.time += dt;
    const S = 0.6 + camDist * 0.024;                 // world size of a token: >= ~22 px radius on screen at every zoom / hole size (the screen size is S / camDist x ~900 px)
    for (const it of this.items.values()) {
      it.t += dt; it.appear = Math.min(1, it.appear + dt * 2.5);
      const pop = 1 - Math.pow(1 - it.appear, 3), s = S * (0.2 + 0.8 * pop);
      it.mesh.position.set(it.x, 1.25 * S + Math.sin(this.time * 2 + it.slot) * 0.16 * S, it.z);
      it.mesh.rotation.order = 'YXZ';
      it.mesh.rotation.set(-0.98, Math.sin(this.time * 0.9 + it.slot * 1.3) * 0.75, 0);   // tilted to face the camera, swaying slowly about the vertical axis (a full spin would show the thin rim half of the time)
      it.mesh.scale.setScalar(s);
      it.glow.position.set(it.x, 0.18, it.z);
      const g = S * 3.4 * (0.92 + 0.08 * Math.sin(this.time * 3 + it.slot));
      it.glow.scale.set(g, 1, g);
    }
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      const it = this.leaving[i], L = it.leave;
      L.t += dt / 0.35;
      const k = Math.min(1, L.t), e = k * k;
      const tx = L.hole ? L.hole.x : it.x, tz = L.hole ? L.hole.z : it.z;
      it.mesh.position.set(it.x + (tx - it.x) * e, it.mesh.position.y * (1 - e * 0.1), it.z + (tz - it.z) * e);
      it.mesh.scale.setScalar(S * (1 - e));
      it.glow.scale.setScalar(S * 3.4 * (1 - k));
      if (k >= 1) { this.group.remove(it.mesh, it.glow); it.glow.material.dispose(); this.leaving.splice(i, 1); }
    }
    // auras: shield (everyone), pull range + double (only holes with the effect); speed leaves a streak
    for (const h of holes) {
      const fx = h.fx;
      if (!fx) continue;
      const on = { shield: fx.shield > 0, magnet: fx.magnet > 0, double: fx.double > 0 };
      for (const type of ['shield', 'magnet', 'double']) {
        const key = h.id + ':' + type;
        let m = this.auras.get(key);
        if (!on[type] || !h.alive) { if (m && m.visible) m.visible = false; continue; }
        if (!m) {
          m = new THREE.Mesh(this.quadGeo, new THREE.MeshBasicMaterial({ map: aura(type), transparent: true, depthWrite: false, toneMapped: false, opacity: 0.9 }));
          m.renderOrder = 4; this.group.add(m); this.auras.set(key, m);
        }
        m.visible = true;
        const k = type === 'magnet' ? PU.magnet.radius * 2 : type === 'shield' ? 2.5 : 2.16;
        const pulse = type === 'magnet' ? 1 - 0.04 * Math.sin(this.time * 6) : 1;
        m.scale.setScalar(h.radius * k * pulse);
        m.position.set(h.x, 0.26, h.z);
        m.rotation.y = type === 'magnet' ? this.time * 0.8 : 0;
        const left = type === 'shield' ? fx.shield : type === 'magnet' ? fx.magnet : fx.double;
        m.material.opacity = left < 1.5 ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.time * 18)) : 0.9;   // blinks in the last second and a half
      }
      if (fx.speed > 0 && h.alive && this.fx && (h.vx * h.vx + h.vz * h.vz) > 1) {
        _col.set(PU_COLOR.speed);
        const sp = Math.hypot(h.vx, h.vz) || 1;
        if (Math.random() < Math.min(1, dt * 40)) this.fx.emit(h.x - (h.vx / sp) * h.radius * 0.9 + (Math.random() - 0.5) * h.radius, 0.5, h.z - (h.vz / sp) * h.radius * 0.9 + (Math.random() - 0.5) * h.radius, -h.vx * 0.2, 0.6, -h.vz * 0.2, 0.7 + h.radius * 0.1, 0.2, 0.45, 0.7, 1, _col.r, _col.g, _col.b, 0, 2);
      }
    }
  }
}

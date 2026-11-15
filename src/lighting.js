// Sky, fog, hemisphere + sun with a shadow frustum that follows the camera focus.
import * as THREE from 'three';
import { CFG } from './config.js';

export class Lighting {
  constructor(scene) {
    this.scene = scene;
    const sky = new THREE.Color(CFG.colors.sky);
    scene.background = sky;
    scene.fog = new THREE.Fog(sky, 100, 600);
    this.fog = scene.fog;
    this.hemi = new THREE.HemisphereLight(0xe3eefa, 0xb9a98c, 1.25);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d4, 2.5);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.mapSize.set(CFG.shadowMapSize, CFG.shadowMapSize);
    s.bias = -0.0004;
    s.normalBias = 0.2;
    scene.add(this.sun, this.sun.target);
    this.dir = new THREE.Vector3(-0.55, 0.78, 0.35).normalize(); // direction towards the sun
    this.size = 40;
    this.shadowSize = CFG.shadowMapSize; // quality.js may change this together with sun.shadow.mapSize
    this._right = new THREE.Vector3(); this._upv = new THREE.Vector3(); this._f = new THREE.Vector3();
    // far-zoom shadow fade: shadows fade out once a shadow texel gets coarse (blocky), the shadow map stops updating
    // when fully faded, and the hemisphere fill dips a touch so the city keeps some depth without cast shadows.
    this.shadowFade = 1; // 1 = full shadows, 0 = none
    this.hemiBase = this.hemi.intensity; this.sunBase = this.sun.intensity;
    this._lastT = performance.now();
    this.shadowK = 1;                       // theme: shadow strength multiplier (softer at night)
    this.flash = 0; this.flashColor = new THREE.Color(1, 1, 1); // firework flash (theme.js sets these each frame)
    this._hemiSky = this.hemi.color.clone();
  }

  /** Apply a theme look (src/theme.js): sky / fog colours, hemisphere + sun, sun direction, shadow strength. All values pre-built, no per-frame cost. */
  applyTheme(T) {
    this.scene.background.copy(T.fog);
    this.fog.color.copy(T.fog);
    this.hemi.color.copy(T.hemi.sky); this.hemi.groundColor.copy(T.hemi.ground);
    this._hemiSky.copy(T.hemi.sky);
    this.hemiBase = T.hemi.i;
    this.sun.color.copy(T.sun.color); this.sunBase = T.sun.i;
    this.dir.copy(T.sun.dir);
    this.shadowK = T.shadow;
  }

  /** target shadow strength for a camera distance: full while a texel is < fadeTexel[0] m, gone at fadeTexel[1] m */
  shadowTarget(dist) {
    const [t0, t1] = CFG.shadowFadeTexel || [0.34, 0.62];
    const half = THREE.MathUtils.clamp(dist * 0.62, 28, 1700);
    const texel = (2 * half) / this.shadowSize;
    const k = THREE.MathUtils.clamp((texel - t0) / (t1 - t0), 0, 1);
    return 1 - k * k * (3 - 2 * k);
  }

  update(focus, dist) {
    // fog scales with camera distance so the horizon stays soft but the play area is clear
    this.fog.near = dist * 1.9;
    this.fog.far = dist * 7.5;
    // smooth (time-based) shadow fade so zoom snaps don't pop
    const now = performance.now(), dt = Math.min(0.1, (now - this._lastT) / 1000); this._lastT = now;
    const tgt = this.shadowTarget(dist);
    this.shadowFade += (tgt - this.shadowFade) * (dt > 0 ? 1 - Math.exp(-6 * dt) : 1);
    if (Math.abs(tgt - this.shadowFade) < 0.003) this.shadowFade = tgt;
    const f = this.shadowFade, s = this.sun.shadow;
    s.intensity = f * this.shadowK;
    s.autoUpdate = f > 0.001; // fully faded: skip rendering the shadow map (big win at the widest zoom)
    // without cast shadows the sunlit/shaded contrast comes from face shading only: keep it a bit stronger
    this.sun.intensity = this.sunBase * (0.92 + 0.08 * f);
    this.hemi.intensity = this.hemiBase * (0.9 + 0.1 * f);
    if (this.flash > 0.002) { this.hemi.intensity += this.flash * 0.55; this.hemi.color.copy(this._hemiSky).lerp(this.flashColor, Math.min(0.7, this.flash)); }
    else if (this.flash !== 0) { this.flash = 0; this.hemi.color.copy(this._hemiSky); }
    if (f <= 0.001) return; // shadow camera placement is irrelevant while faded out
    // shadow region: enough to cover what the camera sees near the focus
    const half = THREE.MathUtils.clamp(dist * 0.62, 28, 1700);
    const q = Math.pow(2, Math.round(Math.log2(half) * 3) / 3); // quantise to avoid constant resize
    const cam = this.sun.shadow.camera;
    if (Math.abs(cam.right - q) > 1e-3) {
      cam.left = -q; cam.right = q; cam.top = q; cam.bottom = -q;
      cam.near = 1; cam.far = q * 4 + 600;
      cam.updateProjectionMatrix();
    }
    // snap focus to shadow texels in light space
    const texel = (2 * q) / this.shadowSize;
    this._f.copy(this.dir);
    this._right.crossVectors(new THREE.Vector3(0, 1, 0), this._f).normalize();
    this._upv.crossVectors(this._f, this._right).normalize();
    const fx = focus.x, fz = focus.z;
    const pr = fx * this._right.x + fz * this._right.z;
    const pu = fx * this._upv.x + fz * this._upv.z;
    const sr = Math.round(pr / texel) * texel - pr, su = Math.round(pu / texel) * texel - pu;
    const sx = fx + this._right.x * sr + this._upv.x * su;
    const sz = fz + this._right.z * sr + this._upv.z * su;
    this.sun.target.position.set(sx, 0, sz);
    this.sun.position.set(sx + this.dir.x * (q * 2 + 300), this.dir.y * (q * 2 + 300), sz + this.dir.z * (q * 2 + 300));
    this.sun.target.updateMatrixWorld();
  }
}

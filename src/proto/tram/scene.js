// 3-D pieces of the tram game, all built from the shared world's THREE: real-looking rails + sleepers along the route, platforms, stop boards,
// 100 / 50 / 20 m countdown markers, waiting passengers. (The tram itself: tramModel.js; wires / signals / speed boards: furniture.js; street life: life.js.)
import * as THREE from 'three';
import { PROP_DEFS } from '../../propModels.js';
import { TRAM, BWALK } from './sim.js';
const k_of = (self, st) => self.stops.indexOf(st);

const lam = (c, extra = {}) => new THREE.MeshLambertMaterial({ color: c, ...extra });
const bas = (c, extra = {}) => new THREE.MeshBasicMaterial({ color: c, ...extra });
const rightOf = (yaw) => [-Math.sin(yaw), Math.cos(yaw)];     // right-hand side of the direction of travel in (x, z)

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
/** a thin box in a group (local coords: +x forward, +z right, y up) */
function box(parent, w, h, d, mat, x, y, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); parent.add(m); return m; }

// ---- rails / bed / sleepers ----------------------------------------------------------------------------------------------------------
export function buildRails(scene, track) {
  const g = new THREE.Group();
  const N = track.n;
  // ribbons along the centre line: bed (gravel), 2 rails (top + both flanks)
  const ribbon = (offset, width, y, mat, { sides = 0 } = {}) => {
    const pos = [], nor = [], idx = [];
    for (let i = 0; i < N; i++) {
      const [rx, rz] = rightOf(track.yaw[i]);
      for (const k of [-1, 1]) { pos.push(track.x[i] + rx * (offset + k * width / 2), y, track.z[i] + rz * (offset + k * width / 2)); nor.push(0, 1, 0); }
      if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); geo.setIndex(idx);
    const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; g.add(m);
    if (sides) { // vertical flanks (down to y - sides)
      const p2 = [], n2 = [], i2 = [];
      for (const k of [-1, 1]) {
        for (let i = 0; i < N; i++) {
          const [rx, rz] = rightOf(track.yaw[i]);
          const x = track.x[i] + rx * (offset + k * width / 2), z = track.z[i] + rz * (offset + k * width / 2);
          p2.push(x, y, z, x, y - sides, z); n2.push(rx * k, 0, rz * k, rx * k, 0, rz * k);
          if (i) { const a = (i - 1) * 2 + (k < 0 ? 0 : 2 * N); i2.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); if (k > 0) { /* winding flip */ const l = i2.length; [i2[l - 5], i2[l - 4]] = [i2[l - 4], i2[l - 5]]; [i2[l - 2], i2[l - 1]] = [i2[l - 1], i2[l - 2]]; } }
        }
      }
      const g2 = new THREE.BufferGeometry();
      g2.setAttribute('position', new THREE.Float32BufferAttribute(p2, 3)); g2.setAttribute('normal', new THREE.Float32BufferAttribute(n2, 3)); g2.setIndex(i2);
      const m2 = new THREE.Mesh(g2, mat); m2.material = mat; g.add(m2);
    }
    return m;
  };
  const bedM = lam(0x8d8a80, { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  ribbon(0, 3.0, 0.03, bedM);
  const railM = lam(0xd8dfe4, { side: THREE.DoubleSide });
  for (const o of [-0.762, 0.762]) ribbon(o, 0.18, 0.17, railM, { sides: 0.12 });
  // sleepers: one instanced box every 0.75 m
  const per = 0.75, n = Math.floor(track.length / per);
  const sleep = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.1, 2.6), lam(0x6d5b49), n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = {};
  for (let i = 0; i < n; i++) { track.at(i * per, p); q.setFromAxisAngle(up, -p.yaw); m4.compose(new THREE.Vector3(p.x, 0.07, p.z), q, new THREE.Vector3(1, 1, 1)); sleep.setMatrixAt(i, m4); }
  sleep.receiveShadow = true; sleep.frustumCulled = false; g.add(sleep);
  scene.add(g);
  return g;
}

// ---- stops ---------------------------------------------------------------------------------------------------------------------------
function numberBoard(n) {
  return canvasTex(256, 192, (c, w, h) => {
    c.fillStyle = '#ffd21f'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#111'; c.lineWidth = 10; c.strokeRect(5, 5, w - 10, h - 10);
    c.fillStyle = '#111'; c.font = 'bold 118px system-ui, Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(String(n), w / 2, h / 2 - 8);
    // bars (3 / 2 / 1) like the real approach aids
    const bars = n === 100 ? 3 : n === 50 ? 2 : 1;
    c.fillStyle = '#111';
    for (let i = 0; i < bars; i++) { c.save(); c.translate(w / 2 + (i - (bars - 1) / 2) * 46, h - 26); c.rotate(-0.6); c.fillRect(-4, -18, 8, 36); c.restore(); }
  });
}
function nameBoard(name) {
  return canvasTex(512, 128, (c, w, h) => {
    c.fillStyle = '#16365c'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#ffd21f'; c.fillRect(0, 0, 14, h);
    c.fillStyle = '#fff'; c.textBaseline = 'middle';
    let size = 54; c.font = 'bold ' + size + 'px system-ui, Arial, sans-serif';
    while (c.measureText(name).width > w - 50 && size > 22) { size -= 3; c.font = 'bold ' + size + 'px system-ui, Arial, sans-serif'; }
    c.fillText(name, 34, h / 2 + 2);
  });
}
function signT() {
  return canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = '#1d5ea8'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#fff'; c.beginPath(); c.arc(w / 2, h / 2, 46, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#1d5ea8'; c.font = 'bold 74px system-ui, Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('T', w / 2, h / 2 + 4);
  });
}

export class Stops {
  constructor(scene, track, stops) {
    this.track = track; this.stops = stops; this.group = new THREE.Group(); this.people = [];
    this.items = stops.map(() => ({ group: new THREE.Group(), cone: null }));
    const tpost = lam(0x44505a), deck = lam(0xc9c5bb, { side: THREE.DoubleSide }), yellow = bas(0xffd21f), green = bas(0x5ee06a);
    const p = {};
    const place = (obj, s, lat, y, parent) => { this.track.at(s, p); const [rx, rz] = rightOf(p.yaw); obj.position.set(p.x + rx * lat, y, p.z + rz * lat); obj.rotation.y = -p.yaw; (parent || this.group).add(obj); return obj; };
    const signMat = new THREE.MeshBasicMaterial({ map: signT() });
    stops.forEach((st, k) => {
      const it = this.items[k]; const G = it.group; this.group.add(G);
      // platform: deck ribbon along the track (follows curves) + curb flank
      const s0 = st.s - 26, s1 = st.s + 6, step = 1, pos = [], nor = [], idx = [], cp = [], cn = [], ci = [];
      const rows = Math.ceil((s1 - s0) / step);
      for (let r = 0; r <= rows; r++) {
        this.track.at(s0 + r * step, p); const [rx, rz] = rightOf(p.yaw);
        for (const lat of [1.75, 4.9]) { pos.push(p.x + rx * lat, 0.24, p.z + rz * lat); nor.push(0, 1, 0); }
        cp.push(p.x + rx * 1.75, 0.24, p.z + rz * 1.75, p.x + rx * 1.75, 0, p.z + rz * 1.75); cn.push(-rx, 0, -rz, -rx, 0, -rz);
        if (r) { const a = (r - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); const b = (r - 1) * 2; ci.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
      }
      const mk = (P, N, I, mat) => { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); geo.setIndex(I); const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; G.add(m); return m; };
      mk(pos, nor, idx, deck);
      mk(cp, cn, ci, new THREE.MeshLambertMaterial({ color: 0xaba79e, side: THREE.DoubleSide }));
      // yellow safety strip along the platform edge + the green "perfect" mark at the first-door position
      const edge = []; const en = [], ei = [];
      for (let r = 0; r <= rows; r++) { this.track.at(s0 + r * step, p); const [rx, rz] = rightOf(p.yaw); for (const lat of [1.78, 2.05]) { edge.push(p.x + rx * lat, 0.245, p.z + rz * lat); en.push(0, 1, 0); } if (r) { const a = (r - 1) * 2; ei.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
      mk(edge, en, ei, yellow);
      const perfect = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.03, 0.9), green); place(perfect, st.s, 2.7, 0.255, G);
      // stop line across the track
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 3.1), yellow); place(line, st.s, 0, 0.125, G);
      // pole + T sign + name board at the first-door position, on the platform
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 3.8, 8), tpost); place(pole, st.s, 3.5, 2.14, G);
      const sg = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), signMat); sg.rotation.y = -Math.PI / 2; sg.position.y = 0; place(sg, st.s - 0.09, 3.5, 3.55, G); sg.rotation.y = -(this.track.at(st.s, p).yaw) - Math.PI / 2;
      const nb = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.7), new THREE.MeshBasicMaterial({ map: nameBoard(st.name) })); place(nb, st.s - 0.09, 3.5, 2.85, G); nb.rotation.y = -(this.track.at(st.s, p).yaw) - Math.PI / 2;
      // shelter (the engine's own prop) behind the platform
      const sh = new THREE.Mesh(PROP_DEFS.shelter.make(), new THREE.MeshLambertMaterial({ vertexColors: true })); place(sh, st.s - 12, 4.5, 0.24, G); sh.rotation.y = -(this.track.at(st.s - 12, p).yaw) + Math.PI; sh.castShadow = true;
      // 100 / 50 / 20 m countdown boards (left-hand side)
      if (!st.first) for (const n of [100, 50, 20]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), tpost); place(post, st.s - n, -2.45, 1.2, G);
        const bd = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.98), new THREE.MeshBasicMaterial({ map: numberBoard(n) })); place(bd, st.s - n - 0.06, -2.45, 2.5, G); bd.rotation.y = -(this.track.at(st.s - n, p).yaw) - Math.PI / 2;
      }
      // marker above the stop line: a bobbing yellow arrow + a thin beam, visible from far
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.8, 4), bas(0xffd21f)); cone.rotation.x = Math.PI; place(cone, st.s, 2.7, 8, G); it.cone = cone; cone.rotation.x = Math.PI; it.marks = [cone];
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 14, 5), new THREE.MeshBasicMaterial({ color: 0xffd21f, transparent: true, opacity: 0.55 })); place(beam, st.s, 2.7, 7, G); it.marks.push(beam);
    });
    scene.add(this.group);
  }
  /** `next` = index (in the run's stop list) of the stop to serve: only its arrow + beam are shown */
  update(time, next) { this.items.forEach((it, k) => { const on = k === next; for (const m of it.marks) m.visible = on; if (on) it.cone.position.y = 8 + Math.sin(time * 2.4) * 0.35; }); }
}

// ---- passengers --------------------------------------------------------------------------------------------------------------------------
export class Passengers {
  constructor(scene, track, stops) {
    this.track = track; this.stops = stops; this.scene = scene;
    this.mats = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.geos = [0, 1, 2, 3, 4, 5].map((i) => PROP_DEFS['person' + i].make());
    this.waiting = stops.map((st, k) => this._crowd(st, k));
    this.active = [];   // moving people: { m, x, z, tx, tz, speed, hideAt, fade }
    this.seed = 1; this.dwellT = 0; this.plan = null;
  }
  dispose() { for (const w of this.waiting) for (const m of w) this.scene.remove(m); for (const m of this.active) this.scene.remove(m); }
  _rnd() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }
  _person() { const m = new THREE.Mesh(this.geos[Math.floor(this._rnd() * 6)], this.mats); m.castShadow = true; m.scale.setScalar(0.95 + this._rnd() * 0.15); this.scene.add(m); return m; }
  _crowd(st) {
    const p = {}; const out = [];
    const n = st.first ? 0 : st.waitingAt;
    for (let i = 0; i < n; i++) {
      // waiting people cluster at the four door positions of the tram that will stop here (door i at st.s + TRAM.doors[i]), on the platform, facing the track
      const di = i % TRAM.doors.length, s = st.s + TRAM.doors[di] + (this._rnd() - 0.5) * 2.6, lat = 2.7 + this._rnd() * 0.9;
      this.track.at(s, p); const [rx, rz] = rightOf(p.yaw);
      const m = this._person(); m.position.set(p.x + rx * lat, 0.24, p.z + rz * lat); m.rotation.y = -p.yaw + Math.PI / 2 + (this._rnd() - 0.5) * 0.9;
      m.userData.stop = k_of(this, st); m.userData.di = di; m.userData.waiting = true;
      out.push(m);
    }
    return out;
  }
  /** doors opened at stop k with the tram standing with its first door at arc length s: boarders = the first `board` waiting people (nearest door first) */
  startDwell(k, s, alight, board, sch) {
    const w = this.waiting[k].slice().sort((a, b) => a.userData.di - b.userData.di);
    this.dwellK = k; this.dwellS = s; this.dwellT = 0; this.plan = { alight, board, boarders: w.slice(0, board), alighters: [], sch, shown: 0, skip: Math.max(1, Math.ceil(alight / 12)), live: 0 };
    this.stats = { alighted: 0, boarded: 0 };
  }
  /** doors closing: whoever has not boarded yet is hidden (they are aboard in the sim) */
  endDwell() { if (this.plan) for (const m of this.plan.boarders) if (!m.userData.go) { m.visible = false; m.userData.go = true; } this.plan = null; }
  update(dt, door, dwell) {
    const p = {};
    const pl = this.plan;
    if (pl && dwell && dwell.sch) {
      const t = dwell.t;
      // boarders: person j starts at bT(j), walks to the nearest door on the platform side at 1.4 m/s... (BWALK seconds), then disappears into the doorway
      pl.boarders.forEach((m, j) => {
        const ud = m.userData; if (ud.in || !m.visible) return;
        if (!ud.go) { if (t < pl.sch.bT(j) || door < 0.95) return; ud.go = true; ud.door = this.dwellS + TRAM.doors[ud.di]; ud.t0 = t; ud.fx = m.position.x; ud.fz = m.position.z; }
        this.track.at(ud.door, p); const [rx, rz] = rightOf(p.yaw);
        const tx = p.x + rx * 1.05, tz = p.z + rz * 1.05, f = Math.min(1, (t - ud.t0) / BWALK);
        m.position.x = ud.fx + (tx - ud.fx) * f; m.position.z = ud.fz + (tz - ud.fz) * f; m.position.y = 0.24 - 0.0 * f;
        m.rotation.y = Math.atan2(-(tz - ud.fz), tx - ud.fx);
        if (f > 0.82) m.scale.setScalar(Math.max(0.001, (1 - f) / 0.18 * 0.98));
        if (f >= 1) { m.visible = false; ud.in = true; this.stats.boarded++; }
      });
      // alighters (one figure per person up to ~12): step out of a door and walk off along the platform
      while (pl.live < dwell.alight && t >= pl.sch.alT(pl.live) && door > 0.9) {
        const i = pl.live++; if (i % pl.skip) continue;
        const di = i % TRAM.doors.length; this.track.at(this.dwellS + TRAM.doors[di], p); const [rx, rz] = rightOf(p.yaw);
        const m = this._person(); m.position.set(p.x + rx * 1.1, 0.0, p.z + rz * 1.1);
        const away = (this._rnd() < 0.5 ? -1 : 1) * (4 + this._rnd() * 8); this.track.at(this.dwellS + TRAM.doors[di] + away, p); const [qx, qz] = rightOf(p.yaw);
        m.userData.tx = p.x + qx * (4.0 + this._rnd() * 1.0); m.userData.tz = p.z + qz * (4.0 + this._rnd() * 1.0); m.userData.life = 12; m.userData.out = true;
        this.active.push(m); pl.alighters.push(m); this.stats.alighted++;
      }
    }
    for (let i = this.active.length - 1; i >= 0; i--) {
      const m = this.active[i], ud = m.userData;
      const dx = ud.tx - m.position.x, dz = ud.tz - m.position.z, l = Math.hypot(dx, dz);
      if (l > 0.2) { const sp = 1.4 * dt; m.position.x += dx / l * sp; m.position.z += dz / l * sp; m.rotation.y = Math.atan2(-dz, dx); m.position.y = Math.min(0.24, m.position.y + dt * 0.5); }
      ud.life -= dt;
      if (ud.life < 1) m.scale.setScalar(Math.max(0.001, ud.life));
      if (ud.life <= 0) { this.scene.remove(m); this.active.splice(i, 1); }
    }
  }
  /** show only the crowds near the tram */
  cull(sTram) { this.stops.forEach((st, k) => { const near = Math.abs(st.s - sTram) < 400; for (const m of this.waiting[k]) if (m.userData.go) { /* boarded or boarding: not culled */ } else m.visible = near; }); }
}


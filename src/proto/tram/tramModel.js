// The tram of the tram game: an articulated 3-section low-floor tram built here from boxes / extrusions (the engine's PROP_DEFS.tram is not used).
//   * 10 rigid modules of 2.52 m (a section is 2-4 of them), each a chord between two points of the track -> in the tightest curve a module's middle sits <= 0.12 m off the
//     centre line, i.e. the body bends round the curve instead of sagging; bellows (dark) cover the joints between the 3 sections;
//   * 4 bogies (front, two under the section joints, rear) placed ON the track point with the track's own heading -> they stay exactly on the rails;
//   * visible sliding doors on BOTH sides (the platform side opens), side windows with a lit-interior hint, pantograph, head / tail lights, destination boards;
//   * blue-and-white livery of the city's low-floor trams, NO operator logos or names.
// Local frame of a group: +x forward, +y up, +z to the RIGHT of the direction of travel (the platform side).
import * as THREE from 'three';
import { TRAM } from './sim.js';

const BLUE = 0x1d5ea8, WHITE = 0xf1f4f6, DARK = 0x24303b, ROOF = 0xc3ccd3, AMBER = 0xffb21a, GREY = 0x3b444d;
export const MODULE = 2.52, NMOD = 10;
const HALF_W = 1.2, GLASS_Y0 = 1.02, GLASS_H = 1.38;
// where the sections are joined (module boundaries 3 and 5) and where the bogies are (metres behind the nose)
const BOGIES = [2.3, 10.08, 15.12, 22.9];
const DOOR_FROM_NOSE = TRAM.doors.map((d) => TRAM.nose - d);   // metres behind the nose; each door sits in the middle of a module

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
/** merged non-indexed geometry from [{ geo, color, x, y, z }] (vertex colours) */
function merge(parts) {
  const P = [], N = [], C = [], col = new THREE.Color();
  for (const p of parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    if (p.rx) g.rotateX(p.rx); if (p.ry) g.rotateY(p.ry); if (p.rz) g.rotateZ(p.rz);
    g.translate(p.x || 0, p.y || 0, p.z || 0);
    col.set(p.color);
    const pos = g.attributes.position, nor = g.attributes.normal;
    for (let i = 0; i < pos.count; i++) { P.push(pos.getX(i), pos.getY(i), pos.getZ(i)); N.push(nor.getX(i), nor.getY(i), nor.getZ(i)); C.push(col.r, col.g, col.b); }
    g.dispose();
  }
  const o = new THREE.BufferGeometry();
  o.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); o.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); o.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  return o;
}
const bx = (w, h, d, color, x, y, z, o = {}) => ({ geo: new THREE.BoxGeometry(w, h, d), color, x, y, z, ...o });
/** side silhouette (x forward, y up) extruded across the width (z in [-w/2, w/2]) */
function prism(points, w, color, x = 0, y = 0, z = 0) {
  const sh = new THREE.Shape(points.map(([a, b]) => new THREE.Vector2(a, b)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false }); g.translate(0, 0, -w / 2);
  return { geo: g, color, x, y, z };
}

let TEX = null;
function textures() {
  if (TEX) return TEX;
  const win = (lit) => canvasTex(256, 96, (c, w, h) => {
    // two panes with white pillars; interior hint: ceiling strip, seat backs, standing heads
    c.fillStyle = '#e9eef1'; c.fillRect(0, 0, w, h);
    const panes = [[8, 120], [136, 120]];
    for (const [x0, pw] of panes) {
      const g = c.createLinearGradient(0, 0, 0, h);
      if (lit) { g.addColorStop(0, '#fff2cf'); g.addColorStop(1, '#e8c47c'); } else { g.addColorStop(0, '#41566a'); g.addColorStop(1, '#1d2a36'); }
      c.fillStyle = g; c.fillRect(x0, 8, pw, h - 16);
      c.fillStyle = lit ? 'rgba(150,100,40,.55)' : 'rgba(10,20,30,.55)';
      for (let k = 0; k < 4; k++) { c.fillRect(x0 + 10 + k * 28, h - 36, 20, 22); }                     // seat backs
      c.beginPath(); for (let k = 0; k < 3; k++) { const px = x0 + 22 + k * 36 + ((x0 * 7 + k * 13) % 9); c.arc(px, 34 + (k % 2) * 6, 8, 0, 7); c.rect(px - 7, 42 + (k % 2) * 6, 14, 28); } c.fill();   // standing passengers
      c.fillStyle = 'rgba(255,255,255,.14)'; c.beginPath(); c.moveTo(x0, 8); c.lineTo(x0 + pw * 0.55, 8); c.lineTo(x0 + pw * 0.25, h - 8); c.lineTo(x0, h - 8); c.fill();   // sky reflection
    }
  });
  TEX = { day: win(false), night: win(true) };
  return TEX;
}
function destTex(line, dest) {
  return canvasTex(256, 64, (c, w, h) => {
    c.fillStyle = '#0c0c0c'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#ffb21a'; c.font = 'bold 42px ui-monospace, Menlo, Consolas, monospace'; c.textBaseline = 'middle';
    const L = line || ''; c.fillText(L, 10, h / 2 + 2);
    c.font = 'bold ' + (dest.length > 13 ? 21 : 29) + 'px ui-monospace, Menlo, Consolas, monospace';
    c.fillText(dest.toUpperCase(), L ? 22 + 26 * L.length : 12, h / 2 + 2);
  });
}
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const T = textures();
  SHARED = {
    body: new THREE.MeshLambertMaterial({ vertexColors: true }),
    glass: new THREE.MeshBasicMaterial({ map: T.day, side: THREE.FrontSide }),
    leaf: new THREE.MeshLambertMaterial({ color: 0x2a5a8f }),
    leafGlass: new THREE.MeshBasicMaterial({ color: 0x36485a }),
    open: new THREE.MeshBasicMaterial({ color: 0xcfa86a }),
    dark: new THREE.MeshLambertMaterial({ color: GREY }),
    metal: new THREE.MeshLambertMaterial({ color: 0x2a2f34 }),
    headOn: new THREE.MeshBasicMaterial({ color: 0xfff3cf }), tailOn: new THREE.MeshBasicMaterial({ color: 0xd9392b }),
    beam: new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    wheel: new THREE.MeshLambertMaterial({ color: 0x8a949c }),
  };
  return SHARED;
}

function moduleGeometry(k) {
  const L = MODULE, h = L / 2, front = k === 0, rear = k === NMOD - 1;
  const parts = [];
  // lower skirt (blue) and upper body (white): side profiles, the cabs have a raked nose
  const lowerPts = front ? [[-h, 0.42], [h - 0.15, 0.42], [h, 0.6], [h, 1.05], [-h, 1.05]] : rear ? [[h, 0.42], [-h + 0.15, 0.42], [-h, 0.6], [-h, 1.05], [h, 1.05]] : [[-h, 0.42], [h, 0.42], [h, 1.05], [-h, 1.05]];
  parts.push(prism(lowerPts, 2.4, BLUE));
  const upper = front ? [[-h, 1.05], [h, 1.05], [h, 1.95], [h - 0.55, 2.9], [h - 0.6, 3.0], [-h, 3.0]] : rear ? [[h, 1.05], [-h, 1.05], [-h, 1.95], [-h + 0.55, 2.9], [-h + 0.6, 3.0], [h, 3.0]] : [[-h, 1.05], [h, 1.05], [h, 3.0], [-h, 3.0]];
  parts.push(prism(upper, 2.36, WHITE));
  parts.push(prism(front ? [[-h, 3.0], [h - 0.6, 3.0], [h - 0.7, 3.12], [-h, 3.12]] : rear ? [[h, 3.0], [-h + 0.6, 3.0], [-h + 0.7, 3.12], [h, 3.12]] : [[-h, 3.0], [h, 3.0], [h, 3.12], [-h, 3.12]], 2.0, ROOF));   // roof cap
  parts.push(bx(L, 0.07, 2.42, AMBER, 0, 1.06, 0));                                  // amber beltline
  parts.push(bx(L, 0.5, 2.0, DARK, 0, 0.3, 0));                                      // underframe
  if (front || rear) {   // dark windscreen on the raked nose + lights panel
    const sx = front ? 1 : -1;
    parts.push({ geo: new THREE.BoxGeometry(0.08, 1.05, 2.08), color: 0x1c2a36, x: sx * (h - 0.28), y: 2.42, z: 0, rz: -sx * 0.5 });
    parts.push(bx(0.06, 0.5, 2.3, DARK, sx * (h + 0.0), 0.8, 0));
  }
  return merge(parts);
}
function bellowsGeometry() { return merge([bx(0.62, 2.3, 2.2, 0x2b3239, 0, 1.75, 0), bx(0.62, 0.12, 2.3, 0x1c2227, 0, 3.0, 0), bx(0.62, 0.12, 2.3, 0x1c2227, 0, 0.62, 0)]); }
function bogieGeometry() {
  const parts = [bx(2.9, 0.2, 1.7, 0x2a2f34, 0, 0.55, 0), bx(0.3, 0.3, 2.1, 0x3b444d, 0, 0.62, 0)];
  for (const x of [-0.95, 0.95]) for (const z of [-0.76, 0.76]) {
    parts.push({ geo: new THREE.CylinderGeometry(0.34, 0.34, 0.14, 14), color: 0x8a949c, x, y: 0.34, z, rx: Math.PI / 2 });
    parts.push({ geo: new THREE.CylinderGeometry(0.2, 0.2, 0.16, 8), color: 0x4c555d, x, y: 0.34, z: z + Math.sign(z) * 0.02, rx: Math.PI / 2 });
  }
  return merge(parts);
}
function pantographGeometry() {
  const a = Math.atan2(0.9, 2.25);
  return merge([
    bx(1.5, 0.12, 1.5, 0x2a2f34, 0, 3.18, 0),
    { geo: new THREE.BoxGeometry(2.45, 0.06, 0.07), color: 0x40484f, x: -0.45, y: 4.3, z: 0.4, rz: a }, { geo: new THREE.BoxGeometry(2.45, 0.06, 0.07), color: 0x40484f, x: -0.45, y: 4.3, z: -0.4, rz: a },
    { geo: new THREE.BoxGeometry(2.45, 0.06, 0.07), color: 0x40484f, x: 0.45, y: 4.3, z: 0.4, rz: -a }, { geo: new THREE.BoxGeometry(2.45, 0.06, 0.07), color: 0x40484f, x: 0.45, y: 4.3, z: -0.4, rz: -a },
    bx(0.12, 0.08, 1.9, 0x1c2227, 0, 5.46, 0),                                            // the contact strip touches the wire at 5.5 m
    bx(0.5, 0.05, 0.05, 0x40484f, 0, 5.4, 0.8), bx(0.5, 0.05, 0.05, 0x40484f, 0, 5.4, -0.8),
  ]);
}

export class TramModel {
  constructor(scene, { line = '', dest = '', parent } = {}) {
    const M = shared();
    this.group = new THREE.Group();
    this.modules = []; this.bogies = []; this.leaves = [];
    const gBody = []; for (let k = 0; k < NMOD; k++) gBody.push(moduleGeometry(k));
    const glassPlane = new THREE.PlaneGeometry(MODULE - 0.1, GLASS_H);
    for (let k = 0; k < NMOD; k++) {
      const g = new THREE.Group();
      const m = new THREE.Mesh(gBody[k], M.body); m.castShadow = true; g.add(m);
      for (const side of [1, -1]) { const p = new THREE.Mesh(glassPlane, M.glass); p.position.set(0, GLASS_Y0 + GLASS_H / 2, side * (HALF_W + 0.006)); p.rotation.y = side > 0 ? 0 : Math.PI; g.add(p); }
      this.group.add(g); this.modules.push(g);
    }
    // doors: 2 leaves + a lit opening behind them, per side, centred on DOOR_FROM_NOSE (module-local x = distance from the module's middle)
    this.doors = [];
    DOOR_FROM_NOSE.forEach((dn, di) => {
      const k = Math.min(NMOD - 1, Math.floor(dn / MODULE));   // module whose span contains the door; module-local x (forward +) = middle of the module minus the door's distance
      for (const side of [1, -1]) {
        const grp = new THREE.Group(); grp.position.set((k + 0.5) * MODULE - dn, 0, side * (HALF_W + 0.02)); this.modules[k].add(grp);
        const open = new THREE.Mesh(new THREE.PlaneGeometry(1.45, 1.98), M.open); open.position.set(0, 1.6, side * 0.005); open.rotation.y = side > 0 ? 0 : Math.PI; grp.add(open);
        const la = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.98, 0.07), M.leaf), lb = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.98, 0.07), M.leaf);
        la.position.set(-0.37, 1.6, side * 0.045); lb.position.set(0.37, 1.6, side * 0.045); grp.add(la, lb);
        for (const l of [la, lb]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.05), M.leafGlass); w.position.set(0, 0.28, side * 0.037); w.rotation.y = side > 0 ? 0 : Math.PI; l.add(w); }
        const step = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.12), M.dark); step.position.set(0, 0.62, side * 0.02); grp.add(step);
        this.doors.push({ side, k, grp, la, lb, open, di });
      }
    });
    // bellows over the two section joints (between modules 3|4 and 5|6): attached to the rear edge of modules 3 and 5
    for (const k of [3, 5]) { const b = new THREE.Mesh(bellowsGeometry(), M.body); b.position.x = -MODULE / 2; this.modules[k].add(b); }
    // bogies
    const bg = bogieGeometry();
    for (let i = 0; i < BOGIES.length; i++) { const m = new THREE.Mesh(bg, M.body); m.castShadow = true; const g = new THREE.Group(); g.add(m); this.group.add(g); this.bogies.push(g); }
    // pantograph on the middle section
    this.pantograph = new THREE.Mesh(pantographGeometry(), M.body); this.pantograph.position.set(0.0, 0, 0); this.modules[4].add(this.pantograph);
    // lights
    this.lights = new THREE.Group();
    for (const z of [-0.85, 0.85]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.36), M.headOn); h.position.set(MODULE / 2 + 0.03, 0.82, z); this.modules[0].add(h);
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.3), M.tailOn); t.position.set(-MODULE / 2 - 0.03, 0.82, z); this.modules[NMOD - 1].add(t);
    }
    this.beams = [];
    const beamTex = canvasTex(64, 128, (c, w, h) => { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,240,190,0.85)'); g.addColorStop(1, 'rgba(255,240,190,0)'); c.fillStyle = g; c.beginPath(); c.moveTo(w * 0.42, 0); c.lineTo(w * 0.58, 0); c.lineTo(w, h); c.lineTo(0, h); c.fill(); });
    for (const z of [-0.85, 0.85]) {
      const bm = new THREE.Mesh(new THREE.PlaneGeometry(5, 26), new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.0, side: THREE.DoubleSide }));
      bm.rotation.x = -Math.PI / 2; bm.rotation.z = Math.PI / 2; bm.position.set(MODULE / 2 + 13.2, 0.35, z * 1.5); this.modules[0].add(bm); this.beams.push(bm);
    }
    // destination boards (front over the windscreen, a short one behind each cab, side board next to the first door)
    this.boardMat = new THREE.MeshBasicMaterial({ map: destTex(line, dest) });
    this.boardFront = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.42), this.boardMat); this.boardFront.rotation.y = Math.PI / 2; this.boardFront.position.set(MODULE / 2 - 0.46, 2.95, 0); this.modules[0].add(this.boardFront);
    this.boardRearMat = new THREE.MeshBasicMaterial({ map: destTex(line, '') });
    this.boardRear = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.4), this.boardRearMat); this.boardRear.rotation.y = -Math.PI / 2; this.boardRear.position.set(-MODULE / 2 + 0.46, 2.95, 0); this.modules[NMOD - 1].add(this.boardRear);
    this.boardSide = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.34), this.boardMat); this.boardSide.position.set(MODULE / 2 - 1.1, 2.55, HALF_W + 0.012); this.modules[0].add(this.boardSide);
    (parent || scene).add(this.group);
    this._p = []; for (let i = 0; i <= NMOD; i++) this._p.push({}); this._q = {};
    this.night = false; this.nodes = [];
  }
  setDestination(line, dest) {
    for (const [mat, d] of [[this.boardMat, dest], [this.boardRearMat, '']]) { const old = mat.map; mat.map = destTex(line, d); mat.needsUpdate = true; if (old) old.dispose(); }
  }
  setNight(on) {
    this.night = on; const T = textures(), M = shared();
    M.glass.map = on ? T.night : T.day; M.glass.needsUpdate = true;
    for (const b of this.beams) b.material.opacity = on ? 0.55 : 0;
  }
  /** doorS = arc length of the first door; door = 0..1 opening of the platform-side doors (side +1 right / -1 left) */
  place(track, doorS, door, side = 1) {
    const nose = doorS + TRAM.nose, P = this._p;
    for (let k = 0; k <= NMOD; k++) track.at(nose - k * MODULE, P[k]);
    for (let k = 0; k < NMOD; k++) {
      const a = P[k], b = P[k + 1], g = this.modules[k];
      g.position.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
      g.rotation.y = Math.atan2(-(a.z - b.z), a.x - b.x);
    }
    for (let i = 0; i < BOGIES.length; i++) { track.at(nose - BOGIES[i], this._q); const g = this.bogies[i]; g.position.set(this._q.x, 0, this._q.z); g.rotation.y = -this._q.yaw; }
    const o = door * 0.66;
    for (const d of this.doors) { const op = d.side === side ? o : 0; d.la.position.x = -0.37 - op; d.lb.position.x = 0.37 + op; d.open.visible = op > 0.02; }
  }
  /** for tests: lateral distance of every bogie and of every module's middle from the route's centre line, and the doors' open side */
  measure(track) {
    const bog = this.bogies.map((g) => track.nearest(g.position.x, g.position.z).d);
    const sag = this.modules.map((g) => track.nearest(g.position.x, g.position.z).d);
    return { bogies: bog, sag };
  }
  setVisible(v) { this.group.visible = v; }
  dispose() { this.group.parent && this.group.parent.remove(this.group); }
}

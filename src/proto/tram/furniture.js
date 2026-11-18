// Railway furniture along the track: overhead contact wire + catenary + poles (every ~35 m, skipped where a pole would stand inside a building or on another
// track), signal heads (block signals and road-crossing signals), speed boards in front of restriction zones.
import * as THREE from 'three';

const rightOf = (yaw) => [-Math.sin(yaw), Math.cos(yaw)];
const WIRE_Y = 5.5;
function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }

/** contact wire (zig-zag +-0.18 m over each span) + messenger wire (sags between poles) + poles with arms. Returns { group, poles: n } */
export function buildWires(scene, track, world, { span = 35, others = [] } = {}) {
  const g = new THREE.Group(); const p = {};
  const free = (x, z) => !(world && world.blockers && world.blockers.inBuilding(x, z, 0.5)) && !track.project(x, z, 2.5) && !others.some((t) => t.project(x, z, 2.5));
  // poles
  const poleList = [];
  const flat = (s) => Math.abs(track.curvature(s)) < 0.02;
  for (let s = 12; s < track.length - 8; s += span) {
    let s2 = s; if (!flat(s2) && flat(s2 + 8)) s2 += 8;   // in a curve a span shortens (poles every ~20 m) -- just keep the spacing, shifted a little
    track.at(s2, p); const [rx, rz] = rightOf(p.yaw);
    let placed = false;
    for (const lat of [4.3, -4.3, 5.6, -5.6]) { const x = p.x + rx * lat, z = p.z + rz * lat; if (free(x, z)) { poleList.push({ s: s2, x, z, lat, yaw: p.yaw }); placed = true; break; } }
    if (!placed) poleList.push({ s: s2, x: null });
  }
  const real = poleList.filter((q) => q.x !== null);
  const poleG = new THREE.CylinderGeometry(0.09, 0.13, 7.4, 6); poleG.translate(0, 3.7, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0x5b6670 });
  const poles = new THREE.InstancedMesh(poleG, mat, Math.max(1, real.length)); poles.count = real.length;
  const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.1, 0.1), mat, Math.max(1, real.length)); arms.count = real.length;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(1, 1, 1);
  real.forEach((r, i) => {
    q.setFromAxisAngle(up, 0); m4.compose(new THREE.Vector3(r.x, 0, r.z), q, sc); poles.setMatrixAt(i, m4);
    // arm: from the pole top to the wire, perpendicular to the track
    const len = Math.abs(r.lat) - 0.2; track.at(r.s, p); const [rx, rz] = rightOf(p.yaw);
    const mx = r.x - rx * Math.sign(r.lat) * len / 2, mz = r.z - rz * Math.sign(r.lat) * len / 2;
    q.setFromAxisAngle(up, -(p.yaw + Math.PI / 2)); m4.compose(new THREE.Vector3(mx, 6.7, mz), q, new THREE.Vector3(len, 1, 1)); arms.setMatrixAt(i, m4);
  });
  poles.instanceMatrix.needsUpdate = true; arms.instanceMatrix.needsUpdate = true; poles.frustumCulled = false; arms.frustumCulled = false; poles.castShadow = false;
  g.add(poles, arms);
  // wires: horizontal + vertical thin ribbons so they read from above and from the side
  const pos = [], idx = [];
  const ribbon = (offFn, yFn, w, vertical) => {
    const n = Math.floor(track.length / 2.5); const base = pos.length / 3;
    for (let i = 0; i <= n; i++) {
      const s = Math.min(track.length, i * 2.5); track.at(s, p); const [rx, rz] = rightOf(p.yaw), o = offFn(s), y = yFn(s);
      const x = p.x + rx * o, z = p.z + rz * o;
      if (vertical) pos.push(x, y - w, z, x, y + w, z); else pos.push(x - rx * w, y, z - rz * w, x + rx * w, y, z + rz * w);
      if (i) { const a = base + (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
  };
  const zig = (s) => 0.18 * (Math.abs(((s / span) % 2 + 2) % 2 - 1) * 2 - 1);
  ribbon(zig, () => WIRE_Y, 0.025, false); ribbon(zig, () => WIRE_Y, 0.025, true);
  const sag = (s) => { const t = ((s / span) % 1 + 1) % 1; return 6.25 - 0.55 * 4 * t * (1 - t); };
  ribbon(() => 0, sag, 0.02, false); ribbon(() => 0, sag, 0.02, true);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
  const wire = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x2e3338, side: THREE.DoubleSide })); wire.frustumCulled = false; g.add(wire);
  scene.add(g);
  return { group: g, poles: real.length, skipped: poleList.length - real.length };
}

// ---- signals ---------------------------------------------------------------------------------------------------------------------------
const LAMP = { r: 0xff2d1f, y: 0xffc21a, g: 0x38e060 }, DIM = { r: 0x3a0c08, y: 0x3a2c06, g: 0x0a2a12 };
export class SignalHeads {
  constructor(scene, track, signals) {
    this.signals = signals; this.group = new THREE.Group(); this.items = [];
    const pole = new THREE.MeshLambertMaterial({ color: 0x3b444d }), head = new THREE.MeshLambertMaterial({ color: 0x14181c });
    const lampG = new THREE.CircleGeometry(0.13, 12), p = {};
    const stripe = new THREE.MeshBasicMaterial({ color: 0xf2f2f2 });
    signals.forEach((sg) => {
      const G = new THREE.Group(); track.at(sg.s, p); const [rx, rz] = rightOf(p.yaw);
      const lat = sg.kind === 'road' ? 3.3 : 2.75;
      G.position.set(p.x + rx * lat, 0, p.z + rz * lat); G.rotation.y = -p.yaw;
      const pl = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 3.1, 6), pole); pl.position.y = 1.55; G.add(pl);
      const hd = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.0, 0.34), head); hd.position.set(0, 3.25, 0); G.add(hd);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.3, 0.62), new THREE.MeshLambertMaterial({ color: sg.kind === 'road' ? 0xf1f4f6 : 0xffd21f })); back.position.set(-0.02, 3.25, 0); G.add(back);
      const lamps = {};
      [['r', 3.55], ['y', 3.25], ['g', 2.95]].forEach(([k, y]) => { const m = new THREE.Mesh(lampG, new THREE.MeshBasicMaterial({ color: DIM[k] })); m.position.set(-0.15, y, 0); m.rotation.y = -Math.PI / 2; G.add(m); lamps[k] = m; });
      this.group.add(G);
      // stop line across the track
      track.at(sg.s, p); const ln = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 3.0), stripe); ln.position.set(p.x, 0.13, p.z); ln.rotation.y = -p.yaw; this.group.add(ln);
      this.items.push({ sg, lamps, last: '' });
    });
    scene.add(this.group);
  }
  update() { for (const it of this.items) { const a = it.sg.aspect; if (a === it.last) continue; it.last = a; for (const k of ['r', 'y', 'g']) it.lamps[k].material.color.setHex(k === a ? LAMP[k] : DIM[k]); } }
  dispose(scene) { scene.remove(this.group); }
}

// ---- speed boards -------------------------------------------------------------------------------------------------------------------------
const spTex = {};
function speedTex(kmh) {
  return spTex[kmh] || (spTex[kmh] = canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = '#fff'; c.beginPath(); c.arc(w / 2, h / 2, 60, 0, 7); c.fill();
    c.strokeStyle = '#d23a2f'; c.lineWidth = 14; c.beginPath(); c.arc(w / 2, h / 2, 53, 0, 7); c.stroke();
    c.fillStyle = '#111'; c.font = 'bold 54px system-ui, Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(kmh), w / 2, h / 2 + 3);
  }));
}
/** a round limit board 55 m before every restriction zone (left of the track so it never stands on a platform) -> returns the boards for tests / HUD */
export function buildSpeedBoards(scene, track) {
  const g = new THREE.Group(), p = {}, out = [];
  const pole = new THREE.MeshLambertMaterial({ color: 0x4a545d });
  for (const z of track.zones) {
    const kmh = Math.max(10, Math.round(z.v * 3.6 / 5) * 5), s = Math.max(5, z.s0 - 55);
    track.at(s, p); const [rx, rz] = rightOf(p.yaw);
    const G = new THREE.Group(); G.position.set(p.x - rx * 2.75, 0, p.z - rz * 2.75); G.rotation.y = -p.yaw;
    const pl = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.6, 6), pole); pl.position.y = 1.3; G.add(pl);
    const bd = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), new THREE.MeshBasicMaterial({ map: speedTex(kmh) })); bd.position.set(0, 2.7, 0); bd.rotation.y = -Math.PI / 2; G.add(bd);
    g.add(G); out.push({ s, kmh });
  }
  scene.add(g);
  return { group: g, boards: out };
}

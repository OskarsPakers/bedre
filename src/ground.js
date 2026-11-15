// Ground: city map painted into canvas tiles, one plane per tile, all sharing one patched material type.
import * as THREE from 'three';
import { CFG } from './config.js';
import { patchGroundMaterial, holeUniforms } from './holeView.js';
import { cleanRing, bbox, pointInPoly } from './geo.js';
import { zoneOf } from './buildings.js';

const ROAD_ORDER = ['service', 'residential', 'tertiary', 'secondary', 'primary', 'motorway'];

function path(ctx, p, close) {
  ctx.beginPath();
  ctx.moveTo(p[0][0], p[0][1]);
  for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]);
  if (close) ctx.closePath();
}

const BRIDGE_KINDS = new Set(['primary', 'secondary', 'tertiary', 'residential', 'service', 'footway', 'pedestrian', 'rail']);

/** Road/rail stretches over large water polygons (+ abutments), cached on data. Drawn as bridge decks after all roads. */
export function findBridges(data) {
  if (data._bridges) return data._bridges;
  const waters = [];
  for (const w of data.water) {
    const r = w._r || (w._r = cleanRing(w.p));
    if (r.length < 3) continue;
    const b = bbox(r);
    if ((b.x1 - b.x0) * (b.z1 - b.z0) < 3000) continue;
    waters.push({ r, b });
  }
  const inW = (x, z) => {
    for (const w of waters) {
      if (x < w.b.x0 || x > w.b.x1 || z < w.b.z0 || z > w.b.z1) continue;
      if (pointInPoly(x, z, w.r)) return true;
    }
    return false;
  };
  const out = [];
  for (const rd of data.roads) {
    if (!rd.p || rd.p.length < 2 || !BRIDGE_KINDS.has(rd.k)) continue;
    // sample every ~3 m
    const pts = [];
    for (let i = 0; i < rd.p.length - 1; i++) {
      const [x0, z0] = rd.p[i], [x1, z1] = rd.p[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 3));
      for (let k = 0; k < n; k++) pts.push([x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n]);
    }
    pts.push(rd.p[rd.p.length - 1]);
    const wet = pts.map((q) => inW(q[0], q[1]));
    let i = 0;
    while (i < pts.length) {
      if (!wet[i]) { i++; continue; }
      let j = i;
      while (j + 1 < pts.length && wet[j + 1]) j++;
      if (j - i >= 3) out.push({ p: pts.slice(Math.max(0, i - 2), Math.min(pts.length, j + 3)), w: rd.w || (rd.k === 'footway' ? 2.5 : rd.k === 'rail' ? 4 : 7), k: rd.k });
      i = j + 1;
    }
  }
  data._bridges = out;
  return out;
}

function paintBridges(ctx, data, inTile) {
  const C = CFG.colors;
  ctx.lineCap = 'butt';
  const list = findBridges(data).filter((br) => inTile(br.p));
  const deck = (br) => (br.k === 'rail' ? '#6d6862' : br.k === 'footway' || br.k === 'pedestrian' ? '#efe6d2' : br.k === 'primary' || br.k === 'secondary' ? C.roadMajor : C.road);
  // pass 1: shadow on the water + dark outline
  for (const br of list) {
    path(ctx, br.p, false);
    ctx.strokeStyle = 'rgba(28,46,62,0.30)'; ctx.lineWidth = br.w + 7; ctx.stroke();
    ctx.strokeStyle = '#4f4b47'; ctx.lineWidth = br.w + 3.2; ctx.stroke();
  }
  // pass 2: join twin carriageways into one deck (fill the gap between near parallel bridges)
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const A = list[i], B = list[j];
    if (A.k === 'rail' || B.k === 'rail' || A.k === 'footway' || B.k === 'footway') {
      if (A.k !== B.k) continue;
    }
    for (let n = 0; n < A.p.length; n += 2) {
      const [ax, az] = A.p[n];
      let best = null, bd = 28;
      for (const q of B.p) { const d = Math.hypot(q[0] - ax, q[1] - az); if (d < bd) { bd = d; best = q; } }
      if (!best || bd < 1.5) continue;
      ctx.beginPath(); ctx.moveTo(ax, az); ctx.lineTo(best[0], best[1]);
      ctx.strokeStyle = '#4f4b47'; ctx.lineWidth = 3.4; ctx.stroke();
      ctx.strokeStyle = '#d6d0c2'; ctx.lineWidth = 2.6; ctx.stroke();
    }
  }
  // pass 3: parapet + deck + lane markings
  for (const br of list) {
    path(ctx, br.p, false);
    ctx.strokeStyle = '#d6d0c2'; ctx.lineWidth = br.w + 1.8; ctx.stroke();
    ctx.strokeStyle = deck(br); ctx.lineWidth = br.w; ctx.stroke();
    if (br.k === 'primary' || br.k === 'secondary') {
      ctx.strokeStyle = 'rgba(245,240,225,0.75)'; ctx.setLineDash([3, 4]); ctx.lineWidth = 0.28; ctx.stroke(); ctx.setLineDash([]);
    }
  }
  ctx.lineCap = 'round';
}

let _cobble = null;
function cobblePattern(ctx) {
  if (_cobble) return _cobble;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#8f8574'; g.fillRect(0, 0, 128, 128);
  const cols = ['#b9ad99', '#a99d8a', '#c6baa4', '#b3a58f', '#9f9482', '#c0b29b'];
  let n = 0;
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
    const ox = (j % 2) * 8 + (((i * 7 + j * 3) % 5) - 2), oy = ((i * 5 + j * 11) % 4) - 1.5;
    g.fillStyle = cols[(n++ * 5 + j) % cols.length];
    g.beginPath(); g.roundRect(i * 16 + ox + 1.2, j * 16 + oy + 1.2, 13.2, 13.2, 3.5); g.fill();
  }
  _cobble = ctx.createPattern(c, 'repeat');
  _cobble.setTransform(new DOMMatrix().scale(8 / 128));
  return _cobble;
}
const inOld = (p) => { const a = p[0], b = p[Math.floor(p.length / 2)]; return zoneOf(a[0], a[1]) === 'old' || zoneOf(b[0], b[1]) === 'old'; };
const COBBLE_KINDS = new Set(['service', 'residential', 'tertiary', 'pedestrian']);

function paintTile(ctx, data, view) {
  const C = CFG.colors;
  const { x0, z0, size, px } = view; // world origin of tile, size in metres, pixel size
  const sc = px / size;
  ctx.setTransform(sc, 0, 0, sc, -x0 * sc, -z0 * sc);
  const inTile = (p) => { // cheap bbox reject
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const q of p) { if (q[0] < a) a = q[0]; if (q[0] > c) c = q[0]; if (q[1] < b) b = q[1]; if (q[1] > d) d = q[1]; }
    return !(c < x0 - 20 || a > x0 + size + 20 || d < z0 - 20 || b > z0 + size + 20);
  };
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.fillStyle = C.paving;
  ctx.fillRect(x0 - 1, z0 - 1, size + 2, size + 2);
  // Old Town: cobblestone paving (ellipse matching buildings.zoneOf 'old')
  ctx.save();
  ctx.beginPath(); ctx.ellipse(-400, 260, 520, 380, 0, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = cobblePattern(ctx); ctx.fillRect(x0 - 1, z0 - 1, size + 2, size + 2);
  ctx.restore();

  // parks
  for (const pk of data.parks) {
    const r = pk._r || (pk._r = cleanRing(pk.p));
    if (r.length < 3 || !inTile(r)) continue;
    path(ctx, r, true);
    ctx.fillStyle = C.park; ctx.fill();
    ctx.lineWidth = 1.2; ctx.strokeStyle = C.parkDark; ctx.stroke();
  }
  // water
  for (const w of data.water) {
    const r = w._r || (w._r = cleanRing(w.p));
    if (r.length < 3 || !inTile(r)) continue;
    path(ctx, r, true);
    ctx.fillStyle = C.water; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = C.waterEdge; ctx.stroke();
    // quay edge
    ctx.lineWidth = 1.2; ctx.strokeStyle = '#cfc6b3'; ctx.stroke();
  }
  // piers / quay decks (cadastre structures over water), after water, before roads
  for (const pr of data.piers || []) {
    const r = pr._r || (pr._r = cleanRing(pr.p));
    if (r.length < 3 || !inTile(r)) continue;
    path(ctx, r, true);
    ctx.fillStyle = '#c3b9a4'; ctx.fill();
    ctx.lineWidth = 0.7; ctx.strokeStyle = '#6f675b'; ctx.stroke();
  }
  const roads = data.roads.filter((r) => r.p && r.p.length > 1 && inTile(r.p));
  const byKind = (k) => roads.filter((r) => r.k === k);
  const asphalt = [...ROAD_ORDER];
  // pavements under every vehicle road
  ctx.strokeStyle = C.walk;
  for (const k of asphalt) for (const r of byKind(k)) {
    path(ctx, r.p, false); ctx.lineWidth = (r.w || 6) + 3.4; ctx.stroke();
  }
  // asphalt
  for (const k of asphalt) {
    ctx.strokeStyle = (k === 'primary' || k === 'motorway' || k === 'secondary') ? C.roadMajor : C.road;
    for (const r of byKind(k)) { path(ctx, r.p, false); ctx.lineWidth = r.w || 6; ctx.stroke(); }
  }
  // cobbled streets in the Old Town
  for (const k of ['service', 'residential', 'tertiary', 'pedestrian']) for (const r of byKind(k)) {
    if (!COBBLE_KINDS.has(k) || !inOld(r.p)) continue;
    path(ctx, r.p, false); ctx.strokeStyle = cobblePattern(ctx); ctx.lineWidth = (r.w || (k === 'pedestrian' ? 5 : 6)) + 0.4; ctx.stroke();
  }
  // lane markings
  ctx.strokeStyle = 'rgba(245,240,225,0.75)';
  ctx.setLineDash([3, 4]);
  for (const k of ['primary', 'secondary', 'motorway']) for (const r of byKind(k)) {
    path(ctx, r.p, false); ctx.lineWidth = 0.28; ctx.stroke();
  }
  ctx.setLineDash([]);
  // pedestrian + footways
  for (const r of byKind('pedestrian')) {
    path(ctx, r.p, false); ctx.strokeStyle = '#cdbf9f'; ctx.lineWidth = (r.w || 5) + 1; ctx.stroke();
    ctx.strokeStyle = '#eadfc6'; ctx.lineWidth = r.w || 5; ctx.stroke();
  }
  for (const r of byKind('footway')) {
    path(ctx, r.p, false); ctx.strokeStyle = '#efe6d2'; ctx.lineWidth = Math.max(1.4, r.w || 2); ctx.stroke();
  }
  // rail
  for (const r of byKind('rail')) {
    path(ctx, r.p, false); ctx.strokeStyle = '#bdb4a2'; ctx.lineWidth = Math.max(3, r.w || 4); ctx.stroke();
    ctx.strokeStyle = C.rail; ctx.lineWidth = 0.35; ctx.setLineDash([]); ctx.stroke();
  }
  // tram tracks: sleeper bed + two thin rails (dark outer stroke, lighter inner stroke leaves two dark lines)
  for (const tw of data.tramways || []) {
    if (!tw.p || tw.p.length < 2 || !inTile(tw.p)) continue;
    path(ctx, tw.p, false);
    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#a49e94'; ctx.lineWidth = 2.6; ctx.stroke();
    ctx.strokeStyle = '#3f3c39'; ctx.lineWidth = 1.62; ctx.stroke();
    ctx.strokeStyle = '#b3ada3'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.lineCap = 'round';
  }
  paintBridges(ctx, data, inTile);
  // building footprints (what is left when a building is swallowed)
  ctx.fillStyle = C.footprint;
  for (const b of data.buildings) {
    const r = b._r || (b._r = cleanRing(b.p || []));
    if (r.length < 3 || !inTile(r)) continue;
    path(ctx, r, true); ctx.fill();
  }
}

export function createGround(data) {
  const { bounds } = data.meta;
  const m = CFG.ground.margin;
  const minX = bounds.minX - m, minZ = bounds.minZ - m;
  const size = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) + 2 * m;
  const T = CFG.ground.tiles;
  const tileSize = size / T;
  const px = CFG.ground.tile;
  const group = new THREE.Group();
  const maxAniso = 8;
  const planeGeo = new THREE.PlaneGeometry(tileSize, tileSize).rotateX(-Math.PI / 2);
  for (let i = 0; i < T; i++) {
    for (let j = 0; j < T; j++) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = px;
      const ctx = canvas.getContext('2d');
      paintTile(ctx, data, { x0: minX + i * tileSize, z0: minZ + j * tileSize, size: tileSize, px });
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = maxAniso;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      const mat = patchGroundMaterial(new THREE.MeshLambertMaterial({ map: tex }), { detailMap: true });
      const mesh = new THREE.Mesh(planeGeo, mat);
      mesh.position.set(minX + (i + 0.5) * tileSize, 0, minZ + (j + 0.5) * tileSize);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  // outer frame (no texture), same hole-patched shader family
  const big = 20000, hs = size / 2, cx = minX + hs, cz = minZ + hs;
  const shape = new THREE.Shape();
  shape.moveTo(-big, -big); shape.lineTo(big, -big); shape.lineTo(big, big); shape.lineTo(-big, big); shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-hs, -hs); hole.lineTo(-hs, hs); hole.lineTo(hs, hs); hole.lineTo(hs, -hs); hole.closePath();
  shape.holes.push(hole);
  const frameGeo = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
  const frameMat = patchGroundMaterial(new THREE.MeshLambertMaterial({ color: 0xcdbf9f, side: THREE.DoubleSide }), { detail: false });
  const frame = new THREE.Mesh(frameGeo, frameMat);
  frame.position.set(cx, 0, cz);
  frame.receiveShadow = true;
  group.add(frame);
  group.userData.extent = { minX, minZ, size };
  group.userData.detail = new DetailLayer(data);
  return group;
}

/**
 * Close-up detail layer: a 2048 px canvas covering a ~110 m window around the player, repainted from the same
 * map data at ~19 px/m (the 8192 px base map is only ~3 px/m). Blended over the base in the ground shader.
 */
export class DetailLayer {
  constructor(data) {
    this.data = data;
    this.size = 110;
    this.px = 2048;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = this.px;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    this.cx = NaN; this.cz = NaN;
    holeUniforms.uDetMap.value = this.tex;
  }

  /** Call every frame with focus and camera distance. */
  update(x, z, dist) {
    const on = dist < 85;
    const fade = on ? 1 - Math.max(0, (dist - 55) / 30) : 0;
    holeUniforms.uDetRect.value.w = fade;
    if (!on) return;
    if (this.cx === this.cx && Math.hypot(x - this.cx, z - this.cz) <= 22) return; // NaN = never painted
    this.cx = x; this.cz = z;
    const x0 = x - this.size / 2, z0 = z - this.size / 2;
    paintTile(this.ctx, this.data, { x0, z0, size: this.size, px: this.px });
    this.tex.needsUpdate = true;
    holeUniforms.uDetRect.value.set(x0, z0, this.size, fade);
  }
}

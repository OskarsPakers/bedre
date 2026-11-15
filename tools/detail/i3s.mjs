// I3S (ArcGIS Scene Layer, "meshpyramids" integrated mesh) client: layer discovery, node-page walk,
// geometry fetch + decode, all cached on disk under tools/.cache/detail/i3s/. Node built-ins only
// (Draco decoding is optional: `draco3d` from tools/detail/node_modules, only used with {draco:true}).
//
// Used ONLY as a measuring instrument: we never ship the mesh or its textures.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
export const CACHE = path.join(ROOT, 'tools', '.cache', 'detail');
const I3S_CACHE = path.join(CACHE, 'i3s');
const UA = 'riga-game-data-builder';
export const WEBSCENE_ITEM = '0f550060386a435da391357ccf89d269';
const SERVICES = 'https://tiles-eu1.arcgis.com/JzVauvrMa89dBJ9D/arcgis/rest/services';

// ---------------------------------------------------------------- projection (same as tools/build-data.mjs)
export const ORIGIN = { lat: 56.9515, lon: 24.1133 };
export const M_LAT = 111320;
export const M_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
const R = 6378137;
const D2R = Math.PI / 180;
export const mercX = (lon) => lon * D2R * R;
export const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2)) * R;
const MX0 = mercX(ORIGIN.lon);
/** web-mercator (x,y) -> game-local metres [x east, z south] */
export function mercToLocal(mx, my) {
  const lon = mx / R / D2R;
  const lat = (2 * Math.atan(Math.exp(my / R)) - Math.PI / 2) / D2R;
  return [(lon - ORIGIN.lon) * M_LON, -(lat - ORIGIN.lat) * M_LAT];
}
/** game-local metres -> web-mercator */
export function localToMerc(x, z) {
  const lon = ORIGIN.lon + x / M_LON;
  const lat = ORIGIN.lat - z / M_LAT;
  return [mercX(lon), mercY(lat)];
}
/** mercator stretch at the origin latitude (1 local metre = this many mercator units) */
export const MERC_K = 1 / Math.cos(ORIGIN.lat * D2R);

// ---------------------------------------------------------------- http (cached, polite)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let active = 0;
const waiters = [];
const MAX_CONC = 4;
async function slot() {
  if (active >= MAX_CONC) await new Promise((r) => waiters.push(r));
  active++;
}
function release() {
  active--;
  const w = waiters.shift();
  if (w) w();
}
export const netStats = { requests: 0, bytesWire: 0, bytesRaw: 0, cacheHits: 0, ms: 0 };

/** GET url -> Buffer (decompressed), cached at file `cacheFile`. Retries with backoff. */
export async function getCached(url, cacheFile, { allow404 = false } = {}) {
  if (fs.existsSync(cacheFile)) {
    netStats.cacheHits++;
    return fs.readFileSync(cacheFile);
  }
  let err;
  for (let i = 0; i < 5; i++) {
    await slot();
    const t0 = Date.now();
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip' }, signal: AbortSignal.timeout(60000) });
      if (res.status === 404 && allow404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      const buf = Buffer.from(await res.arrayBuffer()); // fetch() already gunzips
      netStats.requests++;
      netStats.bytesWire += Number(res.headers.get('content-length')) || buf.length; // wire size (gzip) when reported
      netStats.bytesRaw += buf.length;
      netStats.ms += Date.now() - t0;
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile + '.tmp', buf);
      fs.renameSync(cacheFile + '.tmp', cacheFile);
      return buf;
    } catch (e) {
      err = e;
      await sleep(1000 * 2 ** i);
    } finally {
      release();
    }
  }
  throw err;
}

// ---------------------------------------------------------------- layer discovery
/** Reads the web scene (cached) and returns [{name,title,url}] for every IntegratedMeshLayer. */
export async function discoverLayers() {
  const f = path.join(CACHE, 'webscene.json');
  const buf = await getCached(`https://www.arcgis.com/sharing/rest/content/items/${WEBSCENE_ITEM}/data?f=json`, f);
  const d = JSON.parse(buf.toString());
  const out = [];
  const walk = (l) => {
    for (const x of l.layers || []) {
      if (x.layerType === 'IntegratedMeshLayer') out.push({ title: x.title, url: x.url, name: x.url.split('/services/')[1].split('/')[0] });
      walk(x);
    }
  };
  d.operationalLayers.forEach(walk);
  return out;
}

function quatRotate(q, v) {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}
/** AABB (mercator xy + z) of an I3S OBB */
export function obbAabb(obb) {
  const [hx, hy, hz] = obb.halfSize;
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const p = quatRotate(obb.quaternion, [sx * hx, sy * hy, sz * hz]);
    for (let k = 0; k < 3; k++) {
      const v = obb.center[k] + p[k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

export class Layer {
  constructor({ name, url }) {
    this.name = name;
    this.url = url.replace(/\/$/, '');
    this.dir = path.join(I3S_CACHE, name);
    this.pages = new Map();
  }
  async init() {
    const buf = await getCached(this.url + '?f=json', path.join(this.dir, 'layer.json'));
    this.json = JSON.parse(buf.toString());
    const e = this.json.fullExtent;
    this.extent = e ? [e.xmin, e.ymin, e.xmax, e.ymax] : this.json.store.extent;
    this.perPage = this.json.nodePages.nodesPerPage;
    return this;
  }
  async page(n) {
    if (!this.pages.has(n)) {
      this.pages.set(n, getCached(`${this.url}/nodepages/${n}?f=json`, path.join(this.dir, 'pages', n + '.json')).then((b) => JSON.parse(b.toString())));
    }
    return this.pages.get(n);
  }
  async node(id) {
    const pg = await this.page(Math.floor(id / this.perPage));
    const n = pg.nodes[id % this.perPage];
    if (!n._aabb) n._aabb = obbAabb(n.obb);
    return n;
  }
  /**
   * Walk the node tree for a mercator bbox [xmin,ymin,xmax,ymax] down to the first level whose
   * estimated vertex spacing is <= `spacing` ground metres (or the leaves). Returns nodes with a mesh.
   * Node-switching LOD: a selected node replaces its parent, so we never take parent+child.
   */
  async select(bbox, spacing) {
    const out = [];
    const walk = async (id) => {
      const n = await this.node(id);
      const a = n._aabb;
      if (a.max[0] < bbox[0] || a.min[0] > bbox[2] || a.max[1] < bbox[1] || a.min[1] > bbox[3]) return;
      const kids = n.children || [];
      const sp = nodeSpacing(n);
      if (n.mesh && (sp <= spacing || !kids.length)) { out.push(n); return; }
      if (!kids.length) return;
      await Promise.all(kids.map(walk));
    };
    await walk(0);
    return out;
  }
  /** Fetches + parses the uncompressed geometry buffer of a node -> {n, pos(Float32 xyz relative to obb centre), uv, col} */
  async geometry(node, { draco = false } = {}) {
    const res = node.mesh.geometry.resource;
    const buf = await getCached(`${this.url}/nodes/${res}/geometries/${draco ? 1 : 0}`, path.join(this.dir, draco ? 'gd' : 'g', res + '.bin'));
    if (draco) return decodeDraco(buf);
    return parseUncompressed(buf, node.mesh.geometry.vertexCount, this.json.geometryDefinitions[node.mesh.geometry.definition || 0].geometryBuffers[0]);
  }
}

/** estimated mean vertex spacing in ground metres: sqrt(2 * horizontal OBB area / vertexCount) */
export function nodeSpacing(n) {
  const a = n._aabb || (n._aabb = obbAabb(n.obb));
  const vc = n.mesh ? n.mesh.geometry.vertexCount : 0;
  if (!vc) return Infinity;
  const areaM = ((a.max[0] - a.min[0]) * (a.max[1] - a.min[1])) / (MERC_K * MERC_K);
  // a mesh covers a surface ~1.3x its footprint; OBB AABB overestimates rotated boxes (~x1.5): keep simple
  return Math.sqrt((areaM * 0.6) / (vc / 2));
}

const TYPE_SIZE = { Float32: 4, UInt8: 1, UInt16: 2, UInt32: 4, Int16: 2, Float64: 8 };
/** Parse the uncompressed geometry buffer using the layer's geometryDefinitions[0].geometryBuffers[0] schema. */
export function parseUncompressed(buf, vcHint, def) {
  const vc = buf.readUInt32LE(0);
  if (vcHint && vc !== vcHint) throw new Error(`vertexCount mismatch ${vc} vs ${vcHint}`);
  const gb = def || { position: { type: 'Float32', component: 3 }, uv0: { type: 'Float32', component: 2 }, color: { type: 'UInt8', component: 4 } };
  const out = { n: vc };
  let off = 8;
  for (const key of ['position', 'normal', 'uv0', 'color']) {
    const a = gb[key];
    if (!a) continue;
    const len = vc * a.component;
    const bytes = len * TYPE_SIZE[a.type];
    const ab = buf.buffer.slice(buf.byteOffset + off, buf.byteOffset + off + bytes);
    const arr = a.type === 'Float32' ? new Float32Array(ab) : a.type === 'UInt8' ? new Uint8Array(ab) : a.type === 'UInt16' ? new Uint16Array(ab) : new Float32Array(ab);
    out[key === 'position' ? 'pos' : key === 'uv0' ? 'uv' : key === 'color' ? 'col' : key] = arr;
    off += bytes;
  }
  return out;
}

let dracoMod = null;
async function decodeDraco(buf) {
  if (!dracoMod) {
    const { createRequire } = await import('node:module');
    const req = createRequire(path.join(HERE, 'package.json'));
    dracoMod = await req('draco3d').createDecoderModule({});
  }
  const dec = new dracoMod.Decoder();
  const db = new dracoMod.DecoderBuffer();
  db.Init(new Int8Array(buf), buf.length);
  const mesh = new dracoMod.Mesh();
  const st = dec.DecodeBufferToMesh(db, mesh);
  if (!st.ok()) throw new Error('draco: ' + st.error_msg());
  const nv = mesh.num_points();
  const attr = dec.GetAttributeByUniqueId(mesh, 0) || dec.GetAttribute(mesh, 0);
  const arr = new dracoMod.DracoFloat32Array();
  dec.GetAttributeFloatForAllPoints(mesh, attr, arr);
  const pos = new Float32Array(nv * 3);
  for (let i = 0; i < pos.length; i++) pos[i] = arr.GetValue(i);
  const nf = mesh.num_faces();
  const ia = new dracoMod.DracoUInt32Array();
  dec.GetTrianglesUInt32Array(mesh, nf * 3 * 4, ia);
  const idx = new Uint32Array(nf * 3);
  for (let i = 0; i < idx.length; i++) idx[i] = ia.GetValue(i);
  dracoMod.destroy(mesh); dracoMod.destroy(dec); dracoMod.destroy(db); // (arr/ia are not destroyed: destroying DracoXArray corrupts the wasm heap in draco3d 1.5)
  return { n: nv, pos, idx };
}

/** open every layer whose extent intersects the mercator bbox */
export async function openLayers(bbox, only) {
  const all = await discoverLayers();
  const out = [];
  for (const l of all) {
    if (only && !only.includes(l.name)) continue;
    const L = await new Layer(l).init();
    const e = L.extent;
    if (!e || e.some((v) => v == null)) continue;
    if (e[2] < bbox[0] || e[0] > bbox[2] || e[3] < bbox[1] || e[1] > bbox[3]) continue;
    out.push(L);
  }
  return out;
}

/** world position (mercator x,y, z up) of vertex i of a node geometry */
export function vertexWorld(node, geo, i) {
  const c = node.obb.center;
  return [c[0] + geo.pos[i * 3], c[1] + geo.pos[i * 3 + 1], c[2] + geo.pos[i * 3 + 2]];
}

// ---------------------------------------------------------------- CLI: node-tree stats
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2] || 'layers';
  const half = 1200 * MERC_K;
  const [cx, cy] = localToMerc(0, 0);
  const bbox = [cx - half, cy - half, cx + half, cy + half];
  if (cmd === 'layers') {
    const ls = await openLayers(bbox);
    for (const L of ls) console.log(L.name.padEnd(34), L.json.store.version, 'z', L.json.fullExtent.zmin.toFixed(0), L.json.fullExtent.zmax.toFixed(0));
  } else if (cmd === 'stats') {
    const sp = Number(process.argv[3] || 0.5);
    const ls = await openLayers(bbox);
    for (const L of ls) {
      const nodes = await L.select(bbox, sp);
      let vc = 0;
      for (const n of nodes) vc += n.mesh.geometry.vertexCount;
      console.log(L.name.padEnd(34), 'nodes', nodes.length, 'vertices', vc, 'est uncompressed MB', ((vc * 24) / 1e6).toFixed(1));
    }
  }
}

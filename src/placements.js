// Placement file (public/data/<map>/riga-objects.bin.gz, format: worker/mp/table.js): the canonical list of every swallowable
// object of a map. Every client builds its props + movers FROM it (the procedural scatter is engine-dependent: it only runs in
// the generator, tools/mp/build-objects.mjs via ?placements=generate, and as a fallback when the file is missing), and the
// multiplayer handshake id is the hash of its bytes.
import { CFG } from './config.js';
import { mapPaths } from '../tools/maps.mjs';
import { parseTable, inflateIfGzip, encodeTable, F_MOVER, F_BUILDING, F_LANDMARK, MOVER_STRIDE } from '../worker/mp/table.js';
import { netSignature } from './traffic.js';

/* global __PLACEMENTS__ */
/** Build-time manifest { maps: { slug: { hash, objects, bytes } } } baked into the bundle by vite.config.js (the client code and the data it expects can never drift apart). */
export const MANIFEST = (typeof __PLACEMENTS__ !== 'undefined' && __PLACEMENTS__) || { maps: {} };
export const expectedHash = (slug) => (MANIFEST.maps[slug] && MANIFEST.maps[slug].hash) || null;
export const generateRequested = () => { try { return new URLSearchParams(location.search).get('placements') === 'generate'; } catch { return false; } };

export const placementsUrl = (slug) => {
  const h = expectedHash(slug);
  return mapPaths(slug).objects + (h ? `?v=${h}` : '');
};

/** Fetch + parse the placement file of the active map. Resolves null (and sets `reason`) on any problem: the game then falls back to the procedural scatter. */
export async function loadPlacements(slug) {
  const out = { table: null, reason: null };
  try {
    const res = await fetch(placementsUrl(slug));
    if (!res.ok) { out.reason = 'missing'; return out; }
    const bytes = await inflateIfGzip(await res.arrayBuffer());
    const t = parseTable(bytes);
    const want = expectedHash(slug);
    if (want && t.hash !== want) { out.reason = 'stale'; out.hash = t.hash; return out; } // a cached older file under the same URL: never use it
    out.table = t;
  } catch (e) {
    out.reason = 'bad:' + (e && e.message);
  }
  return out;
}

const KIND_FLAG = (o) => (o.mover ? F_MOVER : 0) | (o.isBuilding ? F_BUILDING : 0) | (o.landmark ? F_LANDMARK : 0);

/** GENERATOR ONLY (?placements=generate): dump the live procedural world as the placement file bytes. Props come from their placement `o.p` (initial state, not simulated). */
export function dumpPlacements(world, picker) {
  const objs = world.objects, kinds = [];
  const kindIdx = new Map();
  const ki = (k) => { let i = kindIdx.get(k); if (i == null) { i = kinds.length; kindIdx.set(k, i); kinds.push(k); } return i; };
  const maxFit = CFG.hole.startRadius * CFG.swallow.fitRatio * 1.5;
  const list = [], names = [], movers = [];
  let nB = 0;
  for (let i = 0; i < objs.length; i++) {
    const o = objs[i], p = o.p;
    if (o.isBuilding) { nB++; list.push({ kind: ki('building'), x: o.x, z: o.z, fit: o.fit, value: o.value, flags: KIND_FLAG(o), yaw: 0, s: 0, tint: null }); continue; }
    if (!p) throw new Error('dumpPlacements: object ' + i + ' has no placement (not a generate-mode world?)');
    list.push({ kind: ki(o.kind), x: p.x, z: p.z, fit: o.fit, value: o.value, flags: KIND_FLAG(o), yaw: p.yaw, s: p.s, tint: p.tint == null ? null : p.tint });
    if (o.name) names.push([i, o.name]);
    if (o.mover) movers.push(...p.rec); // initial mover state captured at plan time (the sim has moved them since)
  }
  // spawn candidates: street points with plenty of small food around (same rule the table always used), thinned to one per 30 m cell
  const best = new Map();
  for (const c of picker.pts) {
    let n = 0;
    world.query(c.x, c.z, 55, (o) => { if (!o.mover && o.state === 0 && o.fit < maxFit) if (o.cls !== 'tree') n++; }); // trees are cheap (1-2 points) and a dense forest is full of them: deep forest must not count as a rich start
    if (n < 30) continue;
    { let bv = 0; world.query(c.x, c.z, 130, (o) => { if (o.isBuilding && o.state === 0) bv += o.value; }); if (bv < 450) continue; } // a start needs real buildings within reach, not just a forest full of cheap trees (map-review M-01 follow-up: slow starts deep in the Mežaparks forest)
    const key = Math.floor(c.x / 30) * 100003 + Math.floor(c.z / 30);
    const cur = best.get(key);
    if (!cur || cur.dens < n) best.set(key, { x: c.x, z: c.z, dens: n });
  }
  const spawns = [...best.values()].sort((a, b) => a.x - b.x || a.z - b.z);
  const b = world.bounds;
  const meta = {
    v: 2, slug: CFG.map ? CFG.map.slug : 'centrs', bounds: { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ },
    spawn: world.spawn, kinds, names, roads: netSignature(world.net, world.data), buildings: nB,
  };
  const buf = encodeTable({ objs: list, nB, movers: new Float32Array(movers), spawns, meta });
  return { buf, objects: list.length, buildings: nB, spawns: spawns.length, movers: movers.length / MOVER_STRIDE };
}

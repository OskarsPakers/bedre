#!/usr/bin/env node
// Generates the route files of the tram-driver prototype (src/proto/tram/routes/<id>.json) from the map data the main game already ships
// (public/data[/<map>]/riga.json: `tramways` + `stops`) plus the OSM stop NAMES from the read-only download cache (tools/.cache/osm_transit*.json,
// riga.json itself carries no names). Nothing in the main data pipeline is touched.
//
//   node src/proto/tram/tools/build-route.mjs            -> writes all routes + prints the analysis (track graph, components, stops)
//   node src/proto/tram/tools/build-route.mjs --report   -> analysis only
//
// How a route is made: the tram ways of one map are snapped into a node graph (vertices within 1.5 m are one node), a route is a chain of
// way points (x,z) that are joined by shortest paths over that graph, and every tram stop that lies within 6 m of the resulting track is
// projected onto it. Both platforms of a stop are mapped as separate OSM nodes ~20 m apart: per name cluster the one that is closest to the
// track (the stop_position of THIS direction) wins. Output: the raw track vertices (the game smooths them with a Catmull-Rom spline) and the stops.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const ORIGIN = { lat: 56.9515, lon: 24.1133 };   // same projection as tools/build-data.mjs
const M_LAT = 111320, M_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
const proj = (lon, lat) => [(lon - ORIGIN.lon) * M_LON, -(lat - ORIGIN.lat) * M_LAT];
const r1 = (v) => Math.round(v * 10) / 10;

const MAPS = {
  centrs: { data: 'public/data/riga.json', transit: ['tools/.cache/osm_transit.json', 'tools/.cache/osm_transit_v2.json'] },
  mezaparks: { data: 'public/data/mezaparks/riga.json', transit: ['tools/.cache/osm_transit_mezaparks.json'] },
};

function load(slug) {
  const m = MAPS[slug];
  const data = JSON.parse(fs.readFileSync(path.join(root, m.data), 'utf8'));
  // names: OSM tram_stop nodes of the cache, projected exactly like the pipeline did
  const names = [];
  for (const f of m.transit) {
    let j; try { j = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')); } catch { continue; }
    for (const e of j.elements) if (e.type === 'node' && e.tags && (e.tags.railway === 'tram_stop' || (e.tags.public_transport === 'stop_position' && e.tags.tram === 'yes')) && e.tags.name) {
      const q = proj(e.lon, e.lat); names.push({ x: q[0], z: q[1], name: e.tags.name });
    }
  }
  const stops = data.stops.filter((s) => s[2]).map(([x, z]) => {
    let best = null, bd = 6;
    for (const n of names) { const d = Math.hypot(n.x - x, n.z - z); if (d < bd) { bd = d; best = n; } }
    return { x, z, name: best ? best.name : null };
  });
  return { slug, data, stops, ways: data.tramways.map((w) => w.p) };
}

// ---- graph ----------------------------------------------------------------------------------------------------------------------
function buildGraph(ways) {
  const nodes = []; const cell = new Map(); const SNAP = 1.5;
  const nodeAt = (p) => {
    const cx = Math.round(p[0] / SNAP), cz = Math.round(p[1] / SNAP);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const a = cell.get((cx + dx) + ',' + (cz + dz));
      if (a !== undefined && Math.hypot(nodes[a].x - p[0], nodes[a].z - p[1]) <= SNAP) return a;
    }
    nodes.push({ x: p[0], z: p[1], adj: [] }); cell.set(cx + ',' + cz, nodes.length - 1); return nodes.length - 1;
  };
  const edges = [];
  ways.forEach((w, wi) => {
    let prev = -1;
    for (const p of w) {
      const n = nodeAt(p);
      if (prev >= 0 && prev !== n) {
        const len = Math.hypot(nodes[n].x - nodes[prev].x, nodes[n].z - nodes[prev].z);
        nodes[prev].adj.push({ to: n, len, way: wi }); nodes[n].adj.push({ to: prev, len, way: wi });
        edges.push([prev, n]);
      }
      prev = n;
    }
  });
  return { nodes, edges };
}
const nearestNode = (g, p) => { let b = -1, bd = 1e9; g.nodes.forEach((n, i) => { const d = Math.hypot(n.x - p[0], n.z - p[1]); if (d < bd) { bd = d; b = i; } }); return [b, bd]; };

function components(g) {
  const comp = new Array(g.nodes.length).fill(-1); const out = [];
  g.nodes.forEach((_, s) => {
    if (comp[s] >= 0) return;
    const id = out.length, st = [s]; comp[s] = id; let n = 0, len = 0;
    const o = { id, nodes: 0, len: 0, minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9 };
    while (st.length) {
      const u = st.pop(); o.nodes++;
      const nu = g.nodes[u]; o.minX = Math.min(o.minX, nu.x); o.maxX = Math.max(o.maxX, nu.x); o.minZ = Math.min(o.minZ, nu.z); o.maxZ = Math.max(o.maxZ, nu.z);
      for (const e of nu.adj) { o.len += e.len / 2; if (comp[e.to] < 0) { comp[e.to] = id; st.push(e.to); } }
    }
    out.push(o);
  });
  return out.sort((a, b) => b.len - a.len);
}

/** Dijkstra from node a to b that never turns straight back (no U-turn on the same edge) */
function shortest(g, a, b, banned = new Set()) {
  const dist = new Map([[a, 0]]), prev = new Map(), done = new Set();
  const q = [[0, a]];
  while (q.length) {
    q.sort((x, y) => x[0] - y[0]);
    const [d, u] = q.shift();
    if (done.has(u)) continue; done.add(u);
    if (u === b) break;
    for (const e of g.nodes[u].adj) {
      if (banned.has(u + '>' + e.to)) continue;
      const nd = d + e.len;
      if (nd < (dist.get(e.to) ?? 1e18)) { dist.set(e.to, nd); prev.set(e.to, u); q.push([nd, e.to]); }
    }
  }
  if (!prev.has(b) && a !== b) return null;
  const path = [b]; for (let u = b; u !== a; u = prev.get(u)) path.push(prev.get(u));
  return path.reverse();
}

/** chain of way points -> one track polyline (node positions) */
function route(g, pts) {
  const ids = pts.map((p) => { const [n, d] = nearestNode(g, p); if (d > 12) throw new Error('way point ' + p + ' is ' + d.toFixed(0) + ' m from the track'); return n; });
  const banned = new Set(); let all = [];
  for (let i = 1; i < ids.length; i++) {
    const seg = shortest(g, ids[i - 1], ids[i], banned);
    if (!seg) throw new Error('no track between way points ' + (i - 1) + ' and ' + i);
    for (let k = 1; k < seg.length; k++) banned.add(seg[k] + '>' + seg[k - 1]); // what has been driven is not driven backwards
    all = all.concat(i === 1 ? seg : seg.slice(1));
  }
  return all.map((n) => [r1(g.nodes[n].x), r1(g.nodes[n].z)]);
}

/** whole OSM ways joined end to start (each is flipped when its far end is the one that touches the previous way) */
function chain(ways, idx) {
  let out = [];
  for (const i of idx) {
    let w = ways[i].map((p) => [...p]);
    if (out.length) {
      const e = out[out.length - 1], d0 = Math.hypot(w[0][0] - e[0], w[0][1] - e[1]), d1 = Math.hypot(w[w.length - 1][0] - e[0], w[w.length - 1][1] - e[1]);
      if (d1 < d0) w = w.reverse();
      if (Math.min(d0, d1) > 3) throw new Error('way ' + i + ' does not join the previous one (' + Math.min(d0, d1).toFixed(1) + ' m)');
      w = w.slice(1);
    }
    out = out.concat(w);
  }
  return out;
}

function project(path, q) {
  let best = 1e9, bs = 0, acc = 0;
  for (let i = 1; i < path.length; i++) {
    const [x0, z0] = path[i - 1], [x1, z1] = path[i], dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz;
    let t = l2 ? ((q.x - x0) * dx + (q.z - z0) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x0 + t * dx - q.x, z0 + t * dz - q.z), l = Math.sqrt(l2);
    if (d < best) { best = d; bs = acc + t * l; }
    acc += l;
  }
  return { d: best, s: bs };
}
const plen = (p) => { let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return L; };

function stopsOn(ctx, path) {
  const c = ctx.stops.map((s) => ({ ...s, ...project(path, s) })).filter((s) => s.d <= 6 && s.name);
  c.sort((a, b) => a.s - b.s);
  const out = [];
  for (const s of c) { // one platform per name cluster (within 60 m along the track): the nearest to the track
    const last = out[out.length - 1];
    if (last && last.name === s.name && s.s - last.s < 60) { if (s.d < last.d) out[out.length - 1] = s; continue; }
    out.push(s);
  }
  return out;
}

// ---- routes -------------------------------------------------------------------------------------------------------------------------
const ROUTES = [
  {
    id: 'mezaparks', map: 'mezaparks', line: '11', terminus: 'Ezermalas iela',
    // the Mežaparks end of line 11: out along Kokneses prospekts through the forest, round the terminus loop, back (two separate OSM tracks)
    // the two tracks run 3-6 m apart, so way points would snap to the wrong one: chain whole OSM ways instead (outbound, loop, link, inbound)
    ways: [3, 1, 2, 4],
  },
];

const only = process.argv.includes('--report');
const ctxs = {};
for (const slug of Object.keys(MAPS)) {
  const ctx = ctxs[slug] = load(slug);
  ctx.graph = buildGraph(ctx.ways);
  const comps = components(ctx.graph);
  console.log(`\n== ${slug}: ${ctx.ways.length} tram ways, ${ctx.graph.nodes.length} nodes, ${Math.round(plen([].concat(...ctx.ways.map((w) => w))) )} m (raw), ${ctx.stops.length} tram stops (${ctx.stops.filter((s) => s.name).length} named)`);
  for (const c of comps.slice(0, 6)) console.log(`   component ${c.id}: ${Math.round(c.len)} m, ${c.nodes} nodes, x ${Math.round(c.minX)}..${Math.round(c.maxX)}, z ${Math.round(c.minZ)}..${Math.round(c.maxZ)}`);
}
for (const R of ROUTES) {
  const ctx = ctxs[R.map];
  const p = R.ways ? chain(ctx.ways, R.ways) : route(ctx.graph, R.via);
  const st = stopsOn(ctx, p);
  console.log(`\n== route ${R.id}: ${Math.round(plen(p))} m, ${p.length} vertices, stops:`);
  for (const s of st) console.log(`   ${String(Math.round(s.s)).padStart(5)} m  ${s.name}  (d=${s.d.toFixed(1)} m)`);
  if (only) continue;
  const out = { id: R.id, map: R.map, line: R.line, terminus: st.findIndex((x) => x.name === R.terminus), length: Math.round(plen(p)), path: p, stops: st.map((s) => ({ name: s.name, x: s.x, z: s.z })) };
  const dir = path.join(root, 'src/proto/tram/routes'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, R.id + '.json'), JSON.stringify(out));
  console.log('   wrote src/proto/tram/routes/' + R.id + '.json');
}

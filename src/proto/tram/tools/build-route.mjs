#!/usr/bin/env node
// Generates the route files of the tram-driver game (src/proto/tram/routes/<id>.json) from the map data the main game already ships
// (public/data[/<map>]/riga.json: `tramways` + `stops`) plus the OSM stop NAMES from the read-only download cache (tools/.cache/osm_transit*.json).
// Nothing in the main data pipeline is touched.
//
//   node src/proto/tram/tools/build-route.mjs            -> writes all routes + prints the analysis and the validation of each route
//   node src/proto/tram/tools/build-route.mjs --report   -> analysis only
//
// DIRECTED track graph. Every OSM tram way is `oneway=yes` (except one service spur) and riga.json keeps each way's vertices in the way's own direction,
// so a way is a DIRECTED edge chain: trams only ever travel along it, never against it (each direction of a street is its own way = its own track, and
// a route can never reverse). Vertices within 1.5 m are one node; a node with several outgoing edges is a switch (points), one with several incoming a merge.
// Stops: riga.json's tram stops are the OSM stop positions ON the track (one per direction); the stop's name comes from the OSM cache (<= 8 m).
// A centre route = an ordered list of stop NAMES; the generator joins them with directed shortest paths (stop node -> nearest following stop node of the
// next name) and then lists EVERY stop the path passes: the result must equal the `expect` list of the route (so a route can't silently skip a stop).
// Mežaparks: two parallel single tracks + the terminus loop, whole OSM ways chained (way points would snap to the wrong one of two close tracks).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRoute } from '../validate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const ORIGIN = { lat: 56.9515, lon: 24.1133 };   // same projection as tools/build-data.mjs
const M_LAT = 111320, M_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
const proj = (lon, lat) => [(lon - ORIGIN.lon) * M_LON, -(lat - ORIGIN.lat) * M_LAT];
const r1 = (v) => Math.round(v * 10) / 10;
const plen = (p) => { let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return L; };

const MAPS = {
  centrs: { data: 'public/data/riga.json', transit: ['tools/.cache/osm_transit.json', 'tools/.cache/osm_transit_v2.json'] },
  mezaparks: { data: 'public/data/mezaparks/riga.json', transit: ['tools/.cache/osm_transit_mezaparks.json'] },
};

function load(slug) {
  const m = MAPS[slug];
  const data = JSON.parse(fs.readFileSync(path.join(root, m.data), 'utf8'));
  const names = [];
  for (const f of m.transit) {
    let j; try { j = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')); } catch { continue; }
    for (const e of j.elements) if (e.type === 'node' && e.tags && e.tags.name && (e.tags.railway === 'tram_stop' || (e.tags.public_transport === 'stop_position' && e.tags.tram === 'yes'))) {
      const q = proj(e.lon, e.lat); names.push({ x: q[0], z: q[1], name: e.tags.name.replace(/["“”]/g, '') });
    }
  }
  const stops = data.stops.filter((s) => s[2]).map(([x, z]) => {
    let best = null, bd = 8;
    for (const n of names) { const d = Math.hypot(n.x - x, n.z - z); if (d < bd) { bd = d; best = n; } }
    return { x, z, name: best ? best.name : null };
  }).filter((s) => s.name);
  return { slug, data, stops, ways: data.tramways.map((w) => w.p) };
}

// ---- directed graph -------------------------------------------------------------------------------------------------------------
function buildGraph(ways, stops) {
  const nodes = [], cell = new Map(), SNAP = 1.5;
  const nodeAt = (p, create = true) => {
    const cx = Math.round(p[0] / SNAP), cz = Math.round(p[1] / SNAP);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const a = cell.get((cx + dx) + ',' + (cz + dz));
      if (a !== undefined && Math.hypot(nodes[a].x - p[0], nodes[a].z - p[1]) <= SNAP) return a;
    }
    if (!create) return -1;
    nodes.push({ x: p[0], z: p[1], out: [], inn: [] }); cell.set(cx + ',' + cz, nodes.length - 1); return nodes.length - 1;
  };
  ways.forEach((w, wi) => {
    let prev = -1;
    for (const p of w) {
      const n = nodeAt(p);
      if (prev >= 0 && prev !== n) { nodes[prev].out.push({ to: n, way: wi }); nodes[n].inn.push(prev); }
      prev = n;
    }
  });
  const stopNode = new Map();   // node -> stop {name,x,z}
  for (const s of stops) { const n = nodeAt([s.x, s.z], false); if (n >= 0 && (nodes[n].out.length || nodes[n].inn.length)) stopNode.set(n, s); }
  return { nodes, stopNode, nodeAt };
}
const elen = (g, a, b) => Math.hypot(g.nodes[a].x - g.nodes[b].x, g.nodes[a].z - g.nodes[b].z);
/** Dijkstra over directed edges from node a to the nearest node of `targets` (Set); returns the node path */
function shortest(g, a, targets) {
  const dist = new Map([[a, 0]]), prev = new Map(), done = new Set(), q = [[0, a]];
  let hit = -1;
  while (q.length) {
    q.sort((x, y) => x[0] - y[0]);
    const [d, u] = q.shift();
    if (done.has(u)) continue; done.add(u);
    if (targets.has(u) && u !== a) { hit = u; break; }
    for (const e of g.nodes[u].out) { const nd = d + elen(g, u, e.to); if (nd < (dist.get(e.to) ?? 1e18)) { dist.set(e.to, nd); prev.set(e.to, u); q.push([nd, e.to]); } }
  }
  if (hit < 0) return null;
  const p = [hit]; for (let u = hit; u !== a; u = prev.get(u)) p.push(prev.get(u));
  return p.reverse();
}
function sccSizes(g) {   // strongly connected components (iterative Tarjan)
  const N = g.nodes.length, idx = new Array(N).fill(-1), low = new Array(N).fill(0), on = new Array(N).fill(false), st = [], comp = new Array(N).fill(-1);
  let c = 0, i0 = 0;
  for (let s = 0; s < N; s++) {
    if (idx[s] >= 0) continue;
    const work = [[s, 0]]; idx[s] = low[s] = i0++; st.push(s); on[s] = true;
    while (work.length) {
      const fr = work[work.length - 1], v = fr[0];
      if (fr[1] < g.nodes[v].out.length) {
        const w = g.nodes[v].out[fr[1]++].to;
        if (idx[w] < 0) { idx[w] = low[w] = i0++; st.push(w); on[w] = true; work.push([w, 0]); } else if (on[w]) low[v] = Math.min(low[v], idx[w]);
      } else {
        if (low[v] === idx[v]) { let w; do { w = st.pop(); on[w] = false; comp[w] = c; } while (w !== v); c++; }
        work.pop(); if (work.length) { const u = work[work.length - 1][0]; low[u] = Math.min(low[u], low[v]); }
      }
    }
  }
  const sz = {}; comp.forEach((x) => { sz[x] = (sz[x] || 0) + 1; });
  return Object.values(sz).sort((a, b) => b - a);
}

/** path through the stops named in `via` (in order), then all stops on it */
function nameRoute(g, via) {
  const byName = new Map();
  for (const [n, s] of g.stopNode) { if (!byName.has(s.name)) byName.set(s.name, new Set()); byName.get(s.name).add(n); }
  // start at the best start node: the one of the first name from which the whole chain is reachable with the least length
  let best = null;
  for (const start of byName.get(via[0]) || []) {
    let cur = start, all = [start], len = 0, ok = true;
    for (let i = 1; i < via.length && ok; i++) {
      const seg = shortest(g, cur, byName.get(via[i]) || new Set());
      if (!seg) { ok = false; break; }
      for (let k = 1; k < seg.length; k++) len += elen(g, seg[k - 1], seg[k]);
      all = all.concat(seg.slice(1)); cur = seg[seg.length - 1];
    }
    if (ok && (!best || len < best.len)) best = { all, len };
  }
  if (!best) throw new Error('no directed path through ' + via.join(' > '));
  return best.all;
}

function stopsOnNodePath(g, nodePath) {
  const out = []; let s = 0;
  nodePath.forEach((n, i) => {
    if (i) s += elen(g, nodePath[i - 1], n);
    const st = g.stopNode.get(n);
    if (!st) return;
    const last = out[out.length - 1];
    if (last && last.name === st.name && s - last.s < 80) return;   // both ends of one platform pair
    out.push({ name: st.name, x: st.x, z: st.z, s });
  });
  return out;
}

// ---- Mežaparks (whole-way chain) ----------------------------------------------------------------------------------------------------
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
function project(p, q) {
  let best = 1e9, bs = 0, acc = 0;
  for (let i = 1; i < p.length; i++) {
    const [x0, z0] = p[i - 1], [x1, z1] = p[i], dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz;
    let t = l2 ? ((q.x - x0) * dx + (q.z - z0) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x0 + t * dx - q.x, z0 + t * dz - q.z), l = Math.sqrt(l2);
    if (d < best) { best = d; bs = acc + t * l; }
    acc += l;
  }
  return { d: best, s: bs };
}
function stopsOnPath(ctx, p) {
  const c = ctx.stops.map((s) => ({ ...s, ...project(p, s) })).filter((s) => s.d <= 6);
  c.sort((a, b) => a.s - b.s);
  const out = [];
  for (const s of c) { const last = out[out.length - 1]; if (last && last.name === s.name && s.s - last.s < 60) { if (s.d < last.d) out[out.length - 1] = s; continue; } out.push(s); }
  return out;
}

// ---- the routes ---------------------------------------------------------------------------------------------------------------------
// line: only where the stop sequence genuinely is a real line (confidence in docs/proto/tram.md); otherwise null and the route is named by its termini.
// runs: [first stop index, last stop index] of each offered run (short = 3-4 stops, ~3 min).
const ROUTES = [
  { id: 'mezaparks', map: 'mezaparks', line: '11', title: { lv: 'Mežaparks · līnija 11', en: 'Mežaparks · line 11' }, ways: [3, 1, 2, 4], terminus: 'Ezermalas iela', dirOut: 'Mežaparks', dirIn: 'Centrs', runs: { short: [3, 5], full: [0, 8] } },
  { id: 'centrs-1', map: 'centrs', line: null, title: { lv: 'Pārdaugava → Bērnu pasaule', en: 'Pārdaugava → Bērnu pasaule' }, dest: 'Bērnu pasaule', destIn: 'Bērnu pasaule',
    via: ['Aleksandra Grīna bulvāris', 'Bērnu pasaule'],
    expect: ['Aleksandra Grīna bulvāris', 'Uzvaras parks', 'Nacionālā bibliotēka', 'Grēcinieku iela', '13. janvāra iela', 'Merķeļa iela', 'Dzirnavu iela', 'Ģertrūdes iela', 'Bērnu pasaule'],
    opposite: ['Ģertrūdes iela', 'Aleksandra Grīna bulvāris'], runs: { short: [5, 8], full: [0, 8] } },
  { id: 'centrs-2', map: 'centrs', line: null, title: { lv: 'Ģertrūdes iela → Elijas iela (Centrāltirgus)', en: 'Ģertrūdes iela → Elijas iela (Central Market)' }, dest: 'Elijas iela',
    // starts after the turning loop at Bērnu pasaule (an R ~ 3 m hairpin in the OSM data: no tram could take it, and a body could not follow it without sagging)
    via: ['Ģertrūdes iela', 'Elijas iela'],
    expect: ['Ģertrūdes iela', 'Dzirnavu iela', 'Merķeļa iela', 'Aspazijas bulvāris', 'Centrāltirgus', 'Spīķeri', 'Jēzusbaznīcas iela', 'Elijas iela'],
    opposite: ['Elijas iela', 'Spīķeri'], runs: { short: [3, 5], full: [0, 7] } },
  { id: 'centrs-3', map: 'centrs', line: null, title: { lv: 'Ausekļa iela → Elijas iela (Opera, Centrāltirgus)', en: 'Ausekļa iela → Elijas iela (Opera, Central Market)' }, dest: 'Elijas iela',
    via: ['Ausekļa iela', 'Elijas iela'],
    expect: ['Ausekļa iela', 'Nacionālais teātris', 'Nacionālā opera', 'Centrāltirgus', 'Spīķeri', 'Jēzusbaznīcas iela', 'Elijas iela'],
    opposite: ['Elijas iela', 'Ausekļa iela'], runs: { short: [3, 6], full: [0, 6] } },
];

// Mežaparks: the switches are where the chained ways meet another track (the loop link): nodes of the graph with several exits / entries lying on the path
function mezaSwitches(ctx, p) {
  const g = ctx.graph, out = [];
  for (const q of p) { const n = g.nodeAt(q, false); if (n >= 0 && g.nodes[n].out.length > 1) out.push({ x: r1(g.nodes[n].x), z: r1(g.nodes[n].z) }); }
  return out;
}
const only = process.argv.includes('--report');
const ctxs = {};
for (const slug of Object.keys(MAPS)) {
  const ctx = ctxs[slug] = load(slug);
  ctx.graph = buildGraph(ctx.ways, ctx.stops);
  const g = ctx.graph;
  let sw = 0, mg = 0, src = 0, snk = 0; g.nodes.forEach((n) => { if (n.out.length > 1) sw++; if (n.inn.length > 1) mg++; if (!n.inn.length) src++; if (!n.out.length) snk++; });
  console.log(`\n== ${slug}: ${ctx.ways.length} directed tram ways, ${g.nodes.length} nodes, ${sw} switches, ${mg} merges, ${src} entries / ${snk} exits at the map edge, ${ctx.stops.length} named stop positions (${g.stopNode.size} on the graph); largest strongly connected parts: ${sccSizes(g).slice(0, 3).join(', ')} nodes`);
}
let bad = 0;
for (const R of ROUTES) {
  const ctx = ctxs[R.map], g = ctx.graph;
  let p, st, ai = null, np_switches = [];
  if (R.ways) { p = chain(ctx.ways, R.ways); st = stopsOnPath(ctx, p); }
  else {
    const np = nameRoute(g, R.via); np_switches = np.filter((n) => g.nodes[n].out.length > 1).map((n) => ({ x: r1(g.nodes[n].x), z: r1(g.nodes[n].z) })); p = np.map((n) => [r1(g.nodes[n].x), r1(g.nodes[n].z)]); st = stopsOnNodePath(g, np);
    const got = st.map((s) => s.name).join(' > '), want = R.expect.join(' > ');
    if (got !== want) throw new Error(`route ${R.id}: stop sequence differs\n  got   ${got}\n  wanted ${want}`);
    if (R.opposite) { // the other direction (own track): AI trams run it; it only needs to exist and to be a valid track
      try { const op = nameRoute(g, R.opposite); ai = [{ id: R.id + '-oppo', path: op.map((n) => [r1(g.nodes[n].x), r1(g.nodes[n].z)]), stops: stopsOnNodePath(g, op).map((s) => ({ name: s.name, x: s.x, z: s.z })) }]; } catch (e) { console.log('   (no opposite path: ' + e.message + ')'); }
    }
  }
  const term = R.terminus ? st.findIndex((x) => x.name === R.terminus) : st.length - 1;
  const out = {
    id: R.id, map: R.map, line: R.line, title: R.title, terminus: term, length: Math.round(plen(p)), path: p,
    dirOut: R.dirOut || R.dest || st[st.length - 1].name, dirIn: R.dirIn || R.dest || st[0].name,
    stops: st.map((s) => ({ name: s.name, x: s.x, z: s.z })), runs: R.runs, ai,
    switches: R.ways ? mezaSwitches(ctx, p) : np_switches,
  };
  console.log(`\n== route ${R.id}: ${out.length} m, ${p.length} vertices, ${st.length} stops`);
  for (const s of st) console.log(`   ${String(Math.round(s.s ?? project(p, s).s)).padStart(5)} m  ${s.name}`);
  const v = validateRoute(out);
  console.log('   validation: ' + (v.ok ? 'OK' : 'FAILED') + `  length ${Math.round(v.length)} m, max heading change ${v.maxTurn10.toFixed(1)} deg / 10 m, min radius ${v.minRadius.toFixed(1)} m, module sag ${v.maxSag.toFixed(3)} m, ${v.sharp.length} tight spot(s)`);
  for (const e of v.errors) console.log('     ! ' + e);
  if (!v.ok) bad++;
  for (const a of out.ai || []) { const va = validateRoute({ id: a.id, path: a.path, stops: a.stops }, { minGap: 100, maxTurn10: 42 }); console.log(`   opposite track ${a.id}: ${va.ok ? 'OK' : 'FAILED'} (${Math.round(va.length)} m, module sag ${va.maxSag.toFixed(3)} m)`); for (const e of va.errors) console.log('     ! ' + e); if (!va.ok) bad++; }
  if (only) continue;
  const dir = path.join(root, 'src/proto/tram/routes'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, R.id + '.json'), JSON.stringify(out));
  console.log('   wrote src/proto/tram/routes/' + R.id + '.json');
}
if (bad) { console.error(`\n${bad} route(s) failed validation`); process.exit(1); }

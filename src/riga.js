// Rīga-flavoured static props: transit stops (shelters + waiting people), flags, Old Town terraces / flower & souvenir stalls,
// bikes + shared scooters, old-style lanterns (canal parks, Stone Bridge), bridge landmarks (cable-stayed pylon, railway-bridge
// steel arches). Pure placement logic: returns [{kind,x,z,yaw,s,tint?,name?,landmark?}] for World._buildProps.
import { LIFE } from './config.js';
import { mulberry32 } from './rng.js';
import { sampleAlong, cleanRing, bbox, pointInPoly, minBox } from './geo.js';
import { zoneOf } from './buildings.js';
import { findBridges } from './ground.js';
import { PEOPLE_COLORS } from './propModels.js';

const yawOf = (tx, tz) => Math.atan2(-tz, tx);

function nearestSeg(lists, x, z, maxD) {
  let best = null, bd = maxD;
  for (const list of lists) for (const r of list) {
    if (!r.p) continue;
    for (let i = 0; i < r.p.length - 1; i++) {
      const [x0, z0] = r.p[i], [x1, z1] = r.p[i + 1];
      const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / l2));
      const px = x0 + t * dx, pz = z0 + t * dz, d = Math.hypot(x - px, z - pz);
      if (d < bd) { const l = Math.sqrt(l2); bd = d; best = { px, pz, tx: dx / l, tz: dz / l, w: r.w || 6, d }; }
    }
  }
  return best;
}

export function rigaProps({ data, blockers, buildingItems, net }) {
  const rng = mulberry32(2024);
  const out = [];
  const C = LIFE.riga;
  const free = (x, z, m = 0.8) => blockers.free(x, z, m);
  const person = (x, z) => out.push({ kind: 'person' + Math.floor(rng() * PEOPLE_COLORS.length), x, z, yaw: rng() * 6.28, s: 0.95 + rng() * 0.15 });

  // ---- transit stops
  const vroads = data.roads.filter((r) => ['primary', 'secondary', 'tertiary', 'residential'].includes(r.k));
  const tways = (data.tramways || []).map((t) => ({ p: t.p, w: 3.4 }));
  let nStops = 0;
  for (const st of data.stops || []) {
    const isTram = !!st[2];
    const seg = nearestSeg(isTram && tways.length ? [tways] : [vroads], st[0], st[1], 25);
    if (!seg) continue;
    // pavement side: the side with free ground
    const off = isTram ? 3.4 : seg.w / 2 + 1.7;
    let placed = false;
    for (const sg of [1, -1]) {
      const x = seg.px - seg.tz * off * sg, z = seg.pz + seg.tx * off * sg;
      if (!free(x, z, 1.2)) continue;
      const toRoad = [seg.tz * sg, -seg.tx * sg];
      out.push({ kind: 'shelter', x, z, yaw: Math.atan2(toRoad[0], toRoad[1]) - 0 + Math.PI * 0, s: 1, stop: true });
      // model long axis is x, open side +z faces the road: yaw such that local +z -> toRoad
      const n = 1 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        const t = (i - (n - 1) / 2) * 1.1 + (rng() - 0.5) * 0.4, o = off - 0.9 - rng() * 0.5;
        const px = seg.px - seg.tz * o * sg + seg.tx * t, pz = seg.pz + seg.tx * o * sg + seg.tz * t;
        if (free(px, pz, 0.4)) person(px, pz);
      }
      placed = true; nStops++;
      break;
    }
    if (!placed) continue;
  }

  // ---- flags in front of public buildings
  let nFlags = 0;
  for (const it of buildingItems) {
    if (nFlags >= C.flags) break;
    if (it.t !== 'pub' || it.area < 350 || rng() > 0.6) continue;
    let be = null, bl = 0;
    for (let i = 0; i < it.ring.length; i++) {
      const [x0, z0] = it.ring[i], [x1, z1] = it.ring[(i + 1) % it.ring.length];
      const l = Math.hypot(x1 - x0, z1 - z0);
      if (l > bl) { bl = l; be = [x0, z0, x1, z1]; }
    }
    if (!be) continue;
    const dx = be[2] - be[0], dz = be[3] - be[1], l = Math.hypot(dx, dz);
    const nx = dz / l, nz = -dx / l, mx = (be[0] + be[2]) / 2, mz = (be[1] + be[3]) / 2;
    for (const f of [-0.25, 0.25]) {
      const x = mx + dx * f + nx * 1.6, z = mz + dz * f + nz * 1.6;
      if (free(x, z, 0.5)) { out.push({ kind: 'flag', x, z, yaw: yawOf(dx / l, dz / l) + (rng() < 0.5 ? 0 : Math.PI), s: 1 }); nFlags++; }
    }
  }
  // flags around the Freedom Monument
  const fm = (data.landmarks || []).find((l) => /Brīvības piemineklis/i.test(l.n));
  if (fm) for (let i = 0; i < 6; i++) {
    const a = (i / 6) * 6.283 + 0.5, x = fm.x + Math.cos(a) * 15, z = fm.z + Math.sin(a) * 15;
    if (free(x, z, 0.5)) out.push({ kind: 'flag', x, z, yaw: a + Math.PI / 2, s: 1 });
  }

  // ---- Old Town squares: café terraces along the square edges (parasols + tables for two), a few market stalls, people.
  // Named squares are seeded first (Rātslaukums, Līvu laukums, Doma laukums), then other open, car-free Old Town spots.
  const occ = [];
  const clear = (x, z, r) => { for (const o of occ) if (Math.hypot(o[0] - x, o[1] - z) < r + o[2]) return false; return true; };
  const take = (x, z, r) => occ.push([x, z, r]);
  const majors = data.roads.filter((r) => ['primary', 'secondary', 'tertiary', 'rail'].includes(r.k) && r.p && r.p.length > 1);
  const nearMajor = (x, z, pad = 2.5) => { const sg = nearestSeg([majors], x, z, 20); return !!sg && sg.d < sg.w / 2 + pad; };
  const parks0 = (data.parks || []).map((pk) => { const r = cleanRing(pk.p); return r.length >= 3 ? { r, b: bbox(r) } : null; }).filter(Boolean);
  const inPark0 = (x, z) => parks0.some((pk) => x > pk.b.x0 && x < pk.b.x1 && z > pk.b.z0 && z < pk.b.z1 && pointInPoly(x, z, pk.r));
  const plazaOk = (x, z) => zoneOf(x, z) === 'old' && free(x, z, 6) && !nearMajor(x, z, 4) && !inPark0(x, z);
  const seeds = [];
  for (const [, ax, az] of [['Rātslaukums', -392, 452], ['Līvu laukums', -316, 200], ['Doma laukums', -455, 234]]) {
    let best = null, bs = -1;
    for (let dx = -32; dx <= 32; dx += 4) for (let dz = -32; dz <= 32; dz += 4) {
      const x = ax + dx, z = az + dz;
      if (!plazaOk(x, z)) continue;
      let m = 6; while (m < 20 && free(x, z, m + 2)) m += 2;
      const sc = m - Math.hypot(dx, dz) * 0.15;
      if (sc > bs) { bs = sc; best = [x, z, m]; }
    }
    if (best) seeds.push(best);
  }
  {
    const cand = [];
    for (let x = -920; x <= 120; x += 6) for (let z = -120; z <= 640; z += 6) {
      if (!plazaOk(x, z) || !free(x, z, 9)) continue;
      cand.push([x, z, 9]);
    }
    cand.sort(() => rng() - 0.5);
    for (const c of cand) {
      if (seeds.length >= (C.squares ?? 14)) break;
      if (seeds.every((q) => Math.hypot(q[0] - c[0], q[1] - c[1]) > 45)) seeds.push(c);
    }
  }
  let nCafe = 0, nPar = 0, nSt = 0;
  const parCap = C.parasols, cafeCap = C.cafes ?? 160;
  for (const [sx, sz] of seeds) {
    // terrace sites: 2.5..6 m off a facade, looking onto the square
    let terr = 0;
    const dirs = 28;
    for (let k = 0; k < dirs && terr < (C.terracesPerSquare ?? 4); k++) {
      const a = (k / dirs) * Math.PI * 2 + rng() * 0.2;
      const cx = Math.cos(a), cz = Math.sin(a);
      let site = null;
      for (let r = 6; r < 45; r += 1.5) {
        const x = sx + cx * r, z = sz + cz * r;
        if (!free(x, z, 0.5)) break;
        if (!free(x, z, 3.2)) { site = [x - cx * 1.2, z - cz * 1.2]; break; }
      }
      if (!site || nearMajor(site[0], site[1]) || !clear(site[0], site[1], 4)) continue;
      // terrace grid: along the facade (tangent) x away from it (towards the square centre)
      const nx = -cx, nz = -cz, tx = -nz, tz = nx;
      const cols = 2 + Math.floor(rng() * 3), rows = 1 + Math.floor(rng() * 2);
      let placed = 0;
      for (let row = 0; row < rows; row++) for (let c = 0; c < cols; c++) {
        const t = (c - (cols - 1) / 2) * 3.5 + (rng() - 0.5) * 0.4, o = row * 3.4;
        const x = site[0] + tx * t + nx * o, z = site[1] + tz * t + nz * o;
        if (!free(x, z, 1.7) || !clear(x, z, 1.6) || nearMajor(x, z)) continue;
        const useParasol = nPar < parCap && (row === 0 ? rng() < 0.75 : rng() < 0.45);
        if (useParasol) { out.push({ kind: 'parasol', x, z, yaw: rng() * 6.28, s: 1, tint: rng() }); nPar++; }
        else if (nCafe < cafeCap) { out.push({ kind: 'cafeset', x, z, yaw: Math.atan2(-tz, tx) + (rng() - 0.5) * 0.5, s: 1 }); nCafe++; }
        else continue;
        take(x, z, 1.6); placed++;
        if (rng() < 0.3) { const px = x + nx * 1.6 + tx * 0.8, pz = z + nz * 1.6 + tz * 0.8; if (free(px, pz, 0.4) && clear(px, pz, 0.3)) { person(px, pz); take(px, pz, 0.3); } }
      }
      if (placed) terr++;
    }
    // a couple of stalls + a crowd in the open middle of the square
    const nStall = Math.floor(rng() * 3);
    for (let i = 0; i < nStall && nSt < C.stalls; i++) {
      const a = rng() * 6.28, r = 3 + rng() * 6, x = sx + Math.cos(a) * r, z = sz + Math.sin(a) * r;
      if (free(x, z, 2) && clear(x, z, 2)) { out.push({ kind: 'stall', x, z, yaw: a + Math.PI / 2, s: 1, tint: rng() }); take(x, z, 2); nSt++; }
    }
    const nPpl = 5 + Math.floor(rng() * (C.squarePeople ?? 9));
    for (let i = 0; i < nPpl; i++) {
      const a = rng() * 6.28, r = rng() * 14, x = sx + Math.cos(a) * r, z = sz + Math.sin(a) * r;
      if (free(x, z, 0.6) && clear(x, z, 0.4)) { person(x, z); take(x, z, 0.4); }
    }
  }

  // ---- Old Town terraces (pedestrian streets), stalls, bikes, scooters
  let nBike = 0, nSco = 0;
  const walkRoads = data.roads.filter((r) => (r.k === 'pedestrian' || r.k === 'footway') && r.p && r.p.length > 1);
  const streets = data.roads.filter((r) => ['residential', 'tertiary', 'secondary', 'primary'].includes(r.k) && r.p && r.p.length > 1);
  for (const r of walkRoads) {
    const w = r.w || 4;
    for (const s of sampleAlong(r.p, 18, rng)) {
      const z0 = zoneOf(s.x, s.z);
      if (z0 === 'other' && r.k === 'footway') continue;
      const old = z0 === 'old';
      if (r.k === 'pedestrian' && w >= 4 && (nPar < C.parasols || nCafe < cafeCap) && rng() < (old ? (C.streetTerrace ?? 0.7) : 0.25)) {
        const sg = rng() < 0.5 ? -1 : 1, o = w * 0.5 + 1.6;
        const cx = s.x - s.tz * o * sg, cz = s.z + s.tx * o * sg;
        const n = 2 + Math.floor(rng() * 3);
        for (let i = 0; i < n; i++) {
          const x = cx + s.tx * i * 3.4, z = cz + s.tz * i * 3.4;
          if (!free(x, z, 1.6) || !clear(x, z, 1.6)) continue;
          if (nPar < C.parasols && rng() < 0.65) { out.push({ kind: 'parasol', x, z, yaw: rng() * 6.28, s: 1, tint: rng() }); nPar++; }
          else if (nCafe < cafeCap) { out.push({ kind: 'cafeset', x, z, yaw: yawOf(s.tx, s.tz) + (rng() - 0.5) * 0.5, s: 1 }); nCafe++; }
          else continue;
          take(x, z, 1.6);
        }
      } else if (old && r.k === 'pedestrian' && nSt < C.stalls && rng() < 0.12) {
        const sg = rng() < 0.5 ? -1 : 1, o = w * 0.5 + 1.2;
        const x = s.x - s.tz * o * sg, z = s.z + s.tx * o * sg;
        if (free(x, z, 1.2) && clear(x, z, 1.6)) { out.push({ kind: 'stall', x, z, yaw: yawOf(s.tx, s.tz) + (sg > 0 ? 0 : Math.PI), s: 1, tint: rng() }); take(x, z, 1.6); nSt++; }
      }
      if (nBike < C.bikes && z0 !== 'other' && rng() < 0.18) {
        const sg = rng() < 0.5 ? -1 : 1, o = w * 0.5 + 0.7;
        const x = s.x - s.tz * o * sg, z = s.z + s.tx * o * sg;
        if (free(x, z, 0.8)) { for (let i = 0; i < 1 + Math.floor(rng() * 3); i++) { out.push({ kind: 'bike', x: x + s.tx * i * 0.5, z: z + s.tz * i * 0.5, yaw: yawOf(s.tx, s.tz) + 1.5, s: 1, tint: rng() }); nBike++; } }
      }
    }
  }
  for (const r of streets) {
    const w = r.w || 7;
    for (const s of sampleAlong(r.p, 38, rng)) {
      const z0 = zoneOf(s.x, s.z);
      if (z0 === 'other') continue;
      const sg = rng() < 0.5 ? -1 : 1, o = w * 0.5 + 1.5;
      const x = s.x - s.tz * o * sg, z = s.z + s.tx * o * sg;
      if (!free(x, z, 0.8)) continue;
      if (nSco < C.scooters && rng() < 0.35) { for (let i = 0; i < 1 + Math.floor(rng() * 2); i++) { out.push({ kind: 'scooter', x: x + s.tx * i * 0.7, z: z + s.tz * i * 0.7, yaw: yawOf(s.tx, s.tz) + (rng() - 0.5) * 0.6, s: 1, tint: rng() }); nSco++; } }
      else if (nBike < C.bikes && rng() < 0.3) { out.push({ kind: 'bike', x, z, yaw: yawOf(s.tx, s.tz) + 1.5, s: 1, tint: rng() }); nBike++; }
    }
  }
  // stalls near the Central Market (SE) + flower stalls on market-side pedestrian streets
  for (let i = 0; i < 26; i++) {
    const x = -20 + rng() * 220, z = 800 + rng() * 150;
    if (free(x, z, 2) && nSt < C.stalls + 26) { out.push({ kind: 'stall', x, z, yaw: Math.floor(rng() * 4) * Math.PI / 2, s: 1, tint: rng() }); nSt++; }
  }

  // ---- old-style lanterns: canal parks + Stone Bridge
  const canals = (net.routes || []).filter((r) => r.canal);
  let nLan = 0;
  const nearCanal = (x, z) => { for (const c of canals) for (let i = 0; i < c.p.length; i += 2) if (Math.hypot(c.p[i][0] - x, c.p[i][1] - z) < 75) return true; return false; };
  const parks = (data.parks || []).map((pk) => { const r = cleanRing(pk.p); return r.length >= 3 ? { r, b: bbox(r) } : null; }).filter(Boolean);
  for (const r of walkRoads) {
    if (nLan >= C.lanterns) break;
    for (const s of sampleAlong(r.p, 16, rng)) {
      if (nLan >= C.lanterns) break;
      if (!nearCanal(s.x, s.z)) continue;
      const inPark = parks.some((pk) => s.x > pk.b.x0 && s.x < pk.b.x1 && s.z > pk.b.z0 && s.z < pk.b.z1 && pointInPoly(s.x, s.z, pk.r));
      if (!inPark) continue;
      const sg = rng() < 0.5 ? -1 : 1, o = (r.w || 2.5) / 2 + 0.7;
      const x = s.x - s.tz * o * sg, z = s.z + s.tx * o * sg;
      if (free(x, z, 0.5)) { out.push({ kind: 'lantern', x, z, yaw: yawOf(s.tx, s.tz), s: 1 }); nLan++; }
    }
  }
  const bridges = findBridges(data);
  const road = bridges.filter((b) => b.k !== 'rail' && b.k !== 'footway' && b.k !== 'pedestrian');
  // Stone Bridge: the long secondary bridge(s) -> lanterns on both kerbs
  for (const b of road.filter((q) => q.k === 'secondary' || q.k === 'tertiary')) {
    for (const s of sampleAlong(b.p, 24, rng)) for (const sg of [-1, 1]) {
      const o = b.w / 2 + 1.0, x = s.x - s.tz * o * sg, z = s.z + s.tx * o * sg;
      out.push({ kind: 'lantern', x, z, yaw: yawOf(s.tx, s.tz), s: 1 });
    }
  }
  // Vanšu bridge: the long primary bridge continuing Krišjāņa Valdemāra iela west across the Daugava (twin carriageways in
  // the data). Its single pylon stands on the Ķīpsala side with the main-span fan reaching back over the river towards the
  // Old Town, so it goes in the median between the two carriageways, ~72% of the way from the city-side end.
  const prims = road.filter((q) => q.k === 'primary' && q.p.length > 20).sort((a, b) => b.p.length - a.p.length);
  if (prims.length) {
    const A = prims[0].p.slice();
    if (Math.hypot(A[0][0], A[0][1]) > Math.hypot(A[A.length - 1][0], A[A.length - 1][1])) A.reverse(); // A[0] = city end
    const cum = [0];
    for (let i = 0; i < A.length - 1; i++) cum.push(cum[i] + Math.hypot(A[i + 1][0] - A[i][0], A[i + 1][1] - A[i][1]));
    const L = cum[cum.length - 1], sAt = L * (C.pylonAt ?? 0.72);
    let i = 0; while (i < cum.length - 2 && cum[i + 1] < sAt) i++;
    const t = (sAt - cum[i]) / Math.max(0.01, cum[i + 1] - cum[i]);
    let x = A[i][0] + (A[i + 1][0] - A[i][0]) * t, z = A[i][1] + (A[i + 1][1] - A[i][1]) * t;
    // twin carriageway: move onto the median (midpoint to the nearest point of the other, parallel bridge)
    const B = prims.find((q, k) => k > 0 && q.p.some((r) => Math.hypot(r[0] - x, r[1] - z) < 30));
    if (B) {
      let bd = 1e9, bp = null;
      for (let k = 0; k < B.p.length - 1; k++) {
        const [x0, z0] = B.p[k], [x1, z1] = B.p[k + 1], dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz || 1;
        const tt = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / l2)), px = x0 + tt * dx, pz = z0 + tt * dz;
        const dd = Math.hypot(px - x, pz - z); if (dd < bd) { bd = dd; bp = [px, pz]; }
      }
      if (bp && bd < 30) { x = (x + bp[0]) / 2; z = (z + bp[1]) / 2; }
    }
    // model +x = main span direction = back towards the city end
    const tx = A[0][0] - A[A.length - 1][0], tz = A[0][1] - A[A.length - 1][1], tl = Math.hypot(tx, tz) || 1;
    out.push({ kind: 'pylon', x, z, yaw: yawOf(tx / tl, tz / tl), s: 1, name: 'Vanšu tilta pylons', landmark: true });
  }
  // railway bridge: steel arch spans
  const rails = bridges.filter((q) => q.k === 'rail').sort((a, b) => b.p.length - a.p.length);
  if (rails.length) {
    const A = rails[0], B = rails[1];
    const pts = A.p;
    let L = 0; const cum = [0];
    for (let i = 0; i < pts.length - 1; i++) { L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); cum.push(L); }
    const n = Math.max(1, Math.floor(L / 52));
    for (let k = 0; k < n; k++) {
      const s = ((k + 0.5) / n) * L;
      let i = 0; while (i < cum.length - 2 && cum[i + 1] < s) i++;
      const t = (s - cum[i]) / Math.max(0.01, cum[i + 1] - cum[i]);
      let x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, z = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
      const tx = pts[i + 1][0] - pts[i][0], tz = pts[i + 1][1] - pts[i][1], tl = Math.hypot(tx, tz) || 1;
      if (B) { let bd = 30, bp = null; for (const q of B.p) { const d = Math.hypot(q[0] - x, q[1] - z); if (d < bd) { bd = d; bp = q; } } if (bp) { x = (x + bp[0]) / 2; z = (z + bp[1]) / 2; } }
      out.push({ kind: 'railarch', x, z, yaw: yawOf(tx / tl, tz / tl), s: 1, name: 'Dzelzceļa tilts', landmark: true });
    }
  }
  // Rīga Central Station: arched platform canopies (two 48 m segments per platform, from the hall end) over the OSM platforms behind the station hall
  for (const a of data.areas || []) {
    if (a.c !== 'plat') continue;
    const r = cleanRing(a.p); if (r.length < 3) continue;
    const mb = minBox(r), cx = mb.cu * mb.ux - mb.cv * mb.uz, cz = mb.cu * mb.uz + mb.cv * mb.ux;
    if (mb.L < 140 || mb.W > 16 || Math.hypot(cx - 560, cz - 545) > 260) continue;
    const ux = mb.ux < 0 ? -mb.ux : mb.ux, uz = mb.ux < 0 ? -mb.uz : mb.uz; // along the platform, pointing east
    const s0 = mb.cu - mb.L / 2; // the west end in the (u, v) frame (u runs along the long side)
    for (let k = 0; k < 2; k++) {
      const u = (mb.ux < 0 ? mb.cu + mb.L / 2 - 4 - 24 - k * 49 : s0 + 4 + 24 + k * 49);
      const x = u * mb.ux - mb.cv * mb.uz, z = u * mb.uz + mb.cv * mb.ux;
      out.push({ kind: 'platformroof', x, z, yaw: yawOf(ux, uz), s: 1, name: 'Perona nojume' });
    }
  }
  return out;
}

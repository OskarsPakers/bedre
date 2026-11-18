// Plan (and with --fetch, perform) the download of the reality-mesh nodes needed to sample every centre-map building.
// node plan.mjs <spacing m> [--fetch] : walks every layer overlapping the centre box, keeps nodes that touch a (dilated) building footprint and whose estimated vertex spacing is <= target (or leaves);
// counts what is already on disk (tools/.cache/realistic read-only, tools/.cache/detail geometry read-only, tools/.cache/sampling own) and what is missing; --fetch downloads only the missing files into tools/.cache/sampling/i3s (<= 4 concurrent, backoff, resumable).
import fs from 'node:fs'; import path from 'node:path'; import { Layer, discoverLayers, localToMerc, mercToLocal, MERC_K, nodeSpacing } from '../detail/i3s.mjs';
const ROOT = path.resolve(import.meta.dirname, '../..'), CA = path.join(ROOT, 'tools/.cache'), OWN = path.join(CA, 'sampling/i3s');
const SP = +(process.argv[2] || 0.5), FETCH = process.argv.includes('--fetch'); const MINH = +(process.env.MINH || 5.5);
const city = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/riga.json'), 'utf8'));
// wanted raster 6 m cells over the map box
const B = city.meta.bounds, CELL = 6, GW = Math.ceil((B.maxX - B.minX) / CELL) + 2, GH = Math.ceil((B.maxZ - B.minZ) / CELL) + 2; const want = new Uint8Array(GW * GH); let nb = 0;
for (const b of city.buildings) { if (!b.p || b.p.length < 3) continue; if ((b.h || 0) < MINH && !b.n) continue; if (b.t === 'aux' && (b.h || 0) < 8) continue; nb++;
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const [x, z] of b.p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  for (let gz = Math.floor((z0 - 5 - B.minZ) / CELL); gz <= Math.floor((z1 + 5 - B.minZ) / CELL); gz++) for (let gx = Math.floor((x0 - 5 - B.minX) / CELL); gx <= Math.floor((x1 + 5 - B.minX) / CELL); gx++) if (gx >= 0 && gz >= 0 && gx < GW && gz < GH) want[gz * GW + gx] = 1; }
let wc = 0; for (const v of want) wc += v; console.log('buildings wanted', nb, 'of', city.buildings.length, 'wanted ground', (wc * CELL * CELL / 1e6).toFixed(2), 'km2');
const hit = (a) => { // mercator AABB -> local, any wanted cell inside?
  const [x0, z1] = mercToLocal(a.min[0], a.min[1]), [x1, z0] = mercToLocal(a.max[0], a.max[1]); const gx0 = Math.max(0, Math.floor((x0 - B.minX) / CELL)), gx1 = Math.min(GW - 1, Math.floor((x1 - B.minX) / CELL)), gz0 = Math.max(0, Math.floor((z0 - B.minZ) / CELL)), gz1 = Math.min(GH - 1, Math.floor((z1 - B.minZ) / CELL));
  for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) if (want[gz * GW + gx]) return true; return false; };
// own Layer objects: pages cached in OWN (seeded from the detail cache), layer.json too
const lo = localToMerc(B.minX, B.maxZ), hi = localToMerc(B.maxX, B.minZ); const bbox = [lo[0], lo[1], hi[0], hi[1]];
const all = (await discoverLayers()).filter((l) => !/^Pazeme|region_3_AM|LGIA_LOD2/i.test(l.name));
const sel = []; const perLayer = {};
for (const l of all) {
  const L = new Layer(l); L.dir = path.join(OWN, l.name); const dd = path.join(CA, 'detail/i3s', l.name); fs.mkdirSync(path.join(L.dir, 'pages'), { recursive: true });
  for (const f of ['layer.json']) if (!fs.existsSync(path.join(L.dir, f)) && fs.existsSync(path.join(dd, f))) fs.copyFileSync(path.join(dd, f), path.join(L.dir, f));
  if (fs.existsSync(path.join(dd, 'pages'))) for (const f of fs.readdirSync(path.join(dd, 'pages'))) if (!fs.existsSync(path.join(L.dir, 'pages', f))) fs.copyFileSync(path.join(dd, 'pages', f), path.join(L.dir, 'pages', f));
  await L.init(); const e = L.extent; if (!e || e.some((v) => v == null) || e[2] < bbox[0] || e[0] > bbox[2] || e[3] < bbox[1] || e[1] > bbox[3]) continue;
  const walk = async (id, depth) => { const n = await L.node(id), a = n._aabb; if (a.max[0] < bbox[0] || a.min[0] > bbox[2] || a.max[1] < bbox[1] || a.min[1] > bbox[3]) return; if (!hit(a)) return;
    const kids = n.children || []; if (n.mesh && (!kids.length || nodeSpacing(n) <= SP)) { sel.push({ L, n, depth }); return; } if (!kids.length) return; await Promise.all(kids.map((k) => walk(k, depth + 1))); };
  await walk(0, 0);
}
const has = (layer, kind, res, ext) => [path.join(CA, 'realistic/i3s', layer, kind, res + ext), path.join(OWN, layer, kind, res + ext)].concat(kind === 'g' ? [path.join(CA, 'detail/i3s', layer, 'g', res + ext)] : []).some((f) => fs.existsSync(f));
// texture bytes per texel measured on the corridor (jpeg) : 
const man = JSON.parse(fs.readFileSync(path.join(CA, 'realistic/corridor-centrs-3.json'), 'utf8')); let tb = 0, tt = 0; for (const m of man.nodes) if (m.mat != null) { const f = path.join(CA, 'realistic/i3s', m.layer, 't', m.mat + '.jpg'); if (fs.existsSync(f)) { tb += fs.statSync(f).size; tt += m.texel || 524288; } } const BPT = tb / tt;
const st = { nodes: sel.length, vertices: 0, geoRawMB: 0, geoWireMB: 0, texMB: 0, missG: 0, missT: 0, missGwireMB: 0, missTMB: 0 };
for (const s of sel) { const vc = s.n.mesh.geometry.vertexCount, gres = String(s.n.mesh.geometry.resource), tres = s.n.mesh.material?.resource != null ? String(s.n.mesh.material.resource) : null, tex = (s.n.mesh.material?.texelCountHint || 524288) * BPT;
  st.vertices += vc; st.geoRawMB += vc * 32 / 1e6; st.geoWireMB += vc * 32 * 0.42 / 1e6; st.texMB += tex / 1e6; const pl = (perLayer[s.L.name] ||= { nodes: 0, missG: 0, missT: 0 }); pl.nodes++;
  if (!has(s.L.name, 'g', gres, '.bin')) { st.missG++; st.missGwireMB += vc * 32 * 0.42 / 1e6; pl.missG++; } if (tres && !has(s.L.name, 't', tres, '.jpg')) { st.missT++; st.missTMB += tex / 1e6; pl.missT++; } }
console.log(`target spacing ${SP} m: nodes ${st.nodes}, vertices ${(st.vertices / 1e6).toFixed(1)} M, geometry ${st.geoRawMB.toFixed(0)} MB raw / ~${st.geoWireMB.toFixed(0)} MB wire, textures ~${st.texMB.toFixed(0)} MB (${BPT.toFixed(3)} B/texel)`);
console.log(`ALREADY ON DISK: geometry ${st.nodes - st.missG}/${st.nodes}, textures ${st.nodes - st.missT}/${st.nodes}.  MISSING: ${st.missG} geometry files (~${st.missGwireMB.toFixed(0)} MB wire) + ${st.missT} textures (~${st.missTMB.toFixed(0)} MB) => ~${(st.missGwireMB + st.missTMB).toFixed(0)} MB to download`); console.log(JSON.stringify(perLayer));
const manifest = { route: 'centrs-all', spacing: SP, nodes: sel.map((s) => ({ layer: s.L.name, id: s.n.index ?? null, res: s.n.mesh.geometry.resource, vc: s.n.mesh.geometry.vertexCount, def: s.n.mesh.geometry.definition || 0, mat: s.n.mesh.material?.resource, texel: s.n.mesh.material?.texelCountHint, center: s.n.obb.center, half: s.n.obb.halfSize, quat: s.n.obb.quaternion, depth: s.depth })), layerDefs: Object.fromEntries(all.filter((l) => perLayer[l.name]).map((l) => { const L = sel.find((s) => s.L.name === l.name).L; return [l.name, { geom: L.json.geometryDefinitions.map((g) => g.geometryBuffers[0]), url: L.url }]; })) };
fs.writeFileSync(path.join(CA, `sampling/plan-${SP}.json`), JSON.stringify(manifest)); fs.writeFileSync(path.join(CA, `sampling/plan-${SP}.stats.json`), JSON.stringify({ ...st, perLayer, bpt: BPT }));
if (FETCH) {
  const UA = 'Mozilla/5.0 (internal mesh sampling experiment; polite client)'; const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let wire = 0, req = 0, done = 0; const jobs = [];
  for (const m of manifest.nodes) { const L = manifest.layerDefs[m.layer]; const g = String(m.res), t = m.mat != null ? String(m.mat) : null;
    if (!has(m.layer, 'g', g, '.bin')) jobs.push([`${L.url}/nodes/${g}/geometries/0`, path.join(OWN, m.layer, 'g', g + '.bin')]); if (t && !has(m.layer, 't', t, '.jpg')) jobs.push([`${L.url}/nodes/${t}/textures/0`, path.join(OWN, m.layer, 't', t + '.jpg')]); }
  console.log('fetching', jobs.length, 'files'); let k = 0;
  const get = async ([url, file]) => { if (fs.existsSync(file)) return; fs.mkdirSync(path.dirname(file), { recursive: true }); let err; for (let i = 0; i < 6; i++) { try { const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip' }, signal: AbortSignal.timeout(90000) }); if (!r.ok) throw new Error('HTTP ' + r.status); const buf = Buffer.from(await r.arrayBuffer()); wire += Number(r.headers.get('content-length')) || buf.length; req++; fs.writeFileSync(file + '.tmp', buf); fs.renameSync(file + '.tmp', file); return; } catch (e) { err = e; await sleep(1000 * 2 ** i); } } console.log('FAILED', url, err.message); };
  await Promise.all([0, 1, 2, 3].map(async () => { while (k < jobs.length) { await get(jobs[k++]); if (++done % 200 === 0) console.log(`  ${done}/${jobs.length}  ${(wire / 1e6).toFixed(0)} MB wire so far`); } })); console.log('fetched', req, 'files', (wire / 1e6).toFixed(0), 'MB wire');
}

import { CFG } from './config.js';
import { generateSampleCity } from './sampleCity.js';
import { loadShapes } from './shapes.js';
import { loadGroundRaster } from './ground.js';
import { loadPlacements, generateRequested } from './placements.js';

/** Load the real map; fall back to the procedural sample city on any failure. */
export async function loadCity(forceSample = false, onProgress = () => {}) {
  if (!forceSample) {
    try {
      const shapesP = loadShapes(); // in parallel with the map; resolves null when missing
      const sightsP = loadSights(); // category / tier of every important building (src/sights.js); resolves null when missing
      const groundP = loadGroundRaster(CFG.groundUrl); // optional class raster, resolves null when missing
      const placeP = generateRequested() ? Promise.resolve(null) : loadPlacements(CFG.map ? CFG.map.slug : 'centrs'); // canonical object list (src/placements.js); never rejects
      const res = await fetch(CFG.dataUrl);
      if (res.ok) {
        const data = await readJson(res, onProgress); // dev servers may answer 200 + index.html -> throws
        if (data && Array.isArray(data.buildings) && data.buildings.length) { data.shapes = await shapesP; data.sights = await sightsP; data.groundRaster = await groundP; data.placements = await placeP; return normalize(data, false); }
      }
    } catch (e) { /* fall through */ }
  }
  console.info('[data] using procedural sample city');
  return normalize(generateSampleCity(), true);
}

/** public/data/<map>/sights.json: { v, cats, s: { id: [cat, tier, lead, key, hint, piece] } } (tools/detail/sights.mjs) */
async function loadSights() {
  try {
    if (!CFG.sightsUrl) return null;
    try { if (new URLSearchParams(location.search).get('sights') === '0') return null; } catch { /* ignore */ } // ?sights=0: review switch, the pre-treatment look
    const res = await fetch(CFG.sightsUrl);
    if (!res.ok) return null;
    const j = await res.json();
    return j && j.s ? j : null;
  } catch { return null; }
}

/** Parse a JSON response while reporting download progress (0..1; uses Content-Length / decoded-size hint when known). */
async function readJson(res, onProgress) {
  const total = +res.headers.get('content-length') || 0;
  if (!res.body || !res.body.getReader) return res.json();
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    // content-length is the compressed size when gzip/br is used, so cap below 1 until parsing
    onProgress(total ? Math.min(0.97, got / total) : Math.min(0.9, got / 1.6e6));
  }
  const buf = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.length; }
  onProgress(1);
  return JSON.parse(new TextDecoder().decode(buf));
}

function normalize(d, sample) {
  d.roads = d.roads || [];
  d.water = d.water || [];
  d.parks = d.parks || [];
  d.trees = d.trees || [];
  d.landmarks = d.landmarks || [];
  d.meta = d.meta || {};
  d.meta.bounds = d.meta.bounds || { minX: -1200, maxX: 1200, minZ: -1200, maxZ: 1200 };
  d.meta.sample = sample;
  return d;
}

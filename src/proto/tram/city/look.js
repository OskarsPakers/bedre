// Loader for the tram game's own look data (public/data/tram/*.json.gz). Never fetched by the hole game. Everything resolves null / empty on failure.
async function gunzipJson(res) {
  const buf = await res.arrayBuffer(); const u8 = new Uint8Array(buf);
  if (u8[0] === 0x1f && u8[1] === 0x8b) { const s = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')); return JSON.parse(await new Response(s).text()); }
  return JSON.parse(new TextDecoder().decode(u8));
}
async function get(url) { try { const r = await fetch(url); if (!r.ok) return null; return await gunzipJson(r); } catch { return null; } }

/** -> Map(id -> record) of sampled parameters (centre map only) */
export async function loadLook(slug) {
  if (slug !== 'centrs') return new Map();
  const j = await get('/data/tram/look-centrs.json.gz'); const m = new Map();
  if (!j || !j.rows) return m;
  for (const r of j.rows) m.set(r[0], { wall: r[1], roof: r[2], rc: r[3], nF: r[4], fh: r[5], sp: r[6], ww: r[7], wh: r[8], wy: r[9], gh: r[10], gk: r[11], gs: r[12], co: r[13], sc: r[14], pil: r[15], trim: r[16] });
  return m;
}
export async function loadCorridor(slug) { const j = await get(`/data/tram/corridor-${slug}.json.gz`); return new Set(j && j.ids ? j.ids : []); }

/** Sampling washes saturated colours out towards cream / grey (README of tools/sampling). Heuristic chroma restoration, NOT a measurement: warm hues get more chroma, very light colours are pulled back a little. */
export function restore(hex) {
  let r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 0.004) return hex;
  let h; if (mx === r) h = ((g - b) / d + 6) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
  h *= 60; let s = d / mx, v = mx;
  const warm = h < 70 || h > 330;
  if (warm) s = Math.min(0.75, s * 1.55 + 0.03); else s = Math.min(0.7, s * 1.25);
  v = Math.min(0.9, v * (warm ? 0.97 : 1.0));
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [R, G, B] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const q = (t) => Math.max(0, Math.min(255, Math.round((t + m) * 255)));
  return (q(R) << 16) | (q(G) << 8) | q(B);
}

/** -> Map(buildingId -> [facade run]) of MEASURED facades (tools/tramcity/measure.mjs + finalize.mjs; see the file header of finalize.mjs for the fields) */
export async function loadFacades(slug) {
  const m = new Map(); if (slug !== 'centrs') return m;
  const j = await get('/data/tram/facades-centrs.json.gz'); if (j && j.b) for (const [id, runs] of Object.entries(j.b)) m.set(+id, runs);
  return m;
}

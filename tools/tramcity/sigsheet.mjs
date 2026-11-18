// signature-building sheets: node tools/tramcity/sigsheet.mjs [outDir] [tag]   (dev server on :5198)
// for every recipe of city/signature/recipes.js + the curated landmarks: game cab view | game chase view | rectified real facade (if any) | feature list
import { chromium } from 'playwright';
import fs from 'node:fs';
import sharp from 'sharp';
import { buildTrack } from '../../src/proto/tram/track.js';
import { SIGNATURES } from '../../src/proto/tram/city/signature/recipes.js';
import { CURATED } from '../../src/proto/tram/city/curated.js';
const out = process.argv[2] || 'scripts/out/tramcity/sig', tag = process.argv[3] || 'r4'; fs.mkdirSync(out, { recursive: true });
const j = JSON.parse(fs.readFileSync('public/data/riga.json', 'utf8')); const by = new Map(j.buildings.map((b) => [b.id, b]));
const R = {}; for (const r of ['centrs-1', 'centrs-2', 'centrs-3']) R[r] = buildTrack(JSON.parse(fs.readFileSync(`src/proto/tram/routes/${r}.json`, 'utf8')));
const ids = Object.keys(CURATED).map(Number).filter((id) => by.has(id));
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 960, height: 600 } });
await pg.goto('http://localhost:5198/tramvajs/?route=centrs-3&lang=en&quality=high&city=1'); await pg.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
await pg.addStyleTag({ content: '#start,#hud,.hud,#menu,#loading{display:none!important}' });
const rows = [];
for (const id of ids) {
  const bd = by.get(id), cur = CURATED[id]; let cx = 0, cz = 0; for (const p of bd.p) { cx += p[0]; cz += p[1]; } cx /= bd.p.length; cz /= bd.p.length;
  let best = null; for (const r in R) { const n = R[r].nearest(cx, cz, 0, 1e5); if (!best || n.d < best.d) best = { r, ...n }; } if (best.d > 130) continue;
  const T = R[best.r], p = {}, q = {};
  const shots = [];
  for (const [mode, back, y, fov] of [['cab', 32, 3.2, 70], ['chase', 46, 9, 55]]) {
    T.at(Math.max(0, best.s - back), p); const ty = Math.min(bd.h * 0.45, 10);
    await pg.evaluate((o) => window.__tram.setCamera(o), { x: p.x, y, z: p.z, lx: cx, ly: ty, lz: cz, fov }); await pg.waitForTimeout(900);
    const f = `${out}/${tag}-${id}-${mode}.png`; await pg.screenshot({ path: f }); shots.push(f);
  }
  const rect = fs.existsSync('tools/.cache/sampling/rect') ? fs.readdirSync('tools/.cache/sampling/rect').filter((f) => f.startsWith(id + '_')).map((f) => ({ f, s: fs.statSync('tools/.cache/sampling/rect/' + f).size })).sort((a, c) => c.s - a.s)[0] : null;
  rows.push({ id, name: cur.name || ('#' + id), route: best.r, s: Math.round(best.s), shots, rect: rect ? 'tools/.cache/sampling/rect/' + rect.f : null, sig: !!cur.sig, grand: !!cur.grand, portico: !!cur.portico, hangar: !!cur.hangar, note: cur.note || '' });
  console.log(id, cur.name, best.r, Math.round(best.s));
}
fs.writeFileSync(`${out}/${tag}-rows.json`, JSON.stringify(rows, null, 1));
// contact sheets: 4 buildings per sheet
const W = 960, H = 540;
for (let k = 0; k * 4 < rows.length; k++) {
  const part = rows.slice(k * 4, k * 4 + 4), comps = [];
  for (let i = 0; i < part.length; i++) {
    const r = part[i];
    const label = Buffer.from(`<svg width="${W * 2 + 360}" height="40" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111"/><text x="10" y="27" font-family="Helvetica" font-size="22" fill="#fff">${(r.name + ' | ' + r.route + ' s=' + r.s + (r.note ? ' | ' + r.note : '')).replace(/&/g, '&amp;').replace(/</g, '&lt;').slice(0, 200)}</text></svg>`);
    comps.push({ input: label, left: 0, top: i * (H + 40) });
    for (let c = 0; c < 2; c++) comps.push({ input: await sharp(r.shots[c]).resize(W, H, { fit: 'cover' }).toBuffer(), left: c * W, top: i * (H + 40) + 40 });
    if (r.rect) { try { comps.push({ input: await sharp(r.rect).resize(360, H, { fit: 'inside', background: '#222' }).flatten({ background: '#222' }).toBuffer(), left: W * 2, top: i * (H + 40) + 40 }); } catch { /* unreadable rect */ } }
  }
  await sharp({ create: { width: W * 2 + 360, height: part.length * (H + 40), channels: 3, background: '#222' } }).composite(comps).png().toFile(`${out}/${tag}-sheet-${String(k + 1).padStart(2, '0')}.png`);
}
await b.close();

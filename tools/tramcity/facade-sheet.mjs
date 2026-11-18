#!/usr/bin/env node
// 24-facade review sheet: rectified real facade | the game's facade (screenshot facing the wall) | parameters + verdict.   node tools/tramcity/facade-sheet.mjs [from=0] [n=24] [out]
// needs the dev server on :5193 (npx vite --port 5193) and scripts/out/tramcity/review/selection.json (tools/tramcity/review.mjs)
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { chromium } from 'playwright';
const [FROM = '0', N = '24', OUT = 'scripts/out/tramcity/facade-review.png'] = process.argv.slice(2);
const sel = JSON.parse(fs.readFileSync('scripts/out/tramcity/review/selection.json', 'utf8')).slice(+FROM, +FROM + +N);
const meta = new Map(JSON.parse(fs.readFileSync('tools/.cache/sampling/meta-centrs.json', 'utf8')).buildings.map((b) => [b.id, b]));
const fin = JSON.parse(zlib.gunzipSync(fs.readFileSync('public/data/tram/facades-centrs.json.gz'))).b;
const raw = JSON.parse(fs.readFileSync('tools/.cache/tramcity/facades-raw.json', 'utf8'));
const dir = 'scripts/out/tramcity/_fac'; fs.mkdirSync(dir, { recursive: true });
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 760, height: 560 } });
await pg.goto('http://localhost:5193/tramvajs/?route=centrs-3&lang=en&quality=high');
await pg.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
await pg.addStyleTag({ content: '#start,#hud,.hud,#menu,#loading{display:none!important}' });
const rows = [];
for (const [k, s] of sel.entries()) {
  const [bid, ri] = s.key.split('_'); const mb = meta.get(+bid); const mr = mb.runs.find((x) => x.i === +ri); const r = (fin[bid] || []).find((x) => x.i === +ri);
  const cx = mb.x + (mr.a[0] + mr.b[0]) / 2, cz = mb.z + (mr.a[1] + mr.b[1]) / 2, H = Math.min(raw[bid].h, 34), d = Math.max(mr.len * 0.85, H * 1.15, 12);
  const g = mr.g || 0;
  await pg.evaluate((o) => window.__tram.setCamera(o), { x: cx + mr.n[0] * d, y: Math.min(10, H * 0.4) + g, z: cz + mr.n[1] * d, lx: cx, ly: H * 0.45, lz: cz, fov: 55 });
  await pg.waitForTimeout(450);
  const f = path.resolve(dir, `${k}.png`); await pg.screenshot({ path: f });
  rows.push({ no: +FROM + k + 1, key: s.key, game: 'file://' + f, img: 'file://' + path.resolve('tools/.cache/sampling/rect', s.key + '.png'), len: mr.len, H, r });
}
await b.close();
const html = `<body style="margin:0;background:#161616;color:#ddd;font:12px monospace"><div id=o></div><script>const rows=${JSON.stringify(rows)};
for(const R of rows){const d=document.createElement('div');d.style='display:flex;gap:6px;padding:3px;border-bottom:1px solid #444;height:230px;align-items:flex-start';
 const a=new Image();a.src=R.img;a.style='height:224px;max-width:380px;object-fit:contain';const g=new Image();g.src=R.game;g.style='height:224px';
 const t=document.createElement('div');t.style='width:380px;white-space:pre-wrap';const r=R.r||{};t.textContent='#'+R.no+' '+R.key+'\\nlen '+R.len.toFixed(1)+' m  H '+R.H.toFixed(1)+'\\nfloors '+((r.rows||[]).length)+'  cols '+((r.cols||[]).length)+'  gh '+(r.gh||'-')+'  gk '+(r.gk??'-')+'\\nalbedo '+(r.col!=null?'#'+r.col.toString(16).padStart(6,'0'):'generic')+'\\n'+(r.rows?'MEASURED rows/cols':'generic grid');
 d.append(a,g,t);document.getElementById('o').append(d);}</script>`;
const hf = path.resolve(dir, 'sheet.html'); fs.writeFileSync(hf, html);
const pp = await (await chromium.launch()).newPage({ viewport: { width: 1400, height: 400 } }); await pp.goto('file://' + hf); await pp.waitForTimeout(2000);
const h = await pp.evaluate(() => document.body.scrollHeight); await pp.setViewportSize({ width: 1400, height: h + 4 }); await pp.screenshot({ path: OUT }); await pp.context().browser().close();
console.log('wrote', OUT, rows.length);

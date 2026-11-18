#!/usr/bin/env node
// Review sheets: the ~N most visible measured facades of a route (by time in view from the cab): rectified real facade with the measured window rectangles drawn over it | a plain render of the parameters | parameters.
//   node tools/tramcity/review.mjs [route=centrs-3] [N=100] [perSheet=10] [out=scripts/out/tramcity/review]   (reads tools/.cache/tramcity/facades-raw.json, public/data/tram/facades-centrs.json.gz)
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { chromium } from 'playwright';
import { buildTrack } from '../../src/proto/tram/track.js';
const [route = 'centrs-3', N = '100', PER = '10', OUT = 'scripts/out/tramcity/review', FROM = '0'] = process.argv.slice(2);
const meta = new Map(JSON.parse(fs.readFileSync('tools/.cache/sampling/meta-centrs.json', 'utf8')).buildings.map((b) => [b.id, b]));
const raw = JSON.parse(fs.readFileSync('tools/.cache/tramcity/facades-raw.json', 'utf8'));
const fin = JSON.parse(zlib.gunzipSync(fs.readFileSync('public/data/tram/facades-centrs.json.gz'))).b;
const T = buildTrack(JSON.parse(fs.readFileSync(`src/proto/tram/routes/${route}.json`, 'utf8')));
const cand = [];
for (const [bid, runs] of Object.entries(fin)) {
  const mb = meta.get(+bid); if (!mb) continue;
  for (const r of runs) {
    const rr = raw[bid] && raw[bid].runs.find((x) => x.i === r.i); const mr = mb.runs.find((x) => x.i === r.i); if (!rr || !rr.m || !mr) continue;
    const mx = mb.x + (r.a[0] + r.b[0]) / 2, mz = mb.z + (r.a[1] + r.b[1]) / 2, nx = mr.n[0], nz = mr.n[1];
    let w = 0; const p = {};
    for (let s = 0; s < T.length; s += 5) { T.at(s, p); const dx = mx - p.x, dz = mz - p.z, d = Math.hypot(dx, dz); if (d < 8 || d > 110) continue; const hx = Math.cos(p.yaw), hz = Math.sin(p.yaw); const ang = (dx * hx + dz * hz) / d; if (ang < 0.55) continue; const face = -(dx * nx + dz * nz) / d; if (face < 0.25) continue; w += (r.len * face) / d; }
    if (w > 0) cand.push({ bid, r, rr, w, H: rr.m.H, px: rr.m.px });
  }
}
cand.sort((a, b) => b.w - a.w); const sel = cand.slice(+FROM, +FROM + +N);
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'selection.json'), JSON.stringify(sel.map((c) => ({ key: c.bid + '_' + c.r.i, w: c.w, len: c.r.len }))));
console.log('candidates', cand.length, 'selected', sel.length);
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
for (let k = 0; k * +PER < sel.length; k++) {
  const part = sel.slice(k * +PER, (k + 1) * +PER);
  const rows = part.map((c, j) => { const img = 'file://' + path.resolve('tools/.cache/sampling/rect', `${c.bid}_${c.r.i}.png`); return { key: `${c.bid}_${c.r.i}`, no: +FROM + k * +PER + j + 1, img, len: c.r.len, H: c.H, g: c.r.g || 0, px: c.px, r: c.r, bands: c.rr.m.floors.length, rm: c.rr.m }; });
  const html = `<body style="margin:0;background:#161616;color:#ddd;font:12px monospace"><div id=o></div><script>
const rows=${JSON.stringify(rows)};
for(const R of rows){const d=document.createElement('div');d.style='display:flex;gap:6px;padding:3px;border-bottom:1px solid #444;height:'+Math.round(Math.min(220,Math.max(90,R.H*8)))+'px';
 const sc=Math.min(7.5,640/(R.len*10)),W=R.len*10*sc,Hh=(R.H+0.5)*10*sc;
 const c1=document.createElement('canvas');c1.width=W;c1.height=Hh;const x=c1.getContext('2d');const im=new Image();im.onload=()=>{x.fillStyle='#777';x.fillRect(0,0,W,Hh);x.drawImage(im,0,0,W,Hh);
   const Y=(v)=>(R.H-(v-R.g))*10*sc; x.strokeStyle='rgba(255,40,40,.95)';x.lineWidth=1.5;
   if(R.r.rows&&R.r.cols){R.r.rows.forEach((rw,f)=>R.r.cols.forEach((cl,k)=>{if(!((R.r.mask[f]>>k)&1))return;x.strokeRect((cl[0]-cl[1]/2)*10*sc,Y(rw[1]),cl[1]*10*sc,(rw[1]-rw[0])*10*sc);}));}
   if(R.r.gc){x.strokeStyle='rgba(60,160,255,.95)';R.r.gc.forEach(cl=>x.strokeRect((cl[0]-cl[1]/2)*10*sc,Y((R.r.gh||3)-0.5),cl[1]*10*sc,(R.r.gh||3)*10*sc-0.5*10*sc-5*sc));}
   if(R.r.gh){x.strokeStyle='#4f4';x.beginPath();x.moveTo(0,Y(R.r.gh+R.g));x.lineTo(W,Y(R.r.gh+R.g));x.stroke();}
 };im.src=R.img;
 const c2=document.createElement('canvas');c2.width=W;c2.height=Hh;const y=c2.getContext('2d');y.fillStyle=R.r.col!=null?'#'+R.r.col.toString(16).padStart(6,'0'):'#bbb';y.fillRect(0,0,W,Hh);y.fillStyle='#223';
   if(R.r.rows&&R.r.cols){R.r.rows.forEach((rw,f)=>R.r.cols.forEach((cl,k)=>{if(!((R.r.mask[f]>>k)&1))return;const Y=(v)=>(R.H-(v-R.g))*10*sc;y.fillRect((cl[0]-Math.min(1.6,Math.max(.9,cl[1]))/2)*10*sc,Y((rw[0]+rw[1])/2+0.95),Math.min(1.6,Math.max(.9,cl[1]))*10*sc,1.9*10*sc);}));}
 const t=document.createElement('div');t.style='width:300px;white-space:pre-wrap;font-size:11px';
 const rs=R.r.rows||[];t.textContent='#'+R.no+' '+R.key+'\\nlen '+R.len.toFixed(1)+' m  H '+R.H.toFixed(1)+'\\nfloors(rows) '+rs.length+' (bands '+R.bands+')\\ncols '+(R.r.cols?R.r.cols.length:0)+'  gh '+(R.r.gh||'-')+' gk '+(R.r.gk??'-')+'\\nfloor y: '+rs.map(a=>a[0].toFixed(1)).join(' ')+'\\ncol u: '+(R.r.cols||[]).map(a=>a[0].toFixed(1)).join(' ')+'\\nalbedo '+(R.r.col!=null?'#'+R.r.col.toString(16).padStart(6,'0'):'-');
 d.append(c1,c2,t);document.getElementById('o').append(d);}
</script>`;
  const hf = path.resolve(OUT, `_r${k}.html`); fs.writeFileSync(hf, html); await page.goto('file://' + hf); await page.waitForTimeout(1500);
  const h = await page.evaluate(() => document.body.scrollHeight); await page.setViewportSize({ width: 1500, height: h + 5 });
  await page.screenshot({ path: path.join(OUT, `sheet-${String(k + 1).padStart(2, '0')}.png`) }); fs.rmSync(hf);
}
await browser.close(); console.log('sheets', Math.ceil(sel.length / +PER));

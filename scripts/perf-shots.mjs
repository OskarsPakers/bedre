// Visual regression for the perf pass: fixed cameras, frozen world (paused), per map. Pixel-diff before / after.
//   PERF_PORT=5185 GPU=1 node scripts/perf-shots.mjs shoot --dist scripts/.dist-base --tag base [--maps centrs,...] [--theme day] [--views a,b]
//   node scripts/perf-shots.mjs diff --a base --b cur --name <change>   -> scripts/out/perf-<name>-<map>-<view>.png (before | after | diff x4) + summary JSON
// Views: small / medium / large (hole radius 3 / 12 / 40 at gameplay zoom), intro (whole-city overview), far (max wheel zoom-out), forest (park / forest view).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, launch, sleep, arg, has } from './perf/lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
const maps = arg('--maps', 'centrs,agenskalns,mezaparks,purvciems').split(',');
const VIEWS = arg('--views', 'small,medium,large,intro,far,forest').split(',');
const theme = arg('--theme', 'day');
const shotsDir = (tag) => path.join(root, 'scripts', 'out', 'perf-shots', tag + (theme === 'day' ? '' : '-' + theme));
const quality = arg('--quality', 'high');

async function shoot() {
  const dist = path.resolve(root, arg('--dist', 'scripts/.dist-perf')), tag = arg('--tag', 'cur');
  const srv = await serve(dist, +(process.env.PERF_PORT || 5185));
  const browser = await launch('chromium');
  fs.mkdirSync(shotsDir(tag), { recursive: true });
  for (const map of maps) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    const open = async (extra = '') => {
      await page.goto(`http://localhost:${srv.port || process.env.PERF_PORT || 5185}/?map=${map}&quality=${quality}&theme=${theme}&radio=0&bots=0&sw=0${extra}`, { waitUntil: 'commit' });
      await page.waitForFunction(() => document.body && (document.body.dataset.ready === '1' || document.body.dataset.error), null, { timeout: 120000 });
    };
    const snap = async (name) => {
      await page.addStyleTag({ content: 'body > :not(canvas) { display: none !important; }' });
      await sleep(500);
      await page.locator('#c').screenshot({ path: path.join(shotsDir(tag), `${map}-${name}.png`) });
    };
    // gameplay views
    const place = (r, where) => page.evaluate(([r, where]) => {
      const g = window.__game, w = window.__life.world;
      g.start(); g.skipIntro();
      let [x, z] = g.spawn;
      if (where === 'forest') { // densest tree cluster: mean of the tree-class objects in the biggest 250 m cell
        const cells = new Map(); for (const o of w.objects) if (o.cls === 'tree') { const k = Math.floor(o.x / 150) + ',' + Math.floor(o.z / 150); const c = cells.get(k) || { n: 0, sx: 0, sz: 0 }; c.n++; c.sx += o.x; c.sz += o.z; cells.set(k, c); }
        let best = null; for (const c of cells.values()) if (!best || c.n > best.n) best = c; x = best.sx / best.n; z = best.sz / best.n;
      }
      g.teleport(x, z); g.setRadius(r); g.step(3.5);
      g.pause(true);
    }, [r, where]);
    await open();
    for (const [name, r, where] of [['small', 3], ['medium', 12], ['large', 40], ['forest', 14, 'forest']]) {
      if (!VIEWS.includes(name)) continue;
      await open(); await place(r, where); await snap(name);
    }
    if (VIEWS.includes('far')) { await open(); await place(30); await page.evaluate(() => { const g = window.__game; g.pause(false); g.zoomBy(100); g.step(4); g.pause(true); }); await snap('far'); }
    if (VIEWS.includes('intro')) { await open('&introhold=600'); await page.evaluate(() => { const g = window.__game; g.start(); g.step(0.2); g.pause(true); }); await snap('intro'); }
    if (errs.length) console.log(map, 'ERR', errs[0]);
    console.log('shot', tag, map);
    await ctx.close();
  }
  await browser.close(); await srv.close(); process.exit(0);
}

async function diff() {
  const a = arg('--a', 'base'), b = arg('--b', 'cur'), name = arg('--name', 'x');
  const browser = await launch('chromium');
  const page = await browser.newPage();
  await page.setContent('<canvas id=c></canvas>');
  const out = [], dirA = shotsDir(a), dirB = shotsDir(b);
  for (const map of maps) for (const view of VIEWS) {
    const fa = path.join(dirA, `${map}-${view}.png`), fb = path.join(dirB, `${map}-${view}.png`);
    if (!fs.existsSync(fa) || !fs.existsSync(fb)) continue;
    const r = await page.evaluate(async ([A, B]) => {
      const load = (b64) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + b64; });
      const ia = await load(A), ib = await load(B), w = ia.width, h = ia.height;
      const cv = (i) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(i, 0, 0); return x.getImageData(0, 0, w, h); };
      const da = cv(ia), db = cv(ib);
      let n0 = 0, n8 = 0, n24 = 0, sum = 0;
      const o = document.createElement('canvas'); o.width = w * 3; o.height = h; const ox = o.getContext('2d');
      ox.drawImage(ia, 0, 0); ox.drawImage(ib, w, 0);
      const dd = ox.createImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        const m = Math.max(Math.abs(da.data[i * 4] - db.data[i * 4]), Math.abs(da.data[i * 4 + 1] - db.data[i * 4 + 1]), Math.abs(da.data[i * 4 + 2] - db.data[i * 4 + 2]));
        if (m > 0) n0++; if (m > 8) n8++; if (m > 24) n24++; sum += m;
        const v = Math.min(255, m * 6); dd.data[i * 4] = v; dd.data[i * 4 + 1] = m > 24 ? 0 : v * 0.4; dd.data[i * 4 + 2] = m > 24 ? 0 : v * 0.4; dd.data[i * 4 + 3] = 255;
        if (m === 0) { dd.data[i * 4] = dd.data[i * 4 + 1] = dd.data[i * 4 + 2] = 18; }
      }
      ox.putImageData(dd, w * 2, 0);
      return { w, h, pct0: n0 / (w * h) * 100, pct8: n8 / (w * h) * 100, pct24: n24 / (w * h) * 100, mean: sum / (w * h), png: o.toDataURL('image/png').split(',')[1] };
    }, [fs.readFileSync(fa).toString('base64'), fs.readFileSync(fb).toString('base64')]);
    const f = path.join(root, 'scripts', 'out', `perf-${name}-${map}-${view}${theme === 'day' ? '' : '-' + theme}.png`);
    fs.writeFileSync(f, Buffer.from(r.png, 'base64'));
    const row = { map, view, theme, any: +r.pct0.toFixed(3), over8: +r.pct8.toFixed(3), over24: +r.pct24.toFixed(3), meanDiff: +r.mean.toFixed(3), file: path.relative(root, f) };
    out.push(row); console.log(`${map.padEnd(10)} ${view.padEnd(7)} differing(any) ${row.any}%  >8: ${row.over8}%  >24: ${row.over24}%`);
  }
  fs.writeFileSync(path.join(root, 'docs', 'perf', 'data', `visual-${name}${theme === 'day' ? '' : '-' + theme}.json`), JSON.stringify(out, null, 1));
  await browser.close(); process.exit(0);
}
await (mode === 'shoot' ? shoot() : diff());

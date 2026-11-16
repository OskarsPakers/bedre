// Roof colour share by footprint area (browser, real game build):  PORT=5185 GPU=1 node tools/detail/roof-stats.mjs [--sights=0|1] [--maps=centrs,...] [--label=x]
// Buckets: red/brown (clay tile), grey (tin / bitumen / slate), green (verdigris), cool = blue / teal / violet / saturated-cool, other.  Prints shares and writes tools/detail/data/roof-stats-<label>.json
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).slice(k.length + 3);
const sights = arg('sights', '1'), label = arg('label', sights === '0' ? 'before' : 'after'), maps = arg('maps', 'centrs,agenskalns,mezaparks,purvciems').split(',');
const PORT = process.env.PORT || 5185, base = `http://localhost:${PORT}`;
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const out = {};
for (const m of maps) {
  const page = await (await browser.newContext({ viewport: { width: 800, height: 500 } })).newPage();
  await page.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto(`${base}/?sights=${sights}&quality=high&intro=0&bots=0&placements=generate${m === 'centrs' ? '' : '&map=' + m}`);
  await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 180000 });
  out[m] = await page.evaluate(() => {
    const b = { red: 0, grey: 0, green: 0, cool: 0, other: 0 }, bs = { red: 0, grey: 0, green: 0, cool: 0, other: 0 };
    const sightIds = new Set();
    for (const it of window.__life.world.buildingItems) {
      if (!it.roofHex) continue;
      const r = ((it.roofHex >> 16) & 255) / 255, g = ((it.roofHex >> 8) & 255) / 255, bl = (it.roofHex & 255) / 255;
      const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl), d = mx - mn, l = (mx + mn) / 2, sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
      let h = 0; if (d) { h = mx === r ? ((g - bl) / d) % 6 : mx === g ? (bl - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360; }
      const k = sat < 0.14 ? 'grey' : (h < 45 || h >= 330) ? 'red' : (h >= 75 && h < 165) ? 'green' : (h >= 165 && h < 290) ? 'cool' : 'other';
      b[k] += it.area; if (it.sight) bs[k] += it.area;
    }
    return { all: b, sights: bs };
  });
  const t = Object.values(out[m].all).reduce((a, c) => a + c, 0);
  const pc = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +(100 * v / Math.max(1, t)).toFixed(1)]));
  out[m].pct = pc(out[m].all); out[m].pctSights = pc(out[m].sights);
  console.log(`[roof-stats ${label} ${m}] % of roof area: red/brown ${out[m].pct.red} grey ${out[m].pct.grey} green ${out[m].pct.green} COOL ${out[m].pct.cool} other ${out[m].pct.other}  (of which sights: cool ${out[m].pctSights.cool})`);
  await page.close();
}
fs.writeFileSync(path.join(root, 'tools/detail/data', `roof-stats-${label}.json`), JSON.stringify(out, null, 1));
await browser.close(); try { server.kill('SIGTERM'); } catch {} process.exit(0);

// Build step for the placement files (the multiplayer object table AND the client's prop/mover list, one file per map).
//   node tools/mp/build-objects.mjs [slug ...]     (alias: npm run build:mp)  ->  public/data/<slug>/riga-objects.bin.gz (centre: public/data/riga-objects.bin.gz)
//                                                                               + public/data/placements.json (manifest: content ids)  + placements.stamp.json
// It builds the client into its own temp dir, serves it, opens each map in headless Chromium with ?placements=generate (= run the real
// procedural scatter / movers / building code) and calls window.__placementsDump(). The result is the canonical placement file: from then
// on EVERY browser builds its props from it (the procedural scatter is not identical across JS engines) and the Worker reads the same bytes.
// GPU=1 uses the real GPU (WebGL needed). Re-run it whenever map data, building shapes, scatter / prop / traffic code changed
// (tools/mp/check-objects.mjs tells you; `npm run build` does it automatically).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fingerprint, STAMP, MANIFEST, fileOf, slugs, root } from './fingerprint.mjs';
import { parseTable, hashBytes } from '../../worker/mp/table.js';

const PORT = process.env.MP_TABLE_PORT || process.env.PORT || 5186;
const dist = path.join(root, 'scripts', `.dist-mptable-${PORT}`);
// MP_KEEP_DIST=<dir>: after generating, leave a client build of exactly these sources + the new files as <dir> (scripts/smoke-mp.mjs serves it).
const keep = process.env.MP_KEEP_DIST ? path.resolve(root, process.env.MP_KEEP_DIST) : null;
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const todo = only.length ? only : slugs();
const run = (cmd, args) => new Promise((res, rej) => spawn(cmd, args, { cwd: root, stdio: 'inherit' }).on('exit', (c) => (c ? rej(new Error(cmd + ' failed')) : res())));
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

const prints = Object.fromEntries(todo.map((s) => [s, fingerprint(s)])); // snapshot of the sources the files are built from
await run('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'error']);
const server = spawn('npx', ['vite', 'preview', '--outDir', dist, '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
const kill = () => { try { server.kill('SIGTERM'); } catch {} };
process.on('exit', kill);
const manifest = readJson(MANIFEST, { v: 2, maps: {} });
const stamp = readJson(STAMP, { maps: {} });
try {
  const base = `http://localhost:${PORT}`;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  const browser = await chromium.launch({
    headless: true,
    args: process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'],
  });
  for (const slug of todo) {
    const page = await (await browser.newContext({ viewport: { width: 800, height: 500 } })).newPage();
    await page.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.goto(`${base}/?map=${slug}&quality=high&placements=generate&intro=0`);
    await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 240000 });
    if (await page.evaluate(() => document.body.dataset.error)) throw new Error(`[${slug}] boot error: ` + (await page.evaluate(() => document.body.dataset.error)) + ' ' + errors.slice(0, 5).join(' | '));
    const r = await page.evaluate(() => {
      const d = window.__placementsDump();
      let s = '';
      const u8 = new Uint8Array(d.buf);
      for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return { b64: btoa(s), objects: d.objects, buildings: d.buildings, spawns: d.spawns, movers: d.movers, source: window.__life.world.placements.source };
    });
    if (r.source !== 'procedural') throw new Error(`[${slug}] expected the procedural world, got ${r.source}`);
    const raw = Buffer.from(r.b64, 'base64');
    const t = parseTable(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)); // round-trip sanity (the Worker's own parser)
    if (t.n !== r.objects || t.nB !== r.buildings) throw new Error(`[${slug}] table round-trip mismatch`);
    const gz = zlib.gzipSync(raw, { level: 9 });
    const f = fileOf(slug);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, gz);
    manifest.maps[slug] = { file: path.relative(path.join(root, 'public'), f), hash: hashBytes(new Uint8Array(raw)), objects: r.objects, buildings: r.buildings, movers: r.movers, spawns: r.spawns, bytes: raw.length, gz: gz.length };
    stamp.maps[slug] = { fingerprint: prints[slug] };
    console.log(`[${slug}] ${r.objects} objects (${r.buildings} buildings, ${r.movers} movers), ${r.spawns} spawn points, hash ${manifest.maps[slug].hash}, ${raw.length} B -> ${gz.length} B gz  ${path.relative(root, f)}`);
    if (errors.length) console.warn(`[${slug}] page errors:`, errors.slice(0, 3));
    await page.context().close();
  }
  await browser.close();
  manifest.v = 2;
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + '\n');
  fs.writeFileSync(STAMP, JSON.stringify(stamp, null, 1) + '\n');
} finally {
  kill();
  fs.rmSync(dist, { recursive: true, force: true });
}
// the client bakes the manifest hashes into its bundle: build again so a kept dist (or the next `vite build`) carries the new ids + files
if (keep) await run('npx', ['vite', 'build', '--outDir', keep, '--emptyOutDir', '--logLevel', 'error']);

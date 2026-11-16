// Build step for multiplayer: dump the object table (id -> x, z, fit, value, flags + spawn points) from the REAL client world.
//   node tools/mp/build-objects.mjs         (alias: npm run build:mp)  ->  public/mp/objects.bin
// It builds the client into its own temp dir, serves it, opens it in headless Chromium (needs WebGL: GPU=1 uses the real GPU)
// and calls window.__mpDump(). Because the table comes from the same world code as the client (buildings from riga.json +
// shapes, seeded scatter, movers), ids are identical on both sides. Re-run it whenever map data, building shapes, scatter or
// prop code changed; the server refuses clients whose object hash differs (they are told to reload).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprint, STAMP } from './fingerprint.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = process.env.MP_TABLE_PORT || process.env.PORT || 5186;
const dist = path.join(root, 'scripts', `.dist-mptable-${PORT}`);
const outFile = path.join(root, 'public', 'mp', 'objects.bin');
// MP_KEEP_DIST=<dir>: keep the temp build as <dir> with the table inside it (dist/mp/objects.bin). scripts/smoke-mp.mjs serves exactly that
// build, so client and table come from ONE snapshot of the (concurrently edited) sources.
const keep = process.env.MP_KEEP_DIST ? path.resolve(root, process.env.MP_KEEP_DIST) : null;
const run = (cmd, args) => new Promise((res, rej) => spawn(cmd, args, { cwd: root, stdio: 'inherit' }).on('exit', (c) => (c ? rej(new Error(cmd + ' failed')) : res())));

const printNow = fingerprint(); // snapshot of the sources this table is built from (stamped below)
await run('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'error']);
const server = spawn('npx', ['vite', 'preview', '--outDir', dist, '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
const kill = () => { try { server.kill('SIGTERM'); } catch {} };
process.on('exit', kill);
try {
  const base = `http://localhost:${PORT}`;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  const browser = await chromium.launch({
    headless: true,
    args: process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'],
  });
  const page = await (await browser.newContext({ viewport: { width: 800, height: 500 } })).newPage();
  await page.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`${base}/?quality=high`);
  await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 180000 });
  if (await page.evaluate(() => document.body.dataset.error)) throw new Error('boot error: ' + (await page.evaluate(() => document.body.dataset.error)) + ' ' + errors.slice(0, 5).join(' | '));
  const r = await page.evaluate(() => {
    const d = window.__mpDump();
    let s = '';
    const u8 = new Uint8Array(d.buf);
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return { b64: btoa(s), hash: d.hash, objects: d.objects, spawns: d.spawns, shapes: !!window.__life?.world?.shapeStats };
  });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const bytes = Buffer.from(r.b64, 'base64');
  fs.writeFileSync(outFile, bytes);
  fs.writeFileSync(STAMP, JSON.stringify({ fingerprint: printNow, hash: r.hash, objects: r.objects, built: new Date().toISOString() }) + '\n');
  if (keep) { fs.mkdirSync(path.join(dist, 'mp'), { recursive: true }); fs.writeFileSync(path.join(dist, 'mp', 'objects.bin'), bytes); fs.writeFileSync(path.join(dist, 'mp', 'objects.stamp.json'), fs.readFileSync(STAMP)); }
  console.log(`object table: ${r.objects} objects, ${r.spawns} spawn points, hash ${r.hash}, ${bytes.length} bytes -> ${path.relative(root, outFile)}`);
  if (errors.length) console.warn('page errors:', errors.slice(0, 3));
  await browser.close();
} finally {
  kill();
  if (keep) { fs.rmSync(keep, { recursive: true, force: true }); fs.renameSync(dist, keep); } else fs.rmSync(dist, { recursive: true, force: true });
}

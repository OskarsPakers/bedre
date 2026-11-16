// Staleness / consistency guard for the placement files (public/data/**/riga-objects.bin.gz + placements.json): they MUST come from the same
// world code + map data as the client, and the Worker's table must be the very same bytes the clients download. Fails loudly otherwise.
//   node tools/mp/check-objects.mjs                 exit 1 + instructions when stale / missing / inconsistent
//   node tools/mp/check-objects.mjs --fix           regenerate first (npm run build:mp: headless Chromium) when stale
//   node tools/mp/check-objects.mjs --dist <dir>    ALSO verify a built client (<dir>): same files byte for byte, manifest hashes baked into the JS bundle
// Wired into `npm run build` (with --fix), `npm run deploy` (with --dist dist), and scripts/smoke-mp.mjs. SKIP_MP_CHECK=1 bypasses it.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fingerprint, STAMP, MANIFEST, fileOf, slugs, root, DATA_DIR } from './fingerprint.mjs';
import { parseTable, hashBytes } from '../../worker/mp/table.js';

if (process.env.SKIP_MP_CHECK === '1') { console.log('[placements] check skipped (SKIP_MP_CHECK=1)'); process.exit(0); }
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const gunzip = (b) => (b[0] === 0x1f && b[1] === 0x8b ? zlib.gunzipSync(b) : b);

function problems() {
  const out = [];
  if (!fs.existsSync(MANIFEST)) return ['public/data/placements.json is missing'];
  if (!fs.existsSync(STAMP)) return ['public/data/placements.stamp.json is missing'];
  let man, st;
  try { man = readJson(MANIFEST); st = readJson(STAMP); } catch { return ['placements.json / placements.stamp.json unreadable']; }
  for (const s of slugs()) {
    const f = fileOf(s), rel = path.relative(root, f);
    if (!fs.existsSync(f)) { out.push(`${rel} is missing`); continue; }
    const m = man.maps && man.maps[s];
    if (!m) { out.push(`${s}: not in placements.json`); continue; }
    const raw = gunzip(fs.readFileSync(f));
    let t;
    try { t = parseTable(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)); } catch (e) { out.push(`${rel}: ${e.message}`); continue; }
    if (hashBytes(new Uint8Array(raw)) !== m.hash || t.hash !== m.hash) out.push(`${s}: file bytes do not match the manifest hash (${t.hash} vs ${m.hash})`);
    if (t.n !== m.objects) out.push(`${s}: object count differs from the manifest`);
    // ids = file indices: re-grouping the file into render chunks (src/world.js) must reproduce the file order exactly
    const groups = new Map();
    for (let i = t.nB; i < t.n; i++) {
      const kind = t.kinds[t.kind[i]], gk = t.flags[i] & 1 ? kind : `${kind}:${Math.floor(t.x[i] / 250)}:${Math.floor(t.z[i] / 250)}`;
      if (!groups.has(gk)) groups.set(gk, []);
      groups.get(gk).push(i);
    }
    let k = t.nB, drift = 0;
    for (const l of groups.values()) for (const i of l) { if (i !== k) drift++; k++; }
    if (drift) out.push(`${s}: ${drift} objects would get a different id than their file index (chunk regrouping drift)`);
    const now = fingerprint(s);
    if (!st.maps || !st.maps[s] || st.maps[s].fingerprint !== now) out.push(`${s}: world sources / map data changed since the file was built (stamp ${st.maps && st.maps[s] ? st.maps[s].fingerprint : 'none'}, sources ${now})`);
  }
  return out;
}

let why = problems();
if (why.length && process.argv.includes('--fix')) {
  console.log(`[placements] stale: ${why.join('; ')}. Rebuilding (npm run build:mp)...`);
  const r = spawnSync('node', ['tools/mp/build-objects.mjs'], { cwd: root, stdio: 'inherit', env: process.env });
  if (r.status) { console.error('[placements] rebuild FAILED (needs Chromium/WebGL). Run `GPU=1 npm run build:mp` where a browser works, or SKIP_MP_CHECK=1 to bypass.'); process.exit(1); }
  why = problems();
}
// built client: the files + manifest the page will fetch are exactly the checked ones, and the bundle carries the same ids
const di = process.argv.indexOf('--dist');
if (di > 0 && !why.length) {
  const dist = path.resolve(root, process.argv[di + 1] || 'dist');
  const man = readJson(MANIFEST);
  const dm = path.join(dist, 'data', 'placements.json');
  if (!fs.existsSync(dm) || fs.readFileSync(dm, 'utf8') !== fs.readFileSync(MANIFEST, 'utf8')) why.push(`${dist}/data/placements.json differs from public/data/placements.json (rebuild the client)`);
  const assets = path.join(dist, 'assets');
  const js = fs.existsSync(assets) ? fs.readdirSync(assets).filter((n) => n.endsWith('.js')).map((n) => fs.readFileSync(path.join(assets, n), 'utf8')).join('\n') : '';
  for (const s of slugs()) {
    const f = path.join(dist, path.relative(path.join(root, 'public'), fileOf(s)));
    if (!fs.existsSync(f) || !fs.readFileSync(f).equals(fs.readFileSync(fileOf(s)))) why.push(`${s}: ${path.relative(root, f)} missing or different in the build`);
    if (!js.includes(man.maps[s].hash)) why.push(`${s}: the built JS bundle does not carry hash ${man.maps[s].hash} (client built from an older manifest)`);
  }
}
if (why.length) {
  console.error(`\n[placements] PLACEMENT FILES NOT READY:\n  - ${why.join('\n  - ')}\n  Online play would be refused / props would differ between browsers. Run \`GPU=1 npm run build:mp\` (or \`node tools/mp/check-objects.mjs --fix\`), then build the client again.\n`);
  process.exit(1);
}
console.log(`[placements] OK: ${slugs().length} maps, files match the world sources${di > 0 ? ' and the built client' : ''}`);

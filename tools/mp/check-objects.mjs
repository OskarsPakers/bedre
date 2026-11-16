// Staleness guard for public/mp/objects.bin (the multiplayer object table). The table must come from the SAME world build as the client:
// a stale table makes online refuse every player ("version"). Compares the sources' fingerprint with the stamp written by build-objects.
//   node tools/mp/check-objects.mjs            exit 1 + instructions when stale / missing
//   node tools/mp/check-objects.mjs --fix      rebuild it first (npm run build:mp: headless Chromium) when stale
// Wired into `npm run build` (with --fix), `npm run deploy`, and scripts/smoke-mp.mjs. SKIP_MP_CHECK=1 bypasses it (e.g. a CI box without Chromium).
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fingerprint, STAMP, BIN, root } from './fingerprint.mjs';

if (process.env.SKIP_MP_CHECK === '1') { console.log('[mp-table] check skipped (SKIP_MP_CHECK=1)'); process.exit(0); }
const state = () => {
  if (!fs.existsSync(BIN)) return 'public/mp/objects.bin is missing';
  if (!fs.existsSync(STAMP)) return 'public/mp/objects.stamp.json is missing';
  let st; try { st = JSON.parse(fs.readFileSync(STAMP, 'utf8')); } catch { return 'objects.stamp.json is unreadable'; }
  const now = fingerprint();
  return st.fingerprint === now ? null : `world sources changed since the table was built (stamp ${st.fingerprint}, sources ${now})`;
};
let why = state();
if (why && process.argv.includes('--fix')) {
  console.log(`[mp-table] stale: ${why}. Rebuilding (npm run build:mp)...`);
  const r = spawnSync('node', ['tools/mp/build-objects.mjs'], { cwd: root, stdio: 'inherit', env: process.env });
  if (r.status) { console.error('[mp-table] rebuild FAILED (needs Chromium/WebGL). Run `GPU=1 npm run build:mp` where a browser works, or SKIP_MP_CHECK=1 to bypass.'); process.exit(1); }
  why = state();
}
if (why) {
  console.error(`\n[mp-table] STALE multiplayer object table: ${why}.\n  Online would refuse every client until it is rebuilt: run \`GPU=1 npm run build:mp\` (or \`node tools/mp/check-objects.mjs --fix\`).\n`);
  process.exit(1);
}
console.log('[mp-table] objects.bin matches the world sources');

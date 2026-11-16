// QA2 local stack: build -> scripts/.dist-qa2, worker bundle, wrangler dev on 8802 with state scripts/.qa2-state.
// usage: node scripts/qa2/server.mjs [--skip-build] [--short]   (--short: 70 s round / 4 s lobby; default = full round + 20 s lobby)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 8802, dist = path.join(root, 'scripts/.dist-qa2'), state = path.join(root, 'scripts/.qa2-state'), cfgPath = path.join(root, 'scripts/.wrangler-qa2.jsonc'), bundle = path.join(root, 'scripts/.qa2-worker');
const run = (c, a) => { const r = spawnSync(c, a, { cwd: root, stdio: 'inherit' }); if (r.status) throw new Error(c + ' failed'); };
if (!process.argv.includes('--skip-build')) { run('node', ['tools/mp/check-objects.mjs']); run('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'error']); run('node', ['tools/mp/check-objects.mjs', '--dist', dist]); }
fs.rmSync(state, { recursive: true, force: true }); fs.rmSync(bundle, { recursive: true, force: true });
const base = { name: 'bedre-qa2', compatibility_date: '2026-11-01',
  assets: { directory: './.dist-qa2', binding: 'ASSETS', not_found_handling: 'single-page-application', run_worker_first: ['/api/*'] },
  d1_databases: [{ binding: 'DB', database_name: 'bedre-scores', database_id: '00000000-0000-0000-0000-000000000000', migrations_dir: '../migrations' }],
  durable_objects: { bindings: [{ name: 'MP_ROOM', class_name: 'MpRoom' }, { name: 'MP_MATCHMAKER', class_name: 'MpMatchmaker' }] },
  migrations: [{ tag: 'mp-v1', new_sqlite_classes: ['MpRoom', 'MpMatchmaker'] }] };
fs.writeFileSync(cfgPath, JSON.stringify({ ...base, main: '../worker/index.js' }));
run('npx', ['wrangler', 'deploy', '--dry-run', '--config', cfgPath, '--outdir', bundle]);
fs.writeFileSync(cfgPath, JSON.stringify({ ...base, main: './.qa2-worker/index.js' }));
run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'bedre-scores', '--local', '--config', cfgPath, '--persist-to', state]);
const vars = process.argv.includes('--short') ? ['--var', 'MP_ROUND_SECONDS:70', '--var', 'MP_LOBBY_SECONDS:4', '--var', 'MP_RESULTS_SECONDS:25'] : [];
const wr = spawn('npx', ['wrangler', 'dev', '--config', cfgPath, '--port', String(PORT), '--persist-to', state, ...vars], { cwd: root, stdio: 'inherit' });
process.on('SIGTERM', () => { wr.kill('SIGTERM'); process.exit(0); });
wr.on('exit', (c) => process.exit(c || 0));

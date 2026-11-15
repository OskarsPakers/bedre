// Shared helpers for scripts/smoke-api.mjs and scripts/smoke-e2e.mjs. Parallel-safe: every run builds into its own
// outDir (never the shared dist/), uses its own wrangler config, persistence dir and ports (never the shared 8791-8793).
import { spawn, spawnSync } from 'node:child_process';
import { rmSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: opts.quiet ? 'pipe' : 'inherit' });
  if (r.status !== 0 && !opts.allowFail) { console.error(`failed: ${cmd} ${args.join(' ')}\n${r.stdout || ''}${r.stderr || ''}`); process.exit(1); }
  return r;
}

/** vite build into scripts/.dist-<name> (own directory, nothing shared). */
export function buildInto(name) {
  const dir = resolve(root, `scripts/.dist-${name}`);
  run('npx', ['vite', 'build', '--outDir', dir, '--emptyOutDir', '--logLevel', 'error']);
  return dir;
}

/** Writes scripts/.tmp-<name>/wrangler.jsonc (same Worker + D1 id as the real one, other assets dir) and returns its path. */
export function writeConfig(name, assetsDir, migrationsDir = resolve(root, 'migrations')) {
  const real = readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8');
  const dbId = /"database_id":\s*"([^"]+)"/.exec(real)[1];
  const dir = resolve(root, `scripts/.tmp-${name}`);
  mkdirSync(dir, { recursive: true });
  const cfg = {
    name: `bedre-test-${name}`, main: resolve(root, 'worker/index.js'), compatibility_date: '2026-11-01',
    assets: { directory: assetsDir, binding: 'ASSETS', not_found_handling: 'single-page-application', run_worker_first: ['/api/*'] },
    d1_databases: [{ binding: 'DB', database_name: 'bedre-scores', database_id: dbId, migrations_dir: migrationsDir }],
  };
  const path = resolve(dir, 'wrangler.jsonc');
  writeFileSync(path, JSON.stringify(cfg, null, 2));
  return path;
}

export function migrate(config, persist) {
  run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'bedre-scores', '--local', '--persist-to', persist, '--config', config], { quiet: true });
}

/** Local SQL against the persisted D1 (rows as objects). */
export function sql(config, persist, query) {
  const r = run('npx', ['wrangler', 'd1', 'execute', 'bedre-scores', '--local', '--persist-to', persist, '--config', config, '--json', '--command', query], { quiet: true });
  const j = JSON.parse(r.stdout);
  return (j[0] && j[0].results) || [];
}

/** Starts `wrangler dev`; resolves once / answers. vars = { NAME: 'value' }. Returns { base, kill, log() }. */
export async function startWorker({ config, persist, port, vars = {} }) {
  const args = ['wrangler', 'dev', '--config', config, '--port', String(port), '--persist-to', persist, '--ip', '127.0.0.1'];
  for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`);
  const child = spawn('npx', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = '';
  child.stdout.on('data', (d) => (log += d)); child.stderr.on('data', (d) => (log += d));
  const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
  process.on('exit', kill);
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 160 && !ready; i++) {
    try { ready = (await fetch(base + '/')).ok; } catch {}
    if (!ready) await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready) { kill(); throw new Error('wrangler dev not ready\n' + log); }
  return { base, kill, log: () => log };
}

export const freshDir = (p) => { rmSync(p, { recursive: true, force: true }); mkdirSync(p, { recursive: true }); return p; };
export { cpSync, rmSync, mkdirSync, writeFileSync, resolve };

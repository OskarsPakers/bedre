// Self-contained static server for a BUILT client: builds into its own outDir (skipped with --no-build / when `url` is given) and runs
// `vite preview` on its own port; stop() (also on process exit) kills it.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export async function startBuilt({ url, port, outDir, noBuild = false }) {
  if (url) return { base: url, stop() {} };
  const dist = path.join(root, 'scripts', outDir);
  if (!noBuild) await build({ root, logLevel: 'error', build: { outDir: dist, emptyOutDir: true, chunkSizeWarningLimit: 5000 } });
  const srv = spawn('npx', ['vite', 'preview', '--outDir', dist, '--port', String(port), '--strictPort'], { cwd: root, stdio: 'pipe', detached: true });
  const stop = () => { try { process.kill(-srv.pid, 'SIGKILL'); } catch {} };
  process.on('exit', stop);
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 120; i++) { try { if ((await fetch(base)).ok) return { base, stop }; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  stop(); throw new Error('vite preview did not start on ' + port);
}

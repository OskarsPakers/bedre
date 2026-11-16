// Real playback check of the radio (Latvijas Radio 2, HLS): headless Chromium opens the game, clicks the radio button, and waits up to
// ~15 s for the <audio> element to reach `playing` with currentTime advancing. hls.js is the BUNDLED dependency (no third-party script).
// Needs network access to the LSM CDN: without it (or when the browser build has no AAC) the check is SOFT: it reports why and exits 0.
//   RADIO_URL=http://localhost:5187 node scripts/check-radio.mjs [--hlsjs]   (--hlsjs forces the bundled hls.js path; Chrome 142+ / Safari play HLS natively)     (default: starts its own preview of a fresh build on RADIO_PORT 5192; --strict makes a failure exit 1)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let base = process.env.RADIO_URL, server = null;
if (!base) {
  const PORT = +(process.env.RADIO_PORT || 5192), dist = path.join(root, 'scripts', '.dist-radio');
  await build({ root, logLevel: 'error', build: { outDir: dist, emptyOutDir: true, chunkSizeWarningLimit: 5000 } });
  server = spawn('npx', ['vite', 'preview', '--outDir', dist, '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe', detached: true });
  base = `http://localhost:${PORT}`;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
}
const kill = () => { try { if (server) process.kill(-server.pid, 'SIGKILL'); } catch {} };
process.on('exit', kill);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.route('**/api/**', (r) => r.fulfill({ status: 503, body: '{}' }));
const page = await ctx.newPage();
const thirdParty = new Set();
page.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== new URL(base).origin) thirdParty.add(u.origin + ' (' + r.resourceType() + ')'); });
const forceJs = process.argv.includes('--hlsjs'); // exercise the bundled hls.js path (Chrome now plays HLS natively)
await page.goto(`${base}/?radio=1&quality=low${forceJs ? '&hlsjs=1' : ''}`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
const env = await page.evaluate(() => ({
  ua: navigator.userAgent, nativeHls: !!document.createElement('audio').canPlayType('application/vnd.apple.mpegurl'),
  aac: window.MediaSource ? MediaSource.isTypeSupported('audio/mp4; codecs="mp4a.40.2"') : false, mse: !!window.MediaSource,
}));
await page.click('#radio-btn');
let st = null;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(500);
  st = await page.evaluate(() => { const a = window.__radio.audio; return { t: a.currentTime, paused: a.paused, ready: a.readyState, err: a.error && a.error.code, status: document.querySelector('#radio-pop .rs').textContent, on: window.__radio.on }; });
  if (st.t > 1.0 && !st.paused) break;
}
const t1 = st.t;
await page.waitForTimeout(1500);
const st2 = await page.evaluate(() => ({ t: window.__radio.audio.currentTime, paused: window.__radio.audio.paused }));
const played = st.t > 1.0 && !st.paused && st2.t > t1;
console.log('environment:', JSON.stringify(env));
console.log('state:', JSON.stringify(st), 'later', JSON.stringify(st2));
console.log('third-party origins contacted:', [...thirdParty].join(', ') || 'none');
const scriptsFromCdn = [...thirdParty].filter((x) => /\(script\)/.test(x));
console.log(`RADIO: ${played ? 'PLAYED (currentTime advanced to ' + st2.t.toFixed(1) + ' s)' : 'did NOT reach playing within 15 s' + (st.status ? ` (UI status: "${st.status}")` : '')}; third-party SCRIPTS loaded: ${scriptsFromCdn.length ? scriptsFromCdn.join(', ') : 'none'}`);
await browser.close(); kill();
process.exit(scriptsFromCdn.length || (!played && process.argv.includes('--strict')) ? 1 : 0);

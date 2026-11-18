// Generates public/og.png (1200x630): a real in-game overview screenshot as background + logo/title composition (rendered by Playwright).
//   PORT=5188 GPU=1 node tools/meta/og.mjs [--dist scripts/.dist-5188]   (builds into the dist dir unless --dist points to an existing build)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = process.env.PORT || 5188;
const argDist = process.argv.includes('--dist') ? process.argv[process.argv.indexOf('--dist') + 1] : null;
const dist = path.resolve(root, argDist || `scripts/.dist-${PORT}`);
if (!argDist) await new Promise((res, rej) => spawn('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'error'], { cwd: root, stdio: 'inherit' }).on('exit', (c) => (c ? rej(new Error('build failed')) : res())));
const server = spawn('npx', ['vite', 'preview', '--outDir', dist, '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
const kill = () => { try { server.kill('SIGTERM'); } catch {} };
process.on('exit', kill);
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }

const browser = await chromium.launch({ headless: true, args: process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1800, height: 1000 } });
await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
const page = await ctx.newPage();
await page.goto(`http://localhost:${PORT}/?autostart=1&introhold=999&bots=0&radio=0&sw=0&theme=day`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
// zoom into a nice slice of the Old Town / Daugava: use the follow camera at a mid distance instead of the full overview
await page.evaluate(() => { const g = window.__game; g.skipIntro(); g.teleport(-380, 330); g.setRadius(48); });
await page.addStyleTag({ content: '#hud,#tags,#markers,#labels,#popups,#feed,#mute-btn,#radio-btn,#radio-pop,#meta-pct,#meta-area,#meta-toasts,#joystick,.go{display:none!important}' });
await page.evaluate(() => { window.__game.zoomBy(0.8); window.__game.pause(false); });
await new Promise((r) => setTimeout(r, 1500));
const bg = await page.screenshot({ type: 'jpeg', quality: 92 });
await browser.close(); kill();

const b64 = bg.toString('base64');
const html = `<html><body style="margin:0;width:1200px;height:630px;overflow:hidden;position:relative;font-family:'Avenir Next','Segoe UI',system-ui,sans-serif;background:#2b3a4a">
<img src="data:image/jpeg;base64,${b64}" style="position:absolute;inset:0;width:1200px;height:630px;object-fit:cover;object-position:center 60%;filter:saturate(1.05)"/>
<div style="position:absolute;inset:0;background:linear-gradient(100deg,rgba(29,40,51,.96) 0%,rgba(29,40,51,.88) 38%,rgba(29,40,51,.25) 70%,rgba(29,40,51,0) 100%)"></div>
<div style="position:absolute;left:70px;top:120px;color:#f6efdf">
  <div style="display:flex;align-items:center;gap:28px">
    <div style="width:112px;height:112px;border-radius:50%;background:radial-gradient(circle at 50% 38%,#43302b 0,#0b0807 60%,#000 100%);box-shadow:0 0 0 14px #d9552f,0 14px 30px rgba(0,0,0,.5)"></div>
    <div style="font-size:150px;font-weight:900;letter-spacing:.05em;line-height:1">BEDRE</div>
  </div>
  <div style="margin:18px 0 0 142px;font-size:44px;font-weight:800;letter-spacing:.42em;color:#ef7a52">RĪGA</div>
  <div style="margin:34px 0 0 6px;font-size:36px;font-weight:700;line-height:1.3;max-width:700px;color:#e9e2d2">Norij pilsētu. Audz.<br><span style="color:#aebccb;font-size:28px;font-weight:600">Swallow the city. Out-grow 7 rivals.</span></div>
</div>
<div style="position:absolute;left:76px;bottom:44px;font-size:30px;font-weight:800;color:#f6efdf;letter-spacing:.04em">bedre.pakers.lv</div>
</body></html>`;
const b2 = await chromium.launch();
const pg = await b2.newPage({ viewport: { width: 1200, height: 630 } });
await pg.setContent(html);
await new Promise((r) => setTimeout(r, 400));
await pg.screenshot({ path: path.join(root, 'public', 'og.png'), type: 'png' });
await b2.close();
console.log('wrote public/og.png');

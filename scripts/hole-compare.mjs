// Proof that the hole game is unchanged by the tram city work: 6 fixed free-camera screenshots of the hole game from (A) a clean `git archive HEAD` export and (B) the working tree, same settings, and the % of differing pixels.
//   mkdir -p /tmp/holeio-head && git archive HEAD | tar -x -C /tmp/holeio-head && ln -s $PWD/node_modules /tmp/holeio-head/node_modules
//   GPU=1 node scripts/hole-compare.mjs /tmp/holeio-head        (serves each tree with vite on :5193, writes scripts/out/hole-compare/{head,work}-<n>.png and diff-<n>.png)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const headDir = path.resolve(process.argv[2] || '/tmp/holeio-head'), workDir = process.cwd(), out = path.join(workDir, 'scripts/out/hole-compare'); fs.mkdirSync(out, { recursive: true });
const PORT = 5193, base = `http://localhost:${PORT}`;
const CAMS = [ // [name, position, look-at, fov]  (world metres, y up; centre map)
  ['opera', [75, 70, 180], [54, 8, 264], 45], ['oldtown', [-500, 150, 600], [-400, 10, 300], 50], ['market', [300, 90, 800], [100, 5, 900], 50],
  ['boulevard', [-60, 60, 80], [40, 5, 300], 50], ['station', [300, 80, 1200], [300, 5, 1000], 55], ['canal', [-200, 120, 300], [100, 0, 200], 55],
];
const serve = (dir) => { const s = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: dir, stdio: 'pipe' }); return s; };
async function shoot(dir, tag) {
  const srv = serve(dir); const kill = () => { try { srv.kill('SIGTERM'); } catch {} };
  for (let i = 0; ; i++) { try { if ((await fetch(base)).ok) break; } catch {} if (i > 120) { kill(); throw new Error('no server'); } await new Promise((r) => setTimeout(r, 250)); }
  const b = await chromium.launch({ headless: true, args: process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await p.goto(`${base}/?quality=high&intro=0&bots=0&theme=day`);
  await p.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 180000 });
  await p.evaluate(() => window.__game.start()); await p.waitForTimeout(2500);
  await p.addStyleTag({ content: 'body > *:not(canvas){display:none!important}' });
  for (const [i, [name, pos, look, fov]] of CAMS.entries()) {
    await p.evaluate(() => { window.__game.teleport(1150, 1150); window.__game.setRadius(2); });
    await p.evaluate(([pp, l, f]) => { const cm = window.__life.game.cam; if (!cm._apply) cm._apply = cm.apply; cm.apply = () => {}; const c = cm.camera; c.position.set(...pp); c.fov = f; c.near = 1; c.far = 6000; c.lookAt(...l); c.updateProjectionMatrix(); const L = window.__life.game.light; if (!L._upd) L._upd = L.update; L.update = () => {}; }, [pos, look, fov]);
    await p.waitForTimeout(1500); await p.screenshot({ path: path.join(out, `${tag}-${i + 1}-${name}.png`) });
  }
  await b.close(); kill(); await new Promise((r) => setTimeout(r, 1500));
}
await shoot(headDir, 'head'); await shoot(headDir, 'head2'); await shoot(workDir, 'work');
const cmp = async (t1, t2, tag, thr) => { let tot = 0, dif = 0; const per = [];
  for (const [i, [name]] of CAMS.entries()) {
    const A = await sharp(path.join(out, `${t1}-${i + 1}-${name}.png`)).raw().toBuffer({ resolveWithObject: true }), B = await sharp(path.join(out, `${t2}-${i + 1}-${name}.png`)).raw().toBuffer({ resolveWithObject: true });
    const n = A.info.width * A.info.height, ch = A.info.channels; let d = 0; const D = Buffer.alloc(n * 3);
    for (let k = 0; k < n; k++) { const x = Math.max(Math.abs(A.data[k * ch] - B.data[k * ch]), Math.abs(A.data[k * ch + 1] - B.data[k * ch + 1]), Math.abs(A.data[k * ch + 2] - B.data[k * ch + 2])); if (x > thr) { d++; D[k * 3] = 255; } else { D[k * 3] = A.data[k * ch] >> 2; D[k * 3 + 1] = A.data[k * ch + 1] >> 2; D[k * 3 + 2] = A.data[k * ch + 2] >> 2; } }
    if (tag === 'work-vs-head' && thr === 10) await sharp(D, { raw: { width: A.info.width, height: A.info.height, channels: 3 } }).png().toFile(path.join(out, `diff-${i + 1}-${name}.png`));
    per.push(`${name} ${(100 * d / n).toFixed(2)}%`); tot += n; dif += d;
  }
  console.log(`${tag} (> ${thr}/255): ${per.join(', ')} | total ${(100 * dif / tot).toFixed(3)} %`); };
await cmp('head', 'head2', 'head-vs-head2 (noise floor: same code twice)', 10); await cmp('head', 'head2', 'head-vs-head2 (noise floor: same code twice)', 40);
await cmp('head', 'work', 'work-vs-head', 10); await cmp('head', 'work', 'work-vs-head', 40);

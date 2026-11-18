// hero stills + turntable + drive-past clip (frames in tools/.cache/onebuilding/work/frames, mp4 in scripts/out/onebuilding)
import { withPage } from './shot.mjs'; import fs from 'node:fs'; import { execFileSync } from 'node:child_process'; import { toWorld } from './frame.js';
const OUT = '/Users/oskars/projects/holeio/scripts/out/onebuilding/', FR = '/Users/oskars/projects/holeio/tools/.cache/onebuilding/work/frames/'; fs.mkdirSync(FR, { recursive: true });
const what = process.argv[2] || 'all', HERO = what === 'hero', VW = HERO ? 2400 : 1280, VH = HERO ? 1350 : 720;
await withPage(async pg => {
  await pg.goto(`http://localhost:5196/viewer.html?noui=1&w=${VW}&h=${VH}&model=hybrid&lod=0&ctx=1`); await pg.waitForFunction('window.__v?.ready', null, { timeout: 240000 });
  const C = toWorld(20, 20, 12);
  if (what === 'all' || what === 'hero') { const p = toWorld(-44, -30, 8), t = toWorld(10, 16, 13);
    for (const [name, model, theme] of [['hero', 'hybrid', 'day'], ['hero-ref', 'ref', 'day'], ['hero-evening', 'hybrid', 'evening'], ['hero-winter', 'hybrid', 'winter']]) { await pg.evaluate(async ([model, theme, p, t]) => { await __v.set({ model, theme, lod: 0 }); __v.ctxToggle(true); __v.orbit([p[0], 8, p[2]], [t[0], 12, t[2]], 50); }, [model, theme, p, t]); await pg.waitForTimeout(400); await pg.screenshot({ path: OUT + `${name}.png` }); console.log(name); }
  }
  if (what === 'all' || what === 'turn') { await pg.evaluate(async () => { await __v.set({ model: 'hybrid', theme: 'day', lod: 0 }); __v.ctxToggle(false); });
    for (const f of fs.readdirSync(FR)) fs.unlinkSync(FR + f); const N = 150;
    for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2 - Math.PI * 0.8, R = 92, p = [C[0] + Math.cos(a) * R, 26, C[2] + Math.sin(a) * R]; await pg.evaluate(([p, C]) => __v.orbit(p, [C[0], 12, C[2]], 40), [p, C]); await pg.screenshot({ path: FR + `t${String(i).padStart(4, '0')}.png` }); }
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', FR + 't%04d.png', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', OUT + 'turntable.mp4']); console.log('turntable'); }
  if (what === 'all' || what === 'drive') { await pg.evaluate(async () => { await __v.set({ model: 'hybrid', theme: 'day', lod: 0 }); __v.ctxToggle(true); });
    for (const f of fs.readdirSync(FR)) fs.unlinkSync(FR + f); let n = 0; for (let s = 1180; s <= 1410; s += 0.95, n++) { await pg.evaluate(async (s) => { await __v.set({ view: 'chase', s }); }, s); await pg.screenshot({ path: FR + `d${String(n).padStart(4, '0')}.png` }); }
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '24', '-i', FR + 'd%04d.png', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', OUT + 'drive-past.mp4']); console.log('drive', n); }
}, { w: VW, h: VH });

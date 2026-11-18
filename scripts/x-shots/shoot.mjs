// node scripts/x-shots/shoot.mjs '<json scenes>' [theme] [WxH] [dsf] [outdir]
// scenes: [{tag, r, start:[x,z], zoom, avoid:[[x,z,rad]], frames, passes, lo, hi, dir:[dx,dz]}] ascending r (the hole only grows)
import { open, growTo, alive, sleep } from './lib.mjs';
import fs from 'node:fs';
const scenes = JSON.parse(process.argv[2]);
const theme = process.argv[3] || 'day';
const [W, H] = (process.argv[4] || '1600x900').split('x').map(Number);
const dsf = +(process.argv[5] || 2);
const outdir = process.argv[6] || 'scripts/out/x-shots/candidates/burst';
const extra = process.argv[7] === 'none' ? '' : (process.argv[7] || '&time=3000');
fs.mkdirSync(outdir, { recursive: true });
const { browser, page } = await open({ w: W, h: H, dsf, theme, extra });
for (const s of scenes) {
  const got = await growTo(page, s.r, s.home || [950, 250]);
  const missing = await page.evaluate((need) => need.filter((n) => {
    const os = window.__life.world.objects;
    if (typeof n === 'string') { const o = os.find((q) => q.kind === n); return !o || o.state !== 0; }
    const [nm, x, z] = n; const c = os.filter((q) => q.name === nm && Math.hypot(q.x - x, q.z - z) < 40);
    return !c.length || c.some((q) => q.state !== 0);
  }), s.need || []);
  if (missing.length) { console.log('MISSING', s.tag, missing); await browser.close(); process.exit(3); }
  console.log(s.tag, 'radius', got.toFixed(1), JSON.stringify(await alive(page)));
  for (let pass = 0; pass < (s.passes || 1); pass++) {
    await page.evaluate(([x, z, zoom]) => { const g = window.__game; g.teleport(x, z); g.zoomBy(zoom / g.cam.zoom); }, [...s.start, s.zoom || 1]);
    await sleep(s.settle ?? 4200);
    // pick a juicy target: an eatable building (fit between lo*r and hi*r) in front of the hole, away from the sights listed in avoid
    const tgt = await page.evaluate(({ avoid, lo, hi, dir, start, bOnly }) => {
      const g = window.__game, h = g.hole, w = window.__life.world;
      let best = null, bs = -1e9;
      for (const o of w.objects) {
        if (o.state !== 0 || o.kind === 'freedom' || (bOnly && o.kind !== 'building')) continue;
        if (o.fit < h.radius * lo || o.fit > h.radius * hi) continue;
        const dx = o.x - h.x, dz = o.z - h.z, d = Math.hypot(dx, dz);
        if (d < h.radius * 0.8 || d > h.radius * 5 + 25) continue;
        if (avoid.some(([ax, az, ar]) => Math.hypot(o.x - ax, o.z - az) < ar)) continue;
        const along = dir ? (dx * dir[0] + dz * dir[1]) / d : 0;
        const sc = o.fit * 2 - d + along * 30;
        if (sc > bs) { bs = sc; best = o; }
      }
      return best ? { x: best.x, z: best.z, fit: best.fit, name: best.name || null } : null;
    }, { avoid: s.avoid || [], lo: s.lo || 0.25, hi: s.hi || 0.85, dir: s.dir || null, start: s.start, bOnly: !!s.bOnly });
    console.log('  target', JSON.stringify(tgt));
    if (!tgt) continue;
    const aim = async () => { // steer like a player: point the mouse at the target on screen
      const p = await page.evaluate(([x, z]) => { const cam = window.__life.game.cam.camera, v = cam.position.clone().set(x, 0, z).project(cam); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (1 - (v.y * 0.5 + 0.5)) * innerHeight }; }, [tgt.x, tgt.z]);
      await page.mouse.move(Math.max(5, Math.min(W - 5, p.x)), Math.max(5, Math.min(H - 5, p.y)));
    };
    await aim();
    for (let i = 0; i < (s.frames || 24); i++) {
      await aim();
      const info = await page.evaluate(() => ({ f: window.__game.counts.falling, x: window.__game.hole.x, z: window.__game.hole.z }));
      await page.screenshot({ path: `${outdir}/${s.tag}-${theme}-p${pass}-${String(i).padStart(2, '0')}-f${info.f}.png` });
      await sleep(s.gap ?? 60);
    }
    await page.mouse.move(W / 2, H / 2 + 60);
  }
}
console.log('final', JSON.stringify(await page.evaluate(() => window.__game.leaderboard().slice(0, 5))));
await browser.close();

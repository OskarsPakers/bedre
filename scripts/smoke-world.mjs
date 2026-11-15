// World life & feel smoke test: movers, audio, particles, Freedom Monument, label throttling, perf, screenshots (scripts/out/world-*.png).
//   PORT=5182 GPU=1 npm run smoke:world [-- --sample]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts', 'out');
fs.mkdirSync(out, { recursive: true });
const PORT = process.env.PORT || 5182;
const base = `http://localhost:${PORT}`;
const sample = process.argv.includes('--sample');
const tag = sample ? '-sample' : '';
const query = ['quality=high', 'intro=0', 'bots=0', sample ? 'sample=1' : ''].filter(Boolean).join('&');

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));
const kill = () => { try { server.kill('SIGTERM'); } catch {} };
process.on('exit', kill);
async function waitServer() {
  for (let i = 0; i < 80; i++) { try { const r = await fetch(base); if (r.ok) return; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  throw new Error('server did not start\n' + serverLog);
}
let failures = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); if (!ok) failures++; };
const errors = [];

async function main() {
  await waitServer();
  const browser = await chromium.launch({
    headless: true,
    args: process.env.GPU
      ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--autoplay-policy=no-user-gesture-required']
      : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  // no worker behind the static preview: answer /api quietly (the offline path is covered by final-shots.mjs, the live one by smoke-e2e.mjs)
  await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(`${base}/?${query}${process.env.MAP ? '&map=' + process.env.MAP : ''}`);
  await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 120000 });
  const err = await page.evaluate(() => document.body.dataset.error);
  if (err) throw new Error('boot error ' + err);
  const G = (fn, arg) => page.evaluate(fn, arg);
  const shot = async (name) => { await G(() => window.__game.render()); await page.waitForTimeout(300); await page.screenshot({ path: path.join(out, `world-${name}${tag}.png`) }); };

  // ---- audio unlock via a real click on the page
  const preCtx = await G(() => !!window.__life.audio.ctx);
  await page.mouse.click(640, 360);
  await page.waitForTimeout(300);
  const au = await G(() => ({ has: !!window.__life.audio.ctx, state: window.__life.audio.ctx && window.__life.audio.ctx.state, errors: window.__life.audio.stats.errors }));
  check('audio context created lazily and running after click', !preCtx && au.has && au.state === 'running' && au.errors === 0, JSON.stringify(au));
  const mute = await G(() => { const b = document.getElementById('mute-btn'); const t0 = b.textContent; b.click(); const t1 = b.textContent; const stored = localStorage.getItem('bedre.muted'); b.click(); return { t0, t1, stored, back: b.textContent }; });
  check('mute button toggles + persists', mute.t0 !== mute.t1 && mute.stored === '1' && mute.back === mute.t0, JSON.stringify(mute));

  await G(() => window.__game.start());
  await G(() => window.__game.step(0.2));

  // ---- movers
  const mv = await G(() => {
    const T = window.__life.traffic, w = window.__life.world;
    const cls = {};
    for (const o of T.list) cls[o.m.cls] = (cls[o.m.cls] || 0) + 1;
    return { n: T.list.length, cls, objects: w.objects.length };
  });
  console.log('movers:', JSON.stringify(mv));
  check('movers exist (cars/buses/trams/walkers)', mv.n > 100 && (mv.cls.car || 0) > 30 && (mv.cls.walk || 0) > 30 && (mv.cls.trolley || 0) > 3, JSON.stringify(mv.cls));
  const mv0 = await G(() => window.__life.traffic.list.map((o) => [o.x, o.z]));
  await G(() => window.__game.teleport(window.__life.world.spawn[0], window.__life.world.spawn[1]));
  await G(() => window.__game.step(12));
  const mv1 = await G(() => {
    const T = window.__life.traffic, w = window.__life.world, d = w.data;
    const P = T.list.map((o) => [o.x, o.z]);
    const segs = [];
    for (const r of d.roads) { if (!r.p) continue; for (let i = 0; i < r.p.length - 1; i++) segs.push([r.p[i][0], r.p[i][1], r.p[i + 1][0], r.p[i + 1][1], r.w || 6, r.k]); }
    const dist = (x, z, s) => { const dx = s[2] - s[0], dz = s[3] - s[1], l2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (z - s[1]) * dz) / l2)); return Math.hypot(x - (s[0] + t * dx), z - (s[1] + t * dz)); };
    let offRoad = 0, nCar = 0, bld = 0, wat = 0, nAll = 0, gridBad = 0;
    T.list.forEach((o) => {
      nAll++;
      if (w.blockers.inBuilding(o.x, o.z, 0)) bld++;
      const mc = o.m.cls;
      if (mc !== 'boat' && mc !== 'swan' && mc !== 'bird' && w.blockers.inWater(o.x, o.z)) {
        const br = window.__life.bridges();
        const on = br.some((b) => b.p.some((q) => Math.hypot(q[0] - o.x, q[1] - o.z) < b.w / 2 + 6));
        if (!on) wat++;
      }
      const a = w.grid.get(o.cell); if (!a || !a.includes(o)) gridBad++;
      if (o.m.cls === 'car' || o.m.cls === 'bus' || o.m.cls === 'tram') {
        nCar++;
        let best = 1e9; for (const s of segs) { if (s[5] === 'rail' || s[5] === 'footway') continue; const dd = dist(o.x, o.z, s); if (dd < best) best = dd; }
        if (best > 8) offRoad++;
      }
    });
    return { P, nCar, offRoad, bld, wat, nAll, gridBad };
  });
  const moved = mv1.P.map((p, i) => Math.hypot(p[0] - mv0[i][0], p[1] - mv0[i][1]));
  const movedFrac = moved.filter((d) => d > 3).length / moved.length;
  moved.sort((a, b) => a - b);
  console.log(`movers after 12 s: moved>3 m ${(movedFrac * 100).toFixed(0)}%, median ${moved[moved.length >> 1].toFixed(1)} m, off-road vehicles ${mv1.offRoad}/${mv1.nCar}, in building ${mv1.bld}/${mv1.nAll}, in water ${mv1.wat}/${mv1.nAll}, grid mismatches ${mv1.gridBad}`);
  check('movers actually move', movedFrac > 0.8 && moved[moved.length >> 1] > 5);
  check('vehicles stay on roads', mv1.offRoad / Math.max(1, mv1.nCar) < 0.03, `${mv1.offRoad}/${mv1.nCar}`);
  check('movers mostly off buildings', mv1.bld / mv1.nAll < 0.05, `${mv1.bld}/${mv1.nAll}`);
  check('movers (non-boats) off water unless on bridge decks', mv1.wat / mv1.nAll < 0.01, `${mv1.wat}/${mv1.nAll}`);
  check('spatial grid consistent after movement', mv1.gridBad === 0, `${mv1.gridBad} bad`);

  // ---- a mover is swallowable (+ audio counts, rate limiting)
  const sw = await G(() => {
    const g = window.__game, L = window.__life;
    const o = L.traffic.list.find((x) => x.m.cls === 'car' && x.state === 0);
    g.teleport(o.x, o.z); g.setRadius(6);
    const t0 = L.audio.stats.triggered, s0 = g.state.score;
    g.step(0.15); g.step(1.2);
    return { state: o.state, gained: g.state.score - s0, sounds: L.audio.stats.triggered - t0, eaten: g.state.eaten };
  });
  check('moving car is swallowable', sw.state === 2 && sw.gained >= 4, JSON.stringify(sw));
  check('swallow triggered a sound', sw.sounds >= 1, `${sw.sounds}`);
  const rl = await G(() => {
    const g = window.__game, L = window.__life;
    const st = L.audio.stats; const a0 = { ...st };
    g.teleport(-300, 300); g.setRadius(60); const e0 = g.state.eaten;
    for (let i = 0; i < 20; i++) g.step(0.1);
    return { eaten: g.state.eaten - e0, trig: st.triggered - a0.triggered, played: st.played - a0.played, dropped: st.dropped - a0.dropped, voices: L.audio.voices.length, errors: st.errors };
  });
  console.log('mass swallow audio:', JSON.stringify(rl));
  check('mass swallow is rate-limited (no voice flood) without errors', rl.eaten > 30 && rl.played < rl.trig && rl.dropped > 0 && rl.voices <= 16 && rl.errors === 0, JSON.stringify(rl));

  // ---- particles on building swallow
  await G(() => window.__game.start());
  await page.waitForTimeout(2300);
  const fxr = await G(() => {
    const g = window.__game, L = window.__life, w = L.world;
    let b = null, bd = 1e9;
    for (const o of w.objects) if (o.isBuilding && o.state === 0 && o.fit > 8 && o.fit < 16) { const d = Math.hypot(o.x - w.spawn[0], o.z - w.spawn[1]); if (d < bd) { bd = d; b = o; } }
    g.teleport(b.x, b.z); g.setRadius(b.fit / 0.9);
    const s0 = L.fx.spawned; g.step(0.2);
    return { spawned: L.fx.spawned - s0, alive: L.fx.alive, shake: L.camShake.amp };
  });
  check('particles spawn on building swallow', fxr.spawned > 15 && fxr.alive > 10, JSON.stringify(fxr));
  check('camera shake impulse on building swallow', fxr.shake > 0.05, `${fxr.shake}`);
  await shot('building-fall');
  await G(() => window.__game.start()); await page.waitForTimeout(2300);

  // ---- Freedom Monument
  const fm = await G(() => window.__life.world.objects.find((o) => o.kind === 'freedom') || null);
  if (!fm && sample) console.log('SKIP  Freedom Monument (sample city)');
  else {
    check('Freedom Monument exists', !!fm && /Brīvības/.test(fm.name) && fm.h > 40, JSON.stringify(fm && { n: fm.name, x: fm.x, z: fm.z, fit: fm.fit, v: fm.value }));
    await G(() => window.__game.start());
    await page.waitForTimeout(2300);
    await G((p) => { window.__game.teleport(p[0] + 3, p[1] + 36); window.__game.setRadius(4.2); window.__game.step(0.3); }, [fm.x, fm.z]);
    await shot('freedom');
    const small = await G(() => { const g = window.__game, o = window.__life.world.objects.find((x) => x.kind === 'freedom'); g.teleport(o.x, o.z); g.setRadius(4); g.step(1); return o.state; });
    check('small hole cannot eat the monument', small === 0, `state ${small}`);
    const big = await G(() => { const g = window.__game, o = window.__life.world.objects.find((x) => x.kind === 'freedom'); const s0 = g.state.score; g.setRadius(9); g.teleport(o.x, o.z); g.step(2.5); return { state: o.state, gained: g.state.score - s0 }; });
    check('big hole swallows the monument (worth a lot)', big.state === 2 && big.gained >= 400, JSON.stringify(big));
  }

  // ---- label throttling
  await G(() => window.__game.start());
  const lab = await G(async () => {
    const g = window.__game, L = window.__life;
    const w = L.world;
    // flatten a dense area with a big hole, sample DOM label count every frame-ish
    g.teleport(-250, 250); g.setRadius(70);
    const s0 = { ...L.labelStats }; let maxDom = 0;
    for (let i = 0; i < 60; i++) { g.step(0.05); maxDom = Math.max(maxDom, document.getElementById('labels').childElementCount); }
    return { requested: L.labelStats.requested - s0.requested, shown: L.labelStats.shown - s0.shown, maxDom, buildingsEaten: w.counts.buildings - w.counts.remainingBuildings };
  });
  console.log('labels:', JSON.stringify(lab));
  check('labels throttled (shown << requested, <=2 on screen, ~<=1 per 1.4 s)', lab.maxDom <= 2 && lab.shown <= Math.ceil(3 / 1.4) + 2 && (lab.requested < 5 || lab.shown < lab.requested), JSON.stringify(lab));

  // ---- visual shots (wait out the start banner)
  const fresh = async () => { await G(() => window.__game.start()); await page.waitForTimeout(2300); };
  await fresh();
  await G(() => {
    const L = window.__life, g = window.__game;
    const b = L.traffic.list.find((o) => o.m.cls === 'bus') || L.traffic.list[0];
    g.teleport(b.x, b.z); g.setRadius(2.2); g.step(1.0);
    const t = L.traffic.list.find((o) => o.m.cls === 'tram'); window.__tramPos = t && [t.x, t.z];
  });
  await shot('street');
  await fresh();
  await G(() => { const g = window.__game; g.teleport(-440, 250); g.setRadius(9); g.step(0.5); });
  await shot('oldtown');
  // free-camera skyline shots (camera is repositioned after the last sim step, then rendered once)
  const camShot = async (name, pos, look, fov) => {
    await G(([p, l, f]) => { const cm = window.__life.game.cam; if (!cm._apply) cm._apply = cm.apply; cm.apply = () => {}; const c = cm.camera; c.position.set(...p); c.fov = f || 42; c.near = 1; c.far = 6000; c.lookAt(...l); c.updateProjectionMatrix(); window.__game.render(); }, [pos, look, fov]);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(out, `world-${name}${tag}.png`) });
  };
  await camShot('stpeter', [-60, 120, 700], [-242, 50, 444]);
  await camShot('oldtown-spires', [-330, 150, 470], [-520, 20, 200]);
  await camShot('skyline', [200, 320, 900], [-300, 20, 300], 50);
  await G(() => { const cm = window.__life.game.cam; cm.apply = cm._apply; });
  const br = await G(() => { const b = window.__life.bridges(); b.sort((a, c) => c.w * c.p.length - a.w * a.p.length); return b.slice(0, 6).map((x) => ({ k: x.k, w: x.w, n: x.p.length, mid: x.p[x.p.length >> 1] })); });
  console.log('bridges:', JSON.stringify(br));
  check('bridges found over big water', sample || br.length >= 1, `${br.length}`);
  if (br.length) {
    await G((m) => { const g = window.__game; g.teleport(m[0], m[1]); g.setRadius(3.5); g.step(0.5); }, br.find((b) => b.k === 'primary' || b.k === 'secondary')?.mid || br[0].mid);
    await shot('bridge');
  }


  // ================= iteration 3: Rīga flavour =================
  const R = await G(() => {
    const L = window.__life, w = L.world, d = w.data;
    const cnt = {};
    for (const o of w.objects) cnt[o.kind] = (cnt[o.kind] || 0) + 1;
    const blue = (kind) => { const o = w.objects.find((x) => x.kind === kind); if (!o) return false; const c = o.mesh.geometry.attributes.color; for (let i = 0; i < c.count; i++) if (c.getZ(i) > c.getX(i) + 0.3) return true; return false; };
    return { cnt, hasTramways: (d.tramways || []).length, stops: (d.stops || []).length, busBlue: blue('bus'), trolleyBlue: blue('trolleybus'), tramBlue: blue('tram'), piers: (d.piers || []).length };
  });
  console.log('kinds:', JSON.stringify(R.cnt));
  check('buses + trolleybuses + trams in blue/white livery', R.busBlue && R.trolleyBlue && R.tramBlue && (R.cnt.trolleybus || 0) > 3, JSON.stringify({ b: R.busBlue, t: R.trolleyBlue, tr: R.tramBlue }));
  if (!sample) {
    check('data has tramways + stops + piers', R.hasTramways > 20 && R.stops > 30 && R.piers > 0, JSON.stringify({ tw: R.hasTramways, st: R.stops, piers: R.piers }));
    check('transit shelters exist', (R.cnt.shelter || 0) > 20, `${R.cnt.shelter}`);
    for (const k of ['flag', 'parasol', 'stall', 'bike', 'scooter', 'lantern', 'swan', 'pigeon', 'boat', 'laima', 'pylon', 'railarch', 'taxi']) check(`prop kind '${k}' exists`, (R.cnt[k] || 0) > 0, `${R.cnt[k] || 0}`);
  }
  // trams only on tracks; dwell at stops; boats on water
  await G(() => window.__game.start());
  const dw = await G(() => {
    const g = window.__game, L = window.__life; let maxDwell = 0, trams = 0, offTrack = 0, maxOff = 0;
    const tw = L.world.data.tramways || [];
    const segs = []; for (const t of tw) for (let i = 0; i < t.p.length - 1; i++) segs.push([t.p[i][0], t.p[i][1], t.p[i + 1][0], t.p[i + 1][1]]);
    const dist = (x, z, s) => { const dx = s[2] - s[0], dz = s[3] - s[1], l2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (z - s[1]) * dz) / l2)); return Math.hypot(x - (s[0] + t * dx), z - (s[1] + t * dz)); };
    g.teleport(1100, 1100);
    const b0 = L.traffic.list.filter((o) => o.m.cls === 'boat' || o.m.cls === 'swan').map((o) => [o.x, o.z]);
    for (let i = 0; i < 40; i++) {
      g.step(1);
      maxDwell = Math.max(maxDwell, L.traffic.stats.dwelling);
    }
    for (const o of L.traffic.list) if (o.m.cls === 'tram' && o.state === 0 && !o.m.off) {
      trams++;
      if (segs.length) { let b = 1e9; for (const s of segs) b = Math.min(b, dist(o.x, o.z, s)); maxOff = Math.max(maxOff, b); if (b > 5) offTrack++; }
    }
    const boats = L.traffic.list.filter((o) => o.m.cls === 'boat' || o.m.cls === 'swan');
    let moved = 0, wet = 0; boats.forEach((o, i) => { if (Math.hypot(o.x - b0[i][0], o.z - b0[i][1]) > 4) moved++; if (L.world.blockers.inWater(o.x, o.z)) wet++; });
    return { maxDwell, trams, offTrack, maxOff, boats: boats.length, moved, wet, tracks: segs.length };
  });
  console.log('transit/boats after 40 s:', JSON.stringify(dw));
  check('vehicles pause at stops (dwelling > 0 at some point)', sample || dw.maxDwell > 0, `${dw.maxDwell}`);
  check('trams stay on tram tracks', sample || (dw.trams > 3 && dw.offTrack === 0), JSON.stringify(dw));
  check('boats/swans move and stay on water', dw.boats > 3 && dw.moved / dw.boats > 0.8 && dw.wet / dw.boats > 0.85, JSON.stringify(dw));

  // landmarks exist + swallowable at an appropriate hole size
  const lmTargets = sample ? [] : [
    ['Nacionālā opera', (o) => o.name === 'Nacionālā opera'],
    ['Nativity Cathedral', (o) => /Piedzimšanas/.test(o.name || '')],
    ['Rīgas pils (castle)', (o) => o.name === 'Rīgas pils'],
    ['Melngalvju nams', (o) => o.name === 'Melngalvju nams'],
    ['Kaķu nams (cat house)', (o) => o.name === 'Kaķu nams'],
    ['Pulvertornis', (o) => /Pulvertornis/.test(o.name || '')],
    ['St Peter spire', (o) => /Pētera baznīca/.test(o.name || '')],
    ['Dome cathedral', (o) => /Doms/.test(o.name || '')],
    ['Central Market hall', (o) => /paviljons/.test(o.name || '')],
    ['Laima clock', (o) => o.kind === 'laima'],
    ['Vanšu pylon', (o) => o.kind === 'pylon'],
    ['Railway bridge arch', (o) => o.kind === 'railarch'],
  ];
  const lmRes = [];
  for (const [label, _] of lmTargets) {
    const src = lmTargets.find((t) => t[0] === label)[1].toString();
    const r = await G(([src]) => {
      const f = eval('(' + src + ')'); const g = window.__game, w = window.__life.world;
      const o = w.objects.find((x) => x.state === 0 && f(x));
      if (!o) return null;
      g.start(); const info = { name: o.name || o.kind, x: o.x | 0, z: o.z | 0, fit: +o.fit.toFixed(1), value: o.value, h: +o.h.toFixed(0) };
      g.teleport(o.x, o.z); g.setRadius(o.fit / 0.9 + 0.6); g.step(3);
      info.eaten = o.state === 2; info.bonus = o.value;
      return info;
    }, [src]);
    lmRes.push([label, r]);
    check(`landmark: ${label} exists and is swallowable`, !!r && r.eaten, JSON.stringify(r));
  }
  // ---- measured shapes / heights (riga-shapes.bin.gz): counts per rendering path, famous heights, swallowing a shaped building
  if (!sample) {
    const SS = await G(() => ({ stats: window.__life.world.shapeStats, timing: window.__timing }));
    console.log('shape stats:', JSON.stringify(SS));
    check('detail data loaded: shaped buildings by source', SS.stats.meshNotable > 300 && SS.stats.meshRelief > 800 && SS.stats.osm >= 1 && SS.stats.measuredHeights > 4000 && SS.stats.flat > 1000, JSON.stringify(SS.stats));
    const H = await G(() => {
      const w = window.__life.world;
      const byName = (re) => w.buildingItems.find((i) => re.test(i.name || ''));
      const byId = (id) => w.buildingItems.find((i) => i.id === id);
      return { peter: byName(/Pētera baznīca/)?.h, academy: byId(49628422)?.h, hotel: byId(49619752)?.h, art: byId(49615452)?.h };
    });
    console.log('measured heights:', JSON.stringify(H));
    check("St Peter's is > 110 m tall", H.peter > 110 && H.peter < 135, `${H.peter}`);
    check('Academy of Sciences is realistic (95-115 m, was 11.6 in riga.json)', H.academy > 95 && H.academy < 115, `${H.academy}`);
    check('Hotel Latvija is realistic (80-105 m)', H.hotel > 80 && H.hotel < 105, `${H.hotel}`);
    const shp = await G(() => {
      const g = window.__game, w = window.__life.world;
      g.start();
      const it = w.buildingItems.filter((i) => i.shaped && i.fit > 12 && i.fit < 30 && !i.landmark).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
      const o = w.objects.find((x) => x.isBuilding && x.batchId === it.batchId);
      const s0 = g.state.score;
      g.teleport(o.x, o.z); g.setRadius(o.fit / 0.9 + 0.6);
      g.step(0.1);
      const falling = o.state === 1;
      g.step(3);
      return { falling, state: o.state, visible: w.buildingMesh.getVisibleAt(it.batchId), gained: g.state.score - s0, fit: +o.fit.toFixed(1), h: +o.h.toFixed(0), tris: it.gidShape };
    });
    check('a shaped building is swallowable and falls like any other', shp.falling && shp.state === 2 && shp.visible === false && shp.gained > 0, JSON.stringify(shp));
    await G(() => window.__game.start()); await page.waitForTimeout(2300);
    // geometry is built once: memory must not grow across rounds
    const mem = await G(() => { const g = window.__game, r = window.__life.renderer.info.memory; const a = { geo: r.geometries, tex: r.textures }; for (let i = 0; i < 3; i++) { g.start(); g.step(0.2); } const b = { geo: r.geometries, tex: r.textures }; return { a, b }; });
    check('geometry/texture count stable across Play-again rounds', mem.a.geo === mem.b.geo && mem.a.tex === mem.b.tex, JSON.stringify(mem));
  }

  // ---- Riga screenshots
  const rshot = async (name) => { await G(() => window.__game.render()); await page.waitForTimeout(350); await page.screenshot({ path: path.join(out, `riga-${name}${tag}.png`) }); };
  const rcam = async (name, pos, look, fov) => {
    await G(([p, l, f]) => { const cm = window.__life.game.cam; if (!cm._apply) cm._apply = cm.apply; cm.apply = () => {}; const c = cm.camera; c.position.set(...p); c.fov = f || 42; c.near = 1; c.far = 6000; c.lookAt(...l); c.updateProjectionMatrix(); window.__game.render(); }, [pos, look, fov]);
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(out, `riga-${name}${tag}.png`) });
    await G(() => { const cm = window.__life.game.cam; if (cm._apply) cm.apply = cm._apply; });
  };
  const fresh2 = async () => { await G(() => window.__game.start()); await page.waitForTimeout(2300); };
  await fresh2();
  // tram at a stop (wait for a dwelling tram)
  const tramShot = await G(() => {
    const g = window.__game, L = window.__life;
    for (let i = 0; i < 400; i++) {
      g.step(0.5);
      const t = L.traffic.list.find((o) => o.m.cls === 'tram' && !o.m.off && o.m.dwell > 1 && o.state === 0);
      if (t) { g.teleport(t.x, t.z + 8); g.setRadius(2.6); g.step(0.05); return [t.x, t.z]; }
    }
    return null;
  });
  console.log('tram-at-stop shot target:', JSON.stringify(tramShot));
  await rshot('tram-stop');
  await G(() => { const g = window.__game, L = window.__life; const t = L.traffic.list.find((o) => o.m.cls === 'trolley' && !o.m.off && o.state === 0); g.teleport(t.x, t.z + 6); g.setRadius(2.4); g.step(0.05); });
  await rshot('trolleybus');
  const pos = await G(() => { const w = window.__life.world; const f = (k) => { const o = w.objects.find((x) => x.kind === k || (x.name && x.name === k)); return o ? [o.x, o.z] : null; }; return { market: f('Zivju paviljons'), cathedral: w.objects.find((o) => /Piedzimšanas/.test(o.name || '')) && [w.objects.find((o) => /Piedzimšanas/.test(o.name || '')).x, w.objects.find((o) => /Piedzimšanas/.test(o.name || '')).z], opera: f('Nacionālā opera'), pylon: f('pylon'), arch: f('railarch'), cat: f('Kaķu nams'), castle: f('Rīgas pils'), heads: f('Melngalvju nams') }; });
  console.log('landmark positions:', JSON.stringify(pos));
  // landmarks may have been swallowed by the tests above: reset the round first
  await fresh2();
  await G(() => window.__game.teleport(1100, 1100));
  if (pos.market) await rcam('market', [pos.market[0] + 120, 110, pos.market[1] + 190], [pos.market[0] + 30, 5, pos.market[1] - 40]);
  if (pos.cathedral) await rcam('cathedral', [pos.cathedral[0] + 20, 38, pos.cathedral[1] + 95], [pos.cathedral[0], 22, pos.cathedral[1]]);
  if (pos.opera) await rcam('opera', [pos.opera[0] + 70, 28, pos.opera[1] - 50], [pos.opera[0], 8, pos.opera[1]]);
  if (pos.cat) await rcam('cathouse', [pos.cat[0] + 20, 28, pos.cat[1] + 28], [pos.cat[0], 14, pos.cat[1]]);
  if (pos.castle) await rcam('castle', [pos.castle[0] + 50, 40, pos.castle[1] + 70], [pos.castle[0], 8, pos.castle[1]]);
  if (pos.heads) await rcam('blackheads', [pos.heads[0] + 35, 30, pos.heads[1] + 55], [pos.heads[0], 10, pos.heads[1]]);
  if (pos.pylon) await rcam('vansu', [pos.pylon[0] + 130, 70, pos.pylon[1] + 110], [pos.pylon[0], 25, pos.pylon[1]], 50);
  if (pos.arch) await rcam('railbridge', [pos.arch[0] + 200, 90, pos.arch[1] + 130], [pos.arch[0], 5, pos.arch[1]], 50);
  // old town square with terraces / flags / cobbles
  await G(() => { const w = window.__life.world, g = window.__game; const p = w.objects.filter((o) => o.kind === 'parasol' && Math.hypot(o.x + 400, o.z - 300) < 300).sort((a, b) => Math.hypot(a.x + 400, a.z - 300) - Math.hypot(b.x + 400, b.z - 300))[0]; if (p) { g.teleport(p.x, p.z); g.step(0.05); window.__tp = [p.x, p.z]; } });
  const tp = await G(() => window.__tp);
  if (tp) await rcam('oldtown-terraces', [tp[0] + 10, 28, tp[1] + 34], [tp[0], 2, tp[1]]);
  // canal with boat
  await G(() => { const g = window.__game, L = window.__life; const t = L.traffic.list.find((o) => o.m.cls === 'boat' && !o.m.off && o.state === 0 && o.m.road.canal) || L.traffic.list.find((o) => o.m.cls === 'boat'); g.teleport(t.x, t.z + 25); g.setRadius(2.5); g.step(0.05); });
  await rshot('canal');
  // NW harbour (piers / quay)
  await G(() => { const g = window.__game; g.teleport(-1000, -880); g.setRadius(6); g.step(0.05); });
  await rshot('harbour');
  const harbour = await G(() => { const w = window.__life.world; let tall = 0, inW = 0; for (const o of w.objects) if (o.isBuilding && o.state === 0 && Math.hypot(o.x + 1000, o.z + 880) < 260) { if (o.h > 10 && w.blockers.inWater(o.x, o.z)) inW++; if (o.h > 10 && !o.name && o.fit < 12 && w.blockers.inWater(o.x, o.z)) tall++; } return { inW, tall }; });
  check('no tall buildings standing in water at the NW harbour', harbour.inW === 0, JSON.stringify(harbour));

  // ---- perf (everything on, real map, mid-size hole, traffic active)
  await G(() => { const g = window.__game; g.start(); g.teleport(-250, 150); g.setRadius(9); g.step(0.5); });
  await G(() => { window.__perf.frames = 0; window.__perf.ms = 0; window.__life.renderer.info.reset && 0; });
  await page.waitForTimeout(5000);
  const perf = await G(() => { const i = window.__life.renderer.info.render; return { f: window.__perf.frames, ms: window.__perf.ms, calls: i.calls, tris: i.triangles, q: window.__life.quality.info() }; });
  const cpu = perf.ms / Math.max(1, perf.f);
  console.log(`world build ${JSON.stringify(await G(() => window.__timing))}`);
  console.log(`perf: ${cpu.toFixed(2)} ms cpu/frame over ${perf.f} frames; draw calls ${perf.calls}; triangles ${perf.tris}; quality ${JSON.stringify(perf.q)}`);
  check('cpu ms/frame < 5 with everything on', cpu < 5, `${cpu.toFixed(2)} ms`);
  const simMs = await G(() => { const g = window.__game; const t0 = performance.now(); g.step(2); return (performance.now() - t0) / 120; });
  console.log(`sim update (no render): ${simMs.toFixed(2)} ms/step`);
  const q = await G(() => { const Q = window.__life.quality; const r = {}; for (const l of [0, 1, 2]) { Q.apply(l, true); window.__game.step(0.3); window.__game.render(); r[l] = { calls: window.__life.renderer.info.render.calls, movers: window.__life.traffic.list.filter((o) => !o.m.off).length, shadow: window.__life.world.scene.children.some((c) => c.isDirectionalLight && c.castShadow) }; } return r; });
  console.log('quality levels:', JSON.stringify(q));
  check('quality levels change mover count', q[0].movers < q[2].movers && q[0].shadow === false && q[2].shadow === true, JSON.stringify(q));

  // ---- detail files blocked (404): the game must still boot with riga.json heights / flat boxes only
  if (!sample) {
    const ctx2 = await browser.newContext({ viewport: { width: 800, height: 500 } });
    await ctx2.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await ctx2.route(/riga-(shapes|detail)/, (r) => r.fulfill({ status: 404, body: 'nope' }));
    const p2 = await ctx2.newPage();
    const errs2 = [];
    p2.on('pageerror', (e) => errs2.push(e.message));
    await p2.goto(`${base}/?quality=high&intro=0&bots=0`);
    await p2.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 120000 });
    const r2 = await p2.evaluate(() => { const w = window.__life.world; const g = window.__game; g.start(); g.step(1); return { err: document.body.dataset.error || null, stats: w.shapeStats, n: w.buildingItems.length, timing: window.__timing }; });
    check('game runs with the shape/detail files blocked (flat boxes, riga.json heights)', !r2.err && r2.n > 3500 && r2.stats.meshNotable === 0 && r2.stats.osm === 0 && r2.stats.flat === r2.n && errs2.length === 0, JSON.stringify(r2));
    console.log(`build time without shapes ${r2.timing.buildMs} ms`);
    await ctx2.close();
  }

  check('no console/page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
}

main().catch((e) => { console.error('smoke-world failed:', e); failures++; }).finally(() => {
  kill();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
});

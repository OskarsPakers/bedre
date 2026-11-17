// Perf pass harness. Serves a built dist (default scripts/.dist-perf) on PERF_PORT (5185) like the live site and measures.
//   node scripts/perf-pass.mjs load  --dist scripts/.dist-perf --label base --profiles desktop,pixel5,iphone13 --maps centrs,... --runs 3
//   node scripts/perf-pass.mjs build --profiles desktop,pixel5cpu,iphone13 --tiers low,high ...
//   node scripts/perf-pass.mjs frame --profiles desktop,iphone13 --tiers low,medium,high [--trace]
//   node scripts/perf-pass.mjs mem
// Output JSON: docs/perf/data/<mode>-<label>.json (rows appended per call: --merge)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, launch, PROFILES, median, pct, sleep, arg, has } from './perf/lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
const PORT = +(process.env.PERF_PORT || 5185);
const dist = path.resolve(root, arg('--dist', 'scripts/.dist-perf'));
const label = arg('--label', 'cur');
const runs = +arg('--runs', 3);
const maps = arg('--maps', 'centrs,agenskalns,mezaparks,purvciems').split(',');
const profiles = arg('--profiles', 'desktop').split(',');
const tiers = arg('--tiers', 'low,medium,high').split(',');
const base = `http://localhost:${PORT}`;
const EXTRA = arg('--extra', ''); // appended to every page URL, e.g. --extra '&mesh=fine'
const outFile = path.join(root, 'docs', 'perf', 'data', `${mode}-${label}${arg('--suffix', '')}.json`);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
const rows = has('--merge') && fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : [];
const save = () => fs.writeFileSync(outFile, JSON.stringify(rows, null, 1));
const srv = await serve(dist, PORT);
const browsers = {};
const getBrowser = async (kind) => (browsers[kind] ||= await launch(kind));

// init script: records rAF gaps + long tasks + paint from the very start of the document
const INIT = () => {
  window.__raf = []; window.__long = [];
  let last = performance.now();
  const loop = (t) => { window.__raf.push([t, t - last]); last = t; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch { /* webkit */ }
};

async function newPage(profile, { net = true, cpu = true } = {}) {
  const P = PROFILES[profile];
  const browser = await getBrowser(P.kind);
  const ctx = await browser.newContext(P.ctx);
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
  let cdp = null;
  if (P.kind === 'chromium') {
    cdp = await ctx.newCDPSession(page);
    if (net && P.net) { await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', P.net); }
    if (cpu && P.cpu) await cdp.send('Emulation.setCPUThrottlingRate', { rate: P.cpu });
  }
  return { ctx, page, cdp, errs };
}
const readyWait = (page, ms = 300000) => page.waitForFunction(() => document.body && (document.body.dataset.ready === '1' || document.body.dataset.error), null, { timeout: ms, polling: 50 });

const buildBreakdown = (page) => page.evaluate(() => {
  const m = {}; for (const e of performance.getEntriesByType('measure')) if (e.name.startsWith('bd:')) m[e.name.slice(3)] = Math.round(e.duration * 10) / 10;
  const mk = {}; for (const e of performance.getEntriesByType('mark')) if (e.name.startsWith('bd:')) mk[e.name.slice(3)] = Math.round(e.startTime);
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const fcp = (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime;
  const t = window.__timing || {};
  // loader responsiveness: rAF gaps while the world was being built (data-arrived .. world-built) and whole-load longest rAF gap
  const a = mk['data-arrived'], b = mk['world-built'];
  const gaps = (window.__raf || []).filter(([t0]) => a != null && t0 >= a && t0 <= b + 400).map((x) => x[1]);
  return { first: (window.__perf && window.__perf.first) || null, measures: m, marks: mk, fcp: fcp && Math.round(fcp), domInteractive: Math.round(nav.domInteractive || 0), timing: t, longTasks: window.__long, maxRafGapBuild: Math.round(Math.max(0, ...gaps)), rafFramesBuild: gaps.length };
});

// ------------------------------------------------------------------------------------------ load
async function loadMode() {
  for (const profile of profiles) for (const map of maps) {
    const runsHere = PROFILES[profile].cpu && !has('--all-maps-phone') && !['centrs', 'mezaparks'].includes(map) ? 1 : runs;
    for (const cache of ['cold', 'warm']) {
      const res = [];
      for (let i = 0; i < runsHere; i++) {
        srv.reset();
        const { ctx, page, errs } = await newPage(profile);
        const url = `${base}/?map=${map}&radio=0&intro=0&sw=1${arg('--q', '') ? '&quality=' + arg('--q') : ''}`;
        let warmup = 0;
        if (cache === 'warm') { // first visit installs the service worker + fills the HTTP cache; measured visit is a NEW page in the same context
          await page.goto(url, { waitUntil: 'commit' }); await readyWait(page);
          await page.evaluate(() => navigator.serviceWorker && navigator.serviceWorker.ready).catch(() => {});
          await sleep(2500); // install precaches the shell + riga data of the centre
          await page.close(); srv.reset();
          const p2 = await ctx.newPage(); p2.on('pageerror', (e) => errs.push(e.message));
          if (PROFILES[profile].kind === 'chromium') { const c = await ctx.newCDPSession(p2); if (PROFILES[profile].net) { await c.send('Network.enable'); await c.send('Network.emulateNetworkConditions', PROFILES[profile].net); } if (PROFILES[profile].cpu) await c.send('Emulation.setCPUThrottlingRate', { rate: PROFILES[profile].cpu }); }
          warmup = 1;
          await p2.goto(url, { waitUntil: 'commit' }); await readyWait(p2);
          var pg = p2;
        } else { await page.goto(url, { waitUntil: 'commit' }); await readyWait(page); var pg = page; }
        const r = await pg.evaluate(() => ({ ready: Math.round(performance.now()), play: !document.getElementById('play').disabled, err: document.body.dataset.error || null }));
        const atReady = new Map(srv.bytes); const tReady = [...atReady.values()].reduce((a, b) => a + b, 0);
        await sleep(+arg('--after', 6000));
        const bd = await buildBreakdown(pg);
        const wire = {}; let total = 0; const wireAtReady = {};
        for (const [k, v] of atReady) wireAtReady[k.replace(/\?.*$/, '').replace(/-[\w-]{8}\.(js|css)$/, '.$1')] = v;
        for (const [k, v] of srv.bytes) { const kk = k.replace(/\?.*$/, '').replace(/-[\w-]{8}\.(js|css)$/, '.$1'); wire[kk] = (wire[kk] || 0) + v; total += v; }
        res.push({ tReady, wireAtReady, ready: r.ready, fcp: bd.fcp, dataArrived: bd.marks['data-arrived'], worldBuilt: bd.marks['world-built'], buildMs: bd.timing.buildMs, wire, total, errs, revalidated: srv.hits.length });
        await ctx.close();
      }
      const med = res.slice().sort((a, b) => a.ready - b.ready)[Math.floor((res.length - 1) / 2)];
      const row = { profile, map, cache, label, runs: res.length, ready: median(res.map((x) => x.ready)), readyAll: res.map((x) => x.ready), fcp: median(res.map((x) => x.fcp)), dataArrived: median(res.map((x) => x.dataArrived)), worldBuilt: median(res.map((x) => x.worldBuilt)), buildMs: median(res.map((x) => x.buildMs)), total: med.tReady, totalAfter6s: med.total, wire: med.wireAtReady, wireAfter6s: med.wire, errs: [...new Set(res.flatMap((x) => x.errs))].slice(0, 3), revalidated: med.revalidated };
      rows.push(row); save();
      console.log(`${label} ${profile.padEnd(9)} ${map.padEnd(10)} ${cache}: ready ${(row.ready / 1000).toFixed(2)}s (${row.readyAll.map((x) => (x / 1000).toFixed(1)).join('/')}) fcp ${row.fcp}ms dataArrived ${Math.round(row.dataArrived)} build ${row.buildMs}ms wire ${(row.total / 1024).toFixed(0)}KB${row.errs.length ? ' ERR ' + row.errs[0] : ''}`);
    }
  }
}

// ------------------------------------------------------------------------------------------ build breakdown
async function buildMode() {
  for (const profile of profiles) for (const map of maps) for (const tier of tiers) {
    const res = [];
    for (let i = 0; i < runs; i++) {
      const { ctx, page, errs } = await newPage(profile, { net: false }); // network unthrottled: isolate main-thread build; CPU throttle stays if the profile has it
      await page.goto(`${base}/?map=${map}&quality=${tier}&radio=0&intro=0`, { waitUntil: 'commit' }); await readyWait(page);
      await sleep(500);
      const bd = await buildBreakdown(page);
      const heap = await page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : null));
      res.push({ ...bd, errs, heap });
      await ctx.close();
    }
    // medians per measure
    const keys = new Set(res.flatMap((r) => Object.keys(r.measures)));
    const measures = {}; for (const k of keys) measures[k] = median(res.map((r) => r.measures[k]));
    const lt = res.map((r) => Math.max(0, ...r.longTasks.map((x) => x[1])));
    const row = { profile, map, tier, label, runs: res.length, measures, firstFrameMs: median(res.map((r) => r.first)), marks: { dataArrived: median(res.map((r) => r.marks['data-arrived'])), worldBuilt: median(res.map((r) => r.marks['world-built'])), ready: median(res.map((r) => r.marks['ready'])), firstFrame: median(res.map((r) => r.marks['first-frame'])) }, buildMs: median(res.map((r) => r.timing.buildMs)), loadMs: median(res.map((r) => r.timing.loadMs)), longestTask: median(lt), longestTaskAll: lt, maxRafGapBuild: median(res.map((r) => r.maxRafGapBuild)), rafFramesBuild: median(res.map((r) => r.rafFramesBuild)), errs: [...new Set(res.flatMap((r) => r.errs))].slice(0, 3) };
    rows.push(row); save();
    console.log(`${label} ${profile.padEnd(9)} ${map.padEnd(10)} ${tier.padEnd(6)} build ${row.buildMs}ms longest task ${row.longestTask}ms rAF gap in build ${row.maxRafGapBuild}ms | ${Object.entries(measures).filter(([k]) => /total|json|shapes|placements|ground-(prep|tiles|skirt|detail)|bld-(pass1|geometry|batch)|props-|grid|roadnet|blockers/.test(k)).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
}

// ------------------------------------------------------------------------------------------ frame cost
const SAMPLE = async (page, secs) => page.evaluate((secs) => new Promise((res) => {
  const P = window.__perf, i = window.__life.renderer.info;
  const p0 = { f: P.frames, s: P.simMs, r: P.renderMs };
  const gaps = [], calls = [], tris = []; let last = performance.now(); const t0 = last;
  const tick = (t) => { gaps.push(t - last); last = t; calls.push(i.render.calls); tris.push(i.render.triangles); if (t - t0 < secs * 1000) requestAnimationFrame(tick); else { const f = P.frames - p0.f; res({ frames: f, simMs: (P.simMs - p0.s) / Math.max(1, f), renderMs: (P.renderMs - p0.r) / Math.max(1, f), gaps, calls, tris }); } };
  requestAnimationFrame(tick);
}), secs);
const med = (a) => median(a), p = (a, q) => pct(a, q);
const summarize = (s) => ({ cpuMs: +(s.simMs + s.renderMs).toFixed(2), simMs: +s.simMs.toFixed(2), renderMs: +s.renderMs.toFixed(2), calls: med(s.calls), tris: med(s.tris), frameP50: +med(s.gaps).toFixed(1), frameP95: +p(s.gaps, 0.95).toFixed(1), frames: s.frames });

async function frameMode() {
  for (const profile of profiles) for (const map of maps) for (const tier of tiers) {
    const per = {};
    for (let run = 0; run < runs; run++) {
      const { ctx, page, errs } = await newPage(profile, { net: false });
      const q = `map=${map}&quality=${tier}&radio=0&introhold=600${EXTRA}`;
      await page.goto(`${base}/?${q}`, { waitUntil: 'commit' }); await readyWait(page);
      await sleep(300);
      // intro overview first (whole city)
      await page.evaluate(() => window.__game.start());
      await sleep(1500);
      (per.intro ||= []).push(summarize(await SAMPLE(page, 2.5)));
      await page.evaluate(() => { window.__game.skipIntro(); window.__game.step(8); });
      for (const r of [3, 30, 90]) {
        await page.evaluate((r) => { const g = window.__game; g.setRadius(r); g.step(0.3); }, r);
        await sleep(1200);
        (per['r' + r] ||= []).push(summarize(await SAMPLE(page, 2.5)));
      }
      await page.evaluate(() => { const g = window.__game; g.setRadius(30); g.zoomBy(100); g.step(0.5); });
      await sleep(1500);
      (per.zoomout ||= []).push(summarize(await SAMPLE(page, 2.5)));
      await ctx.close();
      if (errs.length) per.errs = errs.slice(0, 2);
    }
    const agg = {};
    for (const [k, v] of Object.entries(per)) if (Array.isArray(v)) { agg[k] = {}; for (const f of Object.keys(v[0])) agg[k][f] = median(v.map((x) => x[f])); agg[k].cpuAll = v.map((x) => x.cpuMs); }
    const row = { profile, map, tier, label, runs, view: agg, errs: per.errs || [] };
    rows.push(row); save();
    console.log(`${label} ${profile.padEnd(9)} ${map.padEnd(10)} ${tier.padEnd(6)} ` + Object.entries(agg).map(([k, v]) => `${k}: ${v.cpuMs}ms (sim ${v.simMs}+rnd ${v.renderMs}) ${(v.tris / 1e6).toFixed(2)}Mtri ${v.calls}c`).join(' | '));
  }
}

// ------------------------------------------------------------------------------------------ 60 s autoplay trace
async function traceMode() {
  const secs = +arg('--secs', 60);
  for (const profile of profiles) for (const map of maps) for (const tier of tiers) {
    const { ctx, page, errs } = await newPage(profile, { net: false });
    await page.goto(`${base}/?map=${map}&quality=${tier}&radio=0&intro=0${EXTRA}`, { waitUntil: 'commit' }); await readyWait(page);
    await page.evaluate(() => { const g = window.__game; g.start(); g.skipIntro(); });
    await sleep(500);
    const r = await page.evaluate((secs) => new Promise((res) => {
      const g = window.__game, b = window.__life.world.bounds, P = window.__perf, i = window.__life.renderer.info;
      const gaps = [], tris = []; let last = performance.now(); const t0 = last, p0 = { f: P.frames, s: P.simMs, r: P.renderMs };
      const L = []; const lt = new PerformanceObserver((l) => { for (const e of l.getEntries()) L.push(e.duration); }); try { lt.observe({ type: 'longtask' }); } catch { /* webkit */ }
      let k = 0;
      const G = window.__life.game, pl = G.player, W = window.__life.world, FIT = 0.95; G.autopilot = true; // greedy like Game.autoplay: best value / distance among what the hole can swallow
      const steer = () => {
        let best = null, bs = -1; const R = Math.max(25, pl.radius * 9);
        W.query(pl.x, pl.z, R, (o, d) => { if (o.state !== 0 || o.fit >= pl.radius * FIT) return; const sc = o.value / (d + pl.radius * 1.5 + 4); if (sc > bs) { bs = sc; best = o; } });
        const a = k++ * 2.4;
        const tx = best ? best.x : pl.x + Math.cos(a) * 200, tz = best ? best.z : pl.z + Math.sin(a) * 200;
        g.setTarget(Math.max(b.minX + 30, Math.min(b.maxX - 30, tx)), Math.max(b.minZ + 30, Math.min(b.maxZ - 30, tz)));
      };
      steer(); const iv = setInterval(steer, 900);
      const tick = (t) => { gaps.push(t - last); last = t; tris.push(i.render.triangles); if (t - t0 < secs * 1000) requestAnimationFrame(tick); else { clearInterval(iv); const f = P.frames - p0.f; res({ gaps, long: L, frames: f, cpu: (P.ms - 0) , simMs: (P.simMs - p0.s) / f, renderMs: (P.renderMs - p0.r) / f, level: window.__life.quality ? window.__life.quality.name : null, radius: g.hole.radius, dp: (() => { const d = performance.getEntriesByName('bd:detail-paint').map((e) => e.duration).sort((a, b) => a - b); return { n: d.length, med: d.length ? +d[d.length >> 1].toFixed(1) : 0, max: d.length ? +d[d.length - 1].toFixed(1) : 0 }; })() }); } };
      requestAnimationFrame(tick);
    }), secs);
    const g = r.gaps;
    const row = { profile, map, tier, label, secs, frames: g.length, p50: +pct(g, 0.5).toFixed(1), p95: +pct(g, 0.95).toFixed(1), p99: +pct(g, 0.99).toFixed(1), max: +Math.max(...g).toFixed(1), over33: g.filter((x) => x > 33.4).length, over50: g.filter((x) => x > 50).length, longTasks: r.long.length, detailPaint: r.dp, cpuMs: +(r.simMs + r.renderMs).toFixed(2), simMs: +r.simMs.toFixed(2), renderMs: +r.renderMs.toFixed(2), endLevel: r.level, endRadius: +r.radius.toFixed(1), errs: errs.slice(0, 2) };
    rows.push(row); save(); console.log(JSON.stringify(row));
    await ctx.close();
  }
}

// ------------------------------------------------------------------------------------------ memory
async function memMode() {
  for (const profile of profiles) for (const map of maps) for (const tier of tiers) {
    const { ctx, page, cdp, errs } = await newPage(profile, { net: false });
    await page.goto(`${base}/?map=${map}&quality=${tier}&radio=0&intro=0&time=6`, { waitUntil: 'commit' }); await readyWait(page);
    await sleep(800);
    const heap = async () => { if (!cdp) return null; await cdp.send('HeapProfiler.collectGarbage'); const m = await cdp.send('Performance.getMetrics'); return Math.round((m.metrics.find((x) => x.name === 'JSHeapUsedSize') || {}).value / 1048576 * 10) / 10; };
    if (cdp) await cdp.send('Performance.enable');
    const h0 = await heap();
    const gpu = () => page.evaluate(() => {
      const L = window.__life, r = L.renderer, w = L.world, i = r.info;
      const texSeen = new Set(), geoSeen = new Set(); let texB = 0, geoB = 0; const parts = {};
      const addTex = (t, tag) => { if (!t || texSeen.has(t.uuid)) return; texSeen.add(t.uuid); const im = t.image; const wd = (im && (im.width || im.videoWidth)) || (t.source && t.source.data && t.source.data.width) || 0, ht = (im && (im.height || im.videoHeight)) || (t.source && t.source.data && t.source.data.height) || 0; const b = wd * ht * 4 * (t.generateMipmaps ? 1.34 : 1); texB += b; parts[tag] = (parts[tag] || 0) + b; };
      const addGeo = (g, tag) => { if (!g || geoSeen.has(g.uuid)) return; geoSeen.add(g.uuid); let b = 0; for (const a of Object.values(g.attributes)) b += a.array.byteLength; if (g.index) b += g.index.array.byteLength; geoB += b; parts[tag] = (parts[tag] || 0) + b; };
      L.game.scene.traverse((o) => {
        if (o.material) for (const m of [].concat(o.material)) for (const v of Object.values(m)) if (v && v.isTexture) addTex(v, 'tex:' + (o.parent && o.parent === w.ground ? 'ground' : 'other'));
        if (o.geometry) addGeo(o.geometry, o.isBatchedMesh ? 'geo:buildings(src)' : 'geo:other');
        if (o.isInstancedMesh) { geoB += o.instanceMatrix.array.byteLength + (o.instanceColor ? o.instanceColor.array.byteLength : 0); parts['geo:instances'] = (parts['geo:instances'] || 0) + o.instanceMatrix.array.byteLength + (o.instanceColor ? o.instanceColor.array.byteLength : 0); }
        if (o.isBatchedMesh) { for (const k of ['_matricesTexture', '_colorsTexture']) addTex(o[k], 'tex:batched'); for (const a of Object.values(o.geometry.attributes)) { geoB += 0; } }
        if (o.isLight && o.shadow && o.shadow.map) { const s = o.shadow.map; parts['rt:shadow'] = s.width * s.height * 4; texB += s.width * s.height * 4; }
      });
      const dl = w.ground && w.ground.userData && w.ground.userData.detail; if (dl && dl.tex) addTex(dl.tex, 'tex:detail');
      const gs = w.ground && w.ground.userData.stats, sk = w.ground && w.ground.userData.skirt;
      const MB = (b) => Math.round(b / 1048576 * 10) / 10;
      return { texturesCount: i.memory.textures, geometriesCount: i.memory.geometries, texMB: MB(texB), geoMB: MB(geoB), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, MB(v)])), groundStats: gs, skirt: sk };
    });
    await page.evaluate(() => { const g = window.__game; g.start(); g.skipIntro(); g.step(3); }); await sleep(800);
    const g0 = await gpu();
    for (let rd = 0; rd < 3; rd++) { await page.evaluate(() => { const g = window.__game; if (g.phase !== 'playing') { g.start(); g.skipIntro(); } g.step(9); }); await sleep(400); }
    await page.evaluate(() => { const g = window.__game; g.start(); g.skipIntro(); g.step(2); }); await sleep(800);
    const h1 = await heap(), g1 = await gpu();
    const row = { profile, map, tier, label, heapAfterLoadMB: h0, heapAfter3RoundsMB: h1, gpu: g0, gpuAfter3Rounds: { texMB: g1.texMB, geoMB: g1.geoMB, geometries: g1.geometriesCount, textures: g1.texturesCount }, errs: errs.slice(0, 2) };
    rows.push(row); save();
    console.log(`${label} ${profile} ${map} ${tier}: heap ${h0} -> ${h1} MB; tex ${g0.texMB} MB geo ${g0.geoMB} MB (${JSON.stringify(g0.parts)}) counts tex ${g0.texturesCount} geo ${g0.geometriesCount}`);
    await ctx.close();
  }
}


// ------------------------------------------------------------------------------------------ what costs triangles / calls / cpu per view
async function breakdownMode() {
  for (const profile of profiles) for (const map of maps) for (const tier of tiers) {
    const { ctx, page, errs } = await newPage(profile, { net: false });
    await page.goto(`${base}/?map=${map}&quality=${tier}&radio=0&introhold=600${EXTRA}`, { waitUntil: 'commit' }); await readyWait(page);
    await page.evaluate(() => window.__game.start()); await sleep(1200);
    const probe = async () => { await sleep(500); return summarize(await SAMPLE(page, 1.2)); };
    const parts = async (view) => {
      const out = { all: await probe() };
      const toggle = async (name, getList, set) => { const l = getList(); const prev = l.map((m) => m.visible); l.forEach((m) => { m.visible = false; }); out['no-' + name] = await probe(); l.forEach((m, i) => { m.visible = prev[i]; }); };
      const H = (f) => page.evaluate(f);
      for (const [name, sel] of [['trees', 'w.treeMeshes'], ['props', 'w.propMeshes.filter((m) => !w.treeMeshes.includes(m))'], ['buildings', '[w.buildingMesh]'], ['ground', 'w.ground.children']]) {
        await page.evaluate(([sel]) => { const w = window.__life.world; window.__hid = eval(sel); window.__prev = window.__hid.map((m) => m.visible); window.__hid.forEach((m) => { m.visible = false; }); }, [sel]);
        out['no-' + name] = await probe();
        await page.evaluate(() => { window.__hid.forEach((m, i) => { m.visible = window.__prev[i]; }); });
      }
      await page.evaluate(() => { const l = window.__life; window.__sh = l.game.light.sun.castShadow; l.game.light.sun.castShadow = false; }); out['no-shadow'] = await probe(); await page.evaluate(() => { window.__life.game.light.sun.castShadow = window.__sh; });
      return out;
    };
    const res = { intro: await parts('intro') };
    await page.evaluate(() => { window.__game.skipIntro(); window.__game.step(6); window.__game.setRadius(30); window.__game.step(0.3); }); await sleep(800);
    res.r30 = await parts('r30');
    await page.evaluate(() => { window.__game.setRadius(30); window.__game.zoomBy(100); window.__game.step(0.5); }); await sleep(800);
    res.zoomout = await parts('zoomout');
    const row = { profile, map, tier, label, res, errs: errs.slice(0, 2) };
    rows.push(row); save();
    const f = (o) => `${o.cpuMs}ms ${(o.tris / 1e6).toFixed(2)}M ${o.calls}c`;
    for (const [v, o] of Object.entries(res)) console.log(`${label} ${profile} ${map} ${tier} ${v}: all ${f(o.all)} | ` + Object.entries(o).filter(([k]) => k !== 'all').map(([k, x]) => `${k} ${f(x)}`).join(' | '));
    await ctx.close();
  }
}

try { await ({ breakdown: breakdownMode, load: loadMode, build: buildMode, frame: frameMode, trace: traceMode, mem: memMode }[mode] || (() => { throw new Error('mode?'); }))(); }
finally { save(); await srv.close(); for (const b of Object.values(browsers)) await b.close().catch(() => {}); }
process.exit(0);

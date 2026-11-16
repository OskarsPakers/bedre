// Headless autoplayer rounds for anti-cheat calibration (tools/gen-limits.mjs) and the false-reject check
// (tools/check-legit.mjs). Builds its own copy of the game into scripts/.dist-limits (with a build-time transform that
// exposes the Game / World objects, no source edits), serves it with `vite preview` and drives it with Playwright.
// The sim uses the REAL game code incl. src/modes.js and src/trace.js, so the traces are exactly what a browser sends.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function openSim({ port = 5191, noBuild = false, dist = path.join(root, 'scripts', '.dist-limits') } = {}) {
  if (!noBuild) {
    await build({
      root, logLevel: 'error',
      build: { outDir: dist, emptyOutDir: true, chunkSizeWarningLimit: 5000 },
      plugins: [{
        name: 'expose-internals',
        transform(code, id) {
          if (!id.replace(/\\/g, '/').endsWith('/src/main.js')) return null;
          return code.replace('window.__game = game.api();', 'window.__game = game.api(); window.__G = game; window.__W = world; window.__CFG = CFG;');
        },
      }],
    });
  }
  const base = `http://localhost:${port}`;
  const server = spawn('npx', ['vite', 'preview', '--outDir', dist, '--port', String(port), '--strictPort'], { cwd: root, stdio: 'pipe', detached: true });
  const kill = () => { try { process.kill(-server.pid, 'SIGKILL'); } catch {} };
  process.on('exit', kill);
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  const browser = await chromium.launch({
    headless: true,
    args: process.env.GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await (await browser.newContext({ viewport: { width: 800, height: 500 } })).newPage();
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  const open = async (q = '') => {
    await page.goto(`${base}/?intro=0&${q}`);
    await page.waitForFunction(() => document.body.dataset.ready === '1' || document.body.dataset.error, null, { timeout: 120000 });
    await page.evaluate(() => { const g = window.__G; g._hudSync = () => {}; g._overlay = () => {}; g._flushPopup = () => {}; });
  };
  return { page, open, close: async () => { await browser.close(); kill(); } };
}

/**
 * One simulated round in the CURRENT page (call sim.open() first; `?bots=0` in the URL = no bots).
 * k = growth-constant override (balance experiments), speedMul = handicap (a weaker 'human-like' player).
 * strategy 'greedy' = Game.autoplay (value / distance), 'cluster' = greedy that also values clusters (stronger).
 * Returns { mode, trace, final, killGains, botScores, values }.
 */
export async function simRound(page, { mode, day = null, strategy = 'greedy', seconds = 400, collectValues = false, k = null, speedMul = 1, difficulty = null }) {
  return page.evaluate(({ mode, day, strategy, seconds, collectValues, k, speedMul, difficulty }) => {
    const g = window.__G, bus = window.__life.bus, W = window.__W, C = window.__CFG;
    window.__modes.setMode(mode);
    if (difficulty) window.__modes.setDifficulty(difficulty);
    if (day) window.__modes.setDay(day);
    const killGains = [];
    const off = bus.on('holeEaten', (e) => killGains.push(Math.round(e.gain)));
    try { g.start(); } catch (e) { console.warn('start:', e.message); }
    if (k) C.growth.k = k;
    g.skipIntro();
    const p = g.player;
    p.speedMul = speedMul;
    if (strategy === 'greedy') g.autoplay(seconds);
    else if (strategy === 'casual') {
      // A sensible but imperfect human: 0.65x speed (unless speedMul is given), re-targets every 0.5-1.4 s with a limited view, picks by
      // noisy value / distance, wanders off now and then, reacts to a threat only after ~0.6 s. Used for balance + anti-cheat realism.
      if (speedMul === 1) p.speedMul = 0.65;
      g.autopilot = true;
      let t = 0, nextPick = 0, goal = null, wander = 0, wDir = 0, threatT = 0;
      while (t < seconds && g.phase === 'playing') {
        if (t >= nextPick || !goal || goal.state !== 0) {
          nextPick = t + 0.5 + Math.random() * 0.9;
          if (wander <= 0 && Math.random() < 0.04) { wander = 1.2 + Math.random() * 1.8; wDir = Math.random() * Math.PI * 2; }
          const R = Math.max(25, p.radius * 8);
          let best = null, bs = -1;
          W.query(p.x, p.z, R, (o, d) => {
            if (o.state !== 0 || o.fit >= p.radius * C.swallow.fitRatio) return;
            const s = o.value / (d + p.radius * 1.5 + 4) * (0.75 + Math.random() * 0.5);
            if (s > bs) { bs = s; best = o; }
          });
          goal = best;
        }
        let threat = null;
        for (const o of g.holes) if (o !== p && o.alive && !o.dying && o.radius >= p.radius * C.duel.ratio * 0.92 && Math.hypot(o.x - p.x, o.z - p.z) < o.radius * 3.2 + 14) threat = o;
        threatT = threat ? threatT + 0.2 : 0;
        if (threat && threatT >= 0.6) { const ax = p.x - threat.x, az = p.z - threat.z, l = Math.hypot(ax, az) || 1; p.control = { mode: 'target', x: p.x + (ax / l) * 60, z: p.z + (az / l) * 60 }; }
        else if (wander > 0) { p.control = { mode: 'target', x: p.x + Math.cos(wDir) * 80, z: p.z + Math.sin(wDir) * 80 }; wander -= 0.2; }
        else if (goal) p.control = { mode: 'target', x: goal.x + (Math.random() - 0.5) * p.radius * 0.5, z: goal.z + (Math.random() - 0.5) * p.radius * 0.5 };
        else { const a = Math.random() * Math.PI * 2; p.control = { mode: 'target', x: p.x + Math.cos(a) * 100, z: p.z + Math.sin(a) * 100 }; }
        for (let i = 0; i < 12 && g.phase === 'playing'; i++) { g.update(1 / 60, true); t += 1 / 60; }
      }
      g.autopilot = false;
    } else {
      g.autopilot = true;
      let t = 0, iter = 0;
      const jitter = (i) => Math.sin(i * 12.9898) * 0.5;
      while (t < seconds && g.phase === 'playing') {
        const R = Math.max(25, p.radius * 9);
        const cand = [];
        W.query(p.x, p.z, R, (o, d) => { if (o.state === 0 && o.fit < p.radius * C.swallow.fitRatio) cand.push([o, d]); });
        if (cand.length > 150) { cand.sort((a, b) => a[1] - b[1]); cand.length = 150; }   // keep the O(n^2) cluster scan cheap once the hole is huge
        let best = null, bs = -1;
        const cr2 = Math.pow(Math.max(6, p.radius * 2.2), 2);
        for (const [o, d] of cand) {
          let cl = 0;
          for (const [q] of cand) { const dx = q.x - o.x, dz = q.z - o.z; if (dx * dx + dz * dz < cr2) cl += q.value; }
          const s = (o.value * 0.4 + cl * 0.6) / (d + p.radius * 1.2 + 3);
          if (s > bs) { bs = s; best = o; }
        }
        let threat = null;
        for (const o of g.holes) if (o !== p && o.alive && !o.dying && o.radius >= p.radius * C.duel.ratio * 0.92 && Math.hypot(o.x - p.x, o.z - p.z) < o.radius * 3.2 + 14) threat = o;
        if (threat) { const ax = p.x - threat.x, az = p.z - threat.z, l = Math.hypot(ax, az) || 1; p.control = { mode: 'target', x: p.x + (ax / l) * 60, z: p.z + (az / l) * 60 }; }
        else if (best) p.control = { mode: 'target', x: best.x, z: best.z };
        else p.control = { mode: 'target', x: p.x + jitter(iter) * 200, z: p.z + jitter(iter + 7) * 200 };
        iter++;
        for (let i = 0; i < 6 && g.phase === 'playing'; i++) { g.update(1 / 60, true); t += 1 / 60; }
      }
      g.autopilot = false;
    }
    off();
    g._rank();
    const me = g.rows.find((r) => r.isPlayer);
    const out = {
      mode, day: day || null, trace: window.__trace(),
      final: { score: Math.round(p.score), eaten: p.eaten, radius: Math.round(p.radius * 100) / 100, rank: me.rank, kills: p.kills, deaths: p.deaths, phase: g.phase },
      killGains, botScores: g.bots.holes.map((h) => Math.round(h.score)), difficulty: window.__CFG.difficulty, botCount: g.bots.holes.length, twist: mode === 'daily' ? window.__modes.daily().twist.id : null,
    };
    if (collectValues) {
      const v = {};
      for (const o of W.objects) {
        const k = o.isBuilding ? (o.landmark ? 'landmark' : 'building') : String(o.kind).replace(/\d+$/, '');
        const e = v[k] || (v[k] = [Infinity, 0]);
        e[0] = Math.min(e[0], o.value); e[1] = Math.max(e[1], o.value);
      }
      out.values = v;
    }
    return out;
  }, { mode, day, strategy, seconds, collectValues, k, speedMul, difficulty });
}

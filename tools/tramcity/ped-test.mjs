// The smoke test's pedestrian-crossing scenario, alone, repeated, against ?city=0 and ?city=1 (dev server or preview on :5193).   node tools/tramcity/ped-test.mjs [reps=4] [base=http://localhost:5193]
import { chromium } from 'playwright';
const reps = +(process.argv[2] || 4), base = process.argv[3] || 'http://localhost:5193';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
for (const city of ['0', '1']) {
  const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`${base}/tramvajs/?route=centrs-1&lang=en&city=${city}`); await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 180000 });
  const res = [];
  for (let k = 0; k < reps; k++) for (const bell of [false, true]) res.push(await page.evaluate((bell) => {
    const t = window.__tram; t.start('full', 'centrs-3'); t.setManual(true); t.net.ai.forEach((a) => { a.active = false; }); if (window.__noTraffic) { try { t.S.world.traffic.setFraction(0); } catch {} }
    const run = t.run, p = t.hazards.peds[0], q = t.life.peds[0];
    run.awaitBell = false; run.started = true; run.s = p.s - 135 - 3.78; run.v = 9; run.lever = 0.3;
    let rang = false, hit = false, maxSpeed = 0, onTrack = 0, g = 0;
    while (g++ < 900) { run.setLever(run.v < 9 ? 0.4 : 0.15); t.advance(0.05); if (bell && !rang && q.state !== 'idle') { rang = true; t.bell(); } maxSpeed = Math.max(maxSpeed, q.speed); if (q.state === 'cross' && Math.abs(q.lat) < 2.2) onTrack += 0.05; if (q.state === 'cross' && Math.abs(q.lat) < 1.5 && run.noseS > p.s) hit = true; if (q.state === 'done' || run.noseS > p.s + 20) break; }
    return `${bell ? 'bell' : 'nobell'}:${q.state}/${maxSpeed.toFixed(1)}/${onTrack.toFixed(2)}${hit ? '/HIT' : ''}`;
  }, bell));
  console.log('city=' + city, res.join('  ')); await page.close();
}
await b.close();

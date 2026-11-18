import { chromium } from 'playwright';
const [route, s, off] = [process.argv[2], +process.argv[3], process.argv[4]]; const out = '/Users/oskars/projects/holeio/scripts/out/realistic/_t/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }); const p = await (await b.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
await p.goto(`http://localhost:5197/drive.html?route=${route}&auto=1`); await p.waitForFunction(() => window.__d); await p.evaluate(([s, off]) => { const d = window.__d; if (off === 'none') d.setOffsets([[0, 0]]); d.warp(s); d.setView(2); d.setOrbit({ pitch: 1.5, dist: 14, yaw: 0 }); }, [s, off]);
await p.waitForFunction(() => window.__d.settled, null, { timeout: 90000, polling: 100 }); await p.waitForTimeout(2500); await p.screenshot({ path: out + `top-${s}-${off}.png` }); await b.close();

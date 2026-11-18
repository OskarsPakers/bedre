import { chromium } from 'playwright'; import fs from 'node:fs';
const b = await chromium.launch(); const p = await b.newPage(); p.on('console', m => console.log(m.text())); p.on('pageerror', e => console.log('err', e.message));
await p.goto('http://127.0.0.1:5197/export-tram.html'); await p.waitForFunction(() => window.__done, null, { timeout: 30000 });
const r = await p.evaluate(() => ({ g: window.__glb, e: window.__err })); if (r.e) throw new Error(r.e);
fs.writeFileSync('/Users/oskars/projects/holeio/tools/.cache/realistic/tram.glb', Buffer.from(r.g, 'base64')); console.log('glb bytes', Buffer.from(r.g, 'base64').length); await b.close();

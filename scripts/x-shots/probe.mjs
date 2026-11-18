import { open } from './lib.mjs';
import fs from 'node:fs';
const { browser, page } = await open({ dsf: 1 });
await page.screenshot({ path: 'scripts/out/x-shots/_probe0.png' });
const items = await page.evaluate(() => window.__life.world.buildingItems.filter(i => i.name || i.kind).map(i => ({ id: i.id, name: i.name, kind: i.kind, x: Math.round(i.x), z: Math.round(i.z), h: Math.round(i.h), area: Math.round(i.area) })));
fs.writeFileSync('scripts/out/x-shots/_items.json', JSON.stringify(items));
console.log(items.length);
console.log(JSON.stringify(await page.evaluate(() => ({ b: window.__life.world.data.meta.bounds, hole: window.__game.hole, holes: window.__game.holes.length, st: window.__game.state }))));
await browser.close();

// Playwright snapshots: node snap.mjs <name> <query> [w h]  -> scripts/out/onebuilding/<name>.png
import { withPage } from './shot.mjs';
const [name, query, w = 1600, h = 900] = process.argv.slice(2);
await withPage(async pg => { await pg.goto(`http://localhost:5196/viewer.html?noui=1&w=${w}&h=${h}&${query}`); await pg.waitForFunction('window.__v?.ready', null, { timeout: 240000 }); await pg.waitForTimeout(500); await pg.evaluate('__v.render()'); console.log(JSON.stringify(await pg.evaluate('__v.info()'))); await pg.screenshot({ path: `/Users/oskars/projects/holeio/scripts/out/onebuilding/${name}.png` }); }, { w: +w, h: +h });

// All stills for the report (scripts/out/onebuilding/r-*.png, 1600x900). One browser, viewer page reused.  node renders.mjs [only-prefix]
import { withPage } from './shot.mjs';
const OUT = '/Users/oskars/projects/holeio/scripts/out/onebuilding/', only = process.argv[2] || '';
const VIEWS = [['cab', { view: 'cab', s: 1260, ctx: true }], ['chase', { view: 'chase', s: 1300, ctx: true }], ['orbit0', { view: 'orbit0', ctx: false }], ['orbit1', { view: 'orbit1', ctx: false }], ['orbit2', { view: 'orbit2', ctx: false }], ['orbit3', { view: 'orbit3', ctx: false }]];
const JOBS = []; // [name, model, lod, theme, wire, viewNames]
const all = VIEWS.map(v => v[0]);
JOBS.push(['ref', 'ref', 0, 'day', false, all]); JOBS.push(['a', 'bake', 2, 'day', false, all]); JOBS.push(['b', 'param', 0, 'day', false, all]); JOBS.push(['c0', 'hybrid', 0, 'day', false, all]); JOBS.push(['c1', 'hybrid', 1, 'day', false, all]); JOBS.push(['c2', 'hybrid', 2, 'day', false, all]);
JOBS.push(['c0-evening', 'hybrid', 0, 'evening', false, ['cab', 'chase', 'orbit0', 'orbit1']]); JOBS.push(['c0-winter', 'hybrid', 0, 'winter', false, ['cab', 'chase', 'orbit0', 'orbit1']]);
JOBS.push(['c0-wire', 'hybrid', 0, 'day', true, ['chase', 'orbit0', 'orbit1']]); JOBS.push(['c1-wire', 'hybrid', 1, 'day', true, ['chase', 'orbit0', 'orbit1']]); JOBS.push(['c2-wire', 'hybrid', 2, 'day', true, ['chase', 'orbit0', 'orbit1']]);
await withPage(async pg => {
  await pg.goto('http://localhost:5196/viewer.html?noui=1&w=1600&h=900&model=none&ctx=1'); await pg.waitForFunction('window.__v?.ready', null, { timeout: 240000 });
  for (const [name, model, lod, theme, wire, vs] of JOBS) { if (!name.startsWith(only)) continue; await pg.evaluate(async ([model, lod, theme, wire]) => { await __v.set({ model, lod, theme, wire }); }, [model, lod, theme, wire]);
    for (const vn of vs) { const v = VIEWS.find(x => x[0] === vn)[1]; await pg.evaluate(async (v) => { document.querySelector('canvas'); const ctxOn = v.ctx; __v.scene.traverse(o => { }); __v.ctxToggle?.(ctxOn); await __v.set({ view: v.view, s: v.s ?? __v.S.s }); }, v); await pg.waitForTimeout(250); await pg.screenshot({ path: OUT + `r-${name}-${vn}.png` }); console.log(name, vn, JSON.stringify(await pg.evaluate('__v.info()'))); } }
}, { w: 1600, h: 900 });

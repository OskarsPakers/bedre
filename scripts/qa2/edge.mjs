import * as L from './lib.mjs';
const st = async () => (await fetch(L.BASE + '/api/mp/status')).json();
const O = (p) => p.evaluate(() => ({ st: window.__online.state, room: window.__online.room, me: window.__online.me, n: window.__online.lobby?.players?.length, sc: window.__online.serverScore, rem: window.__online.remotes?.().length, err: window.__online.lastError ?? null, cnt: document.getElementById('mp-count')?.textContent, run: document.getElementById('mp-running')?.textContent?.slice(0, 80) }));
const until = async (p, fn, to = 20000) => { const t = Date.now(); while (Date.now() - t < to) { if (await p.evaluate(fn).catch(() => false)) return true; await L.sleep(200); } return false; };
const mk = async (prof, name, extra = {}) => { const p = await L.open(prof, { name, ...extra }); await L.load(p); return p; };
const phone = { eng: 'webkit', dev: 'iPhone 13', name: 'wk13' }, chr = { eng: 'chromium', name: 'chr' }, ff = { eng: 'firefox', name: 'ff' };
const join = async (p) => { if (p.__p.dev) await L.T.tapEl(p, '#play-online'); else await p.click('#play-online'); };
const R = {};
// ---- S1: reload mid-round, then press Online again
let A = await mk(chr, 'Aa'), B = await mk(phone, 'Bb');
await join(A); await join(B);
await until(A, () => window.__online.state === 'playing', 30000); await until(B, () => window.__online.state === 'playing', 30000);
R.s1_roundStarted = [await O(A), await O(B)];
await L.sleep(8000);
const b0 = (await O(B)).sc; await B.reload(); await L.sleep(300);
await B.waitForFunction(() => document.body.dataset.ready === '1'); await L.sleep(500);
R.s1_afterReload = await O(B); await L.shot(B, 's1-afterreload');
await join(B); await L.sleep(4000);
R.s1_afterOnlineTap = await O(B); await L.shot(B, 's1-afterOnline');
R.s1_status = await st(); R.s1_b0 = b0;
// ---- S2: A drops hook (real ws close) -> resume ; quick reconnect
await A.evaluate(() => window.__online.drop()); await L.sleep(200); R.s2_rec = await A.evaluate(() => window.__online.reconnecting); await L.shot(A, 's2-reconnecting');
await until(A, () => !window.__online.reconnecting && window.__online.state === 'playing', 15000); R.s2_after = await O(A);
// ---- S3: late joiner C -> next lobby w/ running info; two tabs same context 
const C = await mk(ff, 'Cc'); await join(C); await L.sleep(3000); R.s3_C = await O(C); await L.shot(C, 's3-C-nextlobby');
const ctxPage2 = await C.__ctx.newPage(); await ctxPage2.goto(`${L.BASE}/?quality=low&radio=0`); await ctxPage2.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
await ctxPage2.click('#play-online'); await L.sleep(3000); R.s3_tab2 = await O(ctxPage2); R.s3_C_after = await O(C); await L.shot(ctxPage2, 's3-tab2');
// ---- S4: odd names
for (const nm of ['👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦', 'ÅäĀ ŠŽ​‮ rtl', '   ', 'x'.repeat(40)]) {
  const q = await mk(chr, nm); await q.fill('#name', nm); await q.click('#play-online'); await L.sleep(2500);
  const o = await O(q); const nmShown = await q.evaluate(() => [...document.querySelectorAll('#mp-list li, .mp-pl')].map((e) => e.textContent.trim()).join('|')); R['s4_' + nm.slice(0, 6)] = { o, nmShown: nmShown.slice(0, 120), inField: await q.inputValue('#name') };
  await q.__ctx.close();
}
// ---- S5: everyone leaves during countdown, then status
await C.evaluate(() => window.__online.leave()); await ctxPage2.evaluate(() => window.__online.leave()); await L.sleep(1500);
R.s5_status = await st();
// ---- S6: last human leaves mid-round; round continues? 
await A.evaluate(() => window.__online.leave()); await L.sleep(1000); R.s6_afterA = await st(); await L.sleep(20000); R.s6_later = await st();
console.log(JSON.stringify(R, null, 1)); console.log('ERRS', JSON.stringify(L.log.errs)); await L.closeAll();

import { open } from './lib.mjs';
for (const [w,h] of [[1600,900],[1920,1080],[1280,720],[2200,1240]]) {
  const { browser, page } = await open({ w, h, dsf: 1, extra: '' });
  console.log(w,h, JSON.stringify(await page.evaluate(() => { const c = document.getElementById('board-chip'); return c ? { d: getComputedStyle(c).display, t: c.textContent, tui: document.body.className } : null; })));
  await browser.close();
}

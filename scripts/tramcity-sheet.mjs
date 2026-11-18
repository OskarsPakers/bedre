// Comparison sheets: columns = before (?city=0) | after | real mesh reference.  node scripts/tramcity-sheet.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd(), O = path.join(root, 'scripts/out/tramcity'), R = path.join(root, 'scripts/out/realistic');
const ex = (f) => fs.existsSync(f) ? 'file://' + f : null;
const row = (label, b, a, r) => ({ label, imgs: [ex(path.join(O, b)), ex(path.join(O, a.replace('after-', 'r2-'))), ex(path.join(O, a.replace('after-', 'r3-'))), r ? ex(path.join(R, r)) : null] }); // before | round 2 | round 3 | real
const sheets = {
  'compare-cab': [1200, 1250, 1300, 1400, 1500].map((s) => row(`cab s=${s}`, `before-day-cab-centrs-3-${s}.png`, `after-day-cab-centrs-3-${s}.png`, `a-cab-${s}.png`)),
  'compare-chase': [1200, 1250, 1300, 1400, 1500].map((s) => row(`chase s=${s}`, `before-day-chase-centrs-3-${s}.png`, `after-day-chase-centrs-3-${s}.png`, `a-chase-${s}.png`)),
  'compare-more': [['centrs-3', [300, 700, 2000, 2500]], ['centrs-1', [600, 1600, 2600, 3500]], ['mezaparks', [700, 2000]]].flatMap(([rt, ss]) => ss.map((s) => row(`${rt} s=${s}`, `before-day-chase-${rt}-${s}.png`, `after-day-chase-${rt}-${s}.png`, null)).map((r) => ({ label: r.label, imgs: [r.imgs[1], r.imgs[2], null, null] }))),
  'compare-themes': [['evening cab 1250', 'cab-centrs-3-1250', 'evening'], ['evening cab 1400', 'cab-centrs-3-1400', 'evening'], ['evening chase 1300', 'chase-centrs-3-1300', 'evening'], ['winter chase 1300', 'chase-centrs-3-1300', 'winter'], ['winter cab 1250', 'cab-centrs-3-1250', 'winter']].map(([l, k, th]) => ({ label: l, imgs: [ex(path.join(O, `r2-${th}-${k}.png`)), ex(path.join(O, `r3-${th}-${k}.png`)), null, null] })),
};
const heads = { 'compare-themes': ['round 2', 'round 3', '', ''], 'compare-more': ['round 2', 'round 3', '', ''] };
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1800, height: 600 } });
for (const [name, rows] of Object.entries(sheets)) {
  const h = heads[name] || ['BEFORE (hole-game buildings)', 'ROUND 2', 'ROUND 3', 'REAL mesh'];
  const html = `<body style="margin:0;background:#111;color:#ddd;font:14px sans-serif"><table style="border-collapse:collapse"><tr>${h.map((t) => `<th style="width:450px">${t}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.imgs.map((i, k) => `<td style="padding:2px;width:450px;height:255px;vertical-align:top;text-align:center">${i ? `<img src="${i}" style="width:450px;display:block">` : '<span style="color:#666">no reference</span>'}${k === 0 ? `<div style="position:relative;top:-252px;height:0;left:6px;text-align:left;text-shadow:0 0 3px #000">${r.label}</div>` : ''}</td>`).join('')}</tr>`).join('')}</table></body>`;
  const hf = path.join(O, '_sheet.html'); fs.writeFileSync(hf, html); await page.goto('file://' + hf); await page.waitForTimeout(800);
  await page.setViewportSize({ width: 1812, height: Math.max(400, rows.length * 262 + 30) });
  await page.screenshot({ path: path.join(O, name + '.png') }); console.log(name, rows.length);
}
await browser.close(); fs.rmSync(path.join(O, '_sheet.html'), { force: true });

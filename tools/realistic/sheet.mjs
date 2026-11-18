// Contact / comparison sheet: node sheet.mjs out.png cols cellW label1=img1 label2=img2 ...   (images laid out row-major; label optional)
import { chromium } from 'playwright'; import fs from 'node:fs';
const [out, cols, cw, ...items] = process.argv.slice(2); const C = +cols, W = +cw;
const cells = items.map((s) => { const i = s.indexOf('='); return i > 0 && !s.startsWith('/') ? [s.slice(0, i), s.slice(i + 1)] : ['', s]; });
const html = `<body style="margin:0;background:#111;font:14px sans-serif;color:#eee"><div style="display:grid;grid-template-columns:repeat(${C},${W}px);gap:6px;padding:6px">${cells.map(([l, f]) => `<div><img src="file://${f}" style="width:${W}px;display:block">${l ? `<div style="padding:2px 4px">${l}</div>` : ''}</div>`).join('')}</div></body>`;
fs.writeFileSync('/tmp/_sheet.html', html);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: C * (W + 6) + 6, height: 400 } });
await p.goto('file:///tmp/_sheet.html'); await p.waitForTimeout(1500);
await p.screenshot({ path: out, fullPage: true }); await b.close();

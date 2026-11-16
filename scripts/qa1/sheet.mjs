// node sheet.mjs out.png img1 img2 ... (3 columns, 640 px each)
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
const [out, ...imgs] = process.argv.slice(2);
const b = await chromium.launch(); const rows = Math.ceil(imgs.length / 3);
const p = await b.newPage({ viewport: { width: 1920, height: rows * 364 } });
const html = '<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(3,640px);gap:4px">' + imgs.map((f) => `<div style="position:relative"><img src="data:image/png;base64,${readFileSync(resolve(f)).toString('base64')}" style="width:640px;height:360px;object-fit:contain;background:#222;display:block"><span style="position:absolute;left:2px;top:2px;font:11px monospace;color:#ff0;background:#000a">${f.split('/').pop()}</span></div>`).join('') + '</body>';
await p.setContent(html); await p.waitForTimeout(800);
await p.screenshot({ path: out }); await b.close();

// montage.mjs out.png img1 img2 ... (labels under each; max ~5 per sheet, height 560)
import { chromium } from 'playwright'; import fs from 'node:fs'; import path from 'node:path';
const [o, ...f] = process.argv.slice(2);
const html = `<body style="margin:0;background:#222;display:flex;gap:6px;padding:6px;align-items:flex-start;font:12px monospace;color:#fff">${f.map((x) => `<div><img src="data:image/png;base64,${fs.readFileSync(x).toString('base64')}" style="height:560px;display:block">${path.basename(x).replace(/^qa2-|\.png$/g, '')}</div>`).join('')}</body>`;
const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1800, height: 620 } }); await pg.setContent(html); await pg.waitForTimeout(500);
await pg.screenshot({ path: o, fullPage: true }); await b.close();

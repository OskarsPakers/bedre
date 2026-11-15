// Generates PWA icons (public/icons/*): the BEDRE mark = dark hole with a terracotta rim on slate. Rendered via Playwright (SVG -> PNG).
//   node tools/meta/icons.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = path.join(root, 'public', 'icons');
fs.mkdirSync(out, { recursive: true });

// scale = share of the canvas used by the mark's outer diameter (maskable keeps it inside the 80% safe zone)
const svg = (size, scale, rounded) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
<defs>
 <radialGradient id="bg" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="#3f5367"/><stop offset="1" stop-color="#222d38"/></radialGradient>
 <radialGradient id="hole" cx="50%" cy="38%" r="62%"><stop offset="0" stop-color="#43302b"/><stop offset=".55" stop-color="#0b0807"/><stop offset="1" stop-color="#000"/></radialGradient>
 <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ef6b43"/><stop offset="1" stop-color="#b8401f"/></linearGradient>
</defs>
<rect width="512" height="512" ${rounded ? 'rx="112"' : ''} fill="url(#bg)"/>
<g transform="translate(256 256) scale(${scale})">
 <ellipse cx="0" cy="22" rx="190" ry="176" fill="rgba(0,0,0,.28)"/>
 <circle r="190" fill="url(#rim)"/>
 <circle r="150" fill="url(#hole)"/>
 <path d="M-92 -78 A126 126 0 0 1 20 -122" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="10" stroke-linecap="round"/>
</g></svg>`;

const jobs = [
  ['icon-192.png', 192, 1.0 * 0.82 / 1, true], ['icon-512.png', 512, 0.82, true],
  ['maskable-512.png', 512, 0.62, false], ['apple-touch-icon.png', 180, 0.78, false],
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, scale, rounded] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size, scale / 1, rounded)}</body></html>`);
  await page.screenshot({ path: path.join(out, name), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', name, size);
}
await browser.close();

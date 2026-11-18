import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MAPS, mapPaths } from './tools/maps.mjs';

// [meta/PWA] stamp public/sw.js with a build id (hash of the emitted asset names) so every build ships a byte-different service worker
const swStamp = () => {
  let out = 'dist';
  return {
    name: 'bedre-sw-stamp',
    apply: 'build',
    configResolved(c) { out = path.resolve(c.root, c.build.outDir); },
    closeBundle() {
      const f = path.join(out, 'sw.js');
      if (!fs.existsSync(f)) return;
      const names = fs.existsSync(path.join(out, 'assets')) ? fs.readdirSync(path.join(out, 'assets')).sort().join('|') : '';
      const id = crypto.createHash('sha1').update(names + fs.readFileSync(path.join(out, 'index.html'))).digest('hex').slice(0, 10);
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/__BUILD_ID__/g, id));
    },
  };
};
// content ids of the per-map placement files (public/data/placements.json, written by tools/mp/build-objects.mjs): baked into the bundle as
// __PLACEMENTS__ so the client always asks for (and verifies) exactly the file revision its own code was released with.
const placements = () => {
  try { return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'public/data/placements.json'), 'utf8')); } catch { return { maps: {} }; }
};
// Start the selected map's data files downloading while the JS bundle is still downloading / parsing: an inline script in <head> picks the map
// exactly like src/maps.js (?map= > localStorage > centre), adds <link rel=preload as=fetch> for its four files and publishes the decoded byte
// sizes (window.__DATA) so src/loadProgress.js can show one real progress bar over all of them. Skipped for ?sample=1 / ?placements=generate.
// No <link rel=preload> on WebKit (Safari / every iOS browser): it never matched them with the later fetch() and logged "preloaded but not used" x4 (the sizes are still published).
const dataPreload = () => {
  const table = () => {
    const ph = placements();
    const t = {};
    for (const m of MAPS) {
      const p = mapPaths(m.slug), h = ph.maps && ph.maps[m.slug] && ph.maps[m.slug].hash;
      const files = [[p.data, p.data], [p.shapes, p.shapes], [p.ground, p.ground], [p.objects + (h ? `?v=${h}` : ''), p.objects]];
      t[m.slug] = files.map(([url, file]) => { let n = 0; try { n = fs.statSync(path.resolve(process.cwd(), 'public' + file)).size; } catch { /* missing: size unknown */ } return [url, n]; });
    }
    return t;
  };
  return {
    name: 'bedre-data-preload',
    transformIndexHtml(html, ctx) {
      if (ctx && /^\/tramvajs\//.test(ctx.path || '')) return html; // tram prototype: own map (mezaparks) chosen by its code, not by ?map= / the main game's remembered district
      const js = `(function(){try{var T=${JSON.stringify(table())},u=new URLSearchParams(location.search);if(u.get('sample')==='1'||u.get('placements')==='generate')return;var s=u.get('map');if(!s){try{s=localStorage.getItem('bedre.map')}catch(e){}}if(!T[s])s='centrs';var f=T[s];window.__DATA={slug:s,files:f};var ua=navigator.userAgent,wk=/AppleWebKit/.test(ua)&&!/Chrome\\/|Chromium\\/|Edg\\/|OPR\\//.test(ua);if(!wk)f.forEach(function(x){var l=document.createElement('link');l.rel='preload';l.as='fetch';l.crossOrigin='anonymous';l.href=x[0];document.head.appendChild(l)})}catch(e){}})();`;
      return html.replace('</head>', `<script>${js}</script>\n</head>`);
    },
  };
};
// The SPA fallback of the host (`not_found_handling: single-page-application`) serves the main index.html for ANY unknown path (e.g. the removed
// prototype /kur/): all its URLs are absolute, so it boots fine, but the address bar would stay wrong -> an inline script as the first thing in <head>
// sends every non-root path of the MAIN page back to "/" (keeping ?query and #hash). Prototype pages (own index.html) are not affected.
const unknownPathRedirect = () => ({
  name: 'bedre-unknown-path-redirect',
  transformIndexHtml: { order: 'pre', handler(html, ctx) {
    if (!ctx || !/^\/(index\.html)?$/.test(ctx.path || '')) return html;
    return html.replace('<head>', "<head>\n  <script>(function(){var p=location.pathname;if(p!=='/'&&p!=='/index.html')location.replace('/'+location.search+location.hash)})();</script>");
  } },
});
export default defineConfig({
  plugins: [swStamp(), dataPreload(), unknownPathRedirect()],
  define: { __PLACEMENTS__: JSON.stringify(placements()) },
  server: {
    port: 5173, host: true,
    // `npm run dev:worker` serves the API on 8791
    proxy: { '/api': 'http://localhost:8791' },
  },
  build: {
    chunkSizeWarningLimit: 1500,
    // three.js in its own long-cacheable chunk (game code changes far more often than the library)
    rolldownOptions: {
      // multi-page build: the main game + the prototypes (each at its own subpath: /tramvajs/, ...). Add new prototype entries to this list.
      input: { main: 'index.html', tramvajs: 'tramvajs/index.html' },
      output: { codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }] } },
    },
  },
});

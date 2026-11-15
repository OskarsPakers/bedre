import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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
export default defineConfig({
  plugins: [swStamp()],
  server: {
    port: 5173, host: true,
    // `npm run dev:worker` serves the API on 8791
    proxy: { '/api': 'http://localhost:8791' },
  },
  build: {
    chunkSizeWarningLimit: 1500,
    // three.js in its own long-cacheable chunk (game code changes far more often than the library)
    rolldownOptions: {
      output: { codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }] } },
    },
  },
});

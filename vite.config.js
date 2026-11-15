import { defineConfig } from 'vite';
export default defineConfig({
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

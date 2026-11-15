// Play-testing server: same as vite.config.js but with hot reload OFF, so the
// page never refreshes on its own while source files are being edited.
// Refresh the browser manually to pick up the latest code.
//   npx vite --config vite.play.config.js
import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    port: 5199, strictPort: true, host: true,
    hmr: false,
    proxy: { '/api': 'http://localhost:8791' },
  },
});

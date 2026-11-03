import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const page = (p: string) => fileURLToPath(new URL(p, import.meta.url));
// The root package.json carries the release number shown next to the logo.
const { version } = JSON.parse(readFileSync(page('../../package.json'), 'utf8')) as { version: string };

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version), __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)) },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:5178' }
  },
  build: {
    // three.js (WebGPU + TSL) alone is ~1 MB; this is a local app, so one chunk is fine.
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      input: {
        main: page('./index.html'),
        lbm: page('./spikes/lbm.html'),
        fdtd: page('./spikes/fdtd.html')
      }
    }
  }
});

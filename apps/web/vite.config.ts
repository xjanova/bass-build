import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const page = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
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

// Vite configuration - Compiles, bundles, and minifies assets
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    minify: 'terser',
    sourcemap: false
  },
  server: {
    port: 5173
  }
});

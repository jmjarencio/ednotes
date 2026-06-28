import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    minify: 'esbuild', // Faster, highly compressed production code
    sourcemap: false,
    cssMinify: true
  }
});

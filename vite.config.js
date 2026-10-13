import { defineConfig } from 'vite';

// base: './' keeps every asset path relative, so the build runs from any
// sub-path (GitHub Pages, static hosts, local file servers).
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
  server: {
    host: true,
  },
});

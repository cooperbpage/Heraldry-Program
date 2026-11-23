import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Served from https://cooperbpage.github.io/Heraldry-Program/
export default defineConfig({
  base: '/Heraldry-Program/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        proofs: resolve(__dirname, 'proofs.html'),
        leaf: resolve(__dirname, 'leaf.html'),
      },
    },
  },
});

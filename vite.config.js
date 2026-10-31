import { defineConfig } from 'vite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export default defineConfig({
  root: 'public',
  base: './',
  publicDir: false,
  build: { outDir: '../dist', emptyOutDir: true },
  server: { fs: { allow: ['..'] } },
  plugins: [{
    name: 'bundle-local-ocr-assets',
    generateBundle() {
      for (const name of readdirSync('public/vendor')) {
        this.emitFile({ type: 'asset', fileName: `vendor/${name}`, source: readFileSync(join('public/vendor', name)) });
      }
    }
  }]
});

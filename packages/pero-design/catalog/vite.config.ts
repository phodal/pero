import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { fs: { allow: [resolve(import.meta.dirname, '../../..')] } },
  build: { outDir: '../../../target/design-catalog', emptyOutDir: true },
});

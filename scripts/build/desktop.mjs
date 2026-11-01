import { build } from 'esbuild';
await build({ entryPoints: { main: 'desktop/src/main/index.ts', preload: 'desktop/src/preload/index.ts' },
  outdir: 'desktop/dist', outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
await import('./mcp.mjs');

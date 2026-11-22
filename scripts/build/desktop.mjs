import { build } from 'esbuild';
import { cp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
await build({ entryPoints: { main: 'desktop/src/main/index.ts', preload: 'desktop/src/preload/index.ts', 'reproduction-approval-preload': 'desktop/src/preload/reproduction-approval.ts', 'linux-desktop-preload': 'desktop/src/preload/linux-desktop.ts' },
  outdir: 'desktop/dist', outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
await build({ entryPoints: { 'linux-desktop': 'desktop/src/linux-desktop/viewer.tsx' }, outdir: 'desktop/dist', bundle: true, platform: 'browser', format: 'esm',
  define: { 'process.env.NODE_ENV': '"production"' } });
await cp('desktop/src/linux-desktop/index.html', 'desktop/dist/linux-desktop.html');
const desktopRequire = createRequire(new URL('../../desktop/package.json', import.meta.url));
await cp(resolve(dirname(desktopRequire.resolve('@novnc/novnc')), '../LICENSE.txt'), 'desktop/dist/noVNC-LICENSE.txt');
await import('./mcp.mjs');

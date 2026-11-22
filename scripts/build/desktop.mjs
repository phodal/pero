import { build } from 'esbuild';
import { cp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
await build({ entryPoints: { main: 'desktop/src/main/index.ts', preload: 'desktop/src/preload/index.ts', 'reproduction-approval-preload': 'desktop/src/preload/reproduction-approval.ts', 'linux-desktop-preload': 'desktop/src/preload/linux-desktop.ts',
  'javascript-repl': 'desktop/src/main/repl/javascript-kernel.ts' },
  outdir: 'desktop/dist', outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
await build({ entryPoints: { 'linux-desktop': 'desktop/src/linux-desktop/viewer.tsx', 'linux-desktop-peer': 'desktop/src/linux-desktop/peer.ts' }, outdir: 'desktop/dist', bundle: true, platform: 'browser', format: 'esm',
  define: { 'process.env.NODE_ENV': '"production"' } });
await cp('desktop/src/linux-desktop/index.html', 'desktop/dist/linux-desktop.html');
await cp('desktop/src/linux-desktop/peer.html', 'desktop/dist/linux-desktop-peer.html');
const desktopRequire = createRequire(new URL('../../desktop/package.json', import.meta.url));
await cp(resolve(dirname(desktopRequire.resolve('@novnc/novnc')), '../LICENSE.txt'), 'desktop/dist/noVNC-LICENSE.txt');
await cp(resolve(dirname(desktopRequire.resolve('web-tree-sitter')), 'tree-sitter.wasm'), 'desktop/dist/repl-tree-sitter.wasm');
await cp(desktopRequire.resolve('tree-sitter-wasms/out/tree-sitter-javascript.wasm'), 'desktop/dist/repl-javascript.wasm');
await cp('desktop/src/main/repl/qwen/LICENSE', 'desktop/dist/Qwen-Code-REPL-LICENSE.txt');
await cp(resolve(dirname(desktopRequire.resolve('@jitl/quickjs-singlefile-cjs-release-sync/package.json')), 'LICENSE'), 'desktop/dist/QuickJS-LICENSE.txt');
await cp(resolve(dirname(desktopRequire.resolve('web-tree-sitter')), 'LICENSE'), 'desktop/dist/Tree-Sitter-LICENSE.txt');
await cp(desktopRequire.resolve('tree-sitter-wasms/LICENSE'), 'desktop/dist/Tree-Sitter-Wasms-LICENSE.txt');
await import('./mcp.mjs');

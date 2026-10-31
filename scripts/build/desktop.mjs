import { existsSync } from 'node:fs';
import { buildPointRuntime } from './point-app.mjs';
if (process.env.POINT_ROOT) await buildPointRuntime({ pointRoot: process.env.POINT_ROOT, destination: 'packages/point-app/dist' });
if (!['runtime.json', 'install.mjs', process.platform === 'win32' ? 'point-host.exe' : 'point-host'].every(file => existsSync('packages/point-app/dist/' + file))) throw new Error('Build Desktop with POINT_ROOT pointing to the Point checkout to include the shared App SDK');
import { build } from 'esbuild';
await build({ entryPoints: { main: 'desktop/src/main/index.ts', preload: 'desktop/src/preload/index.ts', 'mcp-provider':'desktop/src/main/mcp-provider.ts' },
  outdir: 'desktop/dist', outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
await build({entryPoints:{'mcp-panel':'web/src/mcp/panel.ts','mcp-sandbox':'web/src/mcp/sandbox.ts'},outdir:'desktop/dist',bundle:true,platform:'browser',format:'iife',target:'es2022'});

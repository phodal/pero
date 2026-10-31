// The real Host MCP sidecar and its HTTP assets; no Electron or GPUI build.
import { build } from 'esbuild';
await build({ entryPoints: { 'mcp-provider': 'desktop/src/main/mcp-provider.ts' },
  outdir: 'desktop/dist', outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs' });
await build({ entryPoints: { 'mcp-panel': 'web/src/mcp/panel.ts', 'mcp-sandbox': 'web/src/mcp/sandbox.ts' },
  outdir: 'desktop/dist', bundle: true, platform: 'browser', format: 'iife', target: 'es2022' });

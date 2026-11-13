import {build} from 'esbuild';
import {resolve} from 'node:path';
import {buildMcpApps} from './mcp-apps.mjs';

/** One portable MCP payload shared by the Workbench and App Products with Chat. */
export async function buildMcpHost(directory){
  const root=resolve(import.meta.dirname,'../..');
  await build({entryPoints:{'mcp-provider':resolve(root,'desktop/src/main/mcp-provider.ts')},
    outdir:directory,outExtension:{'.js':'.cjs'},bundle:true,platform:'node',format:'cjs'});
  await build({entryPoints:{'mcp-panel':resolve(root,'web/src/mcp/panel.tsx'),'mcp-sandbox':resolve(root,'web/src/mcp/sandbox.ts')},
    outdir:directory,bundle:true,platform:'browser',format:'iife',target:'es2022',jsx:'automatic'});
  await buildMcpApps(directory);
}

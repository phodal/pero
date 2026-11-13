import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

// Compile existing Host route TypeScript too (Node strip-only cannot load parameter properties).
await import('../build/mcp.mjs');
const output=resolve('target/mcp-apps-test/notebook-inspector.test.mjs');
await build({entryPoints:['desktop/src/main/notebook-inspector.test.ts'],outfile:output,
  bundle:true,packages:'external',platform:'node',format:'esm'});
const result=spawnSync(process.execPath,['--preserve-symlinks-main','--test',output],{stdio:'inherit',env:process.env});
if(result.error)throw result.error;
process.exitCode=result.status??1;

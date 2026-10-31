// All inputs and pinned public dependencies are owned by this repository.
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { mkdir,writeFile,rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=resolve(import.meta.dirname,'../..');
export async function buildAutomationApp({outdir=resolve(root,'apps/automations/dist')}={}) {
  const appRoot=resolve(root,'apps/automations');
  if(!existsSync(resolve(appRoot,'node_modules/react/package.json'))) {
    const windows=process.platform==='win32';
    if(windows&&!process.env.npm_execpath)throw new Error('Run the build through npm on Windows');
    execFileSync(windows?process.execPath:'npm',[...(windows?[process.env.npm_execpath]:[]),'ci','--prefix',appRoot,'--ignore-scripts'],{stdio:'inherit'});
  }
  await rm(outdir,{recursive:true,force:true});await mkdir(outdir,{recursive:true});
  await build({absWorkingDir:root,entryPoints:[resolve(appRoot,'ui-src/frame.tsx')],outfile:resolve(outdir,'index.js'),bundle:true,format:'esm',platform:'browser',target:'safari17',jsx:'automatic',minify:true,
    alias:{react:resolve(appRoot,'node_modules/react'),'react-dom':resolve(appRoot,'node_modules/react-dom'),'@pero/app-sdk':resolve(root,'packages/app-sdk/src/index.tsx')}});
  await writeFile(resolve(outdir,'index.html'),'<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Automations</title><link rel="stylesheet" href="./index.css"></head><body><div id="app"></div><script type="module" src="./index.js"></script></body></html>\n');
  console.log(`Built Pero Automations: ${outdir}`);return {outdir};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await buildAutomationApp();

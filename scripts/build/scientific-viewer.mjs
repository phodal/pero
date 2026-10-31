// Point remains the source owner; Pero ships a self-contained, byte-preserving App.
import { cp,mkdtemp,readFile,rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { buildPointRuntime } from './point-app.mjs';
import { preparePointApp } from '../../packages/point-app/install.mjs';
const root=resolve(import.meta.dirname,'../..');
export async function buildScientificViewer({pointRoot=process.env.POINT_ROOT??process.env.PERO_POINT_ROOT}={}) {
  if(!pointRoot)throw new Error('Scientific Viewer build requires POINT_ROOT pointing to the Point source checkout with its App and SDK dependencies installed');
  const source=resolve(pointRoot,'apps/scientific-viewer'),destination=resolve(root,'apps/scientific-viewer');
  await new Promise((done,reject)=>{
    const child=spawn(process.execPath,[resolve(source,'scripts/build.mjs')],{cwd:source,stdio:'inherit'});
    child.once('error',reject);child.once('exit',code=>code===0?done():reject(new Error(`Scientific Viewer production build failed (${code})`)));
  });
  const runtime=await buildPointRuntime({pointRoot,destination:resolve(root,'packages/point-app/dist')});
  const temp=await mkdtemp(resolve(tmpdir(),'pero-scientific-build-'));
  try {
    const output=await preparePointApp({source,destination:resolve(temp,'app'),runtime});
    assert.deepEqual(JSON.parse(await readFile(resolve(destination,'app.json'),'utf8')),output.manifest,'Scientific Viewer declaration changed; review its Pero contract before building');
    for(const entry of ['point-source','dist','point-backend.mjs','point-build.json']){
      await rm(resolve(destination,entry),{recursive:true,force:true});
      await cp(resolve(output.directory,entry),resolve(destination,entry),{recursive:true});
    }
    console.log(`Built Scientific Viewer from Point ${output.receipt.runtime.pointRevision}`);
  } finally {await rm(temp,{recursive:true,force:true});}
}
if(process.argv[1]===import.meta.filename)await buildScientificViewer();

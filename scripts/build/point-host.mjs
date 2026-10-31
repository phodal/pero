// Compile Point's domain libraries into a private Pero binary; no Point service.
import { mkdtemp,writeFile,rm,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
const root=resolve(import.meta.dirname,'../..');
export async function buildPointHost({pointRoot,destination,test=false}){
  const temp=await mkdtemp(resolve(tmpdir(),'pero-point-host-build-'));
  try{
    const module=resolve(root,'packages/point-host');
    const workspace=resolve(temp,'go.work');
    const modules=[module,...['go/harness','go/runtime','go/projectcore','go/managed','environments'].map(path=>resolve(pointRoot,path))];
    await writeFile(workspace,`go 1.26.0\nuse (\n${modules.map(path=>JSON.stringify(path)).join('\n')}\n)\nreplace github.com/phodal/point/go/harness v0.0.0 => ${JSON.stringify(resolve(pointRoot,'go/harness'))}\n`);
    await mkdir(destination,{recursive:true});
    const args=test?['test','./...']:['build','-trimpath','-buildvcs=false','-o',resolve(destination,process.platform==='win32'?'point-host.exe':'point-host'),'.'];
    await new Promise((done,reject)=>{const child=spawn('go',args,{cwd:module,env:{...process.env,GOWORK:workspace},stdio:'inherit'});child.once('error',reject);child.once('exit',code=>code===0?done():reject(new Error(`Point Host domain build failed (${code})`)));});
    return destination;
  }finally{await rm(temp,{recursive:true,force:true});}
}
if(process.argv[1]===import.meta.filename){const args=process.argv.slice(2),get=name=>{const index=args.indexOf(name);if(index<0)throw new Error(`Required: ${name}`);return args[index+1]};await buildPointHost({pointRoot:get('--point-root'),destination:resolve(get('--out')),test:args.includes('--test')});}

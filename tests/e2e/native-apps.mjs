// Real native App + Host + Python, isolated from the user's preview profile.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile,mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {createInterface} from 'node:readline';
const root=resolve(import.meta.dirname,'../..');
const out=resolve(root,'test-results/native-apps');
const temp=await mkdtemp(resolve(tmpdir(),'pero-native-apps-'));
await mkdir(out,{recursive:true});
const binary=resolve(temp,'pero-native');
const host=resolve(temp,'pero-host');
const receipt=resolve(out,'result.json');
await copyFile(resolve(root,'target/debug/pero-native'),binary);
await copyFile(resolve(root,'target/debug/pero-host'),host);
assert((await readFile(binary)).includes(Buffer.from('Native App acceptance timed out')),'Build with --features native-probe first');
const child=spawn(binary,['--verify-apps',receipt],{cwd:root,env:{...process.env,PERO_NATIVE_BUNDLED:'1',PERO_NATIVE_EPHEMERAL_SECRETS:'1',PERO_NATIVE_DATA_DIR:resolve(temp,'data'),PERO_NATIVE_HOST:host,PERO_BUILTIN_APPS:'virtual-cell',PERO_REQUIRED_APPS:'',PERO_LOCALE:'en'},stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',value=>{log+=value;});child.stderr.on('data',value=>{log+=value;});
const timer=setTimeout(()=>child.kill('SIGKILL'),45000);
try{
 const exit=await new Promise((done,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>done({code,signal}));});
 await writeFile(resolve(out,'native.log'),log);
 assert.equal(exit.signal,null,log);
 assert.equal(exit.code,0,log);
 const result=JSON.parse(await readFile(receipt,'utf8'));
 result.sha256=Object.fromEntries(await Promise.all([binary,host,resolve(root,'apps/virtual-cell/dist/index.js'),resolve(root,'apps/virtual-cell/dist/index.css')].map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
 await writeFile(receipt,JSON.stringify(result,null,2));
 assert.equal(result.passed,true,JSON.stringify(result));
 // Seed the actual saved App checkpoint through Host, then let native startup restore it.
 const saved=spawn(host,['--stdio'],{cwd:root,env:{...process.env,PERO_SETTINGS_PATH:resolve(temp,'data/settings.json'),PERO_HISTORY_PATH:resolve(temp,'data/sessions.jsonl')},stdio:['pipe','pipe','ignore']});
 const saveDeadline=setTimeout(()=>saved.kill('SIGKILL'),15000);
 try{
  await new Promise((done,reject)=>{
   saved.once('error',reject);saved.once('exit',code=>reject(new Error(`Checkpoint Host exited (${code})`)));
   createInterface({input:saved.stdout}).on('line',line=>{
    const event=JSON.parse(line);
    if(event.request_id!==result.checkpoint.request_id)return;
    if(event.kind==='workspace_saved')done();
    if(event.kind==='workspace_error')reject(new Error(JSON.stringify(event)));
   });
   saved.stdin.write(JSON.stringify(result.checkpoint)+'\n');
  });
 }finally{clearTimeout(saveDeadline);saved.stdin.end();}
 const restoredPath=resolve(out,'restored.json');
 const restored=spawn(binary,['--verify-apps',restoredPath,'restore'],{cwd:root,env:{...process.env,PERO_NATIVE_BUNDLED:'1',PERO_NATIVE_EPHEMERAL_SECRETS:'1',PERO_NATIVE_DATA_DIR:resolve(temp,'data'),PERO_NATIVE_HOST:host,PERO_BUILTIN_APPS:'virtual-cell',PERO_REQUIRED_APPS:'',PERO_LOCALE:'en'},stdio:['ignore','pipe','pipe']});
 let restoredLog='';restored.stdout.on('data',value=>restoredLog+=value);restored.stderr.on('data',value=>restoredLog+=value);
 const restoreDeadline=setTimeout(()=>restored.kill('SIGKILL'),45000);
 try{
  const restoredExit=await new Promise((done,reject)=>{restored.once('error',reject);restored.once('exit',(code,signal)=>done({code,signal}));});
  await writeFile(resolve(out,'restored.log'),restoredLog);
  assert.equal(restoredExit.signal,null,restoredLog);assert.equal(restoredExit.code,0,restoredLog);
  const restoredResult=JSON.parse(await readFile(restoredPath,'utf8'));
  assert.equal(restoredResult.passed,true,JSON.stringify(restoredResult));assert.equal(restoredResult.restored,true);
 }finally{clearTimeout(restoreDeadline);restored.kill();}
 console.log('Native Apps passed: real React, authenticated backend evaluation, authority, retention, theme, teardown and saved App restart.');
}finally{clearTimeout(timer);child.kill();}

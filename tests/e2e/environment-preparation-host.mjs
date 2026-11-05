import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createInterface} from 'node:readline';
if(process.env.PERO_ENVIRONMENT_PREPARATION_REAL!=='1')throw Error('Set PERO_ENVIRONMENT_PREPARATION_REAL=1 to allow actual dependency installation.');
const root=resolve(import.meta.dirname,'../..');
const profile=await mkdtemp(resolve(tmpdir(),'pero-env-preparation-'));
await writeFile(resolve(profile,'settings.json'),JSON.stringify({app_python:{}}));

const child=spawn(resolve(root,'target/debug/pero-host'),['--stdio'],{cwd:root,env:{...process.env,PERO_SETTINGS_PATH:resolve(profile,'settings.json'),PERO_APPS_ROOT:resolve(profile,'apps'),PERO_BUILTIN_APPS_ROOT:resolve(root,'apps'),PERO_BUILTIN_APPS:'environments,control-lab,paper-agent',PERO_HISTORY_PATH:resolve(profile,'history.jsonl')},stdio:['pipe','pipe','inherit']});
const pending=new Map();
createInterface({input:child.stdout}).on('line',line=>{let e;try{e=JSON.parse(line);}catch{return;}if(e.kind==='apps_result'){const p=pending.get(e.request_id);if(p){pending.delete(e.request_id);e.data.ok?p.resolve(e.data.value):p.reject(Error(e.data.error));}}});
let next=0;
const request=(request)=>new Promise((resolve,reject)=>{const id=`test-${++next}`;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({method:'apps',action:'localenvironment',id,name:'environments',request})+'\n');});
try {
for(const target of ['control-lab.python-control','control-lab.ngspice','paper-agent.pcgym']){
 const values=await request({operation:'create',label:target,target});const value=values.find(v=>v.target===target);
 console.log('CREATED',value.id,target);
 const ready=(await request({operation:'prepare',id:value.id})).find(v=>v.id===value.id);
 console.log('PREPARED',ready.id,ready.state);
 if(ready.state!=='ready')throw Error(ready.error);
 const bound=(await request({operation:'bind',id:value.id})).find(v=>v.id===value.id);
 if(!bound.bound)throw Error('Binding did not take effect');
 console.log('BOUND',value.id);
 await assert.rejects(request({operation:'prepare',id:value.id}),/new environment/);
}
await writeFile(resolve(profile,'accepted.json'),JSON.stringify(await request({operation:'list'}),null,2));
console.log('ACCEPTED',profile);
}finally{child.stdin.end();child.kill('SIGTERM');}

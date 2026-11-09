// Explicit public-Git acceptance for the exact sources reported by the user.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once,EventEmitter} from 'node:events';
import {mkdir,mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
import Ajv from 'ajv/dist/2020.js';

assert.equal(process.env.PERO_SKILLS_MARKET_PUBLIC,'1','Public Git requires explicit PERO_SKILLS_MARKET_PUBLIC=1');
const root=resolve(import.meta.dirname,'../..'),base=join(root,'target/skills-market-public');
await mkdir(base,{recursive:true});const profile=await mkdtemp(join(base,'sources-'));
const hostBinary=process.env.PERO_HOST_PATH||join(root,'target/debug/pero-host'+(process.platform==='win32'?'.exe':''));
const harness=process.env.PERO_SKILLS_HARNESS_PATH||join(root,'target/debug/pero-agent-acp'+(process.platform==='win32'?'.exe':''));
const catalog=JSON.parse(await readFile(join(root,'docs/design-docs/research-skills-catalog.json'),'utf8'));
const names=new Set(['aer-consistency','analyze-results','aer-preregistration','aer-paper-body']);
const selected=catalog.skills.filter(entry=>names.has(entry.name));assert.equal(selected.length,5);
const schema=JSON.parse(await readFile(join(root,'protocol/generated/host.schema.json'),'utf8'));
const ajv=new Ajv({strict:false});ajv.addSchema(schema);const validate=ajv.getSchema(`${schema.$id}#/$defs/AppsResultEvent`);
const events=[],changed=new EventEmitter(),results=[];let sequence=0,stderr='',host,exit;
async function request(action,fields={}){
  const id=`public-source-${++sequence}`;host.stdin.write(JSON.stringify({method:'apps',id,action,...fields})+'\n');
  const deadline=Date.now()+330000;
  for(;;){const event=events.find(item=>item.kind==='apps_result'&&item.request_id===id);if(event)return event.data;
    const remaining=deadline-Date.now();assert(remaining>0,`Request timed out: ${stderr}`);
    await new Promise((accept,reject)=>{const listener=()=>{clearTimeout(timer);accept();};const timer=setTimeout(()=>{changed.off('event',listener);reject(Error(`Request timed out: ${stderr}`));},remaining);changed.once('event',listener);});
  }
}
const market=(operation,input={})=>request('skillsmarket',{name:'skills',request:{operation,...input}});
async function files(directory){let output=[];for(const entry of await readdir(directory,{withFileTypes:true})){const full=join(directory,entry.name);if(entry.isDirectory())output.push(...await files(full));else output.push(full);}return output;}
try{
  const app=join(profile,'app');await mkdir(join(app,'dist'),{recursive:true});await writeFile(join(app,'dist/index.html'),'<h1>Skills source acceptance</h1>');
  await writeFile(join(app,'app.json'),JSON.stringify({schemaVersion:1,name:'skills',version:'1',displayName:'Skills',permissions:{host:['skills']},contributes:{panels:[{id:'main',title:'Skills',entry:'dist/index.html'}]}}));
  await writeFile(join(profile,'agents.json'),JSON.stringify([{id:'pero',name:'Actual source acquisition',command:harness,args:[],env:{}}]));
  host=spawn(hostBinary,['--stdio'],{cwd:root,env:{...process.env,PERO_AGENTS_FILE:join(profile,'agents.json'),PERO_SETTINGS_PATH:join(profile,'settings.json'),PERO_HISTORY_PATH:join(profile,'history.jsonl'),PERO_APPS_ROOT:join(profile,'apps'),PERO_BUILTIN_APPS_ROOT:'',PERO_REQUIRED_APPS:'',PERO_SKILLS_CATALOG:join(root,'docs/design-docs/research-skills-catalog.json')},stdio:['pipe','pipe','pipe']});
  exit=once(host,'exit');host.stderr.on('data',chunk=>stderr+=chunk);
  createInterface({input:host.stdout}).on('line',line=>{const event=JSON.parse(line);if(event.kind==='apps_result')assert(validate(event),ajv.errorsText(validate.errors));events.push(event);changed.emit('event');});
  for(const[action,input]of[['install',{path:app}],['enable',{name:'skills'}]]){const response=await request(action,input);assert(response.ok,response.error);}
  for(const entry of selected){
    console.log(`Installing ${entry.id}`);
    const started=Date.now(),response=await market('install',{id:entry.id});
    if(!response.ok){results.push({id:entry.id,passed:false,error:response.error});console.log(JSON.stringify(results.at(-1)));continue;}
    const state=JSON.parse(await readFile(join(profile,'skill-market/state.json'),'utf8')),version=state.items[entry.id].versions.find(item=>item.revision===entry.source.commit);
    const bytes=await readFile(join(version.directory,'source',entry.source.path));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.source.sha256);
    const packageFiles=await files(version.directory);
    assert(!packageFiles.some(file=>file.split(/[\\/]/).some(part=>['.git','.original'].includes(part))),'Installed skills must not retain a full Git checkout');
    assert.equal(packageFiles.filter(file=>file.endsWith('SKILL.md')).length,1,'Only the selected skill instructions are exposed');
    if(entry.name==='aer-preregistration'){
      const shared=join(version.directory,'source','skills/50-brycewang-aer-skills');
      assert((await readFile(join(shared,'references.bib'),'utf8')).includes('mckenzie_2012'));
      assert((await readFile(join(shared,'docs/methods-reference.md'),'utf8')).length>0);
    }
    let totalBytes=0;for(const file of packageFiles)totalBytes+=(await readFile(file)).length;
    results.push({id:entry.id,passed:true,revision:entry.source.commit,sha256:entry.source.sha256,files:packageFiles.length,bytes:totalBytes,seconds:Math.round((Date.now()-started)/100)/10});
    console.log(JSON.stringify(results.at(-1)));
  }
  const installed=await market('installed');assert(installed.ok,installed.error);
  const output=join(root,'test-results/skills-market');await mkdir(output,{recursive:true});
  const report={passed:results.every(item=>item.passed),hostSHA256:createHash('sha256').update(await readFile(hostBinary)).digest('hex'),harnessSHA256:createHash('sha256').update(await readFile(harness)).digest('hex'),results,installed:installed.value.items.length,limitations:['Actual public fixed sources; no model inference or scientific validation','Diagnostic profile is isolated; existing user installations are untouched']};
  await writeFile(join(output,'runtime-public-sources.json'),JSON.stringify(report,null,2));
  assert(report.passed,'Some reported public sources failed; see runtime-public-sources.json');assert.equal(report.installed,5);
}finally{
  if(host){host.stdin.end();const timer=setTimeout(()=>host.kill('SIGKILL'),5000);await exit;clearTimeout(timer);}
  await rm(profile,{recursive:true,force:true});
}

// Disposable pre-use readiness only. Never retries an object-store operation.
import { spawnSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

export function projectState(raw, id, image) {
 const statuses=['created','running','paused','restarting','removing','exited','dead'];
 if (!/^[a-f0-9]{64}$/.test(raw.id) || !/^sha256:[a-f0-9]{64}$/.test(raw.image) || !statuses.includes(raw.status) ||
  !['running','paused','restarting','oom_killed'].every(k=>typeof raw[k]==='boolean') ||
  !Number.isInteger(raw.exit_code) || !Number.isInteger(raw.restart_count) || raw.restart_count<0) throw Error('Invalid Docker state projection');
 return {id:raw.id,image:raw.image,identity_match:raw.id===id&&raw.image===image,status:raw.status,
  running:raw.running,paused:raw.paused,restarting:raw.restarting,oom_killed:raw.oom_killed,
  exit_code:raw.exit_code,restart_count:raw.restart_count};
}
export function containerDecision(s) {
 if (s.inspection_error) return 'inspection-failed';
 if (!s.identity_match) return 'identity-mismatch';
 if (s.oom_killed) return 'oom-killed';
 if (s.paused || s.restarting || s.restart_count!==0) return 'unexpected-lifecycle';
 if (s.status==='created' && !s.running && s.exit_code===0) return 'pending';
 if (s.status==='running' && s.running && s.exit_code===0) return 'running';
 return 'container-stopped';
}
export function healthDecision(h) {
 if (h.process_timeout) return 'pending';
 if (h.exit_code===0 && h.http_status===200) return 'ready';
 if (h.exit_code===0 && h.http_status===503) return 'pending';
 if ([7,28,52,56].includes(h.exit_code)) return 'pending';
 return 'fatal-health';
}
export function logCategories(text) {
 // No matched text, paths, endpoints, credential values or arbitrary labels leave
 // this projection. Even unexpected/terminal-mode credential lines stay private.
 const patterns={
  'config-directory':/Unable to initialize the \(deprecated\) config directory/i,
  'cert-directory':/Unable to initialize the certs directory|Unable to create certs CA directory/i,
  'tls-ca':/Unable to load the TLS configuration|Failed to read root CAs/i,
  'credential-configuration':/Invalid (?:root user )?credentials|MINIO_ROOT_(?:USER|PASSWORD)/i,
  'credential-line-omitted':/RootUser:|RootPass:|mc alias set/i,
  'permission-denied':/permission denied/i,
  'read-only-filesystem':/read-only file system/i,
  'address-in-use':/address already in use/i,
  storage:/Unable to initialize the server|drive not found|no space left on device/i,
  'startup-error':/Unable to start the server/i,
  fatal:/\bFATAL\b|\bpanic:/i,
  'startup-banner':/MinIO Object Storage Server|^API:/,
 };
 const counts=Object.fromEntries(Object.keys(patterns).map(k=>[k,0]));let unclassified=0;
 for(const line of text.split('\n').filter(Boolean)){
  let matched=false;
  for(const [name,pattern] of Object.entries(patterns))if(pattern.test(line)){counts[name]++;matched=true;}
  if(!matched)unclassified++;
 }
 return {categories:counts,unclassified_lines:unclassified};
}

// I/O seam: real Docker/curl observations in CI; deterministic synthetic sequences
// offline. One monotonic deadline includes all child processes and pauses.
export async function waitForMinio(io, budgetMs=60000) {
 const start=io.now();let attempt=0;
 const remaining=()=>Math.max(0,budgetMs-(io.now()-start));
 while(remaining()>0){
  const record={attempt:++attempt,state:io.observe(Math.min(2000,remaining()))};
  let decision=containerDecision(record.state);
  if(decision==='running' && remaining()>0){
   record.health=io.probe(Math.min(2000,remaining()));decision=healthDecision(record.health);
   if(remaining()>0){
    record.state_after=io.observe(Math.min(2000,remaining()));
    const after=containerDecision(record.state_after);
    if(after!=='running')decision=after==='pending'?'unexpected-lifecycle':after;
   }
  }
  if(remaining()===0)decision='deadline';
  record.elapsed_ms=Math.ceil(io.now()-start);record.decision=decision;io.record(record);
  if(decision==='ready')return {ready:true,attempts:attempt};
  if(decision!=='pending')return {ready:false,reason:decision,attempts:attempt};
  if(remaining()>0)await io.pause(Math.min(1000,remaining()));
 }
 return {ready:false,reason:'deadline',attempts:attempt};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.env.GITHUB_ACTIONS!=='true'||process.env.PERO_ISOLATED_ACCEPTANCE!=='1')throw Error('Requires separately authorized isolated CI gate');
 const [id,image,endpoint,evidence]=process.argv.slice(2);
 if(!/^[a-f0-9]{64}$/.test(id)||!/^sha256:[a-f0-9]{64}$/.test(image)||!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(endpoint)||new URL(endpoint).port>65535)throw Error('Invalid owned MinIO fixture identity');
 const stateFormat='{"id":{{json .Id}},"image":{{json .Image}},"status":{{json .State.Status}},"running":{{.State.Running}},"paused":{{.State.Paused}},"restarting":{{.State.Restarting}},"oom_killed":{{.State.OOMKilled}},"exit_code":{{.State.ExitCode}},"restart_count":{{.RestartCount}}}';
 const run=(command,args,ms,maxBuffer=8192)=>spawnSync(command,args,{encoding:'utf8',timeout:Math.max(1,Math.floor(ms)),killSignal:'SIGKILL',maxBuffer});
 const observe=ms=>{
  const r=run('docker',['inspect','--type','container','--format',stateFormat,id],ms);
  if(r.status!==0)return {inspection_error:r.error?.code==='ETIMEDOUT'?'timeout':'failed'};
  try{return projectState(JSON.parse(r.stdout),id,image);}catch{return {inspection_error:'invalid-projection'};}
 };
 const result=await waitForMinio({
  now:()=>performance.now(),observe,
  probe:ms=>{
   // Ignore curlrc/proxy settings, never follow redirects, no hidden retries,
   // never retain response body/stderr, and kill the entire client at deadline.
   const r=run('curl',['--disable','--silent','--noproxy','*','--proto','=http','--output','/dev/null','--write-out','%{http_code}','--connect-timeout','1','--max-time',String(ms/1000),`${endpoint}/minio/health/cluster`],ms,1024);
   return {exit_code:r.status,process_timeout:r.error?.code==='ETIMEDOUT',http_status:/^[0-9]{3}$/.test(r.stdout)?Number(r.stdout):null};
  },
  pause:ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  record:r=>appendFileSync(join(evidence,'minio-health-attempts.jsonl'),JSON.stringify(r)+'\n'),
 });
 writeFileSync(join(evidence,'minio-health-result.json'),JSON.stringify(result)+'\n');
 if(!result.ready){
  writeFileSync(join(evidence,'minio-final-state.json'),JSON.stringify(observe(2000))+'\n');
  const r=run('docker',['logs','--tail','100',id],2000,65536);
  const bytes=Buffer.from((r.stdout??'')+(r.stderr??''));
  const projection={exit_code:r.status,process_timeout:r.error?.code==='ETIMEDOUT',buffer_limited:r.error?.code==='ENOBUFS'||bytes.length>65536,...logCategories(bytes.subarray(0,65536).toString())};
  writeFileSync(join(evidence,'minio-log-categories.json'),JSON.stringify(projection)+'\n');
  process.exitCode=1;
 }
}

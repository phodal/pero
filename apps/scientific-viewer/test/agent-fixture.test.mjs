import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {mkdtemp,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {resolve} from 'node:path';
import {emptyEvidence,reviewPrompt} from '../ui-src/evidence.ts';
test('synthetic ACP checks quotation context and rejects absent evidence',async()=>{
 const dir=await mkdtemp(resolve(tmpdir(),'scientific-review-'));try{
  const capture=resolve(dir,'capture.jsonl'),file={id:'test',name:'example.pdf',bytes:new Uint8Array(),sha256:'a'.repeat(64)};
  const evidence={...emptyEvidence(file.sha256),quotes:[{id:'q',page:1,text:'Synthetic scientific evidence.',start:0,end:30,pageTextSha256:'b'.repeat(64)}]},prompt=[{type:'text',text:reviewPrompt(file,evidence)}];
  const messages=[{id:1,method:'initialize'},{id:2,method:'session/new'},{id:3,method:'session/prompt',params:{sessionId:'synthetic-evidence-review',prompt}},{id:4,method:'session/prompt',params:{sessionId:'synthetic-evidence-review',prompt:[{type:'text',text:'No evidence'}]}}];
  const result=spawnSync(process.execPath,[resolve(import.meta.dirname,'agent-fixture.mjs'),capture],{input:messages.map(value=>JSON.stringify({jsonrpc:'2.0',...value})).join('\n')+'\n',encoding:'utf8',timeout:5000});
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);const replies=result.stdout.trim().split('\n').map(JSON.parse);assert.equal(replies.find(r=>r.id===3).result.stopReason,'end_turn');assert.equal(replies.find(r=>r.id===4).error.code,-32602);assert.equal(replies.filter(r=>r.method==='session/update').length,2);assert.deepEqual(JSON.parse((await readFile(capture,'utf8')).split('\n')[0]),prompt);
 }finally{await rm(dir,{recursive:true,force:true});}
});

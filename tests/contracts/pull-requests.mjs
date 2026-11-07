// Real Host JSONL and GitHub CLI boundary, with one shared process fixture.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, mkdir, writeFile, chmod, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../protocol/generated/host.schema.json' with {type:'json'};
const root=resolve(import.meta.dirname,'../..');
const temp=await mkdtemp(resolve(tmpdir(),'pero-pr-host-'));
const live=process.argv.includes('--live');
const bin=resolve(temp,'bin');await mkdir(bin);
await writeFile(resolve(bin,'gh'),`#!/bin/sh\nexec '${process.execPath}' '${root}/tests/fixtures/gh-pr.mjs' "$@"\n`);await chmod(resolve(bin,'gh'),0o755);
const ajv=new Ajv2020({strict:true,strictTypes:false});ajv.addSchema(schema);
const validate=name=>ajv.getSchema(`${schema.$id}#/$defs/${name}`);
const env={...process.env,...(!live?{PATH:`${bin}:${process.env.PATH}`}:{ }),PERO_APPS_ROOT:resolve(temp,'apps'),PERO_SETTINGS_PATH:resolve(temp,'settings.json'),PERO_HISTORY_PATH:resolve(temp,'sessions.jsonl'),PERO_PR_CALLS:resolve(temp,'calls'),PERO_PR_FAIL:resolve(temp,'fail')};
const child=spawn(resolve(root,'target/debug/pero-host'),['--stdio'],{cwd:temp,env,stdio:['pipe','pipe','inherit']});
const waiting=new Map();
createInterface({input:child.stdout}).on('line',line=>{const event=JSON.parse(line);if(event.kind.startsWith('pull_request_')){const waiter=waiting.get(event.request_id);if(waiter){waiting.delete(event.request_id);clearTimeout(waiter.timer);waiter.resolve(event);}}});
function request(input){assert(validate('PullRequestRequest')(input));return new Promise((resolveEvent,reject)=>{const timer=setTimeout(()=>reject(new Error('Host PR response timed out')),20000);waiting.set(input.request_id,{resolve:resolveEvent,timer});child.stdin.write(JSON.stringify(input)+'\n');});}
try {
 const input={method:'pull_requests',action:'load',request_id:'load',reference:'https://github.com/phodal/pero/pull/164'};
 const loaded=await request(input);
 assert.equal(loaded.kind,'pull_request_loaded',loaded.text);
 assert(validate('PullRequestLoadedEvent')(loaded),ajv.errorsText(validate('PullRequestLoadedEvent').errors));
 assert.equal(loaded.data.status,'merged');
 assert.equal(loaded.data.opened_at,'2026-11-01T00:00:00Z');
 assert.equal(loaded.data.mergeable_state,'blocked');
 for(const name of ['files','commits','checks','reviews'])assert.equal(loaded.data[name].error,null,`${name}: ${loaded.data[name].error}`);
 assert(loaded.data.files.items.length>0);
 if(!live){
  const calls=(await readFile(resolve(temp,'calls'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(calls.length,7);assert(calls.every(args=>args[4]==='GET'));
  const listed=await request({method:'pull_requests',action:'list',request_id:'list',repository:'phodal/pero',state:'open'});
  assert.equal(listed.kind,'pull_request_listed',listed.text);
  assert(validate('PullRequestListedEvent')(listed),ajv.errorsText(validate('PullRequestListedEvent').errors));
  assert.equal(listed.data.items.length,2);
  assert.equal(listed.data.items[0].status,'open');
  assert.equal(listed.data.items[1].status,'draft');
  assert.equal(listed.data.items[0].reference,'https://github.com/phodal/pero/pull/164');
  assert.equal(listed.data.items[0].opened_at,'2026-11-01T00:00:00Z');
  assert.equal(listed.data.items[0].review,'approved');
  assert.equal(listed.data.items[0].blocked,true);
  assert.equal(listed.data.items[1].review,'review_required');
  assert.equal(listed.data.items[1].blocked,false);
  await writeFile(resolve(temp,'fail'),'offline');
  const failed=await request({...input,request_id:'offline'});assert.equal(failed.kind,'pull_request_error');assert.match(failed.text,/unavailable/);assert(validate('PullRequestErrorEvent')(failed));
 }
 console.log(`${live?'Live public GitHub':'Fixture'} Host PR contract passed: metadata, paginated sections${live?'':', local failure'}.`);
} finally {child.stdin.end();await new Promise(done=>child.once('close',done));await rm(temp,{recursive:true,force:true});}

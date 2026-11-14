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
const env={...process.env,...(!live?{PATH:`${bin}:${process.env.PATH}`}:{ }),PERO_APPS_ROOT:resolve(temp,'apps'),PERO_SETTINGS_PATH:resolve(temp,'settings.json'),PERO_HISTORY_PATH:resolve(temp,'sessions.jsonl'),PERO_PR_CALLS:resolve(temp,'calls'),PERO_PR_FAIL:resolve(temp,'fail'),PERO_PR_DISCUSSIONS:resolve(temp,'discussions.json'),PERO_PR_DISCUSSION_FAIL:resolve(temp,'discussion-fail')};
const child=spawn(resolve(root,'target/debug/pero-host'),['--stdio'],{cwd:temp,env,stdio:['pipe','pipe','inherit']});
const waiting=new Map();
createInterface({input:child.stdout}).on('line',line=>{const event=JSON.parse(line);if(event.kind.startsWith('pull_request_')){const waiter=waiting.get(event.request_id);if(waiter){waiting.delete(event.request_id);clearTimeout(waiter.timer);waiter.resolve(event);}}});
function request(input){assert(validate('PullRequestRequest')(input));return new Promise((resolveEvent,reject)=>{const timer=setTimeout(()=>reject(new Error('Host PR response timed out')),20000);waiting.set(input.request_id,{resolve:resolveEvent,timer});child.stdin.write(JSON.stringify(input)+'\n');});}
const calls=async()=>(await readFile(resolve(temp,'calls'),'utf8')).trim().split('\n').map(JSON.parse);
const mutationCalls=async()=>(await calls()).filter(args=>args[4]==='POST'&&!args.includes('graphql')||args.some(value=>/^operationName=(Resolve|Unresolve)PullRequestDiscussion$/.test(value)));
function discussionUpdate(event){
 assert.equal(event.kind,'pull_request_discussion_updated',event.text);
 assert(validate('PullRequestDiscussionUpdatedEvent')(event),ajv.errorsText(validate('PullRequestDiscussionUpdatedEvent').errors));
 assert.equal(event.data.reference,'https://github.com/phodal/pero/pull/164');
 return event.data.discussion;
}
try {
 const input={method:'pull_requests',action:'load',request_id:'load',reference:'https://github.com/phodal/pero/pull/164'};
 const loaded=await request(input);
 assert.equal(loaded.kind,'pull_request_loaded',loaded.text);
 assert(validate('PullRequestLoadedEvent')(loaded),ajv.errorsText(validate('PullRequestLoadedEvent').errors));
 assert.equal(loaded.data.status,'merged');
 assert(loaded.data.opened_at.length>0);
 for(const name of ['files','commits','checks','reviews','discussions'])assert.equal(loaded.data[name].error,null,`${name}: ${loaded.data[name].error}`);
 assert(loaded.data.files.items.length>0);
 if(!live){
  assert.equal(loaded.data.opened_at,'2026-11-01T00:00:00Z');
  assert.equal(loaded.data.mergeable_state,'blocked');
  const initialCalls=await calls();assert.equal(initialCalls.filter(args=>!args.includes('graphql')).length,7);assert(initialCalls.filter(args=>!args.includes('graphql')).every(args=>args[4]==='GET'));assert.equal((await mutationCalls()).length,0);
  assert.equal(loaded.data.base_sha,'base');
  assert.deepEqual(loaded.data.discussions.items.map(item=>item.id),['PRRT_current','PRRT_outdated','PRRT_file']);
  const [current,outdated,file]=loaded.data.discussions.items;
  assert.equal(current.side,'right');assert.equal(current.line,3);assert.equal(current.comments.length,2);
  assert.equal(current.comments[1].id,'PRRC_current_2');assert.equal(current.comments[0].commit_sha,'abcdef0123456789');assert.match(current.comments[0].diff_hunk,/open_pull_request/);
  assert.equal(outdated.side,'left');assert.equal(outdated.outdated,true);assert.equal(outdated.line,null);assert.equal(outdated.original_line,2);
  assert.equal(file.path,'README.md');assert.equal(file.line,null);
  const replyBody='Keep the "selected" view.\nThe draft uses `literal` text and $value.';
  const reply=discussionUpdate(await request({method:'pull_requests',action:'reply',request_id:'reply',reference:input.reference,discussion_id:current.id,body:replyBody}));
  assert.equal(reply.id,current.id);assert.equal(reply.comments.length,3);assert.equal(reply.comments.at(-1).body,replyBody);
  const replyCall=(await mutationCalls()).at(-1);assert(replyCall.includes(`body=${replyBody}`));
  for(const resolved of [true,false]){
   const updated=discussionUpdate(await request({method:'pull_requests',action:'set_resolved',request_id:`resolve-${resolved}`,reference:input.reference,discussion_id:current.id,resolved}));
   assert.equal(updated.resolved,resolved);assert.equal(updated.comments.length,3);assert.equal(updated.can_unresolve,resolved);
  }
  for(const [request_id,action] of [
   ['reply-denied',{action:'reply',discussion_id:outdated.id,body:'Cannot post this'}],
   ['unresolve-denied',{action:'set_resolved',discussion_id:outdated.id,resolved:false}],
   ['reply-blank',{action:'reply',discussion_id:current.id,body:' \n '}],
   ['reply-missing',{action:'reply',discussion_id:'PRRT_missing',body:'Cannot post this'}],
   ['reply-other-pr',{action:'reply',discussion_id:'PRRT_other',body:'Cannot post this'}],
   ['add-stale-head',{action:'add_discussion',head_sha:'stale-head',path:'src/workspace.rs',side:'right',line:3,body:'Cannot post against an old head'}],
  ]){
   const count=(await mutationCalls()).length;
   const denied=await request({method:'pull_requests',reference:input.reference,request_id,...action});
   assert.equal(denied.kind,'pull_request_error',request_id);assert(denied.text.length>0,request_id);
   assert.equal((await mutationCalls()).length,count,`${request_id} must not write to GitHub`);
  }
  const added=discussionUpdate(await request({method:'pull_requests',action:'add_discussion',request_id:'add',reference:input.reference,head_sha:'abcdef0123456789',path:'src/workspace.rs',side:'right',line:4,start_line:3,start_side:'right',body:'Keep both changed lines in the retained view.'}));
  assert.equal(added.path,'src/workspace.rs');assert.equal(added.line,4);assert.equal(added.start_line,3);assert.equal(added.side,'right');assert.equal(added.comments.length,1);
  for(const mode of ['read','comments']){
   await writeFile(resolve(temp,'discussion-fail'),mode);
   const partial=await request({...input,request_id:`partial-${mode}`});
   assert.equal(partial.kind,'pull_request_loaded',partial.text);
   assert.match(partial.data.discussions.error,/unavailable/);
   assert.equal(partial.data.files.error,null);assert.equal(partial.data.files.items.length,2);
  }
  await writeFile(resolve(temp,'discussion-fail'),'mutation');
  const failedReply=await request({method:'pull_requests',action:'reply',request_id:'reply-failed',reference:input.reference,discussion_id:current.id,body:'Retain this draft after failure'});
  assert.equal(failedReply.kind,'pull_request_error');assert.match(failedReply.text,/unavailable/);
  await rm(resolve(temp,'discussion-fail'));
  await writeFile(resolve(temp,'discussion-fail'),'after_publish');
  const publishedBody='This comment was published even if its thread cannot refresh.';
  const published=await request({method:'pull_requests',action:'add_discussion',request_id:'published-no-refresh',reference:input.reference,head_sha:'abcdef0123456789',path:'src/workspace.rs',side:'right',line:3,body:publishedBody});
  assert.equal(published.kind,'pull_request_discussion_published',published.text);
  assert(validate('PullRequestDiscussionPublishedEvent')(published),ajv.errorsText(validate('PullRequestDiscussionPublishedEvent').errors));
  assert.equal(published.data.reference,input.reference);
  assert(JSON.parse(await readFile(resolve(temp,'discussions.json'),'utf8')).some(discussion=>discussion.comments.some(comment=>comment.body===publishedBody)));
  await rm(resolve(temp,'discussion-fail'));
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
 console.log(`${live?'Live public GitHub':'Fixture'} Host PR contract passed: metadata, paginated sections${live?'':', discussion pagination and mutations, local failure'}.`);
} finally {child.stdin.end();await new Promise(done=>child.once('close',done));await rm(temp,{recursive:true,force:true});}

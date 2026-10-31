import {test} from 'node:test';
import assert from 'node:assert/strict';
import {automationRequest,openSession} from '../ui-src/transport.ts';
test('explicit Host capability preserves errors without global replacement',async()=>{
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(path,options)=>{calls.push({path,options});const command=JSON.parse(options.body);
    if(command.method==='DELETE')return Response.json({status:204,body:null});
    if(command.path.endsWith('/conflict'))return Response.json({status:409,body:{error:'Revision changed'}});
    if(command.path.endsWith('/unsupported'))return Response.json({status:501,body:{error:'Rule unsupported'}});
    return Response.json({status:200,body:{items:[]}});
  };
  try{
    assert.deepEqual(await automationRequest('GET','/api/automations'),{items:[]});assert.equal(calls[0].path,'/host/automation');
    assert.deepEqual(JSON.parse(calls[0].options.body),{method:'GET',path:'/api/automations',body:null});
    await assert.rejects(automationRequest('PUT','/api/automations/conflict',{}),/Revision changed/);
    await assert.rejects(automationRequest('POST','/api/automations/unsupported',{}),/Rule unsupported/);
    assert.equal(await automationRequest('DELETE','/api/automations/item'),null);
    await assert.rejects(automationRequest('GET','https://external.invalid/api/automations'),/Unsupported/);
    await assert.rejects(automationRequest('GET','/api/projects'),/Unsupported/);assert.equal(calls.length,4);
  }finally{globalThis.fetch=original;}
});
test('session navigation is a bounded parent-shell message',()=>{
  const original=globalThis.window,calls=[];globalThis.window={parent:{postMessage:(...args)=>calls.push(args)}};
  try{openSession('existing-session');assert.deepEqual(calls,[[{type:'pero:app:open-session',sessionId:'existing-session'},'*']]);assert.throws(()=>openSession(''));assert.throws(()=>openSession('a'.repeat(257)));}
  finally{globalThis.window=original;}
});

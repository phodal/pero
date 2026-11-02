import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { createAppExamples, readAppExample } from '../src/examples.mjs';
const entries = [{id:'iris',default:true},{id:'co2'}];
const tick = () => new Promise(resolve=>queueMicrotask(resolve));
test('default waits for active, ready, empty; existing data wins and imports are serialized',async()=>{
 let calls=0, finish;
 const bridge=createAppExamples({entries,read:async e=>e,requestId:()=> 'request-1'});
 const adapter={ready:false,empty:true,busy:false,load:async()=>{calls++;await new Promise(r=>finish=r);}};
 const registration=bridge.register(adapter);bridge.setActive(true);await tick();assert.equal(calls,0);
 registration.update({...adapter,ready:true,empty:false});await tick();assert.equal(calls,0);
 registration.update({...adapter,ready:true});await tick();assert.equal(calls,1);
 await bridge.load('co2');assert.equal(calls,1);finish();await tick();await tick();
 registration.update({...adapter,ready:true});await tick();assert.equal(calls,1);bridge.dispose();
});
test('explicit retry keeps request identity; abort fences stale selection without automatic replay',async()=>{
 const ids=[];let fail=true;let finish;
 const bridge=createAppExamples({entries,read:async e=>e,requestId:()=>String(ids.length+1)});
 bridge.register({ready:true,empty:false,busy:false,load:async(d,c)=>{ids.push(c.requestId);if(fail)throw Error('lost response');await new Promise(r=>finish=r);}});bridge.setActive(true);
 await bridge.load('iris');assert.equal(bridge.getSnapshot().error,'lost response');fail=false;
 const retry=bridge.retry();await tick();assert.deepEqual(ids,['1','1']);bridge.setActive(false);finish();await retry;
 assert.equal(bridge.getSnapshot().selected,null);bridge.setActive(true);await tick();assert.equal(ids.length,2);bridge.dispose();
});
test('snapshot digest, file digest, schema and payload ceiling are enforced',async()=>{
 const hash=value=>createHash('sha256').update(value).digest('hex');
 const doc={schema:'point.app.example.v1',id:'iris',files:[{name:'iris.csv',mediaType:'text/csv',content:'x\n1',sha256:hash('x\n1')}]};
 const read=value=>{const bytes=JSON.stringify(value);return readAppExample(new Response(bytes),{id:'iris',sha256:hash(bytes)},webcrypto);};
 assert.deepEqual(await read(doc),doc);
 await assert.rejects(read({...doc,schema:'other'}),/Invalid example/);
 await assert.rejects(read({...doc,files:[{...doc.files[0],sha256:'0'.repeat(64)}]}),/Invalid example file/);
 await assert.rejects(readAppExample(new Response(JSON.stringify(doc)),{id:'iris',sha256:'0'.repeat(64)},webcrypto),/digest differs/);
 await assert.rejects(readAppExample(new Response('x'.repeat(4*1024*1024+1)),{id:'iris'},webcrypto),/exceeds/);
});

test('a user import while the default is being read wins; provenance follows current data', async () => {
 let finish, imports=0;
 const bridge=createAppExamples({entries,read:async e=>{await new Promise(r=>finish=r);return e;},requestId:()=> 'id'});
 const adapter={ready:true,empty:true,busy:false,load:async()=>{imports++;}};
 const registration=bridge.register(adapter);bridge.setActive(true);
 registration.update({...adapter,empty:false});finish();await tick();await tick();assert.equal(imports,0);
 registration.update({...adapter,empty:false,currentExampleId:'iris'});finish();await tick();await tick();
 assert.equal(bridge.getSnapshot().selected.id,'iris');
 registration.update({...adapter,empty:false});assert.equal(bridge.getSnapshot().selected,null);bridge.dispose();
});
test('disposing a panel during a read prevents delivery to an unmounted adapter',async()=>{
 let finish,imports=0;
 const bridge=createAppExamples({entries,read:async e=>{await new Promise(r=>finish=r);return e;},requestId:()=> 'id'});
 bridge.register({ready:true,empty:false,busy:false,load:async()=>{imports++;}});bridge.setActive(true);
 const load=bridge.load('iris');bridge.dispose();finish();await load;assert.equal(imports,0);
});

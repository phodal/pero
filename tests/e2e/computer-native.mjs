// Explicit opt-in: drives only our temporary, owned AppKit fixture window.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { computerFixture, computerEvidenceDirectory, waitFor as poll } from '../fixtures/computer-app.mjs';

if (process.env.PERO_COMPUTER_NATIVE !== '1' || process.platform !== 'darwin') throw new Error('Run with PERO_COMPUTER_NATIVE=1 on macOS');
const root=resolve(import.meta.dirname,'../..');
const run=await mkdtemp(resolve(root,'target/computer-acceptance-'));
const out=computerEvidenceDirectory(root);await mkdir(out,{recursive:true});
await build({entryPoints:[resolve(root,'desktop/src/main/computer.ts')],outfile:resolve(run,'computer.mjs'),bundle:true,platform:'node',format:'esm'});
const { DesktopComputer }=await import(resolve(run,'computer.mjs'));
const states=[];
const desktop=new DesktopComputer(resolve(root,'target/debug/pero-computer'),resolve(run,'evidence'),event=>states.push(structuredClone(event.data)));
const fixture=await computerFixture(root,run);
const guard=await computerFixture(root,run,true);
await guard.activate();
const backgroundActivations=(await fixture.state()).activations ?? 0;
const signal=new AbortController().signal;
const call=request=>desktop.call('native-acceptance',request,signal);
const state=fixture.state;
const observations=[];const receipts=[];
let target;
const observe=async()=>{
  const value=await call({operation:'observe',target});assert.equal(value.kind,'observation');observations.push(value.observation);
  if(value.image){await writeFile(resolve(out,`observation-${observations.length}.jpg`),Buffer.from(value.image.data,'base64'));}
  return value.observation;
};
let id=0;
const act=async(observation,input,delivery='background')=>{
 const action={request_id:`native-${++id}`,target,observation_id:observation.id,delivery,input};
 const result=await call({operation:'act',action});receipts.push(result.receipt);assert.equal(result.kind,'receipt');assert.equal(result.receipt.outcome.status,'executed',JSON.stringify(result));return action;
};
try {
 const status=await desktop.status();assert.equal(status.status.accessibility,'granted',JSON.stringify(status));assert.equal(status.status.screen_recording,'granted',JSON.stringify(status));
 await desktop.restore(true);
 target=await poll(async()=>{const value=await call({operation:'targets'});return value.targets.find(t=>t.title==='Pero Computer Fixture')?.reference;});
 let observation=await poll(async()=>{const current=await observe();return current.elements.some(e=>e.label==='Increment')?current:false;});
 const button=observation.elements.find(e=>e.label==='Increment');assert.ok(button,'No expected element; inspect test-results/computer/native-failure.json');
 const action=await act(observation,{kind:'click',button:'left',anchor:{kind:'element',element_id:button.id},count:1});
 await poll(async()=>(await state()).count===1);
 // Same request is answered from its durable journal, never dispatched twice.
 assert.deepEqual((await call({operation:'act',action})).receipt,receipts[0]);assert.equal((await state()).count,1);
 const stale=await call({operation:'act',action:{...action,request_id:'stale'}});assert.equal(stale.receipt.outcome.status,'rejected');assert.equal(stale.receipt.outcome.error.code,'stale_observation');
 observation=await observe();
 const field=observation.elements.find(e=>e.role==='AXTextField');assert.ok(field,'No expected element; inspect test-results/computer/native-failure.json');
 await act(observation,{kind:'type_text',anchor:{kind:'element',element_id:field.id},text:'你好 Pero 🌱'});
 await poll(async()=>(await state()).text==='你好 Pero 🌱');
 observation=await observe();assert.ok(observation.elements.some(e=>e.value==='你好 Pero 🌱'));
 await act(observation,{kind:'press_key',anchor:{kind:'element',element_id:field.id},keys:['Meta','Shift','ArrowLeft']});
 await poll(async()=>(await state()).selection?.length==='你好 Pero 🌱'.length,'background text selection key chord');
 observation=await observe();await act(observation,{kind:'type_text',anchor:{kind:'element',element_id:field.id},text:'Verified'});await poll(async()=>(await state()).text==='Verified');
 observation=await observe();assert.ok(observation.screenshot,'Real capture is required');
 execFileSync('/usr/sbin/screencapture',['-x','-l',String((await state()).windowNumber),resolve(out,'reference.png')]);
 const point={x:Math.round(observation.screenshot.width*0.35),y:Math.round(observation.screenshot.height*0.6)};
 await guard.activate();
 await act(observation,{kind:'click',button:'left',anchor:{kind:'pixel',screenshot_id:observation.screenshot.id,point},count:1});await poll(async()=>(await state()).clicks===1);
 observation=await observe();await act(observation,{kind:'scroll',anchor:{kind:'pixel',screenshot_id:observation.screenshot.id,point},delta_x:0,delta_y:120});await poll(async()=>(await state()).scroll!==0);
 observation=await observe();await act(observation,{kind:'drag',screenshot_id:observation.screenshot.id,from:point,to:{x:point.x+80,y:point.y+50}});await poll(async()=>(await state()).drags>0,'background drag');assert.equal((await state()).clicks,2,'One pointer-down per click/drag, without duplicate transport');
 assert.equal((await state()).activations ?? 0,backgroundActivations,'Background input must not activate the target application');
 assert.equal((await guard.state()).text,'');assert.equal((await guard.state()).clicks,0);
 const foreground=process.env.PERO_COMPUTER_FOREGROUND==='1';
 if(foreground){const backgroundDrags=(await state()).drags;await fixture.activate();observation=await observe();const increment=observation.elements.find(e=>e.label==='Increment');await act(observation,{kind:'click',anchor:{kind:'element',element_id:increment.id},button:'left',count:1},'foreground');await poll(async()=>(await state()).count===2,'foreground element click');observation=await observe();await act(observation,{kind:'drag',screenshot_id:observation.screenshot.id,from:point,to:{x:point.x+80,y:point.y+50}},'foreground');await poll(async()=>(await state()).drags>backgroundDrags,'foreground drag');}
 await desktop.stop();
 const old=await call({operation:'observe',target}).catch(error=>error);assert.equal(old.detail?.code,'target_unavailable');
 const lookup=await call({operation:'receipt',request_id:action.request_id});assert.deepEqual(lookup.receipt,receipts[0]);
 await writeFile(resolve(out,'native-result.json'),JSON.stringify({status:status.status,effects:await state(),guard:await guard.state(),backgroundPreservedForeground:true,foreground,receipts,observations:observations.map(o=>({id:o.id,screenshot:o.screenshot,elements:o.elements})),passed:true},null,2));
 await rm(resolve(out,'native-failure.json'),{force:true});
 console.log('Native Computer Use passed: actual AX/pixel click, Unicode typing, key chord, pixel scroll, drag, stale handles, durable receipts and stop.');
} catch(error) {
 const blocked=error.detail?.code==='permission_required';
 await writeFile(resolve(out,'native-failure.json'),JSON.stringify({passed:false,blocked,diagnosticVerified:blocked,error:String(error),code:error.detail?.code,observations,receipts,states},null,2));
 if(blocked && process.env.PERO_COMPUTER_NATIVE_EXPECT_BLOCKED==='1')console.log('Native permission refusal verified. Real input acceptance is BLOCKED, not passed.');
 else throw error;
} finally {await desktop.stop();await fixture.close();await guard.close();}

// AT-SPI acceptance on X11. Run under an owned X server and session bus:
//   dbus-run-session -- xvfb-run -a node tests/e2e/computer-linux-atspi.mjs
// Requires at-spi2-core, the GTK 3 ATK bridge and python3-gi with GTK 3.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {waitFor,computerEvidenceDirectory} from '../fixtures/computer-app.mjs';
if(process.platform!=='linux'||!process.env.DISPLAY)throw new Error('Requires Linux X11; use xvfb-run -a');
if(!process.env.DBUS_SESSION_BUS_ADDRESS)throw new Error('Requires a session D-Bus with AT-SPI; use dbus-run-session --');
const root=resolve(import.meta.dirname,'../..'),run=await mkdtemp(resolve(tmpdir(),'pero-computer-atspi-')),out=computerEvidenceDirectory(root);await mkdir(out,{recursive:true});
const effectFile=resolve(run,'effects.json');
const fixture=spawn('python3',[resolve(root,'tests/fixtures/computer-app-gtk.py'),effectFile],{stdio:['ignore','ignore','inherit'],env:{...process.env,GTK_A11Y:'atspi',NO_AT_BRIDGE:''}});
const effects=async()=>JSON.parse(await readFile(effectFile,'utf8'));
let native;
try{
 await waitFor(async()=>{try{return (await effects()).ready;}catch{return false;}},'GTK readiness');
 // Start the driver only after the fixture registered on the accessibility bus.
 native=spawn(process.env.PERO_COMPUTER_BINARY||resolve(root,'target/debug/pero-computer'),[],{stdio:['pipe','pipe','inherit']});
 const replies=[];createInterface({input:native.stdout}).on('line',line=>replies.push(JSON.parse(line)));
 let sequence=0;
 const call=async request=>{const id=`atspi-${++sequence}`;native.stdin.write(JSON.stringify({id,thread:'atspi-acceptance',request})+'\n');const reply=await waitFor(()=>replies.find(r=>r.id===id),'native reply');assert.ok(!reply.error,JSON.stringify(reply));return reply.value;};
 const status=(await call({operation:'status'})).status;
 assert.equal(status.available,true);assert.equal(status.accessibility,'granted',status.message);
 const listed=await call({operation:'targets'});
 assert.deepEqual(listed.capabilities.observations,['accessibility','screenshot']);
 assert.ok(listed.capabilities.actions.some(a=>a.action==='click'&&a.delivery==='background'&&JSON.stringify(a.addressing)==='["element"]'));
 assert.ok(listed.capabilities.actions.filter(a=>a.delivery==='background').every(a=>a.action==='click'),'Only element click is background');
 const pid=(await effects()).pid;
 const windows=listed.targets.filter(t=>t.title==='Pero AT-SPI Fixture');assert.equal(windows.length,2,'Two same-titled windows');
 const observe=async target=>(await call({operation:'observe',target})).observation;
 const trees=[];for(const t of windows)trees.push({target:t.reference,observation:await observe(t.reference)});
 const byLabel=(obs,label)=>obs.elements.find(e=>e.label===label);
 const first=trees.find(t=>byLabel(t.observation,'Increment first')),second=trees.find(t=>byLabel(t.observation,'Increment second'));
 assert.ok(first&&second&&first!==second,'Each window binds to its own frame');
 assert.equal(byLabel(first.observation,'Increment second'),undefined,'Trees are not merged across windows');
 const act=async(entry,element,extra={})=>{const observation=await observe(entry.target);const id=byLabel(observation,element)?.id;assert.ok(id,element);return (await call({operation:'act',action:{request_id:`req-${sequence}`,target:entry.target,observation_id:observation.id,delivery:'background',input:{kind:'click',anchor:{kind:'element',element_id:id},button:'left',count:1,...extra}}})).receipt;};
 // Facts: invoking actions only, disabled and secure controls refused, secrets unread.
 const obs=first.observation;
 assert.deepEqual(byLabel(obs,'Increment first').actions,['click']);
 assert.deepEqual(byLabel(obs,'Disabled action').actions,[]);
 const secret=obs.elements.find(e=>e.role==='password text');assert.ok(secret,'password field observed');assert.deepEqual(secret.actions,[]);assert.equal(secret.value,undefined);
 assert.ok(!JSON.stringify(obs).includes('fixture-secret'),'Secure text never appears');
 assert.equal(obs.truncated,false);
 const pointer=(await effects()).pointer;
 let receipt=await act(first,'Increment first');assert.equal(receipt.outcome.status,'executed',JSON.stringify(receipt));
 await waitFor(async()=>(await effects()).counts.first===1,'first counter');
 assert.equal((await effects()).counts.second,0,'Same-titled window untouched');
 assert.deepEqual((await effects()).pointer,pointer,'Background element click keeps the real pointer');
 receipt=await act(second,'Increment second');assert.equal(receipt.outcome.status,'executed');await waitFor(async()=>(await effects()).counts.second===1,'second counter');
 receipt=await act(first,'Remember');assert.equal(receipt.outcome.status,'executed');await waitFor(async()=>(await effects()).checked===true,'check box toggled');
 receipt=await act(first,'Disabled action');assert.equal(receipt.outcome.status,'rejected');assert.equal(receipt.outcome.error.code,'unsupported');
 receipt=await act(first,'Increment first',{count:2});assert.equal(receipt.outcome.status,'rejected');assert.equal(receipt.outcome.error.code,'unsupported');
 receipt=await act(first,'Increment first',{button:'right'});assert.equal(receipt.outcome.status,'rejected');
 assert.equal((await effects()).counts.first,1,'Refused element clicks have no effect');
 // A consumed observation cannot be replayed.
 const basis=await observe(first.target);const id=byLabel(basis,'Increment first').id;
 const action={request_id:'once',target:first.target,observation_id:basis.id,delivery:'background',input:{kind:'click',anchor:{kind:'element',element_id:id},button:'left',count:1}};
 assert.equal((await call({operation:'act',action})).receipt.outcome.status,'executed');
 assert.equal((await call({operation:'act',action:{...action,request_id:'replay'}})).receipt.outcome.error.code,'stale_observation');
 await waitFor(async()=>(await effects()).counts.first===2,'single effect');
 // An element that disappears after observation is refused before any input.
 const before=await observe(first.target);const ephemeral=byLabel(before,'Ephemeral');assert.deepEqual(ephemeral.actions,['click']);
 await writeFile(resolve(run,'effects.hide'),'');await waitFor(async()=>(await effects()).ephemeral_hidden,'element hidden');
 const gone=(await call({operation:'act',action:{request_id:'gone',target:first.target,observation_id:before.id,delivery:'background',input:{kind:'click',anchor:{kind:'element',element_id:ephemeral.id},button:'left',count:1}}})).receipt;
 assert.equal(gone.outcome.status,'rejected',JSON.stringify(gone));assert.equal(gone.outcome.error.code,'target_unavailable');assert.equal((await effects()).ephemeral,0);
 await writeFile(resolve(out,'linux-atspi-result.json'),JSON.stringify({passed:true,scope:'actual Linux Xvfb + session D-Bus + AT-SPI + GTK 3; no window manager, real model, Wayland compositor or physical desktop',pid,effects:await effects(),capabilities:listed.capabilities,first:first.observation,second:second.observation},null,2));
 console.log('Linux AT-SPI passed: window binding, control facts, background element clicks, refusals, vanished elements and stale observations.');
}finally{native?.stdin.end();native?.kill();fixture.kill();await rm(run,{recursive:true,force:true});}

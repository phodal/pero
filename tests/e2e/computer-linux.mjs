// Run on Linux under an owned X server: xvfb-run -a node tests/e2e/computer-linux.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {waitFor,computerEvidenceDirectory} from '../fixtures/computer-app.mjs';
if(process.platform!=='linux'||!process.env.DISPLAY)throw new Error('Requires Linux X11, XTest, python3-tk and xprop; use xvfb-run -a');
const root=resolve(import.meta.dirname,'../..'),run=await mkdtemp(resolve(tmpdir(),'pero-computer-linux-')),out=computerEvidenceDirectory(root);await mkdir(out,{recursive:true});
const effectFile=resolve(run,'effects.json');
const fixture=spawn('python3',[resolve(root,'tests/fixtures/computer-app-linux.py'),effectFile],{stdio:['ignore','ignore','inherit']});
const native=spawn(process.env.PERO_COMPUTER_BINARY||resolve(root,'target/debug/pero-computer'),[],{stdio:['pipe','pipe','inherit']});
const replies=[];createInterface({input:native.stdout}).on('line',line=>replies.push(JSON.parse(line)));
let sequence=0;
const call=async request=>{const id=`linux-${++sequence}`;native.stdin.write(JSON.stringify({id,thread:'linux-acceptance',request})+'\n');const reply=await waitFor(()=>replies.find(r=>r.id===id),'native reply');assert.ok(!reply.error,JSON.stringify(reply));return reply.value;};
const effects=async()=>JSON.parse(await readFile(effectFile,'utf8'));
try{
 await waitFor(async()=>{try{return (await effects()).pid;}catch{return false;}},'Tk readiness');
 assert.equal((await call({operation:'status'})).status.available,true);
 const listed=await call({operation:'targets'});assert.deepEqual(listed.capabilities.observations,['screenshot']);assert.ok(listed.capabilities.actions.every(a=>a.delivery==='foreground'));
 const target=listed.targets.find(t=>t.title==='Pero Computer Fixture')?.reference;assert.ok(target);
 const observe=async()=>{const value=await call({operation:'observe',target});assert.ok(value.image);await writeFile(resolve(out,'linux-window.jpg'),Buffer.from(value.image.data,'base64'));return value.observation;};
 const act=async(inputFor)=>{const observation=await observe();const action={request_id:`input-${sequence}`,target,observation_id:observation.id,delivery:'foreground',input:inputFor(observation.screenshot)};const receipt=(await call({operation:'act',action})).receipt;assert.equal(receipt.outcome.status,'executed',JSON.stringify(receipt));return action;};
 const pixel=(s,x,y)=>({kind:'pixel',screenshot_id:s.id,point:{x,y}});
 await act(s=>({kind:'click',anchor:pixel(s,80,42),button:'left',count:1}));await waitFor(async()=>(await effects()).count===1,'button effect');
 await act(s=>({kind:'type_text',anchor:pixel(s,230,40),text:'Linux verified'}));await waitFor(async()=>(await effects()).text==='Linux verified','text effect');
 await act(s=>({kind:'press_key',anchor:pixel(s,290,40),keys:['End']}));
 await act(s=>({kind:'press_key',anchor:pixel(s,290,40),keys:['Backspace']}));await waitFor(async()=>(await effects()).text==='Linux verifie','key effect');
 const original=await act(s=>({kind:'click',anchor:pixel(s,100,200),button:'left',count:1}));await waitFor(async()=>(await effects()).clicks>0,'canvas click');
 const old=(await call({operation:'act',action:{...original,request_id:'stale'}})).receipt;assert.equal(old.outcome.error.code,'stale_observation');
 await act(s=>({kind:'scroll',anchor:pixel(s,100,200),delta_x:0,delta_y:120}));await waitFor(async()=>(await effects()).scroll>0,'scroll effect');
 await act(s=>({kind:'drag',screenshot_id:s.id,from:{x:100,y:200},to:{x:180,y:230}}));await waitFor(async()=>(await effects()).drags>0,'drag effect');
 await writeFile(resolve(out,'linux-result.json'),JSON.stringify({passed:true,scope:'actual Linux Xvfb/Tk/XTest, no real model or physical desktop',effects:await effects(),capabilities:listed.capabilities},null,2));
 console.log('Linux X11 native effects passed: screenshot, click, text, key, scroll, drag and stale observations.');
}finally{fixture.kill();native.stdin.end();await rm(run,{recursive:true,force:true});}

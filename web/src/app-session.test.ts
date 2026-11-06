import test from 'node:test';
import assert from 'node:assert/strict';
import { openExistingAppSession } from './app-session.ts';
test('existing session handoff waits for visible navigation and rejects unavailable targets', async () => {
  let state = {chats:[{id:'source'}],activeChat:0,activeApp:{name:'insights'},chatVisible:false} as {chats:{id:string}[];activeChat:number;activeApp:unknown;chatVisible:boolean};
  let opens=0,frames=0,now=0;
  const ports={snapshot:()=>state,open:()=>{opens++;},frame:async()=>{frames++;now+=1000;if(frames===2)state={...state,activeApp:null,chatVisible:true};},now:()=>now};
  await assert.rejects(openExistingAppSession('deleted',ports),/no longer available/);
  assert.equal(opens,0);
  await openExistingAppSession('source',ports);
  assert.equal(opens,1);assert.equal(frames,2);
  state={...state,activeApp:{name:'insights'},chatVisible:false};
  await assert.rejects(openExistingAppSession('source',ports),/did not open/);
});

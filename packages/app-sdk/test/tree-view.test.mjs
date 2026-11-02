import test from 'node:test';
import assert from 'node:assert/strict';
import {createUiRuntime} from './ui-test-runtime.mjs';

test('tree Enter activates the focused identity; updating controlled selection does not activate it',async t=>{
  const env=await createUiRuntime(t,'tree-view');if(!env)return;
  const actions=[],nodes=[{id:'first',text:'First'},{id:'second',text:'Second'}];
  const show=selected=>env.render(env.React.createElement(env.ui.TreeView,{nodes,label:'Sources',selectionMode:'multiple',selectedKeys:new Set([selected]),onAction:id=>actions.push(id)}));
  await show('first');await show('second');assert.deepEqual(actions,[]);
  const second=document.querySelector('[data-key=second]');
  await env.React.act(async()=>{
    second.focus();
    for(const type of ['keydown','keyup'])second.dispatchEvent(new env.dom.window.KeyboardEvent(type,{key:'Enter',bubbles:true}));
  });
  assert.deepEqual(actions,['second']);
});

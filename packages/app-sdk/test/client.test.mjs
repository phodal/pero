import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiRuntime } from './ui-test-runtime.mjs';

test('App module registration shares React, refuses foreign runtimes and releases its own claims',async t=>{
  const env=await createUiRuntime(t,{contents:"export * from './client';",resolveDir:new URL('../src',import.meta.url).pathname});
  const target={};
  const release=env.ui.installPeroAppSdk(target);
  const modules=target.__pero_modules;
  const Runtime=modules.react,UI=modules['@pero/app-sdk/ui'];
  function Counter(){const [count,setCount]=Runtime.useState(0);return Runtime.createElement(UI.Button,{onClick:()=>setCount(count+1)},'Count '+count);}
  await env.render(Runtime.createElement(Counter));
  await env.click(document.querySelector('button'));
  assert.equal(document.querySelector('button').textContent,'Count 1');
  const foreign={__pero_modules:{'@pero/app-sdk':{}}};
  assert.throws(()=>env.ui.installPeroAppSdk(foreign),/another host/);
  assert.deepEqual(Object.keys(foreign.__pero_modules),['@pero/app-sdk']);
  release();assert.deepEqual(Object.keys(modules),[]);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { installPdfRegistryTrace, pdfRegistryTracePrefix } from '../../tests/e2e/paper-registry-trace.mjs';

const documentId = 'a'.repeat(64), fileDigest = 'b'.repeat(64);
function fixture(existing = true) {
  const records = [], calls = [], events = new Map();
  const inject = function(value) { calls.push(['inject',this,value]); return 17; };
  const commit = function(...args) { calls.push(['commit',this,...args]); return 'original-result'; };
  const original = { supportsFiber:true, inject, onCommitFiberRoot:commit };
  const window = { addEventListener:(name,fn)=>events.set(name,fn), removeEventListener:(name)=>events.delete(name) };
  if(existing)window.__REACT_DEVTOOLS_GLOBAL_HOOK__=original;
  const context = {window,location:{protocol:'pero-app:',hostname:'paper-agent'},console:{info:text=>records.push(JSON.parse(text.slice(pdfRegistryTracePrefix.length)))}};
  runInNewContext(`(${installPdfRegistryTrace})()`,context);
  const trace=window.paperPdfRegistryTrace, hook=window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const registry=(docId=documentId)=>{
    const listeners=new Set();
    const state={core:{documents:{[docId]:{status:'loaded'}}},plugins:{selection:{documents:{[docId]:{selection:{start:{page:0,index:12},end:{page:0,index:35}}}}}}};
    const store={getState:()=>state,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)}};
    return {getStore:()=>store,getPlugin:()=>({}),state,listeners,dispatch(type,range){state.plugins.selection.documents[docId].selection=range;for(const fn of listeners)fn({type,payload:{private:'not collected'}})}};
  };
  const fiber=registry=>Object.freeze({memoizedProps:Object.freeze({engine:{},plugins:[]}),memoizedState:Object.freeze({memoizedState:registry,next:null})});
  return {records,calls,events,window,hook,trace,original,inject,commit,registry,fiber};
}
test('registry observer chains callbacks, identifies actual owners and reads only exact fixture state',()=>{
  const f=fixture(), first=f.registry(), foreign=f.registry('c'.repeat(64));
  const root={current:{child:f.fiber(first),sibling:f.fiber(foreign)}};
  assert.equal(f.hook.inject.call(f.hook,'renderer'),17);
  assert.equal(f.hook.onCommitFiberRoot(17,root),'original-result');
  assert.equal(f.records.length,0,'nothing logged before exact synthetic scope');
  f.trace.configure({documentId,fileDigest,paperId:'synthetic-paper'});
  assert.equal(first.listeners.size,1);assert.equal(foreign.listeners.size,0);
  first.dispatch('selection/INIT_SELECTION_STATE',null);
  const cleared=f.records.at(-1);
  assert.equal(cleared.action,'selection/INIT_SELECTION_STATE');assert.equal(cleared.selection,null);assert.match(cleared.stack,/inspect/);
  const replacement=f.registry();root.current={child:f.fiber(replacement)};
  f.hook.onCommitFiberRoot(17,root);
  const owners=f.records.filter(x=>x.event==='registry').map(x=>x.registryId);
  assert.equal(new Set(owners).size,2,'same document in new registry is distinguishable');
  assert.equal(JSON.stringify(f.records).includes('not collected'),false);
  assert.equal(JSON.stringify(f.records).includes('c'.repeat(64)),false);
  f.events.get('pagehide')();
  assert.equal(first.listeners.size,0);assert.equal(replacement.listeners.size,0);
  assert.equal(f.hook.inject,f.inject);assert.equal(f.hook.onCommitFiberRoot,f.commit);
  assert.equal(f.window.__REACT_DEVTOOLS_GLOBAL_HOOK__,f.original);
});
test('registry observer caps changes, cleans its own hook and never changes store values',()=>{
  const f=fixture(false), registry=f.registry(), root={current:f.fiber(registry)};
  f.hook.onCommitFiberRoot(1,root);f.trace.configure({documentId,fileDigest,paperId:'synthetic-paper'});
  for(let i=0;i<200;i++) registry.dispatch('selection/SET_SELECTION',{start:{page:0,index:i},end:{page:0,index:i+1}});
  assert.equal(f.records.length,96);assert.equal(registry.state.plugins.selection.documents[documentId].selection.start.index,199);
  f.trace.stop();assert.equal(registry.listeners.size,0);assert.equal(f.window.__REACT_DEVTOOLS_GLOBAL_HOOK__,undefined);
  assert.equal(f.events.size,0);
});
test('reader input diagnostics use scope identity and never disclose another focus document',()=>{
  const f=fixture(), root={current:{memoizedProps:{paper:{id:'synthetic-paper'},api:{},lockText:false,focus:{documentId:'private-other-document'},pdfReloadToken:2,readRequest:1}}};
  f.hook.onCommitFiberRoot(1,root);f.trace.configure({documentId,fileDigest,paperId:'synthetic-paper'});
  const event=f.records.find(x=>x.event==='reader-inputs');assert.equal(event.focus,'other');assert.equal(event.pdfReloadToken,2);
  assert.equal(JSON.stringify(f.records).includes('private-other-document'),false);
  f.trace.stop();
});

test('observer discovers the registry in real React committed Fiber hooks without changing its state', async()=>{
  const {JSDOM}=await import('jsdom');
  const React=await import('react');
  const previous={window:globalThis.window,document:globalThis.document,hook:globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__,act:globalThis.IS_REACT_ACT_ENVIRONMENT};
  const dom=new JSDOM('<div id="root"></div>',{url:'pero-app://paper-agent/dist/index.html'});
  const records=[];
  globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  runInNewContext(`(${installPdfRegistryTrace})()`,{window:dom.window,location:dom.window.location,console:{info:text=>records.push(JSON.parse(text.slice(pdfRegistryTracePrefix.length)))}});
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__=dom.window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  let root;
  try {
    const {createRoot}=await import('react-dom/client');
    const listeners=new Set(),range={start:{page:0,index:12},end:{page:0,index:35}};
    const state={core:{documents:{[documentId]:{status:'loaded'}}},plugins:{selection:{documents:{[documentId]:{selection:range}}}}};
    const store={getState:()=>state,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)}};
    const registry={getStore:()=>store,getPlugin:()=>({})};
    function Owner(){React.useState(registry);return React.createElement('p',null,'synthetic owner');}
    root=createRoot(document.getElementById('root'));
    await React.act(async()=>root.render(React.createElement(Owner,{engine:{},plugins:[]})));
    dom.window.paperPdfRegistryTrace.configure({documentId,fileDigest,paperId:'synthetic-paper'});
    assert.equal(records.filter(item=>item.event==='registry').length,1);
    assert.equal(listeners.size,1);assert.equal(state.plugins.selection.documents[documentId].selection,range);
  } finally {
    if(root)await React.act(async()=>root.unmount());
    dom.window.paperPdfRegistryTrace.stop();dom.window.close();
    globalThis.window=previous.window;globalThis.document=previous.document;
    globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__=previous.hook;globalThis.IS_REACT_ACT_ENVIRONMENT=previous.act;
  }
});

test('after-mouseup arm reserves the first later reset after saturation, never the expected pointer-down clear',()=>{
  const f=fixture(), registry=f.registry();
  f.hook.onCommitFiberRoot(1,{current:f.fiber(registry)});
  f.trace.configure({documentId,fileDigest,paperId:'synthetic-paper'});
  registry.dispatch('selection/CLEAR_SELECTION',null);
  assert.equal(f.trace.armAfterSelection(),false,'no selection cannot arm the reserve');
  for(let i=0;i<500;i++)registry.dispatch('selection/SET_SELECTION',{start:{page:0,index:i},end:{page:0,index:i+1}});
  assert.equal(f.records.length,96);
  assert.equal(f.trace.armAfterSelection(),true);
  registry.dispatch('selection/CLEAR_SELECTION',null);
  const reset=f.records.at(-1);
  assert.equal(f.records.length,97);assert.equal(reset.reservedPostSelectionReset,true);
  assert.equal(reset.selection,null);assert.equal(reset.action,'selection/CLEAR_SELECTION');assert.match(reset.stack,/inspect/);
  registry.dispatch('selection/SET_SELECTION',{start:{page:0,index:12},end:{page:0,index:35}});
  registry.dispatch('selection/CLEAR_SELECTION',null);
  assert.equal(f.records.length,97,'only one reserved reset');
  f.trace.stop();
});
test('armed reserve captures exact-document loading and close transitions after the ordinary cap',()=>{
  for(const action of ['START_LOADING_DOCUMENT','CLOSE_DOCUMENT']) {
    const f=fixture(), registry=f.registry();
    f.hook.onCommitFiberRoot(1,{current:f.fiber(registry)});
    f.trace.configure({documentId,fileDigest,paperId:'synthetic-paper'});
    for(let i=0;i<500;i++)registry.dispatch('selection/SET_SELECTION',{start:{page:0,index:i},end:{page:0,index:i+1}});
    assert.equal(f.trace.armAfterSelection(),true);
    // A foreign document action without a target-state transition must not consume it.
    for(const fn of registry.listeners)fn({type:action,payload:{documentId:'private-other-document'}});
    assert.equal(f.records.length,96);
    registry.state.core.documents[documentId].status=action==='CLOSE_DOCUMENT'?'closed':'loading';
    for(const fn of registry.listeners)fn({type:action,payload:{documentId}});
    const reset=f.records.at(-1);
    assert.equal(f.records.length,97);assert.equal(reset.reservedPostSelectionReset,true);
    assert.equal(reset.action,action);assert.match(reset.stack,/inspect/);
    assert.equal(JSON.stringify(f.records).includes('private-other-document'),false);
    f.trace.stop();
  }
});

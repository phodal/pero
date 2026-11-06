import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createUiRuntime } from './ui-test-runtime.mjs';

const target = 'control-lab.python-control';
const profile = {id:'local-control',label:'Research',target,dependencies:['control==0.10.2'],state:'preparing',log:['Installing control'],error:null,bound:false};
function observation() {
  return {schema:'pero.environment.inspection.v1',method:target,scope:'configured-interpreter',evidence:'metadata_only',observed_at_ms:1000,matched:true,missing:[],
    profile:{id:'a'.repeat(64),observation:{name:'control-lab',python:{major:3,minor:12,patch:11},system:'Darwin',machine:'arm64',packages:{control:'0.10.2'},native:{},interpreter_sha256:null}},
    requirements:{method:target,required:[{kind:'package',name:'control',version:null}],preferred:[]}};
}
const response = data => new Response(JSON.stringify(data));
async function runtime(t) {
  const env = await createUiRuntime(t, {contents:"export * from './environments/workspace'; export * from './environments/inspection'; export {default as styles} from './environments/styles.css';",resolveDir:resolve(import.meta.dirname,'../src'),cssText:true});
  const {React,dom} = env;
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {return {x:20,y:60,top:60,left:20,right:220,bottom:90,width:200,height:30,toJSON(){return this;}};};
  return {...env,
    button: label => [...document.querySelectorAll('button')].find(node => node.textContent === label),
    focus: node => React.act(async () => node.focus()),
    fill: (node,value) => React.act(async () => {Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(node,value); node.dispatchEvent(new dom.window.Event('input',{bubbles:true}));}),
  };
}

test('managed preparation polling retains inspection evidence, filters, requests, and focused input', async t => {
  const {React,ui,render,click,button,fill,focus} = await runtime(t);
  t.mock.timers.enable({apis:['setInterval']});
  let reads=0,checks=0,release,signal;
  const fetchFn = async () => {reads++; return response([profile]);};
  const inspect = async (_, options) => {checks++;signal=options.signal;return checks === 1 ? observation() : new Promise(resolve => {release=resolve;});};
  const tree = locale => React.createElement(ui.EnvironmentManager,{locale,fetchFn,inspect});
  await render(tree('en'));
  await focus(button('Software checks'));
  await click(document.querySelector('[aria-label="Check: Control"]'));
  const search=document.querySelector('input[type=search]');
  await fill(search,'Control'); await focus(search);
  await React.act(async () => t.mock.timers.tick(1000));
  assert.equal(reads,2); assert.equal(document.querySelector('input[type=search]'),search);
  assert.equal(search.value,'Control'); assert.equal(document.activeElement,search);
  assert.equal(document.querySelectorAll('[data-tone=warning]').length,1);
  const pending = click(document.querySelector('[aria-label="Check: Control"]')); await pending;
  await React.act(async () => t.mock.timers.tick(1000));
  assert.equal(checks,2); assert.equal(signal.aborted,false);
  await React.act(async () => release(observation()));
  await render(tree('zh-CN'));
  assert.equal(document.querySelector('input[type=search]'),search);
  assert.equal(search.value,'Control');assert.equal(document.querySelectorAll('[data-tone=warning]').length,1);
});

test('first-load failure is not empty, retry recovers, and refresh failure keeps catalog data', async t => {
  const {React,ui,render,click,button} = await runtime(t);
  let mode='fail';
  const fetchFn=async () => mode==='fail' ? new Response('Host unavailable',{status:503}) : response(mode==='empty'?[]:[{...profile,state:'ready'}]);
  await render(React.createElement(ui.EnvironmentManager,{fetchFn}));
  assert.match(document.querySelector('[role=alert]').textContent,/Could not load environments/);
  assert.equal(document.body.textContent.includes('No local environments yet'),false);
  mode='empty';await click(button('Retry'));
  assert.match(document.body.textContent,/No local environments yet/);
  mode='data';await click(button('Refresh'));
  assert.ok(button('Research'));
  mode='fail';await click(button('Refresh'));
  assert.ok(button('Research'));
  assert.match(document.querySelector('[role=alert]').textContent,/Showing the previous environment list/);
});

test('observation recheck retains visible evidence and timestamp; permission loss removes it', async t => {
  const {React,ui,render,click,button} = await runtime(t);
  let mode='data',release;
  const inspect=async () => mode==='pending' ? new Promise(resolve => {release=resolve;}) : mode==='error' ? Promise.reject(Error('Network unavailable')) : mode==='denied' ? Promise.reject(Object.assign(Error('Access revoked'),{status:403})) : observation();
  await render(React.createElement(ui.EnvironmentChecks,{targets:[target],selected:target,single:true,autoInspect:true,inspect,now:()=>1000}));
  assert.match(document.querySelector('table').textContent,/0.10.2/);
  const facts=document.querySelector('.env-facts').textContent;
  mode='pending';await click(button('Check'));
  assert.match(document.body.textContent,/Refreshing observation/);
  assert.match(document.querySelector('table').textContent,/0.10.2/);
  await React.act(async () => release(observation()));
  mode='error';await click(button('Check'));
  assert.equal(document.querySelector('.env-facts').textContent,facts);
  assert.match(document.querySelector('[role=alert]').textContent,/previous observation/);
  assert.equal(document.body.textContent.includes('No observation yet'),false);
  mode='denied';await click(button('Retry'));
  assert.equal(document.querySelector('.env-facts'),null);assert.equal(document.querySelector('table'),null);
  assert.match(document.querySelector('[role=alert]').textContent,/Access revoked/);
});

test('creation uses shared selector and respects IME confirmation before one native form submission', async t => {
  const {React,dom,ui,render,click,button,fill} = await runtime(t);
  const calls=[];
  const fetchFn=async (_,options) => {const input=JSON.parse(options.body);calls.push(input);return response(input.operation==='list'?[]:[{...profile,label:input.label??'实验',state:input.operation==='prepare'?'preparing':'created'}]);};
  await render(React.createElement(ui.EnvironmentManager,{fetchFn}));
  await click(button('Create environment'));
  const name=document.querySelector('#env-name');await fill(name,'实验');
  assert.equal(document.activeElement,name);
  const ime=new dom.window.KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true});
  await React.act(async () => name.dispatchEvent(ime));
  assert.equal(ime.defaultPrevented,true);assert.equal(calls.length,1);
  assert.equal(document.querySelector('select'),null);
  await click(document.querySelector('#env-method'));
  assert.ok(document.querySelector('[role=listbox]'));
  await React.act(async () => document.querySelector('[role=listbox]').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
  assert.equal(document.activeElement.id,'env-method');
  await React.act(async () => document.querySelector('form').requestSubmit());
  assert.deepEqual(calls.map(input=>input.operation),['list','create','prepare']);
  assert.equal(calls[1].label,'实验');assert.equal(calls[1].target,target);
});

test('actual environment tabs associate panels and support arrow keys; tables expose a named scroll region', async t => {
  const {React,dom,ui,render,focus} = await runtime(t);
  const fetchFn=async () => response([{...profile,state:'ready'}]);
  await render(React.createElement(ui.EnvironmentManager,{fetchFn}));
  const first=document.querySelector('[role=tab]');
  const panel=document.getElementById(first.getAttribute('aria-controls'));
  assert.equal(panel.getAttribute('aria-labelledby'),first.id);assert.equal(panel.hidden,false);
  const region=panel.querySelector('[role=region]');assert.equal(region.getAttribute('aria-label'),'Local environments');assert.equal(region.tabIndex,0);
  t.mock.timers.enable({apis:['setTimeout']});
  await focus(first);
  await React.act(async () => {first.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));t.mock.timers.runAll();});
  const second=document.querySelectorAll('[role=tab]')[1];
  assert.equal(document.activeElement,second);assert.equal(second.getAttribute('aria-selected'),'true');
  assert.equal(panel.hidden,true);
});

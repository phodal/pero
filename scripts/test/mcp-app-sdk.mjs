import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir, rm, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {build} from 'esbuild';
import {chromium, expect} from '@playwright/test';
import {appSdkAliases} from '../build/app-sdk.mjs';

// Public SDK acceptance: actual AppBridge and production sandbox, no Agent or MCP server.
const root=resolve(import.meta.dirname,'../..'),evidence=resolve(root,'test-results/mcp-app-sdk');
await mkdir(evidence,{recursive:true});await rm(join(evidence,'result.json'),{force:true});
async function bundle(contents,name){
  const result=await build({stdin:{contents,resolveDir:root,sourcefile:`${name}.tsx`,loader:'tsx'},
    outfile:`${name}.js`,write:false,bundle:true,platform:'browser',format:'iife',target:'es2022',
    jsx:'automatic',alias:appSdkAliases(root)});
  return {js:result.outputFiles.find(file=>file.path.endsWith('.js')).text,
    css:result.outputFiles.find(file=>file.path.endsWith('.css'))?.text||''};
}
const documentHtml=({js,css},body,config='')=>`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="margin:0;background:var(--pero-surface);color:var(--pero-text);font:14px system-ui">${body}<script>${config}${js.replaceAll('</script','<\\/script')}</script></body></html>`;
const guest=await bundle(`
import React from 'react';import {createRoot} from 'react-dom/client';
import {App} from '@modelcontextprotocol/ext-apps';
import {Button} from '@pero/app-sdk/ui';import '@pero/app-sdk/tokens.css';
import {applyMcpAppTheme} from '@pero/mcp-apps/theme';
const app=new App({name:'Public SDK fixture',version:'1.0.0'},{},{autoResize:false});
window.receivedResults=0;
const receive=result=>{window.receivedResults++;document.querySelector('#payload').textContent=result.structuredContent.value;};
const context=value=>{applyMcpAppTheme(value);document.querySelector('#context').textContent=document.documentElement.dataset.theme+' / '+document.documentElement.lang;};
app.ontoolinput=({arguments:input})=>{document.querySelector('#input').textContent=input.savedId;};
app.ontoolresult=receive;app.onhostcontextchanged=context;app.onteardown=async()=>({});
createRoot(document.querySelector('#actions')).render(<Button onClick={async()=>receive(await app.callServerTool({name:'refresh',arguments:{savedId:'saved-42'}}))}>Refresh result</Button>);
app.connect().then(()=>{context(app.getHostContext()||{});app.sendSizeChanged({width:400,height:500});});
`,'sdk-guest');
const guestHtml=documentHtml(guest,'<main style="padding:var(--pero-spacing-4)"><h2>Saved tool result</h2><p id="payload" role="status">Waiting for original result…</p><p>Source: <span id="input"></span></p><p id="context"></p><div id="actions"></div></main>');
const host=await bundle(`
import React from 'react';import {createRoot} from 'react-dom/client';
import {mountMcpApp} from '@pero/mcp-apps';import {McpAppSurface} from '@pero/mcp-apps/react';
import {applyMcpAppTheme,mcpAppHostContext} from '@pero/mcp-apps/theme';import '@pero/app-sdk/tokens.css';
class HostAdapter {
  calls=0;revocations=0;errors=[];states=[];rejectRevoke=false;
  async callTool(){this.calls++;return {content:[{type:'text',text:'Updated via UI tool'}],structuredContent:{value:'Updated via UI tool'}};}
  async readResource(){return {contents:[]};}async openLink(){}
  async revoke(){this.revocations++;if(this.rejectRevoke)throw new Error('Fixture binding revocation failed');}onState(state){this.states.push(state);}onError(error){this.errors.push(String(error));}
}
applyMcpAppTheme({theme:'light',locale:'en'});
let context=mcpAppHostContext({theme:'light',locale:'en'}),size={initialHeight:240,minHeight:120,maxHeight:400};
const resource=id=>({title:'SDK result '+id,html:'served by the production sandbox',sandbox:window.proxyOrigin+'/sandbox?host='+encodeURIComponent(location.origin)+'&binding='+id,
  input:{savedId:'saved-42'},result:{content:[{type:'text',text:'Original saved result'}],structuredContent:{value:'Original saved result'}}});
window.adapters={raw:new HostAdapter(),surface:new HostAdapter(),failure:new HostAdapter(),unmount:new HostAdapter()};window.adapters.failure.rejectRevoke=true;
const surfaceRef=React.createRef(),reactRoot=createRoot(document.querySelector('#surface'));
let selected=resource('surface'),adapter=window.adapters.surface;
const render=()=>reactRoot.render(<React.StrictMode><McpAppSurface ref={surfaceRef} resource={selected} host={adapter} context={context}
  options={{hostInfo:{name:'SDK browser acceptance',version:'1.0.0'},size}} onClose={()=>{window.closeNotifications=(window.closeNotifications||0)+1;if(adapter===window.adapters.failure){window.failureDismissed=true;reactRoot.render(null);}}}/></React.StrictMode>);
window.sdk={surfaceRef,update(theme,locale){applyMcpAppTheme({theme,locale});context=mcpAppHostContext({theme,locale});size={initialHeight:180,minHeight:100,maxHeight:280};window.sdk.raw.setHostContext(context);window.sdk.raw.setSizePolicy(size);render();},
  failRevoke(){selected=resource('failure');adapter=window.adapters.failure;render();},
  reopen(){selected=resource('unmount');adapter=window.adapters.unmount;render();},unmount(){reactRoot.unmount();}};
mountMcpApp(document.querySelector('#raw'),resource('raw'),window.adapters.raw,context,{hostInfo:{name:'Direct Host adapter',version:'1.0.0'},size})
  .then(runtime=>{window.sdk.raw=runtime;render();window.sdkReady=true;});
`,'sdk-host');
const sandbox=await build({entryPoints:[resolve(root,'web/src/mcp/sandbox.ts')],write:false,bundle:true,platform:'browser',format:'iife',target:'es2022'});
const resources=new Map();let hostOrigin='',proxyOrigin='';
const proxyServer=createServer((request,response)=>{
  const url=new URL(request.url,proxyOrigin);
  if(url.pathname==='/sandbox')response.writeHead(200,{'Content-Type':'text/html','Referrer-Policy':'no-referrer'}).end('<!doctype html><body style="margin:0"><script src="/sandbox.js"></script>');
  else if(url.pathname==='/sandbox.js')response.writeHead(200,{'Content-Type':'text/javascript'}).end(sandbox.outputFiles[0].text);
  else if(url.pathname==='/resource'){
    const binding=url.searchParams.get('binding');resources.set(binding,(resources.get(binding)||0)+1);
    response.writeHead(200,{'Content-Type':'text/html','Referrer-Policy':'no-referrer','Content-Security-Policy':`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'self' ${hostOrigin}; base-uri 'none'`}).end(guestHtml);
  }else response.writeHead(404).end();
});
const hostServer=createServer((request,response)=>{
  if(request.url!=='/')return response.writeHead(404).end();
  response.writeHead(200,{'Content-Type':'text/html'}).end(documentHtml(host,
    '<main style="padding:var(--pero-spacing-4);max-width:900px;margin:auto"><h1>Unified MCP App SDK</h1><h2>Direct Host adapter</h2><div id="raw"></div><h2>Shared result Surface</h2><div id="surface"></div></main>',
    `window.proxyOrigin=${JSON.stringify(proxyOrigin)};`));
});
await Promise.all([new Promise(done=>hostServer.listen(0,'127.0.0.1',done)),new Promise(done=>proxyServer.listen(0,'127.0.0.1',done))]);
hostOrigin=`http://127.0.0.1:${hostServer.address().port}`;proxyOrigin=`http://127.0.0.1:${proxyServer.address().port}`;
let browser;
try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1100,height:900}});
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));await page.goto(hostOrigin);
  await page.waitForFunction(()=>window.sdkReady);
  const raw=page.frameLocator('#raw iframe').frameLocator('iframe'),surface=()=>page.frameLocator('#surface iframe').frameLocator('iframe');
  await expect(raw.locator('#payload')).toHaveText('Original saved result');
  await expect(surface().locator('#payload')).toHaveText('Original saved result');
  await expect(page.locator('#surface iframe')).toHaveCount(1);
  assert.equal(await page.evaluate(()=>window.adapters.surface.revocations),0);
  await expect(surface().locator('#input')).toHaveText('saved-42');
  await expect.poll(()=>page.locator('#surface iframe').evaluate(frame=>frame.getBoundingClientRect().height)).toBe(400);
  await mkdir(evidence,{recursive:true});await page.screenshot({path:join(evidence,'light.png'),fullPage:true});
  await surface().getByRole('button',{name:'Refresh result',exact:true}).click();
  await expect(surface().locator('#payload')).toHaveText('Updated via UI tool');
  await page.evaluate(()=>window.sdk.update('dark','zh'));
  await expect(surface().locator('#context')).toHaveText('dark / zh');
  await expect(raw.locator('#context')).toHaveText('dark / zh');
  await expect.poll(()=>page.locator('#surface iframe').evaluate(frame=>frame.getBoundingClientRect().height)).toBe(280);
  const expected=await page.locator('html').evaluate(el=>getComputedStyle(el).getPropertyValue('--pero-surface').trim());
  assert.equal(await surface().locator('html').evaluate(el=>getComputedStyle(el).getPropertyValue('--pero-surface').trim()),expected);
  assert.equal(resources.get('surface'),1);
  assert.equal(await surface().locator('html').evaluate(()=>window.receivedResults),2);
  assert.equal(await page.evaluate(()=>window.adapters.surface.calls),1);
  await page.setViewportSize({width:560,height:820});
  await expect.poll(()=>surface().locator('html').evaluate(el=>el.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:join(evidence,'dark-narrow.png'),fullPage:true});
  assert.equal(await surface().locator('body').evaluate(()=>{try{void window.top.document;return true;}catch{return false;}}),false);
  await page.evaluate(()=>window.sdk.raw.close());await expect(page.locator('#raw iframe')).toHaveCount(0);
  assert.equal(await page.evaluate(()=>window.adapters.raw.revocations),1);
  await page.getByRole('button',{name:'Close view',exact:true}).click();
  await expect(page.locator('#surface iframe')).toHaveCount(0);
  await expect(page.locator('#surface')).toContainText('Original saved result');
  assert.equal(await page.evaluate(()=>window.adapters.surface.revocations),1);
  await page.evaluate(()=>window.sdk.failRevoke());await expect(surface().locator('#payload')).toHaveText('Original saved result');
  await page.getByRole('button',{name:'Close view',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.failureDismissed)).toBe(true);
  await expect(page.locator('#surface')).toBeEmpty();
  await expect.poll(()=>page.evaluate(()=>window.adapters.failure.errors.includes('Error: Fixture binding revocation failed'))).toBe(true);
  assert.equal(await page.evaluate(()=>window.adapters.failure.states.at(-1)),'closed');
  await page.evaluate(()=>window.sdk.reopen());await expect(surface().locator('#payload')).toHaveText('Original saved result');
  await page.evaluate(()=>window.sdk.unmount());await expect(page.locator('#surface iframe')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>window.adapters.unmount.revocations)).toBe(1);
  await expect.poll(()=>page.evaluate(()=>window.adapters.unmount.states.at(-1))).toBe('closed');
  const adapters=await page.evaluate(()=>Object.fromEntries(Object.entries(window.adapters).map(([name,value])=>[name,{calls:value.calls,revocations:value.revocations,errors:value.errors,states:value.states}])));
  assert.deepEqual(errors,[]);for(const [name,adapter] of Object.entries(adapters))if(name!=='failure')assert.deepEqual(adapter.errors,[]);
  assert.equal(adapters.failure.revocations,1);assert(adapters.failure.errors.every(error=>error==='Error: Fixture binding revocation failed'));
  assert.equal(resources.get('raw'),1);assert.equal(resources.get('failure'),1);assert.equal(resources.get('unmount'),1);
  await writeFile(join(evidence,'result.json'),JSON.stringify({passed:true,scope:'Public SDK browser fixture; not full Workbench or Native acceptance',
    checks:['object Host adapter receiver','original input and result','StrictMode single live frame without spurious revocation','shared Surface fallback','size update without reconnect or tool replay','live theme and locale mapping','independent origin','failed revoke still dismisses and reports error','close and unmount revoke'],
    resources:Object.fromEntries(resources),adapters,screenshots:['light.png','dark-narrow.png']},null,2));
  console.log('MCP App SDK: shared Surface, theme, size policy and Host callback regression passed.');
}finally{
  await browser?.close();hostServer.closeAllConnections();proxyServer.closeAllConnections();
  await Promise.all([new Promise(done=>hostServer.close(done)),new Promise(done=>proxyServer.close(done))]);
}

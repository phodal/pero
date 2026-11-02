// Synthetic component smoke test only. No Host, model, network or scientific computation.
// Run: PERO_CHROMIUM_PATH=/usr/bin/chromium node tests/e2e/paper-manual-records.mjs
import {build} from 'esbuild';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'test-results/manual-records');
await mkdir(out,{recursive:true});
const fixture='import React from \'react\';\nimport { createRoot } from \'react-dom/client\';\nimport { ManualRecords } from \'../../apps/paper-agent/ui-src/manual-records\';\nimport \'../../apps/paper-agent/ui-src/styles.css\';\nconst papers = [{id:\'a\'.repeat(64),title:\'Synthetic source A\',contentDigest:\'a\', source:\'manual\',sourceId:\'a\',contentKind:\'full-text\',url:\'\',authors:[],fetchedAt:\'\'},{id:\'b\'.repeat(64),title:\'Synthetic source B\',contentDigest:\'b\',source:\'manual\',sourceId:\'b\',contentKind:\'full-text\',url:\'\',authors:[],fetchedAt:\'\'}];\nconst records = []; let count=0; window.calls=[];\nconst api={get:async()=>null, post:async(path,body)=>{window.calls.push(body);if(body.operation===\'list\')return{records};if(body.operation===\'read\')return{...records.find(item=>item.id===body.recordId),selections:window.calls.filter(item=>item.operation===\'select\'&&item.recordId===body.recordId).map((item,index)=>({...item,id:String(index),createdAt:\'2026-11-02T00:00:00Z\'}))};if(body.operation===\'create\'){const record={...body,id:String(++count).repeat(64),createdAt:\'2026-11-02T00:00:00Z\'};records.push(record);return record;}if(body.operation===\'impact\')return{recordId:body.recordId,items:[{paperId:papers[0].id,status:\'unknown\',reason:\'Upstream changes were not checked.\'}]};if(body.operation===\'select\')return{execution:\'not_requested\'};if(body.operation===\'export\')return{sourceVersions:[],omitted:[\'Question and scope\']};}};\ncreateRoot(document.getElementById(\'app\')).render(<div className="pa-workbench" style={{height:\'auto\',padding:20}}><ManualRecords api={api} library={{papers,intents:[],reports:[]}} paper={papers[0]}/></div>);\n';
await writeFile(resolve(out,'entry.tsx'),fixture);
await build({entryPoints:[resolve(out,'entry.tsx')],outfile:resolve(out,'ui.js'),bundle:true,jsx:'automatic',nodePaths:[resolve(root,'apps/paper-agent/node_modules')],alias:{react:resolve(root,'apps/paper-agent/node_modules/react'),'react-dom':resolve(root,'apps/paper-agent/node_modules/react-dom'),'@pero/app-sdk/ui':resolve(root,'packages/app-sdk/src/ui.tsx'),'@pero/app-sdk':resolve(root,'packages/app-sdk/src/index.tsx')}});
await writeFile(resolve(out,'index.html'),'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="ui.css"><style>:root{--pero-text:#222;--pero-surface:white;--pero-border:#ccc;--pero-input-border:#888;--pero-focus:#555;--pero-text-muted:#666;--pero-font-body:14px;--pero-font-heading:16px}.pero-ui-input{font:inherit;width:100%;padding:6px}.pero-ui-button{font:inherit;padding:6px;color:inherit;background:transparent;border:1px solid #888;border-radius:4px}</style></head><body><div id="app"></div><script src="ui.js"></script></body></html>');
// Match Desktop's App sandbox: a bare file URL missed blocked native submits.
const server=createServer(async(request,response)=>{
  const name=new URL(request.url,'http://localhost').pathname.slice(1);
  if(!name){response.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><style>body{margin:0}iframe{width:100vw;height:100vh;border:0}</style><iframe name="paper-agent" title="paper-agent" sandbox="allow-scripts allow-same-origin allow-downloads allow-popups" src="/index.html"></iframe>');return;}
  if(!['index.html','ui.js','ui.css'].includes(name)){response.writeHead(404).end();return;}
  response.writeHead(200,{'Content-Type':name.endsWith('.html')?'text/html':name.endsWith('.js')?'text/javascript':'text/css'});
  response.end(await readFile(resolve(out,name)));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
browser=await chromium.launch({...(process.env.PERO_CHROMIUM_PATH ? {executablePath:process.env.PERO_CHROMIUM_PATH} : {}),headless:true});const page=await browser.newPage({viewport:{width:420,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(`http://127.0.0.1:${server.address().port}`);const frame=page.frame('paper-agent');assert.ok(frame);await frame.getByText('Question and scope',{exact:true}).click();await frame.getByRole('button',{name:'New record',exact:true}).click();
await frame.getByLabel('Question',{exact:true}).fill('Synthetic question');await frame.getByLabel('Scope',{exact:true}).fill('Two synthetic sources');await frame.getByLabel('Inclusion criteria').fill('Comparable conditions');await frame.getByLabel('Exclusion criteria').fill('Missing conditions');await frame.getByLabel('Reason',{exact:true}).fill('Relevant method');
await frame.getByText('Evidence or gaps (optional)',{exact:true}).click();await frame.getByRole('button',{name:'Add evidence or gap'}).click();
await frame.getByRole('button',{name:'Save revision',exact:true}).click();assert.equal(await frame.evaluate(()=>window.calls.filter(c=>c.operation==='create').length),0);
await expect(frame.getByLabel('Conditions and limitations')).toBeFocused();
await frame.getByRole('button',{name:'Remove evidence'}).click();
await frame.getByRole('button',{name:'Save revision',exact:true}).click();await frame.getByText('Revision saved. Earlier records are unchanged.',{exact:true}).waitFor();await frame.getByRole('article',{name:'Saved research record'}).waitFor();
await frame.getByRole('button',{name:'Check saved source updates'}).click();await frame.getByLabel('Synthetic source A — unknown').check();await frame.getByRole('button',{name:'Save reread selection'}).click();await frame.getByText('Reread selection saved. No reading or computation has started.').waitFor();
await frame.getByText('Saved reread selections',{exact:true}).click();await frame.getByText('Recorded only; no execution requested.').waitFor();
await frame.getByRole('button',{name:'Revise',exact:true}).click();await frame.getByLabel('Scope',{exact:true}).press('Enter');
await frame.getByLabel('Question',{exact:true}).dispatchEvent('keydown',{key:'Enter',isComposing:true});
assert.equal(await frame.evaluate(()=>window.calls.filter(c=>c.operation==='create').length),1);
await frame.getByLabel('Scope',{exact:true}).fill('Revised scope');await frame.getByLabel('Question',{exact:true}).press('Enter');await frame.getByText('Revised scope',{exact:true}).waitFor();
assert.equal(await frame.locator('.pa-manual-history li').count(),2);const calls=await frame.evaluate(()=>window.calls);assert.equal(calls.filter(c=>c.operation==='create').length,2);assert.equal(calls.filter(c=>c.operation==='select').length,1);assert.ok(calls.filter(c=>c.operation==='create')[1].parentId);
await page.screenshot({path:resolve(out,'narrow-light.png'),fullPage:true});
await frame.addStyleTag({content:':root{--pero-text:#eee;--pero-surface:#222;--pero-border:#666;--pero-input-border:#aaa;--pero-focus:#ddd;--pero-text-muted:#bbb}body{background:#222}.pero-ui-input{color:#eee;background:#222}'});await page.screenshot({path:resolve(out,'narrow-dark.png'),fullPage:true});
assert.equal(await frame.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);console.log(JSON.stringify({checks:['production sandbox without allow-forms','required evidence validation','click save and Enter revision','create','impact unknown','explicit reread selection only','revision retains predecessor','narrow layout','light/dark screenshots','no browser errors'],scope:'Synthetic component API fixture, not Desktop or scientific acceptance'},null,2));
}finally{try{await browser?.close();}finally{await new Promise(resolve=>server.close(resolve));}}

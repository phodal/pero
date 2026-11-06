// Production Paper/SDK UI, deterministic Host and research projections; no model calls.
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'test-results/paper-programs');
await mkdir(out,{recursive:true});
const paper={id:'a'.repeat(64),source:'openalex',sourceId:'W1',title:'Synthetic model mismatch study with a deliberately long descriptive title',url:'https://openalex.org/W1',authors:[],contentKind:'abstract',contentDigest:'b'.repeat(64),fetchedAt:'2026-11-06T00:00:00Z',content:'Synthetic source; no scientific acceptance.'};
let program=null,run=null,failNext=false;const calls=[],errors=[];
const browser=await chromium.launch({headless:true,...(process.env.PERO_CHROMIUM_PATH?{executablePath:process.env.PERO_CHROMIUM_PATH}:{})});
const page=await browser.newPage({viewport:{width:1100,height:900}});
page.on('pageerror',e=>errors.push(e.message));
try {
  await page.route('**/*',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname,body=request.method()==='POST'?request.postDataJSON():null;
    let value;
    if(path==='/host/sdk')value={name:'paper-agent',permissions:{api:['/api'],events:['chat:closed'],host:['agent']}};
    else if(path==='/api/library')value={papers:[paper],intents:[],reports:[]};
    else if(path==='/api/workspaces')value={items:[{workspaceId:'ws_fixture'}]};
    else if(path==='/api/harnesses')value={items:[{id:'pero',available:true}]};
    else if(path==='/api/programs'){
      if(failNext){failNext=false;return route.fulfill({status:503,body:'Synthetic research backend unavailable. Reload to retry.'})}
      if(body.operation==='list')value={programs:program?[program]:[]};
      else if(body.operation==='create'){
        program={id:'c'.repeat(64),checkpoint:'d'.repeat(64),protocol:{...body,deadline:new Date(Date.now()+30*60*1000).toISOString(),limits:{...body.limits,candidates:24,downloads:6,downloadBytes:62914560,appCalls:80}},usage:{rounds:0,searches:0,candidates:1,reads:0,downloads:0,downloadBytes:0,appCalls:0},runtime:null,rounds:[],gaps:[],stopReason:null,jobs:[],candidates:[{id:'e'.repeat(64),title:paper.title,url:paper.url,decision:'include',reason:'User-selected seed',blocker:null,documentId:null}]};value=program;
      }else if(body.operation==='read')value=program;
      else if(body.operation==='launch')value={context:{kind:'paper-autoresearch',programId:program.id,protocolDigest:'f'.repeat(64)},prompt:'Synthetic approved protocol.'};
      else if(body.operation==='stop'){program.stopReason='user_stopped';value=program}
      else throw Error(`Unexpected program operation ${body.operation}`);
    }else if(path==='/host/capability'){
      calls.push(body);
      if(body.operation==='lookup')value={requestId:body.input.requestId,run};
      else if(body.operation==='start'){run={id:'app:paper-agent:fixture',sessionId:'app:paper-agent:fixture',scope:body.input.scope,status:'running',attempt:1,requestId:body.input.requestId,updatedAt:new Date().toISOString()};value=run}
      else if(body.operation==='status')value=run;
      else if(body.operation==='open')value={sessionId:run.sessionId};
      else if(body.operation==='cancel'){run.status='cancelled';value=run}
      else if(body.operation==='retry'){run={...run,status:'running',attempt:run.attempt+1};value=run}
      else throw Error(`Unexpected Host operation ${body.operation}`);
    }else if(path.startsWith('/api/'))throw Error(`Unexpected request ${path}`);
    if(value!==undefined)return route.fulfill({json:value});
    const asset=path==='/'?'/index.html':path;
    return route.fulfill({body:await readFile(resolve(root,`apps/paper-agent/dist${asset}`)),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(asset)]||'application/octet-stream'});
  });
  await page.goto('http://localhost/');
  await page.getByRole('button',{name:'Autonomous research',exact:true}).click();
  await expect(page.getByRole('button',{name:'Save plan',exact:true})).toBeDisabled();
  await page.getByLabel(paper.title,{exact:true}).check();
  for(const [label,text] of [['Research question','Does the method remain reliable under model mismatch?'],['Scope','Original studies and replications.'],['Include','Methods with original observations.'],['Exclude','Unattributed summaries.']])await page.getByLabel(label,{exact:true}).fill(text);
  await page.getByRole('button',{name:'Save plan',exact:true}).focus();
  await page.screenshot({path:resolve(out,'plan-light-focus.png')});
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button',{name:'Start research',exact:true})).toBeEnabled();
  assert.equal(calls.filter(c=>c.operation==='start').length,0,'Saving a plan must not start an Agent');
  await page.getByRole('button',{name:'Start research',exact:true}).click();
  await expect.poll(()=>calls.filter(c=>c.operation==='open').length).toBe(1);
  assert.equal(calls.find(c=>c.operation==='start').input.context.programId,program.id);
  await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  await expect(page.getByRole('button',{name:'Resume research',exact:true})).toBeEnabled();
  await page.screenshot({path:resolve(out,'paused-light.png')});
  await page.getByRole('button',{name:'Resume research',exact:true}).click();
  await expect.poll(()=>calls.filter(c=>c.operation==='retry').length).toBe(1);
  assert.equal(calls.filter(c=>c.operation==='start').length,1,'Resuming must reuse the original Run');
  await page.getByRole('button',{name:'Stop research',exact:true}).click();
  await expect(page.getByRole('button',{name:'Resume research',exact:true})).toBeDisabled();
  await page.evaluate(()=>window.postMessage({type:'pero:app:context',context:{locale:'zh-CN',dark:true,active:true}},'*'));
  await expect(page.locator('html')).toHaveAttribute('lang','zh-CN');
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('button',{name:'继续研究',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'打开会话与产物',exact:true}).focus();
  await page.screenshot({path:resolve(out,'stopped-dark-narrow.png')});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,'Narrow layout overflows');
  failNext=true;await page.getByRole('button',{name:'重新读取',exact:true}).click();
  await expect(page.getByText('Synthetic research backend unavailable. Reload to retry.',{exact:false})).toBeVisible();
  await page.screenshot({path:resolve(out,'error-dark-narrow.png')});
  await page.getByRole('button',{name:'重新读取',exact:true}).click();
  await expect(page.getByText('Synthetic research backend unavailable. Reload to retry.',{exact:false})).toHaveCount(0);
  assert.deepEqual(errors,[]);
  await writeFile(resolve(out,'result.json'),JSON.stringify({passed:true,checks:['explicit-start','same-run-resume','stop-disabled','error-recovery','keyboard-focus','light-dark','narrow-no-overflow'],limitations:['Fixture state; no provider or scientific acceptance']},null,2));
  console.log('PASS Paper research plan/start/pause/resume/stop/error and responsive UI');
}catch(error){await page.screenshot({path:resolve(out,'failure.png')});throw error}finally{await browser.close()}

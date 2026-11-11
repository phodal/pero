// Production Paper/SDK UI, deterministic Host and research projections; no model calls.
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'test-results/paper-programs');
await mkdir(out,{recursive:true});
const paper={id:'a'.repeat(64),source:'openalex',sourceId:'W1',title:'Synthetic model mismatch study with a deliberately long descriptive title',url:'https://openalex.org/W1',authors:[],contentKind:'abstract',contentDigest:'b'.repeat(64),fetchedAt:'2026-11-06T00:00:00Z',content:'Synthetic source; no scientific acceptance.'};
const reportId='9'.repeat(64),passageId='8'.repeat(64);
let program=null,run=null,failNext=false,failCancel=false;const calls=[],citations=[],errors=[];
const browser=await chromium.launch({headless:true,...(process.env.PERO_CHROMIUM_PATH?{executablePath:process.env.PERO_CHROMIUM_PATH}:{})});
const page=await browser.newPage({viewport:{width:1100,height:900}});
page.on('pageerror',e=>errors.push(e.message));
try {
  await page.route('**/*',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname,body=request.method()==='POST'?request.postDataJSON():null;
    if(path==='/harness')return route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style><iframe sandbox="allow-scripts allow-same-origin allow-forms" src="/"></iframe>'});
    let value;
    if(path==='/host/sdk')value={name:'paper-agent',permissions:{api:['/api'],events:['chat:closed'],host:['agent']}};
    else if(path==='/api/library')value={papers:[paper],intents:[],reports:[]};
    else if(path==='/api/workspaces')value={items:[{workspaceId:'ws_fixture'}]};
    else if(path==='/api/harnesses')value={items:[{id:'pero',available:true}]};
    else if(path==='/api/reports/'+reportId)value={id:reportId,intentId:'intent1',sections:[{evidence:[{paperId:paper.id,passageId,quote:'First quotation'},{paperId:paper.id,passageId,quote:'Second quotation'}]}],matrix:{cells:[{evidence:[{paperId:paper.id,passageId,quote:'Matrix quotation'}]}]}};
    else if(path==='/api/intents/intent1')value={id:'intent1',papers:[paper]};
    else if(path==='/api/evidence'){citations.push(body);value={paperId:paper.id,start:0,end:body.quote.length,heading:'Saved original passage',before:'',quote:body.quote,after:''}}
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
      else if(body.operation==='cancel'){if(failCancel){failCancel=false;return route.fulfill({status:503,body:'Synthetic cancel transport unavailable'})}run.status='cancelled';value=run}
      else if(body.operation==='retry'){run={...run,status:'running',attempt:run.attempt+1};value=run}
      else throw Error(`Unexpected Host operation ${body.operation}`);
    }else if(path.startsWith('/api/'))throw Error(`Unexpected request ${path}`);
    if(value!==undefined)return route.fulfill({json:value});
    const asset=path==='/'?'/index.html':path;
    return route.fulfill({body:await readFile(resolve(root,`apps/paper-agent/dist${asset}`)),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(asset)]||'application/octet-stream'});
  });
  await page.goto('http://localhost/harness');
  const surface=page.frameLocator('iframe');
  await surface.getByRole('button',{name:'Autonomous research',exact:true}).click();
  await expect(surface.getByRole('button',{name:'Save and review plan',exact:true})).toBeDisabled();
  await surface.getByLabel(paper.title,{exact:true}).check();
  for(const [label,text] of [['Research question','Does the method remain reliable under model mismatch?'],['Scope','Original studies and replications.'],['Include','Methods with original observations.'],['Exclude','Unattributed summaries.']])await surface.getByRole('textbox',{name:label,exact:true}).fill(text);
  await surface.getByRole('button',{name:'Save and review plan',exact:true}).focus();
  await page.screenshot({path:resolve(out,'plan-light-focus.png')});
  await page.keyboard.press('Enter');
  await expect(surface.getByRole('button',{name:'Start research',exact:true})).toBeEnabled();
  assert.equal(calls.filter(c=>c.operation==='start').length,0,'Saving a plan must not start an Agent');
  await surface.getByRole('button',{name:'Start research',exact:true}).click();
  await expect.poll(()=>calls.filter(c=>c.operation==='open').length).toBe(1);
  assert.equal(calls.find(c=>c.operation==='start').input.context.programId,program.id);
  await expect(surface.getByRole('button',{name:'Pause',exact:true})).toBeVisible();
  failNext=true;
  await expect.poll(()=>failNext,{timeout:10000}).toBe(false);
  await expect(surface.getByText('Synthetic research backend unavailable. Reload to retry.',{exact:false})).toHaveCount(0,{timeout:10000});
  await surface.getByRole('button',{name:'Pause',exact:true}).click();
  await expect(surface.getByRole('button',{name:'Resume research',exact:true})).toBeEnabled();
  await page.screenshot({path:resolve(out,'paused-light.png')});
  await surface.getByRole('button',{name:'Resume research',exact:true}).click();
  await expect.poll(()=>calls.filter(c=>c.operation==='retry').length).toBe(1);
  assert.equal(calls.filter(c=>c.operation==='start').length,1,'Resuming must reuse the original Run');
  failCancel=true;
  await surface.getByRole('button',{name:'Stop research',exact:true}).click();
  await surface.getByRole('dialog').getByRole('button',{name:'Stop research',exact:true}).click();
  await expect.poll(()=>run.status,{timeout:10000}).toBe('cancelled');
  await expect(surface.getByRole('button',{name:'Resume research',exact:true})).toBeDisabled();
  await surface.getByRole('dialog').getByRole('button',{name:'Go back',exact:true}).click();
  program.rounds=[{id:'round1',number:1,question:'Two quotations from one observed passage',newEvidence:1,gaps:['Independent replication missing'],nextAction:'Locate replication',claims:['First quotation','Second quotation'].map((quote,i)=>({text:'Synthetic claim '+(i+1),stance:i?'counterevidence':'support',quote,reportId,paperId:paper.id,passageId}))}];
  program.usage.rounds=1;
  await surface.getByRole('button',{name:'Refresh',exact:true}).click();
  await surface.getByRole('tab',{name:'Reports',exact:true}).click();
  await expect(surface.getByText('Counterevidence',{exact:true})).toBeVisible();
  await surface.getByRole('button',{name:'Source report',exact:true}).nth(1).click();
  await expect(surface.locator('.pa-evidence mark')).toHaveText('Second quotation');
  assert.equal(citations.at(-1).quote,'Second quotation');
  assert.equal(citations.at(-1).passageId,passageId);
  await page.screenshot({path:resolve(out,'exact-second-quotation.png')});
  await surface.locator('.pa-evidence button').first().press('Escape');
  await expect(surface.locator('.pa-evidence')).toHaveCount(0);
  await page.evaluate(id=>document.querySelector('iframe').contentWindow.postMessage({type:'pero:app:location',location:'report/'+id+'/citation/2'},'*'),reportId);
  await expect(surface.locator('.pa-evidence mark')).toHaveText('Matrix quotation');
  assert.equal(citations.at(-1).quote,'Matrix quotation');
  await page.screenshot({path:resolve(out,'export-matrix-citation.png')});
  await surface.locator('.pa-evidence button').first().press('Escape');
  const verifiedCitations=citations.length;
  await page.evaluate(({reportId,passageId})=>document.querySelector('iframe').contentWindow.postMessage({type:'pero:app:location',location:'report/'+reportId+'/passage/'+passageId},'*'),{reportId,passageId});
  await expect(surface.getByText('This passage has multiple saved quotations. Open the research plan and select a claim.',{exact:true})).toBeVisible();
  assert.equal(citations.length,verifiedCitations,'An ambiguous historical link must not silently choose the first quote');
  await surface.locator('.pa-global-error button').click();
  await surface.getByRole('tab',{name:'Plan',exact:true}).click();
  await expect(surface.getByText('Not yet reported / 40',{exact:true})).toBeVisible();
  await page.screenshot({path:resolve(out,'unknown-accounting-light.png')});
  await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({type:'pero:app:context',context:{locale:'zh-CN',dark:true,active:true}},'*'));
  await expect(surface.locator('html')).toHaveAttribute('lang','zh-CN');
  await page.setViewportSize({width:390,height:844});
  await expect(surface.getByRole('button',{name:'继续研究',exact:true})).toBeDisabled();
  await surface.getByRole('button',{name:'打开会话与产物',exact:true}).focus();
  await page.screenshot({path:resolve(out,'stopped-dark-narrow.png')});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,'Narrow layout overflows');
  await surface.getByRole('tab',{name:'研究报告',exact:true}).click();
  await expect(surface.getByText('反证',{exact:true})).toBeVisible();
  await page.screenshot({path:resolve(out,'claims-dark-narrow.png')});
  failNext=true;await surface.getByRole('button',{name:'刷新',exact:true}).click();
  await expect(surface.getByText('Synthetic research backend unavailable. Reload to retry.',{exact:false})).toBeVisible();
  await page.screenshot({path:resolve(out,'error-dark-narrow.png')});
  await surface.getByRole('button',{name:'刷新',exact:true}).click();
  await expect(surface.getByText('Synthetic research backend unavailable. Reload to retry.',{exact:false})).toHaveCount(0);
  assert.deepEqual(errors,[]);
  await writeFile(resolve(out,'result.json'),JSON.stringify({passed:true,checks:['explicit-start','same-run-resume','stop-disabled','error-recovery','keyboard-focus','light-dark','narrow-no-overflow','same-passage-second-quote','unknown-runtime-not-zero','claim-stance','indexed-matrix-artifact-link'],limitations:['Fixture state; no provider or scientific acceptance']},null,2));
  console.log('PASS Paper research plan/start/pause/resume/stop/error and responsive UI');
}catch(error){await page.screenshot({path:resolve(out,'failure.png')});throw error}finally{await browser.close()}

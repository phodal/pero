// Production Paper App in Chromium; saved API data is synthetic, no provider or computation.
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'test-results/paper-record-evidence');
await mkdir(out,{recursive:true});
const paper={id:'a'.repeat(64),source:'manual',sourceId:'synthetic',title:'Synthetic source A',url:'https://example.org/paper',authors:[],contentKind:'full-text',contentDigest:'b'.repeat(64),fetchedAt:'2026-11-11T00:00:00Z'};
const reportId='c'.repeat(64),passageId='d'.repeat(64),intentId='e'.repeat(64);
const quote=text=>({paperId:paper.id,passageId,quote:text});
const report={id:reportId,intentId,title:'Saved comparison with exact quotations',acceptance:'unverified',limitations:'Synthetic fixture; no scientific acceptance.',sections:[{heading:'Comparison',content:'Both quotations come from one observed passage.',paperIds:[paper.id],evidence:[quote('First quotation'),quote('Second quotation')]}],matrix:{columns:[{id:'metric',label:'Result'}],cells:[{paperId:paper.id,columnId:'metric',value:'Qualified result',status:'supported',evidence:[quote('Matrix quotation')]}]}};
const intent={id:intentId,question:'Saved comparison question',paperIds:[paper.id],papers:[paper],passages:[{id:passageId,paperId:paper.id,page:2,content:'First quotation. Second quotation. Matrix quotation.'}],verifyCode:false};
const record={id:'f'.repeat(64),question:'Synthetic research record',scope:'Compare two exact quotations.',inclusion:'Observed original',exclusion:'Unattributed summaries',paperIds:[paper.id],decisions:[{paperId:paper.id,decision:'include',reason:'Relevant original'}],evidence:[{paperId:paper.id,reportId,stance:'counterevidence',note:'Keep both quotations distinguishable.'},{paperId:paper.id,reportId:null,stance:'gap',note:'No evidence yet.'}],createdAt:'2026-11-11T00:00:00Z'};
const errors=[],calls=[],citations=[];let failReport=false;
const browser=await chromium.launch({headless:true,...(process.env.PERO_CHROMIUM_PATH?{executablePath:process.env.PERO_CHROMIUM_PATH}:{})});
const page=await browser.newPage({viewport:{width:1280,height:1000}});
page.on('pageerror',e=>errors.push(e.message));
try{
  await page.route('**/*',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname,body=req.method()==='POST'?req.postDataJSON():null;
    if(path==='/harness')return route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0}iframe{width:100vw;height:100vh;border:0}</style><iframe sandbox="allow-scripts allow-same-origin allow-downloads" src="/"></iframe>'});
    let value;
    if(path==='/host/sdk')value={name:'paper-agent',permissions:{api:['/api'],events:['chat:closed'],host:['agent']}};
    else if(path==='/api/library')value={papers:[paper],intents:[],reports:[{id:reportId,intentId,title:report.title}]};
    else if(path==='/api/data-evidence')value={links:[]};
    else if(path==='/api/research/record'){
      calls.push(body);
      if(body.operation==='list')value={records:[record]};
      else if(body.operation==='read')value={...record,selections:[]};
      else throw Error('Unexpected record mutation '+body.operation);
    }else if(path==='/api/reports/'+reportId){
      if(failReport){failReport=false;return route.fulfill({status:503,body:'Saved report temporarily unavailable.'})}
      value=report;
    }else if(path==='/api/intents/'+intentId)value=intent;
    else if(path==='/api/evidence'){citations.push(body);value={paperId:paper.id,start:0,end:body.quote.length,heading:'Saved original passage',before:'',quote:body.quote,after:''};}
    else if(path.startsWith('/api/')||path.startsWith('/host/'))throw Error('Unexpected request '+path);
    if(value!==undefined)return route.fulfill({json:value});
    const asset=path==='/'?'/index.html':path;
    return route.fulfill({body:await readFile(resolve(root,'apps/paper-agent/dist'+asset)),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(asset)]||'application/octet-stream'});
  });
  await page.goto('http://localhost/harness');
  const app=page.frameLocator('iframe');
  await app.getByText('Research results',{exact:true}).first().click();
  await app.getByRole('button',{name:record.question,exact:true}).click();
  const saved=app.getByRole('article',{name:'Saved research record'}),link=saved.getByRole('button',{name:report.title,exact:true});
  await link.focus();await page.keyboard.press('Enter');
  const opened=saved.getByRole('region',{name:'Saved evidence report'});
  await expect(opened.getByRole('heading',{name:report.title,exact:true})).toBeVisible();
  await expect(opened).toBeFocused();
  await opened.locator('.pa-citations button').nth(1).click();
  await expect(app.locator('.pa-evidence mark')).toHaveText('Second quotation');
  assert.equal(citations.at(-1).quote,'Second quotation');assert.equal(citations.at(-1).passageId,passageId);
  await page.screenshot({path:resolve(out,'second-quotation-light.png')});
  await app.locator('.pa-evidence button').first().press('Escape');
  await opened.locator('.pa-cell-evidence button').click();
  await expect(app.locator('.pa-evidence mark')).toHaveText('Matrix quotation');
  assert.equal(citations.at(-1).quote,'Matrix quotation');
  await app.locator('.pa-evidence button').first().press('Escape');
  await opened.getByRole('button',{name:'Close report',exact:true}).click();
  await expect(link).toBeFocused();
  failReport=true;await link.click();
  await expect(opened.getByRole('alert')).toContainText('Saved report temporarily unavailable.');
  await expect(saved.getByText(record.scope,{exact:true})).toBeVisible();
  await page.screenshot({path:resolve(out,'report-retry-light.png')});
  await opened.getByRole('button',{name:'Retry report'}).click();
  await expect(opened.getByRole('heading',{name:report.title})).toBeVisible();
  await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({type:'pero:app:context',context:{locale:'en',dark:true,active:true}},'*'));
  await page.setViewportSize({width:390,height:844});
  await opened.getByRole('button',{name:'Close report'}).focus();
  await page.screenshot({path:resolve(out,'report-dark-narrow.png')});
  assert.equal(await app.locator('html').evaluate(e=>e.scrollWidth>innerWidth+1),false);
  assert.deepEqual(errors,[]);assert.ok(calls.every(c=>['list','read'].includes(c.operation)));
  await writeFile(resolve(out,'result.json'),JSON.stringify({checks:['saved report outside current history','keyboard open and focus return','exact second quotation in shared passage','matrix quotation','failed load retains revision and retries','narrow dark layout','no record mutations'],calls,citations,errors,scope:'Production Chromium App, synthetic API; no Host, provider or scientific acceptance'},null,2));
  console.log('Paper record evidence browser checks passed');
}catch(error){await page.screenshot({path:resolve(out,'failure.png')}); console.error(await page.frameLocator('iframe').locator('body').innerText()); throw error;}finally{await browser.close();}

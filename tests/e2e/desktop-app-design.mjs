// Isolated browser regressions for actual App entries. All APIs are fixtures; no Agent runs.
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, extname } from 'node:path';
import { createServer } from 'node:http';
import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';
import { appSdkAliases } from '../../scripts/build/app-sdk.mjs';
const root = resolve(import.meta.dirname, '../..');
let temporary, server, browser, origin;
const screenshots = process.env.PERO_DESIGN_SCREENSHOTS;
const themes = JSON.parse(await readFile(resolve(root,'web/src/theme.generated.json'),'utf8'));
before(async () => {
  temporary = await mkdtemp(resolve(tmpdir(),'pero-app-design-'));
  if (screenshots) await mkdir(screenshots,{recursive:true});
  for (const app of ['insights','connectors','environments','data','paper-agent']) {
    const out = resolve(temporary,app); await mkdir(out);
    await build({entryPoints:[resolve(root,`apps/${app}/ui-src/frame.tsx`)],outfile:resolve(out,'index.js'),bundle:true,format:'esm',platform:'browser',jsx:'automatic',loader:{'.png':'dataurl','.svg':'dataurl','.woff':'file','.woff2':'file','.ttf':'file','.wasm':'file'},alias:appSdkAliases(root),nodePaths:[resolve(root,`apps/${app}/node_modules`)],logLevel:'warning',plugins:[{name:'app-react',setup(b){b.onResolve({filter:/^(react|react-dom)(\/|$)/},args=>{if(args.resolveDir===resolve(root,`apps/${app}`))return;return b.resolve(args.path,{kind:args.kind,resolveDir:resolve(root,`apps/${app}`)});});}}]});
    await writeFile(resolve(out,'index.html'),'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="./index.css"></head><body style="margin:0"><div id="app"></div><script type="module" src="./index.js"></script></body></html>');
  }
  server=createServer(async(req,res)=>{try{const file=resolve(temporary,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(temporary+'/'))throw Error('Invalid path');res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();await new Promise(r=>server?server.close(r):r());if(temporary)await rm(temporary,{recursive:true,force:true});});
const json=value=>({value});
async function pageFor(t,app,handler,{size=14,dark=false,width=1000,locale='en'}={}){
  const page=await browser.newPage({viewport:{width,height:800}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  t.after(async()=>{await page.close();assert.deepEqual(errors,[],'browser page errors');});
  await page.addInitScript(()=>{
    window.fixtureMessages=[];
    window.addEventListener('message',event=>{
      const m=event.data;
      if(m?.type==='pero:app:sdk'){
        window.fixtureMessages.push(m);
        window.postMessage({type:'pero:app:sdk-result',id:m.id,ok:true},'*');
      }
      if(m?.type==='pero:app:chat'){
        window.fixtureMessages.push(m);
        window.postMessage({type:'pero:app:chat-result',id:m.id,ok:true,value:{threadId:'fixture-draft'}},'*');
      }
    });
  });
  await page.route('**/host/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    const body=request.postData()?request.postDataJSON():{};
    let result;
    if(path==='/host/sdk')result=json({name:app,locale,dark,active:true,appearance:{dark,accent:'teal',typography:{ui:size,chat:14,code:13},palette:dark?themes.dark:themes.light}});
    else result=await handler({path,body,page})??json({});
    await route.fulfill({status:result.status??200,contentType:'application/json',body:typeof result.value==='string'?result.value:JSON.stringify(result.value??{})});
  });
  return page;
}
async function shot(page,name){if(screenshots)await page.screenshot({path:resolve(screenshots,name+'.png'),fullPage:true});}
const fixtureBrief={cards:[
  {kind:'risk',title:'Source change needs review',conclusion:'The previous result remains available.',body:'Recorded evidence for this review.',why:'A dependency changed.',entity:{label:'Fixture session',sessionId:'fixture-session'},action:{label:'Review session',sessionId:'fixture-session'},sources:[{label:'Original source',url:'https://example.org/evidence'},{label:'Session evidence',sessionId:'fixture-session'},{label:'Unsafe source',url:'javascript:alert(1)'}]},
  {kind:'needs_you',title:'Prepare a follow-up',action:{label:'Prepare review draft',prompt:'Review the existing result before continuing.'}},
  {kind:'change',title:'A notable update',conclusion:'Available in the progress feed.'},
]};

test('Insights distinguishes loading, opens evidence and retains all findings across failed regeneration',async t=>{
  let release,starts=0,regeneration;
  const gate=new Promise(r=>release=r);
  const page=await pageFor(t,'insights',async({path,body})=>{
    if(path==='/host/insights'){await gate;return json({sessions:[],repositories:[],conflicts:[]});}
    if(path==='/host/automation')return json({status:200,body:{updates:[]}});
    if(path==='/host/agent'){
      if(body.operation==='info')return json({available:true,agents:[{id:'fixture',available:true}],workspace:''});
      if(body.operation==='start'){starts++;return json({sessionId:'fixture-run'});}
      if(body.operation==='events'){
        if(starts>1){await new Promise(r=>regeneration=r);return {status:503,value:'Fixture generation unavailable'};}
        return json({cursor:1,status:'completed',text:JSON.stringify(fixtureBrief)});
      }
    }
  },{size:24,dark:true});
  await page.goto(origin+'/insights/index.html');
  await expect(page.getByText('Loading work records and Agent availability…',{exact:true})).toBeVisible();
  await expect(page.getByText('No new personal work updates.',{exact:true})).not.toBeVisible();
  release();
  await expect(page.getByRole('heading',{name:'Source change needs review'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'A notable update',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Prepare a follow-up',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Review session',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.fixtureMessages.filter(m=>m.operation==='open-session').length)).toBe(1);
  assert.deepEqual(await page.evaluate(()=>window.fixtureMessages.find(m=>m.operation==='open-session').input),{sessionId:'fixture-session'});
  await expect(page.getByRole('link',{name:'Original source',exact:true})).toHaveAttribute('href','https://example.org/evidence');
  await expect(page.getByRole('link',{name:'Unsafe source',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Prepare review draft',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.fixtureMessages.some(m=>m.type==='pero:app:chat'))).toBe(true);
  assert.deepEqual(await page.evaluate(()=>window.fixtureMessages.find(m=>m.type==='pero:app:chat').options),{message:'Review the existing result before continuing.'});
  const evidence=page.getByRole('article').filter({has:page.getByRole('heading',{name:'Source change needs review',exact:true})});
  await expect(evidence.getByText('Recorded evidence for this review.',{exact:true})).not.toBeVisible();
  await evidence.getByRole('button',{name:'View evidence',exact:true}).click();
  await expect(evidence.getByText('Recorded evidence for this review.',{exact:true})).toBeVisible();
  const generated=await page.locator('.point-pulse-generated').innerText();
  await page.getByRole('button',{name:'Regenerate',exact:true}).click();
  await expect(page.getByRole('button',{name:'Updating…',exact:true})).toBeDisabled();
  await expect(page.getByRole('heading',{name:'Source change needs review'})).toBeVisible();
  assert.equal(starts,2);await expect.poll(()=>!!regeneration).toBe(true);regeneration();
  await expect(page.getByRole('alert')).toContainText('previous brief remains');
  await expect(page.getByRole('heading',{name:'Source change needs review'})).toBeVisible();
  assert.equal(await page.locator('.point-pulse-generated').innerText(),generated);
  await expect(page.getByRole('heading',{level:1})).toHaveText('Work brief');
  await expect(page.getByRole('region',{name:'Research updates',exact:true})).toHaveCount(0);
  const edges=await page.evaluate(()=>{const a=document.querySelector('.point-pulse-top').getBoundingClientRect(),b=document.querySelector('.point-brief-layout').getBoundingClientRect();return {a:a.left,b:b.left};});
  assert.equal(edges.a,edges.b);
  await shot(page,'insights-retained-dark24');
});

for (const appearance of [{locale:'en',size:14,width:1000,dark:false},{locale:'zh',size:24,width:420,dark:true}]) test(`Insights keeps legacy evidence readable and opens the original source (${appearance.locale})`,async t=>{
  const sessionId='chat-1793940610307-original-source',url='https://example.org/research/original-version';
  const legacyBrief={cards:[
    {kind:'risk',title:'Saved source needs review',entity:'session',sources:[{sessionId}]},
    {kind:'change',title:'Research findings are available',sources:[{url},{label:'Named research source',url:'https://example.org/named-source'}]},
  ],tomorrow:['Review the saved source.','Continue the existing study.']};
  const page=await pageFor(t,'insights',async({path,body})=>{
    if(path==='/host/insights')return json({sessions:[]});
    if(path==='/host/automation')return json({status:200,body:{updates:[]}});
    if(path==='/host/agent')return json(body.operation==='info'?{available:true,agents:[{id:'fixture',available:true}],workspace:''}:body.operation==='start'?{sessionId:'legacy-fixture'}:{cursor:1,status:'completed',text:JSON.stringify(legacyBrief)});
  },appearance);
  await page.goto(origin+'/insights/index.html');
  const card=page.getByRole('article').filter({has:page.getByRole('heading',{name:'Saved source needs review',exact:true})});
  await expect(page.getByText(appearance.locale==='zh'?'这份历史简报尚无综合摘要，已有发现与来源仍可查看。':'A summary is not available for this saved brief. Its findings and sources remain available.',{exact:true})).toBeVisible();
  await expect(card.getByText(appearance.locale==='zh'?'会话':'Session',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Research findings are available',exact:true})).toBeVisible();
  const sessionSource=card.getByRole('button',{name:appearance.locale==='zh'?'会话 1':'Session 1',exact:true});
  await expect(sessionSource).toHaveAttribute('title',sessionId);
  await sessionSource.click();
  await expect.poll(()=>page.evaluate(()=>window.fixtureMessages.some(m=>m.operation==='open-session'))).toBe(true);
  assert.deepEqual(await page.evaluate(()=>window.fixtureMessages.find(m=>m.operation==='open-session').input),{sessionId});
  const webSource=page.getByRole('link',{name:appearance.locale==='zh'?'网页 1':'Web source 1',exact:true});
  await expect(webSource).toHaveAttribute('title',url);
  await expect(webSource).toHaveAttribute('href',url);
  await expect(page.getByRole('link',{name:'Named research source',exact:true})).toHaveAttribute('href','https://example.org/named-source');
  await expect(page.getByRole('listitem').filter({hasText:'Review the saved source.'})).toBeVisible();
  await expect(page.getByRole('listitem').filter({hasText:'Continue the existing study.'})).toBeVisible();
  if(appearance.width>=1000){
    const ahead=await page.evaluate(()=>{const findings=document.querySelector('.point-brief-findings').getBoundingClientRect(),next=document.querySelector('.point-pulse-ahead').getBoundingClientRect();return {findingsRight:findings.right,aheadLeft:next.left,findingsTop:findings.top,aheadTop:next.top};});
    assert.ok(ahead.aheadLeft>=ahead.findingsRight-1,'next steps sit to the right of the findings');
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await shot(page,`insights-readable-evidence-${appearance.locale}`);
});

for (const appearance of [{locale:'en',size:14,width:1200,dark:false},{locale:'zh',size:24,width:420,dark:true}]) test(`Insights leads with a cross-session summary and prepares discussion without executing it (${appearance.locale})`,async t=>{
  let starts=0;
  const paragraphs=[
    'The source review and implementation discussion point to one shared next step: verify the changed dependency before continuing the saved work.',
    'The existing result remains available, while a follow-up still needs a decision.',
  ];
  const brief={...fixtureBrief,summary:paragraphs.join('\n\n'),cards:[...fixtureBrief.cards.map(card=>{
    if(card.kind!=='change')return {...card,topic:'Research',topicType:'research'};
    const {kind,...publication}=card;
    return {...publication,topic:'Runtime work',topicType:'engineering',sources:[{label:'Implementation discussion',sessionId:'implementation-session'}]};
  }),{kind:'filtered',title:'Routine build output omitted',body:'filtered_source remains inspectable.',sources:[{label:'Filtered source evidence',sessionId:'filtered-source-session'}]}]};
  const page=await pageFor(t,'insights',async({path,body})=>{
    if(path==='/host/insights')return json({sessions:[{threadId:'summary-brief',app:'insights',status:'completed',response_kind:'final'}]});
    if(path==='/host/automation')return json({status:200,body:{updates:[]}});
    if(path==='/host/agent'){
      if(body.operation==='info')return json({available:true,agents:[{id:'fixture',available:true}],workspace:''});
      if(body.operation==='start'){starts++;throw Error('Reading or discussing a saved brief must not execute an Agent');}
      if(body.operation==='events')return json({cursor:1,status:'completed',text:JSON.stringify(brief)});
    }
  },appearance);
  await page.goto(origin+'/insights/index.html');
  const zh=appearance.locale==='zh';
  const summary=page.getByRole('region',{name:zh?'AI 工作摘要':'AI work summary',exact:true});
  const attention=page.getByRole('complementary',{name:zh?'需要你决定':'Needs your decision',exact:true});
  const findings=page.getByRole('region',{name:zh?'关键结论':'Key findings',exact:true});
  const discussion=page.getByRole('region',{name:zh?'继续讨论':'Continue the conversation',exact:true});
  for(const paragraph of paragraphs)await expect(summary.getByText(paragraph,{exact:true})).toBeVisible();
  await expect(attention.getByRole('heading',{name:'Prepare a follow-up',exact:true})).toBeVisible();
  await expect(findings.getByRole('heading',{name:'Source change needs review',exact:true})).toBeVisible();
  await expect(findings.getByRole('heading',{name:'A notable update',exact:true})).toBeVisible();
  const topics=page.locator('.point-brief-topic');
  await expect(topics).toHaveCount(2);
  await expect(topics.nth(0).locator('.pero-ui-card-header')).toHaveAttribute('data-tone','apricot');
  await expect(topics.nth(1).locator('.pero-ui-card-header')).toHaveAttribute('data-tone','blue');
  const boxes=await topics.evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};}));
  if(appearance.width>=700) assert.ok(boxes[1].left>=boxes[0].right && Math.abs(boxes[1].top-boxes[0].top)<1,'wide topics sit side by side');
  else assert.ok(boxes[1].top>=boxes[0].bottom,'narrow topics stack without overlap');
  if(appearance.width>=1200){
    const side=await Promise.all([summary,discussion].map(region=>region.evaluate(node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top};})));
    assert.ok(side[1].left>=side[0].right-1 && Math.abs(side[1].top-side[0].top)<24,'discussion sits beside the summary');
  }

  await expect(page.getByRole('heading',{name:'Routine build output omitted',exact:true})).toHaveCount(0);
  await expect(page.getByRole('link',{name:'Original source',exact:true})).toHaveAttribute('href','https://example.org/evidence');
  await expect(page.getByRole('button',{name:'Session evidence',exact:true})).toHaveAttribute('title','fixture-session');
  await expect(page.getByRole('button',{name:'Implementation discussion',exact:true})).toHaveAttribute('title','implementation-session');
  await page.getByRole('button',{name:zh?'讨论这份简报':'Discuss this brief',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.fixtureMessages.some(m=>m.type==='pero:app:chat'))).toBe(true);
  const draft=await page.evaluate(()=>window.fixtureMessages.find(m=>m.type==='pero:app:chat').options);
  assert.equal(draft.message,zh?'讨论这份简报':'Discuss this brief');
  assert.equal(draft.attachments.length,1);
  const reference=draft.attachments[0];
  assert.equal(reference.type,'app-object');
  assert.equal(reference.objectId,'insights-brief');
  assert.ok(Number.isSafeInteger(reference.revision)&&reference.revision>0);
  const observed=await page.evaluate(()=>new Promise((resolve,reject)=>{
    const id='inspect-discussion-brief';
    const timeout=setTimeout(()=>{window.removeEventListener('message',receive);reject(Error('The App did not expose the discussion brief'));},5000);
    const receive=event=>{
      if(event.source!==window||event.data?.type!=='pero:app-use:result'||event.data.id!==id)return;
      clearTimeout(timeout);window.removeEventListener('message',receive);resolve(event.data);
    };
    window.addEventListener('message',receive);
    window.postMessage({type:'pero:app-use:request',id,request:{action:'semantic',target:'insights-brief'}},'*');
  }));
  assert.equal(observed.ok,true);
  assert.equal(observed.value.objects.length,1);
  const object=observed.value.objects[0];
  assert.equal(object.id,reference.objectId);
  assert.equal(object.revision,reference.revision);
  assert.equal(object.state.summary,paragraphs.join('\n\n'));
  assert.deepEqual(object.state.cards.map(card=>card.title),brief.cards.map(card=>card.title));
  assert.deepEqual(object.state.cards[0].sources,fixtureBrief.cards[0].sources);
  assert.deepEqual(object.state.cards[2].sources,[{label:'Implementation discussion',sessionId:'implementation-session'}]);
  assert.equal(object.state.cards[3].body,'filtered_source remains inspectable.');
  assert.deepEqual(object.state.cards[3].sources,[{label:'Filtered source evidence',sessionId:'filtered-source-session'}]);
  assert.equal(starts,0);
  assert.equal(await page.evaluate(()=>window.fixtureMessages.some(m=>m.operation==='open-session')),false);
  const original=discussion.getByText(zh?'原始简报':'Original brief',{exact:true});
  await original.click();
  await expect(discussion.locator('pre')).toContainText('filtered_source remains inspectable.');
  await expect(discussion.locator('pre')).toContainText('filtered-source-session');
  await expect(discussion.locator('pre')).toContainText('implementation-session');
  await original.click();
  if(zh){
    const positions=await Promise.all([summary,attention,findings,discussion].map(region=>region.evaluate(node=>({top:node.getBoundingClientRect().top,bottom:node.getBoundingClientRect().bottom}))));
    for(let i=1;i<positions.length;i++)assert.ok(positions[i].top>=positions[i-1].bottom-1,'narrow reading order is summary, decision, findings, discussion');
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await shot(page,`insights-cross-session-summary-${appearance.locale}`);
});

test('Insights keeps populated research checks below the brief and retains them after a failed refresh',async t=>{
  let reads=0;
  const page=await pageFor(t,'insights',async({path,body})=>{
    if(path==='/host/insights')return json({sessions:[]});
    if(path==='/host/agent')return json(body.operation==='info'?{available:true,agents:[{id:'fixture',available:true}],workspace:''}:body.operation==='start'?{sessionId:'fixture-checks'}:{cursor:1,status:'completed',text:JSON.stringify(fixtureBrief)});
    if(path==='/host/automation')return ++reads===1?json({status:200,body:{updates:[{researchRecordId:'fixture-record',checkedAt:1,result:{question:'Review the changed source',papers:[{subject:'fixture-paper',name:'Selected paper',status:'changed',latest:'v2'}],datasets:[],affectedAttempts:[],affectedReportIds:[]}}]}}):{status:503,value:'fixture.checks_unavailable'};
  });
  await page.goto(origin+'/insights/index.html');
  const checks=page.getByRole('region',{name:'Research updates',exact:true});
  await expect(page.getByRole('heading',{name:'Source change needs review'})).toBeVisible();
  await expect(checks.getByText('Review the changed source',{exact:true})).toBeVisible();
  await expect(checks.getByText('Selected paper — Update available (v2)',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{level:1})).toHaveText('Work brief');
  const order=await page.evaluate(()=>{const header=document.querySelector('.point-pulse-top'),feed=document.querySelector('.point-pulse-feed'),checks=document.querySelector('.point-research-updates');return {afterHeader:!!(header.compareDocumentPosition(feed)&Node.DOCUMENT_POSITION_FOLLOWING),afterFeed:!!(feed.compareDocumentPosition(checks)&Node.DOCUMENT_POSITION_FOLLOWING),aligned:header.getBoundingClientRect().left===checks.getBoundingClientRect().left};});
  assert.deepEqual(order,{afterHeader:true,afterFeed:true,aligned:true});
  await checks.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(checks.getByRole('alert')).toBeVisible();
  await expect(checks.getByText('Review the changed source',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Source change needs review'})).toBeVisible();
  await shot(page,'insights-research-retained');
});

test('Insights restores the saved App brief without a new Agent run and regenerates only on request',async t=>{
  let starts=0;
  const reads=[];
  const page=await pageFor(t,'insights',async({path,body})=>{
    if(path==='/host/insights')return json({sessions:[
      {threadId:'saved-brief',app:'insights',status:'completed',response_kind:'final'},
      {threadId:'foreign-result',app:'paper-agent',status:'completed',response_kind:'final'},
      {threadId:'app:insights:ordinary',status:'completed',response_kind:'final'},
    ]});
    if(path==='/host/automation')return json({status:200,body:{updates:[]}});
    if(path==='/host/agent'){
      if(body.operation==='info')return json({available:true,agents:[{id:'fixture',available:true}],workspace:''});
      if(body.operation==='start'){starts++;return json({sessionId:'fresh-brief'});}
      if(body.operation==='events'){
        reads.push(body.sessionId);
        return json({cursor:1,status:'completed',text:JSON.stringify(body.sessionId==='fresh-brief'?{cards:[{kind:'risk',title:'Explicitly regenerated brief'}]}:fixtureBrief)});
      }
    }
  });
  await page.goto(origin+'/insights/index.html');
  await expect(page.getByRole('heading',{name:'Source change needs review',exact:true})).toBeVisible();
  assert.equal(starts,0);assert.deepEqual(reads,['saved-brief']);
  await expect(page.getByRole('link',{name:'Original source',exact:true})).toHaveAttribute('href','https://example.org/evidence');
  await expect(page.locator('.point-pulse-generated')).toHaveCount(0);
  await expect(page.locator('.point-pulse-day')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading',{name:'Source change needs review',exact:true})).toBeVisible();
  assert.equal(starts,0);assert.deepEqual(reads,['saved-brief','saved-brief']);
  await shot(page,'insights-restored');
  await page.getByRole('button',{name:'Regenerate',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Explicitly regenerated brief',exact:true})).toBeVisible();
  assert.equal(starts,1);assert.equal(reads.at(-1),'fresh-brief');
});

test('Insights keeps readable history through recovery failures and clears its warning after successful regeneration',async t=>{
  let starts=0,failed=false;
  const reads=[];
  const page=await pageFor(t,'insights',async({path,body})=>{
    if(path==='/host/insights')return json({sessions:[
      {threadId:'saved-brief',app:'insights',status:'completed',response_kind:'final'},
      {threadId:'invalid-brief',app:'insights',status:'completed',response_kind:'final'},
      {threadId:'unfinished-brief',app:'insights',status:'unfinished',response_kind:'intermediate'},
    ]});
    if(path==='/host/automation')return json({status:200,body:{updates:[]}});
    if(path==='/host/agent'){
      if(body.operation==='info')return json({available:true,agents:[{id:'fixture',available:true}],workspace:''});
      if(body.operation==='start'){starts++;return json({sessionId:'fresh-brief'});}
      if(body.operation==='events'){
        reads.push(body.sessionId);
        if(body.sessionId==='fresh-brief')return json({cursor:1,status:'completed',text:JSON.stringify({cards:[{kind:'needs_you',title:'Fresh completed brief'}]})});
        return failed?{status:503,value:'fixture.history_unavailable'}:json({cursor:1,status:'completed',text:body.sessionId==='invalid-brief'?'unfinished JSON':JSON.stringify(fixtureBrief)});
      }
    }
  });
  await page.goto(origin+'/insights/index.html');
  await expect(page.getByRole('heading',{name:'Source change needs review',exact:true})).toBeVisible();
  await expect(page.getByRole('status')).toContainText('latest readable brief remains');
  assert.deepEqual(reads,['invalid-brief','saved-brief']);assert.equal(starts,0);
  failed=true;await page.getByRole('button',{name:'Reload',exact:true}).click();
  await expect.poll(()=>reads.length).toBe(4);
  await expect(page.getByRole('status')).toContainText('latest readable brief remains');
  await expect(page.getByRole('heading',{name:'Source change needs review',exact:true})).toBeVisible();
  assert.equal(starts,0);
  const beside=await page.evaluate(()=>{const summary=document.querySelector('.point-brief-summary').getBoundingClientRect(),warning=document.querySelector('.point-insights-restore').getBoundingClientRect();return {summaryRight:summary.right,warningLeft:warning.left,summaryTop:summary.top,warningTop:warning.top};});
  assert.ok(beside.warningLeft>=beside.summaryRight-1 && Math.abs(beside.warningTop-beside.summaryTop)<24,'restore warning sits beside the summary');
  await shot(page,'insights-restored-with-warning');
  await page.getByRole('button',{name:'Regenerate',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Fresh completed brief',exact:true})).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Reload',exact:true})).toHaveCount(0);
  assert.equal(starts,1);
});

test('Insights App locations restore their exact saved brief without fallback or Agent execution',async t=>{
  let starts=0;
  const reads=[];
  const older='app:insights:older',latest='app:insights:latest';
  const page=await pageFor(t,'insights',async({path,body})=>{
    if(path==='/host/insights')return json({sessions:[
      {threadId:older,app:'insights',status:'completed',response_kind:'final'},
      {threadId:latest,app:'insights',status:'completed',response_kind:'final'},
    ]});
    if(path==='/host/automation')return json({status:200,body:{updates:[]}});
    if(path==='/host/agent'){
      if(body.operation==='info')return json({available:false,agents:[],workspace:''});
      if(body.operation==='start'){starts++;throw Error('An App location must not start an Agent');}
      if(body.operation==='events'){
        reads.push(body.sessionId);
        return json({cursor:1,status:'completed',text:JSON.stringify({cards:[{kind:'needs_you',title:body.sessionId===older?'Selected older brief':'Latest recorded brief'}]})});
      }
    }
  });
  await page.goto(origin+'/insights/index.html');
  await expect(page.getByRole('heading',{name:'Latest recorded brief',exact:true})).toBeVisible();
  const olderLocation='brief/'+Buffer.from(older).toString('base64url');
  await page.evaluate(location=>window.postMessage({type:'pero:app:location',location},'*'),olderLocation);
  await expect(page.getByRole('heading',{name:'Selected older brief',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Latest recorded brief',exact:true})).toHaveCount(0);
  assert.deepEqual(reads,[latest,older]);assert.equal(starts,0);
  await page.evaluate(location=>window.postMessage({type:'pero:app:location',location},'*'),'brief/'+Buffer.from('missing-brief').toString('base64url'));
  await expect(page.getByRole('status')).toContainText('This brief could not be restored');
  await expect(page.getByRole('heading',{name:'Selected older brief',exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Latest recorded brief',exact:true})).toHaveCount(0);
  assert.deepEqual(reads,[latest,older]);assert.equal(starts,0);
  await page.evaluate(()=>window.postMessage({type:'pero:app:location',location:'brief/a'},'*'));
  await expect(page.getByRole('status')).toContainText('This brief could not be restored');
  await page.getByText('Technical details',{exact:true}).click();
  await expect(page.getByText('The brief address is invalid.',{exact:true})).toBeVisible();
  assert.deepEqual(reads,[latest,older]);assert.equal(starts,0);
  await page.evaluate(location=>window.postMessage({type:'pero:app:location',location},'*'),olderLocation);
  await expect(page.getByRole('heading',{name:'Selected older brief',exact:true})).toBeVisible();
  assert.deepEqual(reads,[latest,older,older]);assert.equal(starts,0);
});

test('Insights gives the Agent recent working conversations with honest cumulative coverage',async t=>{
  let prompt='';
  const work=Array.from({length:25},(_,index)=>({threadId:`work-${index}`,status:'completed',response_kind:'final',unfinished:2,unknown_turns:1,repository:'github.com/phodal/pero',turns:[{
    request:`Goal ${index}`,response:`Reported result ${index}`,status:'completed',response_kind:'final',truncated:index===24,
  }]}));
  const self=index=>({threadId:`brief-${index}`,app:'insights',status:'unfinished',response_kind:'intermediate'});
  const page=await pageFor(t,'insights',async({path,body})=>{
    if(path==='/host/insights')return json({sessions:[...work.slice(0,5),self(1),...work.slice(5),self(2)]});
    if(path==='/host/automation')return json({status:200,body:{updates:[]}});
    if(path==='/host/agent'){
      if(body.operation==='info')return json({available:true,agents:[{id:'fixture',available:true}],workspace:''});
      if(body.operation==='start'){prompt=body.prompt;return json({sessionId:'new-brief'});}
      if(body.operation==='events')return json({cursor:1,status:'completed',text:JSON.stringify(fixtureBrief)});
    }
  });
  await page.goto(origin+'/insights/index.html');
  await page.getByRole('button',{name:'Generate brief',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Source change needs review',exact:true})).toBeVisible();
  const context=JSON.parse(prompt.slice(prompt.lastIndexOf('\n{"workRecap":')+1)),recap=context.workRecap;
  assert.deepEqual(recap.sessions.map(session=>session.sessionId),work.slice(-20).map(session=>session.threadId));
  assert.deepEqual(recap.coverage,{examined:27,matched:25,shown:20,unreadable:0,omitted:5,complete:false});
  assert.equal(recap.scope,'cumulative_host_journal');
  for(const key of ['date','timezone','start','end'])assert.equal(recap[key],'');
  const last=recap.sessions.at(-1);
  assert.equal(last.request,'Goal 24');assert.equal(last.response,'Reported result 24');
  assert.equal(last.truncated,true);assert.equal(last.turns[0].truncated,true);
  assert.equal(last.repository,'github.com/phodal/pero');
  assert.equal(last.unfinishedTurns,2);assert.equal(last.unknownTurns,1);
  assert.equal(Object.hasOwn(last,'harnessId'),false);
});

test('Insights distinguishes no available Agent from a successfully generated empty brief',async t=>{
  let available=false;
  const page=await pageFor(t,'insights',async({path,body})=>{
    if(path==='/host/insights')return json({sessions:[]});
    if(path==='/host/agent')return json(body.operation==='info'?{available,agents:available?[{id:'fixture',available:true}]:[],workspace:''}:body.operation==='start'?{sessionId:'fixture-empty'}:{cursor:1,status:'completed',text:'{"cards":[]}'});
    if(path==='/host/automation')return json({status:200,body:{updates:[]}});
  });
  await page.goto(origin+'/insights/index.html');
  await expect(page.getByText('No Agent is connected. Connect an Agent to generate a brief.')).toBeVisible();
  await expect(page.getByText('No new personal work updates.',{exact:true})).not.toBeVisible();
  await expect(page.locator('.point-insights-empty-result')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Generate brief',exact:true})).toBeDisabled();
  available=true;await page.reload();
  await expect(page.getByText('No new personal work updates.',{exact:true})).toBeVisible();
  await expect(page.getByText('No Agent is connected. Connect an Agent to generate a brief.')).not.toBeVisible();
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page.locator('.point-pulse-day')).toHaveCount(0);
  await expect(page.locator('.point-pulse-generated')).toBeVisible();
  await expect(page.locator('.point-insights-empty-result .pero-ui-empty-illustration')).toHaveAttribute('aria-hidden','true');
});

test('Connectors has explicit views, visible prerequisites, and preserves the catalog during a single refresh',async t=>{
  let snapshots=0,release;
  const directory=[{providerId:'fixture-provider',displayName:'Fixture service',category:'research',transport:'http',auth:{mode:'none'},requires:[],summary:'An isolated catalog fixture',listed:true,prerequisiteCopy:'Requires organization access',prerequisiteEn:'Requires organization access'}];
  const page=await pageFor(t,'connectors',async({body})=>{
    if(body.operation==='snapshot'){
      snapshots++;if(snapshots>1){await new Promise(r=>release=r);return {status:503,value:'Fixture catalog unavailable'};}
      return json({ok:true,directory,connections:[]});
    }
    return json({ok:true,result:[]});
  },{size:24});
  await page.goto(origin+'/connectors/index.html');
  await expect(page.getByRole('heading',{name:'Fixture service',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Requirements',exact:true}).click();
  await expect(page.getByRole('tooltip')).toContainText('Requires organization access');
  await page.keyboard.press('Escape');
  await page.getByRole('tab',{name:'Installed connections',exact:true}).click();
  await expect(page.getByRole('tab',{name:'Installed connections',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('tab',{name:'Service catalog',exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'Service catalog',exact:true}).click();
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(page.getByRole('button',{name:'Refresh',exact:true})).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('Refreshing');
  await expect(page.getByRole('heading',{name:'Fixture service',exact:true})).toBeVisible();
  assert.equal(snapshots,2);await expect.poll(()=>!!release).toBe(true);release();
  await expect(page.getByRole('alert')).toContainText('Connection management is unavailable');
  await expect(page.getByRole('heading',{name:'Fixture service',exact:true})).toBeVisible();
  await shot(page,'connectors-catalog24');
});

test('Environments failed initial load has one error state and scales shared controls',async t=>{
  const page=await pageFor(t,'environments',async()=>({status:503,value:'Fixture environment catalog unavailable'}),{size:24,dark:true});
  await page.goto(origin+'/environments/index.html');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('heading',{name:'No local environments yet',exact:true})).not.toBeVisible();
  const sizes=await page.evaluate(()=>({root:parseFloat(getComputedStyle(document.documentElement).fontSize),button:parseFloat(getComputedStyle(document.querySelector('button')).fontSize)}));
  assert.equal(sizes.root,24);assert.ok(sizes.button>=20);
  await shot(page,'environments-error-dark24');
});

test('Data has one initial empty state',async t=>{
  const page=await pageFor(t,'data',async()=>json({}));
  await page.route('**/api/state',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({datasets:[],assets:[],views:[],parserVersion:'fixture',limits:{importBytes:1000,previewBytes:1000,records:100,fields:20,columns:20}})}));
  await page.goto(origin+'/data/index.html');
  await expect(page.getByText('No data yet',{exact:true})).toBeVisible();
  await expect(page.getByText('No dataset selected',{exact:true})).not.toBeVisible();
  await shot(page,'data-empty14');
});

test('Paper shows list skeletons until the library and local search resolve, then distinct empty states',async t=>{
  let releaseLibrary,releaseSearch;
  const libraryGate=new Promise(r=>releaseLibrary=r),searchGate=new Promise(r=>releaseSearch=r);
  t.after(()=>{releaseLibrary();releaseSearch();});
  const page=await pageFor(t,'paper-agent',async()=>json({}));
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/library'){
      await libraryGate;
      return route.fulfill({json:{papers:[],intents:[],reports:[]}});
    }
    if(path==='/api/library/search'){
      await searchGate;
      return route.fulfill({json:{items:[],returned:0,queryTerms:[]}});
    }
    return route.fulfill({json:path==='/api/research/record'?{records:[]}:[]});
  });
  await page.goto(origin+'/paper-agent/index.html');
  const library=page.locator('.pa-library-papers');
  await expect(library.locator('.pero-ui-loading')).toBeVisible();
  await expect(library.locator('.pero-ui-empty-state')).toHaveCount(0);
  releaseLibrary();
  await expect(library.getByText('Add a paper to start reading',{exact:true})).toBeVisible();
  await expect(library.locator('.pero-ui-empty-illustration')).toHaveAttribute('aria-hidden','true');
  const search=library.locator('.pa-local-search');
  await search.getByRole('searchbox').fill('missing passage');
  await search.getByRole('searchbox').press('Enter');
  await expect(search.locator('.pero-ui-loading')).toBeVisible();
  await expect(search.locator('.pero-ui-empty-state')).toHaveCount(0);
  releaseSearch();
  await expect(search.getByText(/^No matching passages\./)).toBeVisible();
  await expect(search.locator('.pero-ui-empty-illustration')).toHaveAttribute('aria-hidden','true');
  await search.getByRole('button',{name:'Find more papers',exact:true}).click();
  await expect(page.locator('.pa-discover .pero-ui-empty-state')).toContainText('Search a topic, author, or title');
});

test('Paper discovery distinguishes loading from zero results and retains the same search during failed refresh',async t=>{
  let reads=0,release;
  const hit={id:'fixture-discovery',source:'openalex',title:'A retained discovery result',authors:[]};
  const page=await pageFor(t,'paper-agent',async()=>json({}));
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/search'){
      reads++;await new Promise(r=>release=r);
      return reads===2?route.fulfill({status:503,body:'Search service unavailable'}):route.fulfill({json:{items:reads===1?[hit]:[]}});
    }
    return route.fulfill({json:path==='/api/library'?{papers:[],intents:[],reports:[]}:path==='/api/research/record'?{records:[]}:[]});
  });
  t.after(()=>release?.());
  await page.goto(origin+'/paper-agent/index.html');
  await page.getByRole('tab',{name:'Discover',exact:true}).click();
  const discover=page.locator('.pa-discover'),input=discover.getByRole('searchbox',{name:'Search literature',exact:true});
  await input.fill('cell research');await input.press('Enter');
  await expect.poll(()=>reads).toBe(1);
  await expect(discover.locator('.pero-ui-loading')).toBeVisible();
  await expect(discover.locator('.pero-ui-empty-state')).toHaveCount(0);
  release();await expect(discover.getByRole('heading',{name:hit.title,exact:true})).toBeVisible();
  await input.press('Enter');await expect.poll(()=>reads).toBe(2);
  await expect(discover.getByRole('heading',{name:hit.title,exact:true})).toBeVisible();
  await expect(discover.locator('.pero-ui-loading')).toHaveCount(0);
  release();await expect(discover.getByRole('alert')).toContainText('Previous search results remain below.');
  await expect(discover.getByRole('heading',{name:hit.title,exact:true})).toBeVisible();
  await input.fill('another query');await input.press('Enter');await expect.poll(()=>reads).toBe(3);
  await expect(discover.getByRole('heading',{name:hit.title,exact:true})).toHaveCount(0);
  await expect(discover.locator('.pero-ui-loading')).toBeVisible();
  await expect(discover.locator('.pero-ui-empty-state')).toHaveCount(0);
  release();await expect(discover.getByText('No papers match these filters',{exact:true})).toBeVisible();
  await expect(discover.locator('.pero-ui-empty-illustration')).toHaveAttribute('aria-hidden','true');
});


test('Paper compact navigation reaches results and retains library search after reactivation',async t=>{
  const paper={id:'fixture-paper',title:'A saved source with a readable title',source:'local',sourceId:'fixture',authors:[],url:'https://example.org/paper',contentKind:'abstract',fetchedAt:'2026-11-06',contentDigest:'fixture-digest'};
  let reads=0,release,blockRefresh=false;
  const page=await pageFor(t,'paper-agent',async()=>json({}),{width:600,size:24,dark:true});
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/library'){
      reads++;if(blockRefresh)await new Promise(r=>release=r);
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({papers:[paper],intents:[],reports:[],bundles:[{id:'fixture-collection',title:'My collection'}]})});
    }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(path==='/api/research/record'?{records:[]}:[])});
  });
  await page.goto(origin+'/paper-agent/index.html');
  const nav=page.locator('.pa-workspace-switch').getByRole('button');
  await expect(nav).toBeVisible();
  await expect(page.locator('.pa-workspace-nav')).not.toBeVisible();
  const libraryType=await page.locator('.pa-library-heading h1').evaluate(node=>parseFloat(getComputedStyle(node).fontSize));
  assert.ok(libraryType>=24,'library heading follows the 24px preference');
  const querySize=await page.locator('.pa-local-search input').first().evaluate(node=>({font:parseFloat(getComputedStyle(node).fontSize),height:node.getBoundingClientRect().height}));
  assert.ok(querySize.font>=20 && querySize.height>=querySize.font*1.4,'search grows with typography');
  await nav.click();await page.getByRole('option',{name:'Research results',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Research results',exact:true})).toBeVisible();
  await nav.click();await expect(page.getByRole('option',{name:'My collection',exact:true})).toBeVisible();
  await page.getByRole('option',{name:'Library (1)',exact:true}).click();
  const search=page.locator('.pa-local-search').getByRole('searchbox').first();
  await expect(search).toBeVisible();await search.fill('retained query');
  await page.evaluate(()=>window.postMessage({type:'pero:app:context',context:{locale:'en',dark:true,active:false}},'*'));
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  blockRefresh=true;
  await page.evaluate(()=>window.postMessage({type:'pero:app:context',context:{locale:'en',dark:true,active:true}},'*'));
  await expect.poll(()=>!!release).toBe(true);await expect(search).toHaveValue('retained query');release();
  await expect(search).toHaveValue('retained query');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await shot(page,'paper-compact-dark24');
});


test('Insights resumes the same paused generation without starting a duplicate Agent',async t=>{
  let starts=0,status='needs_input';
  const page=await pageFor(t,'insights',async({path,body})=>{
    if(path==='/host/insights')return json({sessions:[]});
    if(path==='/host/automation')return json({status:200,body:{updates:[]}});
    if(path==='/host/agent'){
      if(body.operation==='info')return json({available:true,agents:[{id:'fixture',available:true}],workspace:''});
      if(body.operation==='start'){starts++;return json({sessionId:'paused-fixture'});}
      if(body.operation==='events'){assert.equal(body.sessionId,'paused-fixture');return json({cursor:1,status,text:status==='completed'?JSON.stringify(fixtureBrief):''});}
    }
  });
  await page.goto(origin+'/insights/index.html');
  await expect(page.getByRole('alert')).toContainText('Generation paused');
  await page.getByRole('button',{name:'Open generation session',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.fixtureMessages.some(m=>m.operation==='open-session'&&m.input.sessionId==='paused-fixture'))).toBe(true);
  status='completed';await page.getByRole('button',{name:'Check generation',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Source change needs review'})).toBeVisible();
  assert.equal(starts,1);
});

for (const locale of ['en', 'zh']) test(`Insights explains missing credentials before showing feeds (${locale})`,async t=>{
  let starts=0;
  const page=await pageFor(t,'insights',async({path,body})=>{
    if(path==='/host/insights')return json({sessions:[]});
    if(path==='/host/automation')return json({status:200,body:{updates:[]}});
    if(path==='/host/agent'){
      if(body.operation==='info')return json({available:true,agents:[{id:'fixture',available:true}],workspace:''});
      if(body.operation==='start'){
        starts++;
        return starts===1?{status:400,value:'chat.credential_required'}:json({sessionId:'configured-fixture'});
      }
      if(body.operation==='events')return json({cursor:1,status:'completed',text:JSON.stringify(fixtureBrief)});
    }
  },{locale,size:locale==='zh'?24:14,dark:locale==='zh',width:locale==='zh'?420:1000});
  await page.goto(origin+'/insights/index.html');
  await expect(page.getByRole('heading',{name:locale==='zh'?'工作简报':'Work brief',exact:true})).toBeVisible();
  await expect(page.getByText(locale==='zh'?'请先配置 Agent 的 API Key':'Add an API key for your Agent',{exact:true})).toBeVisible();
  await expect(page.getByRole('status')).toContainText(locale==='zh'?'设置 → 模型与 Agent':'Settings → Models & Agents');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page.locator('.point-pulse-day')).toHaveCount(0);
  assert.equal(await page.locator('body').innerText().then(text=>text.includes('chat.credential_required')),false);
  const retry=page.getByRole('button',{name:locale==='zh'?'重试生成':'Retry generation',exact:true});
  await expect(retry).toHaveAttribute('data-variant','primary');
  const typography=await retry.evaluate(button=>({button:getComputedStyle(button).fontFamily,page:getComputedStyle(document.querySelector('.point-pulse-page')).fontFamily,size:parseFloat(getComputedStyle(button).fontSize)}));
  assert.equal(typography.button,typography.page,'primary action follows the same interface font');
  assert.equal(typography.size,locale==='zh'?24:14);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await shot(page,`insights-credentials-${locale}`);
  await retry.click();
  await expect(page.getByRole('heading',{name:'Source change needs review',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'A notable update',exact:true})).toBeVisible();
  await expect(page.getByText(locale==='zh'?'请先配置 Agent 的 API Key':'Add an API key for your Agent',{exact:true})).toHaveCount(0);
  assert.equal(starts,2);
});

test('Insights initial read failure offers one recovery path and secondary diagnostics',async t=>{
  let reads=0;
  const page=await pageFor(t,'insights',async({path,body})=>{
    if(path==='/host/insights')return ++reads===1?{status:503,value:'fixture.records_unavailable'}:json({sessions:[]});
    if(path==='/host/automation')return json({status:200,body:{updates:[]}});
    if(path==='/host/agent')return json(body.operation==='info'?{available:true,agents:[{id:'fixture',available:true}],workspace:''}:body.operation==='start'?{sessionId:'recovered-fixture'}:{cursor:1,status:'completed',text:'{"cards":[]}'});
  });
  await page.goto(origin+'/insights/index.html');
  await expect(page.getByRole('alert')).toHaveText('Work records could not be loaded. Please retry.');
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page.getByText('fixture.records_unavailable',{exact:true})).not.toBeVisible();
  await page.getByText('Technical details',{exact:true}).click();
  await expect(page.getByText('fixture.records_unavailable',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.getByText('No new personal work updates.',{exact:true})).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});


for (const appearance of [{ size:14, dark:false, width:1200 }, { size:24, dark:true, width:440 }]) test(`Connectors catalog stays readable and builtin actions only compose drafts (${appearance.size})`, async t=>{
  const title='Ansys Electronics Desktop engineering service';
  const page=await pageFor(t,'connectors',async({body})=>json(body.operation==='snapshot' ? {ok:true,directory:[{providerId:'fixture-engineering',displayName:title,category:'research',transport:'stdio',auth:{mode:'none'},requires:[],summary:'Inspect simulation projects and prepare engineering work.',listed:true,prerequisiteEn:'Requires local software and a valid license.'}],connections:[]} : {ok:true,result:[],records:[],running:[]}),appearance);
  await page.goto(origin+'/connectors/index.html');
  const heading=page.getByRole('heading',{name:title,exact:true});
  await expect(heading).toBeVisible();
  const metrics=await heading.evaluate(node=>({font:parseFloat(getComputedStyle(node).fontSize),wrapped:node.clientHeight>parseFloat(getComputedStyle(node).lineHeight),overflow:document.documentElement.scrollWidth>innerWidth}));
  assert.equal(metrics.font,appearance.size);assert.equal(metrics.overflow,false);
  if(appearance.size===24)assert.ok(metrics.wrapped);
  const navigation=page.getByRole('tablist',{name:'View',exact:true});
  const tabGeometry=await navigation.evaluate(node=>({border:getComputedStyle(node).borderBottomWidth,gap:parseFloat(getComputedStyle(node).columnGap),buttons:[...node.querySelectorAll('[role=tab]')].map(tab=>({top:getComputedStyle(tab).borderTopWidth,left:getComputedStyle(tab).borderLeftWidth,right:getComputedStyle(tab).borderRightWidth,bottom:getComputedStyle(tab).borderBottomWidth,color:getComputedStyle(tab).borderBottomColor,selected:tab.getAttribute('aria-selected'),radius:getComputedStyle(tab).borderRadius}))}));
  assert.equal(tabGeometry.border,'0px');assert.ok(tabGeometry.gap>=16);
  for(const tab of tabGeometry.buttons){assert.equal(tab.top,'0px');assert.equal(tab.left,'0px');assert.equal(tab.right,'0px');assert.equal(tab.bottom,'2px');assert.equal(tab.radius,'0px');assert.equal(tab.color==='rgba(0, 0, 0, 0)',tab.selected!=='true');}
  await page.getByRole('tab',{name:'Installed connections',exact:true}).click();
  assert.equal(await page.getByRole('tab',{name:'Installed connections',exact:true}).evaluate(node=>getComputedStyle(node).outlineStyle),'none', await page.getByRole('tab',{name:'Installed connections',exact:true}).evaluate(node=>node.outerHTML));
  await page.getByRole('tab',{name:'Service catalog',exact:true}).click();
  await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab',{name:'Installed connections',exact:true})).toHaveAttribute('aria-selected','true');
  assert.equal(await page.getByRole('tab',{name:'Installed connections',exact:true}).evaluate(node=>getComputedStyle(node).outlineStyle),'solid');
  await shot(page,`customize-selected-${appearance.dark?'dark':'light'}${appearance.size}`);
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab',{name:'Service catalog',exact:true})).toHaveAttribute('aria-selected','true');
  await page.getByRole('tab',{name:'Service catalog',exact:true}).click();
  await shot(page,`customize-${appearance.dark?'dark':'light'}${appearance.size}`);
  await page.getByRole('button',{name:'Computer Use',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Try it fills the composer without sending the message.');
  await page.getByRole('button',{name:'Try it',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const messages=await page.evaluate(()=>window.fixtureMessages);
  assert.equal(messages.filter(m=>m.type==='pero:app:chat').length,1);
  assert.match(messages.find(m=>m.type==='pero:app:chat').options.message,/Only inspect; do not click/);
});

for (const variant of [{size:14,width:1200},{size:24,width:600,dark:true}]) test(`Paper shared search focus and exclusive reader modes (${variant.size})`,async t=>{
  const paper={id:'controls-paper',title:'Saved control regression source',source:'local',sourceId:'controls',authors:[],url:'https://example.invalid/paper',contentKind:'abstract',content:'A saved reading passage.',fetchedAt:'2026-11-06',contentDigest:'controls-digest'};
  let searches=0;
  const page=await pageFor(t,'paper-agent',async()=>json({}),variant);
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/library/search'){searches++;return route.fulfill({json:{items:[],returned:0,queryTerms:[]}});}
    return route.fulfill({json:path==='/api/library'?{papers:[paper],intents:[],reports:[]}:path===`/api/papers/${paper.id}`?paper:path==='/api/pdf'?{document:null,annotations:[]}:path==='/api/paper-documents'?{revisions:[],sources:[]}:path.endsWith('/tex')?{sources:[],engineAvailable:false,sourceNavigationAvailable:false}:path==='/api/research/record'?{records:[]}:[]});
  });
  await page.goto(origin+'/paper-agent/index.html');
  const search=page.locator('.pa-local-search').getByRole('searchbox');
  await search.fill('harness');
  const focus=await search.evaluate(node=>({input:getComputedStyle(node).outlineWidth,offset:getComputedStyle(node).outlineOffset,parents:[node.parentElement,node.parentElement.parentElement].map(n=>getComputedStyle(n).outlineStyle==='none'?'0px':getComputedStyle(n).outlineWidth)}));
  assert.deepEqual(focus,{input:'1px',offset:'-1px',parents:['0px','0px']});
  await shot(page,`paper-search-shared-${variant.size}`);
  const clear=page.getByRole('button',{name:'Clear search',exact:true});
  await clear.focus();await clear.press('Enter');
  await expect(search).toHaveValue('');await expect(search).toBeFocused();assert.equal(searches,0,'Clear must not submit');
  await search.fill('harness');await search.press('Enter');
  await expect(page.getByText(/^No matching passages\./)).toBeVisible();assert.equal(searches,1);
  await page.getByRole('button',{name:'Clear search',exact:true}).click();
  await page.locator('.pero-list-open').filter({hasText:paper.title}).dblclick();
  const modes=page.locator('.pa-reader-modes');
  const text=modes.getByRole('radio',{name:'Read',exact:true}), tex=modes.getByRole('radio',{name:'TeX',exact:true});
  await expect(text).toHaveAttribute('aria-checked','true');
  await expect(modes.getByRole('radio',{name:'PDF',exact:true})).toBeDisabled();
  await text.focus();await text.press('ArrowRight');await expect(tex).toBeFocused();await tex.press('Space');
  await expect(page.locator('[data-reader-view]')).toHaveAttribute('data-reader-view','tex');
  await expect(page.getByText('No TeX source has been downloaded for this paper.',{exact:true})).toBeVisible();
  await tex.press('ArrowLeft');await expect(text).toBeFocused();await text.press('Space');
  await expect(page.locator('[data-reader-view]')).toHaveAttribute('data-reader-view','text');
  await text.click();await expect(text).toHaveAttribute('aria-checked','true');
  assert.equal(await text.evaluate(n=>getComputedStyle(n).outlineStyle),'none','pointer selection has no keyboard ring');
  await text.press('ArrowRight');await expect(tex).toBeFocused();
  assert.deepEqual(await tex.evaluate(n=>[getComputedStyle(n).outlineStyle,getComputedStyle(n).outlineOffset]),['solid','-2px'],'keyboard ring stays inside the toolbar');
  await text.click();
  assert.equal(await modes.locator('[aria-checked=true]').count(),1,'one representation remains selected');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await shot(page,`paper-reader-shared-${variant.size}`);
});

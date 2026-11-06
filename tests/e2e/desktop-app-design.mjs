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
  {kind:'change',title:'A notable update',conclusion:'Available in the popular feed.'},
]};

test('Insights distinguishes loading, opens evidence, supports keyboard tabs and retains a brief across failed regeneration',async t=>{
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
  await page.getByRole('button',{name:'Review session',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.fixtureMessages.filter(m=>m.operation==='open-session').length)).toBe(1);
  assert.deepEqual(await page.evaluate(()=>window.fixtureMessages.find(m=>m.operation==='open-session').input),{sessionId:'fixture-session'});
  await expect(page.getByRole('link',{name:'Original source',exact:true})).toHaveAttribute('href','https://example.org/evidence');
  await expect(page.getByRole('link',{name:'Unsafe source',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Prepare review draft',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.fixtureMessages.some(m=>m.type==='pero:app:chat'))).toBe(true);
  assert.deepEqual(await page.evaluate(()=>window.fixtureMessages.find(m=>m.type==='pero:app:chat').options),{message:'Review the existing result before continuing.'});
  const first=page.getByRole('tab',{name:'For me',exact:true});await first.focus();await first.press('ArrowRight');
  await expect(page.getByRole('tab',{name:'Popular',exact:true})).toBeFocused();
  await expect(page.getByRole('tab',{name:'Popular',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby',await page.getByRole('tab',{name:'Popular',exact:true}).getAttribute('id'));
  await first.click();
  const generated=await page.locator('.point-pulse-generated').innerText();
  await page.getByRole('button',{name:'Regenerate',exact:true}).click();
  await expect(page.getByRole('button',{name:'Updating…',exact:true})).toBeDisabled();
  await expect(page.getByRole('heading',{name:'Source change needs review'})).toBeVisible();
  assert.equal(starts,2);await expect.poll(()=>!!regeneration).toBe(true);regeneration();
  await expect(page.getByRole('alert')).toContainText('previous brief remains');
  await expect(page.getByRole('heading',{name:'Source change needs review'})).toBeVisible();
  assert.equal(await page.locator('.point-pulse-generated').innerText(),generated);
  const edges=await page.evaluate(()=>{const a=document.querySelector('.point-pulse-top').getBoundingClientRect(),b=document.querySelector('.point-research-updates').getBoundingClientRect();return {a:a.left,b:b.left};});
  assert.equal(edges.a,edges.b);
  await shot(page,'insights-retained-dark24');
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
  await expect(page.getByRole('button',{name:'Generate brief',exact:true})).toBeDisabled();
  available=true;await page.reload();
  await expect(page.getByText('No new personal work updates.',{exact:true})).toBeVisible();
  await expect(page.getByText('No Agent is connected. Connect an Agent to generate a brief.')).not.toBeVisible();
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page.locator('.point-pulse-day')).toHaveCount(0);
  await expect(page.locator('.point-pulse-generated')).toBeVisible();
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
  await expect(page.getByText('Requires: Requires organization access',{exact:true})).toBeVisible();
  await page.getByRole('radio',{name:'Installed connections',exact:true}).click();
  await expect(page.getByRole('radio',{name:'Installed connections',exact:true})).toHaveAttribute('aria-checked','true');
  await expect(page.getByRole('radio',{name:'Service catalog',exact:true})).toBeVisible();
  await page.getByRole('radio',{name:'Service catalog',exact:true}).click();
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(page.getByRole('button',{name:'Refresh',exact:true})).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('Refreshing');
  await expect(page.getByText('Requires: Requires organization access',{exact:true})).toBeVisible();
  assert.equal(snapshots,2);await expect.poll(()=>!!release).toBe(true);release();
  await expect(page.getByRole('alert')).toContainText('Connection management is unavailable');
  await expect(page.getByText('Requires: Requires organization access',{exact:true})).toBeVisible();
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
  await expect(page.getByRole('tablist')).toBeVisible();
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

// Real Host-owned Data and Paper backends, real App UI; no model/provider.
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {EventEmitter, once} from 'node:events';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve, extname} from 'node:path';
import {createInterface} from 'node:readline';
import {chromium, expect} from '@playwright/test';

const root = resolve(import.meta.dirname, '../..');
const binary = process.env.PERO_HOST_PATH || resolve(root, 'test-results/data-semantic-product/bin/pero-host');
const python = process.env.PERO_TEST_PYTHON || '/Users/phodal/.pero/environment/pero-python312/bin/python';
const pythonEnvironment = resolve(python, '../..');
const output = resolve(root, 'test-results/data-semantic-product');
await mkdir(output, {recursive:true});
const directory = await mkdtemp(resolve(output, 'run-'));
const json = (path, data) => writeFile(path, JSON.stringify(data, null, 2) + '\n');
const sha = content => createHash('sha256').update(content).digest('hex');
const pending = new Map(), events = new EventEmitter(), accesses = [], servers = [];
let host, browser, stderr = '', stopped, sequence = 0;
const identity = {source:execFileSync('git', ['rev-parse','HEAD'], {cwd:root,encoding:'utf8'}).trim(),
  patchSHA256:sha(execFileSync('git',['diff','HEAD'],{cwd:root})), hostSHA256:sha(await readFile(binary)), mode:'real-host-browser-no-model'};
await json(resolve(directory,'settings.json'), {app_python:{default:pythonEnvironment}});
function rpc(action, fields = {}) {
  const id = `query-${++sequence}`;
  return new Promise((accept,reject) => {
    const timer = setTimeout(() => {pending.delete(id); reject(Error(`Host ${action} timed out: ${stderr}`));},60000);
    pending.set(id,value=>{clearTimeout(timer);pending.delete(id);value.ok?accept(value.value):reject(Error(value.error));});
    host.stdin.write(JSON.stringify({method:'apps',id,action,...fields})+'\n');
  });
}
async function start() {
  const ready = once(events,'ready');
  const env = Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('PERO_')&&!/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(k)));
  host=spawn(binary,['--stdio'],{cwd:directory,env:{...env,PERO_APPS_ROOT:resolve(directory,'apps'),PERO_BUILTIN_APPS_ROOT:'',PERO_REQUIRED_APPS:'',
    PERO_AGENTS_FILE:resolve(directory,'no-agents.json'),PERO_SETTINGS_PATH:resolve(directory,'settings.json'),PERO_HISTORY_PATH:resolve(directory,'history.jsonl'),PERO_ENV_FILE:resolve(directory,'no-env'),UV_OFFLINE:'1'},stdio:['pipe','pipe','pipe']});
  stopped=once(host,'exit'); host.stderr.on('data',data=>stderr+=data);
  createInterface({input:host.stdout}).on('line',line=>{const event=JSON.parse(line);if(event.kind==='ready')events.emit('ready');if(event.kind==='apps_result')pending.get(event.request_id)?.(event.data);});
  await Promise.race([ready,stopped.then(()=>{throw Error(`Host exited: ${stderr}`);})]);
}
async function stop() {
  if (!host || host.exitCode!==null) return;
  host.stdin.end(); const timer=setTimeout(()=>host.kill('SIGTERM'),10000);
  try {await stopped;} finally {clearTimeout(timer);}
}
async function backend(name,path,method='GET',body,contentType='application/json') {
  await rpc('apiaccess',{name,path});
  const app=await rpc('resolve',{name});
  return fetch(app.backend.url+path,{method,headers:{'Content-Type':contentType,'X-Pero-App-Token':app.backend.token},...(body===undefined?{}:{body})});
}
async function api(name,path,value) {
  const response=await backend(name,path,value===undefined?'GET':'POST',value===undefined?undefined:JSON.stringify(value));
  assert(response.ok,`${path}: ${await response.clone().text()}`); return response.json();
}
async function surface(name) {
  const server=createServer(async(req,res)=>{
    try {
      let body=Buffer.alloc(0);for await(const chunk of req)body=Buffer.concat([body,chunk]);
      if(req.url.startsWith('/api/')) {
        accesses.push({name,path:req.url,method:req.method,...(req.url==='/api/evidence'?{body:JSON.parse(body)}:{})});
        const response=await backend(name,req.url,req.method,body.length?body:undefined,req.headers['content-type']||'application/json');
        res.writeHead(response.status,{'Content-Type':response.headers.get('content-type')||'application/octet-stream'});res.end(Buffer.from(await response.arrayBuffer()));return;
      }
      if(req.url==='/host/research-assets') {const result=await rpc('research-assets',{name,request:JSON.parse(body)});res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));return;}
      if(req.url==='/host/sdk') {res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(await rpc('sdkcontext',{name})));return;}
      const path=req.url==='/'?'index.html':decodeURIComponent(req.url.slice(1).split('?')[0]);
      if(path.includes('..'))throw Error('Invalid path');
      const bytes=await readFile(resolve(root,'apps',name,'dist',path));
      res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml'})[extname(path)]||'application/octet-stream'});res.end(bytes);
    } catch(error) {res.writeHead(500);res.end(String(error));}
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));servers.push(server);
  return `http://127.0.0.1:${server.address().port}/`;
}
const checks=[];
try {
  await start();
  for (const name of ['data','paper-agent']) {await rpc('install',{path:resolve(root,'apps',name)});await rpc('enable',{name});}
  browser=await chromium.launch({headless:true,...(process.env.PERO_CHROMIUM_EXECUTABLE?{executablePath:process.env.PERO_CHROMIUM_EXECUTABLE}:{})});
  const page=await browser.newPage({viewport:{width:1280,height:950}}), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const dataURL=await surface('data'),paperURL=await surface('paper-agent');
  await page.goto(dataURL);
  await page.getByRole('button',{name:'Add data',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.locator('input[type=file]').setInputFiles({name:'synthetic-measures.csv',mimeType:'text/csv',buffer:Buffer.from('measure,label\n1,A\n3,B\n5,C\n')});
  await dialog.getByRole('button',{name:'Import',exact:true}).click();await expect(dialog).toBeHidden();
  await page.getByRole('tab',{name:'Queries',exact:true}).click();
  await page.getByLabel('Question',{exact:true}).fill('Synthetic mean measurement');
  await page.getByLabel('SQL',{exact:true}).fill('SELECT AVG(measure) AS value FROM sample');
  await page.getByRole('checkbox',{name:'measure as number',exact:true}).check();
  await page.getByLabel('Unit',{exact:true}).fill('cm');
  await page.getByLabel('Denominator',{exact:true}).fill('All three non-null measurements');
  async function choose(label,value) {await page.getByRole('button',{name:label,exact:true}).click();await page.getByRole('option',{name:value,exact:true}).click();}
  await choose('Independent check','Whole-table mean');await choose('Check column','measure');
  await page.getByLabel('Reviewer',{exact:true}).fill('Local synthetic fixture reviewer');
  await page.getByRole('checkbox',{name:'I reviewed SQL, units, denominator, joins and missing values.'}).check();
  await page.getByRole('button',{name:'Save definition and run',exact:true}).click();
  await expect(page.getByRole('region',{name:'Query result'}).getByRole('cell',{name:'3',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Recompute from source',exact:true}).click();
  await expect(page.getByText('matched: expected 3, observed 3. Scientific review remains required.',{exact:true})).toBeVisible();
  await page.screenshot({path:resolve(directory,'data-query-light.png'),fullPage:true});
  const saved=(await api('data','/api/queries',{operation:'list'})).queries[0];
  const receipt=await api('data','/api/queries',{operation:'read',queryId:saved.id});
  checks.push('real UI import -> fixed snapshot -> reviewed definition -> authorized read-only query -> independent source recompute');
  const pdf=execFileSync(python,['-c',"from test_pdf import pdf_fixture; import sys; sys.stdout.buffer.write(pdf_fixture(phrase='Synthetic mean needs review.'))"],
    {cwd:root,env:{...process.env,PYTHONPATH:'apps/paper-agent/test:apps/paper-agent/backend:packages/source-extraction/python'}});
  const imported=await backend('paper-agent','/api/pdf/import?filename=synthetic-evidence.pdf','POST',pdf,'application/pdf');assert(imported.ok,await imported.clone().text());
  const paper=await imported.json();
  const intent=await api('paper-agent','/api/intents',{question:'Synthetic mean needs review',paperIds:[paper.id],requestId:randomUUID(),verifyCode:false,fullText:true});
  const passage=intent.passages[0];
  const report=await api('paper-agent','/api/reports',{intentId:intent.id,text:JSON.stringify({schema:'pero.paper-agent-report.v1',intentId:intent.id,title:'Synthetic source observation',
    sections:[{heading:'Observation',content:'Only a synthetic check is established.',paperIds:[paper.id],evidence:[{paperId:paper.id,passageId:passage.id,quote:'Synthetic mean needs review.'}]}],experiments:[],limitations:'Not a scientific result.'})});
  await page.goto(paperURL);
  await page.getByRole('button',{name:/Research results/}).click();
  const panel=page.getByRole('region',{name:'Data query evidence'});
  await panel.getByRole('button',{name:'Link a saved query',exact:true}).click();
  await choose('Data query',`Synthetic mean measurement · ${saved.startedAt}`);
  await choose('Claim report',report.title);await choose('Exact quotation','Synthetic mean needs review.');
  await page.getByLabel('Claim and limitations').fill('The synthetic mean is 3 cm; no scientific acceptance is implied.');
  await panel.getByRole('button',{name:'Save evidence reference',exact:true}).click();
  await expect(panel.getByText('The synthetic mean is 3 cm; no scientific acceptance is implied.',{exact:true})).toBeVisible();
  await panel.getByRole('button',{name:'Read saved Data result',exact:true}).click();
  await expect(panel.getByText('Denominator: All three non-null measurements',{exact:true})).toBeVisible();
  await page.screenshot({path:resolve(directory,'paper-query-light.png'),fullPage:true});
  const links=(await api('paper-agent','/api/data-evidence',{operation:'list'})).links;
  assert.equal(links[0].source.fileDigest,sha(pdf));assert.equal(links[0].queryId,saved.id);assert.equal(links[0].acceptance,'needs_review');
  await panel.getByRole('button',{name:'Read cited source',exact:true}).click();
  await expect.poll(()=>accesses.filter(r=>r.path==='/api/evidence').length).toBe(1);
  assert.equal(accesses.find(r=>r.path==='/api/evidence').body.passageId,passage.id);
  await expect(page.getByRole('spinbutton',{name:'Page',exact:true})).toHaveValue(String(passage.page));
  await expect(page.locator('[data-citation-region][data-focused="true"]')).not.toHaveCount(0);
  await page.screenshot({path:resolve(directory,'paper-exact-citation.png'),fullPage:true});
  checks.push('real Host research-assets grant -> Data-owned receipt -> exact Paper claim and frozen original PDF hash -> exact citation navigation');
  const dataBackend=(await rpc('resolve',{name:'data'})).backend;
  const forged=await fetch(dataBackend.url+'/api/queries',{method:'POST',headers:{'Content-Type':'application/json','X-Auto-Ontology-User-Id':'administrator','X-Pero-App-Token':'forged'},body:JSON.stringify({operation:'list'})});
  assert.equal(forged.status,401);
  const privateRead=await fetch(dataBackend.url+'/internal/research-query',{method:'POST',headers:{'Content-Type':'application/json','X-Pero-App-Token':dataBackend.token},body:JSON.stringify({operation:'list'})});
  assert.equal(privateRead.status,403);
  await assert.rejects(rpc('apiaccess',{name:'data',path:'/internal/research-query'}));
  await assert.rejects(rpc('research-assets',{name:'data',request:{operation:'queries'}}));
  await assert.rejects(rpc('research-assets',{name:'paper-agent',request:{operation:'linkquery',queryId:saved.id,claim:{},query:{rows:[99]}}}));
  const publicBind=await backend('paper-agent','/api/data-evidence','POST',JSON.stringify({operation:'bind',claim:links[0].claim,query:receipt}));
  assert.equal(publicBind.status,403);
  await rpc('disable',{name:'data'});
  await assert.rejects(rpc('research-assets',{name:'paper-agent',request:{operation:'queries'}}));
  await rpc('enable',{name:'data'});
  checks.push('forged actor/token, direct private route, other App caller, browser-supplied receipt and disabled Data are denied');
  const state=await api('data','/api/state');
  await api('data','/api/import',{name:'synthetic-measures-v2.csv',kind:'dataset',datasetId:state.datasets[0].id,
    content:Buffer.from('measure,label\n2,A\n4,B\n6,C\n').toString('base64'),source:'Synthetic version update'});
  await api('data','/api/queries',{operation:'definition',definition:{...receipt.definition,unit:'mm',sql:'SELECT AVG(measure)*10 AS value FROM sample'}});
  assert.equal((await api('data','/api/queries',{operation:'read',queryId:saved.id})).definition.unit,'cm');
  checks.push('new data version and reviewed mm definition preserve the old cm receipt and frozen original projection');
  await stop();await start();
  const reopened=await api('data','/api/queries',{operation:'read',queryId:saved.id});assert.deepEqual(reopened,receipt);
  assert.deepEqual((await api('paper-agent','/api/data-evidence',{operation:'list'})).links,links);
  await page.goto(dataURL);await page.getByRole('tab',{name:'Queries',exact:true}).click();
  await page.getByRole('button',{name:`Synthetic mean measurement · ${saved.startedAt}`,exact:true}).click();
  await expect(page.getByRole('region',{name:'Query result'}).getByRole('cell',{name:'3',exact:true})).toBeVisible();
  checks.push('Host restart -> unchanged saved Paper reference and Data receipt -> real history UI without query execution');
  await page.evaluate(() => window.postMessage({type:'pero:app:context',context:{locale:'en',dark:true,active:true}},'*'));
  await expect(page.locator('html')).toHaveAttribute('data-theme','pero-dark');
  await page.setViewportSize({width:760,height:900});
  await page.getByRole('region',{name:'Saved query result'}).scrollIntoViewIfNeeded();
  await page.screenshot({path:resolve(directory,'data-history-narrow-dark.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  await json(resolve(directory,'verification.json'),{...identity,checks,queryId:saved.id,linkId:links[0].id,modelRun:false,scientificAcceptance:'needs_review',renderer:'Chromium; Host real; UI loopback proxy test seam',errors});
  console.log(JSON.stringify({directory,checks:checks.length,queryId:saved.id}));
} catch(error) {
  if(browser)for(const context of browser.contexts())for(const page of context.pages())await page.screenshot({path:resolve(directory,'failure.png'),fullPage:true}).catch(()=>{});
  await json(resolve(directory,'failure.json'),{...identity,error:String(error),checks,stderr});throw error;
} finally {
  await browser?.close();for(const server of servers){server.closeAllConnections();await new Promise(done=>server.close(done));}await stop();
}

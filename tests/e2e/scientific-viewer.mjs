// Original Point package, real Pero Host/Electron, actual PDF/RDKit/Mol* assets.
// Public literature snapshots and model output are explicitly synthetic fixtures.
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { spawn,execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createHash,randomUUID } from 'node:crypto';
import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { electron } from './electron.mjs';
import { clickAppOpen,setAppearance } from './sidebar-controls.mjs';
import { buildPointRuntime } from '../../scripts/build/point-app.mjs';
const root=resolve(import.meta.dirname,'../..');
if(!process.env.POINT_ROOT)throw new Error('Set POINT_ROOT to the built Scientific Viewer source checkout');
const point=resolve(process.env.POINT_ROOT),out=resolve(root,'test-results/scientific-viewer');
const temp=await mkdtemp(resolve(tmpdir(),'pero-scientific-')),profile=resolve(temp,'profile');
await mkdir(out,{recursive:true});await mkdir(profile);
const checks=[],examples=[],errors=[],httpErrors=[];
const env={...process.env,PERO_DESKTOP_DATA_DIR:profile,PERO_APPS_ROOT:resolve(profile,'apps'),PERO_SETTINGS_PATH:resolve(profile,'settings.json'),PERO_HISTORY_PATH:resolve(profile,'history.jsonl'),PERO_POINT_RUNTIME_ROOT:resolve(root,'packages/point-app/dist'),PERO_HOST_EXECUTABLE:process.env.PERO_HOST_EXECUTABLE??resolve(root,'target/point-apps/debug/pero-host'),PERO_BUILTIN_APPS:'no-builtins',PERO_REQUIRED_APPS:'no-builtins',PERO_LOCALE:'en'};
delete env.POINT_ROOT;
const registry=resolve(temp,'agents.json');await writeFile(registry,JSON.stringify([{id:'fixture',name:'Synthetic compatibility fixture',command:process.execPath,args:[resolve(root,'tests/fixtures/scientific-agent.mjs')]}]));env.PERO_AGENTS_FILE=registry;
const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
let app,host,ended;
try{
 await buildPointRuntime({pointRoot:point,destination:env.PERO_POINT_RUNTIME_ROOT});
 host=spawn(env.PERO_HOST_EXECUTABLE,['--stdio'],{cwd:root,env:{...env,PERO_BUILTIN_APPS_ROOT:''},stdio:['pipe','pipe','inherit']});ended=new Promise(done=>host.once('exit',done));
 const pending=new Map();createInterface({input:host.stdout}).on('line',line=>{const event=JSON.parse(line);if(event.kind==='apps_result')pending.get(event.request_id)?.(event.data);});
 const call=(action,fields={})=>new Promise((done,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(new Error('Host timeout '+action));},20000);pending.set(id,value=>{pending.delete(id);clearTimeout(timer);value.ok?done(value.value):reject(new Error(value.error));});host.stdin.write(JSON.stringify({method:'apps',id,action,...fields})+'\n');});
 for(const name of ['scientific-viewer','welcome']){await call('install',{path:name==='scientific-viewer'&&process.env.SCIENTIFIC_APP_ROOT?resolve(process.env.SCIENTIFIC_APP_ROOT):resolve(point,'apps',name)});await call('enable',{name});}
 const installed=resolve(profile,'apps/scientific-viewer');
 assert.deepEqual(await readFile(resolve(installed,'dist/point-ui/dist/index.mjs')),await readFile(resolve(point,'apps/scientific-viewer/ui/dist/index.mjs')));
 const receipt=JSON.parse(await readFile(resolve(installed,'point-build.json')));
 const manifest=JSON.parse(await readFile(resolve(point,'apps/scientific-viewer/app.json')));
 host.stdin.end();await ended;host=undefined;
 // Seed only named public-service fixture snapshots through the original domain
 // API. Every PDF, evidence, review and Agent operation below uses the real App.
 const {LiteratureStore}=await import(pathToFileURL(resolve(point,'apps/scientific-viewer/backend-src/literature-store.mjs')));
 const {digest}=await import(pathToFileURL(resolve(point,'apps/scientific-viewer/backend-src/science-publisher.mjs')));
 const store=new LiteratureStore(resolve(profile,'app-data/scientific-viewer'));
 const hit={source:'alphaxiv',id:'1706.03762',title:'Synthetic compatibility reading',abstract:'Named integration fixture',url:'https://www.alphaxiv.org/abs/1706.03762',alternatives:[]};
 const search=await store.saveSearch({schema:'point.literature-search.v1',query:{query:'synthetic compatibility fixture'},items:[hit],fetchedAt:'2026-10-31T00:00:00Z',errors:[],status:'complete'});
 const content='# Synthetic compatibility reading\n\nEvidence fixture. $x^2$';
 await store.saveReading({schema:'point.literature-reading.v1',source:hit.source,id:hit.id,title:hit.title,url:hit.url,content,contentKind:'full-text',contentDigest:digest(content),fetchedAt:'2026-10-31T00:00:00Z'},search.items[0].recordId);
 const artifacts={host:await hash(env.PERO_HOST_EXECUTABLE),desktop:await hash(resolve(root,'desktop/dist/main.cjs')),runtime:receipt.runtime,appSource:receipt.files};
 const launch=()=>electron.launch({args:[...(process.platform==='darwin'?['--use-mock-keychain']:[]),resolve(root,'desktop')],cwd:root,env});
 app=await launch();let page=await app.firstWindow();
 page.on('pageerror',error=>{errors.push(error.message);console.error('Page error:',error.message);});page.on('console',message=>{if(message.type()==='error')console.error('Renderer:',message.text());});page.on('response',response=>{if(response.status()>=400)httpErrors.push({status:response.status(),url:response.url()});});
 await page.waitForFunction(()=>window.peroDiagnostics&&!document.getElementById('loading'),undefined,{timeout:60000});
 const open=async name=>{
  const catalog=await page.evaluate(()=>JSON.parse(window.peroDiagnostics.snapshot()).sidebarButtonBounds?.apps);
  if(catalog)await page.mouse.click(catalog.x+catalog.width/2,catalog.y+catalog.height/2);else await page.mouse.click(80,await page.evaluate(()=>innerHeight-76));
  await expect.poll(()=>page.evaluate(()=>JSON.parse(window.peroDiagnostics.snapshot()).navigation)).toBe(7);
  await clickAppOpen(page,name);const frame=page.frameLocator(`iframe[title="${name}"]`);await expect(frame.locator('#app')).not.toBeEmpty();return frame;
 };
 let frame=await open('scientific-viewer');
 const api=(path,body,method)=>frame.locator('body').evaluate(async(_element,{path,body,method})=>{const response=await fetch(path,{method:method??(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const text=await response.text();if(!response.ok)throw new Error(`${response.status} ${text}`);return JSON.parse(text);},{path,body,method});
 const exampleMenu=async index=>{
  let bounds;await expect.poll(async()=>{bounds=await page.evaluate(()=>JSON.parse(window.peroDiagnostics.snapshot()).appExamplesBounds?.['scientific-viewer:viewer']?.examples);return !!bounds&&bounds.width>0;}).toBe(true);
  await page.mouse.click(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
  for(let item=0;item<=index;item++)await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
 };
 const select=async(label,name)=>{
  if(label==='Example'){const index=manifest.contributes.examples.findIndex(entry=>(entry.localizations?.en?.title??entry.title)===name);assert.ok(index>=0);await exampleMenu(index);return;}
  await frame.getByRole('button',{name:label,exact:true}).click();await frame.getByRole('option',{name,exact:true}).click();
 };
 const semantic=()=>page.evaluate(()=>new Promise((done,reject)=>{
  const frame=document.querySelector('iframe[title="scientific-viewer"]'),id=crypto.randomUUID();
  const receive=event=>{if(event.source!==frame.contentWindow||event.data?.type!=='pero:app-use:result'||event.data.id!==id)return;clearTimeout(timer);window.removeEventListener('message',receive);event.data.ok?done(event.data.value.objects[0].state):reject(new Error(JSON.stringify(event.data)));};
  const timer=setTimeout(()=>{window.removeEventListener('message',receive);reject(new Error('App Use timeout'));},5000);window.addEventListener('message',receive);frame.contentWindow.postMessage({type:'pero:app-use:request',id,request:{action:'semantic',target:'scientific-view'}},'*');
 }));
 await expect(frame.getByRole('button',{name:'Import file',exact:true})).toBeVisible();
 await frame.getByRole('button',{name:'Curves',exact:true}).click();
 await expect.poll(()=>frame.locator('.sv-table-wrap tbody tr').count(),{timeout:30000}).toBe(50);
 const selectedExamples=process.env.SCIENTIFIC_VISUAL_ONLY==='1'?manifest.contributes.examples.filter(entry=>['mauna-loa','1stp'].includes(entry.id)):manifest.contributes.examples;
 for(const example of selectedExamples){
  if(!example.default)await select('Example',example.localizations?.en?.title??example.title);
  if(example.id==='electrolyte-solvents'){await expect(frame.getByRole('button',{name:'Molecules',exact:true})).toBeVisible();await frame.getByRole('button',{name:'Molecules',exact:true}).click();}
  const document=JSON.parse(await readFile(resolve(point,'apps/scientific-viewer/ui',example.entry),'utf8'));
  await expect.poll(async()=>{const state=await semantic();return state.file?.name===document.files[0].name&&state.assetId===state.file.id&&state.status!=='loading';},{timeout:45000}).toBe(true);
  const state=await semantic();assert.equal(state.status,'ready',JSON.stringify(state));
  if(example.id==='spectrum-broken'){assert.equal(state.check,'failed');await expect(frame.locator('.sv-spec-issues [data-severity="error"]').first()).toBeVisible();}
  if(example.id==='1crn'){await expect(frame.locator('.sv-molecule[data-status="ready"] canvas')).toBeVisible();await page.screenshot({path:resolve(out,'protein.png')});}
  if(example.id==='electrolyte-solvents'){await expect(frame.locator('tr[data-status="invalid"]').first()).toBeVisible();await page.screenshot({path:resolve(out,'molecules.png')});}
  examples.push({id:example.id,state});
 }
 checks.push('All twelve integrity-checked examples: CSV, Mol* structures, RDKit molecule checks, IR/XRD/UV spectra; defective spectrum stays failed');
 await select('Example','Streptavidin–biotin · 1STP');
 await expect.poll(async()=>{const state=await semantic();return state.file?.name==='1STP.pdb'&&state.status==='ready';},{timeout:30000}).toBe(true);
 await app.evaluate(({Menu,BrowserWindow})=>{Menu.getApplicationMenu().getMenuItemById('locale-zh-CN').click();BrowserWindow.getAllWindows()[0].setSize(1400,940);});
 await expect(frame.getByRole('button',{name:'重置视图',exact:true})).toBeVisible();
 await expect.poll(()=>frame.locator('.sv-molecule canvas').evaluate(canvas=>canvas.getBoundingClientRect().height)).toBeGreaterThan(600);
 await frame.getByRole('button',{name:'重置视图',exact:true}).click();
 await page.screenshot({path:resolve(out,'1stp-zh.png')});
 if(process.env.SCIENTIFIC_VISUAL_ONLY==='1'){await writeFile(resolve(out,'visual.json'),JSON.stringify({examples,errors,artifacts},null,2));console.log('Scientific Viewer visual comparison: 1STP, zh, 1400x940, native titlebar examples and full-height Mol* canvas.');process.exitCode=0;}
 else {
 await app.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('locale-en').click());
 
 const input=frame.locator('.sv-toolbar input[type=file]');
 await input.setInputFiles({name:'compatibility.csv',mimeType:'text/csv',buffer:Buffer.from('time[s],voltage[V]\n0,4.2\n1,\n2,3.9\n3,3.8')});
 await expect.poll(async()=>{const state=await semantic();return state.file?.name==='compatibility.csv'&&state.assetId===state.file.id;}).toBe(true);
 if(await frame.getByRole('button',{name:'Curves',exact:true}).isVisible())await frame.getByRole('button',{name:'Curves',exact:true}).click();
 await expect(frame.getByText('Missing values 1; missing X 0',{exact:true})).toBeVisible();
 const selected=await semantic();await open('welcome');frame=await open('scientific-viewer');assert.equal((await semantic()).file.id,selected.file.id);
 checks.push('Original CSV import and gap semantics; App state retained across panel switches');
 await frame.getByRole('button',{name:'Literature search and reading',exact:true}).click();
 await frame.locator('.sv-lit > details > summary').first().click();
 await frame.getByRole('button',{name:'Saved readings',exact:true}).click();await frame.getByRole('option').first().click();
 await expect(frame.getByRole('heading',{name:hit.title,exact:true,level:3})).toBeVisible();
 // These absolute original UI paths must resolve inside this installed App.
 assert.equal(await frame.locator('body').evaluate(async()=> (await fetch('/apps/scientific-viewer/ui/pdfjs/pdf.worker.min.mjs')).status),200);
 const {pdfFixture}=await import(pathToFileURL(resolve(point,'apps/scientific-viewer/test/pdf-fixture.mjs')));
 await frame.locator('.sv-lit input[type=file]').setInputFiles({name:'synthetic-original.pdf',mimeType:'application/pdf',buffer:pdfFixture()});
  await expect.poll(()=>frame.locator('.sv-literature-pdf canvas').evaluate(canvas=>canvas.width),{timeout:30000}).toBe(300);
 await frame.getByLabel('Original quotation',{exact:false}).fill('invented quotation');
 await frame.getByRole('button',{name:'Save and check quotation',exact:true}).click();await expect(frame.getByRole('alert').filter({hasText:'Quotation is not present'})).toBeVisible();
 await frame.getByLabel('Original quotation',{exact:false}).fill('Evidence fixture.');await frame.getByRole('button',{name:'Save and check quotation',exact:true}).click();
 await expect(frame.getByText('Matched against PDF page text',{exact:false})).toBeVisible();
 await frame.getByText('Figure region coordinates',{exact:true}).click();
 await frame.getByLabel('W',{exact:true}).fill('0.8');await frame.getByLabel('H',{exact:true}).fill('0.8');
 await frame.getByRole('button',{name:'Save original figure',exact:true}).click();await expect(frame.locator('.sv-lit-evidence img')).toBeVisible();
 const library=await api('/apps/scientific-viewer/api/literature/library');assert.equal(library.evidence.length,2);assert.ok(library.evidence.every(item=>item.verification==='unverified'));
 checks.push('Real PDF worker/text/figure engine; invented quote rejected, original quote and PNG crop source-bound and unverified');
 await frame.getByRole('checkbox',{name:/Saved evidence/}).first().check();
 await frame.getByLabel('Review question',{exact:true}).fill('Synthetic compatibility fixture: preserve the supplied quotation and its evidence ID.');
 await select('Agent','Synthetic compatibility fixture');
 await frame.getByRole('button',{name:'Generate review with Agent',exact:true}).click();
 await expect(frame.getByRole('status').filter({hasText:'Generation completed'})).toBeVisible({timeout:30000});
 await frame.getByRole('button',{name:'Save review',exact:true}).click();
 await expect(frame.getByText('Not reviewed',{exact:false}).first()).toBeVisible();
 const saved=await api('/apps/scientific-viewer/api/literature/library');assert.equal(saved.reviews.length,1);assert.equal(saved.reviews[0].acceptance,'not-reviewed');assert.equal(saved.reviews[0].executionVerification,'client-reported-host-ledger');
 await frame.getByRole('button',{name:'Open Agent session',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>{const state=JSON.parse(window.peroDiagnostics.snapshot());return state.chats?.[state.activeChat]?.id;})).toBe(saved.runs[0].sessionId);
 await frame.locator('.sv-lit-review').scrollIntoViewIfNeeded();await page.screenshot({path:resolve(out,'review.png')});
 const download=page.waitForEvent('download');await frame.getByRole('button',{name:'Export review evidence bundle',exact:true}).click();const zip=await download;await zip.saveAs(resolve(out,'review.zip'));
 const require=createRequire(resolve(point,'apps/scientific-viewer/package.json'));const {unzipSync}=require('fflate');const files=unzipSync(await readFile(resolve(out,'review.zip')));assert.ok(files['review.md']);assert.ok(files['host-run.json']);assert.ok(Object.keys(files).some(name=>name.endsWith('.pdf')));assert.ok(Object.keys(files).some(name=>name.endsWith('.png')));
 checks.push('Original SDK Agent start/events, structured review save, exact Session selection and ZIP evidence export; synthetic ACP provider, no model credential in App');
 await setAppearance(page,'dark');await expect.poll(()=>frame.locator('html').getAttribute('data-theme')).toBe('point-dark');
 await app.evaluate(({Menu,BrowserWindow})=>{Menu.getApplicationMenu().getMenuItemById('locale-zh-CN').click();BrowserWindow.getAllWindows()[0].setSize(1000,788);});
 await expect(frame.getByRole('button',{name:'导入文件',exact:true})).toBeVisible();
 assert.equal(await frame.locator('html').evaluate(element=>element.scrollWidth<=element.clientWidth+1),true);
 assert.equal(await frame.locator('.scientific-viewer').evaluate(element=>element.scrollWidth<=element.clientWidth+1),true);
 await frame.getByRole('button',{name:'导入文件',exact:true}).focus();await expect(frame.getByRole('button',{name:'导入文件',exact:true})).toBeFocused();
 await page.screenshot({path:resolve(out,'dark-zh-narrow.png')});checks.push('Parent zh/en, light/dark, narrow layout and keyboard focus');
 assert.deepEqual(errors,[]);assert.deepEqual(httpErrors.filter(value=>value.status>=500),[]);
 await writeFile(resolve(out,'result.json'),JSON.stringify({checks,examples,errors,httpErrors,artifacts,pointRevision:execFileSync('git',['-C',point,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),synthetic:['public literature snapshots','ACP model output'],runtimeNeedsPointService:false},null,2));
 console.log(JSON.stringify({checks,examples:examples.length,errors}));
 }
}catch(error){if(app){const page=await app.firstWindow();await page.screenshot({path:resolve(out,'failure.png')});console.error('frames',await page.evaluate(()=>[...document.querySelectorAll('iframe')].map(frame=>({src:frame.src,title:frame.title}))));for(const frame of page.frames())console.error('alerts',await frame.getByRole('alert').allTextContents().catch(()=>[]));}throw error;
}finally{if(app){const cleanup=setTimeout(()=>app.process().kill('SIGKILL'),5000);cleanup.unref();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(window=>window.destroy())).catch(()=>{});await app.close();clearTimeout(cleanup);}if(host){host.stdin.end();host.kill();await ended;}await rm(temp,{recursive:true,force:true});}

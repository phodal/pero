// Disposable component seam: not Desktop, real acquisition, or scientific evidence.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, basename } from 'node:path';

const root = resolve(import.meta.dirname, '../..'), app = resolve(root, 'apps/paper-agent');
const output = await mkdtemp(join(tmpdir(), 'pero-library-save-ui-'));
const source = `import React,{useState,useRef} from 'react';import {createRoot} from 'react-dom/client';
import {LibrarySave} from '${app}/ui-src/library-save';import {PdfReader} from '${app}/ui-src/pdf-reader';
import {messages} from '${app}/ui-src/i18n';
const api={get:async(path)=>{const r=await fetch(path);return r.json()},post:async(path,body)=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw new Error('Fixture error');return r.json()}};
const paper=id=>({id,title:'Paper '+id,source:'fixture',sourceId:id,pdfUrl:'https://example.org/'+id+'.pdf',contentKind:'abstract',content:'Abstract',authors:[],url:'https://example.org/'+id,contentDigest:id,fetchedAt:''});
function App(){const [id,setId]=useState(null),preserveView=useRef(null);window.openPaper=setId;return <><PdfReader paper={paper('metadata')} api={api} t={key=>messages[key].en} onMatrixAdded={async()=>{}} chrome={{toolbar:null,preserveView,onNavigate(){},onSave(){setId('metadata')}}}>Abstract</PdfReader>{id&&<LibrarySave key={id} api={api} paper={paper(id)} t={key=>messages[key].en} onClose={()=>setId(null)} onError={error=>{throw error}} onRead={()=>{throw new Error('Unexpected identity switch')}} onSaved={async()=>{window.savedPaper=id}}/>}</>};createRoot(document.getElementById('root')).render(<App/>);`;
await build({ stdin: { contents: source, loader: 'tsx', resolveDir: root }, outfile: join(output, 'fixture.js'), bundle: true,
  format: 'esm', platform: 'browser', jsx: 'automatic', loader: { '.wasm': 'file' },
  alias: { react: resolve(app, 'node_modules/react'), 'react-dom': resolve(app, 'node_modules/react-dom'), '@pero/app-sdk/ui': resolve(root, 'packages/app-sdk/src/ui.tsx'), '@pero/app-sdk': resolve(root, 'packages/app-sdk/src/index.tsx') }, nodePaths: [resolve(app, 'node_modules')] });
const operations = [], unexpectedRequests = []; let releaseOld, releaseInspection, sourceStatus='not_started', sourceStarts=0, finishSource=false;
const bundle={id:'retry-bundle',seedUrl:'https://example.org/retry.pdf',title:'Retry source',resources:[{id:'source',kind:'source_archive',title:'TeX source'}],sourceDownloadIds:['source'],pdfDownloadIds:[],downloadIds:[]};
const ready = id => ({ status: 'ready', reviewId: id+'-review', paperId:id, documentId:id+'-doc', version:null,
  pdf:{available:true,cached:true,license:null,size:128},tex:{available:false,license:null,size:null,reason:'Version unknown; TeX cannot be paired.'},warnings:['Version unknown; TeX cannot be paired.'] });
const server = createServer(async (req,res) => {
  if(req.method==='GET') {
    if(req.url==='/api/pdf?paperId=metadata') {operations.push({path:req.url});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({document:null,annotations:[]}));return;}
    if(/\.(js|css|wasm)$/.test(req.url)){res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':req.url.endsWith('.css')?'text/css':'application/wasm');res.end(await readFile(join(output,basename(req.url))));return;}
    if(req.url!=='/') {unexpectedRequests.push(req.method+' '+req.url);res.statusCode=404;res.end();return;}
    res.setHeader('Content-Type','text/html');res.end('<meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"><style>:root{--pero-text:#111;--pero-text-muted:#555;--pero-border:#999;--pero-material-reading:white}body{font:14px sans-serif}</style><div id="root"></div><script type="module" src="/fixture.js"></script>');return;
  }
  let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);operations.push({path:req.url,...body});
  const id=req.url.split('/')[3];let value;
  if(req.url==='/api/research/source') {
    assert.equal(body.bundleId,'retry-bundle');assert.equal(body.resourceId,'source');
    if(body.operation==='start') sourceStatus=++sourceStarts===1?'denied':'running';
    if(body.operation==='status'&&sourceStatus==='running'&&finishSource) sourceStatus='source_available';
    value={id:'source',status:sourceStatus,stage:'discovered',error:sourceStatus==='denied'?'Fixture source denied':'',localAvailable:sourceStatus==='source_available',receipt:sourceStatus==='source_available'?{sourcePageUrl:'https://example.org/retry',requestUrl:'https://example.org/retry.tex',finalUrl:'https://example.org/retry.tex',fetchedAt:'fixture',archiveDigest:'fixture',size:128,mime:'application/gzip',format:'tar',workIdentity:'fixture',revision:'v1',explicitVersion:'v1',memberCount:1,texCount:1}:null};
  } else if(body.operation==='prepare') {
    if(id==='old') await new Promise(resolve=>{releaseOld=resolve});
    if(id==='delayed') await new Promise(resolve=>{releaseInspection=resolve});
    value=['inspecting','delayed'].includes(id)?{status:'inspecting',draftId:'draft-'+id,paperId:id,warnings:[]}:ready(id);
    if(id==='retry') value={...ready(id),version:'v1',tex:{available:true,license:null,size:null},warnings:[]};
  } else if(body.operation==='confirm') {assert.equal(body.reviewId,id+'-review');assert.equal(body.pdf,true);assert.equal(body.tex,id==='retry');value={paperId:id,documentId:id+'-doc',bundle:null,bundleId:null,pdfResourceId:null,sourceResourceId:null};if(id==='retry')value={...value,bundle,bundleId:bundle.id,sourceResourceId:'source'};}
  else if(body.operation==='export') {assert.equal(body.documentId,id+'-doc');value={pdf:'/fixture/'+id+'.pdf',...(id==='retry'?(sourceStatus==='source_available'?{tex:'/fixture/retry.tar.gz'}:{texNote:'Fixture source denied'}):{})};}
  else if(body.cancel) value={status:'cancelled'};
  else {unexpectedRequests.push(req.method+' '+req.url);res.statusCode=400;res.end();return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await chromium.launch({headless:true,...(process.env.PERO_CHROMIUM_PATH ? {executablePath:process.env.PERO_CHROMIUM_PATH} : {})});const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const origin=`http://127.0.0.1:${server.address().port}`;
  await page.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();unexpectedRequests.push(route.request().url());return route.abort('blockedbyclient')});
  await page.goto(origin);await expect(page.getByText('Abstract',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'PDF',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Save copies'});
  await expect(dialog.getByRole('checkbox',{name:'PDF',exact:true})).toBeChecked();await expect(dialog.getByRole('checkbox',{name:'TeX',exact:true})).not.toBeChecked();
  await expect(dialog.getByText('Version unknown; TeX cannot be paired.',{exact:true})).toHaveCount(1);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);
  assert(operations.every(value=>!['confirm','export','start'].includes(value.operation)));assert(!operations.some(value=>value.path==='/api/pdf'));
  await page.evaluate(()=>window.openPaper('old'));await expect.poll(()=>!!releaseOld).toBe(true);
  await page.evaluate(()=>window.openPaper('new'));await expect(dialog.getByText('Paper new',{exact:true})).toBeVisible();releaseOld();
  await dialog.getByRole('button',{name:'Confirm',exact:true}).click();await dialog.getByRole('button',{name:'Export copies',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.savedPaper)).toBe('new');assert(!operations.some(value=>value.path.includes('/old/')&&value.operation==='confirm'));
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.evaluate(()=>window.openPaper('inspecting'));
  await expect(dialog.getByText('Checking sources; no files downloaded…')).toBeVisible();
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(dialog).toHaveCount(0);
  assert(operations.some(value=>value.path==='/api/research/inspect'&&value.draftId==='draft-inspecting'&&value.cancel===true));
  await page.evaluate(()=>window.openPaper('delayed'));await expect.poll(()=>!!releaseInspection).toBe(true);
  await dialog.getByRole('button',{name:'Close',exact:true}).click();releaseInspection();
  await expect.poll(()=>operations.some(value=>value.path==='/api/research/inspect'&&value.draftId==='draft-delayed'&&value.cancel===true)).toBe(true);
  await page.evaluate(()=>window.openPaper('retry'));await dialog.getByRole('checkbox',{name:'TeX',exact:true}).check();
  await dialog.getByRole('button',{name:'Confirm',exact:true}).click();
  await expect(dialog.getByText('Source access denied',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Export PDF only',exact:true}).click();
  await expect.poll(()=>operations.filter(value=>value.path==='/api/papers/retry/files'&&value.operation==='export').length).toBe(1);
  await dialog.getByRole('button',{name:'Retry source download',exact:true}).click();
  await expect(dialog.getByText('Downloading source…',{exact:true})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Export PDF only',exact:true})).toBeDisabled();
  finishSource=true;await expect(dialog.getByRole('button',{name:'Export copies',exact:true})).toBeEnabled();
  await dialog.getByRole('button',{name:'Export copies',exact:true}).click();
  await expect(dialog.getByText('Saved the PDF and TeX source in ~/.pero/paper',{exact:true})).toBeVisible();
  assert.equal(operations.filter(value=>value.path==='/api/papers/retry/files'&&value.operation==='export').length,2);
  assert.deepEqual(errors,[]);assert.deepEqual(unexpectedRequests,[]);console.log('Library save component: cancel/no implicit PDF fetch, stale review, original request identity, inspection cancel passed.');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(output,{recursive:true,force:true});}

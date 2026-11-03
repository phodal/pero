// Disposable browser component seam; real Desktop/acquisition owners are tested separately.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, basename } from 'node:path';
const root = resolve(import.meta.dirname, '../..'), app = resolve(root, 'apps/paper-agent');
const output = await mkdtemp(join(tmpdir(), 'pero-library-download-ui-'));
const evidence = resolve(root, 'test-results/paper-library-save');
await mkdir(evidence, { recursive: true });
const source = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {LibrarySave} from '${app}/ui-src/library-save';import {messages} from '${app}/ui-src/i18n';import {AppApiProvider} from '@pero/app-sdk';
const api={post:async(path,body)=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await r.json();if(!r.ok)throw Error(value.detail);return value;}};
const paper={id:'original',title:'Harness-Aware Distillation for Small Language Model Agents',source:'openalex',sourceId:'W1',pdfUrl:'https://arxiv.org/pdf/2610.02858v1'};
function App(){const [format,setFormat]=useState(null),[read,setRead]=useState(''),[dark,setDark]=useState(false),[narrow,setNarrow]=useState(false);return <main data-theme={dark?'dark':'light'} style={{maxWidth:narrow?360:900}}><header><button onClick={()=>setFormat('pdf')}>Download PDF</button><button onClick={()=>setFormat('tex')}>Download TeX</button><button onClick={()=>setDark(!dark)}>Theme</button><button onClick={()=>setNarrow(!narrow)}>Narrow</button></header><h1>{paper.title}</h1><p>Original paper record</p>{format&&<LibrarySave key={format} api={api} paper={paper} format={format} t={key=>messages[key].en} onClose={()=>setFormat(null)} onRead={id=>{setRead(id);setFormat(null)}} onSaved={async()=>{window.savedPaper=paper.id}}/>}{read&&<p role='status'>Reading original</p>}</main>};createRoot(document.getElementById('root')).render(<AppApiProvider appName='paper-agent' locale='en' allowedApiPaths={['/api']} allowedEvents={[]} subscribeFn={()=>()=>{}} navigateFn={()=>{}} notifyFn={()=>{}}><App/></AppApiProvider>);`;
await build({ stdin: { contents: source, loader: 'tsx', resolveDir: root }, outfile: join(output, 'fixture.js'), bundle: true,
  format: 'esm', platform: 'browser', jsx: 'automatic', alias: { react: resolve(app, 'node_modules/react'), 'react-dom': resolve(app, 'node_modules/react-dom'), '@pero/app-sdk/ui': resolve(root, 'packages/app-sdk/src/ui.tsx'), '@pero/app-sdk': resolve(root, 'packages/app-sdk/src/index.tsx') }, nodePaths: [resolve(app, 'node_modules')] });
const operations = [], states = { pdf: 'not_started', source: 'not_started' };
let failSource = true;
const server = createServer(async (req, res) => {
  if(req.method === 'GET') {
    if (/\.(js|css)$/.test(req.url)) { res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(await readFile(join(output, basename(req.url)))); return; }
    res.setHeader('Content-Type','text/html'); res.end(`<meta charset='utf-8'><link rel='icon' href='data:,'><link rel='stylesheet' href='/fixture.css'><style>body{margin:0;background:#eee;font:14px system-ui}main{margin:24px auto;background:var(--pero-material-reading);color:var(--pero-text);padding:12px;--pero-text:#222;--pero-text-muted:#666;--pero-border:#ddd;--pero-material-reading:#fff}main[data-theme=dark]{--pero-text:#ddd;--pero-text-muted:#aaa;--pero-border:#555;--pero-material-reading:#222}header{display:flex;gap:8px;flex-wrap:wrap}button{font:inherit;padding:4px 8px}h1{font-size:18px}button:focus-visible{outline:2px solid #18888b}</style><div id='root'></div><script type='module' src='/fixture.js'></script>`); return;
  }
  let text=''; for await(const part of req) text+=part;
  const body=JSON.parse(text); operations.push({path:req.url,...body}); let value;
  if(req.url.endsWith('/files')) {
    if(body.operation==='prepare') value={status:'ready',draftId:'draft',reviewId:'review',pdf:{available:true},tex:{available:true}};
    else if(body.operation==='confirm') value={paperId:'original',bundleId:'bundle',pdfResourceId:'pdf',sourceResourceId:body.tex?'tex':null,documentId:null,bundle:{id:'bundle'}};
    else value={pdf:'/copies/2610.02858v1.pdf',...(body.sourceResourceId?{tex:'/copies/2610.02858v1-src.tar.gz'}:{})};
  } else {
    const kind=req.url.endsWith('/pdf')?'pdf':'source';
    if(body.operation==='start') {states[kind]=kind==='source'&&failSource?'failed':'completed';if(kind==='source')failSource=false;}
    value={status:states[kind],localAvailable:states[kind]==='completed',error:states[kind]==='failed'?'Source denied':''};
  }
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
let browser, page;
try {
  if(process.env.PERO_UI_MANUAL==='1') {
    console.log(url);
    await new Promise(resolve=>process.once('SIGTERM',resolve));
  } else {
    browser=await chromium.launch({headless:true,...(process.env.PERO_CHROMIUM_PATH?{executablePath:process.env.PERO_CHROMIUM_PATH}:{})});
    page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(url);expect(operations).toEqual([]);
    await page.getByRole('button',{name:'Download PDF',exact:true}).click();
    const progress=page.getByRole('region',{name:'Download',exact:true});
    await expect(progress.getByRole('status')).toHaveText('Downloaded');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(progress.getByText(/Hash|License|not mean read|No models/)).toHaveCount(0);
    await progress.getByRole('button',{name:'Read source',exact:true}).click();
    await expect(page.getByRole('status')).toHaveText('Reading original');
    await page.getByRole('button',{name:'Download TeX',exact:true}).click();
    await expect(progress).toContainText('Source denied');
    const sourceStarts=()=>operations.filter(c=>c.path.endsWith('/source')&&c.operation==='start');
    assert.equal(sourceStarts().length,1);
    await progress.getByRole('button',{name:'Retry',exact:true}).click();
    await expect(progress.getByRole('status')).toHaveText('Downloaded');
    await expect(progress.getByText('PDF + TeX',{exact:true})).toBeVisible();
    assert.equal(sourceStarts().length,2);
    await page.getByRole('button',{name:'Theme',exact:true}).click();await page.getByRole('button',{name:'Narrow',exact:true}).click();
    await progress.getByRole('button',{name:'Close',exact:true}).focus();
    await page.screenshot({path:resolve(evidence,'download-dark-narrow.png')});
    assert(operations.filter(c=>c.operation==='export').every(c=>c.path==='/api/papers/original/files'));
    assert.deepEqual(errors,[]);console.log('Direct download: original identity, no modal, PDF/TeX and explicit retry passed.');
  }
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(output,{recursive:true,force:true});}

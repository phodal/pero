// Interactive browser acceptance fixture for the real SDK components, without Point sources/runtime.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {mkdtemp, readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';

const root = resolve(import.meta.dirname, '../..');
const directory = await mkdtemp(join(tmpdir(), 'pero-code-surfaces-'));
const output = join(root, 'test-results/app-sdk-code'); await mkdir(output, {recursive: true});
await build({stdin: {resolveDir: root, loader: 'tsx', contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {AppProvider} from './packages/app-sdk/src/index';
import {CodeViewer,CodeEditor,CodeCompare,CommandLine} from './packages/app-sdk/src/ui';
const source=['identification division.','program-id. ACCOUNT.','data division.','working-storage section.','01 AMOUNT PIC 9(5)V99.','procedure division.','MAIN.','    move 100 to AMOUNT','    display AMOUNT','    display AMOUNT','    goback.','end program ACCOUNT.'].join('\\n');
function App(){const [dark,setDark]=useState(false),[line,setLine]=useState(101),[second,setSecond]=useState(false),[value,setValue]=useState('classDiagram\\nclass Account {\\n  +balance: decimal\\n}\\n'),[disabled,setDisabled]=useState(false),[mode,setMode]=useState('mapped'),[active,setActive]=useState(null);
return <main><h1>SDK code surfaces</h1><label>Dark theme <input type="checkbox" checked={dark} onChange={e=>{setDark(e.target.checked);window.postMessage({type:'pero:app:context',context:{locale:'en',dark:e.target.checked,active:true}},'*')}}/></label>
<section><h2>Read-only COBOL</h2><button onClick={()=>setLine(107)}>Go to MAIN</button><button onClick={()=>setSecond(v=>!v)}>Switch document</button><div className="code-sample"><CodeViewer label="COBOL source" text={second?'identification division.\\nprogram-id. SECOND.\\nprocedure division.\\n    goback.':source} documentId={second?'second.cbl':'account.cbl'} language="cobol" startLine={101} line={line} ranges={[{startLine:107,endLine:111}]} lineMarks={[{startLine:109,endLine:109,className:'source-diagnostic'}]}/></div></section>
<section><h2>Editable Mermaid</h2><label>Disable editor <input type="checkbox" checked={disabled} onChange={e=>setDisabled(e.target.checked)}/></label><div className="code-sample"><CodeEditor label="Business model" value={value} disabled={disabled} onChange={setValue}/></div><output aria-label="Saved draft">{value}</output></section>
<section><h2>Source comparison</h2><label>Comparison mode <select value={mode} onChange={e=>setMode(e.target.value)}><option value="mapped">Mapped blocks</option><option value="diff">Text differences</option></select></label><output aria-label="Active mapped block">{String(active)}</output><div className="code-sample compare"><CodeCompare label="Compare source and target" left={{text:'OPEN-ACCOUNT.\\n    move 100 to AMOUNT\\n    goback.',documentId:'left.cbl',label:'COBOL original',language:'cobol',startLine:25}} right={{text:'void openAccount() {\\n  amount = new BigDecimal("100");\\n}\\n',documentId:'right.java',label:'Java target',language:'java',startLine:100}} blocks={mode==='mapped'?[{left:{startLine:25,endLine:27},right:{startLine:100,endLine:102}}]:undefined} comments={[{side:'left',line:26,text:'Check decimal behavior'}]} onActiveBlockChange={setActive}/></div></section>
<section><h2>Read-only command</h2><CommandLine label="Build command" value="cobc -x account.cbl -o account"/></section></main>}
createRoot(document.getElementById('app')).render(<AppProvider><App/></AppProvider>);
`}, bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', splitting: true, outdir: directory});
await writeFile(join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="stdin.css"><style>main{padding:16px}section{margin:24px 0}button,select,label{margin-right:12px}.code-sample{height:250px;margin:10px 0}.source-diagnostic{border-left:3px solid var(--pero-error)}output{white-space:pre-wrap;display:block}.compare{height:360px}</style></head><body><div id="app"></div><script type="module" src="stdin.js"></script></body></html>');
const server = createServer(async (req, res) => {
  const path = req.url === '/' ? 'index.html' : req.url.slice(1);
  if (!/^[a-zA-Z0-9._-]+$/.test(path)) { res.writeHead(404).end(); return; }
  const value = await readFile(join(directory, path)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!value) { res.writeHead(404).end(); return; }
  res.writeHead(200, {'content-type': path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8'}).end(value);
});
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const sha256 = createHash('sha256').update(await readFile(join(directory, 'stdin.js'))).digest('hex');
  await writeFile(join(output, 'build.json'), JSON.stringify({entrySHA256: sha256, scope: 'CodeViewer, CodeEditor, CodeCompare, CommandLine SDK UI only'}, null, 2));
  console.log(JSON.stringify({url: `http://127.0.0.1:${server.address().port}`, output}));
  for await (const line of createInterface({input: process.stdin})) if (line === 'stop') break;
} finally { server.closeAllConnections(); await new Promise(done => server.close(done)); await rm(directory, {recursive: true, force: true}); process.stdin.pause(); }

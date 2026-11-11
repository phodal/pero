// Production PdfViewer + real Paper HTTP adapter, pinned original PDF and actual arithmetic.
// Run with PERO_FISHER_PDF=/path/to/reviewed.pdf; PERO_FISHER_SERVE=1 exposes the same surface for manual inspection.
import assert from 'node:assert/strict';
import { appSdkAliases } from '../../scripts/build/app-sdk.mjs';
import { build } from 'esbuild';
import { packageSourceParsers } from '../../scripts/build/source-parsers.mjs';
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, basename } from 'node:path';
const root = resolve(import.meta.dirname, '../..'), app = resolve(root, 'apps/paper-agent');
if (!process.env.PERO_FISHER_PDF) throw Error('PERO_FISHER_PDF must identify the original reviewed Fisher PDF');
await packageSourceParsers(root, 'paper-agent');
const output = await mkdtemp(join(tmpdir(), 'pero-fisher-browser-'));
const python = spawn(process.env.PERO_APP_PYTHON || 'python3', ['-u', '-c', `
import json, os, tempfile
from pathlib import Path
from http.server import ThreadingHTTPServer
from paper_agent.store import ResearchStore
from paper_agent.model import PaperSnapshot
from paper_agent.pdf import PdfDocument
from paper_agent.pdf_files import PdfFiles
from paper_agent.fisher_result import PDF_SHA256, PDF_URL, DOI
from paper_agent.http import handler
from paper_agent.fisher_reproduction import sha
home = tempfile.TemporaryDirectory()
store = ResearchStore(Path(home.name))
original = Path(os.environ['PERO_FISHER_PDF']).read_bytes()
assert sha(original) == PDF_SHA256
now = '2026-11-07T03:00:00Z'
paper = store.save_paper(PaperSnapshot.from_reading(dict(source='import', sourceId=DOI, title='The use of multiple measurements in taxonomic problems', url='https://doi.org/'+DOI, contentKind='full-text', content='Original Fisher paper'), now))
document = store.save_pdf(PdfDocument.create(paper.id, PDF_SHA256, PDF_URL, PdfFiles().pages(original), now), original)
server = ThreadingHTTPServer(('127.0.0.1', 0), handler(store, 'local-browser-test'))
print(json.dumps(dict(port=server.server_port, document=document.to_dict())), flush=True)
try: server.serve_forever()
finally: server.server_close(); store.program_jobs.close(); home.cleanup()
`], { cwd: root, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: join(app, 'backend') }, stdio: ['ignore', 'pipe', 'pipe'] });
let backendErrors = ''; python.stderr.on('data', b => { backendErrors += b; });
let browser, server;
try {
  const info = await new Promise((resolve, reject) => {
    const lines = createInterface({ input: python.stdout });
    lines.once('line', line => { lines.close(); resolve(JSON.parse(line)); });
    python.once('exit', code => reject(Error(`Python server exited ${code}: ${backendErrors}`)));
  });
  const source = `import React,{useState,useRef} from 'react';import{createRoot}from'react-dom/client';
import{AppSdkProvider}from'@pero/app-sdk';
import{PdfViewer}from'${app}/ui-src/pdf-reader';import{messages}from'${app}/ui-src/i18n';
import '${root}/packages/app-sdk/src/ui.css';import '${app}/ui-src/styles.css';
const api={get:async path=>{const r=await fetch(path);if(!r.ok)throw Error(await r.text());return r.json();},post:async(path,body)=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());return r.json();}};
function App(){const[annotations,setAnnotations]=useState([]);const preserveView=useRef(null);return <PdfViewer document={${JSON.stringify(info.document)}} annotations={annotations} api={api} t={key=>messages[key].en} active readLabel="Read" onSaved={a=>setAnnotations(rows=>[...rows.filter(r=>r.id!==a.id),a])} onMatrixAdded={async()=>{}} onText={()=>{}} chrome={{toolbar:null,preserveView,onNavigate(){},onSave(){}}}/>;}
createRoot(document.getElementById('root')).render(<AppSdkProvider host={{info:{locale:'en',active:true}}}><App/></AppSdkProvider>);`;
  await build({ stdin: { contents: source, loader: 'tsx', resolveDir: root }, outfile: join(output, 'app.js'), bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', loader: { '.wasm': 'file', '.woff2': 'file', '.woff': 'file' },
    alias: { react: resolve(app, 'node_modules/react'), 'react-dom': resolve(app, 'node_modules/react-dom'), ...appSdkAliases(root) } });
  server = createServer(async (req, res) => {
    try {
      if (req.url.startsWith('/api/')) {
        const chunks = []; for await (const part of req) chunks.push(part);
        const reply = await fetch(`http://127.0.0.1:${info.port}${req.url}`, { method: req.method, headers: { 'Content-Type': req.headers['content-type'] ?? 'application/json', 'X-Pero-App-Token': 'local-browser-test' }, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) });
        res.writeHead(reply.status, { 'Content-Type': reply.headers.get('content-type') ?? 'application/json' }); res.end(Buffer.from(await reply.arrayBuffer())); return;
      }
      if (req.url !== '/') {
        const name = basename(req.url); res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream'); res.end(await readFile(join(output, name))); return;
      }
      res.setHeader('Content-Type', 'text/html'); res.end('<meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Fisher real workflow verification</title><link rel="stylesheet" href="/app.css"><style>body{margin:0}#root{height:100vh;display:flex;flex-direction:column;container-type:inline-size}</style><div id="root"></div><script type="module" src="/app.js"></script>');
    } catch (error) { res.statusCode = 500; res.end(String(error)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(JSON.stringify({ url: base, output, documentId: info.document.id, scope: 'Production PDF reader and API; real arithmetic, not full Host or Native acceptance' }));
  if (process.env.PERO_FISHER_SERVE === '1') await new Promise(resolve => { process.once('SIGTERM', resolve); process.once('SIGINT', resolve); });
  else {
    browser = await chromium.launch({ executablePath: process.env.PERO_CHROMIUM_PATH || chromium.executablePath(), headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } }); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
    await page.goto(base);
    await page.getByRole('button', { name: 'Select Fisher Table III result', exact: true }).click();
    await expect(page.locator('[data-annotation-id][data-focused="true"]')).toHaveCount(1);
    await expect(page.getByRole('spinbutton', { name: 'Page', exact: true })).toHaveValue('4');
    await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Freeze protocol', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm and run fixed arithmetic', exact: true }).click();
    await expect(page.getByText('Single-result verdict: REPRODUCED')).toBeVisible();
    await expect(page.getByText('Independent numerical check: PASS')).toBeVisible();
    const panel = page.locator('.pa-fisher-reproduction');
    await expect(panel.locator('dd')).toHaveText(['19.1434', '19.1434', '0']);
    await page.getByRole('button', { name: 'Confirm and run a new attempt', exact: true }).click();
    await expect(page.getByText('Independent numerical check: PASS')).toBeVisible();
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export standalone handoff ZIP' }).click();
    const evidence = resolve(root, 'test-results/paper-fisher'); await mkdir(evidence, { recursive: true });
    await (await download).saveAs(join(evidence, 'handoff.zip'));
    await page.screenshot({ path: join(evidence, 'actual-reader-light.png'), fullPage: true });
    await writeFile(join(evidence, 'browser.json'), JSON.stringify({ actualScientificExecution: true, scope: 'Production PdfViewer + authenticated HTTP. No Native/Host acceptance.', errors }, null, 2));
    assert.deepEqual(errors, []); console.log('PASS: actual PDF toolbar, source cell, frozen protocol, real calculation and independent check, immutable rerun, ZIP export.');
  }
} finally { await browser?.close(); if (server?.listening) await new Promise(resolve => server.close(resolve)); python.kill('SIGTERM'); await rm(output, { recursive: true, force: true }); }

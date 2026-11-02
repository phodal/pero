// Browser fixture for an owner-built App. Real backend; loopback proxy replaces Desktop transport only.
// UI interactions use the browser. stdin supports inspection and cleanup, never clicking App controls.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {mkdtemp, readFile, rm, mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, extname} from 'node:path';
import {readAppBundle, stageAppBundle} from '../../scripts/build/app-bundle.mjs';

const input = process.argv.find(arg => arg.startsWith('--bundle='))?.slice('--bundle='.length);
assert(input, 'Use --bundle=/owner-built/app');
const directory = await mkdtemp(join(tmpdir(), 'cobol-browser-'));
const output = resolve(import.meta.dirname, '../../test-results/point-cobol-app/browser');
await mkdir(output, {recursive: true});
stageAppBundle(readAppBundle(input), join(directory, 'app'));
const token = randomBytes(32).toString('hex');
const child = spawn(process.execPath, [join(directory, 'app/backend/server.mjs')], {cwd: directory,
  env: {...process.env, PERO_APP_DATA: directory, PERO_APP_TOKEN: token}, stdio: ['pipe', 'pipe', 'pipe']});
const exited = once(child, 'exit'); let server, stderr = '';
const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
child.stderr.on('data', data => { stderr += data; });
try {
  const lines = createInterface({input: child.stdout});
  const ready = await Promise.race([once(lines, 'line').then(([line]) => JSON.parse(line)), exited.then(() => { throw Error(stderr || 'Backend exited before readiness'); })]);
  clearTimeout(timer); const backend = `http://127.0.0.1:${ready.port}`;
  server = createServer(async (request, response) => {
    if (request.url.startsWith('/api/')) {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const result = await fetch(backend + request.url, {method: request.method, headers: {'X-Pero-App-Token': token},
        ...(['GET', 'HEAD'].includes(request.method) ? {} : {body: Buffer.concat(chunks)})});
      response.writeHead(result.status, {'content-type': 'application/json'}); response.end(await result.text()); return;
    }
    if (request.url === '/') {
      response.writeHead(200, {'content-type': 'text/html; charset=utf-8'}).end(`<html><head><style>body{margin:0;font:13px system-ui}nav{padding:8px;background:#eee}iframe{border:0;width:100%;height:calc(100vh - 42px)}</style></head><body><nav>Browser transport fixture · <label>Host locale <select id="locale"><option>en</option><option>zh-CN</option></select></label> <label>Host theme <select id="theme"><option>light</option><option>dark</option></select></label></nav><iframe title="cobol-analysis" src="/frame/index.html"></iframe><script>const frame=document.querySelector('iframe');function context(){frame.contentWindow.postMessage({type:'pero:app:context',context:{locale:locale.value,dark:theme.value==='dark',active:true}},'*')}window.addEventListener('message',e=>{if(e.source===frame.contentWindow&&e.data.type==='pero:app:ready')context()});locale.onchange=theme.onchange=context;</script></body></html>`); return;
    }
    const name = request.url.slice('/frame/'.length);
    if (!request.url.startsWith('/frame/') || !/^[a-zA-Z0-9._-]+$/.test(name)) { response.writeHead(404).end(); return; }
    const content = await readFile(join(directory, 'app/dist', name));
    response.writeHead(200, {'content-type': {'.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript'}[extname(name)] || 'application/octet-stream'}).end(content);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  console.log(JSON.stringify({url: `http://127.0.0.1:${server.address().port}`, output}));
  for await (const line of createInterface({input: process.stdin})) {
    if (line === 'stop') break;
    if (line === 'inspect') {
      const headers = {'X-Pero-App-Token': token};
      const snapshots = await (await fetch(backend + '/api/snapshots', {headers})).json();
      const receipts = await (await fetch(backend + '/api/receipts', {headers})).json();
      const source = JSON.parse(await readFile(join(directory, 'app/sources.json'), 'utf8'));
      const report = {source, snapshots, receipts, stderr, limitations: ['Browser fixture; no Desktop transport or native Agent approval click verification in this check']};
      await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
    }
  }
} finally {
  clearTimeout(timer);
  if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  child.kill('SIGTERM'); await exited; await rm(directory, {recursive: true, force: true}); process.stdin.pause();
}

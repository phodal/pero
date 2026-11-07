/** Keep the Python 3.12 case service and its panel available for a visible browser. */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { appSdkAliases } from '../../../scripts/build/app-sdk.mjs';

const root = resolve(import.meta.dirname, '../../..');
const appRoot = resolve(root, 'apps/lcms2yield');
const python = process.env.PYTHON || 'python3.12';
const directory = await mkdtemp(resolve(tmpdir(), 'pero-lcms2yield-preview-'));
const data = await mkdtemp(resolve(tmpdir(), 'pero-lcms2yield-data-'));
await build({
  entryPoints: [resolve(appRoot, 'ui-src/frame.tsx')], outfile: resolve(directory, 'app.js'),
  bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic', alias: appSdkAliases(root),
  nodePaths: [resolve(appRoot, 'node_modules')],
  loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl' },
  plugins: [{ name: 'app-react-runtime', setup(builder) {
    builder.onResolve({ filter: /^(react|react-dom)(\/|$)/ }, args => args.resolveDir === appRoot ? undefined : builder.resolve(args.path, { kind: args.kind, resolveDir: appRoot }));
  } }],
});
const [bundle, css] = await Promise.all(['app.js', 'app.css'].map(name => readFile(resolve(directory, name))));
const secret = 'lcms2yield-preview';
const backend = spawn(python, [resolve(appRoot, 'backend/server.py')], {
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PERO_APP_DATA: data, PERO_APP_TOKEN: secret },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const port = await new Promise((resolvePort, reject) => {
  const deadline = setTimeout(() => reject(new Error('LCMS2Yield service did not report a port')), 10000);
  backend.once('error', reject);
  backend.once('exit', code => reject(new Error(`LCMS2Yield service exited ${code}`)));
  createInterface({ input: backend.stdout }).once('line', line => { clearTimeout(deadline); resolvePort(JSON.parse(line).port); });
});
const server = createServer(async (request, response) => {
  if (request.url.startsWith('/api/')) {
    let content = '';
    for await (const chunk of request) content += chunk;
    const result = await fetch(`http://127.0.0.1:${port}${request.url}`, {
      method: request.method,
      headers: { 'Content-Type': 'application/json', 'X-Pero-App-Token': secret },
      ...(content ? { body: content } : {}),
    });
    response.writeHead(result.status, { 'Content-Type': 'application/json' });
    return response.end(await result.text());
  }
  if (request.url === '/app.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); return response.end(bundle); }
  if (request.url === '/app.css') { response.writeHead(200, { 'Content-Type': 'text/css' }); return response.end(css); }
  if (request.url === '/app') { response.writeHead(200, { 'Content-Type': 'text/html' }); return response.end('<!doctype html><link rel="stylesheet" href="/app.css"><div id="app"></div><script type="module" src="/app.js"></script>'); }
  if (request.url === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    return response.end(`<!doctype html><style>body{margin:0}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style>
      <iframe title="LCMS2Yield" sandbox="allow-scripts allow-same-origin" src="/app"></iframe><script>
      addEventListener('message',event=>{
        if(event.data?.type==='pero:app:ready')event.source.postMessage({type:'pero:app:context',context:{locale:'en',dark:false,active:true}},'*');
        if(event.data?.type==='pero:app:sdk'&&event.data.operation==='navigate'){
          event.source.postMessage({type:'pero:app:sdk-result',id:event.data.id,ok:true},'*');
        }
      });</script>`);
  }
  response.writeHead(404); response.end();
});
await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
const address = server.address();
console.log(`LCMS2YIELD_PREVIEW http://127.0.0.1:${address.port}/ python=${python}`);
const shutdown = async () => {
  server.close();
  backend.kill('SIGTERM');
  await rm(directory, { recursive: true, force: true });
  await rm(data, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

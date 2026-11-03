// Production App and real Python/RDKit; only Desktop's HTTP/context transport is replaced.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const frame = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scientific Viewer browser acceptance</title><style>html,body{height:100%;margin:0;font:14px system-ui}body{display:flex;flex-direction:column}nav{display:flex;align-items:center;gap:12px;padding:8px 12px;background:#eef3f8;color:#172536;flex-wrap:wrap}nav label{display:flex;align-items:center;gap:6px}select{font:inherit}iframe{border:0;width:100%;flex:1;min-height:0}</style></head><body><nav aria-label="Browser fixture"><span>Browser acceptance</span><label>Theme <select id="theme" aria-label="Theme"><option value="light">Light</option><option value="dark">Dark</option></select></label><label>Locale <select id="locale" aria-label="Locale"><option value="en">English</option><option value="zh-CN">Chinese</option></select></label></nav><iframe title="scientific-viewer" sandbox="allow-scripts allow-same-origin allow-downloads allow-popups" src="/frame/index.html"></iframe><script>
const frame=document.querySelector('iframe'),theme=document.getElementById('theme'),locale=document.getElementById('locale');
function context(){frame.contentWindow.postMessage({type:'pero:app:context',context:{locale:locale.value,dark:theme.value==='dark',active:true}},location.origin)}
window.addEventListener('message',event=>{if(event.source===frame.contentWindow&&event.data?.type==='pero:app:ready')context()});theme.onchange=locale.onchange=context;
</script></body></html>`;

export async function scientificViewerPreview() {
  const dist = resolve(root, 'apps/scientific-viewer/dist');
  await access(resolve(dist, 'index.html'));
  const python = process.env.PERO_SCIENTIFIC_PYTHON || 'python3';
  const engine = JSON.parse(execFileSync(python, ['-E', '-s', '-c', 'import json; from rdkit import rdBase; print(json.dumps({"name":"RDKit","version":rdBase.rdkitVersion}))'], { encoding: 'utf8', timeout: 15000 }));
  const token = randomBytes(32).toString('hex');
  const child = spawn(python, ['-E', '-s', resolve(root, 'apps/scientific-viewer/backend/server.py')], {
    cwd: root, env: { ...process.env, PERO_APP_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  let server, stderr = '';
  child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-4000); });
  const lines = createInterface({ input: child.stdout });
  const ready = once(lines, 'line', { signal: AbortSignal.timeout(15000) }).then(([line]) => JSON.parse(line));
  const close = async () => {
    if (server?.listening) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
    lines.close();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exited;
  };
  try {
    const { port } = await Promise.race([ready, exited.then(() => { throw Error(stderr || 'Molecule backend exited before readiness'); })]);
    const backend = `http://127.0.0.1:${port}`;
    server = createServer(async (request, response) => {
      try {
        const path = new URL(request.url, 'http://localhost').pathname;
        if (path === '/api/molecules' && request.method === 'POST') {
          const chunks = []; for await (const chunk of request) chunks.push(chunk);
          const result = await fetch(backend + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pero-App-Token': token }, body: Buffer.concat(chunks) });
          response.writeHead(result.status, { 'Content-Type': 'application/json' }).end(await result.text());
          return;
        }
        if (path === '/host/sdk') {
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ name: 'scientific-viewer', version: '0.4.0', permissions: { api: ['/api'], events: [], host: [] } }));
          return;
        }
        if (path === '/') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(frame); return; }
        if (!path.startsWith('/frame/')) { response.writeHead(404).end(); return; }
        const file = resolve(dist, path.slice('/frame/'.length));
        if (!file.startsWith(dist + sep)) { response.writeHead(404).end(); return; }
        const bytes = await readFile(file);
        const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml' }[extname(file)] || 'application/octet-stream';
        response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(bytes);
      } catch (error) { response.writeHead(500, { 'Content-Type': 'text/plain' }).end(String(error)); }
    });
    // External binding is opt-in for the connected cloud browser; test runs stay loopback-only.
    const host = process.env.PERO_VIEWER_PREVIEW_HOST || '127.0.0.1';
    server.listen(0, host); await once(server, 'listening');
    return { url: `http://127.0.0.1:${server.address().port}`, port: server.address().port, engine, close };
  } catch (error) { await close(); throw error; }
}

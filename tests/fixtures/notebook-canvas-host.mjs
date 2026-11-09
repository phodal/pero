// Real installed Apps and Rust Host, with loopback HTTP in place of Electron's
// custom protocol. Only the trusted-shell confirmation callback is test-driven.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { AppCanvasRequests } from '../../desktop/src/main/app-canvas.ts';

const root = resolve(import.meta.dirname, '../..');

async function launchHost(directory) {
  const child = spawn(resolve(root, 'target/debug/pero-host'), ['--stdio'], {
    cwd: directory, stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, UV_OFFLINE: '1', PYTHONDONTWRITEBYTECODE: '1',
      PERO_SETTINGS_PATH: resolve(directory, 'settings.json'),
      PERO_APPS_ROOT: resolve(directory, 'apps'), PERO_BUILTIN_APPS_ROOT: '' },
  });
  const pending = new Map();
  const exited = new Promise(done => child.once('exit', done));
  const lines = createInterface({ input: child.stdout });
  const ready = Promise.withResolvers();
  const failed = error => {
    ready.reject(error);
    for (const operation of pending.values()) operation.reject(error);
    pending.clear();
  };
  child.once('error', failed);
  child.once('exit', code => failed(new Error(`Canvas Host exited (${code})`)));
  lines.on('line', line => {
    try {
      const event = JSON.parse(line);
      if (event.kind === 'ready') ready.resolve();
      if (event.kind === 'apps_result') pending.get(event.request_id)?.resolve(event.data);
    } catch (error) { failed(error); }
  });
  const readiness = setTimeout(() => failed(new Error('Canvas Host readiness timed out')), 15_000);
  try { await ready.promise; }
  catch (error) { child.kill(); throw error; }
  finally { clearTimeout(readiness); }
  return {
    async request(action, fields = {}) {
      const id = crypto.randomUUID(), operation = Promise.withResolvers();
      pending.set(id, operation);
      const timer = setTimeout(() => operation.reject(new Error(`Canvas Host ${action} timed out`)), 25_000);
      try {
        child.stdin.write(JSON.stringify({ method: 'apps', id, action, ...fields }) + '\n');
        const result = await operation.promise;
        if (!result.ok) throw new Error(result.error || `Host refused ${action}`);
        return result.value;
      } finally { clearTimeout(timer); pending.delete(id); }
    },
    async close() {
      if (child.exitCode === null) child.stdin.end();
      const timer = setTimeout(() => child.kill(), 10_000);
      try { await exited; } finally { clearTimeout(timer); lines.close(); }
    },
  };
}

/** No synthetic App projection, owner receipt or approval ticket enters here. */
export async function createNotebookCanvasHost(t) {
  const directory = await mkdtemp(resolve(tmpdir(), 'pero-notebook-canvas-browser-'));
  let host, server;
  const confirmations = [], requests = [];
  const canvas = new AppCanvasRequests(
    input => host.request('canvas', { name: 'notebook', request: input }),
    (summary, signal) => new Promise(done => {
      const confirmation = { summary, signal, settled: false, decide: allow => {
        if (confirmation.settled) return;
        confirmation.settled = true;
        signal.removeEventListener('abort', abort);
        done(allow);
      } };
      const abort = () => confirmation.decide(false);
      confirmations.push(confirmation);
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }),
  );
  t.after(async () => {
    canvas.close();
    if (server) await new Promise(done => { server.close(done); server.closeAllConnections(); });
    try { await host?.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  execFileSync(process.env.PERO_APP_PYTHON || 'python3',
    ['-I', '-m', 'venv', '--without-pip', resolve(directory, 'python')], { timeout: 30_000 });
  await writeFile(resolve(directory, 'settings.json'), JSON.stringify({ app_python: { default: resolve(directory, 'python') } }));
  host = await launchHost(directory);
  for (const name of ['notebook', 'data']) {
    const target = resolve(directory, 'sources', name);
    await mkdir(resolve(target, 'dist'), { recursive: true });
    await cp(resolve(root, 'apps', name, 'backend'), resolve(target, 'backend'), { recursive: true });
    await cp(resolve(root, 'apps', name, 'app.json'), resolve(target, 'app.json'));
    if (name === 'notebook') {
      await cp(resolve(root, 'apps/notebook/dist'), resolve(target, 'dist'), { recursive: true });
      await cp(resolve(root, 'packages/source-extraction/python/pero_source_tools.py'), resolve(target, 'backend/pero_source_tools.py'));
    } else {
      await mkdir(resolve(target, 'backend/_core'), { recursive: true });
      for (const name of ['dataset.py', 'view.py', 'chart_document.py'])
        await cp(resolve(root, 'harness/go/charts/python', name), resolve(target, 'backend/_core', name));
      // Data contributes bounded JSON, never an embedded HTML panel in this test.
      await writeFile(resolve(target, 'dist/index.html'), '<h1>Data backend owner</h1>');
    }
    await host.request('install', { path: target });
    await host.request('enable', { name });
  }
  const backendResponse = async (name, path, method = 'GET', body) => {
    const access = await host.request('resolve', { name });
    return fetch(access.backend.url + path, {
      method, headers: { 'X-Pero-App-Token': access.backend.token, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body }), signal: AbortSignal.timeout(20_000),
    });
  };
  const backend = async (name, path, body) => {
    const response = await backendResponse(name, path, body === undefined ? 'GET' : 'POST',
      body === undefined ? undefined : JSON.stringify(body));
    const value = await response.json();
    assert.equal(response.ok, true, JSON.stringify(value));
    return value;
  };
  const files = new Map(await Promise.all([
    ['/', 'index.html', 'text/html'], ['/index.js', 'index.js', 'text/javascript'], ['/index.css', 'index.css', 'text/css'],
  ].map(async ([path, name, type]) => [path, {
    body: await readFile(resolve(directory, 'sources/notebook/dist', name)), type,
  }])));
  server = createServer(async (request, response) => {
    try {
      const file = files.get(request.url);
      if (file) return response.writeHead(200, { 'Content-Type': file.type,
        'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:" }).end(file.body);
      if (request.url === '/host/sdk') {
        const value = await host.request('sdkcontext', { name: 'notebook' });
        return response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(value));
      }
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      if (request.url === '/host/canvas' && request.method === 'POST') {
        assert.ok(body?.length <= 65536);
        const input = JSON.parse(body), controller = new AbortController();
        const observed = { operation: input.operation, instance: input.instance, operationId: input.operationId };
        requests.push(observed);
        response.once('close', () => { if (!response.writableEnded) controller.abort(); });
        const value = await canvas.apply(input, controller.signal);
        observed.state = value.state;
        if (input.operation === 'mount') observed.instance = value.instance;
        return response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(value));
      }
      if (request.url?.startsWith('/api/')) {
        await host.request('apiaccess', { name: 'notebook', path: new URL(request.url, 'http://localhost').pathname });
        const result = await backendResponse('notebook', request.url, request.method, body);
        return response.writeHead(result.status, { 'Content-Type': 'application/json' }).end(await result.text());
      }
      response.writeHead(404).end();
    } catch (error) {
      if (!response.destroyed) response.writeHead(502, { 'Content-Type': 'text/plain' }).end(String(error));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    origin: `http://127.0.0.1:${server.address().port}`, confirmations, requests, backend,
    request: (action, fields) => host.request(action, fields),
    async restart() { canvas.close(); await host.close(); host = await launchHost(directory); },
    async changeDataDeclaration() {
      const path = resolve(directory, 'sources/data/app.json');
      const manifest = JSON.parse(await readFile(path, 'utf8'));
      manifest.version = '0.1.1';
      await writeFile(path, JSON.stringify(manifest));
      // Host's supported replacement flow retains domain data outside the package.
      await host.request('uninstall', { name: 'data' });
      await host.request('install', { path: resolve(directory, 'sources/data') });
      await host.request('enable', { name: 'data' });
    },
  };
}

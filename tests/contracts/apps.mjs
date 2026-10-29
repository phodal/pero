// One real stdio wiring check for App install, startup recovery and private resolution.
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../protocol/generated/host.schema.json' with { type: 'json' };

const root = resolve(import.meta.dirname, '../..');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-app-wire-'));
const source = resolve(temp, 'sample');
await mkdir(resolve(source, 'dist'), { recursive: true });
await writeFile(resolve(source, 'dist/index.html'), '<h1>Sample App</h1>');
await writeFile(resolve(source, 'app.json'), JSON.stringify({
  schemaVersion: 1, name: 'sample', version: '0.1.0', displayName: 'Sample App',
  contributes: { panels: [{ id: 'main', title: 'Sample', entry: 'dist/index.html' }] },
}));
const ajv = new Ajv2020({ strict: true, strictTypes: false });
ajv.addSchema(schema);
const validateInput = ajv.getSchema(`${schema.$id}#/$defs/AppRequest`);
const validateResult = ajv.getSchema(`${schema.$id}#/$defs/AppsResultEvent`);
const failures = [];
const preparePythonApp = async (name, dependency, sharedEnvironment) => {
  const environment = sharedEnvironment || resolve(temp, 'environments', name);
  if (!sharedEnvironment) {
    const python = process.env.PERO_APP_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    execFileSync(python, ['-I', '-m', 'venv', '--without-pip', environment], { timeout: 30000 });
    const executable = resolve(environment, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const packages = execFileSync(executable, ['-I', '-c', 'import sysconfig; print(sysconfig.get_path("purelib"))'], { encoding: 'utf8', timeout: 10000 }).trim();
    await writeFile(resolve(packages, 'paper_dependency.py'), `VALUE = ${JSON.stringify(dependency)}\n`);
  }
  const app = resolve(temp, name);
  await mkdir(resolve(app, 'dist'), { recursive: true });
  await mkdir(resolve(app, 'backend'));
  await writeFile(resolve(app, 'dist/index.html'), '<h1>Python environment fixture</h1>');
  await writeFile(resolve(app, 'backend/sibling.py'), 'VALUE = "app-local"\n');
  await writeFile(resolve(app, 'backend/server.py'), `
import json, os, site, subprocess, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from paper_dependency import VALUE as dependency
from sibling import VALUE as sibling

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_GET(self):
        if self.headers.get('X-Pero-App-Token') != os.environ['PERO_APP_TOKEN']:
            self.send_response(401); self.end_headers(); return
        child = subprocess.check_output(['python', '-E', '-s', '-c', 'from paper_dependency import VALUE; print(VALUE)'], timeout=5).decode().strip()
        body = json.dumps({'dependency': dependency, 'sibling': sibling,
                           'userSite': site.ENABLE_USER_SITE, 'prefix': sys.prefix,
                           'virtualEnv': os.environ.get('VIRTUAL_ENV'), 'childDependency': child}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

server = HTTPServer(('127.0.0.1', 0), Handler)
print(json.dumps({'port': server.server_port}), flush=True)
server.serve_forever()
`);
  await writeFile(resolve(app, 'app.json'), JSON.stringify({
    schemaVersion: 1, name, version: '0.1.0', displayName: name,
    contributes: { panels: [{ id: 'main', title: name, entry: 'dist/index.html' }] },
    backend: { type: 'python', entry: 'backend/server.py' },
  }));
  return { name, app, environment: await realpath(environment), dependency };
};
const launch = async ({ builtins = '', installed = resolve(temp, 'installed') } = {}) => {
  const child = spawn(resolve(root, 'target/debug/pero-host'), ['--stdio'], {
    cwd: temp, stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, PERO_SETTINGS_PATH: resolve(temp, 'settings.json'),
      PERO_APPS_ROOT: installed, PERO_BUILTIN_APPS_ROOT: builtins },
  });
  const exited = new Promise(done => child.once('exit', done));
  const pending = new Map();
  let ready;
  const started = new Promise(resolveReady => { ready = resolveReady; });
  createInterface({ input: child.stdout }).on('line', line => {
    const event = JSON.parse(line);
    if (event.kind === 'ready') ready();
    if (event.kind !== 'apps_result') return;
    if (!validateResult(event)) failures.push(ajv.errorsText(validateResult.errors));
    pending.get(event.request_id)?.(event.data);
  });
  await Promise.race([started, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('Host readiness timeout')), 10000); timer.unref();
  })]);
  return {
    request: async (action, fields = {}) => {
      const input = { method: 'apps', id: crypto.randomUUID(), action, ...fields };
      assert(validateInput(input), ajv.errorsText(validateInput.errors));
      return new Promise((resolveReply, reject) => {
        const timer = setTimeout(() => reject(new Error(`App ${action} timeout`)), 10000);
        pending.set(input.id, result => { clearTimeout(timer); pending.delete(input.id); resolveReply(result); });
        child.stdin.write(`${JSON.stringify(input)}\n`);
      });
    },
    close: () => { child.stdin.end(); return exited; },
  };
};
let host;
try {
  host = await launch();
  assert.deepEqual(await host.request('list'), { ok: true, value: [] });
  const installed = await host.request('install', { path: source });
  assert.equal(installed.value[0].name, 'sample');
  assert.equal(installed.value[0].enabled, false);
  assert.equal((await host.request('enable', { name: 'sample' })).ok, true);
  await host.close();
  host = await launch();
  assert.equal((await host.request('list')).value[0].enabled, true);
  const access = await host.request('resolve', { name: 'sample' });
  assert.equal(access.value.entry, 'dist/index.html');
  assert.equal(access.value.root, await realpath(resolve(temp, 'installed/sample')));
  assert.equal((await host.request('uninstall', { name: 'sample' })).value.length, 0);

  // Two Apps share the default environment; a third explicitly overrides it.
  // Identically named dependencies differ between the two environments.
  const apps = [await preparePythonApp('paper-alpha', 'alpha-v1'),
    await preparePythonApp('paper-beta', 'beta-v2')];
  apps.push(await preparePythonApp('paper-gamma', 'alpha-v1', apps[0].environment));
  await writeFile(resolve(temp, 'settings.json'), JSON.stringify({
    app_python: { default: apps[0].environment, apps: { 'paper-beta': apps[1].environment } },
  }));
  for (const { name, app } of apps) {
    const installed = await host.request('install', { path: app });
    assert.equal(installed.ok, true, installed.error);
    assert.equal((await host.request('enable', { name })).ok, true);
  }
  await host.close();
  host = await launch();
  for (const { name, environment, dependency } of apps) {
    const access = await host.request('resolve', { name });
    assert.equal(access.ok, true, access.error);
    const response = await fetch(`${access.value.backend.url}/api/environment`, {
      headers: { 'X-Pero-App-Token': access.value.backend.token }, signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    const observed = await response.json();
    assert.equal(observed.dependency, dependency);
    assert.equal(observed.sibling, 'app-local');
    assert.equal(observed.userSite, false);
    assert.equal(await realpath(observed.prefix), environment);
    assert.equal(await realpath(observed.virtualEnv), environment);
    assert.equal(observed.childDependency, dependency);
  }
  await host.close();
  await rm(apps[0].environment, { recursive: true });
  host = await launch();
  for (const name of ['paper-alpha', 'paper-gamma']) {
    const unavailable = await host.request('resolve', { name });
    assert.equal(unavailable.ok, false);
    assert.match(unavailable.error, /environment|venv/i);
    assert(unavailable.error.includes(apps[0].environment), unavailable.error);
  }
  assert.equal((await host.request('resolve', { name: 'paper-beta' })).ok, true);
  assert.equal((await host.request('disable', { name: 'paper-beta' })).ok, true);
  assert.equal((await host.request('enable', { name: 'paper-beta' })).ok, true);
  const configuration = resolve(apps[1].environment, 'pyvenv.cfg');
  await writeFile(configuration, (await readFile(configuration, 'utf8'))
    .replace(/^include-system-site-packages\s*=\s*false$/mi, 'include-system-site-packages = true'));
  const sharedPackages = await host.request('resolve', { name: 'paper-beta' });
  assert.equal(sharedPackages.ok, false);
  assert.match(sharedPackages.error, /system.site.packages/i);
  await host.close(); host = undefined;
  const builtins = resolve(temp, 'builtin-catalog'), builtinInstalledRoot = resolve(temp, 'auto-installed');
  await mkdir(builtins); await mkdir(builtinInstalledRoot);
  await writeFile(resolve(builtinInstalledRoot, '.builtins-seeded'), '1\n');
  const addBuiltin = async name => {
    const directory = resolve(builtins, name);
    await mkdir(resolve(directory, 'dist'), { recursive: true });
    await writeFile(resolve(directory, 'dist/index.html'), `<h1>${name}</h1>`);
    await writeFile(resolve(directory, 'app.json'), JSON.stringify({ schemaVersion: 1, name, version: '0.1.0', displayName: name,
      contributes: { panels: [{ id: 'main', title: name, entry: 'dist/index.html' }] } }));
  };
  host = await launch({ builtins, installed: builtinInstalledRoot });
  assert.deepEqual((await host.request('list')).value, []);
  await addBuiltin('paper-agent');
  let discovered = await host.request('list');
  assert.equal(discovered.ok, true, discovered.error);
  assert.deepEqual(discovered.value.map(app => [app.name, app.enabled]), [['paper-agent', true]]);
  assert.equal((await host.request('disable', { name: 'paper-agent' })).ok, true);
  await addBuiltin('later-app');
  // The original builtin was removed in this legacy profile, so stays absent.
  await addBuiltin('virtual-cell');
  discovered = await host.request('list');
  assert.deepEqual(discovered.value.map(app => [app.name, app.enabled]), [['later-app', true], ['paper-agent', false]]);
  assert.equal((await host.request('uninstall', { name: 'later-app' })).ok, true);
  await host.close(); host = undefined;
  host = await launch({ builtins, installed: builtinInstalledRoot });
  assert.deepEqual((await host.request('list')).value.map(app => [app.name, app.enabled]), [['paper-agent', false]]);
  assert.deepEqual(failures, []);
  console.log('App stdio wiring, generated contract, Python environments, incremental builtin discovery and retained disable/removal passed.');
} finally {
  if (host) await host.close();
  await rm(temp, { recursive: true, force: true });
}

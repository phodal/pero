// Production Viewer/SDK/Desktop carrier -> real Rust Host/ACP/Go tools -> Python.
// Only model decisions and Electron's custom-protocol HTTP bridge are fixtures.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { chromium, expect } from '@playwright/test';

const root = resolve(import.meta.dirname, '../..');
const output = resolve(root, 'test-results/shared-science');
const directory = await mkdtemp(resolve(tmpdir(), 'pero-shared-science-'));
const python = process.env.PERO_SCIENCE_PYTHON || 'python3';
const events = [], providerCalls = [], errors = [], checks = [];
const changed = new EventEmitter(), servers = [];
let host, desktop, browser, page, exited, stderr = '', sequence = 0, phase = 'setup';
const send = command => host.stdin.write(JSON.stringify(command) + '\n');
async function wait(predicate, after = 0) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const found = events.slice(after).find(predicate);
    if (found) return found;
    const remaining = deadline - Date.now();
    assert(remaining > 0, `Host timeout (${phase}): ${stderr}\n${JSON.stringify(events.slice(-4))}`);
    await new Promise((done, reject) => {
      const listener = () => { clearTimeout(timer); done(); };
      const timer = setTimeout(() => { changed.off('change', listener); reject(Error(`Host timeout: ${stderr}`)); }, remaining);
      changed.once('change', listener);
    });
  }
}
async function request(action, fields = {}) {
  const id = `science-${++sequence}`;
  send({ method: 'apps', action, id, ...fields });
  const event = await wait(event => event.kind === 'apps_result' && event.request_id === id);
  assert.equal(event.data.ok, true, event.data.error);
  return event.data.value;
}
const science = (sessionId, action, language = 'python', code) => request('agent', {
  name: 'scientific-viewer', request: { operation: 'science', sessionId, action, language, ...(code ? { code } : {}) },
});
async function prompt(thread, code) {
  const after = events.length;
  send({ action: 'prompt', thread_id: thread, text: 'SCIENCE_CODE:' + Buffer.from(code).toString('base64url') });
  const event = await wait(event => event.thread_id === thread && ['turn_finished', 'session_error'].includes(event.kind), after);
  assert.equal(event.kind, 'turn_finished', event.text);
  assert.equal(event.data.stopReason, 'end_turn', JSON.stringify(event));
}
async function listen(handler) {
  const server = createServer(handler); servers.push(server);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}
const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
try {
  await mkdir(output, { recursive: true });
  const provider = await listen(async (req, res) => {
    try {
      assert.equal(req.url, '/v1/chat/completions');
      let text = ''; for await (const chunk of req) text += chunk;
      const input = JSON.parse(text);
      const user = input.messages.findLastIndex(message => message.role === 'user');
      const match = /SCIENCE_CODE:([\w-]+)/.exec(JSON.stringify(input.messages[user].content));
      assert(match, 'Scripted provider requires an explicit test cell');
      const code = Buffer.from(match[1], 'base64url').toString();
      const result = input.messages.slice(user + 1).findLast(message => message.role === 'tool');
      providerCalls.push({ code, result: result?.content });
      assert(providerCalls.length < 32, 'Bounded loopback fixture');
      const delta = result ? { content: 'Agent observed: ' + result.content } : {
        tool_calls: [{ index: 0, id: `python-${providerCalls.length}`, type: 'function', function: { name: 'python', arguments: JSON.stringify({ code }) } }],
      };
      if (!result) assert(input.tools.some(tool => tool.function.name === 'python'));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: result ? 'stop' : 'tool_calls' }] })}\n\ndata: [DONE]\n\n`);
    } catch (error) { errors.push(String(error)); res.destroy(); }
  });
  const registry = resolve(directory, 'agents.json');
  await writeFile(registry, JSON.stringify([{ id: 'pero', name: 'Pero with scripted loopback provider',
    command: resolve(root, 'target/debug/pero-agent-acp'), args: [
      '--endpoint', provider + '/v1', '--model', 'fixture', '--session-dir', resolve(directory, 'sessions'),
      '--api-key-env', 'SCIENCE_FIXTURE_KEY', '--workspace', '{workspace}', '--science-python', python,
      '--approval', 'ask', '--max-retries', '0', '--max-requests', '16', '--max-tokens', '2048',
    ] }]));
  await writeFile(resolve(directory, 'settings.json'), '{}');
  await build({ stdin: { contents: "export {DesktopApps} from './desktop/src/main/apps.ts';", resolveDir: root },
    bundle: true, platform: 'node', format: 'esm', outfile: resolve(directory, 'desktop.mjs'), plugins: [{ name: 'loopback-network', setup(builder) {
      builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'loopback-network' }));
      builder.onLoad({ filter: /.*/, namespace: 'loopback-network' }, () => ({ contents: 'export const net={fetch:globalThis.fetch};' }));
    } }] });
  const { DesktopApps } = await import(resolve(directory, 'desktop.mjs'));
  desktop = new DesktopApps(send, () => {}, async () => undefined);
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PERO_') && !/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key)));
  host = spawn(resolve(root, 'target/debug/pero-host'), ['--stdio'], { cwd: directory,
    env: { ...cleanEnv, SCIENCE_FIXTURE_KEY: 'scripted-local-only', PERO_AGENTS_FILE: registry,
      PERO_APPS_ROOT: resolve(directory, 'apps'), PERO_BUILTIN_APPS_ROOT: '',
      PERO_SETTINGS_PATH: resolve(directory, 'settings.json'), PERO_HISTORY_PATH: resolve(directory, 'history.jsonl') },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  exited = once(host, 'exit'); host.stderr.on('data', chunk => { stderr += String(chunk); });
  createInterface({ input: host.stdout }).on('line', line => {
    const event = JSON.parse(line); events.push(event); desktop.accept(event); changed.emit('change');
    if (event.kind === 'permission') {
      const option = event.data.options.find(option => option.kind === 'allow_once');
      assert(option); send({ action: 'permission', thread_id: event.thread_id, request_id: event.data.permission_id, option_id: option.optionId });
    }
  });
  await wait(event => event.kind === 'ready');
  const source = resolve(directory, 'source'); await mkdir(source);
  for (const name of ['app.json', 'backend', 'dist']) await cp(resolve(root, 'apps/scientific-viewer', name), resolve(source, name), { recursive: true });
  await request('install', { path: source }); await request('enable', { name: 'scientific-viewer' });
  async function newSession(thread) {
    send({ action: 'new_session', thread_id: thread, agent_id: 'pero', scope: { app: 'scientific-viewer', panel: 'viewer' } });
    const event = await wait(event => event.thread_id === thread && ['session_ready', 'session_error'].includes(event.kind));
    assert.equal(event.kind, 'session_ready', event.text);
  }
  await newSession('science-a'); await newSession('science-b');
  await prompt('science-a', "shared_value = 10\nprint('agent-set:', shared_value)");
  await prompt('science-b', "shared_value = 900\nprint('isolated:', shared_value)");
  const dist = resolve(root, 'apps/scientific-viewer/dist');
  const origin = await listen(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (path.startsWith('/host/')) {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const response = await desktop.serve(new Request('pero-app://scientific-viewer' + path, {
          method: req.method, headers: { 'Content-Type': 'application/json', Origin: 'pero-app://scientific-viewer' },
          ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        }));
        res.writeHead(response.status, { 'Content-Type': response.headers.get('Content-Type') || 'text/plain' }).end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      const file = resolve(dist, path === '/' ? 'index.html' : '.' + path);
      assert(file.startsWith(dist + sep));
      const bytes = await readFile(file);
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' }[extname(file)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(bytes);
    } catch (error) { res.writeHead(502).end(String(error)); }
  });
  const notebook = { nbformat: 4, nbformat_minor: 5, metadata: { language_info: { name: 'python' } }, cells: [
    { cell_type: 'code', id: 'shared', metadata: {}, execution_count: null, outputs: [], source: "print('user-read:', shared_value)\nshared_value += 7\nprint('user-update:', shared_value)" },
  ] };
  await writeFile(resolve(output, 'shared-session.ipynb'), JSON.stringify(notebook, null, 2));
  browser = await chromium.launch({ headless: true, ...(process.env.PERO_CHROMIUM_PATH ? { executablePath: process.env.PERO_CHROMIUM_PATH } : {}) });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto(origin);
  await page.getByLabel('Import file', { exact: true }).setInputFiles({ name: 'shared-session.ipynb', mimeType: 'application/x-ipynb+json', buffer: Buffer.from(JSON.stringify(notebook)) });
  const history = page.getByLabel('Shared execution history', { exact: true });
  const button = name => page.getByRole('button', { name, exact: true });
  const edit = page.getByRole('textbox', { name: 'Code cell 1', exact: true });
  const run = async code => { await edit.fill(code); await button('Run cell 1').click(); await expect(button('Run cell 1')).toBeEnabled({ timeout: 20_000 }); };
  const shot = name => page.screenshot({ path: resolve(output, name + '.png'), fullPage: true });
  phase = 'shared-state';
  await expect(button('Agent session')).toHaveText('science-a');
  await expect(history).toContainText('agent-set: 10');
  await button('Run cell 1').click();
  await expect(history.locator('[data-origin=user]').last()).toContainText('user-read: 10');
  await expect(history.locator('[data-origin=user]').last()).toContainText('user-update: 17');
  await prompt('science-a', "print('agent-read:', shared_value)");
  await expect(history.locator('[data-origin=agent]').last()).toContainText('agent-read: 17');
  await shot('shared-state-light');
  checks.push('Agent sets Python variable, real Viewer reads/modifies it, Agent reads user update; both origins and output visible');
  phase = 'failure';
  await run("print('before-failure')\nraise ValueError('visible-failure')");
  await expect(history.locator('[data-origin=user]').last()).toContainText('before-failure');
  await expect(history.locator('[data-origin=user]').last()).toContainText('visible-failure');
  await expect(history.locator('[data-origin=user]').last()).toContainText('Failed');
  checks.push('Python stdout and failure remain in shared history');
  phase = 'interrupt-agent';
  const interrupted = prompt('science-a', "import pathlib, time\npathlib.Path('agent-running.ready').write_text('ready')\ntime.sleep(60)");
  await expect.poll(async () => readFile(resolve(directory, 'agent-running.ready'), 'utf8').catch(() => '')).toBe('ready');
  await button('Interrupt').click(); await interrupted;
  await expect(history.locator('[data-origin=agent]').last()).toContainText('Interrupted');
  await expect(button('Start shared kernel')).toBeVisible();
  await button('Start shared kernel').click();
  await run("print('cleared-after-interrupt:', 'shared_value' not in globals())");
  await expect(history.locator('[data-origin=user]').last()).toContainText('cleared-after-interrupt: True');
  checks.push('Notebook interrupts the Agent running real Python; process stops, state clears, history remains and Start recovers');
  phase = 'restart-close-isolation';
  await run('restart_value = 55'); await button('Restart kernel').click();
  await run("print('cleared-after-restart:', 'restart_value' not in globals())");
  await expect(history.locator('[data-origin=user]').last()).toContainText('cleared-after-restart: True');
  await button('Close kernel').click();
  await expect(button('Start shared kernel')).toBeVisible();
  assert.equal((await science('science-a', 'status')).status, 'closed');
  await prompt('science-b', "print('isolated-after-close:', shared_value)");
  assert.match(JSON.stringify((await science('science-b', 'status')).outputs), /isolated-after-close: 900/);
  await button('Agent session').click(); await page.getByRole('option', { name: 'science-b', exact: true }).click();
  await expect(history).toContainText('isolated-after-close: 900');
  await shot('isolated-session');
  // Switching files unmounts SharedNotebook; only explicit Close may stop its kernel.
  await button('Current file').click(); await page.getByRole('option', { name: 'Molecular illustrations', exact: true }).click();
  await prompt('science-b', "print('survived-unmount:', shared_value)");
  assert.match(JSON.stringify((await science('science-b', 'status')).outputs), /survived-unmount: 900/);
  await button('Current file').click(); await page.getByRole('option', { name: 'shared-session.ipynb', exact: true }).click();
  await button('Agent session').click(); await page.getByRole('option', { name: 'science-b', exact: true }).click();
  await expect(history).toContainText('survived-unmount: 900');
  checks.push('Restart clears variables; closing A leaves B=900; unmount/remount leaves B running and shows retained Agent history');
  phase = 'r-availability';
  await button('Kernel language').click(); await page.getByRole('option', { name: 'R', exact: true }).click();
  const rReply = page.waitForResponse(response => response.url() === origin + '/host/capability'
    && response.request().postDataJSON()?.input?.action === 'start');
  await button('Start shared kernel').click();
  const rState = await (await rReply).json();
  if (rState.status === 'unavailable') {
    await expect(page.getByText('Environment unavailable', { exact: true })).toBeVisible();
    await expect(page.getByText('Install R with Rscript available, then retry Start shared kernel, or select a prepared Python kernel.')).toBeVisible();
    await shot('r-unavailable');
    checks.push('Rscript absent: actual unavailable status, install/retry guidance and selectable Python recovery');
  } else {
    assert.equal(rState.status, 'idle');
    await run('shared_r <- 5; print(shared_r)');
    await expect(history.locator('[data-origin=user]').last()).toContainText('[1] 5');
    checks.push('Available R interpreter executes a real user cell through the shared session owner');
  }
  await button('Kernel language').click(); await page.getByRole('option', { name: 'Python', exact: true }).click();
  await expect(history).toContainText('survived-unmount: 900');
  phase = 'narrow-dark';
  await page.evaluate(() => window.postMessage({ type: 'pero:app:context', context: { locale: 'en', dark: true, active: true } }, location.origin));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'pero-dark');
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(button('Agent session')).toBeVisible();
  await expect(history).toContainText('survived-unmount: 900');
  assert.equal(await page.locator('html').evaluate(node => node.scrollWidth <= node.clientWidth + 1), true, 'Narrow shared Notebook must not overflow horizontally');
  await shot('shared-session-narrow-dark');
  checks.push('Production shared Notebook remains readable in 390px dark theme without horizontal page overflow');
  assert.deepEqual(errors, []);
  const report = { passed: true, checks, provider: 'scripted loopback, no real-model inference', python,
    hostSHA256: await hash(resolve(root, 'target/debug/pero-host')), harnessSHA256: await hash(resolve(root, 'target/debug/pero-agent-acp')),
    viewerSHA256: await hash(resolve(dist, 'index.js')), testSHA256: await hash(import.meta.filename), providerRequests: providerCalls.length,
    substitutions: ['Loopback HTTP replaces Electron protocol; production DesktopApps carrier used', 'Scripted model chooses python tool; real harness executes it', 'Approval responses driven through existing Host API'],
    unverified: ['Electron/Native GUI and signed packages', 'Scientific validity or real-provider decisions'],
  };
  await writeFile(resolve(output, 'verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, origin, directory }, null, 2));
  if (process.argv.includes('--serve')) {
    console.log('Shared session preview stays available; send stop to finish.');
    await new Promise(done => {
      const lines = createInterface({ input: process.stdin });
      lines.on('line', line => { if (line === 'stop') { lines.close(); process.stdin.pause(); done(); } });
    });
  }
} catch (error) {
  if (page) await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(resolve(output, 'failure.json'), JSON.stringify({ phase, error: String(error), stderr, errors, events: events.slice(-10) }, null, 2));
  throw error;
} finally {
  await browser?.close(); desktop?.close();
  if (host) {
    host.stdin.end(); const timer = setTimeout(() => host.kill(), 10_000);
    try { await exited; } finally { clearTimeout(timer); }
  }
  for (const server of servers) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  await rm(directory, { recursive: true, force: true });
}

// Scoped Desktop -> Go/PostgreSQL -> enrolled independent Worker acceptance.
// ACP fixture proves transport/execution controls, not scientific acceptance.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { createServer as createHTTPServer } from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';

export async function setup(database) {
  if (!database) throw new Error('Set PERO_TEST_DATABASE_URL to an isolated PostgreSQL database');
  const root = resolve(import.meta.dirname, '../..');
  const out = resolve(root, 'test-results/self-hosted-machines/desktop');
  const temp = await mkdtemp(resolve(tmpdir(), 'pero-machines-'));
  await mkdir(out, { recursive: true });
  const namespace = `machines_${randomUUID().replaceAll('-', '')}`;
  execFileSync('psql', [database, '-v', 'ON_ERROR_STOP=1', '-c', `CREATE SCHEMA "${namespace}"`], { stdio: 'pipe' });
  const db = new URL(database); db.searchParams.set('search_path', namespace);
  const port = await new Promise(done => {
    const socket = createServer(); socket.listen(0, '127.0.0.1', () => {
      const port = socket.address().port; socket.close(() => done(port));
    });
  });
  const base = `http://127.0.0.1:${port}`;
  const operator = randomUUID();
  const serverBin = resolve(temp, 'pero-server');
  execFileSync('go', ['build', '-o', serverBin, './cmd/server'], { cwd: resolve(root, 'server'), stdio: 'pipe' });
  const agents = resolve(temp, 'agents.json');
  await writeFile(agents, JSON.stringify([{ id: 'fixture', name: 'ACP fixture', command: process.execPath, args: [resolve(root, 'tests/fixtures/acp-agent.mjs')] }]));
  await writeFile(resolve(temp, 'worker.json'), JSON.stringify({ workspaces: { repo: temp }, agents_file: agents }));
  const children = [];
  let app;
  let proxy;
  let dropCreationReply = true;
  const creationAttempts = [];
  let logs = '';
  const start = (bin, args, env) => {
    const child = spawn(bin, args, { cwd: temp, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderr.on('data', data => { logs = (logs + data).slice(-16000); });
    children.push(child);
    return child;
  };
  const stop = async child => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    await new Promise(done => {
      const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
      child.once('exit', () => { clearTimeout(timeout); done(); });
    });
  };
  const close = async () => {
    if (app) await app.close();
    if (proxy) { proxy.closeAllConnections(); await new Promise(done => proxy.close(done)); }
    for (const child of children.reverse()) await stop(child);
    execFileSync('psql', [database, '-v', 'ON_ERROR_STOP=1', '-c', `DROP SCHEMA "${namespace}" CASCADE`], { stdio: 'pipe' });
  };
  try {
    start(serverBin, [], { ...process.env, PERO_DATABASE_URL: db.href, PERO_OPERATOR_TOKEN: operator, PERO_LISTEN: `127.0.0.1:${port}`, PERO_LEASE_SECONDS: '12' });
    await expect.poll(async () => { try { return (await fetch(base + '/healthz')).status; } catch { return 0; } }, { timeout: 15000 }).toBe(200);
    const request = async (path, method = 'GET', body, token = operator) => {
      const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const value = await response.json();
      expect(response.ok, JSON.stringify(value)).toBe(true);
      return value;
    };
    const client = await request('/api/v1/clients', 'POST', { name: 'Researcher', projects: ['team'] });
    const enroll = async (name, agent) => request('/api/client/v1/workers', 'POST', {
      name, device_id: randomUUID(), request_id: randomUUID(), enrollment_secret: randomBytes(32).toString('hex'),
      projects: ['team'], capabilities: [{ project_id: 'team', workspace_key: 'repo', agent_id: agent }],
    }, client.token);
    const chosen = await enroll('Research machine', 'fixture');
    const incompatible = await enroll('Other capability', 'other-agent');
    const bystander = await enroll('Compatible spare', 'fixture');
    const contact = await request('/api/worker/v1/claims', 'POST', { request_id: randomUUID(), instance_id: 'idle-observer' }, chosen.token);
    expect(contact.run).toBeNull();
    proxy = createHTTPServer(async (incoming, outgoing) => {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const response = await fetch(base + incoming.url, {
        method: incoming.method,
        headers: { Authorization: incoming.headers.authorization || '', 'Content-Type': 'application/json',
          ...(incoming.headers['idempotency-key'] ? { 'Idempotency-Key': incoming.headers['idempotency-key'] } : {}) },
        ...(['GET','HEAD'].includes(incoming.method) ? {} : { body: Buffer.concat(chunks) }),
      });
      const body = Buffer.from(await response.arrayBuffer());
      if (incoming.method === 'POST' && incoming.url === '/api/client/v1/tasks') {
        creationAttempts.push({ key: incoming.headers['idempotency-key'], task: JSON.parse(body).id });
        if (dropCreationReply) { dropCreationReply = false; outgoing.destroy(); return; }
      }
      outgoing.writeHead(response.status, { 'Content-Type': 'application/json' }); outgoing.end(body);
    });
    await new Promise(done => proxy.listen(0, '127.0.0.1', done));
    const desktopURL = `http://127.0.0.1:${proxy.address().port}`;
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('PERO_')) delete env[key];
    Object.assign(env, { PERO_CLOUD_URL: desktopURL, PERO_CLIENT_TOKEN: client.token, PERO_DESKTOP_DATA_DIR: resolve(temp, 'profile'), PERO_SETTINGS_PATH: resolve(temp, 'settings.json'), PERO_HISTORY_PATH: resolve(temp, 'history.jsonl'), PERO_AGENTS_FILE: agents, PERO_LOCALE: 'zh-CN' });
    app = await electron.launch({ executablePath: process.env.PERO_TEST_ELECTRON_EXECUTABLE, args: [resolve(root, 'desktop')], cwd: root, env });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900));
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const state = () => page.evaluate(() => window.peroDiagnostics ? JSON.parse(window.peroDiagnostics.snapshot()) : { ready: false });
    await expect.poll(async () => (await state()).ready, { timeout: 60000 }).toBe(true);
    await page.locator('#loading').waitFor({ state: 'detached', timeout: 60000 });
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('remote-tasks').click());
    await expect.poll(async () => (await state()).remote.state.workers.length, { timeout: 15000 }).toBe(3);
    expect((await state()).remote.state.identity.role).toBe('client');
    const assertTarget = async () => {
      const attempt = await request('/api/worker/v1/claims', 'POST', { request_id: randomUUID(), instance_id: 'spare-observer' }, bystander.token);
      expect(attempt.run).toBeNull();
    };
    const startWorker = () => start(resolve(root, 'target/debug/pero-worker'), ['--once'], {
      ...env, PERO_WORKER_TOKEN: chosen.token, PERO_WORKER_CONFIG: resolve(temp, 'worker.json'), PERO_WORKER_STATE: resolve(temp, `worker-${randomUUID()}.json`),
    });
    const frame = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    const screenshot = async name => { await frame(); return page.screenshot({ path: resolve(out, `${name}.png`), scale: 'css' }); };
    return { root, out, app, page, state, screenshot, request, chosen, incompatible, startWorker, assertTarget, stop, close, frame, creationAttempts, errors, logs: () => logs };
  } catch (error) {
    console.error(logs);
    await close();
    throw error;
  }
}

export async function run(database) {
  const test = await setup(database);
  const { page, app, state, screenshot } = test;
  const click = async (x,y) => { await page.mouse.click(x,y); await test.frame(); };
  const until = fn => expect.poll(async () => fn(await state()), { timeout: 30000 });
  const create = async (title, prompt, retry = false) => {
    await click(1228, 138);
    await until(s => s.remote.creating).toBe(true);
    await test.frame();
    await page.keyboard.insertText(title);
    await click(300, 292); await page.keyboard.insertText(prompt);
    await until(s => s.remote.prompt).toBe(prompt);
    await click(285, 450); await page.keyboard.insertText('返回回复并保留执行事件');
    await until(s => s.remote.acceptance).toBe('返回回复并保留执行事件');
    await click(450, 633);
    await until(s => s.remote.target_worker).toBe(test.chosen.worker.id);
    expect((await state()).remote.workspace).toBe('repo');
    expect((await state()).remote.agent).toBe('fixture');
    await screenshot('create-form');
    await click(305, 750);
    if (retry) {
      await until(s => !!s.remote.state.error).toBe(true);
      expect((await state()).remote.creating).toBe(true);
      expect((await state()).remote.title).toBe(title);
      expect((await state()).remote.prompt).toBe(prompt);
      await screenshot('creation-retry');
      await click(305, (await state()).remote.state.error ? 788 : 750);
    }
    await until(s => s.remote.creating).toBe(false);
    await until(s => s.remote.state.detail?.task.title).toBe(title);
    const created = (await state()).remote.state.detail.task;
    expect(created.claimed_by.id).toBe((await state()).remote.state.identity.id);
    // Open the real task tab; creation itself leaves the task list visible.
    await click(400, 283);
    await test.frame();
    await screenshot('target-detail');
    return created;
  };
  try {
    await screenshot('initial');
    const completed = await create('自托管机器验收', '你好，请返回 fixture 回复', true);
    expect(test.creationAttempts.length).toBe(2);
    expect(test.creationAttempts[0]).toEqual(test.creationAttempts[1]);
    expect((await state()).remote.state.tasks.length).toBe(1);
    await click(470, 395);
    await until(s => s.remote.target_worker).toBe(test.chosen.worker.id);
    await click(485, 423);
    await until(s => s.remote.state.detail?.task.state).toBe('queued');
    await test.assertTarget();
    const worker = test.startWorker();
    await until(s => s.remote.state.detail?.task.state).toBe('succeeded');
    let detail = (await state()).remote.state.detail;
    expect(detail.run.worker_id).toBe(test.chosen.worker.id);
    expect(detail.events.some(event => event.kind === 'session_update')).toBe(true);
    await screenshot('completed');
    await test.stop(worker);
    await click(770, 138);
    await test.frame();
    await create('停止自托管任务', 'wait');
    await click(470, 395);
    await click(485, 423);
    await until(s => s.remote.state.detail?.task.state).toBe('queued');
    test.startWorker();
    await until(s => s.remote.state.detail?.task.state).toBe('running');
    await screenshot('running');
    await until(s => s.remote.state.workers.find(w => w.id === test.chosen.worker.id)?.occupied).toBe(true);
    await click(307, 373);
    await until(s => s.remote.confirm_cancel !== null).toBe(true);
    await screenshot('cancel-confirmation');
    await click(580, 373);
    await until(s => s.remote.state.detail?.task.state).toBe('cancelled');
    await screenshot('cancelled');
    await click(470, 97); await click(770, 390);
    await until(s => s.settingsOpen).toBe(true);
    await screenshot('workers-idle');
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('locale-en').click());
    await until(s => s.locale).toBe('en');
    await page.evaluate(preferences => window.pero.sessionCommand({ method: 'settings.workbench', preferences }), { ...(await state()).preferences, appearance: 'dark' });
    await until(s => s.dark).toBe(true);
    await screenshot('workers-dark');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 788));
    await screenshot('workers-narrow');
    await page.keyboard.press('Escape'); await until(s => s.settingsOpen).toBe(false); await test.frame();
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('remote-tasks').click());
    await test.frame();
    // Observe the closing animation settle instead of pausing for a guessed duration.
    let previous;
    await expect.poll(async () => {
      const pixels = await page.screenshot({ scale: 'css' });
      const unchanged = previous?.equals(pixels) ?? false;
      previous = pixels;
      return unchanged;
    }, { timeout: 5000, intervals: [100] }).toBe(true);
    await screenshot('tasks-narrow');
    expect(test.errors).toEqual([]);
    const final = (await state()).remote;
    expect(final.state.tasks.length).toBe(2);
    await writeFile(resolve(test.out, 'result.json'), JSON.stringify({ checks: [
      'scoped client creation and atomic claim', 'lost creation response retry with same receipt',
      'explicit target excludes compatible spare', 'independent Worker ACP events',
      'online occupied and unknown observation', 'confirmed cancellation', 'light/dark/narrow',
    ], remote: final, errors: test.errors }, null, 2));
    console.log(JSON.stringify({ completed: completed.id, tasks: final.state.tasks.length, errors: test.errors }));
  } catch (error) {
    await screenshot('failure');
    console.error(JSON.stringify((await state()).remote));
    console.error(test.logs());
    throw error;
  } finally {
    await test.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await run(process.env.PERO_TEST_DATABASE_URL);

// Shared loopback control plane and independent Worker for the desktop shells.
import { expect } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer as createHTTPServer } from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';

const root = resolve(import.meta.dirname, '../..');

export async function setupSelfHostedMachines(database, {
  workerBinary = resolve(root, 'target/debug/pero-worker'),
  outputDirectory = resolve(root, 'test-results/self-hosted-machines/desktop'),
} = {}) {
  if (!database) throw new Error('Set PERO_TEST_DATABASE_URL to an isolated PostgreSQL database');
  const temp = await mkdtemp(resolve(tmpdir(), 'pero-machines-'));
  const out = resolve(outputDirectory);
  const namespace = `machines_${randomUUID().replaceAll('-', '')}`;
  const operator = randomUUID();
  const serverBin = resolve(temp, 'pero-server');
  const agents = resolve(temp, 'agents.json');
  const config = resolve(temp, 'worker.json');
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('PERO_')) delete env[key];

  const children = [];
  const creationAttempts = [];
  const dispatches = [];
  let dropCreationReply = true;
  let schemaCreated = false;
  let proxy;
  let logs = '';

  const start = (bin, args, processEnv) => {
    const child = spawn(bin, args, { cwd: temp, env: processEnv, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', data => { logs = (logs + data).slice(-16000); });
    child.on('error', error => { logs = (logs + error.message).slice(-16000); });
    children.push(child);
    return child;
  };
  const stop = async child => {
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise(done => {
      const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
      child.once('exit', () => { clearTimeout(timeout); done(); });
      child.kill('SIGTERM');
    });
  };
  const close = async () => {
    try {
      if (proxy) await new Promise(done => { proxy.close(done); proxy.closeAllConnections(); });
      for (const child of children.reverse()) await stop(child);
      if (schemaCreated) {
        execFileSync('psql', [database, '-v', 'ON_ERROR_STOP=1', '-c', `DROP SCHEMA "${namespace}" CASCADE`], { stdio: 'pipe' });
      }
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  };

  try {
    await mkdir(out, { recursive: true });
    execFileSync('psql', [database, '-v', 'ON_ERROR_STOP=1', '-c', `CREATE SCHEMA "${namespace}"`], { stdio: 'pipe' });
    schemaCreated = true;
    const db = new URL(database);
    db.searchParams.set('search_path', namespace);
    execFileSync('go', ['build', '-o', serverBin, './cmd/server'], { cwd: resolve(root, 'server'), stdio: 'pipe' });
    await writeFile(agents, JSON.stringify([{ id: 'fixture', name: 'ACP fixture', command: process.execPath, args: [resolve(root, 'tests/fixtures/acp-agent.mjs')] }]));
    await writeFile(config, JSON.stringify({ workspaces: { repo: temp }, agents_file: agents }));
    const server = start(serverBin, [], {
      ...env, PERO_DATABASE_URL: db.href, PERO_OPERATOR_TOKEN: operator,
      PERO_LISTEN: '127.0.0.1:0', PERO_LEASE_SECONDS: '12',
    });
    let address;
    await expect.poll(() => {
      if (!server.pid || server.exitCode !== null || server.signalCode !== null) {
        throw new Error('Go control plane exited before binding a loopback address');
      }
      address = /Pero control plane listening on (127\.0\.0\.1:[1-9]\d*)\r?\n/.exec(logs)?.[1];
      return address;
    }, { timeout: 15000 }).toBeDefined();
    const base = `http://${address}`;
    await expect.poll(async () => { try { return (await fetch(base + '/healthz')).status; } catch { return 0; } }, { timeout: 15000 }).toBe(200);
    const request = async (path, method = 'GET', body, token = operator) => {
      const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const value = await response.json();
      expect(response.ok, JSON.stringify(value)).toBe(true);
      return value;
    };
    const client = await request('/api/v1/clients', 'POST', { name: 'Researcher', projects: ['team'] });
    const enroll = (name, agent) => request('/api/client/v1/workers', 'POST', {
      name, device_id: randomUUID(), request_id: randomUUID(), enrollment_secret: randomBytes(32).toString('hex'),
      projects: ['team'], capabilities: [{ project_id: 'team', workspace_key: 'repo', agent_id: agent }],
    }, client.token);
    const chosen = await enroll('Research machine', 'fixture');
    const incompatible = await enroll('Other capability', 'other-agent');
    const bystander = await enroll('Compatible spare', 'fixture');
    const contact = await request('/api/worker/v1/claims', 'POST', { request_id: randomUUID(), instance_id: 'idle-observer' }, chosen.token);
    expect(contact.run).toBeNull();

    proxy = createHTTPServer(async (incoming, outgoing) => {
      try {
        const chunks = [];
        for await (const chunk of incoming) chunks.push(chunk);
        const requestBody = Buffer.concat(chunks);
        const response = await fetch(base + incoming.url, {
          method: incoming.method,
          headers: { Authorization: incoming.headers.authorization || '', 'Content-Type': 'application/json',
            ...(incoming.headers['idempotency-key'] ? { 'Idempotency-Key': incoming.headers['idempotency-key'] } : {}) },
          ...(['GET', 'HEAD'].includes(incoming.method) ? {} : { body: requestBody }),
        });
        const body = Buffer.from(await response.arrayBuffer());
        if (response.ok && incoming.method === 'POST' && incoming.url === '/api/client/v1/tasks') {
          creationAttempts.push({ key: incoming.headers['idempotency-key'], task: JSON.parse(body).id });
          if (dropCreationReply) { dropCreationReply = false; outgoing.destroy(); return; }
        }
        if (response.ok && incoming.method === 'POST') {
          const target = /^\/api\/client\/v1\/tasks\/([^/]+)\/dispatch$/.exec(incoming.url);
          if (target) dispatches.push({ task: target[1], worker: JSON.parse(requestBody).worker_id });
        }
        outgoing.writeHead(response.status, { 'Content-Type': 'application/json' });
        outgoing.end(body);
      } catch (error) {
        logs = (logs + error.message).slice(-16000);
        outgoing.destroy();
      }
    });
    await new Promise((done, reject) => {
      proxy.once('error', reject);
      proxy.listen(0, '127.0.0.1', done);
    });
    const url = `http://127.0.0.1:${proxy.address().port}`;
    const assertTarget = async () => {
      const attempt = await request('/api/worker/v1/claims', 'POST', { request_id: randomUUID(), instance_id: 'spare-observer' }, bystander.token);
      expect(attempt.run).toBeNull();
    };
    const startWorker = () => start(resolve(workerBinary), ['--once'], {
      ...env, PERO_CLOUD_URL: url, PERO_WORKER_TOKEN: chosen.token,
      PERO_WORKER_CONFIG: config, PERO_WORKER_STATE: resolve(temp, `worker-${randomUUID()}.json`),
    });
    return { root, out, base, url, temp, env, agents, client, request, chosen, incompatible, bystander,
      startWorker, assertTarget, stop, close, creationAttempts, dispatches, logs: () => logs };
  } catch (error) {
    console.error(logs);
    try {
      await close();
    } catch (cleanupError) {
      console.error('Shared fixture cleanup failed', cleanupError);
    }
    throw error;
  }
}

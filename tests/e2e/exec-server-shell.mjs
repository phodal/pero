// Opt-in macOS Desktop acceptance. Only the model's two tool choices are scripted.
import { expect } from '@playwright/test';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { electron } from './electron.mjs';
import { setupSelfHostedMachines } from './self-hosted-machines-fixture.mjs';

if (process.platform !== 'darwin') throw new Error('This fixture provisions a macOS strict sandbox');
const codex = await realpath(process.env.PERO_TEST_CODEX_EXECUTABLE);
const root = resolve(import.meta.dirname, '../..');
const version = execFileSync(codex, ['--version'], { encoding: 'utf8' }).trim();
const test = await setupSelfHostedMachines(process.env.PERO_TEST_DATABASE_URL, {
  workerBinary: process.env.PERO_WORKER_BIN, outputDirectory: resolve(root, 'test-results/exec-server-shell'),
});
const privateDir = await mkdtemp(resolve(homedir(), '.pero-exec-server-test-'));
const workspace = resolve(privateDir, 'workspace');
const marker = randomUUID();
const commands = [
  'if { read -r token < ../outside; } 2>/dev/null; then exit 13; fi; read -r token < marker; printf "out-%s\\n" "$token"; printf "err-%s\\n" "$token" >&2',
  'read -r token < marker; printf "partial-out-%s\\n" "$token"; printf "partial-err-%s\\n" "$token" >&2; /bin/sleep 120 & child=$!; printf "%s %s\\n" "$$" "$child" > pids; wait "$child"',
];
const shellReceipts = [];
let calls = 0;
const provider = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const messages = JSON.parse(body).messages;
  const last = messages.at(-1);
  if (last?.role === 'tool') shellReceipts.push(last.content);
  const command = commands[calls++];
  const delta = command ? { tool_calls: [{ index: 0, id: 'shell-' + calls, type: 'function',
    function: { name: 'shell', arguments: JSON.stringify({ command, timeout_ms: 120000 }) } }] } : { content: 'Done' };
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.end('data: ' + JSON.stringify({ id: 'fixture', model: 'fixture', object: 'chat.completion.chunk',
    choices: [{ index: 0, delta, finish_reason: command ? 'tool_calls' : 'stop' }] }) + '\n\ndata: [DONE]\n\n');
});
let app, page, taskId;
try {
  await mkdir(workspace);
  await writeFile(resolve(privateDir, 'outside'), 'outside the declared workspace\n');
  await writeFile(resolve(workspace, 'marker'), marker + '\n');
  await new Promise((ok, fail) => provider.once('error', fail).listen(0, '127.0.0.1', ok));
  const binary = resolve(privateDir, 'pero-agent-acp');
  execFileSync('go', ['build', '-o', binary, './cmd/pero-agent-acp'], { cwd: resolve(root, 'harness/go') });
  const args = ['--workspace', workspace, '--session-dir', resolve(privateDir, 'sessions'), '--enable-shell',
    '--shell-exec-server', codex, '--sandbox', 'strict-workspace-write', '--sandbox-runtime', '/bin/bash',
    '--sandbox-runtime', '/bin/sleep', '--sandbox-runtime', '/usr/bin/env', '--sandbox-runtime', '/usr/bin/true',
    '--endpoint', 'http://127.0.0.1:' + provider.address().port + '/v1', '--model', 'fixture', '--pdf-renderer', '-'];
  const env = { AGENT_PROVIDER_API_KEY: 'loopback-fixture' };
  const agents = resolve(privateDir, 'agents.json'), config = resolve(privateDir, 'worker.json');
  await writeFile(agents, JSON.stringify([{ id: 'fixture', name: 'Pero Go harness', command: binary, args, env }]));
  const sha256 = createHash('sha256').update(await readFile(binary)).digest('hex');
  await writeFile(config, JSON.stringify({ workspaces: { repo: workspace }, agents_file: agents,
    native_approvals: { repo: { agent_id: 'fixture', executable: binary, args, env, sha256,
      operations: ['shell'], sandbox_mode: 'workspace-write' } } }));

  app = await electron.launch({ args: [resolve(root, 'desktop')], cwd: root, env: { ...test.env,
    PERO_HOST_EXECUTABLE: process.env.PERO_HOST_EXECUTABLE || resolve(root, 'target/debug/pero-host'),
    PERO_LOCALE: 'zh-CN', PERO_CLOUD_URL: test.url, PERO_CLIENT_TOKEN: test.client.token, PERO_DESKTOP_DATA_DIR: resolve(test.temp, 'desktop'),
    PERO_SETTINGS_PATH: resolve(test.temp, 'settings.json'), PERO_HISTORY_PATH: resolve(test.temp, 'history.jsonl') } });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900));
  page = await app.firstWindow();
  const snapshot = () => page.evaluate(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()));
  await expect.poll(async () => (await snapshot())?.ready, { timeout: 60000 }).toBe(true);
  const desktop = cmd => page.evaluate(value => window.pero.remoteCommand(value), cmd);
  const task = await test.request('/api/client/v1/tasks', 'POST', { title: 'Exec-server shell', prompt: 'Run the shell checks',
    acceptance: 'Capture output and cancel', project_id: 'team', workspace_key: 'repo', agent_id: 'fixture' }, test.client.token);
  taskId = task.id;
  await desktop({ action: 'remote_dispatch', task_id: taskId, worker_id: test.chosen.worker.id });
  const detail = () => test.request('/api/client/v1/tasks/' + taskId, 'GET', undefined, test.client.token);
  expect((await detail()).run.status).toBe('queued');
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('remote-tasks').click());
  await expect.poll(async () => (await snapshot()).remote.state.tasks.some(t => t.id === taskId)).toBe(true);
  await page.mouse.click(400, 283);
  test.startWorker(config);
  const pidFile = resolve(workspace, 'pids');
  await expect.poll(async () => readFile(pidFile, 'utf8').catch(() => ''), { timeout: 30000 }).toMatch(/^\d+ \d+\n$/);
  const [shell, child] = (await readFile(pidFile, 'utf8')).trim().split(' ').map(Number);
  const ps = (pid, field) => execFileSync('/bin/ps', ['-p', String(pid), '-o', field + '='], { encoding: 'utf8' }).trim();
  expect(Number(ps(child, 'ppid'))).toBe(shell);
  const broker = Number(ps(shell, 'ppid'));
  expect(ps(broker, 'command')).toContain(codex + ' exec-server');
  const agent = Number(ps(broker, 'ppid'));
  expect(ps(agent, 'command')).toContain(binary);
  const executor = Number(ps(agent, 'ppid'));
  expect(ps(executor, 'command')).toContain('pero-worker --execute');
  const first = JSON.parse(shellReceipts[0]);
  expect(first).toMatchObject({ exitCode: 0, enforcement: 'full', readIsolated: true, networkIsolated: true,
    stdout: { text: 'out-' + marker + '\n', truncated: false },
    stderr: { text: 'err-' + marker + '\n', truncated: false } });
  await expect.poll(async () => (await snapshot()).remote.state.detail?.run?.status).toBe('running');
  await page.mouse.click(307, 373);
  await expect.poll(async () => (await snapshot()).remote.confirm_cancel).toBe(taskId);
  await page.screenshot({ path: resolve(test.out, 'cancel-confirmation.png') });
  await page.mouse.click(580, 373);
  await expect.poll(async () => (await detail()).run.status, { timeout: 20000 }).toBe('cancelled');
  const final = await detail();
  expect(final.task.state).toBe('cancelled');
  expect(final.run.summary).toBe('Cancellation requested by Cloud');
  const storedOutput = final.events.find(e => e.data?.toolCallId === 'shell-1' && e.data?.status === 'completed');
  expect(JSON.parse(storedOutput.data.content[0].content.text)).toEqual(first);
  const partial = final.events.find(e => e.data?.toolCallId === 'shell-2' && e.data?.status === 'failed');
  expect(partial?.text).toBe(`stdout\npartial-out-${marker}\nstderr\npartial-err-${marker}`);
  expect(JSON.parse(partial.data.content[0].content.text).result).toMatchObject({
    aborted: true, timedOut: false,
    stdout: { text: 'partial-out-' + marker + '\n', truncated: false },
    stderr: { text: 'partial-err-' + marker + '\n', truncated: false },
  });
  expect(final.run.worker_id).toBe(test.chosen.worker.id);
  const pids = [executor, agent, broker, shell, child];
  const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { if (e.code === 'ESRCH') return false; throw e; } };
  await expect.poll(() => pids.filter(alive), { timeout: 5000 }).toEqual([]);

  await expect.poll(async () => (await snapshot()).remote.state.detail?.run?.status).toBe('cancelled');
  await desktop({ action: 'remote_refresh' });
  await expect.poll(async () => (await snapshot()).remote.state.detail?.events
    .find(e => e.seq === partial.seq)?.text).toBe(partial.text);
  await page.screenshot({ path: resolve(test.out, 'cancelled.png') });
  const report = { version, run: final.run, events: final.events, shellReceipts, pids, processes: { executor, agent, broker, shell, child }, liveAfterCancel: pids.filter(alive),
    partialOutputInRun: true, marker };
  await writeFile(resolve(test.out, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ run: final.run.id, status: final.run.status, pids, partialOutputInRun: report.partialOutputInRun }));
} catch (error) {
  if (page) await page.screenshot({ path: resolve(test.out, 'failure.png') });
  if (taskId) console.error(JSON.stringify(await test.request('/api/client/v1/tasks/' + taskId, 'GET', undefined, test.client.token)).slice(-10000));
  console.error(test.logs(), JSON.stringify(shellReceipts));
  throw error;
} finally {
  try { await app?.close(); } finally {
    try { await test.close(); } finally {
      provider.closeAllConnections();
      await new Promise(done => provider.close(done));
      await rm(privateDir, { recursive: true, force: true });
    }
  }
}

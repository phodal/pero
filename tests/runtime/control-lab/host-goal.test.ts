// Real Host and ACP process, with a scripted model and simulated App backend.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { runInNewContext } from 'node:vm';
import { DesktopAppUse } from '../../../desktop/src/main/app-use-mcp.ts';

test('real Host user_message activates only the submitted frozen target before ACP uses MCP', { timeout: 30000 }, async () => {
  const root = resolve(import.meta.dirname, '../../..'), temp = await mkdtemp(resolve(tmpdir(), 'pero-goal-host-'));
  const thread = 'goal-host', scope = { app: 'control-lab', panel: 'main' }, experimentId = 'a'.repeat(32), specHash = 'b'.repeat(64);
  const surface = { ...scope, surfaceId: 'control-lab:main', instance: 'i', visible: true, active: true, operable: true,
    rect: { x: 0, y: 0, width: 1, height: 1 } };
  const window = { webContents: { mainFrame: { frames: [] }, executeJavaScript: (expression: string) => runInNewContext(expression, { window: {
    peroDiagnostics: { snapshot: () => JSON.stringify({ chats: [{ id: thread }], activeChat: 0 }) },
    peroAppUse: ({ request }: { request: { action: string } }) => ({ ok: true, value: request.action === 'status' ? surface : {
      objects: [{ id: 'control-lab', revision: 1, kind: 'engineering-experiment', label: 'Control Lab', state: { experimentId, specHash } }],
    } }),
  } }) } };
  const applied: unknown[] = [], definition = { app: scope.app, panel: scope.panel, version: '1', name: 'experiment-step',
    description: '', path: '/api/agent-step', schema: { type: 'object', required: ['action', 'experimentId'],
      properties: { action: { type: 'string' }, experimentId: { type: 'string' } }, additionalProperties: false } };
  const desktop = new DesktopAppUse(() => window as never, () => {}, temp, { describe: async () => [definition],
    apply: async (_write, _signal, goal) => { applied.push(goal); return { ok: true }; } });
  const endpoint = await desktop.start();
  // Scoped sessions require an installed App/panel, even when its backend is simulated.
  const builtins = resolve(temp, 'builtins'), app = resolve(builtins, scope.app);
  await mkdir(resolve(app, 'dist'), { recursive: true });
  await writeFile(resolve(app, 'app.json'), JSON.stringify({ schemaVersion: 1, name: scope.app,
    version: '0.1.0', displayName: 'Goal fixture',
    contributes: { panels: [{ id: scope.panel, title: 'Fixture', entry: 'dist/index.html' }] } }));
  await writeFile(resolve(app, 'dist/index.html'), '<title>Goal fixture</title>');
  const agents = resolve(temp, 'agents.json');
  await writeFile(agents, JSON.stringify([{ id: 'fixture', name: 'fixture', command: process.execPath,
    args: [resolve(root, 'tests/fixtures/control-lab-goal-acp.mjs')] }]));
  const child = spawn(resolve(root, 'target/debug/pero-host'), ['--stdio'], { cwd: temp, env: { ...process.env, ...endpoint,
    PERO_APPS_ROOT: resolve(temp, 'installed'), PERO_BUILTIN_APPS_ROOT: builtins, PERO_BUILTIN_APPS: scope.app, PERO_REQUIRED_APPS: '',
    PERO_SETTINGS_PATH: resolve(temp, 'settings.json'), PERO_HISTORY_PATH: resolve(temp, 'history.jsonl'), PERO_AGENTS_FILE: agents },
    stdio: ['pipe', 'pipe', 'pipe'] });
  const events: any[] = [], waiters = new Set<() => void>();
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  createInterface({ input: child.stdout }).on('line', line => {
    const event = JSON.parse(line); events.push(event); desktop.accept(event); for (const notify of waiters) notify();
  });
  const next = async (kind: string) => {
    const deadline = Date.now() + 10000;
    const failure = () => new Error(`Host did not emit ${kind}: ${JSON.stringify(events)}\n${stderr}`);
    while (!events.some(event => event.kind === kind && (!event.thread_id || event.thread_id === thread))) {
      if (events.some(event => ['error', 'session_error'].includes(event.kind) && (!event.thread_id || event.thread_id === thread))) throw failure();
      if (Date.now() >= deadline) throw failure();
      await new Promise<void>((done, reject) => {
        const timeout = setTimeout(() => { waiters.delete(notify); reject(failure()); }, Math.max(1, deadline - Date.now()));
        const notify = () => { clearTimeout(timeout); waiters.delete(notify); done(); };
        waiters.add(notify);
      });
    }
  };
  const send = (value: object) => child.stdin.write(JSON.stringify(value) + '\n');
  try {
    await next('ready');
    send({ action: 'new_session', thread_id: thread, agent_id: 'fixture', scope });
    await next('session_ready');
    const contexts = await desktop.draftContext.freeze(scope, thread, { approveGoal: true,
      attachments: [{ type: 'app-object', objectId: 'control-lab', revision: 1 }] });
    desktop.command({ action: 'prompt', thread_id: thread });
    send({ action: 'prompt', thread_id: thread, text: 'Review the approved experiment.', contexts });
    await next('turn_finished');
    const message = events.find(event => event.kind === 'user_message' && event.thread_id === thread);
    assert.deepEqual(message.data.contexts, contexts);
    const output = events.find(event => event.kind === 'session_update' && event.thread_id === thread && event.data?.sessionUpdate === 'agent_message_chunk');
    const result = JSON.parse(output.data.content.text);
    assert.equal(result.good.isError, false); assert.equal(result.foreign.isError, true);
    assert.match(result.foreign.content[0].text, /APP_GOAL_DENIED/);
    assert.deepEqual(applied, [{ app: 'control-lab', experimentId, specHash, maxExperiments: 1 }]);
  } finally {
    child.stdin.end();
    await new Promise<void>(done => { if (child.exitCode !== null) return done(); const timer = setTimeout(() => child.kill('SIGKILL'), 5000); child.once('exit', () => { clearTimeout(timer); done(); }); });
    await desktop.close(); await rm(temp, { recursive: true, force: true });
  }
});

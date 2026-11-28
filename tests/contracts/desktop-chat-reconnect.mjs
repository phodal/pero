// Real Rust Host and Go ACP in two Host lifetimes. Inference stays on loopback.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { closeLoopback, listenJson, streamCompletion } from '../fixtures/loopback-model.mjs';

const root = resolve(import.meta.dirname, '../..');
const isolated = await realpath(await mkdtemp(join(tmpdir(), 'pero-chat-reconnect-')));
const original = join(isolated, 'workspace-a');
const current = join(isolated, 'workspace-b');
const history = join(isolated, 'host.jsonl');
const registry = join(isolated, 'agents.json');
const thread = 'ordinary-reconnect-fixture';
const knownPrompt = 'Record the original evidence.';
const nextPrompt = 'Read the same conversation evidence.';
const modelA = 'fixture-model-a', modelB = 'fixture-model-b';
const calls = [], errors = [];
const {server, url} = await listenJson((request, response, body) => {
  assert.equal(request.url, '/v1/chat/completions');
  assert.equal(request.headers.authorization, 'Bearer fixture-key');
  calls.push({model: body.model, messages: body.messages});
  streamCompletion(response, {id: `fixture-${calls.length}`, model: body.model, delta: {role: 'assistant', content: `Answer ${calls.length}.`}});
}, errors);

const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/^(PERO_|XDG_|HOME$|USERPROFILE$)/.test(name) && !/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PROXY)/i.test(name)));

async function withHost(cwd, run) {
  const child = spawn(process.env.PERO_HOST_PATH || join(root, 'target/debug/pero-host'), ['--stdio'], {
    cwd, stdio: ['pipe', 'pipe', 'pipe'], env: {
      ...inherited, HOME: isolated, USERPROFILE: isolated, PERO_HISTORY_PATH: history, PERO_AGENTS_FILE: registry,
      PERO_SETTINGS_PATH: join(isolated, 'settings.json'), PERO_ENV_FILE: join(isolated, 'no-env'),
      PERO_BUILTIN_APPS_ROOT: '', PERO_BUILTIN_APPS: '', PERO_REQUIRED_APPS: '',
    },
  });
  const exited = once(child, 'close');
  void exited.catch(() => {});
  let failed, stderr = '';
  child.on('error', error => { failed = error; });
  child.stdin.on('error', error => { if (error.code !== 'EPIPE') failed = error; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const events = [];
  createInterface({input: child.stdout}).on('line', line => events.push(JSON.parse(line)));
  const send = (action, data = {}) => child.stdin.write(JSON.stringify({action, ...data}) + '\n');
  const wait = async (kind, predicate = () => true) => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      assert.deepEqual(errors, []);
      if (failed) throw failed;
      const index = events.findIndex(event => predicate(event) && (event.kind === kind ||
        (event.thread_id && ['session_error', 'command_rejected'].includes(event.kind))));
      if (index >= 0) {
        const event = events.splice(index, 1)[0];
        assert.equal(event.kind, kind, event.text);
        return event.data;
      }
      assert.equal(child.exitCode, null, stderr);
      await new Promise(done => setTimeout(done, 25));
    }
    throw Error(`Timed out waiting for ${kind}; events=${events.slice(-8).map(event => event.kind)} ${stderr}`);
  };
  const observe = (kind, id = thread) => wait(kind, event => event.thread_id === id);
  try {
    await wait('ready');
    await run({send, wait, observe});
  } finally {
    child.stdin.end();
    const deadline = setTimeout(() => child.kill('SIGKILL'), 15_000);
    try { assert.deepEqual(await exited, [0, null], stderr); } finally { clearTimeout(deadline); }
  }
}

async function desktopReconnect(inherited, originalId) {
  const {expect} = await import('@playwright/test');
  const {electron} = await import('../e2e/electron.mjs');
  const env = {
    ...inherited, HOME: isolated, USERPROFILE: isolated, PERO_HISTORY_PATH: history, PERO_AGENTS_FILE: registry,
    PERO_SETTINGS_PATH: join(isolated, 'settings.json'), PERO_DESKTOP_DATA_DIR: join(isolated, 'profile'),
    PERO_ENV_FILE: join(isolated, 'no-env'), PERO_LOCALE: 'en',
    PERO_HOST_EXECUTABLE: process.env.PERO_HOST_PATH || join(root, 'target/debug/pero-host'),
  };
  const app = await electron.launch({
    args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), join(root, 'desktop')],
    cwd: root, env,
  });
  const out = join(root, 'test-results/desktop-chat-reconnect');
  let page, snapshot, phase = 'open saved conversation';
  const captured = [];
  try {
    await mkdir(out, {recursive: true});
    page = await app.firstWindow();
    page.on('pageerror', error => captured.push(error.message));
    await page.waitForFunction(() => !document.getElementById('loading') && window.peroDiagnostics);
    snapshot = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
    const chat = async () => (await snapshot()).chats.find(row => row.id === thread);
    const frame = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    const click = async locate => {
      await frame();
      let bounds;
      await expect.poll(async () => {
        bounds = locate(await snapshot());
        return !!bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
          && bounds.width > 0 && bounds.height > 0;
      }, {timeout: 30_000}).toBe(true);
      await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    };
    await click(state => state.sidebarButtonBounds?.sessions);
    await click(state => state.sessionRowBounds?.[thread]);
    await expect.poll(async () => (await snapshot()).activeContent, {timeout: 30_000})
      .toEqual({kind: 'conversation', value: thread});
    await expect.poll(async () => (await chat())?.messages.map(message => message.text), {timeout: 30_000})
      .toEqual([knownPrompt, 'Answer 1.']);
    await expect.poll(async () => (await chat())?.state).toBe('closed');
    assert.equal((await chat()).session_id, originalId);
    assert.deepEqual(calls.map(call => call.model), [modelB]);

    phase = 'type into closed conversation';
    await click(state => state.composerBounds?.input);
    await expect.poll(async () => (await snapshot()).composerFocused).toBe(true);
    // Exercise the same keyboard path as a user typing an ASCII draft. A bulk
    // CDP IME commit is not required for this reconnect contract.
    await page.keyboard.type(nextPrompt);
    await expect.poll(async () => (await snapshot()).composer).toBe(nextPrompt);
    await page.screenshot({path: join(out, 'closed-with-draft.png')});

    phase = 'click Reconnect without submitting draft';
    await click(state => state.retryButtonBounds);
    await expect.poll(async () => (await chat())?.state, {timeout: 30_000}).toBe('idle');
    assert.equal((await chat()).session_id, originalId);
    assert.equal((await chat()).model, modelB);
    assert.equal((await snapshot()).composer, nextPrompt);
    assert.deepEqual(calls.map(call => call.model), [modelB]);
    await page.screenshot({path: join(out, 'reconnected.png')});

    phase = 'send explicit follow-up';
    await click(state => state.composerBounds?.input);
    await expect.poll(async () => (await snapshot()).composerFocused).toBe(true);
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await chat())?.messages.map(message => message.text), {timeout: 30_000})
      .toEqual([knownPrompt, 'Answer 1.', nextPrompt, 'Answer 2.']);
    assert.deepEqual(calls.map(call => call.model), [modelB, modelB]);
    assert.deepEqual(captured, []);
  } catch (error) {
    const state = await snapshot?.().catch(() => null);
    await Promise.allSettled([
      writeFile(join(out, 'failure.json'), JSON.stringify({
        phase, activeContent: state?.activeContent, activeChat: state?.activeChat,
        state: state?.chats.find(row => row.id === thread)?.state,
        composerFocused: state?.composerFocused, composerLength: state?.composer.length,
        inputBounds: state?.composerBounds?.input, reconnectBounds: state?.retryButtonBounds,
        modelCalls: calls.map(call => call.model), rendererErrors: captured, error: error.message,
      }, null, 2)),
      page?.screenshot({path: join(out, 'failure.png'), timeout: 5_000}),
    ]);
    throw error;
  } finally { await app.close(); }
}

const modelOf = data => data.configOptions?.find(option => option.id === 'model')?.currentValue ?? data.models?.currentModelId;
try {
  await mkdir(original);
  await mkdir(current);
  const agentConfig = {
    id: 'fixture', name: 'Loopback ACP', command: process.env.PERO_RECONNECT_HARNESS || join(root, 'target/debug/pero-agent-acp'),
    model: modelA, args: ['--endpoint', url + '/v1', '--model', modelA, '--selectable-model', modelB,
      '--workspace', '{workspace}', '--session-dir', join(isolated, 'acp'), '--api-key-env', 'FIXTURE_KEY', '--approval', 'never', '--max-retries', '0'],
    env: {FIXTURE_KEY: 'fixture-key'},
  };
  const setRegistry = () => writeFile(registry, JSON.stringify([agentConfig]), {mode: 0o600});
  await setRegistry();
  let originalId;
  await withHost(original, async ({send, observe}) => {
    send('new_session', {thread_id: thread, agent_id: 'fixture'});
    const ready = await observe('session_ready');
    originalId = ready.sessionId;
    assert.ok(originalId);
    assert.equal(ready.peroQuietLoad, true);
    assert.equal(modelOf(ready), modelA);
    send('model', {thread_id: thread, model_id: modelB});
    assert.equal(modelOf(await observe('model_changed')), modelB);
    send('prompt', {thread_id: thread, text: knownPrompt});
    assert.equal((await observe('turn_finished')).stopReason, 'end_turn');
    assert.deepEqual(calls.map(call => call.model), [modelB]);
    send('close', {thread_id: thread});
    await observe('session_closed');
  });

  if (process.argv.includes('--electron')) {
    await desktopReconnect(inherited, originalId);
  } else {
    await withHost(current, async ({send, wait, observe}) => {
      const readHistory = async request_id => {
        send('load_thread_history', {thread_id: thread, request_id});
        return wait('thread_history', event => event.request_id === request_id);
      };
      const before = await readHistory('before');
      assert.equal(before.active, false);
      assert.deepEqual(before.events.filter(event => event.kind === 'user_message').map(event => event.text), [knownPrompt]);
      send('reconnect_session', {thread_id: 'missing-history'});
      await observe('session_error', 'missing-history');

      send('reconnect_session', {thread_id: thread});
      const ready = await observe('session_ready');
      assert.equal(ready.sessionId, originalId);
      assert.equal(modelOf(ready), modelB);
      assert.deepEqual(calls.map(call => call.model), [modelB], 'reconnect must not send a new model request');

      send('prompt', {thread_id: thread, text: nextPrompt});
      assert.equal((await observe('turn_finished')).stopReason, 'end_turn');
      assert.deepEqual(calls.map(call => call.model), [modelB, modelB]);
      const wire = JSON.stringify(calls[1].messages);
      assert.ok(wire.includes(knownPrompt) && wire.includes(nextPrompt), 'follow-up reached the original ACP context');
      const after = await readHistory('after');
      assert.equal(after.active, true);
      const [created] = after.events.filter(event => event.kind === 'session_created');
      assert.equal(after.events.filter(event => event.kind === 'session_created').length, 1);
      assert.equal(created.data.workspace, original);
      assert.deepEqual(after.events.filter(event => event.kind === 'user_message').map(event => event.text), [knownPrompt, nextPrompt]);
      assert.equal(after.events.filter(event => event.kind === 'session_update' && event.data.sessionUpdate === 'agent_message_chunk').length, 2);
    });
    // Removing model B must not silently fall back to A.
    agentConfig.args.splice(agentConfig.args.indexOf('--selectable-model'), 2);
    await setRegistry();
    await withHost(current, async ({send, observe}) => {
      send('reconnect_session', {thread_id: thread});
      await observe('session_error');
      await observe('session_closed');
      assert.deepEqual(calls.map(call => call.model), [modelB, modelB]);
    });
  }
  assert.deepEqual(errors, []);
  console.log(`Ordinary Desktop ${process.argv.includes('--electron') ? 'Electron' : 'Host'} reconnect passed with the same ACP ID, model B, zero requests before an explicit follow-up and no duplicate messages.`);
} finally {
  await closeLoopback(server);
  await rm(isolated, {recursive: true, force: true});
}

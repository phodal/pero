// Opt-in ACP comparison of the two actual executables, with no live model. See
// docs/fitness/dsh-alpha2-alignment.md for setup and scope.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createFilesFixture, compareDSHFiles, comparePeroImages } from './compare-dsh-alpha2-files.mjs';

const [dshPackage, peroBinary] = process.argv.slice(2);
const filesLane = process.env.PERO_ACP_DSH_FILES === '1';
const peroFilesLane = process.env.PERO_ACP_PERO_FILES === '1';
const imageLane = peroFilesLane || process.env.PERO_ACP_PERO_IMAGES === '1';
assert.ok(!imageLane || !filesLane, 'run image comparisons separately');
assert.ok(dshPackage && (peroBinary || filesLane),
  'usage: node scripts/harness/compare-acp-alpha2.mjs <DSH package.json> <pero-agent-acp binary>');
const manifest = JSON.parse(await readFile(dshPackage, 'utf8'));
const dshVersion = '0.2.3-alpha.2';
assert.equal(manifest.name, '@deepseek-ai/dsh');
assert.equal(manifest.version, dshVersion);
const dshEntry = resolve(dirname(dshPackage), manifest.bin.dsh);
const root = await realpath(await mkdtemp(join(tmpdir(), 'pero-dsh-acp-')));
const timeoutMillis = 15000;
const signedLane = process.env.PERO_ACP_SIGNED === '1';
const messagesLane = signedLane || process.env.PERO_ACP_MESSAGES === '1';
const effects = messagesLane || process.env.PERO_ACP_EFFECTS === '1';
let providerRequests = 0;
let plan;
const fixtureErrors = [];
const receipt = 'one explicit fixture write\n';
const success = 'fixture turn completed';
const key = 'offline-fixture-only';
const replayKey = 'ab'.repeat(32);
const thought = 'synthetic fixture thought';
const signature = 'synthetic-fixture-signature';
const filesFixture = filesLane || imageLane ? createFilesFixture(key) : null;
const provider = createServer(async (request, response) => {
  providerRequests++;
  try {
    if (filesFixture) return await filesFixture.handle(request, response);
    assert.ok(plan, 'unexpected provider request');
    const { engine, sessionId, cancel, cancelled, stages } = plan;
    const dsh = engine.name === 'dsh';
    const messages = dsh || engine.messages;
    assert.equal(request.method, 'POST');
    assert.equal(request.url, engine.messages ? '/anthropic/v1/messages' : dsh ? '/v1/messages' : '/v1/chat/completions');
    assert.equal(messages ? request.headers['x-api-key'] : request.headers.authorization,
      messages ? (engine.credential ?? key) : `Bearer ${key}`);
    let raw = '';
    for await (const chunk of request) {
      raw += chunk;
      assert.ok(raw.length < 2 * 1024 * 1024, 'fixture request too large');
    }
    const body = JSON.parse(raw);
    if (engine.messages) {
      assert.equal(request.headers['anthropic-version'], '2023-06-01');
      assert.equal(request.headers.authorization, undefined);
      assert.deepEqual(body.thinking, { type: engine.signed ? 'enabled' : 'disabled' });
      assert.ok(!raw.includes(replayKey), 'local replay key must not reach the provider');
      assert.equal(body.stream, true);
      assert.equal(body.max_tokens, 128);
    }
    const stage = stages.shift();
    assert.ok(stage, 'unexpected extra inference');
    const hasToolResult = messages
      ? body.messages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result' && b.tool_use_id === 'fixture-write' && !b.is_error))
      : body.messages.some(m => m.role === 'tool' && m.tool_call_id === 'fixture-write');
    if (engine.messages && stage === 'tool-result') {
      const order = body.messages.slice(-2);
      assert.equal(order[0].role, 'assistant');
      assert.deepEqual(order[0].content.find(b => b.type === 'tool_use'), {
        type: 'tool_use', id: 'fixture-write', name: 'write_file', input: { path: 'effect.txt', content: receipt },
      });
      assert.equal(order[1].role, 'user');
      assert.equal(order[1].content[0].type, 'tool_result');
      assert.equal(order[1].content[0].tool_use_id, 'fixture-write');
      assert.ok(order[1].content[0].content.some(b => b.type === 'text' && b.text.includes('effect.txt')));
    }
    if (engine.signed) {
      const blocks = body.messages.flatMap(m => m.content);
      if (stage === 'tool-result' || stage === 'after-restart') {
        const toolTurn = body.messages.find(m => m.content.some(b => b.type === 'tool_use' && b.id === 'fixture-write'));
        assert.deepEqual(toolTurn?.content[0], {type: 'thinking', thinking: thought, signature});
      } else if (stage === 'credential-changed') {
        assert.equal(blocks.some(b => b.type === 'thinking'), false, 'credential change must drop signed history');
        assert.ok(!raw.includes(signature) && !raw.includes(thought));
      }
    }
    if (stage === 'tool-result' || stage === 'after-restart' || stage === 'credential-changed') {
      assert.ok(hasToolResult, `${engine.name}: tool result missing in ${stage}`);
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = obj => response.write(`${messages ? `event: ${obj.type}\n` : ''}data: ${JSON.stringify(obj)}\n\n`);
    if (stage === 'cancel') {
      response.once('close', cancelled);
      response.flushHeaders();
      cancel('session/cancel', { sessionId });
      return;
    }
    const name = dsh ? 'write' : 'write_file';
    const write = stage === 'write' || stage === 'truncated';
    const id = stage === 'truncated' ? 'fixture-truncated' : 'fixture-write';
    const args = { [dsh ? 'file_path' : 'path']: stage === 'truncated' ? 'must-not-exist.txt' : 'effect.txt', content: receipt };
    if (stage === 'write') {
      assert.ok(body.tools.some(t => (messages ? t.name : t.function.name) === name), 'write tool not advertised');
    }
    if (messages) {
      send({ type: 'message_start', message: { id: 'fixture-message', type: 'message', role: 'assistant',
        model: body.model, content: [], usage: { input_tokens: 3, output_tokens: 0 } } });
      const signedWrite = engine.signed && stage === 'write';
      if (signedWrite) {
        send({type: 'content_block_start', index: 0, content_block: {type: 'thinking', thinking: '', signature: ''}});
        send({type: 'content_block_delta', index: 0, delta: {type: 'thinking_delta', thinking: thought}});
        send({type: 'content_block_delta', index: 0, delta: {type: 'signature_delta', signature}});
        send({type: 'content_block_stop', index: 0});
      }
      const index = signedWrite ? 1 : 0;
      send({ type: 'content_block_start', index, content_block: write
        ? { type: 'tool_use', id, name, input: {} } : { type: 'text', text: '' } });
      send({ type: 'content_block_delta', index, delta: write
        ? { type: 'input_json_delta', partial_json: JSON.stringify(args) } : { type: 'text_delta', text: success } });
      send({ type: 'content_block_stop', index });
      send({ type: 'message_delta', delta: { stop_reason: write ? 'tool_use' : 'end_turn',
        stop_sequence: null }, usage: { output_tokens: 1 } });
      if (stage !== 'truncated') send({ type: 'message_stop' });
      response.end();
    } else {
      send({ choices: [{ index: 0, delta: stage === 'write'
        ? { tool_calls: [{ index: 0, id: 'fixture-write', type: 'function', function: { name, arguments: JSON.stringify(args) } }] }
        : { content: success }, finish_reason: stage === 'write' ? 'tool_calls' : 'stop' }] });
      response.end('data: [DONE]\n\n');
    }
  } catch (error) {
    fixtureErrors.push(error);
    response.destroy();
  }
});

async function withAgent(engine, paths, run) {
  const endpoint = `http://127.0.0.1:${provider.address().port}`;
  const child = spawn(engine.command, engine.args({ ...paths, endpoint }), {
    cwd: paths.workspace,
    env: {
      PATH: process.env.PATH,
      HOME: paths.home,
      USERPROFILE: paths.home,
      XDG_CONFIG_HOME: join(paths.home, 'config'),
      XDG_DATA_HOME: join(paths.home, 'data'),
      XDG_CACHE_HOME: join(paths.home, 'cache'),
      DSH_HOME: join(paths.home, 'dsh'),
      DSH_TELEMETRY_DISABLED: '1',
      DEEPSEEK_BASE_URL: endpoint,
      DEEPSEEK_API_KEY: engine.credential ?? key,
      PERO_FIXTURE_API_KEY: engine.credential ?? key,
      ...(engine.files && {PERO_FIXTURE_FILES_KEY: 'cd'.repeat(32)}),
      ...(engine.signed && {PERO_FIXTURE_REPLAY_KEY: replayKey}),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
  child.stdin.on('error', () => {});
  const exited = new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolveExit({ code, signal }));
  });
  exited.catch(() => {}); // also observed on request/close below
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let nextID = 0;
  const updates = [];
  const approvals = [];
  const send = frame => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...frame }) + '\n');
  const notify = (method, params) => send({ method, params });
  function bounded(operation, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${engine.name}: ${label} timed out`)), timeoutMillis);
    });
    return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
  }
  async function ask(method, params) {
    const id = ++nextID;
    send({ id, method, params });
    return bounded((async () => {
      for (;;) {
        const next = await lines.next();
        assert.ok(!next.done, `${engine.name}: stdout closed during ${method}`);
        const message = JSON.parse(next.value);
        if (engine.signed) assert.ok(!next.value.includes(signature) && !next.value.includes(replayKey), 'ACP exposed private replay metadata');
        assert.equal(message.jsonrpc, '2.0');
        if (message.id === undefined && message.method === 'session/update') {
          updates.push(message.params?.update?.sessionUpdate);
          continue;
        }
        if (message.method === 'session/request_permission') {
          const call = message.params.toolCall.toolCallId;
          assert.equal(call, 'fixture-write');
          assert.equal(approvals.length, 0, 'duplicate invocation requested approval');
          const option = message.params.options.find(o => o.kind === 'allow_once');
          assert.ok(effects && option);
          approvals.push(call);
          send({ id: message.id, result: { outcome: { outcome: 'selected', optionId: option.optionId } } });
          continue;
        }
        assert.equal(message.id, id, `${engine.name}: unexpected message during ${method}`);
        return message;
      }
    })(), method);
  }
  async function request(method, params) {
    const result = await ask(method, params);
    assert.equal(result.error, undefined, `${engine.name}: ${method} returned RPC error ${JSON.stringify(result.error)}`);
    return result.result;
  }
  try {
    const init = await request('initialize', { protocolVersion: 1, clientCapabilities: {} });
    assert.equal(init.protocolVersion, 1);
    for (const capability of ['list', 'close', 'resume']) {
      assert.ok(Object.hasOwn(init.agentCapabilities.sessionCapabilities, capability), capability);
    }
    const result = await run({ ask, request, notify, updates, approvals, bounded, capabilities: init.agentCapabilities });
    child.stdin.end();
    assert.deepEqual(await bounded(exited, 'shutdown'), { code: 0, signal: null });
    return result;
  } catch (error) {
    if (fixtureErrors.length) throw new AggregateError(fixtureErrors, error.message);
    if (stderr) error.message += `\n${stderr}`;
    throw error;
  } finally {
    child.stdin.destroy();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited.catch(() => {});
  }
}

async function compare(engine) {
  const home = join(root, engine.name);
  const workspace = join(home, 'workspace');
  const other = join(home, 'other-workspace');
  const alias = join(home, 'workspace-alias');
  await Promise.all([mkdir(workspace, { recursive: true }), mkdir(other, { recursive: true })]);
  await symlink(workspace, alias, 'junction');
  const paths = { home, workspace };
  const params = { cwd: workspace, mcpServers: [] };
  const prompt = (request, sessionId, text) => request('session/prompt', {
    sessionId, prompt: [{ type: 'text', text }],
  });
  const noInference = async action => {
    const count = providerRequests;
    await action();
    assert.equal(providerRequests, count, 'session lifecycle must not call the provider');
  };
  const sessionId = await withAgent(engine, paths, async ({ request, notify, approvals, bounded, updates }) => {
    const created = await request('session/new', { ...params, cwd: alias });
    assert.equal(typeof created.sessionId, 'string');
    assert.ok(created.sessionId);
    assert.deepEqual((await request('session/list', { cwd: workspace })).sessions, []);
    if (effects) {
      const effectPath = join(workspace, 'effect.txt');
      if (engine.name === 'pero') await request('session/set_config_option', {
        sessionId: created.sessionId, configId: 'permission', value: 'workspace-write',
      });
      plan = { engine, stages: ['write', 'tool-result'] };
      assert.equal((await prompt(request, created.sessionId, 'Write exactly one fixture file.')).stopReason, 'end_turn');
      assert.deepEqual(plan.stages, []);
      assert.equal(await readFile(effectPath, 'utf8'), receipt);
      // Overwrite with a different sentinel so even an idempotent replay is observable.
      await writeFile(effectPath, 'external change after the turn\n');
      const disconnected = new Promise(done => {
        plan = { engine, sessionId: created.sessionId, cancel: notify, cancelled: done, stages: ['cancel'] };
      });
      assert.equal((await prompt(request, created.sessionId, 'Wait for cancellation before any other action.')).stopReason, 'cancelled');
      await bounded(disconnected, 'cancelled provider connection');
      assert.deepEqual(plan.stages, []);
      assert.deepEqual(approvals, engine.name === 'pero' ? ['fixture-write'] : []);
      assert.equal(updates.filter(kind => kind === 'tool_call').length, 1, 'one live tool invocation');
      plan = undefined;
    }
    await request('session/close', { sessionId: created.sessionId });
    return created.sessionId;
  });
  if (engine.signed) {
    const journal = await readFile(join(home, 'sessions', sessionId + '.jsonl'), 'utf8');
    assert.ok(journal.includes(signature), 'complete signature must survive in the private journal');
    assert.ok(!journal.includes(replayKey) && !journal.includes(key), 'credential material must not enter the journal');
  }
  const report = await withAgent(engine, paths, async ({ ask, request, updates, approvals, capabilities }) => {
    const list = await request('session/list', { cwd: workspace });
    assert.deepEqual(list.sessions.map(s => [s.sessionId, s.cwd]), [[sessionId, workspace]]);
    assert.deepEqual((await request('session/list', { cwd: alias })).sessions.map(s => [s.sessionId, s.cwd]), [[sessionId, workspace]]);
    assert.deepEqual((await request('session/list', { cwd: other })).sessions, []);
    const wrong = await ask('session/resume', { ...params, cwd: other, sessionId });
    assert.equal(typeof wrong.error?.code, 'number', 'wrong workspace must not resume');
    await noInference(() => request('session/resume', { ...params, cwd: alias, sessionId }));
    assert.deepEqual((await request('session/list', { cwd: workspace })).sessions, []);
    assert.ok(!updates.some(kind => ['agent_message_chunk', 'user_message_chunk', 'tool_call'].includes(kind)),
      'resume must not emit conversation messages or tool calls');
    if (effects) {
      assert.equal(await readFile(join(workspace, 'effect.txt'), 'utf8'), 'external change after the turn\n');
      plan = { engine, stages: ['after-restart'] };
      assert.equal((await prompt(request, sessionId, 'Answer this new turn without a tool.')).stopReason, 'end_turn');
      assert.deepEqual(plan.stages, []);
      assert.deepEqual(approvals, []);
      assert.ok(!updates.includes('tool_call'), 'explicit post-restart turn must not execute a tool');
      assert.equal(await readFile(join(workspace, 'effect.txt'), 'utf8'), 'external change after the turn\n');
      plan = undefined;
    }
    await request('session/close', { sessionId });
    const supportsLoad = capabilities.loadSession === true;
    assert.equal(supportsLoad, engine.name === 'pero', 'expected alpha.2 capability difference changed');
    if (supportsLoad) {
      const replayStart = updates.length;
      await noInference(() => request('session/load', { ...params, sessionId }));
      if (effects) {
        assert.ok(updates.slice(replayStart).includes('agent_message_chunk'), 'load must replay nonempty history');
        assert.deepEqual(approvals, [], 'load replay must not request permission');
        assert.equal(await readFile(join(workspace, 'effect.txt'), 'utf8'), 'external change after the turn\n');
      }
      await request('session/close', { sessionId });
    }
    if (engine.messages) {
      const newSession = await request('session/new', params);
      await request('session/set_config_option', {
        sessionId: newSession.sessionId, configId: 'permission', value: 'workspace-write',
      });
      plan = { engine, stages: ['truncated'] };
      const answer = await ask('session/prompt', {
        sessionId: newSession.sessionId, prompt: [{type: 'text', text: 'Run the truncated fixture.'}],
      });
      assert.match(answer.error?.message ?? '', /^STREAM_CLOSED:/);
      assert.deepEqual(plan.stages, []);
      assert.deepEqual(approvals, [], 'incomplete stream must not request permission');
      await assert.rejects(readFile(join(workspace, 'must-not-exist.txt')), { code: 'ENOENT' });
      await request('session/close', { sessionId: newSession.sessionId });
      plan = undefined;
    }
    return {
      ...(engine.messages && { messages: engine.signed ? 'explicit signed thinking' : 'explicit text/tools', incompleteEffects: 0 }),
      engine: engine.name, protocolVersion: 1,
      newCloseRestartListResume: 'passed', differentWorkspaceRejected: true, canonicalCwd: true,
      loadSession: supportsLoad ? 'advertised; load passed' : 'not advertised',
      ...(effects && { writes: 1, noReplay: true, inFlightCancelled: true, explicitNewTurnAfterRestart: true }),
    };
  });
  if (engine.signed) {
    const rotated = {...engine, credential: 'rotated-offline-fixture-only'};
    await withAgent(rotated, paths, async ({request, approvals}) => {
      await request('session/resume', {...params, sessionId});
      plan = {engine: rotated, stages: ['credential-changed']};
      assert.equal((await prompt(request, sessionId, 'Answer without replaying private thinking.')).stopReason, 'end_turn');
      assert.deepEqual(plan.stages, []);
      assert.deepEqual(approvals, []);
      assert.equal(await readFile(join(workspace, 'effect.txt'), 'utf8'), 'external change after the turn\n');
      await request('session/close', {sessionId});
      plan = undefined;
    });
    report.signedReplay = 'same-route restart preserved; changed credential suppressed';
  }
  return report;
}

try {
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  if (filesFixture) {
    const result = imageLane
      ? await comparePeroImages({root, peroBinary: resolve(peroBinary), withAgent, fixture: filesFixture, files: peroFilesLane, key})
      : await compareDSHFiles({root, dshEntry, key, withAgent, fixture: filesFixture});
    assert.deepEqual(fixtureErrors, []);
    assert.equal(providerRequests, imageLane && !peroFilesLane ? 2 : 7);
    console.log(JSON.stringify({dshVersion, providerRequests, ...result}, null, 2));
  } else {
    const engines = [
      { name: 'dsh', command: process.execPath, args: () => [dshEntry, '--profile', 'acp'] },
      { name: 'pero', messages: messagesLane, signed: signedLane, command: resolve(peroBinary), args: ({ home, endpoint, workspace }) => [
        '--endpoint', endpoint + (messagesLane ? '/anthropic' : '/v1'),
        ...(messagesLane ? ['--api-format', 'deepseek-messages', '--max-tokens', '128'] : []),
        ...(signedLane ? ['--messages-replay-key-env', 'PERO_FIXTURE_REPLAY_KEY'] : []), '--model', 'fixture', '--api-key-env', 'PERO_FIXTURE_API_KEY',
        '--session-dir', join(home, 'sessions'), ...(effects ? ['--workspace', workspace] : []), '--approval', effects ? 'ask' : 'never',
      ] },
    ];
    const results = [];
    for (const engine of engines) results.push(await compare(engine));
    assert.equal(providerRequests, signedLane ? 10 : messagesLane ? 9 : effects ? 8 : 0, 'unexpected provider request count');
    console.log(JSON.stringify({ dshVersion, scope: effects ? 'loopback provider; write, cancel and restart' : 'empty ACP lifecycle; no prompts', providerRequests, results }, null, 2));
  }
} finally {
  provider.closeAllConnections();
  if (provider.listening) await new Promise(resolveClose => provider.close(resolveClose));
  await rm(root, { recursive: true, force: true });
}

// Real Rust Host, ACP wire and Go Harness with a scripted loopback model.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../protocol/generated/host.schema.json' with { type: 'json' };
import { closeLoopback, jsonReply, listenJson, streamCompletion } from '../fixtures/loopback-model.mjs';

const root = resolve(import.meta.dirname, '../..');
const profile = await realpath(await mkdtemp(join(tmpdir(), 'pero-prompt-receipts-')));
const workspace = join(profile, 'workspace');
const sessions = join(profile, 'sessions');
const wirePath = join(profile, 'acp.jsonl');
const thread = 'prompt-receipt-contract';
const app = 'prompt-receipt-fixture';
const first = 'PROMPT_RECEIPT_FIRST: inspect the fixture.';
const second = 'PROMPT_RECEIPT_SECOND: summarize the fixture.';
const observation = 'fixture attached observation';
const pluginInstructions = 'Handle these synthetic observations as fixture data.';
const appUseContext = 'pero.appUseContext';
const toolEvidence = 'prompt-receipt-command-observation';
const mcpGuidance = 'This is loopback-only MCP guidance for the prompt receipt test.';
const mcpToken = randomBytes(32).toString('hex');
const providerKey = 'loopback-receipt-fixture-only';
const skill = await readFile(join(root, 'crates/pero-runtime/src/app-use-skill.md'), 'utf8');
const events = [], calls = [], httpBodies = [], fixtureErrors = [], mcpMethods = [], servers = [];
const changed = new EventEmitter();
let host, exit, stderr = '';
const ajv = new Ajv2020({ strict: true, strictTypes: false });
ajv.addSchema(schema);
const validateHostEvent = ajv.getSchema(`${schema.$id}#/$defs/AcpPromptReceiptEvent`);

const text = message => typeof message?.content === 'string' ? message.content
  : (message?.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n');
const blockText = block => block.type === 'text' ? block.text : block.resource?.text ?? '';
const digest = value => createHash('sha256').update(value).digest('hex');
const count = (value, sample) => value.split(sample).length - 1;
const lines = value => value.trim().split('\n').map(line => JSON.parse(line));

async function listen(handler) {
  const { server, url } = await listenJson(handler, fixtureErrors);
  servers.push(server);
  return url;
}

function wait(predicate, label, since = 0) {
  const seen = events.slice(since).find(predicate);
  if (seen) return Promise.resolve(seen);
  return new Promise((resolveEvent, reject) => {
    const receive = event => {
      if (!predicate(event)) return;
      clearTimeout(timer);
      changed.off('event', receive);
      resolveEvent(event);
    };
    const timer = setTimeout(() => {
      changed.off('event', receive);
      reject(Error(`Host did not report ${label}. Recent events: ${events.slice(-8).map(event => event.kind).join(', ')}. ${stderr}`));
    }, 30_000);
    changed.on('event', receive);
  });
}

const send = command => host.stdin.write(JSON.stringify(command) + '\n');

async function submit(message, contexts) {
  const since = events.length;
  send({ action: 'prompt', thread_id: thread, text: message, contexts });
  const result = await wait(event => event.thread_id === thread
    && ['turn_finished', 'session_error', 'command_rejected'].includes(event.kind), 'turn settlement', since);
  assert.equal(result.kind, 'turn_finished', result.text);
  assert.equal(result.data.stopReason, 'end_turn');
}

try {
  await mkdir(workspace);
  const builtins = join(profile, 'builtins');
  const appSource = join(builtins, app);
  await mkdir(join(appSource, 'dist'), { recursive: true });
  await writeFile(join(appSource, 'dist/index.html'), '<title>Prompt receipt fixture</title>');
  await writeFile(join(appSource, 'server.mjs'), 'export {};');
  await writeFile(join(appSource, 'app.json'), JSON.stringify({
    schemaVersion: 1, name: app, version: '1.0.0', displayName: 'Prompt receipt fixture',
    permissions: { host: ['agent', 'agent-plugin'], api: ['/api/save'] },
    backend: { type: 'node', entry: 'server.mjs' },
    contributes: {
      panels: [{ id: 'main', title: 'Prompt receipt fixture', entry: 'dist/index.html' }],
      writes: [{ name: 'save', description: 'Save a synthetic observation', path: '/api/save',
        schema: { type: 'object', properties: { observation: { type: 'string' } }, required: ['observation'] } }],
      agentPlugin: { schema: 'pero.app-agent-plugin.v1', instructions: pluginInstructions, tools: ['save'], maxCalls: 1 },
    },
  }));
  const mcp = await listen((request, response, message) => {
    assert.equal(request.url, '/mcp');
    assert.equal(request.headers.authorization, `Bearer ${mcpToken}`);
    assert.equal(request.headers['x-pero-thread'], thread);
    if (request.method !== 'POST') return response.writeHead(405).end();
    mcpMethods.push(message.method);
    if (message.id === undefined) return response.writeHead(202).end();
    if (message.method === 'initialize') return jsonReply(response, message.id, {
      protocolVersion: '2024-11-05', capabilities: { tools: {}, resources: {} },
      serverInfo: { name: 'receipt-app-use-fixture', version: '1' }, instructions: mcpGuidance,
    });
    if (message.method === 'tools/list') return jsonReply(response, message.id, { tools: [] });
    return jsonReply(response, message.id, {});
  });
  const provider = await listen((request, response, input, body) => {
    assert.equal(request.url, '/v1/chat/completions');
    assert.equal(request.headers.authorization, `Bearer ${providerKey}`);
    calls.push(input);
    httpBodies.push(body);
    assert(calls.length <= 3, 'Unexpected extra model request');
    const user = input.messages.findLastIndex(message => message.role === 'user');
    const last = text(input.messages[user]);
    const results = input.messages.slice(user + 1).filter(message => message.role === 'tool');
    let delta, finish = 'stop';
    if (last.startsWith(first) && !results.length) {
      assert(input.tools.some(tool => tool.function?.name === 'shell'), 'Expected the real shell tool');
      delta = { tool_calls: [{ index: 0, id: 'receipt-shell', type: 'function',
        function: { name: 'shell', arguments: JSON.stringify({ command: `printf '%s\\n' '${toolEvidence}'` }) } }] };
      finish = 'tool_calls';
    } else if (last.startsWith(first)) {
      assert(results.some(message => text(message).includes(toolEvidence)), 'Missing actual tool observation');
      delta = { content: 'FIRST_RECEIPT_COMPLETE' };
    } else {
      assert(last.startsWith(second), 'Unexpected model input');
      assert(input.messages.some(message => text(message).includes('FIRST_RECEIPT_COMPLETE')), 'The same Session must retain earlier turns');
      delta = { content: 'SECOND_RECEIPT_COMPLETE' };
    }
    streamCompletion(response, { id: `receipt-${calls.length}`, model: 'receipt-fixture', delta, finish });
  });

  const agentPath = process.env.PERO_RECEIPT_HARNESS || join(root, 'target/debug/pero-agent-acp');
  const hostPath = process.env.PERO_HOST_PATH || join(root, 'target/debug/pero-host');
  const agents = join(profile, 'agents.json');
  await writeFile(agents, JSON.stringify([{ id: 'receipt-fixture', name: 'Loopback prompt receipt fixture', command: process.execPath,
    args: [join(root, 'tests/fixtures/record-acp.mjs'), wirePath, agentPath,
      '--endpoint', `${provider}/v1`, '--model', 'receipt-fixture', '--session-dir', sessions,
      '--workspace', workspace, '--enable-shell', '--defer-tool-loading=false',
      '--approval', 'ask', '--max-retries', '0', '--max-requests', '5', '--max-tokens', '1024'] }]));
  await writeFile(join(profile, 'settings.json'), '{}');
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !name.startsWith('PERO_') && !/(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PROXY)/i.test(name)));
  host = spawn(hostPath, ['--stdio'], { cwd: workspace, stdio: ['pipe', 'pipe', 'pipe'], env: {
    ...env, AGENT_PROVIDER_API_KEY: providerKey,
    PERO_AGENTS_FILE: agents, PERO_SETTINGS_PATH: join(profile, 'settings.json'), PERO_HISTORY_PATH: join(profile, 'host.jsonl'),
    PERO_ENV_FILE: join(profile, 'no-env'), PERO_APPS_ROOT: join(profile, 'apps'), PERO_BUILTIN_APPS_ROOT: builtins,
    PERO_BUILTIN_APPS: app, PERO_REQUIRED_APPS: '',
    PERO_APP_USE_URL: `${mcp}/mcp`, PERO_APP_USE_TOKEN: mcpToken,
  } });
  exit = once(host, 'close');
  host.stderr.on('data', data => { stderr += String(data).replaceAll(mcpToken, '[redacted]').replaceAll(providerKey, '[redacted]'); });
  createInterface({ input: host.stdout }).on('line', line => {
    const event = JSON.parse(line);
    events.push(event);
    if (event.kind === 'permission') {
      const option = event.data.options.find(choice => choice.kind === 'allow_once');
      assert(option, 'Expected a one-time permission option');
      send({ action: 'permission', thread_id: thread, request_id: event.data.permission_id, option_id: option.optionId });
    }
    changed.emit('event', event);
  });
  await wait(event => event.kind === 'ready', 'readiness');
  send({ action: 'new_session', thread_id: thread, agent_id: 'receipt-fixture', scope: { app, panel: 'main' } });
  const ready = await wait(event => event.thread_id === thread && ['session_ready', 'session_error', 'session_preparing'].includes(event.kind), 'ACP session');
  assert.equal(ready.kind, 'session_ready', ready.text);
  send({ action: 'resolve_context', request_id: 'app-use-context', kind: 'skill', source: 'pero-skill:app-use' });
  const selection = await wait(event => event.request_id === 'app-use-context', 'built-in App Use context');
  assert.equal(selection.kind, 'context_resolved', selection.text);
  assert.equal(selection.data.content.text, skill);
  const attached = { id: 'fixture-observation', kind: 'selection', label: 'Fixture observation', source: 'fixture:observation',
    content: { type: 'text', text: observation } };
  await submit(`/app-use ${first}`, [selection.data, attached]);
  await submit(second, []);
  host.stdin.end();
  assert.deepEqual(await exit, [0, null], stderr);

  assert.deepEqual(fixtureErrors, []);
  assert(mcpMethods.includes('initialize') && mcpMethods.includes('tools/list'));
  const wire = lines(await readFile(wirePath, 'utf8')).map(entry => ({ line: entry.line, message: JSON.parse(entry.line) }));
  const capabilities = wire.find(({ message }) => message.result?.agentCapabilities).message.result.agentCapabilities;
  assert.equal(capabilities._meta['pero.turnReceipt'], 1);
  assert.equal(capabilities._meta[appUseContext], 1);
  const sentFrames = wire.filter(({ message }) => message.method === 'session/prompt');
  const prompts = sentFrames.map(({ message }) => message.params);
  const hostReceipts = events.filter(event => event.kind === 'acp_prompt_receipt' && event.thread_id === thread);
  for (const event of hostReceipts) assert(validateHostEvent(event), ajv.errorsText(validateHostEvent.errors));
  const prepared = hostReceipts.map(event => event.data);
  const hostJournal = lines(await readFile(join(profile, 'host.jsonl'), 'utf8')).filter(event => event.thread_id === thread);
  const retained = hostJournal.filter(event => event.kind === 'acp_prompt_receipt').map(event => event.data);
  assert.deepEqual(retained, prepared, 'Host receipt journal must retain the emitted receipts');
  const hostUser = hostJournal.filter(event => event.kind === 'user_message');
  assert.deepEqual(hostUser.map(event => event.text), [`/app-use ${first}`, second]);
  assert.deepEqual(hostUser[0].data.contexts, [selection.data, attached], 'Host history must retain the explicit built-in selection');
  assert.equal(hostUser[1].data?.contexts, undefined);
  assert.equal(prompts.length, 2);
  assert.equal(prepared.length, 2);
  const expectedSources = [['user', 'user_selected', 'user_selected', 'app_plugin'], ['user', 'app_use', 'app_plugin']];
  const bodies = [first, second];
  const placements = ['selected', 'automatic'];
  for (const [index, params] of prompts.entries()) {
    const receipt = prepared[index];
    const blocks = params.prompt;
    assert.equal(params.sessionId, ready.data.sessionId);
    assert.equal(receipt.acpSessionId, params.sessionId);
    assert.equal(receipt.stage, 'prepared');
    assert.equal(receipt.promptId, params._meta['pero.turnReceipt'].id);
    assert.deepEqual(blocks[0], { type: 'text', text: bodies[index] });
    assert.equal(count(blocks.map(blockText).join('\n'), skill), 1, 'One full App Use Skill per eligible ACP turn');
    assert(blockText(blocks[1]).startsWith('\n\nHost-provided App Use workflow:\n'));
    assert.deepEqual(blocks[1]._meta, { [appUseContext]: placements[index] });
    assert(!blocks.slice(2).some(block => block._meta?.[appUseContext] !== undefined));
    assert.deepEqual(receipt.suppressedSources, index === 0 ? ['app_use'] : []);
    assert.deepEqual(receipt.blocks, blocks.map((block, position) => ({ source: expectedSources[index][position], kind: block.type,
      sha256: digest(JSON.stringify(block)), bytes: Buffer.byteLength(JSON.stringify(block)) })));
    if (index === 0) assert.equal(blockText(blocks[2]), `\n\nUser-selected context (data)\n${attached.label}\nSource: ${attached.source}\n\n${observation}`);
    assert.equal(blockText(blocks.at(-1)), `\n\nHost-mounted App Agent Plugin instructions:\n${pluginInstructions}`);
  }
  assert.notEqual(prepared[0].promptId, prepared[1].promptId);

  const journal = lines(await readFile(join(sessions, `${ready.data.sessionId}.jsonl`), 'utf8')).flatMap(line => line.event ? [line.event] : []);
  const nativeUser = journal.filter(event => event.type === 'user/message' && bodies.includes(event.data.content?.[0]?.text));
  assert.equal(nativeUser.length, prompts.length);
  for (const [index, event] of nativeUser.entries()) {
    assert.equal(event.data.role, 'user');
    assert.deepEqual(event.data.content.map(blockText), prompts[index].prompt.map(blockText), 'Native journal must retain canonical blocks verbatim');
    assert.deepEqual(event.data.content.flatMap(block => block.meta?.[appUseContext] ?? []), [placements[index]]);
    assert.equal(event.data.content[1].meta[appUseContext], placements[index]);
  }
  const requests = journal.filter(event => event.type === 'request/prompt-receipt');
  const wireReceipts = journal.filter(event => event.type === 'request/wire-size');
  assert.equal(requests.length, calls.length);
  assert.equal(wireReceipts.length, calls.length);
  const providerSkillCounts = calls.map(input => ({
    latestUser: count(text(input.messages.findLast(message => message.role === 'user')), skill),
    allMessages: count(input.messages.map(text).join('\n'), skill),
  }));
  assert.deepEqual(providerSkillCounts, [
    { latestUser: 1, allMessages: 1 }, { latestUser: 1, allMessages: 1 }, { latestUser: 1, allMessages: 1 },
  ]);
  assert.deepEqual(requests.map(event => event.data.promptId), [prepared[0].promptId, prepared[0].promptId, prepared[1].promptId]);
  assert.deepEqual(requests.map(event => event.data.step), [1, 2, 1]);
  assert.deepEqual(requests.map(event => event.data.attempt), [1, 1, 1]);
  for (const [index, entry] of requests.entries()) {
    const receipt = entry.data;
    assert.equal(receipt.stage, 'logical');
    assert.equal(receipt.purpose, 'main');
    assert.equal(receipt.provider, 'configured');
    assert.equal(receipt.model, calls[index].model);
    assert(receipt.afterSeq < entry.seq);
    const { messages } = calls[index];
    const userMessages = messages.filter(message => message.role === 'user');
    const logicalUsers = receipt.messages.filter(message => message.role === 'user');
    assert.equal(userMessages.length, receipt.turn);
    assert.equal(logicalUsers.length, userMessages.length);
    for (const [position, message] of userMessages.entries()) {
      const expected = prompts[position].prompt.filter(block => position === receipt.turn - 1 || !block._meta?.[appUseContext]);
      assert.equal(logicalUsers[position].blocks.length, expected.length);
      assert(text(message) === expected.map(blockText).join(''),
        'Preserve exact user, selected context and App Agent Plugin text and paragraph boundaries. Keep the workflow only on the newest turn.');
    }
    assert(!httpBodies[index].includes(appUseContext), 'Native App Use provenance is not part of the provider request');
    const system = messages.find(message => message.role === 'system');
    assert(text(system).includes(mcpGuidance), 'Provider capture must contain the MCP PromptRegistry fixture');
    assert.deepEqual(receipt.system, { sha256: `sha256:${digest(text(system))}`, bytes: Buffer.byteLength(text(system)) });
    assert(receipt.sections.some(section => section.id.startsWith('mcp-resource-servers:') && section.bytes > 0));
    const wireReceipt = wireReceipts[index];
    assert(entry.seq < wireReceipt.seq);
    assert.equal(wireReceipt.data.stage, 'prepared_for_http');
    assert.equal(wireReceipt.data.promptReceiptSeq, entry.seq);
    assert.equal(wireReceipt.data.promptId, receipt.promptId);
    assert.equal(wireReceipt.data.payload_bytes, httpBodies[index].length);
    assert.equal(wireReceipt.data.payload_sha256, digest(httpBodies[index]));
  }
  assert(requests[1].data.messages.some(message => message.role === 'tool'), 'Second model request must include tool evidence');

  const report = {
    scope: 'Current Rust Host, captured ACP stdio, persisted Go Harness journal and scripted loopback model. No external provider calls.',
    acpSessionId: ready.data.sessionId,
    nativeHistory: nativeUser.map(event => ({ seq: event.seq, placements: event.data.content.flatMap(block => block.meta?.[appUseContext] ?? []),
      fullAppUseBodyCount: count(event.data.content.map(blockText).join('\n'), skill) })),
    acp: prepared.map((receipt, index) => ({ promptId: receipt.promptId, sources: receipt.blocks.map(block => block.source),
      placement: prompts[index].prompt[1]._meta[appUseContext],
      fullAppUseBodyCount: count(prompts[index].prompt.map(blockText).join('\n'), skill), suppressedSources: receipt.suppressedSources })),
    provider: requests.map((entry, index) => ({ ...entry.data, journalSeq: entry.seq,
      wireRoles: calls[index].messages.map(message => message.role), wireReceipt: wireReceipts[index].data,
      fullAppUseBodyCount: providerSkillCounts[index] })),
  };
  const serialized = JSON.stringify(report, null, 2);
  for (const secret of [mcpToken, providerKey, observation, pluginInstructions, first, second, skill, toolEvidence]) assert(!serialized.includes(secret));
  if (process.env.PERO_PROMPT_RECEIPT_REPORT) {
    const base = process.env.PERO_PROMPT_RECEIPT_REPORT;
    const capturedPrompts = sentFrames.map(frame => frame.line).join('\n') + '\n';
    const capturedModels = Buffer.concat(httpBodies.flatMap(body => [body, Buffer.from('\n')]));
    const capturedHistory = [...hostUser.map(event => ({ owner: 'host', event })),
      ...nativeUser.map(event => ({ owner: 'harness', event }))].map(event => JSON.stringify(event)).join('\n') + '\n';
    for (const secret of [mcpToken, providerKey]) {
      assert(!capturedPrompts.includes(secret));
      assert(!capturedModels.includes(secret));
      assert(!capturedHistory.includes(secret));
    }
    await Promise.all([
      writeFile(`${base}.json`, serialized + '\n', { mode: 0o600 }),
      writeFile(`${base}.acp.jsonl`, capturedPrompts, { mode: 0o600 }),
      writeFile(`${base}.provider.jsonl`, capturedModels, { mode: 0o600 }),
      writeFile(`${base}.history.jsonl`, capturedHistory, { mode: 0o600 }),
    ]);
  }
  console.log(`Prompt receipts verified for ${prompts.length} ACP turns and ${requests.length} real Harness model requests.`);
} finally {
  if (host?.exitCode === null && host.signalCode === null) {
    host.stdin.end();
    const timer = setTimeout(() => host.kill('SIGKILL'), 5000);
    try { await exit; } finally { clearTimeout(timer); }
  }
  await Promise.all(servers.map(closeLoopback));
  await rm(profile, { recursive: true, force: true });
}

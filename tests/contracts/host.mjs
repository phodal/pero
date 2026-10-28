// Drives the real pero-host through the ACP fixture and validates every JSONL
// line in both directions against protocol/generated/host.schema.json.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../protocol/generated/host.schema.json' with { type: 'json' };

const root = resolve(import.meta.dirname, '../..');
const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false });
ajv.addSchema(schema);
const validator = (name) => ajv.getSchema(`${schema.$id}#/$defs/${name}`);
const validInput = validator('HostInput');
const validEvent = validator('HostEvent');
// Map each discriminator value to its variant so failures report one branch, not every oneOf arm.
const variants = (union, tag) => schema.$defs[union].oneOf.flatMap(function flatten({ $ref }) {
  const name = $ref.split('/').pop();
  const def = schema.$defs[name];
  return def.oneOf ? def.oneOf.flatMap(flatten) : [[def.properties[tag].const, name]];
});
const eventVariants = new Map(variants('HostEvent', 'kind'));
const commandVariants = new Map(variants('HostCommand', 'action'));
const explain = (name, value) => {
  if (!name) return 'no matching variant';
  const validate = validator(name);
  validate(value);
  return `${name}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`;
};

const temp = mkdtempSync(`${tmpdir()}/pero-contract-`);
const agents = resolve(temp, 'agents.json');
writeFileSync(agents, JSON.stringify([{ id: 'fixture', name: 'ACP test fixture', command: process.execPath, args: [resolve(root, 'tests/fixtures/acp-agent.mjs')] }]));
writeFileSync(resolve(temp, 'notes.txt'), 'Context file for the contract test.\n');
const env = { ...process.env, PERO_LOCALE: 'en', PERO_SETTINGS_PATH: resolve(temp, 'settings.json'), PERO_HISTORY_PATH: resolve(temp, 'sessions.jsonl'), PERO_AGENTS_FILE: agents, PERO_CODE_RUNS_PATH: resolve(temp, 'code-runs.json'), PERO_CODE_RUNS_DIR: resolve(temp, 'code-programs') };

const failures = [];
const seen = new Set();

function startHost() {
  const child = spawn(resolve(root, 'target/debug/pero-host'), ['--stdio'], { cwd: temp, env, stdio: ['pipe', 'pipe', 'inherit'] });
  const events = [];
  let waiters = [];
  createInterface({ input: child.stdout }).on('line', (line) => {
    let event;
    try { event = JSON.parse(line); } catch { failures.push(`non-JSON event: ${line}`); return; }
    seen.add(event.kind);
    if (eventVariants.has(event.kind) && !validEvent(event)) failures.push(`event ${explain(eventVariants.get(event.kind), event)}\n    ${line.slice(0, 240)}`);
    // Replayed journal entries are validated by ReplayData; count their kinds too.
    for (const replayed of event.kind === 'replay' ? event.data?.events ?? [] : []) seen.add(`replay:${replayed.kind}`);
    events.push(event);
    waiters = waiters.filter((waiter) => !waiter(event));
  });
  const send = (input, { invalid = false } = {}) => {
    if (!invalid && !validInput(input)) {
      const name = input.action ? commandVariants.get(input.action) : input.method === 'settings.remote' ? 'SetRemoteSettingsRequest' : input.method ? 'SetLocaleRequest' : 'EchoRequest';
      const preview = input.method === 'settings.remote' ? '[remote settings redacted]' : JSON.stringify(input);
      failures.push(`input ${preview}: ${explain(name, input)}`);
    }
    child.stdin.write((typeof input === 'string' ? input : JSON.stringify(input)) + '\n');
  };
  const next = (kind, match = () => true, timeout = 5000) => new Promise((resolveEvent, reject) => {
    const found = events.find((event) => event.kind === kind && match(event) && !event.taken);
    if (found) { found.taken = true; return resolveEvent(found); }
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${kind}`)), timeout);
    waiters.push((event) => {
      if (event.kind !== kind || !match(event)) return false;
      event.taken = true; clearTimeout(timer); resolveEvent(event); return true;
    });
  });
  const stop = () => new Promise((done) => { child.once('exit', done); child.stdin.end(); });
  return { send, next, stop };
}

try {
  let host = startHost();
  await host.next('settings');
  await host.next('ready');

  host.send({ id: 'probe-1', text: '你好，Pero' });
  await host.next('echo', (e) => e.request_id === 'probe-1');
  host.send('not json', { invalid: true });
  await host.next('error');
  host.send({ method: 'settings.locale', locale: 'zh-CN' });
  await host.next('settings', (e) => e.text === 'zh-CN');

  const storedConnection = { url: 'https://openpero.com', mode: 'client', encrypted_token: 'ZW5jcnlwdGVk' };
  host.send({ method: 'settings.remote', id: 'remote-save', connection: storedConnection });
  const saved = await host.next('remote_settings_saved', e => e.request_id === 'remote-save');
  if (saved.text || saved.data !== undefined) failures.push('remote preference acknowledgement exposed a payload');
  const preferences = () => JSON.parse(readFileSync(env.PERO_SETTINGS_PATH, 'utf8'));
  if (!isDeepStrictEqual(preferences().remote_connection, storedConnection)) failures.push('Host did not persist encrypted remote preference');
  if (preferences().locale !== 'zh-CN') failures.push('Saving remote connection replaced locale');
  if (process.platform !== 'win32' && (statSync(env.PERO_SETTINGS_PATH).mode & 0o777) !== 0o600) failures.push('Runtime preferences must be private to the user');
  for (const connection of [{ ...storedConnection, token: 'never-store-plaintext' }, { ...storedConnection, encrypted_token: '====' }, undefined]) {
    host.send({ method: 'settings.remote', id: 'remote-invalid', ...(connection === undefined ? {} : { connection }) }, { invalid: true });
    await host.next('remote_settings_error', e => e.request_id === 'remote-invalid');
  }
  if (!isDeepStrictEqual(preferences().remote_connection, storedConnection)) failures.push('Invalid remote preference changed existing settings');

  host.send({ action: 'list_agents' });
  await host.next('agents');
  await host.next('replay');
  host.send({ action: 'workspace', path: temp });
  await host.next('workspace');
  host.send({ action: 'attach_files', paths: [resolve(temp, 'notes.txt')] });
  await host.next('context_files');

  const thread = 'contract-thread';
  const inThread = (e) => e.thread_id === thread;
  host.send({ action: 'new_session', thread_id: thread, agent_id: 'fixture' });
  await host.next('session_created', inThread);
  await host.next('session_ready', inThread, 10000);

  host.send({ action: 'prompt', thread_id: thread, text: 'hello' });
  await host.next('user_message', inThread);
  await host.next('turn_finished', inThread);

  host.send({ action: 'prompt', thread_id: thread, text: 'needs permission' });
  const permission = await host.next('permission', inThread);
  host.send({ action: 'permission', thread_id: thread, request_id: permission.data.permission_id, option_id: 'allow' });
  await host.next('turn_finished', inThread);

  host.send({ action: 'model', thread_id: thread, model_id: 'fixture' });
  await host.next('model_changed', inThread);

  host.send({ action: 'prompt', thread_id: thread, text: 'wait' });
  await host.next('turn_started', inThread);
  host.send({ action: 'prompt', thread_id: thread, text: 'queued follow-up' });
  await host.next('prompt_queued', inThread);
  host.send({ action: 'cancel', thread_id: thread });
  await host.next('turn_finished', (e) => inThread(e) && e.data?.stopReason === 'cancelled');

  host.send({ action: 'authenticate', thread_id: thread, method_id: 'none' });
  await host.next('session_auth_error', inThread);
  host.send({ action: 'close', thread_id: thread });
  await host.next('session_closed', inThread);
  host.send({ action: 'prompt', thread_id: thread, text: 'after close' });
  await host.next('session_error', inThread);

  const program = 'print(1)\n';
  host.send({ action: 'run_code', id: 'run-missing', env_id: 'local', program });
  const unavailable = await host.next('error', (e) => e.request_id === 'run-missing');
  if (unavailable.text !== 'unavailable') failures.push(`code run without an allowlist returned ${unavailable.text}`);
  const fake = resolve(root, 'target/debug', process.platform === 'win32' ? 'pero-code-fake.exe' : 'pero-code-fake');
  const log = resolve(temp, 'invocations.log');
  const prefix = process.platform === 'win32' ? 'C:\\science' : '/opt/science';
  if (!existsSync(fake)) failures.push(`missing test interpreter ${fake}`);
  const stored = preferences();
  stored.code_envs = [{ id: 'local', interpreter: fake }];
  writeFileSync(env.PERO_SETTINGS_PATH, JSON.stringify(stored));
  host.send({ action: 'run_code', id: 'run-1', env_id: 'local', program });
  const ran = await host.next('code_run', (e) => e.request_id === 'run-1');
  const digest = createHash('sha256').update(program).digest('hex');
  if (ran.text !== 'exit' || ran.data.stop !== 'exit' || ran.data.exit_code !== 0 || ran.data.stdout !== 'ok\n' || ran.data.prefix !== prefix || ran.data.marker_digest !== 'deadbeef' || ran.data.truncated !== false || ran.data.program_digest !== digest) {
    failures.push(`code run receipt mismatch ${JSON.stringify(ran.data)}`);
  }
  host.send({ action: 'run_code', id: 'run-1', env_id: 'local', program });
  await host.next('code_run', (e) => e.request_id === 'run-1');
  if (readFileSync(log, 'utf8').trim().split('\n').length !== 1) failures.push('replay started the interpreter again');
  host.send({ action: 'run_code', id: 'run-1', env_id: 'local', program: 'print(2)\n' });
  const conflict = await host.next('error', (e) => e.request_id === 'run-1');
  if (conflict.text !== 'conflict') failures.push(`changed program returned ${conflict.text}`);
  await host.stop();

  // A fresh Host replays the journal written above.
  host = startHost();
  await host.next('ready');
  if (!isDeepStrictEqual(preferences().remote_connection, storedConnection)) failures.push('Remote preference was lost after Host restart');
  host.send({ method: 'settings.remote', id: 'remote-disconnect', connection: null });
  await host.next('remote_settings_saved', e => e.request_id === 'remote-disconnect');
  if (preferences().remote_connection !== null || preferences().locale !== 'zh-CN') failures.push('Disconnect must retain a tombstone and preserve locale');
  host.send({ action: 'list_agents' });
  const replay = await host.next('replay');
  if (!replay.data.events.length) failures.push('replay after restart contained no events');
  await host.stop();
} catch (error) {
  failures.push(String(error));
} finally {
  rmSync(temp, { recursive: true, force: true });
}

const declared = [...eventVariants.keys()];
const undeclared = [...seen].filter((kind) => !kind.startsWith('replay:') && !declared.includes(kind));
const unexercised = declared.filter((kind) => !seen.has(kind));
if (undeclared.length) failures.push(`Host emitted kinds missing from host.tsp: ${undeclared.join(', ')}`);
console.log(`Observed ${[...seen].filter((k) => !k.startsWith('replay:')).length}/${declared.length} declared event kinds.`);
if (unexercised.length) console.log(`Not exercised here: ${unexercised.join(', ')}`);
if (failures.length) {
  console.error(`\n${failures.length} contract failure(s):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('Host protocol conformance passed.');

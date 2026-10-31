// Non-GUI real Host -> launcher -> synthetic ACP process. The probe never opens
// a socket; it records non-secret arguments and answers the ACP handshake.
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
const root = resolve(import.meta.dirname, '../../..');

test('real Host preserves explicit fixture mode through launcher without network', { timeout: 30000 }, async () => {
  const temp = await mkdtemp(resolve(tmpdir(), 'pero-live-host-'));
  const output = resolve(root, 'test-results/control-lab-live');
  await mkdir(output, { recursive: true });
  const run = await mkdtemp(resolve(output, 'host-probe-'));
  const ledger = resolve(run, 'fixture-ledger.json'), capture = resolve(temp, 'args.json');
  const probe = resolve(temp, 'agent.mjs'), registry = resolve(temp, 'agents.json');
  await writeFile(resolve(temp, 'settings.json'), JSON.stringify({ computer_use: { enabled: false } }));
  const fakeAgent = `#!/usr/bin/env node\nimport {writeFileSync} from 'node:fs'; import {createInterface} from 'node:readline';\nwriteFileSync(process.env.CONTROL_LAB_PROBE_PATH,JSON.stringify(process.argv.slice(2)));\ncreateInterface({input:process.stdin}).on('line',line=>{const {id,method}=JSON.parse(line);if(method==='initialize')process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result:{protocolVersion:1,agentCapabilities:{mcpCapabilities:{http:true}},agentInfo:{name:'probe',version:'1'}}})+'\\n');else if(method==='session/new')process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result:{sessionId:'probe'}})+'\\n');});\n`;
  await writeFile(probe, fakeAgent); await chmod(probe, 0o700);
  const hash = createHash('sha256').update(await readFile(probe)).digest('hex');
  const endpoint = 'http://127.0.0.1:43210/v1';
  await writeFile(registry, JSON.stringify([{ id: 'fixture', name: 'Fixture', command: process.execPath,
    args: [resolve(root, 'tests/runtime/control-lab/live-agent.mjs'), probe, hash, resolve(temp, 'sessions'), '1', 'fixture', endpoint, ledger] }]));
  const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PERO_')));
  const host = spawn(resolve(root, 'target/debug/pero-host'), ['--stdio'], { cwd: temp, env: { ...baseEnv,
    PERO_AGENTS_FILE: registry, PERO_SETTINGS_PATH: resolve(temp, 'settings.json'), PERO_HISTORY_PATH: resolve(temp, 'history.jsonl'),
    DEEPSEEK_API_KEY: 'local-control-lab-fixture', CONTROL_LAB_PROBE_PATH: capture }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  host.stderr.on('data', data => { stderr += data; });
  const events = [], waiters = new Set();
  createInterface({ input: host.stdout }).on('line', line => {
    const event = JSON.parse(line), waiter = [...waiters].find(item => item.match(event));
    if (waiter) { waiters.delete(waiter); clearTimeout(waiter.timer); waiter.resolve(event); } else events.push(event);
  });
  function next(kind) {
    const match = event => event.kind === kind;
    const i = events.findIndex(match); if (i >= 0) return Promise.resolve(events.splice(i, 1)[0]);
    return new Promise((resolveEvent, reject) => {
      const waiter = { match, resolve: resolveEvent }; waiter.timer = setTimeout(() => { waiters.delete(waiter); reject(new Error(`Host timeout waiting for ${kind}: ${stderr}`)); }, 15000); waiters.add(waiter);
    });
  }
  try {
    await next('ready');
    assert.equal((await next('computer_settings')).data.enabled, false);
    host.stdin.write(JSON.stringify({ action: 'new_session', thread_id: 'probe', agent_id: 'fixture' }) + '\n');
    await next('session_ready');
    const args = JSON.parse(await readFile(capture, 'utf8'));
    assert.equal(args[args.indexOf('--endpoint') + 1], endpoint);
    assert.equal(args[args.indexOf('--http-attempt-audit') + 1], `${ledger}.attempts`);
    assert.equal(args[args.indexOf('--max-requests') + 1], '1');
    assert.equal(args[args.indexOf('--max-tokens') + 1], '8192');
    assert.equal(args[args.indexOf('--max-retries') + 1], '0');
    for (const disabled of ['--workspace', '--enable-shell', '--enable-agent-instructions', '--enable-todos', '--enable-subagents'])
      assert.equal(args.includes(disabled), false, `${disabled} must stay disabled`);
    assert.equal(await readFile(`${ledger}.attempts`, 'utf8'), '');
    assert.equal(JSON.parse(await readFile(ledger, 'utf8')).reserved, 1);
  } finally {
    const exited = once(host, 'exit'); host.stdin.end();
    await exited;
    await rm(temp, { recursive: true, force: true });
    await rm(run, { recursive: true, force: true });
  }
});

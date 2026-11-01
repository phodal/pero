// Native Wry App + shared GPUI Chat + the same MCP authority used by Electron.
import { spawn, execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '../..');
const realAgent=process.env.PERO_NATIVE_PAPER_AGENT;
if(realAgent && realAgent!=='pero')throw Error('Native real-provider acceptance currently uses the built-in Pero harness.');
const out = resolve(root, process.env.PERO_NATIVE_PAPER_OUTPUT || 'test-results/native-paper-chat');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-native-paper-chat-'));
await mkdir(out, { recursive: true });
const binary = resolve(temp, 'pero-native'), host = resolve(temp, 'pero-host');
await copyFile(resolve(root, process.env.PERO_NATIVE_PAPER_BINARY || 'target/debug/pero-native'), binary);
await copyFile(resolve(root, 'target/debug/pero-host'), host);
await copyFile(resolve(root, 'target/debug/pero-connector-worker'), resolve(temp, 'pero-connector-worker'));
assert((await readFile(binary)).includes(Buffer.from('Native Paper Chat timed out')), 'Build with native-probe first');
if (process.platform === 'darwin') execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', binary], { stdio: 'pipe' });
const data = resolve(temp, 'data');
await mkdir(data);
await writeFile(resolve(data, 'settings.json'), JSON.stringify({ chat_agent: realAgent || 'paper-fixture' }));
const agents = resolve(temp, 'agents.json');
await writeFile(agents, JSON.stringify([{ id: 'paper-fixture', name: 'Synthetic Paper fixture', command: process.execPath,
  args: [resolve(root, 'tests/fixtures/paper-agent.mjs'), `--capture=${resolve(out, 'turns.jsonl')}`] }]));
const receipt = resolve(out, 'result.json');
await Promise.all(['result.json', 'turns.jsonl', 'turns.jsonl.mcp.jsonl', 'turns.jsonl.errors.jsonl'].map(file => rm(resolve(out, file), { force: true })));
const child = spawn(binary, ['--verify-apps', receipt, 'paper-chat'], { cwd: root, env: { ...process.env,
  PERO_NATIVE_BUNDLED: '1', PERO_NATIVE_EPHEMERAL_SECRETS: '1', PERO_NATIVE_DATA_DIR: data, PERO_NATIVE_HOST: host,
  PERO_ENV_FILE:process.env.PERO_ENV_FILE || resolve(root,'.env'), PERO_NATIVE_PAPER_PDF:resolve(root,process.env.PERO_NATIVE_PAPER_PDF || 'target/paper-harness-fixture.pdf'), PERO_AGENTS_FILE:realAgent?undefined:agents, PERO_BUILTIN_APPS: 'paper-agent', PERO_REQUIRED_APPS: '', PERO_LOCALE: 'en',
}, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', value => log += value);
child.stderr.on('data', value => log += value);
const deadline = setTimeout(() => child.kill('SIGKILL'), realAgent ? 300000 : 60000);
try {
  const exit = await new Promise((resolveExit, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolveExit({ code, signal })); });
  await writeFile(resolve(out, 'native.log'), log);
  assert.equal(exit.signal, null, log); assert.equal(exit.code, 0, log);
  const result = JSON.parse(await readFile(receipt, 'utf8'));
  assert.equal(result.passed, true, JSON.stringify(result));
  assert.equal(result.library.reports.length, 1);
  assert.equal(result.realModel,!!realAgent);
  result.agent=realAgent||'paper-fixture';
  const chat=result.chat.chats[result.chat.activeChat];
  result.toolCalls=chat.tools.length;result.failedTools=chat.tools.filter(tool=>tool.status==='failed').map(tool=>({title:tool.title,error:tool.content}));
  await writeFile(receipt,JSON.stringify(result,null,2));
  console.log(JSON.stringify({ checks: result.checks, realModel:result.realModel,toolCalls:result.toolCalls,failedTools:result.failedTools.length }));
} finally { clearTimeout(deadline); child.kill(); await rm(temp, { recursive: true, force: true }); }

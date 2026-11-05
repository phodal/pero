// Real Rust Host + ACP fixture + shared MCP delivery. No UI, model or external network.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { DesktopAppUse } from '../../desktop/src/main/app-use-mcp.ts';
import { HostArtifactDelivery } from '../../desktop/src/main/artifact-delivery.ts';
import { richArtifactFiles } from '../fixtures/session-artifact-files.mjs';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../protocol/generated/host.schema.json' with { type: 'json' };

const root = resolve(import.meta.dirname, '../..');
const binary = process.env.PERO_HOST_PATH || join(root, 'target/debug/pero-host');
const output = join(root, 'test-results/session-artifacts-host');
const ajv = new Ajv2020({ strict: true, strictTypes: false });
ajv.addSchema(schema);
const validRequest = ajv.getSchema(`${schema.$id}#/$defs/ArtifactRequest`);
const validEvent = ajv.getSchema(`${schema.$id}#/$defs/HostEvent`);
const directory = await realpath(await mkdtemp(join(tmpdir(), 'pero-artifact-host-')));
const workspace = join(directory, 'workspace'), another = join(directory, 'another-workspace');
await Promise.all([mkdir(workspace), mkdir(another), mkdir(output, { recursive: true })]);
await rm(join(output, 'result.json'), { force: true });
const settings = join(directory, 'settings.json'), history = join(directory, 'sessions.jsonl');
const capture = join(directory, 'session-capture.jsonl'), agents = join(directory, 'agents.json');
await writeFile(agents, JSON.stringify([{ id: 'fixture', name: 'Artifact ACP fixture', command: process.execPath,
  args: [join(root, 'tests/fixtures/acp-agent.mjs'), `--session-capture=${capture}`] }]));
await writeFile(join(workspace, 'report.md'), '# Report\n\nFirst captured result.\n');
await writeFile(join(another, 'report.md'), '# Unrelated workspace\n');
const fixtures = richArtifactFiles();
await Promise.all(fixtures.map(file => writeFile(join(workspace, file.name), file.data)));
const largeCsv = Buffer.from('sample,value\n' + 'A,7\n'.repeat(33000));
await writeFile(join(workspace, 'large.csv'), largeCsv);
const mediaKinds = { 'analysis.py': 'document', 'results.csv': 'csv', 'chart.svg': 'image', 'chart.png': 'image',
  'report.html': 'html', 'evidence.pdf': 'pdf', 'analysis.ipynb': 'notebook' };

let host, hostExit, events = [], stderr = '', sequence = 0;
const changed = new EventEmitter();
function writeHost(command) {
  if (command.method === 'artifacts') assert.ok(validRequest(command), ajv.errorsText(validRequest.errors));
  host.stdin.write(JSON.stringify(command) + '\n');
}
const delivery = new HostArtifactDelivery(writeHost);
const desktop = new DesktopAppUse({
  selectedThread: async () => 'a-different-visible-chat',
  page: async () => { throw Error('Ordinary delivery has no App panel'); },
  capture: async () => { throw Error('Ordinary delivery has no App capture'); },
  presence() {},
}, () => {}, join(directory, 'app-evidence'), undefined, undefined, delivery.deliver);
const endpoint = await desktop.start();
const env = { ...process.env, ...endpoint, PERO_SETTINGS_PATH: settings, PERO_HISTORY_PATH: history,
  PERO_AGENTS_FILE: agents, PERO_APPS_ROOT: join(directory, 'apps'), PERO_BUILTIN_APPS_ROOT: '',
  PERO_BUILTIN_APPS: '', PERO_REQUIRED_APPS: '', PERO_ENV_FILE: join(directory, 'no-env'), UV_OFFLINE: '1' };
function start() {
  events = [];
  host = spawn(binary, ['--stdio'], { cwd: workspace, env, stdio: ['pipe', 'pipe', 'pipe'] });
  hostExit = once(host, 'exit');
  host.stderr.on('data', value => { stderr += value; });
  createInterface({ input: host.stdout }).on('line', line => {
    const event = JSON.parse(line);
    if (event.kind.startsWith('artifact_')) assert.ok(validEvent(event), ajv.errorsText(validEvent.errors));
    if (!delivery.accept(event)) desktop.accept(event);
    events.push(event);
    changed.emit('event');
  });
}
async function wait(predicate, after = 0) {
  const deadline = Date.now() + 15000;
  for (;;) {
    const event = events.slice(after).find(predicate);
    if (event) return event;
    const remaining = deadline - Date.now();
    assert.ok(remaining > 0, `Host event timeout: ${stderr}\n${JSON.stringify(events.slice(-3))}`);
    await new Promise((resolveWait, reject) => {
      const listener = () => { clearTimeout(timer); resolveWait(); };
      const timer = setTimeout(() => { changed.off('event', listener); reject(Error(`Host event timeout: ${stderr}\n${JSON.stringify(events.slice(-8).map(({ kind, thread_id, text }) => ({ kind, thread_id, text })))}`)); }, remaining);
      changed.once('event', listener);
    });
  }
}
function send(command) {
  desktop.command(command);
  writeHost(command);
}
async function request(action, fields) {
  const request_id = `artifact-test-${++sequence}`;
  send({ method: 'artifacts', action, request_id, ...fields });
  return wait(event => event.request_id === request_id);
}
async function create(thread) {
  send({ action: 'new_session', thread_id: thread, agent_id: 'fixture' });
  await wait(event => event.kind === 'session_ready' && event.thread_id === thread);
  send({ action: 'prompt', thread_id: thread, text: 'wait for artifact acceptance' });
  await wait(event => event.kind === 'turn_started' && event.thread_id === thread);
  const captured = (await readFile(capture, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const mcp = captured.flatMap(value => value.mcpServers || []).find(value =>
    value.url === endpoint.PERO_APP_USE_URL && value.headers.some(header => header.name.toLowerCase() === 'x-pero-thread' && header.value === thread));
  assert.ok(mcp, 'Use the actual Host-injected ACP MCP server and caller header');
  return async (method, params) => {
    const response = await fetch(mcp.url, { method: 'POST', headers: {
      ...Object.fromEntries(mcp.headers.map(header => [header.name, header.value])), 'content-type': 'application/json',
    }, body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }) });
    assert.equal(response.status, 200);
    const reply = await response.json();
    assert.equal(reply.error, undefined);
    return reply.result;
  };
}
async function stop() {
  if (!host) return;
  const child = host;
  child.stdin.end();
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
  try {
    const [code, signal] = await hostExit;
    assert.equal(signal, null, stderr);
    assert.equal(code, 0, stderr);
  } finally { clearTimeout(timer); host = undefined; }
}
try {
  start();
  await wait(event => event.kind === 'ready');
  const caller = await create('artifact-caller');
  const catalog = await caller('tools/list');
  assert.ok(catalog.tools.some(tool => tool.name === 'deliver_artifact'));
  const deliver = input => caller('tools/call', { name: 'deliver_artifact', arguments: input });
  const firstResult = await deliver({ path: 'report.md', title: 'Research report' });
  assert.equal(firstResult.isError, false, JSON.stringify(firstResult));
  const first = JSON.parse(firstResult.content[0].text).artifact;
  assert.equal(first.thread_id, 'artifact-caller');
  assert.equal(first.versions.length, 1);
  const secondText = '# Report\n\nRevised captured result.\n';
  await writeFile(join(workspace, 'report.md'), secondText);
  const secondResult = await deliver({ path: 'report.md', artifact_id: first.id });
  assert.equal(secondResult.isError, false, JSON.stringify(secondResult));
  const second = JSON.parse(secondResult.content[0].text).artifact;
  assert.equal(second.id, first.id);
  assert.equal(second.versions.length, 2);
  const old = await request('read', { thread_id: 'artifact-caller', artifact_id: first.id, version: 1 });
  assert.equal(old.kind, 'artifact_document');
  assert.equal(old.text, '# Report\n\nFirst captured result.\n');

  const rich = [];
  for (const file of fixtures) {
    const result = await deliver({ path: file.name, title: file.title });
    assert.equal(result.isError, false, JSON.stringify(result));
    const artifact = JSON.parse(result.content[0].text).artifact;
    const snapshot = await delivery.resolveSnapshot('artifact-caller', artifact.id, 1, AbortSignal.timeout(15000));
    assert.equal(snapshot.filename, file.name);
    assert.equal(snapshot.media.kind, mediaKinds[file.name]);
    assert.equal(snapshot.bytes, file.data.length);
    assert.equal(snapshot.sha256, createHash('sha256').update(file.data).digest('hex'));
    assert.notEqual(snapshot.path, join(workspace, file.name), 'Preview must use the frozen Host file');
    assert.deepEqual(await readFile(snapshot.path), file.data);
    rich.push({ file, artifact, snapshot });
  }
  const image = rich.find(item => item.file.name === 'chart.png');
  const imageContext = await request('context', { thread_id: 'artifact-caller', artifact_id: image.artifact.id, version: 1 });
  assert.equal(imageContext.kind, 'artifact_context');
  assert.equal(imageContext.data.source, `session-artifact:${image.artifact.id}:v1`);
  assert.equal(imageContext.data.content.type, 'image');
  assert.deepEqual(Buffer.from(imageContext.data.content.data, 'base64'), image.file.data);
  const table = rich.find(item => item.file.name === 'results.csv');
  const tableContext = await request('context', { thread_id: 'artifact-caller', artifact_id: table.artifact.id, version: 1 });
  assert.equal(tableContext.data.content.text, table.file.data.toString('utf8'));
  const pdf = rich.find(item => item.file.name === 'evidence.pdf');
  const pdfContext = await request('context', { thread_id: 'artifact-caller', artifact_id: pdf.artifact.id, version: 1 });
  assert.equal(pdfContext.data.content.type, 'text');
  assert.ok(pdfContext.data.content.text.includes(pdf.snapshot.path));
  assert.ok(pdfContext.data.content.text.includes(pdf.snapshot.sha256));
  assert.ok(pdfContext.data.content.text.includes('contents are not included'));
  const largeResult = await deliver({ path: 'large.csv' });
  assert.equal(largeResult.isError, false, JSON.stringify(largeResult));
  const large = JSON.parse(largeResult.content[0].text).artifact;
  const largeContext = await request('context', { thread_id: 'artifact-caller', artifact_id: large.id, version: 1 });
  assert.equal(largeContext.data.content.type, 'text');
  assert.ok(largeContext.data.content.text.includes(createHash('sha256').update(largeCsv).digest('hex')));
  assert.ok(largeContext.data.content.text.includes('contents are not included'));
  const revisedImage = richArtifactFiles(2).find(file => file.name === 'chart.png');
  await writeFile(join(workspace, revisedImage.name), revisedImage.data);
  const revisedImageResult = await deliver({ path: revisedImage.name, artifact_id: image.artifact.id });
  assert.equal(revisedImageResult.isError, false, JSON.stringify(revisedImageResult));
  assert.equal(JSON.parse(revisedImageResult.content[0].text).artifact.versions.length, 2);

  // Changing current navigation cannot replace a conversation's original workspace.
  send({ action: 'workspace', path: another });
  await wait(event => event.kind === 'workspace' && event.text === another);
  const originalWorkspaceResult = await deliver({ path: 'report.md', artifact_id: first.id });
  assert.equal(originalWorkspaceResult.isError, false, JSON.stringify(originalWorkspaceResult));
  const originalWorkspace = JSON.parse(originalWorkspaceResult.content[0].text).artifact;
  assert.equal(originalWorkspace.versions.at(-1).sha256, createHash('sha256').update(secondText).digest('hex'));
  for (const input of [{ path: join(another, 'report.md') }, { path: 'report.md', thread_id: 'foreign' }]) {
    assert.equal((await deliver(input)).isError, true);
  }
  const otherCaller = await create('other-caller');
  const foreign = await otherCaller('tools/call', { name: 'deliver_artifact', arguments: { path: 'report.md', artifact_id: first.id } });
  assert.equal(foreign.isError, true);
  send({ action: 'cancel', thread_id: 'artifact-caller' });
  await wait(event => event.kind === 'turn_finished' && event.thread_id === 'artifact-caller');
  assert.equal((await deliver({ path: 'report.md' })).isError, true);
  send({ action: 'cancel', thread_id: 'other-caller' });
  await wait(event => event.kind === 'turn_finished' && event.thread_id === 'other-caller');
  await stop();

  desktop.reset();
  start();
  await wait(event => event.kind === 'ready');
  const restored = await request('list', { thread_id: 'artifact-caller' });
  assert.equal(restored.kind, 'artifact_catalog');
  assert.equal(restored.data.artifacts.length, fixtures.length + 2);
  assert.equal(restored.data.artifacts.find(item => item.id === first.id).versions.length, 3);
  await rm(join(workspace, 'report.md'));
  const saved = await request('read', { thread_id: 'artifact-caller', artifact_id: first.id, version: 2 });
  assert.equal(saved.kind, 'artifact_document');
  assert.equal(saved.text, secondText, 'Saved versions do not depend on the current file');
  await Promise.all([...fixtures.map(file => file.name), 'large.csv'].map(name => rm(join(workspace, name))));
  for (const { file, artifact } of rich) {
    const snapshot = await delivery.resolveSnapshot('artifact-caller', artifact.id, 1, AbortSignal.timeout(15000));
    assert.deepEqual(await readFile(snapshot.path), file.data, 'Historical rich versions survive source removal and Host restart');
  }
  const latestImage = await delivery.resolveSnapshot('artifact-caller', image.artifact.id, 2, AbortSignal.timeout(15000));
  assert.deepEqual(await readFile(latestImage.path), revisedImage.data);
  const foreignSnapshot = await request('resolve_snapshot', { thread_id: 'other-caller', artifact_id: image.artifact.id, version: 1 });
  assert.equal(foreignSnapshot.kind, 'artifact_snapshot_result');
  assert.equal(foreignSnapshot.data.ok, false);
  assert.equal(foreignSnapshot.data.value, undefined);
  const missingVersion = await request('resolve_snapshot', { thread_id: 'artifact-caller', artifact_id: image.artifact.id, version: 99 });
  assert.equal(missingVersion.data.ok, false);
  assert.equal(missingVersion.data.value, undefined);
  send({ action: 'delete', thread_id: 'other-caller' });
  await wait(event => event.kind === 'session_deleted' && event.thread_id === 'other-caller');
  const deleted = await request('register_text', { thread_id: 'other-caller', title: 'Deleted conversation', text: 'Do not register this' });
  assert.equal(deleted.kind, 'artifact_error');
  assert.equal(deleted.data.reason, 'unavailable');
  const result = { passed: true, level: 'Host and MCP loopback with ACP fixture', modelRequests: 0,
    binarySha256: createHash('sha256').update(await readFile(binary)).digest('hex'),
    artifactId: first.id, versions: restored.data.artifacts.find(item => item.id === first.id).versions.length,
    richFormats: rich.map(({ file, artifact, snapshot }) => ({ filename: file.name, artifactId: artifact.id, kind: snapshot.media.kind, sha256: snapshot.sha256, bytes: snapshot.bytes })),
    checks: ['actual-caller', 'background-delivery', 'original-workspace', 'exact-versions', 'foreign-item-rejected', 'outside-file-rejected', 'cancelled-caller-rejected', 'restart', 'source-file-removed', 'deleted-conversation-rejected',
      'rich-file-bytes-and-metadata', 'binary-exact-versions', 'rich-snapshots-after-restart', 'image-context-bytes', 'text-context-bytes', 'pdf-reference-context', 'large-table-reference-context', 'private-snapshot-rejection', 'artifact-wire-schema'],
    limits: ['No Native or Electron UI', 'No real provider', 'No scientific verification', 'Direct text snapshots up to 2 MiB; supported files up to 10 MiB'] };
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log('Session artifact Host/MCP acceptance passed: exact versions, actual caller, original workspace and restart.');
} finally {
  delivery.close();
  await desktop.close();
  await stop();
  await writeFile(join(output, 'host.log'), stderr);
  await rm(directory, { recursive: true, force: true });
}

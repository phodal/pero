// Real GPUI/Wry + App + Host + keychain + ACP + independent loopback MCP.
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertDesktopAccess } from './electron.mjs';
import { fixture } from '../../packages/connectors/test/fixtures/http.mjs';
import { createCatalog, pointDirectory } from '../../packages/connectors/src/connectors/catalog.mjs';
import { connectorSections } from '../../apps/connectors/ui-src/connector-categories.mjs';

assertDesktopAccess();
const root = resolve(import.meta.dirname, '../..'), out = resolve(root, 'test-results/native-connectors');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-native-connectors-'));
await mkdir(out, { recursive: true });
const remote = await fixture();
const binary = resolve(temp, 'pero-native');
for (const name of ['pero-native', 'pero-host', 'pero-connector-worker']) await copyFile(resolve(root, 'target/debug', name), resolve(temp, name));
const agents = resolve(temp, 'agents.json');
await writeFile(agents, JSON.stringify([{ id: 'codex', name: 'Connector fixture', command: process.execPath, args: [resolve(root, 'tests/fixtures/connectors-acp.mjs')] }]));
const directory = createCatalog(pointDirectory().filter(provider => !provider.channel)).visibleProviders();
const expected = directory.map(provider => provider.providerId).sort();
const cards = connectorSections(directory).reduce((count, section) => count + section.entries.length, 0);
try {
  for (const phase of ['initial', 'restore']) {
    const capture = resolve(temp, phase + '.json'), receipt = resolve(out, phase + '.json');
    const child = spawn(binary, ['--verify-connectors', receipt, phase], { cwd: root, env: { ...process.env,
      PERO_NATIVE_BUNDLED: '1', PERO_NATIVE_EPHEMERAL_SECRETS: '1', PERO_NATIVE_DATA_DIR: resolve(temp, 'data'), PERO_NATIVE_HOST: resolve(temp, 'pero-host'),
      PERO_AGENTS_FILE: agents, PERO_CONNECTORS_CAPTURE: capture, PERO_CONNECTORS_FIXTURE: remote.origin,
      PERO_CONNECTORS_CARDS: String(cards),
      PERO_BUILTIN_APPS: 'connectors', PERO_REQUIRED_APPS: '', PERO_LOCALE: 'en',
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; child.stdout.on('data', value => log += value); child.stderr.on('data', value => log += value);
    const timeout = setTimeout(() => child.kill('SIGKILL'), 90000);
    try {
      const exit = await new Promise((done, reject) => { child.once('error', reject); child.once('exit', (code, signal) => done({ code, signal })); });
      await writeFile(resolve(out, phase + '.log'), log);
      assert.equal(exit.signal, null, log); assert.equal(exit.code, 0, log);
      const value = JSON.parse(await readFile(receipt, 'utf8'));
      assert.equal(value.passed, true, JSON.stringify(value));
      assert.deepEqual(value.app.directory, expected);
      const registry = await readFile(resolve(temp, 'data/connectors/connectors.json'), 'utf8');
      assert(!registry.includes('native-fixture-private-value'), 'Plaintext secret persisted');
    } finally { clearTimeout(timeout); child.kill(); }
  }
  assert.equal(remote.metrics.calls, 2); assert.equal(remote.metrics.publicHeader, true);
  const evidence = { passed: true, directory: expected.length, calls: remote.metrics.calls, restart: true, realKeychain: true,
    sha256: Object.fromEntries(await Promise.all(['target/debug/pero-native', 'target/debug/pero-host', 'target/debug/pero-connector-worker', 'apps/connectors/dist/index.js', 'packages/connectors/helpers/pero-connectors-host.mjs'].map(async name => [name, createHash('sha256').update(await readFile(resolve(root, name))).digest('hex')]))),
  };
  await writeFile(resolve(out, 'result.json'), JSON.stringify(evidence, null, 2));
  console.log(`Native Connectors passed: ${expected.length} providers, real keychain restart, grants, two actual ACP calls, dark/zh/narrow.`);
} finally { await remote.close(); await rm(temp, { recursive: true, force: true }); }

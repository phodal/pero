// Run with: node --experimental-vm-modules --test tests/build/native-dev.test.mjs
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { relative, resolve } from 'node:path';
import { test } from 'node:test';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

// Exercise the entry point with real payload files and fake OS/build seams.
// This does not run Cargo, macOS fs.watch, or the native application.
async function previewFixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'pero-native-dev-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const python = resolve(root, 'harness/go/charts/python');
  mkdirSync(python, { recursive: true });
  for (const name of ['dataset.py', 'view.py', 'chart_document.py']) writeFileSync(resolve(python, name), 'initial\n');
  const watchers = new Map();
  const timers = new Set();
  const commands = [];
  let opened;
  const context = createContext({
    console: { log() {}, error(message) { throw new Error(message); } },
    process: { platform: 'darwin', argv: ['node', 'native.mjs'], env: {}, execPath: process.execPath,
      exit(code) { throw new Error(`Unexpected process exit: ${code}`); } },
    setTimeout(fn) { timers.add(fn); return fn; },
    clearTimeout(fn) { timers.delete(fn); },
  });
  const imports = {
    'node:child_process': { spawn() {
      const child = new EventEmitter();
      child.exitCode = child.signalCode = null;
      child.kill = signal => { child.signalCode = signal; child.emit('exit', null, signal); };
      opened?.resolve();
      return child;
    } },
    'node:fs': { cpSync, mkdirSync, watch(path, _options, callback) { watchers.set(relative(root, path), callback); } },
    'node:path': { resolve },
    '../lib/cargo.mjs': { cargoArgs: args => args, ensureGpuiLock: async () => {} },
    '../lib/macos-icon.mjs': { writeIcns() {} },
    '../lib/paths.mjs': { root },
    '../lib/run.mjs': { run: async (command, args) => { commands.push([command, ...args]); } },
    '../build/harness.mjs': { buildHarness: async () => {} },
  };
  const module = new SourceTextModule(readFileSync(new URL('../../scripts/dev/native.mjs', import.meta.url), 'utf8'), { context });
  await module.link(specifier => {
    const exports = imports[specifier];
    assert.ok(exports, `Unexpected dependency: ${specifier}`);
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context });
  });
  await module.evaluate();
  return { root, python, commands, watchers, async change(path, event = 'change', rebuild = true) {
    const source = [...watchers.keys()].find(source => path === source || path.startsWith(`${source}/`));
    assert.ok(source, `No watcher covers ${path}`);
    opened = Promise.withResolvers();
    watchers.get(source)(event, path === source ? path.split('/').at(-1) : relative(source, path));
    assert.equal(timers.size, rebuild ? 1 : 0, `Rebuild eligibility for ${path}`);
    if (!rebuild) return;
    const [fire] = timers;
    timers.delete(fire);
    fire();
    await opened.promise;
  } };
}

test('connector worker source edits rebuild the preview while build outputs are ignored', async t => {
  const fixture = await previewFixture(t);
  const builds = () => fixture.commands.filter(command => command.includes('scripts/build/connectors.mjs')).length;
  let expected = builds();
  for (const path of ['src/main.rs', 'build.rs', 'lib.rs', 'Cargo.toml', 'Cargo.lock']) {
    await fixture.change(`use/connectors/worker/${path}`);
    assert.equal(builds(), ++expected);
  }
  await fixture.change('use/connectors/worker/target/debug/build/generated.rs', 'change', false);
  await fixture.change('use/connectors/worker/target/debug/.fingerprint/worker.json', 'rename', false);
  assert.equal(builds(), expected);
});

test('worker manifest replacement and subsequent edits remain eligible through the directory watcher', async t => {
  const fixture = await previewFixture(t);
  assert.ok(fixture.watchers.has('use/connectors/worker'));
  for (const name of ['Cargo.toml', 'Cargo.lock']) {
    assert.ok(!fixture.watchers.has(`use/connectors/worker/${name}`));
    await fixture.change(`use/connectors/worker/${name}`, 'rename');
    await fixture.change(`use/connectors/worker/${name}`, 'change');
  }
});

test('chart edits refresh every copied Data module on the next preview cycle', async t => {
  const fixture = await previewFixture(t);
  for (const name of ['dataset.py', 'view.py', 'chart_document.py']) {
    const output = resolve(fixture.root, 'apps/data/backend/_core', name);
    assert.equal(readFileSync(output, 'utf8'), 'initial\n');
    writeFileSync(resolve(fixture.python, name), `updated ${name}\n`);
    await fixture.change(`harness/go/charts/python/${name}`);
    assert.equal(readFileSync(output, 'utf8'), `updated ${name}\n`);
  }
});

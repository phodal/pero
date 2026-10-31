import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import YAML from 'yaml';
import { failures } from './gate.mjs';
import { suites, fastSuites } from './desktop-suite.mjs';
import { pack, unpack, runtimePaths } from './desktop-artifact.mjs';

test('daily keeps all acceptance; ordinary tier keeps the explicit critical smokes', () => {
  assert.deepEqual(Object.values(suites).map(([name]) => name).sort(), [
    'workbench', 'automation', 'toolcalls', 'data', 'data-product', 'control-lab', 'control-lab-app-use', 'control-lab-live',
    'virtual-cell-comparison', 'virtual-cell-dataset-download', 'app-use', 'app-use-workbench',
    'mcp-settings', 'mcp-settings', 'mcp-settings',
  ].sort());
  const workflow = YAML.parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const acceptance = workflow.jobs['desktop-acceptance'];
  const matrices = [...acceptance.strategy.matrix.suite.matchAll(/fromJSON\('([^']+)'\)/g)].map(match => JSON.parse(match[1]));
  assert.deepEqual(matrices, [Object.keys(suites), fastSuites]);
  assert.deepEqual(fastSuites, ['workbench', 'data', 'app-use-workbench']);
  assert.match(acceptance.strategy.matrix.suite, /schedule.*workflow_dispatch/);
  assert.equal(acceptance.strategy['fail-fast'], false);
  assert.equal(acceptance.needs, 'desktop-linux');
  assert.match(workflow.jobs.complete.if, /always\(\)/);
  assert.deepEqual(workflow.on.pull_request.types, ['opened', 'synchronize', 'reopened', 'labeled', 'unlabeled']);
  assert.match(acceptance.strategy.matrix.suite, /contains\(github.event.pull_request.labels.\*.name, 'ci:full'\)/);
  assert.deepEqual([...workflow.jobs.complete.needs].sort(), Object.keys(workflow.jobs).filter(name => name !== 'complete').sort());
  assert.equal(workflow.jobs.complete.steps.at(-1).run, 'node scripts/ci/gate.mjs');
  for (const name of ['bazel', 'go', 'harness']) {
    const matrix = workflow.jobs[name].strategy.matrix.os;
    assert.match(matrix, /schedule/); assert.match(matrix, /workflow_dispatch/);
    assert.match(matrix, /windows-latest/); assert.match(matrix, /macos-latest/);
    assert.match(matrix, /\|\| fromJSON\('\["ubuntu-latest"\]'\)/);
  }
  for (const name of ['desktop', 'windows-acl-sandbox']) assert.match(workflow.jobs[name].if, /schedule.*workflow_dispatch/);
  assert.equal(workflow.on.schedule[0].cron, '0 20 * * *');
  const platform = YAML.parse(readFileSync('.github/workflows/desktop-check.yml', 'utf8')).jobs.desktop;
  const commands = platform.steps.map(step => step.run || '').join('\n');
  for (const command of ['npm run build', 'npm run check', 'npm test', 'npm run test:contracts',
    'node tests/contracts/mcp-settings.mjs', 'node tests/contracts/mcp-ownership.mjs',
    'node --test tests/runtime/control-lab/*.test.mjs', 'npm run test:app-use:unit',
    'node tests/e2e/computer-transport.mjs', 'scripts/build/fonttools.test.mjs',
    'scripts/build/patch-checkout.test.mjs', 'scripts/build/gpui-kit.test.mjs',
    'node --test tests/runtime/control-lab/host-goal.test.ts',
    'desktop/src/main/app-use.test.ts', 'desktop/src/main/app-context.test.ts',
    'tests/fixtures/app-use-content.test.mjs', 'tests/fixtures/app-use-progress.test.mjs',
    'tests/fixtures/app-chat-launch.test.mjs', 'npm --prefix apps/virtual-cell run typecheck',
    'npm --prefix apps/virtual-cell run test:ui', 'npm --prefix apps/control-lab run typecheck',
    'npm --prefix apps/control-lab run test:ui', 'npm --prefix apps/data run typecheck',
    'npm --prefix apps/data run test:ui', 'node --test web/src/automation-model.test.ts tests/contracts/automation.test.mjs',
    'tests/fixtures/owned-electron-close.test.mjs', 'node tests/runtime/automation.mjs']) assert.ok(commands.includes(command), command);
  const native = YAML.parse(readFileSync('.github/workflows/computer-use.yml', 'utf8'));
  assert.match(native.jobs.native.strategy.matrix.os, /schedule.*workflow_dispatch/);
  assert.equal(native.on.schedule[0].cron, '0 20 * * *');
  assert.equal(native.on.pull_request.paths, undefined);
});

test('runtime archive is tied to exact revision, retains executable mode and verifies bytes', { skip: process.platform !== 'linux' }, () => {
  const temp = mkdtempSync(resolve(tmpdir(), 'pero-ci-artifact-'));
  try {
    const source = resolve(temp, 'source'), destination = resolve(temp, 'destination'), archive = resolve(temp, 'runtime.tgz');
    mkdirSync(resolve(source, 'products'), { recursive: true }); mkdirSync(destination);
    writeFileSync(resolve(source, 'products/pero.json'), JSON.stringify({ apps: ['data'] }));
    for (const path of runtimePaths(source)) {
      const file = path.endsWith('/dist') || path.endsWith('/helpers') ? `${path}/entry.js` : path;
      mkdirSync(dirname(resolve(source, file)), { recursive: true });
      writeFileSync(resolve(source, file), `fixture ${path}`, { mode: 0o755 });
    }
    assert.ok(!runtimePaths(source).some(path => path.includes('point-app')));
    const sha = 'a'.repeat(40);
    pack(source, archive, sha);
    assert.throws(() => unpack(destination, archive, 'b'.repeat(40)), /revision or platform mismatch/);
    unpack(destination, archive, sha);
    assert.equal(readFileSync(resolve(destination, 'target/debug/pero-host'), 'utf8'), 'fixture target/debug/pero-host');
    // A changed payload cannot pass the manifest written by the producer.
    writeFileSync(resolve(source, 'target/debug/pero-host'), 'changed');
    assert.equal(statSync(resolve(destination, 'target/debug/pero-host')).mode & 0o777, 0o755);
    execFileSync('tar', ['-czf', archive, ...runtimePaths(source), 'target/ci-runtime.json'], { cwd: source });
    assert.throws(() => unpack(destination, archive, sha), /checksum mismatch/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('Linux gate permits only explicitly daily-only skips; full gate requires every platform', () => {
  const jobs = { 'desktop-linux': { result: 'success' }, desktop: { result: 'skipped' }, 'windows-acl-sandbox': { result: 'skipped' } };
  assert.deepEqual(failures(jobs, false), []);
  assert.deepEqual(failures(jobs, true), ['desktop', 'windows-acl-sandbox']);
  for (const result of ['failure', 'cancelled', 'skipped'])
    assert.deepEqual(failures({ 'desktop-acceptance': { result } }, false), ['desktop-acceptance']);
  assert.deepEqual(failures({ desktop: { result: 'failure' } }, false), ['desktop']);
});

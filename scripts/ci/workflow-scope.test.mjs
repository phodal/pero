import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import { computerUseGlobs, matchesPath, releasePackageGlobs, shouldRun } from './workflow-scope.mjs';

test('path globs match the workflow scope and do not swallow neighbors', () => {
  const cases = [
    ['use/**', 'use/computer/src/lib.rs', true],
    ['use/**', 'unused', false],
    ['protocol/computer-*.tsp', 'protocol/computer-use.tsp', true],
    ['protocol/computer-*.tsp', 'protocol/computer-use/extra.tsp', false],
    ['tests/**/computer-*', 'tests/e2e/computer-transport.mjs', true],
    ['tests/**/computer-*', 'tests/computer-source.mjs', true],
    ['tests/**/computer-*', 'tests/e2e/control-lab.mjs', false],
    ['desktop/**', 'desktop/src/main/product.ts', true],
    ['crates/pero-host/**', 'crates/pero-host-extra/src/lib.rs', false],
    ['.github/workflows/computer-use.yml', '.github/workflows/computer-use.yml', true],
  ];
  for (const [pattern, file, expected] of cases) assert.equal(matchesPath(pattern, file), expected, `${pattern} ${file}`);
});

test('scope keeps synchronize, manual, schedule, and explicit labels without running unrelated pull requests', () => {
  const cases = [
    ['computer-use', { event: 'schedule' }, true],
    ['computer-use', { event: 'workflow_dispatch' }, true],
    ['computer-use', { event: 'push' }, true],
    ['computer-use', { event: 'pull_request', files: ['use/computer/src/lib.rs'] }, true],
    ['computer-use', { event: 'pull_request', files: ['README.md'] }, false],
    ['computer-use', { event: 'pull_request', labels: ['ci:full'], files: ['README.md'] }, true],
    ['computer-use', { event: 'pull_request', labels: ['ci:paper-host-approval-native'], files: ['docs/fitness/computer-use.md'] }, true],
    ['computer-use', { event: 'pull_request', labels: ['documentation'], files: ['README.md'] }, false],
    ['release-package', { event: 'schedule' }, true],
    ['release-package', { event: 'workflow_dispatch' }, true],
    ['release-package', { event: 'pull_request', files: ['apps/virtual-cell/src/main.tsx'] }, true],
    ['release-package', { event: 'pull_request', files: ['crates/pero-host/src/lib.rs'] }, true],
    ['release-package', { event: 'pull_request', files: ['docs/README.md'] }, false],
    ['release-package', { event: 'pull_request', labels: ['ci:full'], files: ['docs/README.md'] }, true],
    ['release-package', { event: 'pull_request', labels: ['ci:paper-host-approval-native'], files: ['docs/README.md'] }, false],
  ];
  for (const [kind, input, expected] of cases) assert.equal(shouldRun(kind, input), expected, `${kind} ${JSON.stringify(input)}`);
  assert.throws(() => shouldRun('other', { event: 'push' }), /Unknown workflow scope/);
});

test('Computer Use and Release triggers keep synchronize and do not limit themselves to labeled', () => {
  const computer = YAML.parse(readFileSync('.github/workflows/computer-use.yml', 'utf8'));
  assert.deepEqual(computer.on.pull_request.types, ['opened', 'synchronize', 'reopened', 'labeled', 'unlabeled']);
  assert.deepEqual(computer.on.pull_request.paths, [...computerUseGlobs]);
  assert.deepEqual(computer.on.push.paths, [...computerUseGlobs]);
  assert.equal(computer.on.schedule[0].cron, '0 20 * * *');
  assert.equal(computer.jobs.scope, undefined);
  assert.equal(computer.jobs.native.needs, undefined);
  assert.equal(computer.jobs.native.if, undefined);
  assert.match(computer.jobs.native.strategy.matrix.os, /schedule.*workflow_dispatch/);
  assert.match(computer.jobs.native.strategy.matrix.os, /ci:full/);

  const release = YAML.parse(readFileSync('.github/workflows/release.yml', 'utf8'));
  assert.equal(release.on.push.branches, undefined);
  assert.deepEqual(release.on.pull_request.types, ['opened', 'synchronize', 'reopened', 'labeled', 'unlabeled']);
  assert.deepEqual(release.on.pull_request.paths, [...releasePackageGlobs]);
  assert.equal(release.jobs.scope, undefined);
  const sandbox = YAML.parse(readFileSync('.github/workflows/agent-sandbox.yml', 'utf8'));
  const isolated = YAML.parse(readFileSync('.github/workflows/agent-sandbox-isolated.yml', 'utf8'));
  assert.deepEqual(sandbox.on.pull_request.types, ['opened', 'reopened', 'synchronize', 'labeled']);
  assert.ok(sandbox.on.pull_request.paths.includes('deployment/agent-sandbox/**'));
  assert.ok(isolated.on.pull_request.paths.includes('.github/workflows/agent-sandbox-isolated.yml'));
  assert.match(sandbox.jobs.kind.if, /agent-sandbox-e2e/);
  assert.match(isolated.jobs['isolated-kind'].if, /agent-sandbox-isolated-e2e/);
  assert.match(release.jobs.build.if, /pull_request/);
  assert.match(release.jobs.build.if, /schedule/);
  assert.match(release.jobs.build.strategy.matrix.include, /workflow_dispatch/);
  assert.match(release.jobs.build.strategy.matrix.include, /virtual-cell/);
  assert.ok(releasePackageGlobs.includes('apps/virtual-cell/**'));
  assert.ok(releasePackageGlobs.includes('crates/pero-host/**'));
});

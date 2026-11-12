import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
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

test('a two-ref fetch names the pull request head, so FETCH_HEAD cannot hide the diff', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'pero-scope-fetch-'));
  const git = (cwd, args) => execFileSync('git', ['-c', 'user.name=Pero', '-c', 'user.email=pero@example.com', ...args], { cwd, encoding: 'utf8' }).trim();
  try {
    const origin = resolve(root, 'origin');
    const work = resolve(root, 'work');
    git(root, ['init', '-q', origin]);
    writeFileSync(resolve(origin, 'a'), '1\n');
    git(origin, ['add', 'a']);
    git(origin, ['commit', '-qm', 'base']);
    const base = git(origin, ['rev-parse', 'HEAD']);
    git(origin, ['checkout', '-q', '-b', 'pr']);
    execFileSync('mkdir', ['-p', resolve(origin, 'use')]);
    writeFileSync(resolve(origin, 'use/x'), '2\n');
    git(origin, ['add', 'use/x']);
    git(origin, ['commit', '-qm', 'pr']);
    git(origin, ['update-ref', 'refs/pull/1/head', 'HEAD']);
    git(origin, ['checkout', '-q', '--detach', base]);
    git(root, ['init', '-q', work]);
    git(work, ['remote', 'add', 'origin', origin]);
    git(work, ['fetch', '--no-tags', '--depth=1', 'origin', `${base}:refs/remotes/origin/pr-base`, 'refs/pull/1/head:refs/remotes/origin/pr-head']);
    assert.equal(git(work, ['rev-parse', 'FETCH_HEAD']), base);
    assert.equal(git(work, ['diff', '--name-only', 'refs/remotes/origin/pr-base', 'FETCH_HEAD']), '');
    assert.equal(git(work, ['diff', '--name-only', 'refs/remotes/origin/pr-base', 'refs/remotes/origin/pr-head']), 'use/x');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Computer Use and Release triggers keep synchronize and do not limit themselves to labeled', () => {
  const computer = YAML.parse(readFileSync('.github/workflows/computer-use.yml', 'utf8'));
  assert.deepEqual(computer.on.pull_request.types, ['opened', 'synchronize', 'reopened', 'labeled', 'unlabeled']);
  assert.equal(computer.on.pull_request.paths, undefined);
  assert.deepEqual(computer.on.push.paths, [...computerUseGlobs]);
  assert.equal(computer.on.schedule[0].cron, '0 20 * * *');
  assert.equal(computer.jobs.scope.steps[0].uses, 'actions/checkout@v7');
  assert.match(computer.jobs.scope.steps.at(-1).run, /refs\/pull\/\$\{SCOPE_PR\}\/head:refs\/remotes\/origin\/pr-head/);
  assert.match(computer.jobs.scope.steps.at(-1).run, /git diff --name-only refs\/remotes\/origin\/pr-base refs\/remotes\/origin\/pr-head/);
  assert.doesNotMatch(computer.jobs.scope.steps.at(-1).run, /FETCH_HEAD/);
  assert.match(computer.jobs.scope.steps.at(-1).run, /Cannot read the pull request diff; running the check/);
  assert.equal(computer.jobs.native.needs, 'scope');
  assert.equal(computer.jobs.native.if, "needs.scope.outputs.run == 'true'");
  assert.equal(computer.jobs.native['continue-on-error'], undefined);
  assert.equal(computer.jobs.native.name, 'Native Computer Use (${{ matrix.os }})');
  assert.match(computer.jobs.native.strategy.matrix.os, /schedule.*workflow_dispatch/);
  assert.match(computer.jobs.native.strategy.matrix.os, /ci:full/);

  const release = YAML.parse(readFileSync('.github/workflows/release.yml', 'utf8'));
  assert.equal(release.on.push.branches, undefined);
  assert.deepEqual(release.on.pull_request.types, ['opened', 'synchronize', 'reopened', 'labeled', 'unlabeled']);
  assert.equal(release.on.pull_request.paths, undefined);
  assert.match(release.jobs.scope.steps.at(-1).run, /git diff --name-only refs\/remotes\/origin\/pr-base refs\/remotes\/origin\/pr-head/);
  assert.doesNotMatch(release.jobs.scope.steps.at(-1).run, /FETCH_HEAD/);
  assert.match(release.jobs.scope.steps.at(-1).run, /Cannot read the pull request diff; running the check/);
  assert.equal(release.jobs.scope.steps.at(-1).env.SCOPE_KIND, 'release-package');
  const sandbox = YAML.parse(readFileSync('.github/workflows/acceptance.yml', 'utf8'));
  const isolated = sandbox;
  assert.deepEqual(sandbox.on.pull_request.types, ['opened', 'reopened', 'synchronize', 'labeled']);
  for (const workflow of [sandbox, isolated]) {
    assert.ok(workflow.on.pull_request.paths.includes('server/**'));
    assert.ok(workflow.on.pull_request.paths.includes('crates/pero-contracts/**'));
    assert.ok(workflow.on.pull_request.paths.includes('crates/pero-runtime/**'));
    assert.ok(workflow.on.pull_request.paths.includes('scripts/cargo.mjs'));
  }
  assert.equal(matchesPath('server/**', 'server/internal/httpapi/routes.go'), true);
  assert.equal(matchesPath('server/**', 'server/internal/artifacts/s3/store.go'), true);
  assert.equal(matchesPath('server/**', 'services/http.go'), false);
  assert.equal(matchesPath('crates/pero-runtime/**', 'crates/pero-runtime/src/lib.rs'), true);
  assert.equal(matchesPath('crates/pero-runtime/**', 'crates/pero-host/src/lib.rs'), false);
  assert.match(sandbox.jobs.kind.if, /agent-sandbox-e2e/);
  assert.match(isolated.jobs['isolated-kind'].if, /agent-sandbox-isolated-e2e/);
  assert.match(release.jobs.build.if, /pull_request/);
  assert.match(release.jobs.build.if, /schedule/);
  assert.match(release.jobs.build.strategy.matrix.include, /workflow_dispatch/);
  assert.match(release.jobs.build.strategy.matrix.include, /virtual-cell/);
  assert.ok(releasePackageGlobs.includes('apps/virtual-cell/**'));
  assert.ok(releasePackageGlobs.includes('crates/pero-host/**'));
});

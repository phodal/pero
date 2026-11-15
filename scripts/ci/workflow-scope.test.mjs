import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import { ciScope, ciScopeGlobs, computerUseGlobs, matchesPath, shouldRun } from './workflow-scope.mjs';

test('CI selects affected expensive consumers on PR and push while full and unknown diffs retain them', () => {
  for (const event of ['pull_request', 'push']) {
    for (const [files, expected] of [
      [['docs/issues/incident.md'], []],
      [['crates/pero-worker/src/journal.rs'], []],
      [['apps/notebook/ui-src/frame.tsx'], ['notebook', 'notebook-canvas', 'mcp-browser', 'notebook-python']],
      [['apps/data/backend/inspection.py'], ['data', 'notebook-canvas', 'notebook-python']],
      [['crates/pero-ui/src/apps.rs'], ['native-ui']],
      [['apps/lcms2yield/ui-src/index.tsx'], ['lcms2yield']],
      [['apps/virtual-cell/backend/store.py'], ['virtual-cell']],
      [['harness/go/mcp/tools.go'], ['mcp-browser', 'notebook-python']],
    ]) {
      const flags = ciScope({ event, files });
      assert.deepEqual(Object.keys(flags).filter(name => flags[name]).sort(), expected.sort(), `${event} ${files}`);
    }
  }
  for (const input of [
    { event: 'schedule' }, { event: 'workflow_dispatch' },
    { event: 'pull_request', labels: ['ci:full'] },
    { event: 'push', unknown: true },
    { event: 'pull_request', files: ['packages/app-sdk/src/ui.tsx'] },
    { event: 'push', files: ['.github/workflows/ci.yml'] },
  ]) assert(Object.values(ciScope(input)).every(value => value === true), JSON.stringify(input));
  assert(Object.isFrozen(ciScopeGlobs));
});

test('CI scope output and skipped-job gates retain actual failures and missing scope evidence', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'pero-ci-scope-'));
  try {
    const output = resolve(root, 'output');
    execFileSync(process.execPath, ['scripts/ci/workflow-scope.mjs'], {
      input: 'apps/notebook/ui-src/frame.tsx\n',
      env: { ...process.env, SCOPE_KIND: 'ci', SCOPE_EVENT: 'push', SCOPE_LABELS: '', SCOPE_UNKNOWN: 'false', GITHUB_OUTPUT: output },
    });
    const flags = JSON.parse(readFileSync(output, 'utf8').trim().slice('scopes='.length));
    assert.equal(flags.notebook, true);
    assert.equal(flags['native-ui'], false);
    const workflow = YAML.parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
    assert.deepEqual(workflow.jobs.core.needs, 'scope');
    assert.equal(workflow.jobs.complete.env, undefined);
    assert.equal(workflow.jobs.complete.steps.at(-1).env.SCOPES, '${{ needs.scope.outputs.scopes }}');
    for (const name of Object.keys(ciScopeGlobs).filter(name => name !== 'mcp-browser')) {
      assert.equal(workflow.jobs[name].needs, 'scope');
      assert.equal(workflow.jobs[name].if, `fromJSON(needs.scope.outputs.scopes)['${name}']`);
    }
    const diff = workflow.jobs.scope.steps.at(-1);
    assert.match(diff.run, /git diff --name-only --no-renames refs\/remotes\/origin\/pr-base refs\/remotes\/origin\/pr-head/);
    assert.match(diff.run, /unknown=true/);
    assert.match(diff.env.SCOPE_BASE, /github.event.before/);
    assert.match(diff.env.SCOPE_HEAD, /refs\/pull\//);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

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
    ['release-package', { event: 'push' }, true],
    ['release-package', { event: 'pull_request', labels: ['ci:package'], files: ['crates/pero-worker/src/main.rs'] }, true],
    ['release-package', { event: 'workflow_dispatch' }, true],
    ['release-package', { event: 'pull_request', files: ['apps/virtual-cell/src/main.tsx'] }, false],
    ['release-package', { event: 'pull_request', files: ['crates/pero-host/src/lib.rs'] }, false],
    ['release-package', { event: 'pull_request', files: ['docs/README.md'] }, false],
    ['release-package', { event: 'pull_request', labels: ['ci:full'], files: ['docs/README.md'] }, true],
    ['release-package', { event: 'pull_request', labels: ['ci:paper-host-approval-native'], files: ['docs/README.md'] }, false],
  ];
  for (const [kind, input, expected] of cases) assert.equal(shouldRun(kind, input), expected, `${kind} ${JSON.stringify(input)}`);
  assert.throws(() => shouldRun('other', { event: 'push' }), /Unknown workflow scope/);
});

test('the actual scope step reads PR and push diffs, deleted paths, and unknown fetches', () => {
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
    mkdirSync(resolve(origin, 'apps/notebook'), { recursive: true });
    writeFileSync(resolve(origin, 'apps/notebook/x'), '2\n');
    git(origin, ['add', 'apps/notebook/x']);
    git(origin, ['commit', '-qm', 'pr']);
    git(origin, ['update-ref', 'refs/pull/1/head', 'HEAD']);
    const head = git(origin, ['rev-parse', 'HEAD']);
    git(origin, ['checkout', '-q', '--detach', base]);
    git(root, ['init', '-q', work]);
    git(work, ['remote', 'add', 'origin', origin]);
    mkdirSync(resolve(work, 'scripts/ci'), { recursive: true });
    writeFileSync(resolve(work, 'scripts/ci/workflow-scope.mjs'), readFileSync('scripts/ci/workflow-scope.mjs'));
    const step = YAML.parse(readFileSync('.github/workflows/ci.yml', 'utf8')).jobs.scope.steps.at(-1);
    let invocation = 0;
    function run(event, before, after) {
      const output = resolve(root, `scope-${invocation++}`);
      execFileSync('bash', ['-c', step.run], { cwd: work, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, SCOPE_KIND: 'ci', SCOPE_EVENT: event, SCOPE_LABELS: '', SCOPE_BASE: before, SCOPE_HEAD: after, GITHUB_OUTPUT: output } });
      return JSON.parse(readFileSync(output, 'utf8').trim().slice('scopes='.length));
    }
    assert.equal(run('pull_request', base, 'refs/pull/1/head').notebook, true);
    assert.equal(git(work, ['rev-parse', 'FETCH_HEAD']), base);
    assert.equal(git(work, ['diff', '--name-only', 'refs/remotes/origin/pr-base', 'FETCH_HEAD']), '');
    assert.equal(run('push', base, head).notebook, true);
    git(origin, ['checkout', '-q', 'pr']);
    mkdirSync(resolve(origin, 'archive'));
    git(origin, ['mv', 'apps/notebook/x', 'archive/x']);
    git(origin, ['commit', '-qm', 'move out of Notebook']);
    git(origin, ['update-ref', 'refs/pull/2/head', 'HEAD']);
    assert.equal(run('pull_request', head, 'refs/pull/2/head').notebook, true, 'deleted Notebook input still selects its tests');
    assert(Object.values(run('push', 'missing-base', head)).every(Boolean));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Computer Use is manual and PR packaging is opt-in without cancelling tagged releases', () => {
  const computer = YAML.parse(readFileSync('.github/workflows/computer-use.yml', 'utf8'));
  assert.deepEqual(Object.keys(computer.on), ['workflow_dispatch']);
  assert.equal(computer.on.workflow_dispatch.inputs.paper_native_diagnostic.default, false);
  assert.equal(computer.on.workflow_dispatch.inputs.paper_host_approval_native.default, false);
  assert.equal(computer.jobs.scope, undefined);
  assert.equal(computer.jobs.native.needs, undefined);
  assert.deepEqual(computer.jobs.native.strategy.matrix.os, ['ubuntu-latest', 'windows-latest', 'macos-latest']);

  const release = YAML.parse(readFileSync('.github/workflows/release.yml', 'utf8'));
  assert.equal(release.on.push.branches, undefined);
  assert.deepEqual(release.on.pull_request.types, ['opened', 'synchronize', 'reopened', 'labeled', 'unlabeled']);
  assert.equal(release.on.pull_request.paths, undefined);
  assert.equal(release.concurrency['cancel-in-progress'], "${{ github.event_name == 'pull_request' }}");
  assert.equal(release.jobs.scope.steps.at(-1).run, 'node scripts/ci/workflow-scope.mjs < /dev/null');
  assert.equal(release.jobs.scope.steps.at(-1).env.SCOPE_BASE, undefined);
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
});

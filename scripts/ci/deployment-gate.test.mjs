import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import { commitFromTagRefs, decideDeployment, dispatchReleaseArchives, newerTrustedFromRecords, pagesCurrentDecision, releaseAssetsMatch, samePinnedSha } from './deployment-gate.mjs';

const repository = 'phodal/pero';
const sha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const other = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const complete = [{ name: 'Linux CI gate', status: 'completed', conclusion: 'success' }];
const fullComplete = [{ name: 'Full-platform CI gate', status: 'completed', conclusion: 'success' }];

function run(overrides = {}) {
  return {
    id: 10, headSha: sha, event: 'push', headBranch: 'master', headRepository: repository,
    status: 'completed', conclusion: 'success', createdAt: '2026-11-11T00:00:00Z', jobs: complete,
    ...overrides,
  };
}

function trigger(overrides = {}) {
  return {
    event: 'push', headSha: sha, headBranch: 'master', headRepository: repository,
    status: 'completed', conclusion: 'success', ...overrides,
  };
}

test('deployment admits only a trusted successful complete job for the exact SHA', () => {
  const cases = [
    ['push success', { runs: [run()] }, 'ok'],
    ['full job is not a Linux push gate', { runs: [run({ jobs: fullComplete })] }, 'missing-complete'],
    ['schedule alone is not a Linux push', { runs: [run({ event: 'schedule', jobs: fullComplete })] }, 'missing'],
    ['manual full CI alone is not a Linux push', { runs: [run({ event: 'workflow_dispatch', jobs: fullComplete })] }, 'missing'],
    ['newer success beats an older failure', { runs: [run({ id: 1, conclusion: 'failure', createdAt: '2026-11-10T00:00:00Z' }), run({ id: 2, createdAt: '2026-11-11T00:00:00Z' })] }, 'ok'],
    ['invalid sha', { targetSha: 'master' }, 'invalid-sha'],
    ['wrong trigger sha', { trigger: trigger({ headSha: other }), runs: [run()] }, 'wrong-sha'],
    ['run for another sha is not success', { runs: [run({ headSha: other })] }, 'missing'],
    ['pull request', { trigger: trigger({ event: 'pull_request' }) }, 'untrusted-event'],
    ['pull request target', { trigger: trigger({ event: 'pull_request_target' }) }, 'untrusted-event'],
    ['fork', { trigger: trigger({ headRepository: 'attacker/pero' }) }, 'untrusted-repository'],
    ['feature branch', { trigger: trigger({ headBranch: 'feature' }) }, 'untrusted-branch'],
    ['red', { runs: [run({ conclusion: 'failure' })] }, 'failure'],
    ['cancelled', { runs: [run({ conclusion: 'cancelled' })] }, 'cancelled'],
    ['timed out', { runs: [run({ conclusion: 'timed_out' })] }, 'timed_out'],
    ['missing', { runs: [] }, 'missing'],
    ['pending rerun blocks an older success', { runs: [run({ id: 1, createdAt: '2026-11-10T00:00:00Z' }), run({ id: 2, status: 'in_progress', conclusion: null, jobs: undefined, createdAt: '2026-11-11T00:00:00Z' })] }, 'pending'],
    ['queued', { runs: [run({ status: 'queued', conclusion: null, jobs: undefined })] }, 'pending'],
    ['newer failure beats an older success', { runs: [run({ id: 1, createdAt: '2026-11-10T00:00:00Z' }), run({ id: 2, conclusion: 'failure', createdAt: '2026-11-11T00:00:00Z' })] }, 'failure'],
    ['pull request run is not a trusted success', { runs: [run({ event: 'pull_request', headBranch: 'feature' })] }, 'missing'],
    ['fork run is not a trusted success', { runs: [run({ headRepository: 'attacker/pero' })] }, 'missing'],
    ['success without the complete job', { runs: [run({ jobs: [{ name: 'Linux core types, permissions and durable runtime', status: 'completed', conclusion: 'success' }] })] }, 'missing-complete'],
    ['complete job failed', { runs: [run({ jobs: [{ name: 'Linux CI gate', status: 'completed', conclusion: 'failure' }] })] }, 'missing-complete'],
    ['complete job skipped', { runs: [run({ jobs: [{ name: 'Linux CI gate', status: 'completed', conclusion: 'skipped' }] })] }, 'missing-complete'],
    ['red trigger is not saved by another success', { trigger: trigger({ conclusion: 'failure' }), runs: [run()] }, 'failure'],
    ['cancelled trigger', { trigger: trigger({ conclusion: 'cancelled' }), runs: [run()] }, 'cancelled'],
    ['trigger success is visible before the run list catches up', { trigger: trigger({ id: 4, createdAt: '2026-11-11T00:00:00Z', jobs: complete }), runs: [] }, 'ok'],
    ['newer red run beats a stale triggering success', { trigger: trigger({ id: 4, createdAt: '2026-11-10T00:00:00Z', jobs: complete }), runs: [run({ id: 9, conclusion: 'failure', createdAt: '2026-11-11T00:00:00Z' })] }, 'failure'],
  ];
  for (const [name, input, expected] of cases) {
    const decision = decideDeployment({ repository, targetSha: sha, ...input });
    assert.equal(decision.ok ? 'ok' : decision.reason, expected, name);
    if (decision.ok) assert.equal(decision.sha, sha);
  }
});

test('Linux push admission ignores full runs and still lets a newer push veto', () => {
  const push = (overrides) => run({ id: 2, createdAt: '2026-11-11T00:00:00Z', ...overrides });
  const schedule = (overrides) => run({ id: 8, event: 'schedule', jobs: fullComplete, createdAt: '2026-11-11T03:00:00Z', ...overrides });
  const cases = [
    ['successful push plus pending schedule', [push(), schedule({ status: 'in_progress', conclusion: null, jobs: undefined })], 'ok'],
    ['successful push plus failed schedule', [push(), schedule({ conclusion: 'failure' })], 'ok'],
    ['later red push vetoes an older success', [push({ id: 1, createdAt: '2026-11-10T00:00:00Z' }), push({ id: 3, conclusion: 'failure', createdAt: '2026-11-12T00:00:00Z' })], 'failure'],
    ['later pending push vetoes an older success', [push({ id: 1, createdAt: '2026-11-10T00:00:00Z' }), push({ id: 3, status: 'queued', conclusion: null, jobs: undefined, createdAt: '2026-11-12T00:00:00Z' })], 'pending'],
    ['later cancelled push vetoes an older success', [push({ id: 1, createdAt: '2026-11-10T00:00:00Z' }), push({ id: 3, conclusion: 'cancelled', createdAt: '2026-11-12T00:00:00Z' })], 'cancelled'],
    ['schedule completion does not admit the SHA', { trigger: trigger({ event: 'schedule', jobs: fullComplete }), runs: [push()] }, 'untrusted-event'],
  ];
  for (const [name, input, expected] of cases) {
    const runs = Array.isArray(input) ? input : input.runs;
    const decision = decideDeployment({ repository, targetSha: sha, policy: 'linux-push', trigger: input.trigger, runs });
    assert.equal(decision.ok ? 'ok' : decision.reason, expected, name);
  }
});

test('automatic Pages refuses an older ancestor after a newer trusted success', () => {
  const old = 'ffffffffffffffffffffffffffffffffffffffff';
  const newer = '0000000000000000000000000000000000000000';
  const cases = [
    ['tip is the target', { targetSha: old, masterTip: old, relation: 'same', newerTrusted: false }, 'ok'],
    ['later commits exist but none are trusted', { targetSha: old, masterTip: newer, relation: 'ancestor', newerTrusted: false }, 'ok'],
    ['lexically smaller descendant is still newer', { targetSha: old, masterTip: newer, relation: 'ancestor', newerTrusted: true }, 'superseded'],
    ['unknown newer history does not publish', { targetSha: old, masterTip: newer, relation: 'ancestor', newerTrusted: null }, 'history-unknown'],
    ['unknown ancestry does not publish', { targetSha: old, masterTip: newer, relation: 'unknown', newerTrusted: false }, 'ancestry-unknown'],
    ['missing tip does not publish', { targetSha: old, masterTip: '', relation: 'ancestor', newerTrusted: false }, 'tip-unknown'],
    ['target not on master does not publish', { targetSha: old, masterTip: newer, relation: 'not-ancestor', newerTrusted: false }, 'not-on-master'],
    ['automatic rollback flag is ignored', { targetSha: old, masterTip: newer, relation: 'ancestor', newerTrusted: true, manualRollback: true, event: 'workflow_run' }, 'rollback-forbidden'],
    ['explicit dispatch rollback is labeled', { targetSha: old, masterTip: newer, relation: 'ancestor', newerTrusted: true, manualRollback: true, event: 'workflow_dispatch' }, 'rollback'],
  ];
  for (const [name, input, expected] of cases) {
    const decision = pagesCurrentDecision(input);
    const actual = decision.rollback ? 'rollback' : decision.ok ? 'ok' : decision.reason;
    assert.equal(actual, expected, name);
    if (decision.ok) assert.equal(decision.sha, old);
  }
  assert.equal(newerTrustedFromRecords(old, [
    { sha: newer, descendant: true, trusted: true },
    { sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', descendant: false, trusted: true },
  ]), true);
  assert.equal(newerTrustedFromRecords(old, [{ sha: newer, descendant: false, trusted: true }]), false);
  assert.equal(newerTrustedFromRecords(old, [{ sha: newer, descendant: null, trusted: true }]), null);
  assert.equal(newer < old, true);
});

test('a successful workflow still has to load its complete job', () => {
  const decision = decideDeployment({ repository, targetSha: sha, runs: [run({ jobs: undefined })] });
  assert.equal(decision.reason, 'needs-jobs');
  assert.equal(decision.candidateRunId, 10);
});

test('tag resolution uses the peeled commit and rejects a move', () => {
  const annotated = commitFromTagRefs('v0.1.0', [
    { sha: 'cccccccccccccccccccccccccccccccccccccccc', ref: 'refs/tags/v0.1.0' },
    { sha, ref: 'refs/tags/v0.1.0^{}' },
  ]);
  assert.deepEqual(annotated, { ok: true, sha });
  const lightweight = commitFromTagRefs('v0.1.0', [{ sha, ref: 'refs/tags/v0.1.0' }]);
  assert.deepEqual(lightweight, { ok: true, sha });
  assert.equal(commitFromTagRefs('missing', []).reason, 'missing-tag');
  assert.equal(samePinnedSha(sha, sha).ok, true);
  assert.equal(samePinnedSha(sha, other).reason, 'tag-moved');
  const bytes = 'abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd';
  const pack = (archive) => {
    const stem = archive.endsWith('.tar.gz') ? archive.slice(0, -7) : archive.replace(/\.(dmg|zip)$/, '');
    return [
      { name: archive, sha256: bytes },
      { name: `${stem}.build.json`, sha256: 'manifest', manifest: { sourceRevision: sha, archive, archiveSha256: bytes } },
    ];
  };
  assert.equal(releaseAssetsMatch(sha, [...dispatchReleaseArchives], dispatchReleaseArchives.flatMap(pack)).ok, true);
  assert.equal(releaseAssetsMatch(sha, [...dispatchReleaseArchives], dispatchReleaseArchives.slice(1).flatMap(pack)).reason, 'missing-manifest');
  const wrong = dispatchReleaseArchives.flatMap(pack);
  wrong[1].manifest = { ...wrong[1].manifest, sourceRevision: other };
  assert.equal(releaseAssetsMatch(sha, [...dispatchReleaseArchives], wrong).reason, 'wrong-sha');
  const mismatch = dispatchReleaseArchives.flatMap(pack);
  mismatch[0] = { ...mismatch[0], sha256: other };
  assert.equal(releaseAssetsMatch(sha, [...dispatchReleaseArchives], mismatch).reason, 'checksum-mismatch');
  const noArchive = dispatchReleaseArchives.flatMap(pack).filter(entry => entry.name !== dispatchReleaseArchives[0]);
  assert.equal(releaseAssetsMatch(sha, [...dispatchReleaseArchives], noArchive).reason, 'missing-archive');
  const renamed = dispatchReleaseArchives.flatMap(pack);
  renamed[1].manifest = { ...renamed[1].manifest, archive: 'Other.dmg' };
  assert.equal(releaseAssetsMatch(sha, [...dispatchReleaseArchives], renamed).reason, 'wrong-sha');
});

test('Pages builds the admitted SHA only after trusted CI, and Release republishes that same SHA', () => {
  const pages = YAML.parse(readFileSync('.github/workflows/pages.yml', 'utf8'));
  assert.equal(pages.on.push, undefined);
  assert.deepEqual(pages.on.workflow_run.workflows, ['CI']);
  assert.deepEqual(pages.on.workflow_run.types, ['completed']);
  assert.deepEqual(pages.on.workflow_run.branches, ['master']);
  assert.equal(pages.on.workflow_dispatch.inputs.sha.required, true);
  assert.match(pages.jobs.gate.if, /workflow_run.event == 'push'/);
  assert.doesNotMatch(pages.jobs.gate.if, /workflow_run.event == 'schedule'/);
  assert.doesNotMatch(pages.jobs.gate.if, /workflow_run.event == 'workflow_dispatch'/);
  assert.match(pages.jobs.gate.if, /head_branch == 'master'/);
  assert.match(pages.jobs.gate.if, /head_repository.full_name == github.repository/);
  assert.match(pages.jobs.gate.if, /github.ref == 'refs\/heads\/master'/);
  assert.equal(pages.jobs.gate.permissions.contents, 'read');
  assert.equal(pages.jobs.gate.permissions.actions, 'read');
  assert.equal(pages.jobs.gate.permissions.pages, undefined);
  assert.equal(pages.jobs.gate.steps[0].with.ref, '${{ github.sha }}');
  assert.equal(pages.jobs.gate.steps[0].with['persist-credentials'], false);
  const admit = pages.jobs.gate.steps.find(step => (step.run || '').includes('deployment-gate.mjs ci'));
  assert.match(admit.run, /deployment-gate\.mjs ci/);
  assert.equal(admit.env.GATE_TARGET_SHA, "${{ github.event_name == 'workflow_dispatch' && inputs.sha || github.event.workflow_run.head_sha }}");
  assert.equal(pages.jobs.gate.outputs.publish, '${{ steps.current.outputs.publish }}');
  assert.match(pages.jobs.gate.steps.map(step => step.run || '').join('\n'), /deployment-gate\.mjs pages-current/);
  assert.equal(pages.jobs.gate.steps.find(step => (step.run || '').includes('pages-current')).env.GATE_MANUAL_ROLLBACK, "${{ github.event_name == 'workflow_dispatch' && inputs.rollback && 'true' || 'false' }}");
  assert.equal(pages.on.workflow_dispatch.inputs.rollback.default, false);
  assert.equal(pages.jobs.build.if, "needs.gate.outputs.publish == 'true'");
  assert.equal(pages.jobs.build.needs, 'gate');
  assert.equal(pages.jobs.deploy.if, "needs.gate.outputs.publish == 'true' && needs.build.result == 'success'");
  assert.match(pages.jobs.deploy.steps.map(step => step.run || '').join('\n'), /deployment-gate\.mjs pages-current/);
  assert.equal(pages.jobs.deploy.steps.find(step => step.uses?.startsWith('actions/deploy-pages')).if, "steps.current.outputs.publish == 'true'");
  const checkout = pages.jobs.build.steps.find(step => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref, '${{ needs.gate.outputs.sha }}');
  assert.equal(checkout.with['persist-credentials'], false);
  assert.match(pages.jobs.build.steps.find(step => step.name === 'Refuse a tree that is not the admitted SHA').run, /git rev-parse HEAD/);
  assert.deepEqual(pages.jobs.deploy.needs, ['gate', 'build']);
  assert.equal(pages.jobs.deploy.permissions.pages, 'write');
  assert.equal(pages.jobs.deploy.permissions['id-token'], 'write');
  assert.equal(pages.jobs.deploy.permissions.contents, 'read');
  assert.equal(pages.jobs.deploy.permissions.actions, 'read');
  for (const job of Object.values(pages.jobs)) for (const step of job.steps) assert.equal(step['continue-on-error'], undefined);

  const release = YAML.parse(readFileSync('.github/workflows/release.yml', 'utf8'));
  assert.equal(release.on.push.branches, undefined);
  assert.deepEqual(release.on.push.tags, ['v*']);
  assert.deepEqual(release.on.pull_request.types, ['opened', 'synchronize', 'reopened', 'labeled', 'unlabeled']);
  assert.equal(release.on.pull_request.paths, undefined);
  assert.equal(release.on.schedule[0].cron, '0 20 * * *');
  assert.equal(release.on.workflow_dispatch.inputs.tag.required, true);
  assert.equal(release.on.workflow_dispatch.inputs.sha.required, false);
  assert.match(release.jobs.dispatch.if, /github.ref_type == 'tag'/);
  assert.match(release.jobs.dispatch.steps.at(-1).run, /--field "sha=\$SHA"/);
  assert.equal(release.jobs.resolve.if, "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/master'");
  assert.equal(release.jobs.gate.if, release.jobs.resolve.if);
  assert.equal(release.jobs.resolve.steps[0].with.ref, '${{ github.sha }}');
  assert.equal(release.jobs.gate.steps[0].with.ref, '${{ github.sha }}');
  assert.equal(release.jobs.publish.steps[0].with.ref, '${{ github.sha }}');
  assert.equal(release.jobs.publish.steps[0].with['fetch-depth'], 0);
  assert.equal(release.jobs.dispatch.steps.some(step => step.uses?.startsWith('actions/checkout')), false);
  assert.match(release.jobs.resolve.steps.at(-1).run, /deployment-gate\.mjs pin-tag/);
  assert.match(release.jobs.gate.steps.at(-1).run, /deployment-gate\.mjs ci/);
  assert.equal(release.jobs.gate.permissions.actions, 'read');
  assert.equal(release.jobs.gate.permissions.contents, 'read');
  assert.match(release.jobs.build.if, /needs.gate.result == 'success'/);
  assert.match(release.jobs.build.if, /github.event_name == 'pull_request'/);
  assert.match(release.jobs.build.if, /needs.scope.outputs.run == 'true'/);
  const download = release.jobs.publish.steps.find(step => step.uses?.startsWith('actions/download-artifact'));
  assert.equal(download.with['if-no-files-found'], undefined);
  assert.equal(download.with.pattern, 'release-${{ needs.resolve.outputs.sha }}-*');
  assert.match(release.jobs.publish.steps.map(step => step.run || '').join('\n'), /deployment-gate\.mjs manifests/);
  assert.equal(release.jobs.build.steps[0].with.ref, "${{ github.event_name == 'workflow_dispatch' && needs.resolve.outputs.sha || github.sha }}");
  assert.match(release.jobs.publish.if, /needs.build.result == 'success'/);
  assert.match(release.jobs.publish.steps.map(step => step.run || '').join('\n'), /deployment-gate\.mjs pin-tag/);
  assert.match(release.jobs.publish.steps.map(step => step.run || '').join('\n'), /deployment-gate\.mjs ci/);
  const published = release.jobs.publish.steps.map(step => step.run || '').join('\n');
  assert.match(published, /git log --format='- %h %s'/);
  assert.match(published, /git fetch --unshallow origin/);
  assert.ok(published.indexOf('git fetch --unshallow origin') < published.indexOf("git describe --tags --match 'v0.1.0-dev.*'"));
  assert.match(published, /git describe --tags --match 'v0\.1\.0-dev\.\*'/);
  assert.doesNotMatch(published, /AI4S migration is complete/);
  const manifestStep = release.jobs.publish.steps.find(step => (step.run || '').includes('deployment-gate.mjs manifests'));
  assert.equal(manifestStep.env.GATE_REQUIRED_ARCHIVES, dispatchReleaseArchives.join(','));
  assert.ok(published.lastIndexOf('deployment-gate.mjs pin-tag') < published.indexOf('--draft=false'));
  assert.match(published, /--draft/);
  assert.equal(release.jobs.publish.permissions.contents, 'write');
  assert.doesNotMatch(JSON.stringify(release.jobs.build.strategy.matrix.include), /continue-on-error/);
  for (const job of Object.values(release.jobs)) for (const step of job.steps ?? []) assert.equal(step['continue-on-error'], undefined);
});

test('a depth-1 checkout cannot see the release parent until it is unshallowed', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'pero-release-notes-'));
  const git = (cwd, args) => execFileSync('git', ['-c', 'user.name=Pero', '-c', 'user.email=pero@example.com', ...args], { cwd, encoding: 'utf8' }).trim();
  const gitFailure = (cwd, args) => {
    try {
      git(cwd, args);
      return null;
    } catch (error) {
      return error;
    }
  };
  try {
    const origin = resolve(root, 'origin');
    git(root, ['init', '-q', origin]);
    const commit = (message) => {
      writeFileSync(resolve(origin, 'note'), `${message}\n`);
      git(origin, ['add', 'note']);
      git(origin, ['commit', '-qm', message]);
      return git(origin, ['rev-parse', 'HEAD']);
    };
    commit('published');
    git(origin, ['tag', 'v0.1.0-dev.20261104']);
    commit('between releases');
    git(origin, ['tag', 'v0.1.0-dev.20261107']);
    const target = commit('release target');
    const shallow = resolve(root, 'shallow');
    git(root, ['clone', '-q', '--depth', '1', `file://${origin}`, shallow]);
    assert.equal(git(shallow, ['rev-parse', '--is-shallow-repository']), 'true');
    git(shallow, ['fetch', '--no-tags', 'origin', target]);
    const described = gitFailure(shallow, ['describe', '--tags', '--match', 'v0.1.0-dev.*', '--abbrev=0', `${target}^`]);
    assert.equal(described.status, 128);
    assert.match(String(described.stderr), /Not a valid object name|unknown revision|cannot describe anything/);
    git(shallow, ['fetch', 'origin', 'refs/tags/v0.1.0-dev.*:refs/tags/v0.1.0-dev.*']);
    const ancestor = gitFailure(shallow, ['merge-base', '--is-ancestor', 'v0.1.0-dev.20261104', target]);
    assert.notEqual(ancestor, null);
    git(shallow, ['fetch', '--unshallow', 'origin']);
    assert.equal(git(shallow, ['merge-base', '--is-ancestor', 'v0.1.0-dev.20261104', target]), '');
    assert.equal(git(shallow, ['describe', '--tags', '--match', 'v0.1.0-dev.*', '--abbrev=0', `${target}^`]), 'v0.1.0-dev.20261107');
    const log = git(shallow, ['log', '--format=%s', `v0.1.0-dev.20261104..${target}`]);
    assert.match(log, /between releases/);
    assert.match(log, /release target/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

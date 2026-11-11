import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import { commitFromTagRefs, decideDeployment, releaseManifestsMatch, samePinnedSha } from './deployment-gate.mjs';

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
    ['full gate', { runs: [run({ jobs: fullComplete })] }, 'ok'],
    ['schedule success', { runs: [run({ event: 'schedule' })] }, 'ok'],
    ['manual CI on master', { runs: [run({ event: 'workflow_dispatch' })] }, 'ok'],
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
  assert.equal(releaseManifestsMatch(sha, [{ sourceRevision: sha }, { sourceRevision: sha }]).ok, true);
  assert.equal(releaseManifestsMatch(sha, [{ sourceRevision: other }]).reason, 'wrong-sha');
  assert.equal(releaseManifestsMatch(sha, []).reason, 'missing-manifest');
});

test('Pages builds the admitted SHA only after trusted CI, and Release republishes that same SHA', () => {
  const pages = YAML.parse(readFileSync('.github/workflows/pages.yml', 'utf8'));
  assert.equal(pages.on.push, undefined);
  assert.deepEqual(pages.on.workflow_run.workflows, ['CI']);
  assert.deepEqual(pages.on.workflow_run.types, ['completed']);
  assert.deepEqual(pages.on.workflow_run.branches, ['master']);
  assert.equal(pages.on.workflow_dispatch.inputs.sha.required, true);
  assert.match(pages.jobs.gate.if, /workflow_run.event == 'push'/);
  assert.match(pages.jobs.gate.if, /workflow_run.event == 'schedule'/);
  assert.match(pages.jobs.gate.if, /workflow_run.event == 'workflow_dispatch'/);
  assert.match(pages.jobs.gate.if, /head_branch == 'master'/);
  assert.match(pages.jobs.gate.if, /head_repository.full_name == github.repository/);
  assert.match(pages.jobs.gate.if, /github.ref == 'refs\/heads\/master'/);
  assert.equal(pages.jobs.gate.permissions.contents, 'read');
  assert.equal(pages.jobs.gate.permissions.actions, 'read');
  assert.equal(pages.jobs.gate.permissions.pages, undefined);
  assert.equal(pages.jobs.gate.steps[0].with.ref, 'master');
  assert.equal(pages.jobs.gate.steps[0].with['persist-credentials'], false);
  assert.match(pages.jobs.gate.steps.at(-1).run, /deployment-gate\.mjs ci/);
  assert.equal(pages.jobs.gate.steps.at(-1).env.GATE_TARGET_SHA, "${{ github.event_name == 'workflow_dispatch' && inputs.sha || github.event.workflow_run.head_sha }}");
  assert.equal(pages.jobs.build.needs, 'gate');
  const checkout = pages.jobs.build.steps.find(step => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref, '${{ needs.gate.outputs.sha }}');
  assert.equal(checkout.with['persist-credentials'], false);
  assert.match(pages.jobs.build.steps.find(step => step.name === 'Refuse a tree that is not the admitted SHA').run, /git rev-parse HEAD/);
  assert.equal(pages.jobs.deploy.needs, 'build');
  assert.equal(pages.jobs.deploy.permissions.pages, 'write');
  assert.equal(pages.jobs.deploy.permissions['id-token'], 'write');
  assert.equal(pages.jobs.deploy.permissions.contents, undefined);
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
  assert.equal(release.jobs.resolve.if, "github.event_name == 'workflow_dispatch'");
  assert.match(release.jobs.resolve.steps.at(-1).run, /deployment-gate\.mjs pin-tag/);
  assert.match(release.jobs.gate.steps.at(-1).run, /deployment-gate\.mjs ci/);
  assert.equal(release.jobs.gate.permissions.actions, 'read');
  assert.equal(release.jobs.gate.permissions.contents, 'read');
  assert.match(release.jobs.build.if, /needs.gate.result == 'success'/);
  assert.match(release.jobs.build.if, /needs.scope.outputs.run == 'true'/);
  assert.equal(release.jobs.build.steps[0].with.ref, "${{ github.event_name == 'workflow_dispatch' && needs.resolve.outputs.sha || github.sha }}");
  assert.match(release.jobs.publish.if, /needs.build.result == 'success'/);
  assert.match(release.jobs.publish.steps.map(step => step.run || '').join('\n'), /deployment-gate\.mjs pin-tag/);
  assert.match(release.jobs.publish.steps.map(step => step.run || '').join('\n'), /deployment-gate\.mjs ci/);
  assert.match(release.jobs.publish.steps.map(step => step.run || '').join('\n'), /deployment-gate\.mjs manifests/);
  assert.equal(release.jobs.publish.permissions.contents, 'write');
  assert.doesNotMatch(JSON.stringify(release.jobs.build.strategy.matrix.include), /continue-on-error/);
  for (const job of Object.values(release.jobs)) for (const step of job.steps ?? []) assert.equal(step['continue-on-error'], undefined);
});

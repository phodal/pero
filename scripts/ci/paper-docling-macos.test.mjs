import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import YAML from 'yaml';

test('real Mac Docling verification is scoped, opt-in, read-only and exact-head', () => {
  const workflow = YAML.parse(readFileSync('.github/workflows/paper-docling-macos.yml', 'utf8'));
  assert.deepEqual(Object.keys(workflow.on).sort(), ['pull_request', 'workflow_dispatch']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.on.workflow_dispatch.inputs.allow_official_downloads.default, false);
  assert.deepEqual(workflow.on.pull_request.types, ['opened', 'synchronize', 'reopened', 'labeled']);
  const paths = workflow.on.pull_request.paths;
  assert.ok(paths.length > 0 && paths.every(path =>
    path === '.github/workflows/paper-docling-macos.yml' ||
    path.startsWith('apps/paper-agent/') || path.startsWith('crates/pero-runtime/src/apps/docling')));
  const job = workflow.jobs.docling;
  assert.equal(job['runs-on'], 'macos-26');
  assert.equal(job['timeout-minutes'], 60);
  assert.match(job.if, /workflow_dispatch.*inputs.allow_official_downloads/);
  assert.match(job.if, /head.repo.full_name == github.repository/);
  assert.match(job.if, /contains\(github.event.pull_request.labels.\*.name, 'ci:full'\)/);
  assert.match(job.if, /github.event.action != 'labeled' \|\| github.event.label.name == 'ci:full'/);
  const checkout = job.steps.find(step => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref, '${{ github.event.pull_request.head.sha || github.sha }}');
  assert.equal(checkout.with['persist-credentials'], false);
  assert.equal(job.env.EXPECTED_HEAD_SHA, checkout.with.ref);
  const run = job.steps.find(step => step.name === 'Verify approved installation and real Mac execution');
  assert.match(run.run, /docling_ci.py --allow-official-downloads/);
  assert.match(run.run, /--root "\$RUNNER_TEMP\/paper-docling-ci"/);
  assert.equal(run['timeout-minutes'], 40);
  const artifact = job.steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(artifact.if, 'always()');
  assert.equal(artifact.with.path, 'test-results/paper-docling-macos/');
  assert.match(artifact.with.name, /env.EXPECTED_HEAD_SHA/);
  assert.equal(artifact.with['retention-days'], 7);
  for (const step of job.steps) assert.equal(step['continue-on-error'], undefined);
  const commands = job.steps.map(step => step.run || '').join('\n');
  assert.doesNotMatch(commands, /brew |sudo |npm run build|curl |eval /);
  assert.doesNotMatch(JSON.stringify(workflow), /secrets\./);
});

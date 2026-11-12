import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import YAML from 'yaml';

const read = name => YAML.parse(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));

test('manual diagnostics select exactly one suite without automatic execution', () => {
  const workflow = read('diagnostics');
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const suite = workflow.on.workflow_dispatch.inputs.suite;
  assert.equal(suite.type, 'choice');
  assert.deepEqual(suite.options, ['graphics', 'locked-scientific-linux']);
  assert.equal(suite.default, 'graphics');
  assert.equal(workflow.jobs.graphics.if, "github.event_name == 'workflow_dispatch' && inputs.suite == 'graphics'");
  assert.equal(workflow.jobs['prepare-and-use'].if, "github.event_name == 'workflow_dispatch' && inputs.suite == 'locked-scientific-linux'");
  assert.equal(workflow.jobs.graphics.concurrency, undefined);
  assert.equal(workflow.jobs['prepare-and-use'].concurrency.group, 'locked-scientific-linux-${{ github.ref }}');
  assert.equal(workflow.jobs['prepare-and-use'].concurrency['cancel-in-progress'], false);
});

test('sandbox profiles retain separate same-repository label opt-ins', () => {
  const workflow = read('agent-sandbox');
  assert.deepEqual(Object.keys(workflow.on).sort(), ['pull_request', 'workflow_dispatch']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const profile = workflow.on.workflow_dispatch.inputs.profile;
  assert.deepEqual(profile.options, ['standard', 'isolated']);
  assert.equal(profile.default, 'standard');
  for (const [id, choice, label] of [
    ['kind', 'standard', 'agent-sandbox-e2e'],
    ['isolated-kind', 'isolated', 'agent-sandbox-isolated-e2e'],
  ]) {
    const job = workflow.jobs[id];
    assert.ok(job.if.includes(`github.event_name == 'workflow_dispatch' && inputs.profile == '${choice}'`));
    assert.ok(job.if.includes('github.event.pull_request.head.repo.full_name == github.repository'));
    assert.ok(job.if.includes(`contains(github.event.pull_request.labels.*.name, '${label}')`));
    assert.equal(job.steps.at(-1).if, 'always()');
    assert.equal(job.concurrency.group, label.replace('-e2e', '') + '-${{ github.ref }}');
    assert.equal(job.concurrency['cancel-in-progress'], false);
  }
  assert.equal(workflow.concurrency, undefined);
});

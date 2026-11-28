import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import YAML from 'yaml';

// CodeRabbit adds one check. Seventeen Actions jobs leave room for it and still
// stay under the twenty-check pull request budget, including skipped suites.
const pullRequestJobBudget = 18;

test('a pull request workflow emits at most one check per job and stays under the budget', () => {
  const workflows = readdirSync('.github/workflows').filter(name => name.endsWith('.yml'));
  const pullRequestWorkflows = [];
  for (const name of workflows) {
    const workflow = YAML.parse(readFileSync(`.github/workflows/${name}`, 'utf8'));
    const on = workflow.on;
    if (on?.pull_request) pullRequestWorkflows.push(name);
    for (const [id, job] of Object.entries(workflow.jobs)) {
      if (!job.uses) continue;
      const called = YAML.parse(readFileSync(job.uses.slice(2), 'utf8'));
      assert.equal(Object.keys(called.jobs).length, 1, `${name} job ${id} calls ${job.uses}, which must contain one job so skipped siblings are not checks`);
    }
  }
  assert.deepEqual(pullRequestWorkflows, ['ci.yml']);
  const ci = YAML.parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  assert.ok(Object.keys(ci.jobs).length <= pullRequestJobBudget, Object.keys(ci.jobs).join(','));
  for (const [id, job] of Object.entries(ci.jobs)) assert.equal(job.strategy, undefined, `${id} must not multiply into matrix checks`);
  assert.equal(ci.jobs.complete.name, 'Linux CI gate');
  assert.equal(YAML.parse(readFileSync('.github/workflows/release.yml', 'utf8')).on.pull_request, undefined);
  assert.equal(YAML.parse(readFileSync('.github/workflows/acceptance.yml', 'utf8')).on.pull_request, undefined);
  assert.equal(YAML.parse(readFileSync('.github/workflows/ci-full.yml', 'utf8')).on.pull_request, undefined);
});

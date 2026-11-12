import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import YAML from 'yaml';

const read = name => YAML.parse(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));

test('CI selects the existing reusable job families without adding automatic entry points', () => {
  const ci = read('ci');
  const jobs = read('ci-jobs');
  assert.deepEqual(Object.keys(jobs.on), ['workflow_call']);
  assert.deepEqual(jobs.permissions, { contents: 'read' });
  assert.equal(jobs.on.workflow_call.inputs.suite.required, true);
  const families = {
    notebook: ['notebook', 'notebook'],
    'notebook-canvas': ['notebook-canvas', 'browser'],
    'native-ui': ['native-ui', 'native-ui'],
    'desktop-linux': ['desktop', 'desktop'],
    desktop: ['desktop', 'desktop'],
  };
  for (const [caller, [suite, implementation]] of Object.entries(families)) {
    assert.equal(ci.jobs[caller].uses, './.github/workflows/ci-jobs.yml');
    assert.equal(ci.jobs[caller].with.suite, suite);
    assert.equal(jobs.jobs[implementation].if, `inputs.suite == '${suite}'`);
    assert.ok(ci.jobs.complete.needs.includes(caller));
  }
  assert.equal(ci.jobs['desktop-linux'].with.os, 'ubuntu-latest');
  assert.equal(ci.jobs['desktop-linux'].with['upload-runtime'], true);
  assert.equal(ci.jobs.desktop.with.os, '${{ matrix.os }}');
  assert.deepEqual(Object.keys(jobs.jobs).sort(), ['browser', 'desktop', 'native-ui', 'notebook']);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import YAML from 'yaml';

const read = name => YAML.parse(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));

test('CI calls one reusable job per affected suite and keeps Desktop off pull requests', () => {
  const ci = read('ci');
  const full = read('ci-full');
  const families = {
    notebook: ['ci-notebook.yml', 'notebook'],
    'scientific-viewer': ['ci-scientific-viewer.yml', 'scientific-viewer'],
    lcms2yield: ['ci-lcms2yield.yml', 'lcms2yield'],
    data: ['ci-data.yml', 'data'],
    lab: ['ci-lab.yml', 'lab'],
    'control-lab': ['ci-control-lab.yml', 'control-lab'],
    'virtual-cell': ['ci-virtual-cell.yml', 'virtual-cell'],
    'notebook-canvas': ['ci-notebook-canvas.yml', 'browser'],
    'native-ui': ['ci-native.yml', 'native-ui'],
  };
  for (const [caller, [file, implementation]] of Object.entries(families)) {
    const called = YAML.parse(readFileSync(`.github/workflows/${file}`, 'utf8'));
    assert.deepEqual(Object.keys(called.on), ['workflow_call']);
    assert.deepEqual(called.permissions, { contents: 'read' });
    assert.equal(Object.keys(called.jobs).length, 1, file);
    assert.equal(called.jobs[implementation].if, `inputs.suite == '${caller}'`);
    assert.equal(ci.jobs[caller].uses, `./.github/workflows/${file}`);
    assert.equal(ci.jobs[caller].with.suite, caller);
    assert.ok(ci.jobs.complete.needs.includes(caller));
  }
  assert.equal(ci.jobs['desktop-linux'], undefined);
  assert.equal(ci.jobs.desktop, undefined);
  assert.equal(full.jobs['desktop-linux'].uses, './.github/workflows/ci-desktop.yml');
  assert.equal(full.jobs['desktop-linux'].with.os, 'ubuntu-latest');
  assert.equal(full.jobs['desktop-linux'].with['upload-runtime'], true);
  assert.equal(full.jobs.desktop.uses, './.github/workflows/ci-desktop.yml');
  assert.equal(full.jobs.desktop.with.os, '${{ matrix.os }}');
  const desktop = YAML.parse(readFileSync('.github/workflows/ci-desktop.yml', 'utf8'));
  assert.equal(Object.keys(desktop.jobs).length, 1);
  assert.equal(desktop.jobs.desktop.if, "inputs.suite == 'desktop'");
});

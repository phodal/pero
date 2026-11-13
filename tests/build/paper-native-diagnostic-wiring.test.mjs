// Static opt-in/safety wiring checks; no desktop, D-Bus, download or input.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const workflow = read('.github/workflows/computer-use.yml');
const entry = read('tests/e2e/paper-native-diagnostic.mjs');
const gate = "runner.os == 'Linux' && (github.event_name == 'workflow_dispatch' && inputs.paper_native_diagnostic)";
const step = name => {
  const text = workflow.split(`      - name: ${name}\n`)[1];
  assert.ok(text, `Missing step: ${name}`);
  return text.split('      - name: ')[0];
};

test('diagnostic setup/run/artifact require explicit Linux opt-in', () => {
  assert.match(workflow, /paper_native_diagnostic:\n(?:[^\n]*\n){3}        default: false/);
  assert.match(workflow, /permissions:\n  contents: read\njobs:/);
  for (const name of ['Prepare opt-in Paper diagnostic', 'Read-only owned Paper native diagnostic', 'Read-only Paper diagnostic evidence']) {
    const body = step(name);
    assert.ok(body.includes(`if: ${name.endsWith('evidence') ? 'always() && ' : ''}${gate}\n`));
    assert.ok(!body.includes('ci:full'));
  }
  assert.ok(step('Prepare opt-in Paper diagnostic').includes('npm ci --registry=https://registry.npmjs.org'));
  assert.match(step('Prepare opt-in Paper diagnostic'), /apt-get install -y .*at-spi2-core.*python3-gi/);
});

test('isolated entry and exact owned artifacts retain bounded diagnostics', () => {
  const run = step('Read-only owned Paper native diagnostic');
  assert.ok(run.includes('timeout-minutes: 3'));
  assert.ok(run.includes('--name paper-native-diagnostic --timeout-seconds 90 -- xvfb-run -a node tests/e2e/paper-native-diagnostic.mjs'));
  const artifact = step('Read-only Paper diagnostic evidence');
  assert.match(artifact, /path: \|\n            test-results\/paper-native-diagnostic\/\n            test-results\/ci\/paper-native-diagnostic.json\n          retention-days: 7/);
  assert.ok(entry.includes("spawnSync('dbus-run-session', ['--', process.execPath, import.meta.filename]"));
  assert.ok(entry.includes("assert.ok(['status', 'targets', 'observe'].includes(request.operation)"));
  assert.doesNotMatch(entry, /operation\s*:\s*['"]act['"]|approvalAction\s*\(|\.click\s*\(|\.press\s*\(/);
  assert.ok(entry.includes("assert.equal(excludedOwnerMatches, 0"));
  assert.ok(entry.includes("'Exact X11 PID must equal owned Electron PID'"));
  assert.ok(entry.includes('timeout: 12000'));
  assert.ok(entry.includes("resolve(root, 'test-results/paper-native-diagnostic')"));
});

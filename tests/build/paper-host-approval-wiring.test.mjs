// No GUI/input: guard the separately authorized new Host UI opt-in boundary.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const workflow = read('.github/workflows/computer-use.yml');
const fixture = read('tests/e2e/paper-host-approval-native.mjs');
const helper = read('tests/fixtures/paper-host-approval.mjs');
const gate = "runner.os == 'Linux' && ((github.event_name == 'pull_request' && contains(github.event.pull_request.labels.*.name, 'ci:paper-host-approval-native')) || (github.event_name == 'workflow_dispatch' && inputs.paper_host_approval_native))";
const step = name => {
  const text = workflow.split(`      - name: ${name}\n`)[1];
  assert.ok(text, `Missing ${name}`);
  return text.split('      - name: ')[0];
};

test('new positive UI entry requires its own explicit Linux opt-in, default off', () => {
  assert.match(workflow, /paper_host_approval_native:\n(?:[^\n]*\n){3}        default: false/);
  assert.match(workflow, /permissions:\n  contents: read\njobs:/);
  for (const name of ['Prepare opt-in Host approval UI', 'Owned Host approval semantic UI only', 'Owned Host approval UI evidence']) {
    const body = step(name);
    assert.ok(body.includes(`if: ${name.endsWith('evidence') ? 'always() && ' : ''}${gate}\n`));
    assert.ok(!body.includes('ci:full'));
    assert.ok(!body.includes('ci:paper-native-diagnostic'));
    assert.ok(!body.includes('paper-reproduction-native.mjs'));
  }
  const prepare = step('Prepare opt-in Host approval UI');
  assert.ok(prepare.includes('npm ci --registry=https://registry.npmjs.org'));
  assert.ok(prepare.includes('node scripts/build/desktop.mjs'));
  const connectorInstall = 'npm ci --prefix packages/connectors --ignore-scripts --registry=https://registry.npmjs.org';
  assert.ok(prepare.includes(connectorInstall), 'Connectors owns a separate lockfile outside root workspaces');
  assert.ok(prepare.indexOf(connectorInstall) < prepare.indexOf('node scripts/build/desktop.mjs'));
  const connectorLock = JSON.parse(read('packages/connectors/package-lock.json'));
  for (const name of ['fflate', 'pdfjs-dist']) assert.ok(connectorLock.packages[`node_modules/${name}`]);
  assert.doesNotMatch(prepare, /--external|npm install|build\/connectors\.mjs/);
  assert.ok(prepare.includes('--test desktop/src/main/reproduction-approval-linux.test.ts'));
  assert.ok(workflow.includes('node scripts/build/computer.mjs\n'));
  for (const script of ['scripts/build/desktop.mjs', 'scripts/build/product.mjs']) {
    assert.ok(read(script).includes("'reproduction-approval-preload':"));
    assert.ok(read(script).includes('desktop/src/preload/reproduction-approval.ts'));
  }
});

test('UI run is bounded, isolated and saves only its exact owned evidence', () => {
  const run = step('Owned Host approval semantic UI only');
  assert.ok(run.includes('timeout-minutes: 3'));
  assert.ok(run.includes("PERO_PAPER_HOST_APPROVAL_NATIVE: '1'"));
  assert.ok(run.includes('--name paper-host-approval-native --timeout-seconds 120 -- xvfb-run -a node tests/e2e/paper-host-approval-native.mjs'));
  assert.match(step('Owned Host approval UI evidence'), /path: \|\n            test-results\/paper-host-approval-native\/\n            test-results\/ci\/paper-host-approval-native.json\n          retention-days: 7/);
  assert.ok(fixture.includes("spawnSync('dbus-run-session', ['--', process.execPath, import.meta.filename]"));
  assert.ok(fixture.includes('await copyFile('));
  assert.ok(fixture.includes("desktop/dist/reproduction-approval-preload.cjs"));
  assert.ok(fixture.includes('createHash(\'sha256\')'));
  assert.ok(fixture.includes("assert.equal(excludedOwnerMatches, 0"));
  assert.ok(fixture.includes("receipt.outcome.execution?.route, 'semantic'"));
  assert.ok(helper.includes("assert.equal(observation.truncated, false"));
  assert.ok(helper.includes("contents.some(element => element.label.includes(nonce))"));
  assert.ok(helper.includes("button.actions.includes('click')"));
  assert.doesNotMatch(fixture, /\.click\s*\(|\.press\s*\(|sendInputEvent|kind:\s*['"]pixel['"]|--confirm-execution|paper_agent\.pcgym/);
});

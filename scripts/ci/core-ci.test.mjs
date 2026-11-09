import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import { failures } from './gate.mjs';

const workflow = YAML.parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
const { steps } = workflow.jobs.core;
const checks = steps.filter(step => step.run && !['npm', 'gpui', 'paper_python', 'notebook_canvas_python', 'viewer_python',
  'hpc_npm', 'automations_npm', 'paper_npm', 'viewer_npm', 'host_build', 'mcp_build'].includes(step.id));

// Interpret only this workflow's deliberately small condition vocabulary. This
// verifies the declared dependency graph, not an emulation of the Actions runner.
function dependencies(step) {
  assert.match(step.if, /^\$\{\{ !cancelled\(\)( && steps\.\w+\.outcome == 'success')* \}\}$/);
  return [...step.if.matchAll(/steps\.(\w+)\.outcome/g)].map(match => match[1]);
}
function outcomes(failed = [], cancelBefore) {
  const results = {};
  let cancelled = false;
  for (const step of steps) {
    if (!step.id) continue; // Evidence upload runs even after failures/cancellation.
    if (step.id === cancelBefore) cancelled = true;
    const ready = !cancelled && (step.id === 'checkout' || dependencies(step).every(id => results[id] === 'success'));
    results[step.id] = !ready ? 'skipped' : failed.includes(step.id) ? 'failure' : 'success';
  }
  return results;
}

test('core checks have explicit preceding prerequisites and never mask failures', () => {
  const seen = new Set();
  for (const step of steps) {
    assert.equal(step['continue-on-error'], undefined);
    if (!step.id) continue;
    assert(!seen.has(step.id), `duplicate step ${step.id}`);
    if (step.id !== 'checkout') for (const dependency of dependencies(step)) assert(seen.has(dependency), `${step.id}: ${dependency} must precede its consumer`);
    seen.add(step.id);
  }
  assert(Object.values(outcomes()).every(result => result === 'success'));
  assert(workflow.jobs.complete.needs.includes('core'));
  assert.equal(steps.at(-1).if, 'always()');
});

test('every assertion failure leaves independent core checks running and the gate red', () => {
  for (const failed of checks) {
    const result = outcomes([failed.id]);
    assert.equal(result[failed.id], 'failure');
    for (const peer of checks) if (peer.id !== failed.id) assert.equal(result[peer.id], 'success', `${failed.id} hid ${peer.id}`);
    assert.equal(result.host_build, 'success', `${failed.id} hid Host compilation`);
    assert.equal(result.mcp_build, 'success', `${failed.id} hid MCP compilation`);
    assert.deepEqual(failures({ core: { result: 'failure' } }, false), ['core']);
  }
});

test('failed prerequisites skip their consumers without hiding unrelated checks', () => {
  for (const [failed, skipped, running] of [
    ['paper_npm', ['paper_components', 'paper_types', 'paper_availability', 'paper_manual', 'app_build_contracts'], ['viewer_unit', 'hpc_ui', 'core_types', 'rust_tests', 'host_stdio']],
    ['rust', ['rust_tests', 'host_build', 'host_stdio', 'app_canvas'], ['paper_components', 'core_types', 'app_use', 'mcp_build']],
    ['host_build', ['app_canvas', 'host_stdio', 'host_research', 'host_mcp_settings', 'host_mcp_ownership', 'host_automation', 'host_app_automation', 'host_app_agent', 'control_lab_host'], ['rust_tests', 'core_types', 'mcp_build', 'control_lab']],
    ['mcp_build', ['host_mcp_settings', 'host_mcp_ownership'], ['host_stdio', 'host_research', 'host_app_agent']],
    ['paper_python', ['paper_backend', 'paper_pdf_http', 'paper_source_http', 'paper_source_cli', 'host_research'], ['data_backend', 'viewer_backend', 'paper_components', 'host_stdio']],
    ['notebook_canvas_python', ['app_canvas'], ['paper_backend', 'core_types', 'host_build', 'host_stdio']],
    ['npm', ['core_types', 'app_use', 'paper_components', 'host_stdio'], ['rust_tests', 'host_build', 'paper_backend', 'data_backend']],
  ]) {
    const result = outcomes([failed]);
    for (const id of skipped) assert.equal(result[id], 'skipped', `${failed} must block ${id}`);
    for (const id of running) assert.equal(result[id], 'success', `${failed} must not block ${id}`);
  }
});

test('cancellation stops new checks rather than acting like an assertion failure', () => {
  const result = outcomes([], 'paper_components');
  assert.equal(result.hpc_ui, 'success');
  const remaining = steps.slice(steps.findIndex(step => step.id === 'paper_components')).filter(step => step.id);
  for (const step of remaining) assert.equal(result[step.id], 'skipped', step.id);
  assert.deepEqual(failures({ core: { result: 'cancelled' } }, false), ['core']);
});

test('Viewer inspection survives bridge failure and retains screenshot evidence', () => {
  const job = workflow.jobs['scientific-viewer'];
  const bridge = job.steps.find(step => step.run === 'node tests/e2e/app-use-bridge.mjs');
  const viewer = job.steps.find(step => step.run === 'node tests/e2e/scientific-viewer-browser.mjs');
  const prepare = job.steps.find(step => step.id === 'prepare');
  assert.ok(prepare);
  assert.ok(job.steps.indexOf(prepare) < job.steps.indexOf(bridge));
  assert.ok(job.steps.indexOf(bridge) < job.steps.indexOf(viewer));
  // Only successful preparation is required; !cancelled() bypasses the implicit
  // success() gate without continuing after cancellation or masking failures.
  assert.deepEqual(dependencies(viewer), ['prepare']);
  for (const step of job.steps) assert.equal(step['continue-on-error'], undefined);
  assert.equal(job['continue-on-error'], undefined);
  const evidence = job.steps.at(-1);
  assert.equal(evidence.if, 'always()');
  assert.match(evidence.uses, /^actions\/upload-artifact@/);
  assert.deepEqual(evidence.with.path.trim().split('\n'), ['test-results/scientific-viewer-browser/', 'test-results/session-artifacts-viewer/', 'test-results/research-lab-browser/']);
  const meshes = job.steps.find(step => step.run === 'node tests/e2e/research-lab-browser.mjs');
  assert.ok(meshes);
  assert.equal(meshes.if, viewer.if);
  assert.ok(job.steps.indexOf(viewer) < job.steps.indexOf(meshes));
  const artifacts = job.steps.find(step => step.run === 'node apps/scientific-viewer/test/artifact-browser.mjs');
  assert.ok(artifacts);
  assert.equal(artifacts.if, viewer.if);
  assert.ok(workflow.jobs.complete.needs.includes('scientific-viewer'));
  assert.deepEqual(failures({ 'scientific-viewer': { result: 'failure' } }, false), ['scientific-viewer']);
});

test('Notebook browser and type checks survive unit failures and gate completion', () => {
  assert.equal(workflow.jobs.notebook.uses, "./.github/workflows/notebook.yml");
  const job = YAML.parse(readFileSync('.github/workflows/notebook.yml', 'utf8')).jobs.notebook;
  const prepare = job.steps.find(step => step.id === 'prepare');
  assert.match(prepare.run, /npm --prefix apps\/notebook run build/);
  assert(job.steps.some(step => step.run === 'npm run test:notebook'));
  for (const command of ['typecheck', 'test:browser']) {
    const step = job.steps.find(step => step.run === `npm --prefix apps/notebook run ${command}`);
    assert.deepEqual(dependencies(step), ['prepare']);
  }
  for (const step of job.steps) assert.equal(step['continue-on-error'], undefined);
  const evidence = job.steps.at(-1);
  assert.equal(evidence.if, 'always()');
  assert.equal(evidence.with.path, 'test-results/notebook/');
  assert(workflow.jobs.complete.needs.includes('notebook'));
  assert.deepEqual(failures({ notebook: { result: 'failure' } }, false), ['notebook']);
});

test('Control Lab split selects every existing runtime test exactly once', () => {
  const select = id => execFileSync('bash', ['-c', steps.find(step => step.id === id).run.replace('node --test', "printf '%s\\n'")], { encoding: 'utf8' }).trim().split('\n');
  const pure = select('control_lab');
  const host = select('control_lab_host');
  const expected = readdirSync('tests/runtime/control-lab').filter(name => /\.test\.(mjs|ts)$/.test(name)).map(name => `tests/runtime/control-lab/${name}`);
  assert.deepEqual([...pure, ...host].sort(), expected.sort());
  assert(pure.every(path => !path.split('/').at(-1).startsWith('host-')));
  assert(host.every(path => path.split('/').at(-1).startsWith('host-')));
  assert(dependencies(steps.find(step => step.id === 'control_lab_host')).includes('host_build'));
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import YAML from 'yaml';
import { acceptancePaths, acceptanceScope } from './acceptance-scope.mjs';

test('acceptance suites preserve their independent PR path scopes', () => {
  const cases = [
    ['README.md', []],
    ['server/internal/httpapi/routes.go', ['sandbox']],
    ['crates/pero-runtime/src/lib.rs', ['sandbox']],
    ['crates/pero-runtime/src/apps/docling_runtime.rs', ['sandbox', 'docling']],
    ['apps/paper-agent/backend/paper_agent/docling.py', ['docling', 'fisher']],
    ['apps/paper-agent/backend/paper_agent/numeric_result.py', ['docling', 'fisher']],
    ['apps/paper-agent/test/fixtures/pdf-corpus-v1.json', ['docling', 'fisher']],
    ['apps/paper-agent/README.md', ['fisher']],
    ['packages/app-sdk/src/index.ts', ['fisher']],
    ['packages/source-extraction/src/index.ts', ['docling', 'fisher']],
    ['tests/e2e/paper-fisher-browser.mjs', ['fisher']],
    ['.github/workflows/acceptance.yml', ['sandbox', 'docling', 'fisher']],
    ['scripts/ci/acceptance-scope.mjs', ['sandbox', 'docling', 'fisher']],
    ['scripts/ci/workflow-scope.mjs', ['sandbox', 'docling', 'fisher']],
  ];
  for (const [file, suites] of cases) {
    const result = acceptanceScope([file]);
    assert.deepEqual(Object.keys(result).filter(key => result[key]), suites, file);
  }
  assert.deepEqual(acceptanceScope([]), { sandbox: false, docling: false, fisher: false });
});

test('acceptance suites are manual and Fisher paths stay on the Linux core job', () => {
  const workflow = YAML.parse(readFileSync('.github/workflows/acceptance.yml', 'utf8'));
  const ci = YAML.parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  assert.equal(workflow.on.pull_request, undefined);
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.equal(workflow.jobs.scope, undefined);
  assert.equal(workflow.jobs.fisher.if, "github.event_name == 'workflow_dispatch' && inputs.suite == 'paper-fisher'");
  assert.equal(workflow.jobs.docling.if, "github.event_name == 'workflow_dispatch' && inputs.suite == 'paper-docling-macos' && inputs.allow_official_downloads");
  assert.equal(workflow.jobs.docling.concurrency.group, 'paper-docling-macos-${{ github.event.pull_request.number || github.ref }}');
  assert.equal(workflow.jobs.docling.concurrency['cancel-in-progress'], false);
  const fisher = ci.jobs.core.steps.find(step => step.id === 'fisher');
  assert.match(fisher.run, /test_fisher\*\.py/);
  assert.match(fisher.run, /paper-fisher-browser\.mjs/);
  assert.match(fisher.if, /env\.FISHER == 'true'/);
  assert.equal(acceptancePaths.fisher.includes('apps/paper-agent/**'), true);
});

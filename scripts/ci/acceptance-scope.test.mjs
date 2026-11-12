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

test('scope failures retain eligibility without bypassing labels or manual download consent', () => {
  const workflow = YAML.parse(readFileSync('.github/workflows/acceptance.yml', 'utf8'));
  assert.deepEqual(workflow.on.pull_request.paths, [...new Set(Object.values(acceptancePaths).flat())]);
  const scope = workflow.jobs.scope;
  assert.equal(scope.steps[0].with['fetch-depth'], 0);
  assert.match(scope.steps.at(-1).run, /git diff --name-only -z "\$SCOPE_BASE\.\.\.\$SCOPE_HEAD"/);
  assert.match(scope.steps.at(-1).run, /sandbox=true\\ndocling=true\\nfisher=true/);
  for (const [id, output] of [['kind', 'sandbox'], ['isolated-kind', 'sandbox'], ['docling', 'docling'], ['fisher', 'fisher']]) {
    const job = workflow.jobs[id];
    assert.equal(job.needs, 'scope');
    assert.ok(job.if.startsWith('always() && !cancelled()'));
    assert.ok(job.if.includes(`needs.scope.outputs.${output} != 'false'`));
    if (id !== 'fisher') assert.match(job.if, /head.repo.full_name == github.repository/);
  }
  assert.match(workflow.jobs.fisher.if, /github.event.action != 'labeled'/);
  assert.match(workflow.jobs.docling.if, /inputs.suite == 'paper-docling-macos' && inputs.allow_official_downloads/);
  assert.match(workflow.jobs.docling.if, /github.event.action != 'labeled' \|\| github.event.label.name == 'ci:full'/);
  assert.equal(workflow.jobs.docling.concurrency.group, 'paper-docling-macos-${{ github.event.pull_request.number || github.ref }}');
  assert.equal(workflow.jobs.docling.concurrency['cancel-in-progress'], false);
});

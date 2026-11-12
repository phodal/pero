// Original acceptance path filters, with their workflow entry point consolidated.
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchesPath } from './workflow-scope.mjs';

export const acceptancePaths = Object.freeze({
  "sandbox": [
    "deployment/agent-sandbox/**",
    "crates/pero-worker/**",
    "crates/pero-contracts/**",
    "crates/pero-runtime/**",
    "Cargo.toml",
    "Cargo.lock",
    "scripts/cargo.mjs",
    "harness/go/**",
    "server/**",
    ".github/workflows/acceptance.yml",
    "scripts/ci/acceptance-scope.mjs",
    "scripts/ci/workflow-scope.mjs"
  ],
  "docling": [
    ".github/workflows/acceptance.yml",
    "apps/paper-agent/app.json",
    "packages/source-extraction/**",
    "scripts/build/source-parsers.mjs",
    "apps/paper-agent/requirements-docling*.txt",
    "apps/paper-agent/backend/paper_agent/docling*.py",
    "apps/paper-agent/backend/paper_agent/numeric*.py",
    "apps/paper-agent/backend/paper_agent/pdf*.py",
    "apps/paper-agent/test/manual/docling*.py",
    "apps/paper-agent/test/test_docling*.py",
    "apps/paper-agent/test/test_numeric*.py",
    "apps/paper-agent/test/fixtures/*corpus*.json",
    "crates/pero-runtime/src/apps/docling*",
    "scripts/ci/acceptance-scope.mjs",
    "scripts/ci/workflow-scope.mjs"
  ],
  "fisher": [
    "apps/paper-agent/**",
    "packages/app-sdk/**",
    "packages/source-extraction/**",
    "scripts/build/source-parsers.mjs",
    "tests/e2e/paper-fisher-*.mjs",
    ".github/workflows/acceptance.yml",
    "scripts/ci/acceptance-scope.mjs",
    "scripts/ci/workflow-scope.mjs"
  ]
});

export function acceptanceScope(files) {
  return Object.fromEntries(Object.entries(acceptancePaths).map(([suite, patterns]) =>
    [suite, files.some(file => patterns.some(pattern => matchesPath(pattern, file)))]));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const scope = acceptanceScope(readFileSync(0, 'utf8').split('\0').filter(Boolean));
  for (const [suite, run] of Object.entries(scope)) {
    appendFileSync(process.env.GITHUB_OUTPUT, suite + '=' + run + '\n');
  }
}

// Shared path scope for workflows whose expensive jobs should not start on
// every pull request, while schedule, manual dispatch, and explicit labels remain.
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const computerUseGlobs = Object.freeze([
  'use/**',
  'protocol/computer-*.tsp',
  'crates/pero-contracts/**',
  'scripts/build/computer.mjs',
  'tests/**/computer-*',
  'tests/build/paper-native-diagnostic-wiring.test.mjs',
  'tests/build/paper-host-approval-wiring.test.mjs',
  'tests/fixtures/paper-atspi-diagnostic.py',
  'tests/fixtures/paper-atspi-diagnostic-test.py',
  'tests/fixtures/paper-host-approval.mjs',
  'tests/fixtures/paper-host-approval.test.mjs',
  'tests/fixtures/paper-host-approval-diagnostics.mjs',
  'tests/e2e/paper-native-diagnostic.mjs',
  'tests/e2e/paper-host-approval-native.mjs',
  'desktop/src/main/reproduction-approval-linux.test.ts',
  'desktop/src/main/apps-reproduction.test.ts',
  'scripts/ci/workflow-scope.mjs',
  '.github/workflows/computer-use.yml',
]);

// Virtual Cell packaging builds the Host, the reader, and the product shell.
// The daily schedule and workflow_dispatch remain the path-independent exits.
export const releasePackageGlobs = Object.freeze([
  'apps/virtual-cell/**',
  'products/virtual-cell/**',
  'packages/product/**',
  'scripts/release/**',
  'scripts/build/**',
  'scripts/cargo.mjs',
  'scripts/lib/**',
  'desktop/**',
  'crates/pero-host/**',
  'crates/pero-worker/**',
  'crates/pero-runtime/**',
  'Cargo.toml',
  'Cargo.lock',
  'package.json',
  'package-lock.json',
  'scripts/ci/deployment-gate.mjs',
  'scripts/ci/workflow-scope.mjs',
  '.github/workflows/release.yml',
]);

const computerUseLabels = new Set(['ci:full', 'ci:paper-native-diagnostic', 'ci:paper-host-approval-native']);

export function matchesPath(pattern, file) {
  const expression = `^${pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\/\*\*\/?/g, '{{GLOBSTAR}}')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replaceAll('{{GLOBSTAR}}', '(?:/.*)?')}$`;
  return new RegExp(expression).test(file);
}

export function shouldRun(kind, { event, labels = [], files = [] }) {
  const globs = kind === 'computer-use' ? computerUseGlobs : kind === 'release-package' ? releasePackageGlobs : null;
  if (!globs) throw new Error(`Unknown workflow scope: ${kind}`);
  if (event === 'schedule' || event === 'workflow_dispatch' || event === 'push') return true;
  if (event !== 'pull_request') return false;
  const labelsThatRun = kind === 'computer-use' ? computerUseLabels : new Set(['ci:full']);
  if (labels.some(label => labelsThatRun.has(label))) return true;
  return files.some(file => globs.some(pattern => matchesPath(pattern, file)));
}

function main() {
  const kind = process.env.SCOPE_KIND || '';
  const labels = (process.env.SCOPE_LABELS || '').split(',').map(label => label.trim()).filter(Boolean);
  const files = readFileSync(0, 'utf8').split('\n').map(file => file.trim()).filter(Boolean);
  const run = shouldRun(kind, { event: process.env.SCOPE_EVENT || '', labels, files });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run=${run}\n`);
  console.log(`scope ${kind} ${process.env.SCOPE_EVENT} run=${run}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

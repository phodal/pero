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

const computerUseLabels = new Set(['ci:full', 'ci:paper-native-diagnostic', 'ci:paper-host-approval-native']);

const sharedAppInputs = [
  '.github/workflows/ci*.yml', 'scripts/ci/workflow-scope*.mjs', 'scripts/ci/gate.mjs',
  'package.json', 'package-lock.json', 'packages/app-sdk/**', 'packages/pero-design/**',
  'spec/pero-design/**', 'DESIGN.md', 'locales/**', 'scripts/build/**',
];
const notebookInputs = ['apps/notebook/**', 'packages/notebook/**', 'packages/mcp-apps/**', 'packages/source-extraction/**', 'tests/**/notebook*'];
const hostInputs = ['crates/pero-host/**', 'crates/pero-runtime/**', 'crates/pero-contracts/**', 'protocol/**', 'Cargo.toml', 'Cargo.lock'];
const scienceInputs = ['packages/scientific-runtime/**'];

// CI scope owns which expensive consumers a source change can affect. Ordinary
// contracts remain independent; these flags route browser/engine/Native checks.
export const ciScopeGlobs = Object.freeze(Object.fromEntries(Object.entries({
  notebook: notebookInputs,
  'notebook-canvas': [...notebookInputs, ...hostInputs, ...scienceInputs, 'apps/data/**',
    'apps/control-lab/**', 'apps/paper-agent/backend/**', 'tests/contracts/app-canvas.mjs'],
  'native-ui': [...hostInputs, 'crates/pero-ui/**', 'crates/pero-chat-ui/**', 'crates/pero-theme/**', 'patches/**'],
  'scientific-viewer': ['apps/scientific-viewer/**', 'apps/research-lab/**', 'tests/e2e/scientific-viewer*',
    'tests/e2e/research-lab*', 'tests/e2e/app-use-bridge.mjs'],
  lcms2yield: ['apps/lcms2yield/**', 'tests/e2e/lcms2yield*'],
  data: [...scienceInputs, 'apps/data/**', 'tests/e2e/data*'],
  lab: [...scienceInputs, 'apps/lab/**', 'tests/runtime/lab/**', 'tests/e2e/lab*'],
  'control-lab': [...scienceInputs, 'apps/control-lab/**', 'tests/runtime/control-lab/**', 'tests/e2e/control-lab*'],
  'virtual-cell': [...scienceInputs, 'apps/virtual-cell/**', 'tests/runtime/virtual-cell/**', 'tests/e2e/virtual-cell*'],
  'mcp-browser': [...notebookInputs, ...hostInputs, 'harness/go/mcp/**', 'harness/go/acp/**',
    'harness/go/providers/messages/**', 'harness/go/providers/openai/messages*.go',
    'tests/contracts/dsh-messages-files.mjs', 'tests/runtime/paper-study/**', 'tests/fixtures/research-source.py',
    'desktop/src/main/mcp-*.ts', 'web/src/mcp-*.ts', 'tests/contracts/mcp-*', 'tests/e2e/mcp-*', 'scripts/test/mcp-*.mjs'],
}).map(([name, globs]) => [name, Object.freeze([...sharedAppInputs, ...globs])])));

export function ciScope(input) {
  const flags = Object.fromEntries(Object.keys(ciScopeGlobs).map(name => [name, input.unknown || shouldRun(name, input)]));
  flags['notebook-python'] = flags['notebook-canvas'] || flags['mcp-browser'];
  return flags;
}

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
  const globs = ciScopeGlobs[kind] || (kind === 'computer-use' ? computerUseGlobs : kind === 'release-package' ? [] : null);
  if (!globs) throw new Error(`Unknown workflow scope: ${kind}`);
  if (event === 'schedule' || event === 'workflow_dispatch' || (event === 'push' && !ciScopeGlobs[kind])) return true;
  if (event !== 'pull_request' && event !== 'push') return false;
  const labelsThatRun = kind === 'computer-use' ? computerUseLabels : new Set(kind === 'release-package' ? ['ci:full', 'ci:package'] : ['ci:full']);
  if (labels.some(label => labelsThatRun.has(label))) return true;
  return files.some(file => globs.some(pattern => matchesPath(pattern, file)));
}

function main() {
  const kind = process.env.SCOPE_KIND || '';
  const labels = (process.env.SCOPE_LABELS || '').split(',').map(label => label.trim()).filter(Boolean);
  const files = readFileSync(0, 'utf8').split('\n').map(file => file.trim()).filter(Boolean);
  if (kind === 'ci') {
    const scopes = ciScope({ event: process.env.SCOPE_EVENT || '', labels, files, unknown: process.env.SCOPE_UNKNOWN === 'true' });
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `scopes=${JSON.stringify(scopes)}\n`);
    console.log(JSON.stringify(scopes));
    return;
  }
  const run = shouldRun(kind, { event: process.env.SCOPE_EVENT || '', labels, files });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run=${run}\n`);
  console.log(`scope ${kind} ${process.env.SCOPE_EVENT} run=${run}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

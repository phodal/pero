import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, realpathSync, readdirSync, readFileSync, unlinkSync, linkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, sep } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../..');
const APP_ENTRIES = ['app.json', 'dist', 'backend', 'examples', 'evidence', 'THIRD_PARTY_NOTICES.md', 'README.md', 'licenses'];
const PAPER_ENTRIES = [
  'tools/research.py', 'tools/locate-source.py', 'skills/research-resource-import/SKILL.md',
  'skills/research-resource-import/references/tex-source-locations.md',
  'skills/paper-code-audit/SKILL.md',
  'skills/paper-code-audit/references/audit-contract.md',
  'skills/paper-code-audit/references/other-cases.md',
  'skills/paper-code-audit/references/pcgym-table6.md',
  'skills/paper-reproduction/SKILL.md',
  'skills/paper-reproduction/references/reproduction-protocol.md',
  'skills/paper-plan/SKILL.md',
  'skills/paper-write/SKILL.md',
  'skills/paper-write/references/evidence-contract.md',
  'skills/paper-write/references/paper-types.md',
  'skills/paper-write/references/paper-agent-integration.md',
  'skills/paper-build/SKILL.md',
  'skills/paper-review/SKILL.md',
];

/** Equal assets share storage in the distribution while keeping their original URLs. */
export function deduplicatePayload(directory) {
  const files = new Map();
  function visit(path) {
    const stat = lstatSync(path);
    if (stat.isDirectory()) {
      for (const name of readdirSync(path)) visit(join(path, name));
    } else if (stat.isFile() && stat.size >= 16_384) {
      const key = `${stat.mode}:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
      const first = files.get(key);
      if (first) { unlinkSync(path); linkSync(first, path); }
      else files.set(key, path);
    }
  }
  visit(directory);
}

/** Resolve the bundled packages a fresh Host profile needs; no profile fallback. */
export function verifyBuiltinAppDependencies(directory, name) {
  const appManifest = join(directory, 'app.json');
  if (!lstatSync(directory, { throwIfNoEntry: false })?.isDirectory() ||
    !lstatSync(appManifest, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`${name} payload needs its own App directory and app.json`);
  }
  const root = realpathSync(directory);
  const manifest = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'));
  const dependencies = manifest.requiresAgentPlugins === undefined ? [] : manifest.requiresAgentPlugins;
  if (!Array.isArray(dependencies) || !dependencies.every(value =>
    typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))) {
    throw new Error(`${name} payload has invalid requiresAgentPlugins`);
  }
  return dependencies.map(dependency => {
    const entry = `agent-plugins/${dependency}`;
    const packageRoot = join(root, entry);
    const requiredFile = path => {
      const file = resolve(packageRoot, path);
      if (!file.startsWith(packageRoot + sep) || !lstatSync(file, { throwIfNoEntry: false })?.isFile() ||
        realpathSync(file) !== file) {
        throw new Error(`${name} payload requires a regular file inside its Agent Plugin ${dependency}: ${path}`);
      }
      return file;
    };
    const plugin = JSON.parse(readFileSync(requiredFile('plugin.json'), 'utf8'));
    if (plugin.schemaVersion !== 1 || plugin.name !== dependency) {
      throw new Error(`${name} payload Agent Plugin ${dependency} needs a matching v1 plugin.json`);
    }
    for (const skill of plugin.skills ?? []) requiredFile(skill);
    for (const server of plugin.mcpServers ?? []) {
      const prefix = '{pluginRoot}/';
      if (server.command?.startsWith(prefix)) requiredFile(server.command.slice(prefix.length));
    }
    return entry;
  });
}

/** Builtin distribution payload, shared by Workbench and standalone Products. */
export function stageBuiltinApp(source, name, destination) {
  const root = realpathSync(source);
  const extra = name === 'paper-agent' ? PAPER_ENTRIES
    : name === 'scientific-viewer' ? ['skills/molecular-report/SKILL.md'] : [];
  // Each App's advertised installed CLI/skill must ship together. Do not include an
  // arbitrary tools or skills tree, or follow an extra entry outside the App.
  for (const entry of extra) {
    const path = resolve(root, entry);
    if (!existsSync(path) || !lstatSync(path).isFile() || !realpathSync(path).startsWith(root + sep)) {
      throw new Error(`${name} payload requires a regular file inside its App: ${entry}`);
    }
  }
  const plugins = verifyBuiltinAppDependencies(root, name);
  for (const entry of [...APP_ENTRIES, ...extra, ...plugins]) {
    const path = resolve(root, entry);
    if (existsSync(path)) cpSync(path, join(destination, entry), { recursive: true, filter: path => !path.includes('__pycache__') });
  }
  // Customize reads this file beside the app. It is not embedded in the Host binary.
  if (name === 'skills' || name === 'connectors') {
    mkdirSync(destination, { recursive: true });
    execFileSync(process.env.PYTHON || 'python3', [
      resolve(repoRoot, 'scripts/research-skills/publish.py'),
      '--output', join(destination, 'market-catalog.json'),
    ], { stdio: 'pipe' });
  }
}

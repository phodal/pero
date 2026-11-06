import { cpSync, existsSync, lstatSync, realpathSync, readdirSync, readFileSync, unlinkSync, linkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, sep } from 'node:path';

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
  for (const entry of [...APP_ENTRIES, ...extra]) {
    const path = resolve(root, entry);
    if (existsSync(path)) cpSync(path, join(destination, entry), { recursive: true, filter: path => !path.includes('__pycache__') });
  }
}

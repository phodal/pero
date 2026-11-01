import { cpSync, existsSync, lstatSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const APP_ENTRIES = ['app.json', 'dist', 'backend', 'examples', 'evidence', 'THIRD_PARTY_NOTICES.md', 'README.md', 'licenses'];
const PAPER_ENTRIES = [
  'tools/research.py', 'skills/research-resource-import/SKILL.md',
  'skills/paper-code-audit/SKILL.md',
  'skills/paper-code-audit/references/audit-contract.md',
  'skills/paper-code-audit/references/other-cases.md',
  'skills/paper-code-audit/references/pcgym-table6.md',
];

/** Builtin distribution payload, shared by Workbench and standalone Products. */
export function stageBuiltinApp(source, name, destination) {
  const root = realpathSync(source);
  const extra = name === 'paper-agent' ? PAPER_ENTRIES : [];
  // Paper's advertised installed CLI/skill must ship together. Do not include an
  // arbitrary tools or skills tree, or follow an extra entry outside the App.
  for (const entry of extra) {
    const path = resolve(root, entry);
    if (!existsSync(path) || !lstatSync(path).isFile() || !realpathSync(path).startsWith(root + sep)) {
      throw new Error(`Paper payload requires a regular file inside its App: ${entry}`);
    }
  }
  for (const entry of [...APP_ENTRIES, ...extra]) {
    const path = resolve(root, entry);
    if (existsSync(path)) cpSync(path, join(destination, entry), { recursive: true, filter: path => !path.includes('__pycache__') });
  }
}

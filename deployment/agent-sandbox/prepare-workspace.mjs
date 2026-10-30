// Export an exact tracked Git snapshot, not local edits/untracked files or .git credentials.
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const [repository, revision, destination] = process.argv.slice(2);
if (!repository || !/^[a-f0-9]{40}$/.test(revision || '') || !destination || process.argv.length !== 5) throw new Error('Usage: node prepare-workspace.mjs repository full-commit new-workspace-directory');
const root = resolve(repository), out = resolve(destination);
const commit = execFileSync('git', ['-C', root, 'rev-parse', `${revision}^{commit}`], { encoding: 'utf8' }).trim();
if (commit !== revision) throw new Error('Expected exact reviewed commit');
const tree = execFileSync('git', ['-C', root, 'ls-tree', '-r', revision], { encoding: 'utf8' });
if (/\t\.pero-workspace-revision$/m.test(tree)) throw new Error('Prepared revision marker is reserved');
if (/^160000 /m.test(tree)) throw new Error('Submodule content must be prepared and reviewed separately');
await mkdir(out, { recursive: false, mode: 0o700 });
const archive = execFileSync('git', ['-C', root, 'archive', '--format=tar', revision], { maxBuffer: 128 * 1024 * 1024 });
execFileSync('tar', ['-x', '-f', '-', '-C', out, '--no-same-owner'], { input: archive });
await writeFile(join(out, '.pero-workspace-revision'), `${revision}\n`, { mode: 0o444 });
process.stdout.write(`${revision}\n`);

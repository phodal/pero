// Only same-revision Linux runtime outputs cross the build/acceptance boundary.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(import.meta.dirname, '../..');
export function runtimePaths(directory) {
  const product = JSON.parse(readFileSync(resolve(directory, 'products/pero.json'), 'utf8'));
  return ['desktop/dist', 'web/dist', ...product.apps.map(name => `apps/${name}/dist`),
    ...['pero-host', 'pero-worker', 'pero-agent-acp', 'pero-computer', 'pero-connector-worker', 'computer-source.json'].map(name => `target/debug/${name}`),
    'packages/connectors/helpers', 'packages/point-app/dist'];
}
function files(directory, path) {
  const full = resolve(directory, path);
  const stat = statSync(full);
  return stat.isDirectory() ? readdirSync(full).sort().flatMap(name => files(directory, `${path}/${name}`)) : [path];
}
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
export function pack(directory, archive, revision) {
  if (!/^[a-f0-9]{40}$/.test(revision || '')) throw new Error('Expected exact checkout revision');
  const paths = runtimePaths(directory);
  const entries = paths.flatMap(path => files(directory, path)).map(path => ({ path, sha256: digest(resolve(directory, path)) }));
  mkdirSync(resolve(directory, 'target'), { recursive: true });
  writeFileSync(resolve(directory, 'target/ci-runtime.json'), JSON.stringify({ revision, platform: 'linux', architecture: 'x64', entries }));
  execFileSync('tar', ['-czf', archive, ...paths, 'target/ci-runtime.json'], { cwd: directory, stdio: 'inherit' });
}
export function unpack(directory, archive, revision) {
  const manifest = JSON.parse(execFileSync('tar', ['-xOf', archive, 'target/ci-runtime.json'], { encoding: 'utf8' }));
  if (manifest.revision !== revision || manifest.platform !== process.platform || manifest.architecture !== process.arch)
    throw new Error('Acceptance runtime revision or platform mismatch');
  const paths = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
  if (paths.some(path => path.startsWith('/') || path.split('/').includes('..'))) throw new Error('Unsafe runtime artifact path');
  execFileSync('tar', ['-xzf', archive], { cwd: directory, stdio: 'inherit' });
  for (const entry of manifest.entries) {
    if (relative(directory, resolve(directory, entry.path)).startsWith('..') || digest(resolve(directory, entry.path)) !== entry.sha256)
      throw new Error(`Runtime checksum mismatch: ${entry.path}`);
  }
  console.log(`Verified ${manifest.entries.length} runtime files from ${revision}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, archive] = process.argv.slice(2);
  if (!archive || !['pack', 'unpack'].includes(action)) throw new Error('Expected pack|unpack archive');
  ({ pack, unpack })[action](root, resolve(archive), process.env.GITHUB_SHA);
}

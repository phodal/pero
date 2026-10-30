import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const source = JSON.parse(readFileSync(resolve(root, 'use/computer/SOURCE.json'), 'utf8'));
const destination = resolve(root, 'target/point-computer-source');
const stamp = resolve(destination, '.pero-source-revision');
mkdirSync(destination, { recursive: true });
if (!existsSync(stamp)) {
  let checkout = process.env.PERO_POINT_SOURCE;
  if (!checkout) {
    checkout = resolve(root, 'target/point-computer-checkout');
    mkdirSync(checkout, { recursive: true });
    execFileSync('git', ['init', '--quiet', checkout]);
    execFileSync('git', ['-C', checkout, 'fetch', '--depth=1', source.repository, source.revision], { stdio: 'inherit' });
  }
  const revision = execFileSync('git', ['-C', checkout, 'rev-parse', `${source.revision}^{commit}`], { encoding: 'utf8' }).trim();
  if (revision !== source.revision) throw new Error('The Computer Use source revision does not match SOURCE.json');
  const archive = execFileSync('git', ['-C', checkout, 'archive', source.revision, source.subdirectory], { maxBuffer: 32 * 1024 * 1024 });
  execFileSync('tar', ['-xf', '-', '-C', destination], { input: archive });
  writeFileSync(stamp, revision + '\n');
}
if (readFileSync(stamp, 'utf8').trim() !== source.revision) throw new Error('Remove the old target/point-computer-source cache before changing the pinned native source');
// Cargo otherwise adopts path dependencies under Pero's root workspace. Keep
// the upstream workspace explicit; this changes build ownership only.
for (const crate of readdirSync(resolve(destination, 'computer/crates'))) {
  const manifest = resolve(destination, 'computer/crates', crate, 'Cargo.toml');
  if (!existsSync(manifest)) continue;
  const content = readFileSync(manifest, 'utf8');
  if (!content.includes('workspace = "../.."')) writeFileSync(manifest, content.replace('[package]\n', '[package]\nworkspace = "../.."\n'));
}
const release = process.argv.includes('--release');
const test = process.argv.includes('--test');
const profile = release ? 'release' : 'debug';
const manifest = resolve(root, 'use/computer/Cargo.toml');
const env = { ...process.env, CARGO_TARGET_DIR: resolve(root, 'target/computer') };
execFileSync('cargo', [test ? 'test' : 'build', '--manifest-path', manifest, '--locked', ...(release ? ['--release'] : [])], { stdio: 'inherit', env });
if (!test) {
  const binary = process.platform === 'win32' ? 'pero-computer.exe' : 'pero-computer';
  mkdirSync(resolve(root, 'target', profile), { recursive: true });
  cpSync(resolve(env.CARGO_TARGET_DIR, profile, binary), resolve(root, 'target', profile, binary));
  cpSync(resolve(root, 'use/computer/SOURCE.json'), resolve(root, 'target', profile, 'computer-source.json'));
  console.log(`Computer Use driver built from Point ${source.revision.slice(0, 9)} (${profile}).`);
}

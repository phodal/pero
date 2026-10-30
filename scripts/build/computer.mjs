import { mkdirSync, readFileSync, cpSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const source = JSON.parse(readFileSync(resolve(root, 'use/computer/SOURCE.json'), 'utf8'));
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
  console.log(`Computer Use driver built from vendored Point ${source.revision.slice(0, 9)} (${profile}).`);
}

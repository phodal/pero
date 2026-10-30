import { mkdirSync, cpSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const release = process.argv.includes('--release');
const test = process.argv.includes('--test');
const profile = release ? 'release' : 'debug';
const manifest = resolve(root, 'use/computer/Cargo.toml');
const env = { ...process.env, CARGO_TARGET_DIR: resolve(root, 'target/computer') };
execFileSync('cargo', [test ? 'test' : 'build', '--manifest-path', manifest, '--locked', ...(test ? ['--workspace'] : []), ...(release ? ['--release'] : [])], { stdio: 'inherit', env });
if (test) execFileSync('cargo', ['test', '--manifest-path', manifest, '--locked', '-p', 'pero-contracts', 'computer_use'], { stdio: 'inherit', env });
if (!test) {
  const binary = process.platform === 'win32' ? 'pero-computer.exe' : 'pero-computer';
  mkdirSync(resolve(root, 'target', profile), { recursive: true });
  cpSync(resolve(env.CARGO_TARGET_DIR, profile, binary), resolve(root, 'target', profile, binary));
  cpSync(resolve(root, 'use/computer/SOURCE.json'), resolve(root, 'target', profile, 'computer-source.json'));
  console.log(`Computer Use ${process.platform} driver built from local source (${profile}); backend provenance is in computer-source.json.`);
}

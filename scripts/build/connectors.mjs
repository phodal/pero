// Pero-owned build inputs; no sibling Point checkout or prebuilt driver.
import { build } from 'esbuild';
import { mkdirSync, cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const release = process.argv.includes('--release');
const test = process.argv.includes('--test');
const profile = release ? 'release' : 'debug';
const source = resolve(root, 'packages/connectors');
if (!existsSync(resolve(source, 'node_modules/fflate/package.json'))) {
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--prefix', source, '--ignore-scripts'], { stdio: 'inherit' });
}
execFileSync('cargo', [test ? 'test' : 'build', '--locked', '--manifest-path', resolve(root, 'use/connectors/worker/Cargo.toml'), ...(release ? ['--release'] : [])], { stdio: 'inherit' });
if (!test) {
  const binary = `pero-connector-worker${process.platform === 'win32' ? '.exe' : ''}`;
  mkdirSync(resolve(root, 'target', profile), { recursive: true });
  cpSync(resolve(root, 'use/connectors/worker/target', profile, binary), resolve(root, 'target', profile, binary));
  for (const [name, entry] of [['point-feishu-workspace', 'feishu-workspace/server'], ['point-science-connector', 'science/launcher']]) {
    await build({ entryPoints: [resolve(source, `src/connectors/${entry}.mjs`)], outfile: resolve(source, `helpers/${name}.mjs`),
      bundle: true, format: 'esm', platform: 'node',
      banner: { js: 'import { createRequire as __peroRequire } from "node:module"; const require = __peroRequire(import.meta.url);' } });
  }
  console.log(`Connectors driver and pinned helpers built from Pero source (${profile}).`);
}

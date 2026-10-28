import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const appName = args.includes('--app') ? args[args.indexOf('--app') + 1] : 'virtual-cell';
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appName)) throw new Error('Invalid App name');
const appRoot = resolve(root, 'apps', appName);
// Each App has a frozen dependency tree, separate from Desktop's runtime.
if (!existsSync(resolve(appRoot, 'node_modules/react/package.json'))) {
  const installed = spawnSync(process.platform === 'win32' ? process.execPath : 'npm', [...(process.platform === 'win32' ? [process.env.npm_execpath] : []), 'ci', '--prefix', appRoot], { stdio: 'inherit' });
  if (installed.error) throw installed.error;
  if (installed.status !== 0) throw new Error('Virtual Cell dependencies could not be installed');
}
const sdk = resolve(root, 'packages/app-sdk/src');
const outdir = resolve(appRoot, 'dist');
await mkdir(outdir, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: [resolve(appRoot, 'ui-src/frame.tsx')],
  outfile: resolve(outdir, 'index.js'), bundle: true, format: 'esm', platform: 'browser',
  minify: true, target: 'chrome140', jsx: 'automatic',
  nodePaths: [resolve(appRoot, 'node_modules')],
  alias: { '@pero/app-sdk/ui': resolve(sdk, 'ui.tsx'), '@pero/app-sdk/chart': resolve(sdk, 'chart.ts'), '@pero/app-sdk': resolve(sdk, 'index.tsx') },
  plugins: [{ name: 'app-scoped-css', setup(builder) {
    builder.onLoad({ filter: /virtual-cell[\\/]ui-src[\\/]styles\.css$/ }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' }));
  } }],
});
await writeFile(resolve(outdir, 'index.html'), '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Virtual Cell</title><link rel="stylesheet" href="./index.css"></head><body><div id="app"></div><script type="module" src="./index.js"></script></body></html>\n');
console.log(`Built App: apps/${appName}/dist/index.html`);

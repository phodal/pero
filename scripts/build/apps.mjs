import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { buildReader } from './reader.mjs';

const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const appNames = args.includes('--app') ? [args[args.indexOf('--app') + 1]] : JSON.parse(await readFile(resolve(root, 'products/pero.json'), 'utf8')).apps;
const readerDirectory = args.includes('--reader-dist') ? resolve(args[args.indexOf('--reader-dist') + 1]) : resolve(root, 'web/dist-reader');
if (!args.includes('--reader-dist')) await buildReader();
for (const appName of appNames) {
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appName)) throw new Error('Invalid App name');
const appRoot = resolve(root, 'apps', appName);
// Each App has a frozen dependency tree, separate from Desktop's runtime.
if (!existsSync(resolve(appRoot, 'node_modules/react/package.json'))) {
  const installed = spawnSync(process.platform === 'win32' ? process.execPath : 'npm', [...(process.platform === 'win32' ? [process.env.npm_execpath] : []), 'ci', '--prefix', appRoot], { stdio: 'inherit' });
  if (installed.error) throw installed.error;
  if (installed.status !== 0) throw new Error(`App ${appName} dependencies could not be installed`);
}
if (appName === 'data-agent') {
  await mkdir(resolve(appRoot, 'backend/_core'), { recursive: true });
  for (const name of ['dataset.py', 'view.py', 'chart_document.py'])
    await cp(resolve(root, 'harness/go/charts/python', name), resolve(appRoot, 'backend/_core', name));
}
const sdk = resolve(root, 'packages/app-sdk/src');
const outdir = resolve(appRoot, 'dist');
await mkdir(outdir, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: [resolve(appRoot, 'ui-src/frame.tsx')],
  outfile: resolve(outdir, 'index.js'), bundle: true, format: 'esm', platform: 'browser',
  loader: { '.png': 'dataurl', '.svg': 'dataurl', '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.wasm': 'file' },
  minify: true, target: 'chrome140', jsx: 'automatic',
  nodePaths: [resolve(appRoot, 'node_modules')],
  alias: { '@pero/app-sdk/ui': resolve(sdk, 'ui.tsx'), '@pero/app-sdk/chart': resolve(sdk, 'chart.ts'), '@pero/app-sdk': resolve(sdk, 'index.tsx') },
  plugins: [{ name: 'app-scoped-css', setup(builder) {
    builder.onLoad({ filter: /virtual-cell[\\/]ui-src[\\/]styles\.css$/ }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' }));
  } }],
});
const manifest = JSON.parse(await readFile(resolve(appRoot, 'app.json'), 'utf8'));
const title = manifest.displayName.replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
await writeFile(resolve(outdir, 'index.html'), `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="./index.css"></head><body><div id="app"></div><script type="module" src="./index.js"></script></body></html>\n`);
await rm(resolve(outdir, '_reader'), { recursive: true, force: true });
await cp(readerDirectory, resolve(outdir, '_reader'), { recursive: true, filter: path => !/[\\/]fonts(?:[\\/]|$)/.test(path) });
console.log(`Built App: apps/${appName}/dist/index.html`);
}

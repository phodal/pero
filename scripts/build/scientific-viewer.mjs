import { appSdkAliases } from './app-sdk.mjs';
// Repository-owned App, built only from pinned public dependencies.
import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(import.meta.dirname, '../..');
// MathJax's lazy TeX loader uses CommonJS globals even in its browser entry.
// Match browser bundlers without exposing Node globals to the App frame.
export const scientificViewerBrowserDefines = { global: 'globalThis', __dirname: '""' };
export async function buildScientificViewer({ outdir = resolve(root, 'apps/scientific-viewer/dist') } = {}) {
  const app = resolve(root, 'apps/scientific-viewer'), dist = outdir, modules = resolve(app, 'node_modules');
  if (!['react', 'react-dom', 'molstar', 'pdfjs-dist', 'fflate', 'three', '@datalayer/jupyter-react', 'react-markdown', 'remark-gfm'].every(name => existsSync(resolve(modules, name, 'package.json')))) {
    const windows = process.platform === 'win32';
    if (windows && !process.env.npm_execpath) throw new Error('Run the build through npm on Windows');
    execFileSync(windows ? process.execPath : 'npm', [...(windows ? [process.env.npm_execpath] : []), 'ci', '--prefix', app, '--ignore-scripts'], { stdio: 'inherit' });
  }
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  // JupyterLab icons import SVG as source text; raster assets stay as data URLs.
  // Webpack-style `~pkg/...` CSS imports are rewritten to package paths under node_modules.
  const jupyterAssetPlugin = {
    name: 'jupyter-asset-resolve',
    setup(build) {
      build.onResolve({ filter: /^~/ }, args => ({ path: resolve(modules, args.path.slice(1)) }));
    },
  };
  await build({ entryPoints: { index: resolve(app, 'ui-src/frame.tsx'), artifact: resolve(app, 'ui-src/artifact-frame.tsx') }, outdir: dist, splitting: true, bundle: true, format: 'esm', platform: 'browser', target: 'chrome140', jsx: 'automatic', minify: true,
    define: scientificViewerBrowserDefines,
    alias: { react: resolve(modules, 'react'), 'react-dom': resolve(modules, 'react-dom'), ...appSdkAliases(root) }, nodePaths: [modules], plugins: [jupyterAssetPlugin],
    loader: { '.gb': 'text', '.wasm': 'file', '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.svg': 'text', '.png': 'dataurl', '.gif': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl' } });
  for (const [source, target] of [
    ['molstar/build/viewer/molstar.css', 'molstar.css'],
    ['pdfjs-dist/build/pdf.worker.mjs', 'pdf.worker.mjs'], ['pdfjs-dist/standard_fonts', 'pdfjs-fonts'], ['pdfjs-dist/cmaps', 'pdfjs-cmaps'], ['pdfjs-dist/wasm', 'pdfjs-wasm'],
  ]) await cp(resolve(modules, source), resolve(dist, target), { recursive: true });
  await cp(resolve(app, 'assets/research-lab'), resolve(dist, 'research-lab'), { recursive: true });
  await mkdir(resolve(dist, 'licenses'), { recursive: true });
  for (const name of ['molstar', 'pdfjs-dist', 'fflate', 'three']) await cp(resolve(modules, name, 'LICENSE'), resolve(dist, 'licenses', `${name}.txt`));
  await cp(resolve(modules, '@datalayer/jupyter-react/LICENSE'), resolve(dist, 'licenses/jupyter-react.txt'));
  for (const name of ['react-markdown', 'remark-gfm']) await cp(resolve(modules, name, 'license'), resolve(dist, 'licenses', `${name}.txt`));
  await cp(resolve(app, 'licenses/RDKit.txt'), resolve(dist, 'licenses/RDKit.txt'));
  const licenses = [];
  for (const name of ['molstar', 'pdfjs-dist', 'fflate', 'three', '@datalayer/jupyter-react', 'react-markdown', 'remark-gfm']) {
    const pkg = JSON.parse(await readFile(resolve(modules, name, 'package.json'), 'utf8'));
    licenses.push({ name: name === '@datalayer/jupyter-react' ? 'jupyter-react' : name, version: pkg.version, license: pkg.license });
  }
  licenses.push({ name: 'rdkit', version: '2026.9.1', license: 'BSD-3-Clause', runtime: 'Host Python backend' });
  await writeFile(resolve(dist, 'public-engines.json'), JSON.stringify(licenses, null, 2));
  await writeFile(resolve(dist, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scientific Viewer</title><link rel="stylesheet" href="./molstar.css"><link rel="stylesheet" href="./index.css"></head><body><div id="app"></div><script type="module" src="./index.js"></script></body></html>`);
  await writeFile(resolve(dist, 'artifact.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conversation artifact</title><link rel="stylesheet" href="./artifact.css"></head><body><div id="app"></div><script type="module" src="./artifact.js"></script></body></html>`);
  console.log('Built independent Pero Scientific Viewer from pinned public engines.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildScientificViewer();

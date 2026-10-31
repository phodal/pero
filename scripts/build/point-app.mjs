import { build } from 'esbuild';
import { cp, mkdir, readFile, readdir, writeFile, lstat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pointAppManifest } from '../../packages/point-app/manifest.mjs';

const root = resolve(import.meta.dirname, '../..');

/** Package an existing Point bundle without rewriting or evaluating App code. */
export async function buildPointApp({ pointRoot, source, destination }) {
  pointRoot = resolve(pointRoot); source = resolve(source); destination = resolve(destination);
  if (destination === source || destination.startsWith(source + sep) || source.startsWith(destination + sep))
    throw new Error('Point source and output must be separate directories');
  const app = JSON.parse(await readFile(resolve(source, 'app.json'), 'utf8'));
  const manifest = pointAppManifest(app);
  const sdk = resolve(pointRoot, 'packages/app-platform/app-sdk');
  const require = createRequire(resolve(sdk, 'package.json'));
  const runtime = resolve(require.resolve('react/package.json'), '..');
  const reactDOM = resolve(require.resolve('react-dom/package.json'), '..');
  await lstat(resolve(source, 'ui', app.contributes.panelTabs[0].entry));
  // Refuse overwrites: output is an immutable, reviewable install input.
  await mkdir(destination);
  const files = [];
  async function copyTree(from, to) {
    const info = await lstat(from);
    if (info.isSymbolicLink()) throw new Error(`Point package symlinks are unsupported: ${from}`);
    if (info.isDirectory()) {
      await mkdir(to, { recursive: true });
      for (const name of await readdir(from)) {
        if (['node_modules', '__pycache__', '.git'].includes(name)) continue;
        await copyTree(resolve(from, name), resolve(to, name));
      }
    } else if (info.isFile()) {
      await mkdir(dirname(to), { recursive: true });
      await cp(from, to);
      files.push({ path: relative(destination, to).split(sep).join('/'), sha256: createHash('sha256').update(await readFile(from)).digest('hex') });
    } else throw new Error(`Unsupported Point package file: ${from}`);
  }
  await copyTree(resolve(source, 'ui'), resolve(destination, 'dist/point-ui'));
  if (app.backend) {
    const names = await readdir(source);
    // Point Python Apps resolve domain inputs relative to their package root.
    for (const name of ['backend', 'examples', 'evidence', 'assets'])
      if (names.includes(name)) await copyTree(resolve(source, name), resolve(destination, 'point-source', name));
    await copyTree(resolve(source, 'app.json'), resolve(destination, 'point-source/app.json'));
    await copyTree(resolve(root, 'packages/point-app/backend.py'), resolve(destination, 'point-backend.py'));
  }
  for (const name of ['NOTICE.md', 'LICENSE-KIROCREW'])
    await copyTree(resolve(sdk, name), resolve(destination, 'licenses/point-sdk', name));
  const template = await readFile(resolve(root, 'packages/point-app/frame.tsx'), 'utf8');
  const built = await build({
    stdin: { contents: template.replace("'./point-ui/' + app.contributes.panelTabs[0].entry", JSON.stringify('./point-ui/' + app.contributes.panelTabs[0].entry)), resolveDir: root, sourcefile: 'point-frame.tsx', loader: 'tsx' },
    outfile: resolve(destination, 'dist/frame.js'), bundle: true, format: 'esm', platform: 'browser', target: 'chrome140',
    minify: true, metafile: true, external: ['./point-ui/*'],
    alias: {
      'point-sdk-client': resolve(sdk, 'src/client.tsx'), 'point-sdk': resolve(sdk, 'src/index.tsx'),
      'point-tokens': resolve(sdk, 'src/tokens/tokens.css'),
      'react-dom': reactDOM, react: runtime,
    },
    loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file' },
    plugins: [{ name: 'point-manifest', setup(builder) {
      builder.onResolve({ filter: /^point-manifest$/ }, () => ({ path: 'manifest', namespace: 'point' }));
      builder.onLoad({ filter: /.*/, namespace: 'point' }, () => ({ contents: JSON.stringify(app), loader: 'json' }));
    } }],
  });
  await writeFile(resolve(destination, 'dist/index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="./frame.css"><style>html,body,#app{margin:0;min-height:100%;background:var(--point-bg);color:var(--point-text);font:14px system-ui}*{box-sizing:border-box}</style></head><body><div id="app"></div><script type="module" src="./frame.js"></script></body></html>');
  await writeFile(resolve(destination, 'app.json'), JSON.stringify(manifest, null, 2) + '\n');
  const revision = directory => execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const sourceHash = createHash('sha256');
  for (const path of Object.keys(built.metafile.inputs).sort()) {
    sourceHash.update(path);
    sourceHash.update(path === 'point-frame.tsx' ? template : path === 'point:manifest' ? JSON.stringify(app) : await readFile(resolve(root, path)));
  }
  const receipt = { buildInputsSha256: sourceHash.digest('hex'), schema: 'pero.point-app-build.v1', app: app.name, pointRevision: revision(pointRoot), peroRevision: revision(root), files, limits: ['One panel', 'Own backend only; no Point Host APIs, events, App Use or Agent tools', 'Python stdlib ThreadingHTTPServer backend only'] };
  await writeFile(resolve(destination, 'point-build.json'), JSON.stringify(receipt, null, 2) + '\n');
  return { directory: destination, manifest, receipt };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = name => { const index = args.indexOf(name); if (index < 0 || !args[index + 1]) throw new Error(`Required: ${name}`); return args[index + 1]; };
  const result = await buildPointApp({ pointRoot: option('--point-root'), source: option('--source'), destination: option('--out') });
  console.log(JSON.stringify({ directory: result.directory, app: result.manifest.name, pointRevision: result.receipt.pointRevision }));
}

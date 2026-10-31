import { cp, mkdir, readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import { resolve, dirname, sep, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { pointAppManifest } from './manifest.mjs';

/** The install adapter prepares files; Rust still installs and owns the App. */
export async function preparePointApp({ source, destination, runtime }) {
  source = resolve(source); destination = resolve(destination); runtime = resolve(runtime);
  if (destination === source || destination.startsWith(source + sep) || source.startsWith(destination + sep)) throw new Error('Point source and output must be separate');
  const app = JSON.parse(await readFile(resolve(source, 'app.json'), 'utf8'));
  const manifest = pointAppManifest(app);
  for (const panel of app.contributes.panelTabs) {
    const file = await lstat(resolve(source, 'ui', panel.entry));
    if (!file.isFile()) throw new Error('Point panel entry must be a regular file');
    const code = await readFile(resolve(source, 'ui', panel.entry), 'utf8');
    const shared = new Set(['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@point/app-sdk', '@point/app-sdk/ui', '@point/app-sdk/chart']);
    for (const match of code.matchAll(/globalThis\.__point_modules\?\.\["([^"]+)"\]/g))
      if (!shared.has(match[1])) throw new Error(`Unsupported Point shared module: ${match[1]}`);
  }
  await mkdir(destination);
  const files = [];
  async function copy(from, to) {
    const info = await lstat(from);
    if (info.isSymbolicLink()) throw new Error(`Point App symlinks are unsupported: ${from}`);
    if (info.isDirectory()) {
      await mkdir(to, { recursive: true });
      for (const name of await readdir(from)) {
        if (['node_modules', '.git', '__pycache__', '.cache', '__pypackages__', '.venv', '.DS_Store'].includes(name) || from === source && ['data', 'installed.json'].includes(name)) continue;
        await copy(resolve(from, name), resolve(to, name));
      }
    } else if (info.isFile()) {
      await mkdir(dirname(to), { recursive: true }); await cp(from, to);
      files.push({ path: relative(destination, to).split(sep).join('/'), sha256: createHash('sha256').update(await readFile(from)).digest('hex') });
    } else throw new Error(`Unsupported Point package file: ${from}`);
  }
  await copy(source, resolve(destination, 'point-source'));
  await copy(resolve(source, 'ui'), resolve(destination, 'dist/point-ui'));
  for (const name of ['frame.js', 'frame.css', 'runtime.json', 'licenses']) await copy(resolve(runtime, name), resolve(destination, 'dist', name));
  if (app.backend) await copy(resolve(runtime, app.backend.type === 'python' ? 'backend.py' : 'backend-node.mjs'), resolve(destination, app.backend.type === 'python' ? 'point-backend.py' : 'point-backend.mjs'));
  await writeFile(resolve(destination, 'dist/point-manifest.json'), JSON.stringify(app));
  for (const panel of manifest.contributes.panels) {
    await writeFile(resolve(destination, panel.entry), `<!doctype html><html data-point-panel="${panel.id}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="./frame.css"><style>html,body,#app{margin:0;min-height:100%;background:var(--point-bg);color:var(--point-text);font:14px system-ui}*{box-sizing:border-box}</style></head><body><div id="app"></div><script type="module" src="./frame.js"></script></body></html>`);
  }
  await writeFile(resolve(destination, 'app.json'), JSON.stringify(manifest, null, 2));
  const receipt = { schema: 'pero.point-app-build.v2', app: app.name, runtime: JSON.parse(await readFile(resolve(runtime, 'runtime.json'), 'utf8')), files };
  await writeFile(resolve(destination, 'point-build.json'), JSON.stringify(receipt, null, 2));
  return { directory: destination, manifest, receipt };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const option = name => { const i = process.argv.indexOf(name); if (i < 0 || !process.argv[i + 1]) throw new Error(`Required: ${name}`); return process.argv[i + 1]; };
  const result = await preparePointApp({ source: option('--source'), destination: option('--out'), runtime: import.meta.dirname });
  console.log(JSON.stringify({ name: result.manifest.name }));
}

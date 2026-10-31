import { build } from 'esbuild';
import { buildPointHost } from './point-host.mjs';
import { cp, mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { preparePointApp } from '../../packages/point-app/install.mjs';
const root = resolve(import.meta.dirname, '../..');

/** One host runtime, built from the actual Point SDK. Install never compiles it. */
export async function buildPointRuntime({ pointRoot, destination }) {
  pointRoot = resolve(pointRoot); destination = resolve(destination);
  const sdk = resolve(pointRoot, 'packages/app-platform/app-sdk');
  const require = createRequire(resolve(sdk, 'package.json'));
  await mkdir(destination, { recursive: true });
  const built = await build({
    entryPoints: [resolve(root, 'packages/point-app/frame.tsx')], outfile: resolve(destination, 'frame.js'),
    bundle: true, format: 'esm', platform: 'browser', target: 'chrome140', minify: true, metafile: true,
    external: ['./point-ui/*'], loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file' },
    alias: { 'point-sdk-client': resolve(sdk, 'src/client.tsx'), 'point-sdk': resolve(sdk, 'src/index.tsx'), 'point-sdk-ui': resolve(sdk,'src/components/index.ts'),
      'point-tokens': resolve(sdk, 'src/tokens/tokens.css'),
      'react-dom': resolve(require.resolve('react-dom/package.json'), '..'), react: resolve(require.resolve('react/package.json'), '..') },
  });
  await build({ entryPoints: [resolve(root, 'packages/point-app/install.mjs')], outfile: resolve(destination, 'install.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24' });
  for (const name of ['backend.py', 'backend-node.mjs']) await cp(resolve(root, 'packages/point-app', name), resolve(destination, name));
  await mkdir(resolve(destination, 'licenses'), { recursive: true });
  for (const name of ['NOTICE.md', 'LICENSE-KIROCREW']) await cp(resolve(sdk, name), resolve(destination, 'licenses', name));
  const hash = createHash('sha256');
  for (const path of Object.keys(built.metafile.inputs).sort()) { hash.update(path); hash.update(await readFile(resolve(root, path))); }
  const pointRevision = execFileSync('git', ['-C', pointRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await buildPointHost({ pointRoot, destination });
  const pointHostSha256 = createHash('sha256').update(await readFile(resolve(destination, process.platform === 'win32' ? 'point-host.exe' : 'point-host'))).digest('hex');
  await writeFile(resolve(destination, 'runtime.json'), JSON.stringify({ schema: 'pero.point-app-runtime.v1', pointRevision, pointHostSha256, buildInputsSha256: hash.digest('hex') }, null, 2));
  return destination;
}
export async function buildPointApp({ pointRoot, source, destination }) {
  const runtime = await mkdtemp(resolve(tmpdir(), 'pero-point-runtime-'));
  try { await buildPointRuntime({ pointRoot, destination: runtime }); return await preparePointApp({ source, destination, runtime }); }
  finally { await rm(runtime, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const option = name => { const i = process.argv.indexOf(name); if (i < 0 || !process.argv[i + 1]) throw new Error(`Required: ${name}`); return process.argv[i + 1]; };
  if (process.argv.includes('--runtime')) await buildPointRuntime({ pointRoot: option('--point-root'), destination: option('--out') });
  else console.log(JSON.stringify(await buildPointApp({ pointRoot: option('--point-root'), source: option('--source'), destination: option('--out') })));
}

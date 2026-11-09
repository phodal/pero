import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { appSdkAliases } from './app-sdk.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
/** Package only reviewed Pero-owned implementations. Never walk a source tree. */
export async function notebookSourceEvidence(root) {
  const paths = JSON.parse(await readFile(resolve(root, 'apps/notebook/ui-src/source-registry.json'), 'utf8'));
  const sources = [];
  for (const path of paths) {
    let bytes;
    try { bytes = await readFile(resolve(root, path)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; sources.push({ path, state: 'missing' }); continue; }
    // Omit oversized source rather than silently presenting a partial implementation.
    sources.push(bytes.length > 65536 ? { path, state: 'unavailable', reason: 'Source exceeds 64 KiB display limit', bytes: bytes.length, sha256: digest(bytes) }
      : { path, state: 'ready', bytes: bytes.length, sha256: digest(bytes), text: bytes.toString('utf8') });
  }
  const dependencies = [];
  for (const owner of ['apps/notebook', 'packages/notebook']) {
    const manifest = JSON.parse(await readFile(resolve(root, owner, 'package.json'), 'utf8'));
    for (const [name, declared] of Object.entries(manifest.dependencies)) {
      let installed = null;
      for (const directory of [owner, '.']) {
        try { const pkg = JSON.parse(await readFile(resolve(root, directory, 'node_modules', name, 'package.json'), 'utf8')); if (pkg.name === name) { installed = pkg.version; break; } }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      dependencies.push({ owner, name, declared, installed });
    }
  }
  const payload = { schemaVersion: 1, sources, dependencies };
  return { ...payload, sha256: digest(JSON.stringify(payload)) };
}
export async function packageNotebookDiagnostics(root, appName) {
  if (appName !== 'notebook') return;
  const appRoot = resolve(root, 'apps/notebook'), outdir = resolve(appRoot, 'dist');
  await mkdir(outdir, { recursive: true });
  await writeFile(resolve(outdir, 'source-evidence.json'), JSON.stringify(await notebookSourceEvidence(root)));
  await build({ entryPoints: [resolve(appRoot, 'ui-src/source-diagnostics-page.tsx')], outfile: resolve(outdir, 'diagnostics.js'), bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', target: 'chrome140', minify: true, alias: appSdkAliases(root), nodePaths: [resolve(appRoot, 'node_modules')], plugins: [{ name: 'notebook-diagnostics-react', setup(builder) {
    builder.onResolve({ filter: /^(react|react-dom)(\/|$)/ }, args => args.resolveDir === appRoot ? undefined : builder.resolve(args.path, { kind: args.kind, resolveDir: appRoot }));
  } }] });
  for (const file of ['diagnostics.html', 'editor-probe.html', 'editor-probe.js']) await cp(resolve(appRoot, 'public', file), resolve(outdir, file));
}

// Build the original Point page as a Pero App; no Point runtime/service is shipped.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { resolve, dirname, relative } from 'node:path';
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = resolve(import.meta.dirname, '../..');

export async function buildAutomationApp({ pointRoot = process.env.PERO_POINT_ROOT || resolve(root, '../../ai/point'), outdir = resolve(root, 'apps/automations/dist') } = {}) {
  pointRoot = resolve(pointRoot); outdir = resolve(outdir);
  const appRoot = resolve(root, 'apps/automations');
  const workbench = resolve(pointRoot, 'packages/dsh/dsh-go-web/src/workbench');
  const sdk = resolve(pointRoot, 'packages/app-platform/app-sdk');
  const require = createRequire(resolve(sdk, 'package.json'));
  const react = dirname(require.resolve('react/package.json'));
  const reactDOM = dirname(require.resolve('react-dom/package.json'));
  await mkdir(outdir, { recursive: true });
  const result = await build({
    absWorkingDir: root, entryPoints: [resolve(appRoot, 'ui-src/frame.tsx')], outfile: resolve(outdir, 'index.js'),
    bundle: true, format: 'esm', platform: 'browser', target: 'safari17', jsx: 'automatic', minify: true, metafile: true,
    loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.png': 'dataurl', '.svg': 'dataurl' },
    nodePaths: [resolve(sdk, 'node_modules')],
    alias: {
      react, 'react-dom': reactDOM,
      '@pero/app-sdk': resolve(root, 'packages/app-sdk/src/index.tsx'),
      '@point/app-sdk/ui': resolve(sdk, 'src/components/index.ts'),
      '@point/app-sdk': resolve(sdk, 'src/index.tsx'),
      'point-automation-page': resolve(workbench, 'automation-page.tsx'),
      'point-workbench-style': resolve(workbench, 'workbench.css'),
      'point-pulse-style': resolve(workbench, 'pulse-home.css'),
      'point-tokens': resolve(sdk, 'src/tokens/tokens.css'),
      'point-themes': resolve(sdk, 'src/tokens/themes.mjs'),
    },
  });
  await writeFile(resolve(outdir, 'index.html'), '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Automations</title><link rel="stylesheet" href="./index.css"></head><body><div id="app"></div><script type="module" src="./index.js"></script></body></html>\n');
  const sources = [];
  for (const name of Object.keys(result.metafile.inputs).sort()) {
    const path = resolve(root, name);
    if (!path.startsWith(pointRoot + '/')) continue;
    sources.push({ path: relative(pointRoot, path), sha256: createHash('sha256').update(await readFile(path)).digest('hex') });
  }
  const revision = execFileSync('git', ['-C', pointRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await mkdir(resolve(outdir, 'licenses'), { recursive: true });
  for (const name of ['NOTICE.md', 'LICENSE-KIROCREW']) await cp(resolve(sdk, name), resolve(outdir, 'licenses', name));
  await writeFile(resolve(outdir, 'source-receipt.json'), JSON.stringify({ schema: 'pero.automation-point-ui.v1', pointRevision: revision, originalEntry: 'packages/dsh/dsh-go-web/src/workbench/automation-page.tsx', sources }, null, 2));
  console.log(`Built original Point Automation UI: ${outdir}`);
  return { outdir, revision, sources };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--point-root');
  await buildAutomationApp(index >= 0 ? { pointRoot: process.argv[index + 1] } : {});
}

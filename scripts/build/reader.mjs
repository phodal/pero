import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { root } from '../lib/paths.mjs';
import { run } from '../lib/run.mjs';

/** Build one small entry with the same reader and Worker as the Workbench. */
export async function buildReader({ release = process.env.PERO_BUILD_RELEASE === '1' } = {}) {
  await run(process.execPath, [resolve(root, 'scripts/build/wasm.mjs'), '--reader-only'], {
    env: { ...process.env, PERO_BUILD_RELEASE: release ? '1' : '0' },
  });
  await run(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', resolve(root, 'web/dist-reader')], {
    cwd: resolve(root, 'web'), env: { ...process.env, PERO_READER_ONLY: '1' },
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildReader();

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { root } from '../lib/paths.mjs';
import { run } from '../lib/run.mjs';

/** Build standalone Reader bindings and bundle the entry for App consumers. */
export async function buildReader({ release = process.env.PERO_BUILD_RELEASE === '1', chat = false } = {}) {
  await run(process.execPath, [resolve(root, 'scripts/build/wasm.mjs'), chat ? '--reader-and-chat' : '--reader-only'], {
    env: { ...process.env, PERO_BUILD_RELEASE: release ? '1' : '0' },
  });
  return bundleReader();
}

/** Bundle the Reader entry using the Reader and Worker bindings already built by the caller. */
export async function bundleReader() {
  const output = resolve(root, 'web/dist-reader');
  await run(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', output], {
    cwd: resolve(root, 'web'), env: { ...process.env, PERO_READER_ONLY: '1' },
  });
  return output;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildReader();

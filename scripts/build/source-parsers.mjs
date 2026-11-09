import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Package the canonical local parser primitives, never source-tree fallback imports. */
export async function packageSourceParsers(root, app) {
  if (!['notebook', 'paper-agent'].includes(app)) return;
  await mkdir(resolve(root, `apps/${app}/backend`), { recursive: true });
  await cp(resolve(root, 'packages/source-extraction/python/pero_source_tools.py'), resolve(root, `apps/${app}/backend/pero_source_tools.py`));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, '../..');
  for (const app of ['notebook', 'paper-agent']) await packageSourceParsers(root, app);
}

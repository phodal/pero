import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function packageScientificRuntime(root, app) {
  if (!['control-lab', 'paper-agent'].includes(app)) return;
  await mkdir(resolve(root, `apps/${app}/backend`), {recursive:true});
  await cp(resolve(root, 'packages/scientific-runtime/python/pero_scientific.py'), resolve(root, `apps/${app}/backend/pero_scientific.py`));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, '../..');
  for (const app of ['control-lab', 'paper-agent']) await packageScientificRuntime(root, app);
}

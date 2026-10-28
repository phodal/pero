import { readFileSync, realpathSync, lstatSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { AppBundle } from '../../packages/product/app-bundle.ts';

/** External App builds are inputs, never executed or installed into this checkout. */
export function readAppBundle(directory) {
  const root = realpathSync(directory);
  const bundle = AppBundle.parse(JSON.parse(readFileSync(resolve(root, 'app-bundle.json'), 'utf8')));
  const files = bundle.files.map(path => {
    const source = resolve(root, path);
    if (!lstatSync(source).isFile() || !realpathSync(source).startsWith(root + sep)) {
      throw new Error(`AppBundle needs a regular file inside its root: ${path}`);
    }
    return { path, source };
  });
  const manifest = JSON.parse(readFileSync(resolve(root, 'app.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.name !== bundle.name ||
    !manifest.contributes?.panels?.length ||
    !manifest.contributes.panels.every(panel => bundle.files.includes(panel.entry)) ||
    (manifest.backend && !bundle.files.includes(manifest.backend.entry))) {
    throw new Error('AppBundle must include its Pero App manifest, panel and backend entries; Point manifests need an owner-built adapter');
  }
  return { root, bundle, manifest, files };
}

export function stageAppBundle(input, destination) {
  for (const file of input.files) {
    const target = resolve(destination, file.path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(file.source, target);
  }
}

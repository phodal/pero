import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** CI prepares this real environment. Acceptance never installs packages or weakens App pins. */
export function canvasPythonEnvironment() {
  const python = process.env.PERO_APP_PYTHON;
  if (!python) throw new Error('Set PERO_APP_PYTHON to a virtual environment interpreter with apps/notebook/app.json backend.dependencies installed.');
  const manifest = JSON.parse(readFileSync(new URL('../../apps/notebook/app.json', import.meta.url), 'utf8'));
  return execFileSync(resolve(python), ['-I', '-c', `
import importlib.metadata, json, sys
if sys.prefix == sys.base_prefix:
    raise SystemExit('PERO_APP_PYTHON must be a prepared virtual environment interpreter')
missing = []
for requirement in json.loads(sys.argv[1]):
    name, separator, expected = requirement.partition('==')
    if not separator:
        raise SystemExit('Canvas acceptance requires exact App dependency pins')
    try:
        installed = importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        installed = None
    if installed != expected:
        missing.append(requirement)
if missing:
    raise SystemExit('Prepare Notebook dependencies before Canvas acceptance: ' + ', '.join(missing))
print(sys.prefix)
`, JSON.stringify(manifest.backend.dependencies)], { encoding: 'utf8', timeout: 15_000 }).trim();
}

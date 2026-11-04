import { mkdir, cp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');

// Shared fixture packaging for the actual Host contract and its startup regression.
export async function stageResearchImportApp(directory, name) {
  const source = resolve(directory, 'source-' + name);
  await mkdir(resolve(source, 'dist'), { recursive: true });
  await cp(resolve(root, 'apps', name, 'backend'), resolve(source, 'backend'), {
    recursive: true, filter: path => !path.includes('__pycache__') && !path.endsWith('.pyc'),
  });
  // Mirror scripts/build/apps.mjs: installed Data Apps carry the shared exact-value core.
  if (name === 'data') {
    await mkdir(resolve(source, 'backend/_core'), { recursive: true });
    for (const module of ['dataset.py', 'view.py', 'chart_document.py'])
      await cp(resolve(root, 'harness/go/charts/python', module), resolve(source, 'backend/_core', module));
  }
  for (const [from, to] of [['research-import-backend.py', 'research_fixture_server.py'],
                           ['research-resources.py', 'research_resources_fixture.py']])
    await cp(resolve(root, 'tests/fixtures', from), resolve(source, 'backend', to));
  await writeFile(resolve(source, 'dist/index.html'), '<h1>Offline research integration fixture</h1>');
  // Production manifests carry unrelated UI/dependency declarations; this fixture
  // changes only the composition root, declared permission, and tiny static panel.
  await writeFile(resolve(source, 'app.json'), JSON.stringify({ schemaVersion: 1, name, version: 'fixture', displayName: name,
    permissions: { host: name === 'paper-agent' ? ['research-assets'] : [] },
    contributes: { panels: [{ id: 'main', title: name, entry: 'dist/index.html' }] },
    backend: { type: 'python', entry: 'backend/research_fixture_server.py' } }));
  return source;
}

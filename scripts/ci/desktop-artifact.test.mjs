import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pack, unpack, runtimePaths } from './desktop-artifact.mjs';

const root = resolve(import.meta.dirname, '../..');
const modules = { data: ['dataset.py'], 'data-agent': ['dataset.py', 'view.py', 'chart_document.py'] };

// Real Python shells and parsers cross the same archive boundary as Desktop CI.
// Unrelated native/UI outputs are placeholders: this is not Desktop acceptance.
test('runtime archive starts installed Data Apps without the source-tree parser fallback', { skip: process.platform !== 'linux' }, () => {
  const temp = mkdtempSync(resolve(tmpdir(), 'pero-ci-data-runtime-'));
  try {
    const source = resolve(temp, 'build'), destination = resolve(temp, 'acceptance'), archive = resolve(temp, 'runtime.tgz');
    mkdirSync(resolve(source, 'products'), { recursive: true });
    mkdirSync(destination);
    writeFileSync(resolve(source, 'products/pero.json'), JSON.stringify({ apps: Object.keys(modules) }));
    for (const path of runtimePaths(source)) {
      const file = path.endsWith('/dist') || path.endsWith('/helpers') || path.startsWith('web/src/') ? `${path}/entry.js` : path;
      mkdirSync(dirname(resolve(source, file)), { recursive: true });
      writeFileSync(resolve(source, file), `fixture ${path}`);
    }
    for (const [app, names] of Object.entries(modules)) {
      // A fresh acceptance checkout has tracked backend sources, not build outputs.
      cpSync(resolve(root, `apps/${app}/backend`), resolve(destination, `apps/${app}/backend`), {
        recursive: true, filter: path => !['__pycache__', '_core'].includes(path.split('/').at(-1)),
      });
      mkdirSync(resolve(source, `apps/${app}/backend/_core`), { recursive: true });
      for (const name of names) cpSync(resolve(root, `harness/go/charts/python/${name}`), resolve(source, `apps/${app}/backend/_core/${name}`));
    }
    const revision = 'a'.repeat(40);
    pack(source, archive, revision);
    unpack(destination, archive, revision);
    const entries = JSON.parse(readFileSync(resolve(destination, 'target/ci-runtime.json'), 'utf8')).entries;
    for (const [app, names] of Object.entries(modules)) {
      const installed = resolve(temp, `profile/apps/${app}`);
      cpSync(resolve(destination, `apps/${app}`), installed, { recursive: true });
      assert.equal(existsSync(resolve(temp, 'profile/harness/go/charts/python')), false);
      const result = spawnSync('python3', ['-c', String.raw`
import base64, json, os, pathlib, select, subprocess, sys, urllib.request
app = pathlib.Path(sys.argv[1])
process = subprocess.Popen([sys.executable, str(app / 'backend/server.py')], cwd=app,
    env=dict(os.environ, PERO_APP_DATA=str(app / 'data'), PERO_APP_TOKEN='fixture', PYTHONPATH=''),
    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
try:
    assert select.select([process.stdout], [], [], 5)[0], 'Backend readiness timed out'
    line = process.stdout.readline()
    assert line, process.stderr.read()
    port = json.loads(line)['port']
    assert isinstance(port, int) and 0 < port < 65536, line
    def post(path, value):
        request = urllib.request.Request(f'http://127.0.0.1:{port}{path}', json.dumps(value).encode(),
            {'Content-Type': 'application/json', 'X-Pero-App-Token': 'fixture'})
        with urllib.request.urlopen(request, timeout=3) as response:
            return json.load(response)
    content = '[{"n":9007199254740993}]'
    if app.name == 'data':
        imported = post('/api/import', dict(name='test.json', kind='dataset', content=base64.b64encode(content.encode()).decode()))
        result = post('/api/inspect', dict(datasetId=imported['selectedDatasetId'], assetId=imported['selectedAssetId']))
        assert result['status'] == 'ok', result
        assert result['rows'][0]['cells'][0]['text'] == '9007199254740993', result
    else:
        imported = post('/api/import', dict(name='test.json', format='json', content=content))
        result = post('/api/query', dict(dataset=imported['dataset']['id'], columns=['n']))
        assert result['rows'][0]['cells']['n']['display'] == '9007199254740993', result
    print('INSTALLED_READY_AND_EXACT_IMPORT_OK')
finally:
    process.terminate()
    try: process.communicate(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill(); process.communicate()
`, installed], { encoding: 'utf8', timeout: 15000 });
      assert.equal(result.status, 0, `${app}: ${result.error ?? ''}\n${result.stderr}`);
      assert.equal(result.stdout.trim(), 'INSTALLED_READY_AND_EXACT_IMPORT_OK');
      for (const name of names) assert.ok(entries.some(entry => entry.path === `apps/${app}/backend/_core/${name}`));
    }
    // Missing required generated inputs must fail packing, not produce a green archive.
    rmSync(resolve(source, 'apps/data/backend/_core/dataset.py'));
    assert.throws(() => pack(source, archive, revision), /ENOENT/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { stageResearchImportApp } from '../../tests/fixtures/research-import-app.mjs';

test('research import stages an isolated Data backend with its full exact-value core', async () => {
  const temp = await mkdtemp(resolve(tmpdir(), 'pero-research-app-'));
  try {
    const app = await stageResearchImportApp(temp, 'data');
    // Same staged files as the Host contract, outside the source checkout. No
    // Host, listening socket or PYTHONPATH fallback can hide missing modules.
    const result = spawnSync('python3', ['-I', '-c', String.raw`
import pathlib, sys
app = pathlib.Path(sys.argv[1])
sys.path.insert(0, str(app / 'backend'))
import research_fixture_server
from catalog import Catalog
from server import handler
from inspection import Inspection
import dataset, view, chart_document
for module in (dataset, view, chart_document):
    assert pathlib.Path(module.__file__).parent == app / 'backend/_core'
parsed = Inspection.parse(b'[{"n":9007199254740993}]', 'exact.json', 'json')
assert parsed.records.records[0].cells[0][1].token == '9007199254740993'
Catalog(str(app / 'data'))
print('ISOLATED_RESEARCH_DATA_READY')
`, app], { encoding: 'utf8', timeout: 10000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: '' } });
    assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stderr}`);
    assert.equal(result.stdout.trim(), 'ISOLATED_RESEARCH_DATA_READY');
  } finally { await rm(temp, { recursive: true, force: true }); }
});

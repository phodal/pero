import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { packageSourceParsers } from './source-parsers.mjs';

const root = resolve(import.meta.dirname, '../..');
test('installed Notebook and Paper share packaged local parser primitives without repository fallback', async () => {
  const folder = await mkdtemp(resolve(tmpdir(), 'pero-source-install-'));
  try {
    await mkdir(resolve(folder, 'packages/source-extraction/python'), { recursive: true });
    await cp(resolve(root, 'packages/source-extraction/python/pero_source_tools.py'), resolve(folder, 'packages/source-extraction/python/pero_source_tools.py'));
    for (const app of ['notebook', 'paper-agent']) {
      await mkdir(resolve(folder, `apps/${app}`), { recursive: true });
      await cp(resolve(root, `apps/${app}/backend`), resolve(folder, `apps/${app}/backend`), { recursive: true, filter: path => !path.includes('__pycache__') && !path.endsWith('pero_source_tools.py') });
      await packageSourceParsers(folder, app);
    }
    await rm(resolve(folder, 'packages'), { recursive: true });
    for (const app of ['notebook', 'paper-agent']) {
      const cwd = resolve(folder, `apps/${app}/backend`);
      const result = spawnSync(process.env.PERO_SOURCE_TEST_PYTHON || 'python3', ['-c', app === 'notebook' ?
        'import source_parsers; from source_extraction import ExtractionRequest; from pero_source_tools import parse_tsv; assert source_parsers.PDFIUM_LOCK is __import__("pero_source_tools").PDFIUM_LOCK; print("INSTALLED_IMPORT_OK")' :
        'from paper_agent.pdf_files import PDFIUM_LOCK; from paper_agent.numeric_extraction import NumericExtractor; import pero_source_tools as shared; assert PDFIUM_LOCK is shared.PDFIUM_LOCK; assert NumericExtractor._ocr is shared.run_ocr; print("INSTALLED_IMPORT_OK")'],
      { cwd, env: { ...process.env, PYTHONPATH: '', PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1' }, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), 'INSTALLED_IMPORT_OK');
    }
    const manifest = JSON.parse(await readFile(resolve(root, 'apps/notebook/app.json'), 'utf8'));
    assert.deepEqual(manifest.backend.dependencies, ['pypdfium2==5.0.0', 'Pillow==12.0.0', 'python-docx==1.2.0', 'openpyxl==3.1.5', 'python-pptx==1.0.2']);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

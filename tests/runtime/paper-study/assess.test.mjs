import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { fetches, records, referenceBoundary } from './assess.mjs';

test('reference boundary reads actual versioned store and external seam log, and rejects grants or jobs', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'source-assessment-'));
  const path = resolve(directory, 'app-data/paper-agent');
  const bundle = { sourceDownloadIds: [], pdfDownloadIds: [], downloadIds: [] };
  const host = { backend: async name => name === 'data' ? { download: null, assets: [] } : { bundles: [bundle] } };
  try {
    await mkdir(resolve(path, 'research-v1/source-downloads'), { recursive: true });
    await writeFile(resolve(path, 'source-fixture-requests.jsonl'), '{"kind":"metadata","url":"https://example.org"}\n');
    assert.equal((await fetches(directory)).length, 1);
    await referenceBoundary(host, directory);
    bundle.sourceDownloadIds.push('not-approved');
    await assert.rejects(referenceBoundary(host, directory));
    bundle.sourceDownloadIds.length = 0;
    await writeFile(resolve(path, 'research-v1/source-downloads/real-location.json'), '{"status":"running"}');
    assert.deepEqual(await records(directory, 'source-downloads'), [{ status: 'running' }]);
    await assert.rejects(referenceBoundary(host, directory));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

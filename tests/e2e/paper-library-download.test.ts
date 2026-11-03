import assert from 'node:assert/strict';
import { test } from 'node:test';
import { downloadPaperFiles } from '../../apps/paper-agent/ui-src/library-download.ts';

// Existing HTTP owner seam. No timers, files, network or provider in core tests.
function fixture({ sourceFailure = false, uncertainStart = false, scanned = false } = {}) {
  const calls: any[] = [], statuses = { pdf: 'not_started', source: 'not_started' };
  let firstStart = true;
  const api = { post: async (path: string, body: any) => {
    calls.push({ path, ...body });
    if (path.endsWith('/files')) {
      if (body.operation === 'prepare') return { status: 'ready', draftId: 'draft', reviewId: 'review', pdf: { available: true }, tex: { available: true } };
      if (body.operation === 'confirm') return { bundleId: 'bundle', pdfResourceId: 'pdf', sourceResourceId: body.tex ? 'tex' : null, documentId: null,
        paperId: 'original', bundle: { id: 'bundle' } };
      assert.deepEqual(Object.keys(body).sort(), ['operation', 'bundleId', 'pdfResourceId', 'sourceResourceId', 'documentId'].sort());
      return { pdf: '/copies/original.pdf', ...(body.sourceResourceId ? { tex: '/copies/original-src.tar.gz' } : {}) };
    }
    const kind = path.endsWith('/pdf') ? 'pdf' : 'source';
    if (body.operation === 'start') {
      statuses[kind] = kind === 'source' && sourceFailure ? 'failed' : 'completed';
      if (uncertainStart && firstStart) { firstStart = false; throw Error('Lost response'); }
    }
    return { status: statuses[kind], localAvailable: statuses[kind] === 'completed', error: statuses[kind] === 'failed' ? 'Source denied' : '', receipt: scanned ? { extractionWarnings: ['No selectable text. OCR is not available.'] } : {} };
  } };
  return { api: api as any, calls };
}
const paper = { id: 'original' } as any;

test('one download action attaches PDF to its original before acquiring same-version TeX', async () => {
  for (const format of ['pdf', 'tex'] as const) {
    const { api, calls } = fixture(); let attached = false;
    const result = await downloadPaperFiles(api, paper, format, new AbortController().signal, () => {}, async () => { attached = true; });
    assert(attached); assert.equal(result.pdf, '/copies/original.pdf');
    assert.equal(!!result.tex, format === 'tex');
    const exports = calls.filter(c => c.operation === 'export');
    assert.equal(exports.length, format === 'tex' ? 2 : 1);
    assert.equal(exports[0].sourceResourceId, null);
    assert(calls.filter(c => c.path.endsWith('/files')).every(c => c.path === '/api/papers/original/files'));
    if (format === 'tex') assert(calls.indexOf(exports[0]) < calls.findIndex(c => c.path.endsWith('/source') && c.operation === 'start'));
  }
});

test('uncertain download response reconciles completed bytes on an explicit retry', async () => {
  const { api, calls } = fixture({ uncertainStart: true });
  const run = () => downloadPaperFiles(api, paper, 'pdf', new AbortController().signal, () => {}, async () => {});
  await assert.rejects(run, /Lost response/);
  assert.equal(calls.filter(c => c.operation === 'start').length, 1);
  await run();
  assert.equal(calls.filter(c => c.operation === 'start').length, 1);
  assert.equal(calls.filter(c => c.operation === 'export').length, 1);
});

test('TeX failure keeps the attached PDF and does not automatically retry', async () => {
  const { api, calls } = fixture({ sourceFailure: true }); let attached = false;
  await assert.rejects(() => downloadPaperFiles(api, paper, 'tex', new AbortController().signal, () => {}, async () => { attached = true; }), /Source denied/);
  assert(attached);
  assert.equal(calls.filter(c => c.path.endsWith('/source') && c.operation === 'start').length, 1);
  assert.equal(calls.filter(c => c.operation === 'export').length, 1);
});

test('cancellation revokes an inspecting request before granting or downloading files', async () => {
  const cancellation = new AbortController(), calls: any[] = [];
  const api = { post: async (path: string, body: any) => { calls.push({ path, ...body }); return { status: 'inspecting', draftId: 'pending' }; } } as any;
  await assert.rejects(() => downloadPaperFiles(api, paper, 'pdf', cancellation.signal, () => {}, async () => {}, async () => { cancellation.abort(); }), { name: 'AbortError' });
  assert.deepEqual(calls, [{ path: '/api/papers/original/files', operation: 'prepare' }, { path: '/api/research/inspect', draftId: 'pending', cancel: true }]);
});

 test('image-only PDF keeps its meaningful extraction warning', async () => {
  const { api } = fixture({ scanned: true });
  const result = await downloadPaperFiles(api, paper, 'pdf', new AbortController().signal, () => {}, async () => {});
  assert.deepEqual(result.warnings, ['No selectable text. OCR is not available.']);
});

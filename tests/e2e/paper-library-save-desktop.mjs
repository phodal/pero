// Called only by the authored source-study Desktop journey. API reads inspect
// actual receipts; download consent and export go through the real App UI.
import { expect } from '@playwright/test';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { backToLibrary, saveLibraryCopies } from './paper-pdf-flow.mjs';

async function unchangedResearchOwners(profile) {
  const root = resolve(profile, 'desktop/app-data/paper-agent/research-v1');
  const entries = await readdir(root, { recursive: true });
  const paths = entries.filter(path => /^(?:papers|annotations|source-observations|pdf-downloads|source-downloads|studies|study-steps|intents|pcgym-[^/]+)\//.test(path) && path.endsWith('.json')).sort();
  return Promise.all(paths.map(async path => [path, createHash('sha256').update(await readFile(resolve(root, path))).digest('hex')]));
}

export async function exerciseLibrarySave({ frame, page, api, requests, out, profile, priorDocumentId, restart }) {
  const priorPdf = await api(`/api/pdf/${priorDocumentId}`);
  await backToLibrary(frame);
  const paper = await api('/api/papers/import', { title: 'Authored Library source copies', sourceId: '2610.00004v1',
    url: 'https://arxiv.org/abs/2610.00004v1', pdfUrl: 'https://arxiv.org/pdf/2610.00004v1',
    authors: [], contentKind: 'abstract', content: 'Authored metadata remains the original Library paper.' });
  const savedPaper = await api(`/api/papers/${paper.id}`);
  await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
  const row = () => frame.locator('.pa-library-list > li').filter({ hasText: paper.title });
  const acquisitions = async () => (await requests()).filter(item => item.kind !== 'metadata');
  const before = await acquisitions();
  await row().locator('.pero-list-open').dblclick();
  await expect(frame.locator('.pa-source-text')).toContainText(paper.content);
  expect((await api(`/api/pdf?paperId=${paper.id}`)).document).toBeNull();
  expect(await acquisitions()).toEqual(before);
  await backToLibrary(frame);
  let dialog = await saveLibraryCopies(frame, paper.title, { tex: true });
  const bundle = (await api('/api/library')).bundles.find(item => item.seedUrl === paper.pdfUrl);
  expect(bundle.pdfDownloadIds).toHaveLength(1); expect(bundle.sourceDownloadIds).toHaveLength(1);
  const pdfRequest = { operation: 'status', bundleId: bundle.id, resourceId: bundle.pdfDownloadIds[0] };
  const sourceRequest = { operation: 'status', bundleId: bundle.id, resourceId: bundle.sourceDownloadIds[0] };
  const pdf = await api('/api/research/pdf', pdfRequest), source = await api('/api/research/source', sourceRequest);
  expect(pdf.localAvailable && source.localAvailable).toBe(true);
  expect(pdf.receipt.requestUrl).toBe(paper.pdfUrl);
  expect(source.receipt.requestUrl).toBe('https://arxiv.org/src/2610.00004v1');
  const observations = () => api('/api/research/source-report', { operation: 'observations', bundleId: bundle.id });
  expect((await observations()).observations).toEqual([]);
  const reading = await api(`/api/pdf?paperId=${paper.id}`);
  expect(reading.document.paperId).toBe(paper.id);
  expect(reading.document.fileDigest).toBe(pdf.receipt.fileDigest);
  // The Library association preserves bytes, not the receipt's document identity.
  expect(reading.document.id).not.toBe(pdf.receipt.documentId);
  expect(reading.originalUrl).toBeNull();
  // Both authored URLs return identical bytes: keep the existing acquisition
  // identity/provenance, rather than assuming the newest receipt owns its URL.
  expect(pdf.receipt.documentId).toBe(priorDocumentId);
  expect(await api(`/api/pdf/${priorDocumentId}`)).toEqual(priorPdf);
  expect((await api(`/api/papers/${paper.id}`))).toMatchObject(paper);
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const exported = resolve(profile, 'desktop/app-data/paper-agent/library-export-fixture');
  expect(digest(await readFile(resolve(exported, '2610.00004v1.pdf')))).toBe(reading.document.fileDigest);
  expect(digest(await readFile(resolve(exported, '2610.00004v1-src.tar.gz')))).toBe(source.receipt.archiveDigest);
  await page.screenshot({ path: resolve(out, 'library-save-receipts.png') });
  // An existing annotation and document identity must survive another save.
  const annotation = await api('/api/annotations', { documentId: reading.document.id, page: 1,
    kind: 'highlight', quote: 'Synthetic source figure.', rects: [{ x: .075, y: .11, width: .4, height: .03 }] });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  dialog = await saveLibraryCopies(frame, paper.title, { tex: true });
  expect((await api(`/api/pdf?paperId=${paper.id}`))).toEqual({ ...reading, annotations: [annotation] });
  expect((await observations()).observations).toEqual([]);
  const acquired = await acquisitions();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  const ownersBeforeRecords = await unchangedResearchOwners(profile), observedBeforeRecords = await observations();
  // Manual records no longer have a reader panel. Exercise the same persisted
  // revisions and reread selection through the app's record API.
  const record = body => api('/api/research/record', body);
  const original = {
    operation: 'create', question: 'Authored record question', scope: 'Authored source only',
    inclusion: 'Saved authored material', exclusion: 'Unobserved external claims',
    paperIds: [paper.id], decisions: [{ paperId: paper.id, decision: 'pending', reason: 'Retain this original source for review' }],
    evidence: [],
  };
  const first = await record(original);
  expect(first.paperIds).toEqual([paper.id]);
  const revised = await record({ ...original, parentId: first.id, question: 'Authored revised question',
    scope: 'Revised scope without inherited acceptance' });
  expect(revised.parentId).toBe(first.id);
  expect(revised.verification).toBe('not_run');
  expect((await record({ operation: 'impact', recordId: revised.id })).items)
    .toEqual([expect.objectContaining({ paperId: paper.id, status: 'unchanged' })]);
  const selection = await record({ operation: 'select', recordId: revised.id, paperIds: [paper.id] });
  expect(selection).toMatchObject({ paperIds: [paper.id], execution: 'not_requested', verification: 'not_run' });
  const revisionWithSelection = await record({ operation: 'read', recordId: revised.id });
  expect(revisionWithSelection).toEqual({ ...revised, selections: [selection] });
  expect(await unchangedResearchOwners(profile)).toEqual(ownersBeforeRecords);
  expect(await acquisitions()).toEqual(acquired);
  ({ frame, page } = await restart());
  await row().locator('.pero-list-open').dblclick();
  await expect(frame.getByRole('region', { name: 'PDF reader', exact: true }).locator('img,canvas').first()).toBeVisible({ timeout: 30000 });
  expect(await api(`/api/pdf?paperId=${paper.id}`)).toEqual({ ...reading, annotations: [annotation] });
  expect((await api('/api/research/pdf', pdfRequest)).receipt).toEqual(pdf.receipt);
  expect((await api('/api/research/source', sourceRequest)).receipt).toEqual(source.receipt);
  expect(await acquisitions()).toEqual(acquired);
  await page.screenshot({ path: resolve(out, 'library-save-restarted.png') });
  expect(await record({ operation: 'read', recordId: revised.id })).toEqual(revisionWithSelection);
  expect(await record({ operation: 'read', recordId: first.id })).toEqual({ ...first, selections: [] });
  expect(await api(`/api/papers/${paper.id}`)).toEqual(savedPaper);
  expect(await api(`/api/pdf?paperId=${paper.id}`)).toEqual({ document: reading.document, originalUrl: null, annotations: [annotation] });
  expect(await api(`/api/pdf/${priorDocumentId}`)).toEqual(priorPdf);
  expect(await observations()).toEqual(observedBeforeRecords);
  expect(await unchangedResearchOwners(profile)).toEqual(ownersBeforeRecords);
  expect(await acquisitions()).toEqual(acquired);
  await writeFile(resolve(out, 'manual-record-result.json'), JSON.stringify({ recordId: first.id, revisionId: revised.id,
    selectionId: revisionWithSelection.selections[0].id,
    scope: 'Real Desktop/Host/Paper persistence with authored offline fixtures, not scientific acceptance.',
    checks: ['record API creates and revises required scope/screening', 'explicit reread choice requests no execution',
      'existing single Desktop restart retains both revisions and choice', 'original paper, annotations, observations and job records unchanged'] }, null, 2));
  await writeFile(resolve(out, 'library-save-result.json'), JSON.stringify({ paperId: paper.id, documentId: reading.document.id,
    pdfReceipt: pdf.receipt, sourceReceipt: source.receipt, annotationId: annotation.id,
    scope: 'Real Desktop → Rust Host → Paper owners; authored offline bytes only. No live-provider acceptance.',
    checks: ['metadata Reader acquires nothing', 'one click downloads and attaches PDF + TeX without a dialog',
      'original paper/document/annotation preserved', 'save creates no observation', 'restart retains receipts without reacquisition'] }, null, 2));
}

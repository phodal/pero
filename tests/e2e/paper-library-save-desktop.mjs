// Called only by the authored source-study Desktop journey. API reads inspect
// actual receipts; all consent and export mutations go through the real App UI.
import { expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { backToLibrary, saveLibraryCopies } from './paper-pdf-flow.mjs';

export async function exerciseLibrarySave({ frame, page, api, requests, out, profile, restart }) {
  await backToLibrary(frame);
  const paper = await api('/api/papers/import', { title: 'Authored Library source copies', sourceId: '2610.00004v1',
    url: 'https://arxiv.org/abs/2610.00004v1', pdfUrl: 'https://arxiv.org/pdf/2610.00004v1',
    authors: [], contentKind: 'abstract', content: 'Authored metadata remains the original Library paper.' });
  await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
  const row = () => frame.locator('.pa-library-list > li').filter({ hasText: paper.title });
  const acquisitions = async () => (await requests()).filter(item => item.kind !== 'metadata');
  const before = await acquisitions();
  await row().getByRole('button', { name: 'Save', exact: true }).click();
  let dialog = frame.getByRole('dialog', { name: 'Save copies', exact: true });
  await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('checkbox', { name: 'TeX', exact: true })).not.toBeChecked();
  await page.screenshot({ path: resolve(out, 'library-save-review.png') });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await row().locator('.pero-list-open').click();
  await expect(frame.locator('.pa-source-text')).toContainText(paper.content);
  expect((await api(`/api/pdf?paperId=${paper.id}`)).document).toBeNull();
  expect(await acquisitions()).toEqual(before);
  await backToLibrary(frame);
  dialog = await saveLibraryCopies(frame, paper.title, { tex: true });
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
  expect((await api(`/api/papers/${paper.id}`))).toEqual(paper);
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
  const sources = dialog.getByRole('region', { name: 'Paper source files', exact: true });
  await sources.getByRole('button', { name: 'Browse source files', exact: true }).click();
  await sources.getByRole('button', { name: 'main.tex', exact: true }).click();
  await expect(frame.getByLabel('Original source: main.tex', { exact: true })).toBeVisible();
  expect((await observations()).observations.map(item => item.kind)).toEqual(['source_text']);
  const acquired = await acquisitions();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  ({ frame, page } = await restart());
  await row().locator('.pero-list-open').click();
  await expect(frame.getByRole('region', { name: 'PDF reader', exact: true }).locator('img,canvas').first()).toBeVisible({ timeout: 30000 });
  expect(await api(`/api/pdf?paperId=${paper.id}`)).toEqual({ ...reading, annotations: [annotation] });
  expect((await api('/api/research/pdf', pdfRequest)).receipt).toEqual(pdf.receipt);
  expect((await api('/api/research/source', sourceRequest)).receipt).toEqual(source.receipt);
  expect(await acquisitions()).toEqual(acquired);
  await page.screenshot({ path: resolve(out, 'library-save-restarted.png') });
  await writeFile(resolve(out, 'library-save-result.json'), JSON.stringify({ paperId: paper.id, documentId: reading.document.id,
    pdfReceipt: pdf.receipt, sourceReceipt: source.receipt, annotationId: annotation.id,
    scope: 'Real Desktop → Rust Host → Paper owners; authored offline bytes only. No live-provider acceptance.',
    checks: ['cancel and metadata Reader acquire nothing', 'explicit PDF + TeX consent and export copies',
      'original paper/document/annotation preserved', 'save creates no observation; source read does', 'restart retains receipts without reacquisition'] }, null, 2));
}

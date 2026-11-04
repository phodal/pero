// Called only by the authored source-study Desktop journey. API reads inspect
// actual receipts; all consent and export mutations go through the real App UI.
import { expect } from '@playwright/test';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { backToLibrary, saveLibraryCopies } from './paper-pdf-flow.mjs';

// Existing Desktop/profile only: mutations use the visible App, reads inspect
// the actual owner. This helper never launches/restarts a process or starts jobs.
async function manualRecordPanel(frame) {
  await frame.getByRole('button', { name: 'Research record', exact: true }).click();
  const panel = frame.locator('.pa-manual-records');
  await panel.getByText('Question and scope', { exact: true }).click();
  return panel;
}
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
  // The Library association preserves bytes, not the receipt's document identity.
  expect(reading.document.id).not.toBe(pdf.receipt.documentId);
  expect(reading.originalUrl).toBeNull();
  // Both authored URLs return identical bytes: keep the existing acquisition
  // identity/provenance, rather than assuming the newest receipt owns its URL.
  expect(pdf.receipt.documentId).toBe(priorDocumentId);
  expect(await api(`/api/pdf/${priorDocumentId}`)).toEqual(priorPdf);
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
  const sources = dialog.getByRole('region', { name: 'TeX source', exact: true });
  await sources.getByRole('button', { name: 'Browse source files', exact: true }).click();
  await sources.getByRole('button', { name: 'main.tex', exact: true }).click();
  await expect(frame.getByLabel('Original source: main.tex', { exact: true })).toBeVisible();
  expect((await observations()).observations.map(item => item.kind)).toEqual(['source_text']);
  const acquired = await acquisitions();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  const ownersBeforeRecords = await unchangedResearchOwners(profile), observedBeforeRecords = await observations();
  await row().locator('.pero-list-open').click();
  const panel = await manualRecordPanel(frame);
  await panel.getByRole('button', { name: 'New record', exact: true }).click();
  await panel.getByRole('textbox', { name: 'Question', exact: true }).fill('Authored record question');
  await panel.getByRole('textbox', { name: 'Scope', exact: true }).fill('Authored source only');
  await panel.getByRole('textbox', { name: 'Inclusion criteria', exact: true }).fill('Saved authored material');
  await panel.getByRole('textbox', { name: 'Exclusion criteria', exact: true }).fill('Unobserved external claims');
  await panel.getByRole('textbox', { name: 'Reason', exact: true }).fill('Retain this original source for review');
  await panel.getByRole('button', { name: 'Save revision', exact: true }).click();
  await expect(panel.getByText('Revision saved. Earlier records are unchanged.', { exact: true })).toBeVisible();
  const first = (await api('/api/research/record', { operation: 'list' })).records.find(item => item.question === 'Authored record question');
  expect(first.paperIds).toEqual([paper.id]);
  await panel.getByRole('button', { name: 'Revise', exact: true }).click();
  // Role names exclude a textarea's initial text; raw label text includes it after reopen.
  await expect(panel.getByRole('textbox', { name: 'Scope', exact: true })).toHaveValue('Authored source only');
  await panel.getByRole('textbox', { name: 'Question', exact: true }).fill('Authored revised question');
  await panel.getByRole('textbox', { name: 'Scope', exact: true }).fill('Revised scope without inherited acceptance');
  await panel.getByRole('button', { name: 'Save revision', exact: true }).click();
  await expect(panel.getByRole('article', { name: 'Saved research record' })).toContainText('Revised scope without inherited acceptance');
  const revised = (await api('/api/research/record', { operation: 'list' })).records.find(item => item.question === 'Authored revised question');
  expect(revised.parentId).toBe(first.id); expect(revised.verification).toBe('not_run');
  await panel.getByRole('button', { name: 'Check saved source updates', exact: true }).click();
  await panel.getByRole('checkbox', { name: paper.title + ' — unchanged', exact: true }).check();
  await panel.getByRole('button', { name: 'Save reread selection', exact: true }).click();
  await expect(panel.getByText('Reread selection saved. No reading or computation has started.', { exact: true })).toBeVisible();
  const revisionWithSelection = await api('/api/research/record', { operation: 'read', recordId: revised.id });
  expect(revisionWithSelection.selections).toHaveLength(1);
  expect(revisionWithSelection.selections[0]).toMatchObject({ paperIds: [paper.id], execution: 'not_requested', verification: 'not_run' });
  expect(await unchangedResearchOwners(profile)).toEqual(ownersBeforeRecords);
  expect(await acquisitions()).toEqual(acquired);
  await page.screenshot({ path: resolve(out, 'manual-record-created.png') });
  ({ frame, page } = await restart());
  await row().locator('.pero-list-open').click();
  await expect(frame.getByRole('region', { name: 'PDF reader', exact: true }).locator('img,canvas').first()).toBeVisible({ timeout: 30000 });
  expect(await api(`/api/pdf?paperId=${paper.id}`)).toEqual({ ...reading, annotations: [annotation] });
  expect((await api('/api/research/pdf', pdfRequest)).receipt).toEqual(pdf.receipt);
  expect((await api('/api/research/source', sourceRequest)).receipt).toEqual(source.receipt);
  expect(await acquisitions()).toEqual(acquired);
  await page.screenshot({ path: resolve(out, 'library-save-restarted.png') });
  const reopenedPanel = await manualRecordPanel(frame);
  await reopenedPanel.getByRole('button', { name: 'Authored revised question', exact: true }).click();
  await expect(reopenedPanel.getByRole('article', { name: 'Saved research record' })).toContainText('Revised scope without inherited acceptance');
  await reopenedPanel.getByText('Saved reread selections', { exact: true }).click();
  await expect(reopenedPanel.getByText('Recorded only; no execution requested.', { exact: true })).toBeVisible();
  expect(await api('/api/research/record', { operation: 'read', recordId: revised.id })).toEqual(revisionWithSelection);
  await reopenedPanel.getByRole('button', { name: 'Authored record question', exact: true }).click();
  await expect(reopenedPanel.getByRole('article', { name: 'Saved research record' })).toContainText('Authored source only');
  expect(await api('/api/research/record', { operation: 'read', recordId: first.id })).toEqual({ ...first, selections: [] });
  expect(await api(`/api/papers/${paper.id}`)).toEqual(paper);
  expect(await api(`/api/pdf?paperId=${paper.id}`)).toEqual({ document: reading.document, originalUrl: null, annotations: [annotation] });
  expect(await api(`/api/pdf/${priorDocumentId}`)).toEqual(priorPdf);
  expect(await observations()).toEqual(observedBeforeRecords);
  expect(await unchangedResearchOwners(profile)).toEqual(ownersBeforeRecords);
  expect(await acquisitions()).toEqual(acquired);
  await page.screenshot({ path: resolve(out, 'manual-record-restarted.png') });
  await writeFile(resolve(out, 'manual-record-result.json'), JSON.stringify({ recordId: first.id, revisionId: revised.id,
    selectionId: revisionWithSelection.selections[0].id,
    scope: 'Real Desktop/Host/Paper persistence with authored offline fixtures, not scientific acceptance.',
    checks: ['UI creates and revises required scope/screening', 'explicit reread choice requests no execution',
      'existing single Desktop restart retains both revisions and choice', 'original paper, annotations, observations and job records unchanged'] }, null, 2));
  await writeFile(resolve(out, 'library-save-result.json'), JSON.stringify({ paperId: paper.id, documentId: reading.document.id,
    pdfReceipt: pdf.receipt, sourceReceipt: source.receipt, annotationId: annotation.id,
    scope: 'Real Desktop → Rust Host → Paper owners; authored offline bytes only. No live-provider acceptance.',
    checks: ['cancel and metadata Reader acquire nothing', 'explicit PDF + TeX consent and export copies',
      'original paper/document/annotation preserved', 'save creates no observation; source read does', 'restart retains receipts without reacquisition'] }, null, 2));
}

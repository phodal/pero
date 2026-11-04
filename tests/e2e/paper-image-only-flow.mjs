// Actual installed Desktop/Host/Paper; the HTTPS seam returns authored raster
// bytes. No OCR, provider, model or scientific-execution acceptance is inferred.
import { expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { backToLibrary, saveLibraryCopies } from './paper-pdf-flow.mjs';

export const imageOnlyStudyRejectionUrl = 'pero-app://paper-agent/api/studies?fixture=image-only-study-rejection';
export const isImageOnlyStudyRejectionConsole = (url, text) => url === imageOnlyStudyRejectionUrl &&
  /^Failed to load resource: the server responded with a status of 400(?: \([^)]*\))?$/.test(text);

async function api(frame, path, body) {
  return frame.locator('body').evaluate(async (_element, { path, body }) => {
    const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value = await response.json(); if (!response.ok) throw Error(JSON.stringify(value)); return value;
  }, { path, body });
}
const libraryRow = (frame, title) => frame.locator('.pa-library-list > li').filter({ has: frame.getByText(title, { exact: true }) });
const status = (frame, saved) => api(frame, '/api/research/pdf', { operation: 'status', bundleId: saved.bundleId, resourceId: saved.resourceId });

export async function exerciseImageOnly({ frame, page, profile, out }) {
  await backToLibrary(frame);
  const article = await api(frame, '/api/papers/import', { title: 'Authored article without a PDF', sourceId: 'no-pdf-article',
    url: 'https://reader.example.org/article', authors: [], contentKind: 'abstract', content: 'Article metadata only.' });
  const paper = await api(frame, '/api/papers/import', { title: 'Authored image-only PDF', sourceId: 'image-only',
    url: 'https://reader.example.org/scan', pdfUrl: 'https://reader.example.org/image-only.pdf', authors: [],
    contentKind: 'abstract', content: 'This metadata abstract must never become selectable PDF full text.' });
  await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(libraryRow(frame, article.title)).toHaveCount(1);
  await libraryRow(frame, article.title).locator('.pero-list-open').click();
  await expect(frame.getByRole('region', { name: 'Paper details', exact: true }).getByRole('button', { name: 'Download PDF', exact: true })).toBeDisabled();
  const dialog = await saveLibraryCopies(frame, paper.title);
  await expect(dialog.getByRole('status').filter({ hasText: /^Downloaded$/ })).toBeVisible();
  await expect(dialog).toContainText('OCR is not available');
  const library = await api(frame, '/api/library');
  const bundle = library.bundles.find(item => item.seedUrl === paper.pdfUrl);
  expect(bundle.pdfDownloadIds).toHaveLength(1); expect(bundle.sourceDownloadIds).toEqual([]);
  const saved = { paper, bundleId: bundle.id, resourceId: bundle.pdfDownloadIds[0] };
  const acquired = await status(frame, saved);
  expect(acquired).toMatchObject({ status: 'completed', localAvailable: true, readPages: [],
    receipt: { requestUrl: paper.pdfUrl, pageCount: 1, textPages: 0, textCharacters: 0 } });
  expect(acquired.receipt.extractionWarnings.join(' ')).toContain('OCR is not available');
  const reading = await api(frame, `/api/pdf?paperId=${paper.id}`);
  expect(reading.document.paperId).toBe(paper.id);
  expect(reading.document.fileDigest).toBe(acquired.receipt.fileDigest);
  expect(reading.document.pages.map(item => item.text)).toEqual(['']);
  expect(await api(frame, `/api/papers/${paper.id}`)).toEqual(paper);
  const bytes = await readFile(resolve(profile, 'image-only.pdf'));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(acquired.receipt.fileDigest);
  const copies = await readFile(resolve(profile, 'desktop/app-data/paper-agent/reader-export-fixture', `Authored-image-only-PDF-${paper.id.slice(0, 8)}.pdf`));
  expect(copies).toEqual(bytes);
  // This is a real negative App API call, not an Agent/model request. The
  // metadata abstract cannot be substituted for the empty extracted PDF pages.
  const denied = await frame.locator('body').evaluate(async (_element, { id, url }) => {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: 'image-only-desktop', question: 'Read full text', paperIds: [id], fullText: true }) });
    return { status: response.status, body: await response.json() };
  }, { id: paper.id, url: imageOnlyStudyRejectionUrl });
  expect(denied.status).toBe(400); expect(denied.body.detail).toContain('no selectable text');
  expect((await status(frame, saved)).readPages).toEqual([]);
  await page.screenshot({ path: resolve(out, 'image-only-receipt.png') });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await libraryRow(frame, paper.title).locator('.pero-list-open').dblclick();
  const viewer = frame.getByRole('region', { name: 'PDF reader', exact: true });
  await expect(viewer.locator('[data-page-number="1"] img,[data-page-number="1"] canvas').first()).toBeVisible({ timeout: 30000 });
  await expect(frame.getByRole('article', { name: paper.title, exact: true })).toHaveAttribute('data-paper-id', paper.id);
  await page.screenshot({ path: resolve(out, 'image-only-render.png') });
  await backToLibrary(frame);
  // Receipt snapshots stay addressable; the Library shows their associated original once.
  const cached = await api(frame, `/api/papers/${acquired.receipt.paperId}`);
  expect(cached.source).toBe('local-pdf'); expect(cached.pdfUrl).toBeUndefined();
  expect(cached.content).toBe(''); expect(cached.limitation).toContain('OCR is not available');
  expect(library.papers.some(item => item.id === cached.id)).toBe(false);
  expect(library.papers.find(item => item.id === paper.id).hasCachedPdf).toBe(true);
  await expect(libraryRow(frame, paper.title)).toHaveCount(1);
  await libraryRow(frame, paper.title).locator('.pero-list-open').click();
  await expect(frame.getByRole('region', { name: 'Paper details', exact: true }).getByRole('button', { name: 'Download PDF', exact: true })).toBeEnabled();
  const cachedDialog = await saveLibraryCopies(frame, paper.title);
  await cachedDialog.getByRole('button', { name: 'Close', exact: true }).click();
  await libraryRow(frame, paper.title).locator('.pero-list-open').dblclick();
  const cachedReader = frame.getByRole('article', { name: paper.title, exact: true });
  await expect(cachedReader).toHaveAttribute('data-paper-id', paper.id);
  await expect(viewer.locator('img,canvas').first()).toBeVisible({ timeout: 30000 });
  await frame.locator('.pa-reader-tools').getByRole('button', { name: 'Read', exact: true }).click();
  await expect(cachedReader.locator('.pa-source-text')).toHaveText(paper.content);
  await expect(cachedReader.locator('.pa-saved-heading')).toContainText('Abstract');
  await expect(cachedReader.getByText('Loading…', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: resolve(out, 'image-only-abstract.png') });
  await backToLibrary(frame);
  return { ...saved, receipt: acquired.receipt, document: reading.document, denied };
}

export async function reopenImageOnly({ frame, page, profile, out, saved }) {
  await backToLibrary(frame);
  await libraryRow(frame, saved.paper.title).locator('.pero-list-open').dblclick();
  await expect(frame.getByRole('region', { name: 'PDF reader', exact: true }).locator('img,canvas').first()).toBeVisible({ timeout: 30000 });
  expect((await api(frame, `/api/pdf?paperId=${saved.paper.id}`)).document).toEqual(saved.document);
  expect((await status(frame, saved)).receipt).toEqual(saved.receipt);
  const requests = (await readFile(resolve(profile, 'desktop/app-data/paper-agent/reader-image-only-attempts.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  expect(requests).toEqual([{ url: saved.paper.pdfUrl }]);
  await page.screenshot({ path: resolve(out, 'image-only-restarted.png') });
  await writeFile(resolve(out, 'image-only-result.json'), JSON.stringify({ ...saved, requests,
    scope: 'Real Desktop/Host/Paper render and restart; authored raster bytes; no OCR, external provider or model' }, null, 2));
}

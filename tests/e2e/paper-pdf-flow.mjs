import { chatState, askPaperChat, fillPaperChat, closePaperChat, showPaperReport, exitPaperQuestionMode } from './paper-chat-controls.mjs';
import { exercisePdfSearch } from './paper-search-flow.mjs';
import { expect } from '@playwright/test';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
export async function saveLibraryCopies(frame, title, { tex = false, timeout = 20000 } = {}) {
  const dialog = frame.getByRole('dialog', { name: 'Save copies', exact: true });
  // Add may already have opened this review. Never dismiss it or approve a
  // residual dialog for another paper merely to reach the Library button.
  if (!await dialog.isVisible()) {
    const row = frame.locator('.pa-library-list > li').filter({ has: frame.getByText(title, { exact: true }) });
    await row.getByRole('button', { name: 'Save', exact: true }).click();
  }
  await expect(dialog.getByText(title, { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled({ timeout });
  if (tex) await dialog.getByRole('checkbox', { name: 'TeX', exact: true }).check();
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Export copies', exact: true })).toBeEnabled({ timeout });
  await dialog.getByRole('button', { name: 'Export copies', exact: true }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Saved the PDF' })).toBeVisible();
  return dialog;
}

// Electron may expose an empty clipboard as one item with no advertised types.
// It carries no bytes to preserve and cannot construct a new ClipboardItem.
export async function savePaperClipboard({ clipboard, ClipboardItem }) {
  globalThis.paperClipboard = await Promise.all((await clipboard.read()).filter(item => item.types.length)
    .map(async item => new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)]))))));
}
// mouse.wheel resolves before Chromium delivers scrolling. A positive saved y
// can already come from zoom anchoring, so it is not a wheel completion signal.
export async function scrollPdfAndRead(page, viewport, readView, deltaY) {
  await viewport.hover();
  let before, target;
  await expect.poll(async () => {
    before = await readView();
    target = await viewport.evaluate((element, { state, deltaY }) => {
      const page = element.querySelector(`[data-page-number="${state.page}"]`);
      if (!page) throw Error('Current PDF page has no rendered geometry');
      const top = Math.max(0, Math.min(element.scrollHeight - element.clientHeight, element.scrollTop + deltaY));
      // EmbedPDF's viewport DOM has padding (viewportGap), but its page
      // visibility coordinates use the unpadded content origin. Read the style,
      // rather than assuming a plugin default or widening the position tolerance.
      const paddingTop = parseFloat(element.ownerDocument.defaultView.getComputedStyle(element).paddingTop) || 0;
      const currentPageY = (element.getBoundingClientRect().top + element.clientTop + paddingTop - page.getBoundingClientRect().top) / state.zoom;
      return { top, currentPageY, pageY: currentPageY + (top - element.scrollTop) / state.zoom };
    }, { state: before, deltaY });
    // Zoom dispatch can precede its RAF DOM scroll. Wait for that alignment
    // before using the native position as the wheel baseline.
    return Math.abs(before.position.y - target.currentPageY);
  }).toBeLessThan(0.05);
  await page.mouse.wheel(0, deltaY);
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeCloseTo(target.top, 1);
  await expect.poll(async () => (await readView()).position.y).toBeCloseTo(target.pageY, 1);
  const saved = await readView();
  expect(saved.page).toBe(before.page);
  expect(saved.zoom).toBe(before.zoom);
  return saved;
}
export async function setPaperAppearance(page, appearance) {
  await page.evaluate(value => {
    const state = JSON.parse(window.peroDiagnostics.snapshot());
    return window.pero.sessionCommand({ method: 'settings.workbench', preferences: { ...state.preferences, appearance: value } });
  }, appearance);
  await expect.poll(async () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).preferences.appearance)).toBe(appearance);
}
export async function backToLibrary(frame) {
  await exitPaperQuestionMode(frame);
  const close = frame.getByRole('button', { name: 'Close research records', exact: true });
  if (await close.isVisible()) await close.click();
  const back = frame.locator('.pa-reading-bar').getByRole('button', { name: 'Back to library', exact: true });
  if (await back.isVisible()) await back.click();
  // Source/import journeys may already be in Library, but on its bundle or
  // import sub-screen. Its own Back returns to the actual papers list.
  const library = frame.locator('.pa-library-screen');
  const libraryBack = library.getByRole('button', { name: 'Back to library', exact: true });
  if (await libraryBack.isVisible()) await libraryBack.click();
  await expect.poll(() => library.getByRole('button', { name: 'Refresh', exact: true }).isVisible(), {
    message: 'Paper Library list is visible after real reader/sub-screen navigation',
  }).toBe(true);
}
export async function pdfAction(frame, name) {
  const viewer = frame.getByRole('region', { name: 'PDF reader', exact: true });
  await viewer.focus(); await viewer.press('Shift+F10');
  await viewer.getByRole('menuitem', { name, exact: true }).click();
}
export async function exercisePdf({ frame, page, app, out, fixture, profile }) {
  const post = (path, body) => frame.locator('body').evaluate(async (_element, { path, body }) => {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value = await response.json(); if (!response.ok) throw new Error(JSON.stringify(value)); return value;
  }, { path, body });
  await backToLibrary(frame);
  const paper = await post('/api/papers/import', { title: fixture.realPdf ? 'Attention Is All You Need · PDF' : 'Synthetic PDF reading', sourceId: '1706.03762v1',
    url: 'https://arxiv.org/abs/1706.03762v1', pdfUrl: 'https://arxiv.org/pdf/1706.03762v1', authors: [], contentKind: 'full-text', content: fixture.text });
  await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
  const save = await saveLibraryCopies(frame, paper.title);
  await save.getByRole('button', { name: 'Close', exact: true }).click();
  await frame.locator('.pa-library-list .pero-list-open').filter({ has: frame.getByText(paper.title, { exact: true }) }).click();
  const viewer = frame.getByRole('region', { name: 'PDF reader', exact: true }), nav = frame.locator('.pa-reading-main');
  await expect(viewer).toBeVisible({ timeout: 30000 });
  await expect(frame.getByRole('complementary', { name: 'Ask', exact: true })).toHaveCount(0);
  await expect(frame.locator('.pa-library-screen')).not.toBeVisible();
  await expect(frame.getByRole('tab')).toHaveCount(0);
  const first = viewer.locator('[data-page-number="1"]');
  await expect(first.locator('img,canvas').first()).toBeVisible({ timeout: 30000 });
  await expect(first).toHaveAttribute('data-selection-ready', 'true', { timeout: 30000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  const tools = frame.locator('.pa-reader-tools');
  await expect(tools.getByRole('link', { name: 'Open original source', exact: true })).toHaveAttribute('href', 'https://arxiv.org/abs/1706.03762v1');
  const toolBoxes = await Promise.all(['Text', 'PDF', 'Zoom out', 'Zoom in'].map(name => tools.getByRole('button', { name, exact: true }).boundingBox()));
  expect(toolBoxes.every(box => box && Math.abs(box.y - toolBoxes[0].y) <= 4)).toBe(true);
  expect(await frame.locator('.pa-reading-bar h1').evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeLessThanOrEqual(16);
  await nav.getByRole('button', { name: 'Fit page', exact: true }).click();
  await expect.poll(async () => { const pageBox = await first.boundingBox(), viewport = await viewer.locator('.pa-pdf-viewport').boundingBox(); return pageBox.height <= viewport.height + 1 && pageBox.width <= viewport.width + 1; }).toBe(true);
  await page.screenshot({ path: resolve(out, 'reading-first-1440.png') });
  const reading = () => frame.locator('body').evaluate(async (_element, id) => (await fetch(`/api/pdf?paperId=${id}`)).json(), paper.id);
  const document = (await reading()).document;
  expect(document.pages).toHaveLength(fixture.pages);
  const storedView = () => frame.locator('body').evaluate((_element, key) => JSON.parse(localStorage.getItem(key)), `pero.paper.pdf-view:${document.id}:${document.fileDigest}`);
  // Real pointer selection. Opening/closing Ask must keep the same PDF image and selection.
  const box = await first.boundingBox(), s = fixture.selection;
  await page.mouse.move(box.x + s.x1 * box.width, box.y + s.y * box.height);
  await page.mouse.down(); await page.mouse.move(box.x + s.x2 * box.width, box.y + s.y * box.height, { steps: 20 }); await page.mouse.up();
  await expect(viewer.getByRole('button', { name: 'Highlight', exact: true })).toBeVisible();
  await first.locator('img,canvas').first().evaluate(element => element.dataset.readingIdentity = 'retained');
  const zoom = await nav.getByRole('button', { name: 'Fit page', exact: true }).innerText();
  await nav.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect.poll(async () => (await chatState(page)).appChatOpen).toBe(true);
  await expect(first.locator('img,canvas').first()).toHaveAttribute('data-reading-identity', 'retained');
  await expect(frame.locator('.pa-workspace')).toHaveAttribute('data-question', 'true');
  await expect(frame.locator('.pa-reading-bar')).toHaveCount(0);
  await expect(nav.getByRole('button', { name: 'Zoom in', exact: true })).toBeVisible();
  await expect.poll(async () => `${Math.round((await storedView()).zoom * 100)}%`).toBe(zoom);
  await closePaperChat(page, frame);
  await expect(first.locator('img,canvas').first()).toHaveAttribute('data-reading-identity', 'retained');
  await expect(nav.getByRole('button', { name: 'Fit page', exact: true })).toHaveText(zoom);
  await expect(viewer.getByRole('button', { name: 'Highlight', exact: true })).toBeVisible();
  await expect.poll(async () => (await storedView())?.selection ?? null).not.toBeNull();
  const selectedRange = (await storedView()).selection;
  await nav.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const retainedZoom = await nav.getByRole('button', { name: 'Fit page', exact: true }).innerText();
  const viewport = viewer.locator('.pa-pdf-viewport');
  const beforeText = await scrollPdfAndRead(page, viewport, storedView, 60);
  await first.locator('img,canvas').first().evaluate(element => element.dataset.readingIdentity = 'retained');
  await frame.locator('.pa-reader-tools').getByRole('button', { name: 'Text', exact: true }).click();
  await expect(viewer).toHaveCount(0);
  await expect(frame.locator('.pa-pdf-view-slot')).toHaveAttribute('inert', '');
  await expect(frame.locator('[data-reading-identity="retained"]')).toHaveCount(1);
  await expect(nav.getByRole('spinbutton', { name: 'Page', exact: true })).toHaveCount(0);
  await expect.poll(async () => (await storedView()).mode).toBe('text');
  await frame.locator('.pa-reader-tools').getByRole('button', { name: 'PDF', exact: true }).click();
  await expect(viewer).toBeVisible();
  await expect(first.locator('[data-reading-identity="retained"]')).toHaveCount(1);
  await expect(nav.getByRole('button', { name: 'Fit page', exact: true })).toHaveText(retainedZoom);
  await expect(viewer.getByRole('button', { name: 'Highlight', exact: true })).toBeVisible();
  await expect.poll(async () => (await storedView()).selection).toEqual(selectedRange);
  expect((await storedView()).page).toBe(beforeText.page);
  expect((await storedView()).position.y).toBeCloseTo(beforeText.position.y, 1);
  const discussedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/contexts' && response.request().method() === 'POST');
  await viewer.getByRole('button', { name: 'Discuss selection', exact: true }).click();
  const discussed = await (await discussedResponse).json();
  expect(discussed.anchor.fileDigest).toBe((await reading()).document.fileDigest);
  expect(discussed.anchor.rects.length).toBeGreaterThan(0);
  await expect.poll(async () => (await chatState(page)).attachments.length).toBeGreaterThan(1);
  await expect(frame.locator('#paper-question')).toHaveCount(0);
  await closePaperChat(page, frame);
  await page.screenshot({ path: resolve(out, 'pdf-selection-context.png') });
  await viewer.getByRole('button', { name: 'Highlight', exact: true }).click();
  await expect.poll(async () => (await reading()).annotations.length).toBe(1);
  expect((await reading()).annotations[0].quote).toContain(fixture.quote);
  expect((await reading()).annotations[0].anchor.id).toBe(discussed.anchor.id);
  await expect(first.locator('[data-kind="highlight"]').first()).toBeVisible();
  await page.screenshot({ path: resolve(out, 'pdf-highlight.png') });
  await viewer.getByRole('button', { name: 'Close annotations', exact: true }).click();

  const targetPage = fixture.realPdf ? 3 : 2;
  await nav.getByRole('spinbutton', { name: 'Page', exact: true }).fill(String(targetPage));
  const target = viewer.locator(`[data-page-number="${targetPage}"]`);
  await expect(target.locator('img,canvas').first()).toBeVisible();
  await pdfAction(frame, 'Capture area');
  const region = await target.boundingBox();
  await page.mouse.move(region.x + region.width * .15, region.y + region.height * .15);
  await page.mouse.down(); await page.mouse.move(region.x + region.width * .7, region.y + region.height * .45, { steps: 20 }); await page.mouse.up();
  await expect.poll(async () => (await reading()).annotations.length).toBe(2);
  const result = await reading(), figure = result.annotations.find(item => item.kind === 'figure');
  const note = viewer.locator(`[data-note-id="${figure.id}"]`), image = note.locator('img');
  await expect(image).toBeVisible(); expect(await image.evaluate(element => element.naturalWidth)).toBeGreaterThan(100);
  await page.screenshot({ path: resolve(out, 'pdf-figure.png') });
  await app.evaluate(savePaperClipboard);
  try {
    await note.getByRole('button', { name: 'Copy image', exact: true }).click();
    await expect(viewer.getByRole('status')).toContainText('Image copied');
    expect(await app.evaluate(({ clipboard }) => clipboard.has('image/png'))).toBe(true);
  } finally { await app.evaluate(async ({ clipboard }) => { if (globalThis.paperClipboard.length) await clipboard.write(globalThis.paperClipboard); else clipboard.clear(); delete globalThis.paperClipboard; }); }
  await note.getByRole('button', { name: 'Add to matrix', exact: true }).click();
  await note.getByRole('textbox', { name: 'Comparison field' }).fill('Method');
  await note.locator('.pa-pdf-matrix-field').getByRole('button', { name: 'Add to matrix', exact: true }).click();
  const cell = frame.locator(`[data-matrix-annotation="${figure.id}"]`);
  await expect(cell).toBeVisible(); await expect(cell.locator('img')).toBeVisible();
  await page.screenshot({ path: resolve(out, 'pdf-matrix.png') });
  await cell.getByRole('button', { name: `Page ${targetPage} ↗`, exact: true }).click();
  await expect(nav.getByRole('spinbutton', { name: 'Page', exact: true })).toHaveValue(String(targetPage));
  await expect(viewer.locator(`[data-annotation-id="${figure.id}"][data-focused="true"]`)).toBeVisible();
  await frame.getByRole('button', { name: 'Close research records', exact: true }).click();
  await nav.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await nav.getByRole('button', { name: 'Fit page', exact: true }).click();
  await setPaperAppearance(page, 'dark');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 800));
  await expect.poll(async () => frame.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await nav.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect.poll(async () => (await chatState(page)).appChatOpen).toBe(true);
  await expect(frame.locator('.pa-reading-main')).not.toHaveAttribute('inert', '');
  await page.screenshot({ path: resolve(out, 'pdf-dark-narrow.png') });
  await closePaperChat(page, frame);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await setPaperAppearance(page, 'light');

  // Reopening a previously viewed document must initialize the real viewport
  // before a search/citation can navigate it. A numeric plugin default leaves
  // EmbedPDF's initial gate closed despite a seemingly ready toolbar.
  await nav.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const savedZoom = await nav.getByRole('button', { name: 'Fit page', exact: true }).innerText();
  await backToLibrary(frame);
  await frame.locator('.pa-library-list .pero-list-open').filter({ has: frame.getByText(paper.title, { exact: true }) }).click();
  await expect(nav.getByRole('button', { name: 'Fit page', exact: true })).toHaveText(savedZoom);
  await expect(viewer.locator('img,canvas').first()).toBeVisible();
  await expect.poll(() => viewer.locator('.pa-pdf-viewport').evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && element.scrollHeight > 0;
  })).toBe(true);
  await page.screenshot({ path: resolve(out, 'pdf-restored-numeric-zoom.png') });
  await backToLibrary(frame);
  const unavailable = await post('/api/papers/import', { title: 'Synthetic unavailable PDF', sourceId: 'unavailable-pdf', url: 'https://example.invalid/source', pdfUrl: 'https://reader.example.org/retry.pdf', authors: [], contentKind: 'abstract', content: 'Synthetic source remains readable.' });
  await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
  await frame.locator('.pa-library-list .pero-list-open').filter({ has: frame.getByText(unavailable.title, { exact: true }) }).click();
  // Opening metadata cannot initiate acquisition; the old implicit-download
  // error is now an explicit Save action, while its abstract stays readable.
  await frame.locator('.pa-reader-tools').getByRole('button', { name: 'PDF', exact: true }).click();
  const unavailableSave = frame.getByRole('dialog', { name: 'Save copies', exact: true });
  await expect(unavailableSave.getByText(unavailable.title, { exact: true })).toBeVisible();
  await expect(unavailableSave.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
  const attempts = async () => {
    try { return (await readFile(resolve(profile, 'desktop/app-data/paper-agent/reader-retry-attempts.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  const savedLibrary = () => frame.locator('body').evaluate(async () => (await (await fetch('/api/library')).json()));
  expect(await attempts()).toEqual([]);
  expect((await savedLibrary()).bundles.some(bundle => bundle.seedUrl === unavailable.pdfUrl)).toBe(false);
  // Direct-PDF inspection is metadata-only and succeeds without a byte probe.
  // Confirm is the first authorization; only its real owner can report failure.
  await unavailableSave.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(unavailableSave.getByText('PDF download failed', { exact: true })).toBeVisible({ timeout: 15000 });
  const retry = unavailableSave.getByRole('button', { name: 'Retry PDF download', exact: true });
  await expect(retry).toBeEnabled();
  await expect(unavailableSave.getByRole('button', { name: 'Export copies', exact: true })).toBeDisabled();
  const retryBundle = (await savedLibrary()).bundles.find(bundle => bundle.seedUrl === unavailable.pdfUrl);
  expect(retryBundle.pdfDownloadIds).toHaveLength(1);
  expect(retryBundle.sourceDownloadIds).toEqual([]);
  const retryStatus = () => post('/api/research/pdf', { operation: 'status', bundleId: retryBundle.id, resourceId: retryBundle.pdfDownloadIds[0] });
  const failed = await retryStatus();
  expect(failed.status).toBe('failed'); expect(failed.receipt).toBeNull();
  expect(await attempts()).toEqual([{ url: unavailable.pdfUrl }]);
  await retry.click();
  await expect(unavailableSave.getByText('PDF downloaded; text extraction available', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(unavailableSave.getByRole('button', { name: 'Export copies', exact: true })).toBeEnabled();
  const recovered = await retryStatus();
  expect(recovered.status).toBe('completed'); expect(recovered.localAvailable).toBe(true);
  expect(recovered.receipt.requestUrl).toBe(unavailable.pdfUrl);
  expect(await attempts()).toEqual([{ url: unavailable.pdfUrl }, { url: unavailable.pdfUrl }]);
  // Deliberately do not export/associate the recovered local PDF with this
  // metadata paper: the unchanged abstract must still be readable afterwards.
  await unavailableSave.getByRole('button', { name: 'Close', exact: true }).click();
  expect(await frame.locator('body').evaluate(async (_element, id) => (await (await fetch(`/api/pdf?paperId=${id}`)).json()).document, unavailable.id)).toBeNull();
  await expect(frame.locator('.pa-source-text')).toContainText('Synthetic source remains readable.');
  await expect(frame.locator('.pa-pdf-reading [role="alert"]')).toHaveCount(0);
  await backToLibrary(frame);
  await exercisePdfSearch({ frame, page, out, realPdf: fixture.realPdf });
  await viewer.locator('img,canvas').first().evaluate(element => element.dataset.citationIdentity = 'retained');
  await nav.getByRole('button', { name: 'Ask', exact: true }).click();
  await fillPaperChat(page, fixture.realPdf ? 'attention mechanism' : 'Second page');
  await page.keyboard.press('Enter');
  await expect.poll(async () => frame.locator('body').evaluate(async () => (await (await fetch('/api/library')).json()).reports.some(report => report.title === 'PDF answer fixture')), { timeout: 30000 }).toBe(true);
  const saved = await frame.locator('body').evaluate(async () => (await (await fetch('/api/library')).json()).reports.find(report => report.title === 'PDF answer fixture'));
  await showPaperReport(frame, page, saved.intentId);
  await expect(frame.getByRole('heading', { name: 'PDF answer fixture', exact: true })).toBeVisible({ timeout: 30000 });
  await expect(frame.locator('.pa-turn-history .pa-citations button').first()).toContainText(/Page [0-9]+/);
  await frame.locator('.pa-turn-history .pa-report .pa-scientific').getByRole('button', { name: 'Citation evidence 1', exact: true }).click();
  await expect(viewer.locator('[data-citation-region="true"]').first()).toBeVisible();
  await expect(viewer.locator('[data-citation-identity="retained"]')).toHaveCount(1);
  await page.screenshot({ path: resolve(out, 'pdf-answer-citation.png') });
  await frame.getByRole('button', { name: 'Close research records', exact: true }).click();
  // Leave an actual selection for the existing full Desktop restart journey.
  await nav.getByRole('button', { name: 'Fit page', exact: true }).click();
  await nav.getByRole('spinbutton', { name: 'Page', exact: true }).fill('1');
  await expect(first).toHaveAttribute('data-selection-ready', 'true');
  const reopenBox = await first.boundingBox();
  await page.mouse.move(reopenBox.x + s.x1 * reopenBox.width, reopenBox.y + s.y * reopenBox.height);
  await page.mouse.down(); await page.mouse.move(reopenBox.x + s.x2 * reopenBox.width, reopenBox.y + s.y * reopenBox.height, { steps: 20 }); await page.mouse.up();
  await expect(viewer.getByRole('button', { name: 'Highlight', exact: true })).toBeVisible();
  await expect.poll(async () => (await storedView()).selection).not.toBeNull();
  return { paper, figure, fileDigest: result.document.fileDigest, targetPage, readerState: await storedView() };
}

export async function reopenPdf({ frame, saved, page }) {
  await frame.locator('.pa-library-list .pero-list-open').filter({ has: frame.getByText(saved.paper.title, { exact: true }) }).click();
  const viewer = frame.getByRole('region', { name: 'PDF reader', exact: true });
  await expect(viewer.getByRole('button', { name: 'Highlight', exact: true })).toBeVisible();
  await expect(frame.locator('.pa-reader-tools').getByRole('spinbutton', { name: 'Page', exact: true })).toHaveValue(String(saved.readerState.page));
  await expect(frame.locator('.pa-reader-tools').getByRole('button', { name: 'Fit page', exact: true })).toHaveText(`${Math.round(saved.readerState.zoom * 100)}%`);
  const restored = await frame.locator('body').evaluate((_element, key) => JSON.parse(localStorage.getItem(key)), `pero.paper.pdf-view:${saved.readerState.documentId}:${saved.fileDigest}`);
  expect(restored.selection).toEqual(saved.readerState.selection);
  await askPaperChat(frame, page, frame.getByRole('button', { name: 'Ask', exact: true }));
  await closePaperChat(page, frame);
  await frame.locator('.pa-reading-bar').getByRole('button', { name: 'Research record', exact: true }).click();
  await frame.locator('.pa-output-matrix>summary').click();
  const cell = frame.locator(`[data-matrix-annotation="${saved.figure.id}"]`);
  await expect(cell).toBeVisible();
  await cell.getByRole('button', { name: `Page ${saved.targetPage} ↗`, exact: true }).click();
  await expect(frame.locator('.pa-reader-tools').getByRole('spinbutton', { name: 'Page', exact: true })).toHaveValue(String(saved.targetPage));
  await expect(frame.locator(`[data-annotation-id="${saved.figure.id}"]`)).toBeVisible();
  const reading = await frame.locator('body').evaluate(async (_element, id) => (await fetch(`/api/pdf?paperId=${id}`)).json(), saved.paper.id);
  expect(reading.document.fileDigest).toBe(saved.fileDigest); expect(reading.annotations).toHaveLength(2);
}

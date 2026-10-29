import { exercisePdfSearch } from './paper-search-flow.mjs';
import { expect } from '@playwright/test';
import { resolve } from 'node:path';
export async function setPaperAppearance(page, appearance) {
  await page.evaluate(value => {
    const state = JSON.parse(window.peroDiagnostics.snapshot());
    return window.pero.sessionCommand({ method: 'settings.workbench', preferences: { ...state.preferences, appearance: value } });
  }, appearance);
  await expect.poll(async () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).preferences.appearance)).toBe(appearance);
}
export async function backToLibrary(frame) {
  const close = frame.getByRole('button', { name: 'Close Agent', exact: true });
  if (await close.isVisible()) await close.click();
  const back = frame.locator('.pa-reading-bar').getByRole('button', { name: 'Back to library', exact: true });
  if (await back.isVisible()) await back.click();
}
export async function pdfAction(frame, name) {
  const viewer = frame.getByRole('region', { name: 'PDF reader', exact: true });
  await viewer.focus(); await viewer.press('Shift+F10');
  await viewer.getByRole('menuitem', { name, exact: true }).click();
}
export async function exercisePdf({ frame, page, app, out, fixture }) {
  const post = (path, body) => frame.locator('body').evaluate(async (_element, { path, body }) => {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value = await response.json(); if (!response.ok) throw new Error(JSON.stringify(value)); return value;
  }, { path, body });
  await backToLibrary(frame);
  const paper = await post('/api/papers/import', { title: fixture.realPdf ? 'Attention Is All You Need · PDF' : 'Synthetic PDF reading', sourceId: '1706.03762',
    url: 'https://arxiv.org/abs/1706.03762', pdfUrl: 'https://arxiv.org/pdf/1706.03762', authors: [], contentKind: 'full-text', content: fixture.text });
  await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
  await frame.getByRole('button', { name: paper.title, exact: true }).click();
  const viewer = frame.getByRole('region', { name: 'PDF reader', exact: true }), nav = frame.locator('.pa-reading-bar');
  await expect(viewer).toBeVisible({ timeout: 30000 });
  await expect(frame.getByRole('complementary', { name: 'Ask', exact: true })).toHaveCount(0);
  await expect(frame.locator('.pa-library-screen')).not.toBeVisible();
  await expect(frame.getByRole('tab')).toHaveCount(0);
  const first = viewer.locator('[data-page-number="1"]');
  await expect(first.locator('img,canvas').first()).toBeVisible({ timeout: 30000 });
  await expect(first).toHaveAttribute('data-selection-ready', 'true', { timeout: 30000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await nav.getByRole('button', { name: 'Fit page', exact: true }).click();
  await expect.poll(async () => { const pageBox = await first.boundingBox(), viewport = await viewer.locator('.pa-pdf-viewport').boundingBox(); return pageBox.height <= viewport.height + 1 && pageBox.width <= viewport.width + 1; }).toBe(true);
  await page.screenshot({ path: resolve(out, 'reading-first-1440.png') });
  const reading = () => frame.locator('body').evaluate(async (_element, id) => (await fetch(`/api/pdf?paperId=${id}`)).json(), paper.id);
  expect((await reading()).document.pages).toHaveLength(fixture.pages);
  // Real pointer selection. Opening/closing Ask must keep the same PDF image and selection.
  const box = await first.boundingBox(), s = fixture.selection;
  await page.mouse.move(box.x + s.x1 * box.width, box.y + s.y * box.height);
  await page.mouse.down(); await page.mouse.move(box.x + s.x2 * box.width, box.y + s.y * box.height, { steps: 20 }); await page.mouse.up();
  await expect(viewer.getByRole('button', { name: 'Highlight', exact: true })).toBeVisible();
  await first.locator('img,canvas').first().evaluate(element => element.dataset.readingIdentity = 'retained');
  const zoom = await nav.getByRole('button', { name: 'Fit page', exact: true }).innerText();
  await nav.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(frame.getByRole('complementary', { name: 'Ask', exact: true })).toBeVisible();
  await expect(first.locator('img,canvas').first()).toHaveAttribute('data-reading-identity', 'retained');
  await expect(nav.getByRole('button', { name: 'Fit page', exact: true })).toHaveText(zoom);
  await frame.getByRole('button', { name: 'Close Agent', exact: true }).click();
  await expect(viewer.getByRole('button', { name: 'Highlight', exact: true })).toBeVisible();
  await viewer.getByRole('button', { name: 'Discuss selection', exact: true }).click();
  await expect(frame.locator('.pa-question-context')).toContainText(fixture.quote);
  await frame.getByRole('button', { name: 'Close Agent', exact: true }).click();
  await viewer.getByRole('textbox', { name: 'Note (optional)' }).fill('Saved source evidence');
  await viewer.getByRole('button', { name: 'Highlight', exact: true }).click();
  await expect.poll(async () => (await reading()).annotations.length).toBe(1);
  expect((await reading()).annotations[0].quote).toContain(fixture.quote);
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
  await app.evaluate(async ({ clipboard, ClipboardItem }) => { globalThis.paperClipboard = await Promise.all((await clipboard.read()).map(async item => new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)])))))); });
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
  await frame.getByRole('button', { name: 'Close Agent', exact: true }).click();
  await nav.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await nav.getByRole('button', { name: 'Fit page', exact: true }).click();
  await setPaperAppearance(page, 'dark');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 800));
  await expect.poll(async () => frame.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await nav.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(frame.locator('.pa-reading-main')).toHaveAttribute('inert', '');
  await expect(frame.getByRole('textbox', { name: 'Research question', exact: true })).toBeFocused();
  await page.screenshot({ path: resolve(out, 'pdf-dark-narrow.png') });
  await frame.getByRole('button', { name: 'Close Agent', exact: true }).press('Escape');
  await expect(nav.getByRole('button', { name: 'Ask', exact: true })).toBeFocused();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await setPaperAppearance(page, 'light');

  await backToLibrary(frame);
  const unavailable = await post('/api/papers/import', { title: 'Synthetic unavailable PDF', sourceId: 'unavailable-pdf', url: 'https://example.invalid/source', pdfUrl: 'https://example.invalid/paper.pdf', authors: [], contentKind: 'abstract', content: 'Synthetic source remains readable.' });
  await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
  await frame.getByRole('button', { name: unavailable.title, exact: true }).click();
  await expect(frame.locator('.pa-pdf-reading [role="alert"]')).toContainText('PDF URL');
  await expect(frame.locator('.pa-pdf-reading').getByRole('button', { name: 'Retry', exact: true })).toBeEnabled();
  await frame.getByRole('button', { name: 'Text', exact: true }).click();
  await expect(frame.locator('.pa-source-text')).toContainText('Synthetic source remains readable.');
  await expect(frame.locator('.pa-pdf-reading [role="alert"]')).toHaveCount(0);
  await backToLibrary(frame);
  await exercisePdfSearch({ frame, page, out, realPdf: fixture.realPdf });
  await viewer.locator('img,canvas').first().evaluate(element => element.dataset.citationIdentity = 'retained');
  await nav.getByRole('button', { name: 'Ask', exact: true }).click();
  if (await frame.getByRole('button', { name: 'Remove selection', exact: true }).count()) await frame.getByRole('button', { name: 'Remove selection', exact: true }).click();
  await frame.getByRole('button', { name: 'Research settings', exact: true }).click();
  await frame.getByLabel('Agent', { exact: true }).selectOption('paper-fixture');
  await frame.getByRole('button', { name: 'Research settings', exact: true }).click();
  await frame.getByRole('textbox', { name: 'Research question', exact: true }).fill(fixture.realPdf ? 'attention mechanism' : 'Second page');
  await frame.getByRole('button', { name: 'Send question', exact: true }).click();
  await expect(frame.getByRole('heading', { name: 'PDF answer fixture', exact: true })).toBeVisible({ timeout: 30000 });
  await frame.locator('.pa-turn .pa-report .pa-scientific').getByRole('button', { name: 'Citation evidence 1', exact: true }).click();
  await expect(viewer.locator('[data-citation-region="true"]').first()).toBeVisible();
  await expect(viewer.locator('[data-citation-identity="retained"]')).toHaveCount(1);
  await page.screenshot({ path: resolve(out, 'pdf-answer-citation.png') });
  await frame.getByRole('button', { name: 'Close Agent', exact: true }).click();
  return { paper, figure, fileDigest: result.document.fileDigest, targetPage };
}

export async function reopenPdf({ frame, saved }) {
  await frame.getByRole('button', { name: saved.paper.title, exact: true }).click();
  await frame.getByRole('button', { name: 'Ask', exact: true }).click();
  await frame.locator('.pa-output-matrix>summary').click();
  const cell = frame.locator(`[data-matrix-annotation="${saved.figure.id}"]`);
  await expect(cell).toBeVisible();
  await cell.getByRole('button', { name: `Page ${saved.targetPage} ↗`, exact: true }).click();
  await expect(frame.locator('.pa-reading-bar').getByRole('spinbutton', { name: 'Page', exact: true })).toHaveValue(String(saved.targetPage));
  await expect(frame.locator(`[data-annotation-id="${saved.figure.id}"]`)).toBeVisible();
  const reading = await frame.locator('body').evaluate(async (_element, id) => (await fetch(`/api/pdf?paperId=${id}`)).json(), saved.paper.id);
  expect(reading.document.fileDigest).toBe(saved.fileDigest); expect(reading.annotations).toHaveLength(2);
}

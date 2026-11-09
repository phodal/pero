import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';

/** Actual Notebook/SQLite + native PDFium, no substitute parser response. */
export async function verifySourceExtraction(page, origin, output) {
  const fixture = spawnSync(process.env.PERO_SOURCE_TEST_PYTHON || 'python3', ['-c', "import json,sys; sys.path.insert(0,'apps/notebook/test'); from test_source_extraction import request,pdf_bytes; print(json.dumps(request(pdf_bytes(),'application/pdf','original.pdf')['file']))"], { cwd: fileURLToPath(new URL('../../..', import.meta.url)), encoding: 'utf8' });
  assert.equal(fixture.status, 0, fixture.stderr);
  const file = JSON.parse(fixture.stdout);
  const post = async (path, body) => { const response = await page.request.post(origin + path, { data: body }); assert.equal(response.ok(), true, await response.text()); return response.json(); };
  const get = async path => { const response = await page.request.get(origin + path); assert.equal(response.ok(), true, await response.text()); return response.json(); };
  const entry = await post('/api/entries', { document: { schemaVersion: 1, title: 'Local PDF extraction acceptance', content: { type: 'doc', content: [
    { type: 'attachment', attrs: { blockId: 'original', ...file, caption: '' } }, { type: 'sourceExcerpt', attrs: { blockId: 'excerpt', label: 'PDF quote', excerpt: null } },
  ] } } });
  await page.evaluate(id => { location.hash = `notebook-entry=${id}`; }, entry.id);
  const button = (name, scope = page) => scope.getByRole('button', { name, exact: true });
  await expect(page.getByRole('textbox', { name: 'Notebook title', exact: true })).toHaveValue('Local PDF extraction acceptance', { timeout: 15000 });
  const block = page.locator('[data-kind=sourceExcerpt]');
  await button('Configure source excerpt', block).click();
  const dialog = page.getByRole('dialog');
  await button('Source attachment', dialog).click(); await page.getByRole('option', { name: 'original.pdf · application/pdf', exact: true }).click();
  await expect(dialog.getByLabel('Source text (read-only)', { exact: true })).toHaveCount(0);
  const extracting = page.waitForResponse(response => response.url() === origin + '/api/source-extraction' && response.request().method() === 'POST');
  await button('Extract source locally / 本地提取来源', dialog).click();
  const response = await extracting; assert.equal(response.ok(), true, await response.text());
  const result = await response.json(); assert.equal(result.text, 'Sample 42 mg');
  await expect(dialog.getByLabel('Source text (read-only)', { exact: true })).toHaveValue(result.text);
  await dialog.getByLabel('Start offset (codepoints, inclusive)', { exact: true }).fill('7');
  await dialog.getByLabel('End offset (codepoints, exclusive)', { exact: true }).fill('9');
  await button('Insert source excerpt', dialog).click();
  await expect(block).toContainText('Retained text integrity verified.');
  await expect(block).toContainText('Original attachment is available and unchanged.');
  await button('Save revision').click(); await expect(page.locator('.notebook-status')).toHaveText('Revision 2');
  const saved = await get(`/api/entries/${entry.id}`), retained = saved.document.content.content.find(node => node.type === 'sourceExcerpt').attrs.excerpt;
  assert.equal(retained.quote, '42'); assert.equal(retained.source.sha256, file.sha256); assert.equal(retained.extraction.textSha256, result.extraction.textSha256);
  assert.equal(retained.extraction.segments[0].page, 1); assert.equal(retained.extraction.parser.name, 'pdfium/pypdfium2');
  await page.reload(); await expect(block).toContainText('Retained text integrity verified.');
  const downloading = page.waitForEvent('download'); await button('Download retained source', block).click();
  const download = await downloading; assert.equal(download.suggestedFilename(), 'original.pdf.extracted.txt');
  const chunks = []; for await (const chunk of await download.createReadStream()) chunks.push(chunk); assert.equal(Buffer.concat(chunks).toString(), result.text);
  await page.screenshot({ path: resolve(output, 'source-extraction-light.png'), fullPage: true });
  await page.setViewportSize({ width: 600, height: 900 });
  await page.evaluate(() => window.postMessage({ type: 'pero:app:context', context: { locale: 'en', dark: true, active: true } }, location.origin));
  await page.screenshot({ path: resolve(output, 'source-extraction-narrow-dark.png'), fullPage: true });
  await page.setViewportSize({ width: 1320, height: 950 });
  await page.evaluate(() => window.postMessage({ type: 'pero:app:context', context: { locale: 'en', dark: false, active: true } }, location.origin));
}

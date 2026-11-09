import { createNotebook, openNotebookMenu } from './notebook-browser-actions.mjs';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';

/** Real Notebook/SQLite flow. Host theme transport only; no inventory or diagnostic data fixtures. */
export async function verifyDiagnosticsAndIntake(page, origin, output) {
  const button = (name, scope = page) => scope.getByRole('button', { name, exact: true });
  const insert = async name => { await button('Insert').click(); await page.getByRole('menuitem', { name, exact: true }).click(); };
  await page.setViewportSize({ width: 1320, height: 950 });
  await page.evaluate(() => window.postMessage({ type: 'pero:app:context', context: { locale: 'en', dark: false, active: true } }, location.origin));
  await createNotebook(page, origin, 'Diagnostics and sample propagation');
  const notes = page.locator('.notebook-editor [contenteditable=true]').first();
  await notes.fill('Clipboard acceptance text');
  await openNotebookMenu(page, 'help');
  await button('Editor diagnostics').click();
  const diagnostics = page.getByRole('region', { name: 'Editor diagnostics', exact: true });
  await notes.click(); await page.keyboard.press('End'); await page.keyboard.type(' and live edit');
  await diagnostics.getByLabel('Inspect', { exact: true }).selectOption('performance');
  await expect(diagnostics).toContainText('document changes');
  await diagnostics.getByLabel('Inspect', { exact: true }).selectOption('paste');
  const oldText = await notes.innerText();
  // ClipboardEvent is dispatched through the actual DOM/Tiptap handlers, not injected as a diagnostic record.
  const paste = async locator => locator.evaluate(element => {
    const data = new DataTransfer(); data.setData('text/plain', 'Clipboard probe'); data.setData('text/html', '<p><strong>Clipboard probe</strong></p>');
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await paste(diagnostics.getByRole('textbox', { name: 'Paste here to inspect without changing the notebook' }));
  await expect(notes).toHaveText(oldText);
  await expect(diagnostics).toContainText('"documentChanged": false');
  await paste(notes); await expect(notes).toContainText('Clipboard probe');
  await expect(diagnostics).toContainText('"documentChanged": true');
  await diagnostics.getByLabel('Inspect', { exact: true }).selectOption('capabilities');
  await diagnostics.getByRole('textbox', { name: 'Search capability names, owners and contracts' }).fill('sampleIntake');
  await expect(diagnostics).toContainText('sampleIntake · node');
  await page.screenshot({ path: resolve(output, 'diagnostics-runtime-capabilities.png'), fullPage: true });
  await button('Close diagnostics').click();

  // Seed genuine local registered records via the same documented backend operation as the registration table.
  const columns = [{ id: 'name', name: 'Name', type: 'text', required: true, options: [], units: [] }, { id: 'box', name: 'Storage box', type: 'text', required: true, options: [], units: [] }];
  const registered = await page.request.post(origin + '/api/catalog/register', { data: { submissionId: 'diagnostic-intake-registration', table: {
    id: 'diagnostic-intake-table', name: 'Diagnostic intake samples', schema: { id: 'diagnostic-intake-schema', revision: 1, columns },
    rows: [{ id: 'row-a', cells: { name: 'Stored sample A', box: 'Freezer A' } }, { id: 'row-b', cells: { name: 'Stored sample B', box: 'Freezer B' } }],
  } } });
  assert.equal(registered.ok(), true, await registered.text());
  await insert('Sample intake'); await insert('Sample intake');
  const source = page.locator('[data-kind=sampleIntake]').nth(0), destination = page.locator('[data-kind=sampleIntake]').nth(1);
  await source.getByRole('textbox', { name: 'Batch name', exact: true }).fill('Source batch');
  await destination.getByRole('textbox', { name: 'Batch name', exact: true }).fill('Destination batch');
  await source.getByLabel('Schema ID (optional)', { exact: true }).fill('diagnostic-intake-schema');
  await source.locator('summary').filter({ hasText: 'Browse local samples and boxes' }).click();
  await button('Load catalog records', source).click();
  await source.getByLabel('Box / location text column').selectOption('box');
  await source.getByLabel('Box / location value').selectOption('Freezer A');
  await button('Select displayed samples', source).click();
  await expect(button('Export review worklist CSV', source)).toBeVisible();
  const download = page.waitForEvent('download'); await button('Export review worklist CSV', source).click();
  const chunks = []; for await (const chunk of await (await download).createReadStream()) chunks.push(chunk);
  const csv = Buffer.concat(chunks).toString('utf8'); assert.match(csv, /Stored sample A/); assert.doesNotMatch(csv, /Stored sample B/); assert.match(csv, /"version"/);
  await source.locator('summary').filter({ hasText: 'Propagate selected source bindings' }).click();
  await source.getByLabel('Destination intake block').selectOption({ label: 'Destination batch' });
  await button('Stage propagation', source).click(); await button('Cancel staged propagation', source).click();
  await expect(destination).toContainText('No selected records yet.');
  await button('Stage propagation', source).click();
  await destination.getByRole('textbox', { name: 'Batch name', exact: true }).fill('Changed destination');
  await button('Apply staged bindings', source).click(); await expect(source).toContainText('Source or destination changed.');
  await button('Stage propagation', source).click(); await button('Apply staged bindings', source).click();
  await expect(destination).toContainText('Stored sample A');
  await button('Save revision').click(); await expect(page.locator('.notebook-status')).toHaveText('Revision 2');
  await page.reload(); await expect(page.locator('[data-kind=sampleIntake]').nth(1)).toContainText('Stored sample A');
  await page.evaluate(() => window.postMessage({ type: 'pero:app:context', context: { locale: 'en', dark: true, active: true } }, location.origin));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'pero-dark');
  await page.setViewportSize({ width: 600, height: 900 });
  await page.screenshot({ path: resolve(output, 'sample-propagation-narrow-dark.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
}

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { createNotebook } from './notebook-browser-actions.mjs';

/** Real backend validation, history, persistence, and source-distinct authored cards. */
export async function verifyReferenceControls(page, origin, output) {
  const button = (name, scope = page) => scope.getByRole('button', { name, exact: true });
  await page.setViewportSize({ width: 1320, height: 950 });
  const entry = await createNotebook(page, origin, 'Original working draft');
  const title = () => page.getByRole('textbox', { name: 'Notebook title', exact: true });
  const body = () => page.getByRole('textbox', { name: 'Notebook content', exact: true });
  await body().fill('Keep these observations.');
  await page.getByRole('tab', { name: 'Relevant items', exact: true }).click();
  await expect(page.getByText('No relevant items yet', { exact: true })).toBeVisible();
  await button('Add named reference').filter({ visible: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Named reference', exact: true });
  await expect(button('Apply reference', dialog)).toBeDisabled();
  await dialog.getByLabel('Reference name', { exact: true }).fill('Calibration checklist');
  await expect(button('Apply reference', dialog)).toBeDisabled();
  await dialog.getByLabel('Reference notes', { exact: true }).fill('Measure the blank before the sample.');
  await button('Apply reference', dialog).click();
  await expect(page.locator('.notebook-relevant-list')).toContainText('Calibration checklist');
  await expect(page.locator('.notebook-relevant-list')).toContainText('Human-authored entry');
  await button('Open block in Notes').click();
  await expect(page.locator('[data-kind=namedReference]')).toContainText('Measure the blank');
  await button('Insert dated section').click();
  dialog = page.getByRole('dialog', { name: 'Dated section', exact: true });
  await expect(button('Insert dated section', dialog)).toBeDisabled();
  await dialog.getByLabel('Section date', { exact: true }).fill('2026-11-09');
  await dialog.getByLabel('Section name', { exact: true }).fill('Calibration day');
  await button('Insert dated section', dialog).click();
  await expect(page.locator('footer[aria-label="Notebook status"]')).toContainText('Sections: 1');
  await button('Undo', page).click(); await expect(page.locator('[data-kind=section]')).toHaveCount(0);
  await button('Redo', page).click(); await expect(page.locator('[data-kind=section]')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Metadata', exact: true }).click();
  await page.getByLabel('Project label', { exact: true }).fill('Current project');
  const documentActions = page.locator('summary', { hasText: 'Replace or restore document' });
  await documentActions.click();
  await button('Restore Pero example').click();
  dialog = page.getByRole('dialog', { name: 'Restore Pero example', exact: true });
  await button('Cancel', dialog).click(); await expect(title()).toHaveValue('Original working draft');
  await button('Restore Pero example').click();
  await button('Replace with example').click();
  await expect(title()).toHaveValue('Pero research notebook example');
  await expect(page.getByRole('tab', { name: 'Notes', exact: true })).toHaveAttribute('aria-selected', 'true');
  await button('Undo').click(); await expect(title()).toHaveValue('Original working draft');
  await expect(page.locator('[data-kind=namedReference]')).toContainText('Calibration checklist');
  await page.getByRole('tab', { name: 'Metadata', exact: true }).click(); await expect(page.getByLabel('Project label', { exact: true })).toHaveValue('Current project');
  await page.getByRole('tab', { name: 'Notes', exact: true }).click();
  await button('Redo').click(); await expect(title()).toHaveValue('Pero research notebook example');
  // Select via the labelled native file input, avoiding the separate-entry import.
  const choose = async (value) => {
    if (!await documentActions.evaluate(node => node.parentElement?.open)) await documentActions.click();
    await page.locator('.notebook-document-actions input[type=file][accept=".json,application/json"]').setInputFiles({ name: 'replacement.json', mimeType: 'application/json', buffer: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)) });
  };
  await choose('{bad json'); await expect(page.getByRole('alert').filter({ hasText: /JSON/ })).toBeVisible();
  await expect(title()).toHaveValue('Pero research notebook example');
  await choose({ schemaVersion: 1, title: 'Invalid', content: { type: 'doc', content: [{ type: 'unknown' }] } });
  await expect(page.getByRole('alert').filter({ hasText: /Invalid|Unsupported/ })).toBeVisible();
  await expect(title()).toHaveValue('Pero research notebook example');
  const replacement = { schemaVersion: 1, title: 'Imported current document', content: { type: 'doc', content: [
    { type: 'namedReference', attrs: { blockId: 'imported-card', name: 'Imported preparation', notes: 'Recorded without a source ID.', kind: 'entry' } },
    { type: 'spreadsheet', attrs: { blockId: 'imported-sheet', label: 'Measurements', sheet: { rows: 1, columns: 1, cells: { A1: '=2+3' } } } },
    { type: 'paragraph', attrs: { blockId: 'tail' } },
  ] } };
  await choose(replacement); await expect(title()).toHaveValue(replacement.title);
  await expect(page.getByText(/Current document replaced/)).toBeVisible();
  assert.equal((await (await page.request.get(origin + '/api/entries')).json()).entries.filter(item => item.id === entry.id).length, 1);
  await button('Undo').click(); await expect(title()).toHaveValue('Pero research notebook example');
  await button('Redo').click(); await expect(title()).toHaveValue(replacement.title);
  await page.locator('[data-kind=spreadsheet] [data-cell=A1]').click();
  await button('Toggle active formula inspector').click();
  await expect(page.locator('.notebook-formula-inspector')).toBeVisible();
  await button('Toggle active formula inspector').click();
  await expect(page.locator('.notebook-formula-inspector')).toHaveCount(0);
  const saving = page.waitForResponse(response => response.url() === `${origin}/api/entries/${entry.id}` && response.request().method() === 'POST');
  await button('Save revision').click(); assert.ok((await saving).ok()); await expect(button('Save revision')).toBeDisabled();
  const saved = await (await page.request.get(`${origin}/api/entries/${entry.id}`)).json();
  assert.equal(saved.document.content.content[0].attrs.notes, 'Recorded without a source ID.');
  assert.equal(saved.document.metadata, undefined);
  await page.reload(); await expect(title()).toHaveValue(replacement.title);
  await expect(page.locator('[data-kind=namedReference]')).toContainText('Imported preparation');
  await button('Notebook tools', page).click();
  const download = page.waitForEvent('download'); await page.getByRole('menuitem', { name: 'Export current JSON', exact: true }).click();
  const exported = await download; await exported.saveAs(resolve(output, 'named-reference-export.json'));
  const { readFile } = await import('node:fs/promises');
  const roundtrip = JSON.parse(await readFile(resolve(output, 'named-reference-export.json'), 'utf8'));
  assert.equal(roundtrip.content.content[0].attrs.kind, 'entry'); assert.equal(roundtrip.content.content[0].attrs.name, 'Imported preparation');
  await page.screenshot({ path: resolve(output, 'named-reference-controls.png'), fullPage: true });
}

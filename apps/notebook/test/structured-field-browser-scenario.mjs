import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';

/** Real HTTP/SQLite acceptance, called by the Notebook browser harness. */
export async function verifyStructuredFieldWorkflows(page, origin, output) {
  const button = (name, scope = page) => scope.getByRole('button', { name, exact: true });
  const request = async (path, body) => {
    const response = body === undefined ? await page.request.get(origin + path) : await page.request.post(origin + path, { data: body });
    assert.equal(response.ok(), true, await response.text()); return response.json();
  };
  const columns = [
    { id: 'name', name: 'Name', type: 'text', required: true, options: [], units: [] },
    { id: 'mass', name: 'Mass', type: 'quantity', required: false, options: [], units: ['mg', 'µg'] },
    { id: 'ref', name: 'Reference', type: 'object', required: false, options: [], units: [] },
  ];
  const source = { id: 'field-source', name: 'Field source', schema: { id: 'field-source-schema', revision: 1, columns }, rows: [{ id: 'source-row', cells: { name: 'Registered source', mass: '0.50 µg' } }] };
  const sourceReceipt = await request('/api/catalog/register', { submissionId: 'field-source-registration', table: source });
  const target = { id: 'field-target', name: 'Field target', schema: { id: 'field-target-schema', revision: 1, columns }, rows: [
    { id: 'target-a', cells: { name: 'First', mass: '1.20 mg' } }, { id: 'target-b', cells: { name: 'Second', ref: '{"manual":true}' } },
  ] };
  const entry = await request('/api/entries', { document: { schemaVersion: 1, title: 'Registration field workflow acceptance', content: { type: 'doc', content: [
    { type: 'registrationTable', attrs: { blockId: 'field-registration', table: target, receipts: [] } },
  ] } } });
  await page.setViewportSize({ width: 1320, height: 950 }); await page.reload();
  await expect(page.getByRole('textbox', { name: 'Notebook title' })).toHaveValue(entry.document.title);
  const table = page.locator('[data-kind=registrationTable]');
  await table.getByLabel('Mass, Row 1 unit', { exact: true }).selectOption('µg');
  await expect(table.getByLabel('Mass, Row 1', { exact: true })).toHaveValue('1.20');
  await table.getByLabel('After registration, fill references into', { exact: true }).selectOption('ref');
  await button('Submit rows to local catalog', table).click();
  await expect(table.getByText('The local catalog committed 2 records. Any filled references belong to this draft; save the entry to retain them.', { exact: true })).toBeVisible();
  const registered = await request('/api/catalog/lookup?schemaId=field-target-schema');
  const ref = JSON.parse(await table.getByLabel('Reference, Row 1', { exact: true }).inputValue());
  const committed = registered.records.find(record => record.rowId === 'target-a');
  assert.equal(ref.catalogId, registered.catalogId); assert.equal(ref.recordId, committed.id); assert.equal(ref.version, committed.version);
  assert.equal(committed.values.mass.value, '1.20'); assert.equal(committed.values.mass.unit, 'µg');
  assert.equal(committed.values.ref.type, 'missing', 'autofill must not silently submit a second catalog version');
  await expect(table.getByLabel('Reference, Row 2', { exact: true })).toHaveValue('{"manual":true}');
  await page.screenshot({ path: resolve(output, 'registration-autofill-light.png'), fullPage: true });

  const open = async label => {
    await button(`Choose catalog value for ${label}`, table).click();
    const dialog = page.getByRole('dialog', { name: `Choose catalog value for ${label}`, exact: true });
    await dialog.getByLabel('Catalog schema filter', { exact: true }).fill(source.schema.id);
    await button('Load matching records', dialog).click();
    await dialog.getByLabel('Catalog record', { exact: true }).selectOption(sourceReceipt.records[0].recordId);
    return dialog;
  };
  let dialog = await open('Reference, Row 2');
  await button('Cancel', dialog).click();
  await expect(table.getByLabel('Reference, Row 2', { exact: true })).toHaveValue('{"manual":true}');
  dialog = await open('Reference, Row 2');
  await page.setViewportSize({ width: 720, height: 900 });
  await page.evaluate(() => window.postMessage({ type: 'pero:app:context', context: { locale: 'en', dark: true, active: true } }, location.origin));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'pero-dark');
  await page.screenshot({ path: resolve(output, 'registration-reference-picker-dark.png'), fullPage: true });
  await button('Apply selected value', dialog).click();
  const reference = JSON.parse(await table.getByLabel('Reference, Row 2', { exact: true }).inputValue());
  assert.equal(reference.recordId, sourceReceipt.records[0].recordId); assert.equal(reference.version, sourceReceipt.records[0].version);
  dialog = await open('Mass, Row 2');
  await dialog.getByLabel('Value to insert', { exact: true }).selectOption('field:mass');
  await button('Apply selected value', dialog).click();
  await expect(table.getByLabel('Mass, Row 2', { exact: true })).toHaveValue('0.50');
  await expect(table.getByLabel('Mass, Row 2 unit', { exact: true })).toHaveValue('µg');
  await expect(table.getByLabel('Name, Row 1', { exact: true })).toHaveValue('First');
  await button('Save revision').click();
  await expect(page.locator('.notebook-status')).toHaveText('Revision 2');
  const saved = await request('/api/entries/' + entry.id), savedAttrs = saved.document.content.content[0].attrs;
  assert.equal(savedAttrs.receipts.length, 1); assert.equal(savedAttrs.table.rows[1].cells.mass, '0.50 µg');
  assert.equal(JSON.parse(savedAttrs.table.rows[0].cells.ref).recordId, committed.id);
  await page.reload();
  await expect(table.getByLabel('Reference, Row 2', { exact: true })).toHaveValue(savedAttrs.table.rows[1].cells.ref);
  const imported = await request('/api/entries', { document: saved.document });
  assert.deepEqual(imported.document.content.content[0].attrs, savedAttrs, 'registered references and receipts survive export/import');
  await page.setViewportSize({ width: 1320, height: 950 });
  await page.evaluate(() => window.postMessage({ type: 'pero:app:context', context: { locale: 'en', dark: false, active: true } }, location.origin));
}

import { notebookTab } from './notebook-browser-actions.mjs';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';

/** Uses the existing authenticated Notebook/SQLite browser harness. */
export async function verifyProcedureParameters(page, origin, output) {
  const request = async (path, body) => {
    const response = body === undefined ? await page.request.get(origin + path) : await page.request.post(origin + path, { data: body });
    assert.equal(response.ok(), true, await response.text()); return response.json();
  };
  const column = { id: 'volume', name: 'Volume', type: 'quantity', required: true, options: [], units: ['mL'] };
  const parameter = (id, source, stepId) => ({ ...column, id, name: id, source, stepId, version: 1 });
  const step = id => ({ id, text: id, level: 'step', critical: false, pause: false, completed: false, minutes: null });
  const entry = await request('/api/entries', { document: { schemaVersion: 1, title: 'Procedure relationships acceptance', content: { type: 'doc', content: [
    { type: 'inputTable', attrs: { blockId: 'amounts', receipts: [], table: { id: 'table', name: 'Volumes', schema: { id: 'schema', revision: 1, columns: [column] }, rows: [{ id: 'sample', cells: { volume: '3 mL' } }] } } },
  ] }, procedures: [{ id: 'method', title: 'Dilution', description: '', materials: [], steps: [step('prepare'), step('dilute')], parameters: [
    parameter('input-volume', { kind: 'table', blockId: 'amounts', tableId: 'table', rowId: 'sample', columnId: 'volume', schemaId: 'schema', schemaRevision: 1, observedRevision: 1, column, raw: '2 mL' }, 'prepare'),
    parameter('total-volume', { kind: 'formula', expression: '=A1*2', bindings: [{ procedureId: 'method', parameterId: 'input-volume', version: 1, unit: 'mL' }], unit: 'mL' }, 'dilute'),
  ] }] } });
  const button = (name, scope = page) => scope.getByRole('button', { name, exact: true });
  await page.goto(`${origin}/#notebook-entry=${entry.id}&notebook-target=method`);
  await expect(notebookTab(page, 'Procedures')).toHaveAttribute('data-state', 'active');
  const source = page.locator('[data-parameter-id="input-volume"]'), total = page.locator('[data-parameter-id="total-volume"]');
  await expect(source).toContainText('Changed since binding'); await expect(total).toContainText('Changed since binding');
  await button('Edit parameter', source).click();
  const dialog = page.getByRole('dialog', { name: 'Edit parameter', exact: true });
  await button('Review current field', dialog).click(); await expect(dialog).toContainText('Selected snapshot: 3 mL');
  await expect(dialog).toContainText('Preview: Resolved: 3 mL');
  await button('Cancel', dialog).click(); await expect(source).toContainText('Changed since binding');
  await button('Edit parameter', source).click(); await button('Review current field', dialog).click(); await button('Apply parameter', dialog).click();
  await expect(source).toContainText('Resolved: 3 mL'); await expect(total).toContainText('Changed since binding');
  await button('Edit parameter', total).click(); await button('Review and repin references', dialog).click();
  await expect(dialog).toContainText('Preview: Resolved: 6 mL'); await button('Apply parameter', dialog).click(); await expect(total).toContainText('Resolved: 6 mL');
  await button('Save revision').click();
  await expect.poll(async () => (await request('/api/entries/' + entry.id)).revision).toBe(2);
  const saved = await request('/api/entries/' + entry.id);
  assert.equal(saved.document.procedures[0].parameters[0].source.raw, '3 mL');
  assert.equal(saved.document.procedures[0].parameters[0].version, 2);
  assert.equal(saved.document.procedures[0].parameters[1].source.bindings[0].version, 2);
  const prior = await request('/api/entries/' + entry.id + '/revisions/1'); assert.equal(prior.document.procedures[0].parameters[0].source.raw, '2 mL');
  await page.reload(); await expect(total).toContainText('Resolved: 6 mL');
  await page.screenshot({ path: resolve(output, 'procedure-parameters-light.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await expect(total).toBeVisible();
  await page.screenshot({ path: resolve(output, 'procedure-parameters-narrow-dark.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
}

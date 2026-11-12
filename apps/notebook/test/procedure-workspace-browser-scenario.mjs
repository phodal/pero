import { notebookTab, openNotebookView } from './notebook-browser-actions.mjs';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';

/** Execute through the authenticated browser/SQLite harness, never a fabricated inventory. */
export async function verifyProcedureWorkspace(page, origin, output) {
  const button = (name, scope = page) => scope.getByRole('button', { name, exact: true });
  const request = async (path, body) => {
    const response = body === undefined ? await page.request.get(origin + path) : await page.request.post(origin + path, { data: body });
    assert.equal(response.ok(), true, await response.text()); return response.json();
  };
  const rich = (id, text) => ({ type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: id }, content: [{ type: 'text', text }] }] });
  const receipt = await request('/api/catalog/register', { submissionId: 'procedure-material-submission', table: {
    id: 'procedure-material-table', name: 'Procedure materials', schema: { id: 'procedure-material-schema', revision: 1,
      columns: [{ id: 'name', name: 'Name', type: 'text', required: true, options: [], units: [] }] }, rows: [{ id: 'buffer-row', cells: { name: 'Procedure registered buffer' } }],
  } });
  const entry = await request('/api/entries', { document: { schemaVersion: 1, title: 'Rich procedure acceptance', content: rich('procedure-main', 'Original observation'), procedures: [
    { id: 'procedure-first', title: 'First method', description: 'Legacy introduction is retained until edited.', materials: [], steps: [] },
    { id: 'procedure-rich', title: 'Rich method', description: '', introduction: rich('procedure-intro', 'Cold handling'), materials: [{ id: 'procedure-mixture', name: 'Mixture', quantity: '2 mL' }], steps: [] },
  ] } });
  const link = `${origin}/#notebook-entry=${entry.id}&notebook-target=procedure-intro`;
  await page.goto(link);
  await expect(page.getByRole('button', { name: new RegExp(`${entry.document.title}.*Revision 1`) })).toBeVisible();
  await expect(notebookTab(page, 'Procedures')).toHaveAttribute('data-state', 'active');
  await expect(page.getByRole('textbox', { name: 'Procedure title', exact: true })).toHaveValue('Rich method');
  const introduction = page.getByRole('textbox', { name: 'Introduction', exact: true });
  await introduction.fill('Keep samples on ice before mixing.');
  const material = page.locator('[data-material-id="procedure-mixture"]');
  await button('Add component', material).click();
  const child = material.locator('[data-material-id]').first();
  await child.getByRole('textbox', { name: 'Quantity 1.1', exact: true }).fill('1 mL');
  await button('Select registered material', child).click();
  const picker = page.getByRole('dialog', { name: 'Select registered material', exact: true });
  await picker.getByRole('searchbox', { name: 'Search registered materials', exact: true }).fill('Procedure registered buffer');
  await button('Find records', picker).click();
  await button('Use Procedure registered buffer · v1', picker).click();
  await expect(child.getByRole('textbox', { name: 'Material 1.1', exact: true })).toHaveValue('Procedure registered buffer');
  await button('Add material notes', child).click();
  await child.getByRole('textbox', { name: 'Material notes 1.1', exact: true }).fill('Use freshly prepared buffer.');
  await openNotebookView(page, 'Notes');
  const notes = page.locator('.notebook-notes-panel .tiptap').first();
  await notes.fill('Unsaved observation retained through deep links');
  await page.evaluate(() => { location.hash = '#notebook-entry=' + new URLSearchParams(location.hash.slice(1)).get('notebook-entry') + '&notebook-target=procedure-mixture'; });
  await expect(notebookTab(page, 'Procedures')).toHaveAttribute('data-state', 'active');
  await expect(introduction).toHaveText('Keep samples on ice before mixing.');
  await openNotebookView(page, 'Notes');
  await expect(notes).toHaveText('Unsaved observation retained through deep links');
  await button('Save revision').click();
  await expect.poll(async () => (await request('/api/entries/' + entry.id)).revision).toBe(2);
  const saved = await request('/api/entries/' + entry.id);
  const protocol = saved.document.procedures[1], component = protocol.materials[0].children[0];
  assert.equal(component.source.recordId, receipt.records[0].recordId);
  assert.equal(component.source.catalogId, receipt.catalogId);
  assert.equal(component.source.version, 1); assert.equal(component.quantity, '1 mL');
  assert.equal(protocol.introduction.content[0].content[0].text, 'Keep samples on ice before mixing.');
  assert.equal(component.content.content[0].content[0].text, 'Use freshly prepared buffer.');
  const childBlock = component.content.content[0].attrs.blockId;
  await page.goto(`${origin}/#notebook-entry=${entry.id}&notebook-target=${childBlock}`);
  await page.reload();
  await expect(notebookTab(page, 'Procedures')).toHaveAttribute('data-state', 'active');
  await expect(page.getByRole('textbox', { name: 'Material notes 1.1', exact: true })).toHaveText('Use freshly prepared buffer.');
  await page.screenshot({ path: resolve(output, 'procedure-rich-materials-light.png'), fullPage: true });
  await openNotebookView(page, 'Notes');
  await expect(page.locator('.notebook-notes-panel .tiptap').first()).toHaveText('Unsaved observation retained through deep links');
  const original = await request('/api/entries/' + entry.id + '/revisions/1');
  assert.equal(original.document.procedures[1].materials[0].children, undefined);
}

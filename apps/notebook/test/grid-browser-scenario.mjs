import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { writeWorkbook } from '@pero/notebook/workbook';

/** Run after the existing saved-notebook scenarios, using their real backend and page. */
export async function verifyGridTools(page, origin) {
  await page.setViewportSize({ width: 1320, height: 950 });
  await page.getByRole('button', { name: 'New notebook', exact: true }).click();
  await page.getByRole('textbox', { name: 'Notebook title', exact: true }).fill('Grid tools acceptance');
  const workbook = await writeWorkbook([
    { name: 'Data', sheet: { rows: 4, columns: 3, cells: { A1: '=1/3', B1: '7', A2: '2', A3: '3', C4: 'tail' } } },
    { name: 'Dependent', sheet: { rows: 1, columns: 1, cells: { A1: '=Data!$A$2*3' } } },
  ]);
  await page.locator('input[type=file][accept=".xlsx"]').setInputFiles({ name: 'grid.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(workbook) });
  const tables = page.locator('[data-kind=spreadsheet]');
  await expect(tables).toHaveCount(2);
  const data = tables.nth(0), dependent = tables.nth(1);
  const cell = address => data.locator(`[data-cell=${address}]`);
  const tools = data.locator('summary').filter({ hasText: 'Worksheet tools' });
  await tools.click();
  await cell('A1').click();
  await data.getByRole('button', { name: 'Bold', exact: true }).click();
  await data.getByRole('button', { name: 'Italic', exact: true }).click();
  await data.getByRole('button', { name: 'Underline', exact: true }).click();
  await data.getByRole('button', { name: 'Decimal places', exact: true }).click();
  await page.getByRole('option', { name: '2', exact: true }).click();
  await expect(cell('A1')).toHaveValue('0.33');
  await expect(data.getByRole('textbox', { name: 'Cell formula or value' })).toHaveValue('=1/3');
  await expect(cell('A1').locator('..')).toHaveAttribute('data-bold', 'true');
  await data.getByRole('button', { name: 'Text color', exact: true }).click();
  await page.getByRole('option', { name: 'Green', exact: true }).click();
  await data.getByRole('button', { name: 'Alignment', exact: true }).click();
  await page.getByRole('option', { name: 'Right', exact: true }).click();
  await expect(cell('A1')).toHaveCSS('text-align', 'right');

  await cell('A2').click();
  await data.locator('summary').filter({ hasText: 'Cell details' }).click();
  await data.getByLabel('Unit', { exact: true }).fill('mL');
  const action = async name => {
    await data.getByRole('button', { name: 'Rows and columns', exact: true }).click();
    await page.getByRole('menuitem', { name, exact: true }).click();
  };
  await action('Insert row before');
  await expect(cell('A3')).toHaveValue('2');
  await expect(dependent.getByRole('textbox', { name: 'Cell formula or value' })).toHaveValue('=Data!$A$3*3');
  await expect(dependent.locator('[data-cell=A1]')).toHaveValue('6');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(cell('A2')).toHaveValue('2');
  await expect(dependent.getByRole('textbox', { name: 'Cell formula or value' })).toHaveValue('=Data!$A$2*3');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await cell('A3').click();
  await expect(data.getByLabel('Unit', { exact: true })).toHaveValue('mL');
  await action('Move row down');
  await expect(cell('A4')).toHaveValue('2');
  await expect(dependent.getByRole('textbox', { name: 'Cell formula or value' })).toHaveValue('=Data!$A$4*3');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await cell('A3').click();
  await action('Delete row');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(cell('A3')).toHaveValue('2');
  await action('Delete row');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dependent.locator('[data-cell=A1]')).toHaveValue('#REF!');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(dependent.locator('[data-cell=A1]')).toHaveValue('6');

  await cell('A1').click();
  await action('Resize column');
  await page.getByRole('dialog').getByLabel('Size in pixels').fill('180');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await action('Resize row');
  await page.getByRole('dialog').getByLabel('Size in pixels').fill('60');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  assert.ok((await cell('A1').locator('..').boundingBox()).width >= 180);
  assert.ok((await cell('A1').locator('../..').boundingBox()).height >= 60);
  await cell('A1').click();
  await cell('B1').click({ modifiers: ['Shift'] });
  const copied = await cell('B1').evaluate(input => {
    const clipboardData = new DataTransfer();
    input.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData }));
    return clipboardData.getData('text/plain');
  });
  assert.equal(copied, '=1/3\t7');
  await cell('B1').evaluate(input => input.dispatchEvent(new ClipboardEvent('cut', {
    bubbles: true, cancelable: true, clipboardData: new DataTransfer(),
  })));
  await expect(cell('A1')).toHaveValue('');
  await expect(cell('B1')).toHaveValue('');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(cell('A1')).toHaveValue('0.33');
  await expect(cell('B1')).toHaveValue('7');
  await cell('A1').click();
  await cell('B1').click({ modifiers: ['Shift'] });
  await data.getByRole('button', { name: 'Merge selected cells', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('All covered values');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(cell('B1')).toHaveCount(1);
  await data.getByRole('button', { name: 'Merge selected cells', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(cell('B1')).toHaveCount(0);
  await expect(cell('A1').locator('..')).toHaveAttribute('colspan', '2');
  await cell('A1').evaluate(input => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', '8\t9');
    input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
  });
  await expect(data.getByText('Unmerge the affected cells before pasting, filling or merging this range.')).toBeVisible();
  await expect(data.getByRole('textbox', { name: 'Cell formula or value' })).toHaveValue('=1/3');
  await page.getByRole('button', { name: 'Save revision', exact: true }).click();
  await expect(page.locator('.notebook-status')).toHaveText('Revision 2');
  const entries = await (await fetch(origin + '/api/entries')).json();
  const savedId = entries.entries.find(entry => entry.title === 'Grid tools acceptance').id;
  const saved = await (await fetch(`${origin}/api/entries/${savedId}`)).json();
  const savedData = saved.document.content.content.find(node => node.type === 'spreadsheet' && node.attrs.label === 'Data').attrs;
  assert.equal(savedData.sheet.cells.A1, '=1/3');
  assert.equal(savedData.sheet.cells.B1, '7');
  assert.equal(savedData.formats.A1.precision, 2);
  assert.equal(savedData.annotations.A3.unit, 'mL');
  assert.equal(savedData.columnWidths['0'], 180);
  assert.equal(savedData.rowHeights['0'], 60);
  assert.equal(savedData.merges.length, 1);
  await page.reload();
  await expect(cell('B1')).toHaveCount(0);
  await tools.click();
  await data.getByRole('button', { name: 'Unmerge cells', exact: true }).click();
  await expect(cell('B1')).toHaveValue('7');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(cell('B1')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(cell('B1')).toHaveValue('7');
  await cell('A1').click();
  await data.getByRole('button', { name: 'Clear formatting', exact: true }).click();
  await expect(cell('A1')).toHaveValue('0.3333333333333333');
  await dependent.getByRole('button', { name: 'Formula inspector', exact: true }).click();
  await expect(dependent.getByRole('region', { name: 'Formula inspector' })).toContainText('Data!A3');
  await expect(dependent.getByRole('region', { name: 'Formula inspector' })).toContainText('number');
  await data.getByRole('button', { name: 'Functions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Function search and help', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Search functions', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search functions', exact: true }).fill('XLOOKUP');
  await page.getByRole('option', { name: /XLOOKUP/ }).click();
  await expect(page.getByRole('dialog')).toContainText('XLOOKUP(value, keys, results');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(data.getByRole('textbox', { name: 'Cell formula or value' })).toHaveValue('=1/3');
  await data.getByRole('button', { name: 'Block actions', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export evaluated CSV', exact: true }).click();
  const download = await downloading, chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  assert.match(Buffer.concat(chunks).toString('utf8'), /^0\.3333333333333333,7,/);
  await page.getByRole('button', { name: 'Save revision', exact: true }).click();
  await expect(page.locator('.notebook-status')).toHaveText('Revision 3');
}

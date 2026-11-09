import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { writeWorkbook } from '@pero/notebook/workbook';
import { createNotebook, ensureMoreTools } from './notebook-browser-actions.mjs';

/** Real pointer/keyboard/layout acceptance, run in the existing backend/browser
 * fixture after other notebook scenarios. No new server or mock editor. */
export async function verifyDirectGridInteractions(page, origin) {
  await page.setViewportSize({ width: 1320, height: 950 });
  await createNotebook(page, origin, 'Direct grid interactions');
  const workbook = await writeWorkbook([
    { name: 'Data', sheet: { rows: 4, columns: 10, cells: { A1: '2', A2: '3', C1: '5', H1: 'tail', J4: '0' } } },
    { name: 'Dependent', sheet: { rows: 1, columns: 1, cells: { A1: '=Data!A1*3' } } },
  ]);
  await ensureMoreTools(page);
  await page.locator('input[type=file][accept=".xlsx"]').setInputFiles({ name: 'direct-grid.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(workbook) });
  const data = page.locator('[data-kind=spreadsheet]').nth(0), dependent = page.locator('[data-kind=spreadsheet]').nth(1);
  const cell = address => data.locator(`[data-cell=${address}]`);
  const formula = data.getByRole('textbox', { name: 'Cell formula or value', exact: true });
  const edge = label => data.getByRole('separator', { name: label, exact: true });
  const move = label => data.getByRole('button', { name: label, exact: true });
  const drag = async (from, to) => {
    await from.scrollIntoViewIfNeeded();
    const start = await from.boundingBox(), target = typeof to === 'function' ? to(start) : await to.boundingBox();
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
    await page.mouse.up();
  };
  await cell('A1').click();
  await data.locator('summary').filter({ hasText: 'Cell details' }).click();
  await data.getByLabel('Unit', { exact: true }).fill('mL');
  await drag(edge('Resize column A'), box => ({ ...box, x: box.x + 45 }));
  await expect(edge('Resize column A')).toHaveAttribute('aria-valuenow', '165');
  await drag(edge('Resize row 1'), box => ({ ...box, y: box.y + 18 }));
  await expect(edge('Resize row 1')).toHaveAttribute('aria-valuenow', '50');
  await cell('A1').click();
  await drag(move('Move row 1'), move('Move row 3'));
  await expect(cell('A3')).toHaveValue('2');
  await expect(dependent.getByRole('textbox', { name: 'Cell formula or value' })).toHaveValue('=Data!A3*3');
  await expect(data.locator('output')).toHaveText('A3');
  await expect(data.getByLabel('Unit', { exact: true })).toHaveValue('mL');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(cell('A1')).toHaveValue('2');
  await expect(edge('Resize column A')).toHaveAttribute('aria-valuenow', '165');
  await expect(edge('Resize row 1')).toHaveAttribute('aria-valuenow', '50');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await cell('A3').click();
  await drag(move('Move column A'), move('Move column C'));
  await expect(cell('C3')).toHaveValue('2');
  await expect(dependent.getByRole('textbox', { name: 'Cell formula or value' })).toHaveValue('=Data!C3*3');
  await expect(data.locator('output')).toHaveText('C3');
  await expect(edge('Resize column C')).toHaveAttribute('aria-valuenow', '165');
  await move('Move column C').press('ArrowLeft');
  await expect(cell('B3')).toHaveValue('2');
  await expect(data.locator('output')).toHaveText('B3');
  await edge('Resize column B').press('Shift+ArrowRight');
  await expect(edge('Resize column B')).toHaveAttribute('aria-valuenow', '175');
  // A cancelled drag has no persisted dimension change.
  const beforeCancel = await edge('Resize column B').boundingBox();
  await page.mouse.move(beforeCancel.x + beforeCancel.width / 2, beforeCancel.y + beforeCancel.height / 2);
  await page.mouse.down(); await page.mouse.move(beforeCancel.x + 70, beforeCancel.y + 3);
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(edge('Resize column B')).toHaveAttribute('aria-valuenow', '175');
  // Reordering a merge into a discontiguous range must remain a rejected edit.
  await data.locator('summary').filter({ hasText: 'Worksheet tools' }).click();
  await cell('A1').click(); await cell('A2').click({ modifiers: ['Shift'] });
  await data.getByRole('button', { name: 'Merge selected cells', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await drag(move('Move row 1'), move('Move row 3'));
  await expect(data.getByText(/The change was not applied.*split-range/)).toBeVisible();
  await expect(cell('A1').locator('..')).toHaveAttribute('rowspan', '2');
  await data.getByRole('button', { name: 'Unmerge cells', exact: true }).click();
  // Formula completion in a real grid cell stays inside the edited expression.
  await cell('J4').fill('=SU');
  await page.getByRole('listbox', { name: 'Formula function suggestions' }).getByRole('option', { name: /^SUM\b/ }).first().click();
  await expect(cell('J4')).toHaveValue('=SUM()');
  assert.equal(await cell('J4').evaluate(input => input.selectionStart), 5);
  await cell('J4').fill('=SUM(2,3)');
  await data.getByRole('button', { name: 'Formula inspector', exact: true }).click();
  await expect(cell('J4')).toHaveValue('5');
  await expect(data.locator('[data-formula-token=Function]')).toHaveText('SUM(');
  await data.locator('summary').filter({ hasText: 'Source syntax tree' }).click();
  await expect(data.getByRole('region', { name: 'Formula inspector' })).toContainText('"kind": "call"');
  const scroller = data.locator('.notebook-grid-scroll');
  const retained = await scroller.evaluate(node => { node.scrollLeft = 250; return node.scrollLeft; });
  assert.ok(retained > 0);
  await formula.fill('=SUM(4,5)');
  await expect.poll(() => scroller.evaluate(node => node.scrollLeft)).toBe(retained);
  await formula.fill("='[Book]Data'!A1");
  await expect(formula).toHaveValue('=SUM(4,5)');
  await page.getByRole('button', { name: 'Save revision', exact: true }).click();
  await expect(page.locator('.notebook-status')).toHaveText('Revision 2');
  const entries = await (await fetch(origin + '/api/entries')).json();
  const savedId = entries.entries.find(entry => entry.title === 'Direct grid interactions').id;
  const saved = await (await fetch(`${origin}/api/entries/${savedId}`)).json();
  const attrs = saved.document.content.content.find(node => node.type === 'spreadsheet' && node.attrs.label === 'Data').attrs;
  assert.equal(attrs.columnWidths['1'], 175); assert.equal(attrs.rowHeights['2'], 50);
  assert.equal(attrs.annotations.B3.unit, 'mL'); assert.equal(attrs.sheet.cells.J4, '=SUM(4,5)');
  await page.reload();
  await expect(edge('Resize column B')).toHaveAttribute('aria-valuenow', '175');
  await expect(cell('J4')).toHaveValue('9');
}

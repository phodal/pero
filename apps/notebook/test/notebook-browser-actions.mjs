import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

/** Open one notebook menu. Dialog-owning items stay mounted inside it. */
export async function openNotebookMenu(page, menu) {
  const details = page.locator(`details.notebook-menu[data-menu="${menu}"]`);
  if (!(await details.evaluate(node => node.open))) await details.locator('summary').click();
  await expect(details).toHaveJSProperty('open', true);
  return details;
}

/** Workspace views live in the View menu. Review sections stay direct tabs. */
export async function openNotebookView(page, name) {
  const tab = page.getByRole('tab', { name, exact: true });
  if (!(await tab.isVisible())) await openNotebookMenu(page, 'view');
  await tab.click();
}

/** Hidden view tabs stay in the document while the View menu is closed. */
export function notebookTab(page, name) {
  const pattern = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  return page.locator('[role="tab"]').filter({ hasText: pattern });
}

/** Worksheet tools and cell details live in the spreadsheet Block actions menu. */
export async function toggleSpreadsheetPanel(page, grid, name) {
  await grid.getByRole('button', { name: 'Block actions', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

/** Insert actions stay in the Insert menu. The trigger is a real button; the details keeps dialogs mounted. */
export async function ensureMoreTools(page) {
  const details = page.locator('details.notebook-menu[data-menu="insert"]');
  if (await details.evaluate(node => node.open)) return;
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(details).toHaveJSProperty('open', true);
}

/** Creation retains the old draft while the real backend request is in flight. */
export async function createNotebook(page, origin, title) {
  const creating = page.waitForResponse(response =>
    response.url() === origin + '/api/entries' && response.request().method() === 'POST');
  const button = page.getByRole('button', { name: 'New notebook', exact: true });
  await button.click();
  const response = await creating;
  assert.equal(response.ok(), true, `Create notebook: ${response.status()} ${await response.text()}`);
  const entry = await response.json();
  await expect(button).toBeEnabled();
  const titleInput = page.getByRole('textbox', { name: 'Notebook title', exact: true });
  await expect(titleInput).toHaveValue(entry.document.title);
  await expect(page.locator('.notebook-status')).toHaveText(`Revision ${entry.revision}`);
  await expect(page.getByRole('textbox', { name: 'Notebook content', exact: true })).toHaveText('');
  if (title !== undefined) await titleInput.fill(title);
  // Reload selects the latest entry unless the address names one. Drop a deep link
  // left by an earlier scenario so this notebook, not that older entry, comes back.
  await page.evaluate(() => {
    if (!location.hash.includes('notebook-entry=')) return;
    history.replaceState(null, '', `${location.pathname}${location.search}`);
  });
  return entry;
}

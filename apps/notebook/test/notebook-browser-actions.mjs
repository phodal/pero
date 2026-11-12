import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

/** Shared popup panels retain dialog-owning tools while closed. */
export async function openNotebookMenu(page, menu) {
  const trigger = page.locator(`[data-notebook-menu="${menu}"] .pero-ui-popover-trigger`);
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  return page.locator(`[data-notebook-menu-panel="${menu}"]`);
}

/** Main views and contextual inspectors have separate navigation. */
export async function openNotebookView(page, name) {
  if (['Metadata', 'Relevant items', 'Review and activity'].includes(name)) {
    const button = page.locator('.notebook-panel-actions').getByRole('button', { name: name === 'Metadata' ? 'Properties' : name, exact: true });
    if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
    return;
  }
  await page.getByRole('tab', { name, exact: true }).click();
}

export function notebookTab(page, name) {
  if (name === 'Metadata') return page.locator('.notebook-panel-actions').getByRole('button', { name: 'Properties', exact: true });
  return page.getByRole('tab', { name, exact: true });
}

/** Worksheet tools and cell details live in the spreadsheet Block actions menu. */
export async function toggleSpreadsheetPanel(page, grid, name) {
  await grid.getByRole('button', { name: 'Block actions', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

/** Extended insert tools live in More blocks; both disclosures keep dialogs mounted. */
export async function ensureMoreTools(page) {
  const panel = await openNotebookMenu(page, 'insert');
  const more = panel.locator('details.notebook-submenu').filter({
    has: page.locator('summary').filter({ hasText: /^More blocks$/ }),
  });
  if (!(await more.evaluate(node => node.open))) await more.locator(':scope > summary').click();
  await expect(more).toHaveJSProperty('open', true);
}

/** Return to the document after a menu-owned dialog or file import has finished. */
export async function closeInsertMenu(page) {
  const trigger = page.locator('[data-notebook-menu="insert"] .pero-ui-popover-trigger');
  if (await trigger.getAttribute('aria-expanded') === 'true') await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
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

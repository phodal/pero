import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

/** Secondary research tools stay disclosed across scenarios; open only when collapsed. */
export async function ensureMoreTools(page) {
  const hide = page.getByRole('button', { name: 'Hide more tools', exact: true });
  if (await hide.count()) return;
  await page.getByRole('button', { name: 'More tools', exact: true }).click();
  await expect(hide).toBeVisible();
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

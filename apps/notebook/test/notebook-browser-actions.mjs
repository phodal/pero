import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

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
  return entry;
}

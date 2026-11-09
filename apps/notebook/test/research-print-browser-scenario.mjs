import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { createNotebook } from './notebook-browser-actions.mjs';

/** CI browser acceptance: real saved revisions, rendered print CSS and retained late edits. */
export async function verifyResearchPrintTools(page, origin, output) {
  const button = (name, scope = page) => scope.getByRole('button', { name, exact: true });
  const request = async (path, body) => { const response = body === undefined ? await page.request.get(origin + path) : await page.request.post(origin + path, { data: body }); assert.ok(response.ok(), await response.text()); return response.json(); };
  await page.setViewportSize({ width: 1320, height: 950 });
  const entry = await createNotebook(page, origin, 'Research and print acceptance');
  const body = page.getByRole('textbox', { name: 'Notebook content', exact: true });
  await body.click(); await body.press('Control+\\');
  await expect(page.locator('[data-kind=section]')).toHaveCount(1);
  await page.getByLabel('Section title', { exact: true }).fill('Preparation');
  if (!await button('Hide more tools').count()) await button('More tools').click();
  await button('Scientific tools').click();
  let dialog = page.getByRole('dialog', { name: 'Scientific tools', exact: true });
  await dialog.getByRole('combobox', { name: 'Scientific tools', exact: true }).selectOption('formula');
  await dialog.locator('summary').filter({ hasText: 'Master-mix worked example' }).click();
  await button('Set 100 reactions / 设为 100', dialog).click();
  await expect(dialog.locator('p[role=status]')).toContainText('2200 µL');
  await button('Insert editable worksheet and recipe / 插入可编辑工作表与配方', dialog).click();
  await button('Insert editable worksheet and recipe / 插入可编辑工作表与配方', dialog).click();
  await expect(dialog.getByText(/already been inserted/)).toBeVisible();
  await button('Close', dialog).click();
  await expect(page.locator('[data-kind=spreadsheet]')).toHaveCount(1);
  await expect(page.locator('[data-kind=mixturePrep]')).toHaveCount(1);
  await expect(page.locator('[data-kind=spreadsheet] [data-cell=C6]')).toHaveValue('2200');
  const saving = page.waitForResponse(response => response.url() === `${origin}/api/entries/${entry.id}` && response.request().method() === 'POST');
  await button('Save revision', page).click(); assert.ok((await saving).ok()); await expect(button('Save revision')).toBeDisabled();
  const saved = await request(`/api/entries/${entry.id}`);
  await button('Print options').click();
  dialog = page.getByRole('dialog', { name: 'Print options', exact: true });
  await dialog.getByLabel('Paper', { exact: true }).selectOption('Letter');
  await dialog.getByLabel('Orientation', { exact: true }).selectOption('landscape');
  await dialog.getByLabel('Margins (mm, 5–40)', { exact: true }).fill('12');
  await dialog.getByLabel('Show formulas under calculated values', { exact: true }).check();
  await button('Save print preferences', dialog).click();
  await expect(page.locator('.notebook-print-preview')).toContainText('2200');
  await page.screenshot({ path: resolve(output, 'research-print-preview-light.png'), fullPage: true });
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.notebook-print-output')).toBeVisible();
  await expect(page.locator('.notebook-print-output')).toContainText(`Saved revision ${saved.revision}`);
  await expect(page.locator('.notebook-print-output button, .notebook-print-output input')).toHaveCount(0);
  assert.equal(await page.locator('.notebook-print-output').evaluate(element => getComputedStyle(element).overflow), 'visible');
  await page.pdf({ path: resolve(output, 'research-configured-print.pdf'), preferCSSPageSize: true, printBackground: true });
  await page.screenshot({ path: resolve(output, 'research-print-output.png'), fullPage: true });
  await page.emulateMedia({ media: 'screen' });
  await button('Close print options', dialog).click();
  await button('Print options').click();
  await expect(page.getByLabel('Orientation', { exact: true })).toHaveValue('landscape');
  await button('Close print options').click();

  // Hold an already committed HTTP response, dismiss the dialog and edit the current draft.
  // When it arrives, frame adoption must preserve that edit and mark it as a conflict.
  let release;
  const released = new Promise(resolve => { release = resolve; });
  let observed;
  const completed = new Promise(resolve => { observed = resolve; });
  const endpoint = `${origin}/api/entries/${entry.id}/amendments`;
  await page.route(endpoint, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch(); observed(response); await released; await route.fulfill({ response });
  });
  try {
    await button('Worksheet amendments').click();
    dialog = page.getByRole('dialog', { name: 'Worksheet amendments', exact: true });
    await dialog.getByLabel('Cell address', { exact: true }).fill('B1');
    await dialog.getByLabel('New raw input', { exact: true }).fill('101');
    await dialog.getByLabel('Local author attribution', { exact: true }).fill('Local researcher');
    await dialog.getByLabel('Reason for amendment', { exact: true }).fill('Correct reaction-count transcription');
    await button('Review amendment', dialog).click();
    await expect(dialog.locator('pre').first()).toContainText('"before": "100"');
    await button('Create audited revision', dialog).click();
    let timer;
    try { assert.ok((await Promise.race([completed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Amendment did not reach the backend within 15 seconds')), 15000); })])).ok()); } finally { clearTimeout(timer); }
    await button('Close amendments', dialog).click();
    await page.locator('[data-kind=spreadsheet] [data-cell=B1]').fill('103');
    release();
    await expect(page.getByText(/Another change was saved first. Your draft is still here/)).toBeVisible();
    await expect(page.locator('[data-kind=spreadsheet] [data-cell=B1]')).toHaveValue('103');
    const audit = await request(`/api/entries/${entry.id}/amendments`);
    assert.equal(audit.amendments.length, 1); assert.deepEqual(audit.amendments[0].changes, [{ address: 'B1', before: '100', after: '101' }]);
    assert.equal((await request(`/api/entries/${entry.id}/revisions/${saved.revision}`)).revision, saved.revision);
    await page.screenshot({ path: resolve(output, 'worksheet-amendment-retained-draft.png'), fullPage: true });
  } finally { release(); await page.unroute(endpoint); }
}

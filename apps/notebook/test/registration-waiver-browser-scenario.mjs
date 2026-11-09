import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';

/** Real local catalog and document persistence; no mock registration. */
export async function verifyRegistrationWaiver(page, origin, output) {
  const table = { id: 'waiver-table', name: 'Pending sample metadata', schema: { id: 'waiver-schema', revision: 1, columns: [{ id: 'name', name: 'Name', type: 'text', required: true, options: [], units: [] }] }, rows: [{ id: 'row', cells: {} }] };
  const response = await page.request.post(origin + '/api/entries', { data: { document: { schemaVersion: 1, title: 'Local registration waiver acceptance', content: { type: 'doc', content: [{ type: 'registrationTable', attrs: { blockId: 'waiver-block', table, receipts: [] } }] } } } });
  assert.equal(response.ok(), true, await response.text());
  const entry = await response.json();
  await page.reload();
  const block = page.locator('[data-kind=registrationTable]');
  await expect(block.getByRole('button', { name: 'Submit rows to local catalog', exact: true })).toBeDisabled();
  await block.getByText('Local validation waiver', { exact: true }).click();
  const reason = block.getByLabel('Waiver reason', { exact: true });
  const actor = block.getByLabel('Local attribution', { exact: true });
  const submit = block.getByRole('button', { name: 'Submit with explicit waiver', exact: true });
  await reason.fill('Awaiting independent sample identification');
  await expect(submit).toBeDisabled();
  await actor.fill('Local researcher');
  await expect(submit).toBeEnabled();
  // Any edit invalidates the approval, even when it still has the same required issue.
  await block.getByLabel('Table name', { exact: true }).fill('Pending sample metadata revised');
  await expect(reason).toHaveValue('');
  await expect(submit).toBeDisabled();
  await block.getByLabel('Table name', { exact: true }).fill('Pending sample metadata');
  await expect(reason).toHaveValue('');
  await expect(actor).toHaveValue('');
  await expect(submit).toBeDisabled();
  await reason.fill('Awaiting independent sample identification');
  await actor.fill('Local researcher');
  const committed = page.waitForResponse(response => response.url() === origin + '/api/catalog/register' && response.request().method() === 'POST');
  await submit.click();
  const receipt = await (await committed).json();
  assert.equal(receipt.waiver.policy, 'required-missing-v1');
  assert.deepEqual(receipt.waiver.issues, [{ code: 'required', rowId: 'row', columnId: 'name' }]);
  await expect(block.getByText(/The local catalog committed 1 records/)).toBeVisible();
  await page.getByRole('button', { name: 'Save revision', exact: true }).click();
  await expect(page.locator('.notebook-status')).toHaveText('Revision 2');
  await page.reload();
  await block.getByText('Submission receipts (1)', { exact: true }).click();
  await block.getByText(`${receipt.registeredAt} · 1`, { exact: true }).click();
  await expect(block.getByText('Local validation waiver · required-missing-v1', { exact: true })).toBeVisible();
  const saved = await (await page.request.get(origin + '/api/entries/' + entry.id)).json();
  assert.deepEqual(saved.document.content.content[0].attrs.receipts[0], receipt);
  const imported = await page.request.post(origin + '/api/entries', { data: { document: saved.document } });
  assert.equal(imported.ok(), true, await imported.text());
  assert.deepEqual((await imported.json()).document.content.content[0].attrs.receipts[0].waiver, receipt.waiver);
  const snapshot = await (await page.request.get(origin + '/api/catalog/lookup?schemaId=waiver-schema&text=&limit=100')).json();
  assert.equal(snapshot.records[0].version, 1);
  assert.deepEqual(snapshot.records[0].waiver, receipt.waiver);
  await page.screenshot({ path: resolve(output, 'registration-waiver-audit-light.png'), fullPage: true });
}

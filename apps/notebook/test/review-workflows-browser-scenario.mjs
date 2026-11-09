import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { createNotebook } from './notebook-browser-actions.mjs';

/** CI scenario for the real browser/SQLite harness. Does not authenticate participant labels. */
export async function verifyReviewWorkflows(page, origin, output) {
  const button = (name, root = page) => root.getByRole('button', { name, exact: true });
  const tab = name => page.getByRole('tab', { name, exact: true }).click();
  const json = async (path, body) => {
    const response = body === undefined ? await page.request.get(origin + path) : await page.request.post(origin + path, { data: body });
    assert.equal(response.ok(), true, await response.text()); return response.json();
  };
  const theme = dark => page.evaluate(dark => window.postMessage({ type: 'pero:app:context', context: { locale: 'en', dark, active: true } }, location.origin), dark);
  await page.setViewportSize({ width: 1320, height: 950 }); await theme(false);
  const entry = await createNotebook(page, origin, 'Workflow acceptance');
  await page.getByRole('textbox', { name: 'Notebook content', exact: true }).fill('Pinned review source');
  await button('Save revision').click(); await expect(page.locator('.notebook-status')).toHaveText('Revision 2');
  await tab('Review and activity'); await tab('Human review');
  await page.getByLabel('Your local display label', { exact: true }).fill('Local operator');
  await button('Configure workflow').click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Workflow name', { exact: true }).fill('Assay review stages');
  await dialog.getByLabel('Stage name 1', { exact: true }).fill('Method check');
  await dialog.getByLabel('Participant labels (one per line) 1', { exact: true }).fill('Local operator\nUnverified peer label');
  await button('Add stage', dialog).click();
  await dialog.getByLabel('Stage name 2', { exact: true }).fill('Release check');
  await page.screenshot({ path: resolve(output, 'workflow-configuration.png'), fullPage: true });
  await button('Save workflow version', dialog).click(); await expect(dialog).toHaveCount(0);
  await button('Request workflow review · r2').click(); dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Pinned review source', { exact: false })).toBeVisible();
  await button('Request workflow review', dialog).click(); await expect(dialog).toHaveCount(0);
  await button('Approve my assignment').click(); dialog = page.getByRole('dialog');
  await dialog.getByLabel('Action reason', { exact: true }).fill('I inspected this exact source revision.');
  await expect(button('Record local workflow action', dialog)).toBeDisabled();
  await dialog.getByRole('checkbox').check(); await button('Record local workflow action', dialog).click(); await expect(dialog).toHaveCount(0);
  await expect(button('Approve my assignment')).toHaveCount(0);
  await button('Reassign pending review').first().click(); dialog = page.getByRole('dialog');
  await dialog.getByLabel('New participant label', { exact: true }).fill('Replacement local label');
  await dialog.getByLabel('Action reason', { exact: true }).fill('Local assignment changed; no notification was sent.');
  await button('Record local workflow action', dialog).click(); await expect(dialog).toHaveCount(0);
  const endpoint = `/api/entries/${entry.id}/review-workspace`;
  let state = await json(endpoint);
  assert.equal(state.workflowRuns[0].assignments[0].status, 'approved');
  assert.equal(state.workflowRuns[0].assignments[1].participantDisplay, 'Replacement local label');
  assert.equal(state.workflowRuns[0].workflow.stages[0].participants[1], 'Unverified peer label');
  await button('Edit workflow').click(); dialog = page.getByRole('dialog');
  await dialog.getByLabel('Workflow name', { exact: true }).fill('Future assay review');
  await button('Save workflow version', dialog).click(); await expect(dialog).toHaveCount(0);
  state = await json(endpoint); assert.equal(state.workflowConfigs[0].version, 2); assert.equal(state.workflowRuns[0].workflow.version, 1);
  await tab('Notes'); await page.getByRole('textbox', { name: 'Notebook content', exact: true }).fill('New source revision');
  await button('Save revision').click(); await expect(page.locator('.notebook-status')).toHaveText('Revision 3');
  await tab('Review and activity'); await tab('Human review');
  await expect(page.getByText('Older revision; this workflow does not approve the latest saved content.', { exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(output, 'workflow-pinned-stages.png'), fullPage: true });
  // Select two real tasks, then change one through a second client to exercise conflict recovery.
  for (const title of ['First workflow task', 'Second workflow task']) await json(endpoint, {
    action: 'create-task', requestId: `browser-${title.replaceAll(' ', '-')}`, expectedVersion: 0,
    actorDisplay: 'Local operator', revision: 3, title, ownerDisplay: 'Local operator',
  });
  await button('Refresh records').click(); await tab('Local tasks');
  await expect(page.getByText('Second workflow task', { exact: true })).toBeVisible();
  await button('Bulk actions').click(); dialog = page.getByRole('dialog');
  for (const check of await dialog.getByRole('checkbox').all()) await check.check();
  state = await json(endpoint);
  const changed = state.tasks.find(item => item.title === 'Second workflow task');
  await json(endpoint, { action: 'set-task-status', requestId: 'browser-intervening-task-edit', actorDisplay: 'Local operator',
    id: changed.id, expectedVersion: changed.version, status: 'in_progress' });
  await button('Apply to selected records', dialog).click(); await expect(dialog.getByText('1 succeeded; 1 failed', { exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(output, 'workflow-bulk-partial-result.png'), fullPage: true });
  await button('Reload records and use current versions', dialog).click(); await expect(button('Apply to selected records', dialog)).toBeEnabled();
  await button('Apply to selected records', dialog).click(); await expect(dialog.getByText('1 succeeded; 0 failed', { exact: true })).toBeVisible();
  await button('Cancel', dialog).click(); await tab('Human review');
  await theme(true); await page.setViewportSize({ width: 600, height: 900 });
  const navigation = button('Notebooks'); if (await navigation.getAttribute('aria-expanded') === 'true') await navigation.click();
  await page.screenshot({ path: resolve(output, 'workflow-narrow-dark.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await theme(false); await page.setViewportSize({ width: 1320, height: 950 });
}

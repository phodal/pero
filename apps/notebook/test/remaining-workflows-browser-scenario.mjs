import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { createNotebook } from './notebook-browser-actions.mjs';

/** Real Notebook UI + SQLite. Does not simulate a remote account or a configured model. */
export async function verifyRemainingNotebookWorkflows(page, origin, output) {
  const button = (name, scope = page) => scope.getByRole('button', { name, exact: true });
  await page.setViewportSize({ width: 1320, height: 950 });
  const created = await createNotebook(page, origin, 'Home, templates and file intake');
  await page.getByRole('textbox', { name: 'Notebook content', exact: true }).fill('Recorded signal without units.');
  const save = async () => {
    const response = page.waitForResponse(value => value.url() === `${origin}/api/entries/${created.id}` && value.request().method() === 'POST');
    await button('Save revision').click(); assert.equal((await response).ok(), true); await expect(button('Save revision')).toBeDisabled();
  };
  await save();
  await button('Notebook home').click();
  let dialog = page.getByRole('dialog', { name: 'Notebook home and provenance', exact: true });
  await expect(dialog).toContainText(created.id); await expect(dialog).toContainText('does not change project membership');
  await dialog.getByRole('textbox', { name: 'Project label', exact: true }).fill('Workflow acceptance');
  await dialog.getByRole('textbox', { name: 'Author label', exact: true }).fill('Unverified local label');
  await button('Apply labels to draft', dialog).click(); await save();
  await button('Notebook home').click(); await expect(page.getByRole('dialog')).toContainText('Workflow acceptance');
  await page.screenshot({ path: resolve(output, 'notebook-home-provenance.png'), fullPage: true });
  await button('Close', page.getByRole('dialog')).click();

  if (!await button('Hide more tools').count()) await button('More tools').click();
  await button('Preview file import').click();
  dialog = page.getByRole('dialog', { name: 'Preview file import', exact: true });
  const bytes = Buffer.from('Recorded mass: 2.5 mg.\r\n', 'utf8');
  await dialog.locator('input[type=file]').setInputFiles({ name: 'source.txt', mimeType: 'text/plain', buffer: bytes });
  await expect(dialog).toContainText('Recorded mass: 2.5 mg.');
  await expect(page.locator('[data-kind=attachment]')).toHaveCount(0);
  await dialog.getByRole('textbox', { name: 'Notebook filename' }).fill('reviewed-source.txt');
  await page.screenshot({ path: resolve(output, 'notebook-staged-file-preview.png'), fullPage: true });
  await button('Insert reviewed file', dialog).click();
  await expect(page.locator('[data-kind=attachment]')).toHaveCount(1); await save();
  const saved = await page.request.get(`${origin}/api/entries/${created.id}`).then(result => result.json());
  const attachment = saved.document.content.content.find(node => node.type === 'attachment');
  assert.equal(attachment.attrs.filename, 'reviewed-source.txt');
  assert.equal(attachment.attrs.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(Buffer.from(attachment.attrs.data, 'base64'), bytes);
  assert.equal(saved.document.metadata.project, 'Workflow acceptance');
  await page.reload(); await expect(page.locator('[data-kind=attachment]')).toHaveCount(1);

  const document = { schemaVersion: 1, title: 'Template comparison source', content: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'comparison-step' }, content: [{ type: 'text', text: 'Earlier protocol step' }] }] } };
  const definition = { kind: 'fragment', name: 'Browser revision comparison', description: 'Original acceptance fixture', collections: [], parameters: [], document };
  const published = await page.request.post(origin + '/api/templates', { data: definition }); assert.equal(published.ok(), true, await published.text());
  const first = await published.json(); document.content.content[0].content[0].text = 'Later protocol step';
  const revised = await page.request.post(`${origin}/api/templates/${first.id}/revisions`, { data: { expectedRevision: 1, definition } }); assert.equal(revised.ok(), true, await revised.text());
  if (!await button('Hide more tools').count()) await button('More tools').click();
  await button('Templates').click(); dialog = page.getByRole('dialog', { name: 'Templates', exact: true });
  await button('Browser revision comparison · v2', dialog).click(); await button('Compare published revisions', dialog).click();
  await expect(dialog).toContainText('Earlier protocol step'); await expect(dialog).toContainText('Later protocol step');
  await page.screenshot({ path: resolve(output, 'notebook-template-revision-diff.png'), fullPage: true });
  await button('Close', dialog).click();
  const unchanged = await page.request.get(`${origin}/api/entries/${created.id}`).then(result => result.json());
  assert.deepEqual(unchanged, saved, 'Read-only comparison must never update the saved entry');

  if (!await button('Hide more tools').count()) await button('More tools').click();
  await button('Scientific tools').click(); dialog = page.getByRole('dialog', { name: 'Scientific tools', exact: true });
  await dialog.getByRole('combobox', { name: 'Scientific tools', exact: true }).selectOption('ai');
  await dialog.getByLabel('Proposal mode / 建议模式').selectOption('checks');
  await dialog.getByLabel('Proposal goal / 建议目标').fill('Review missing units');
  await expect(dialog).toContainText('No configured Host agent is available');
  await expect(button('Generate candidates', dialog)).toBeDisabled();
  await button('Close', dialog).click();
  await page.setViewportSize({ width: 760, height: 950 });
  await page.evaluate(() => window.postMessage({ type: 'pero:app:context', context: { locale: 'en', dark: true, active: true } }, location.origin));
  await button('Notebook home').click();
  await page.screenshot({ path: resolve(output, 'notebook-home-narrow-dark.png'), fullPage: true });
  await button('Close', page.getByRole('dialog')).click();
}

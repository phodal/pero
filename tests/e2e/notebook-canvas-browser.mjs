// Chromium + production Notebook UI/SDK + production Desktop Canvas adapter +
// real Rust Host and installed Python owners. No Electron or Native GUI claim.
// Build: npm --prefix apps/notebook run build && npm run build:host
// PERO_APP_PYTHON must name a venv interpreter with Notebook's declared Python pins installed.
// Run: npx playwright install chromium && node --test tests/e2e/notebook-canvas-browser.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { chromium, expect } from '@playwright/test';
import { createNotebookCanvasHost } from '../fixtures/notebook-canvas-host.mjs';

const root = resolve(import.meta.dirname, '../..');
const output = resolve(root, 'test-results/notebook-canvas');

test('Notebook Canvas renders actual Data, confirms writes, and recovers across revisions and Host restart', { timeout: 180_000 }, async t => {
  const fixture = await createNotebookCanvasHost(t);
  const { origin, backend } = fixture;
  const bytes = Buffer.from('sample,concentration\ncontrol,2\nsample-a,6\n');
  await backend('data', '/api/import', { name: 'assay-canvas.csv', kind: 'dataset', content: bytes.toString('base64') });
  const data = (await backend('data', '/api/state')).datasets[0];
  assert.ok(data, 'Data import must create a real dataset');
  const declaration = (await fixture.request('sdkcontext', { name: 'notebook' })).appViews.find(app => app.app === 'data');
  const binding = { id: 'assay-data', app: 'data', panel: 'main', view: 'dataset-inspector',
    declaration: declaration.revision, inputs: { datasetId: data.id } };
  const entry = await backend('notebook', '/api/entries', { document: {
    schemaVersion: 1, title: 'Assay dataset review', content: { type: 'doc', content: [
      { type: 'paragraph', attrs: { blockId: 'purpose' }, content: [{ type: 'text', text: 'Inspect the saved dataset and retain the owner result after explicit confirmation.' }] },
      { type: 'appCanvas', attrs: { blockId: 'canvas', label: 'Data inspection', binding } },
    ] },
  } });
  const browser = await chromium.launch({ executablePath: process.env.PERO_CHROMIUM_EXECUTABLE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1320, height: 1000 }, locale: 'en-US' });
  const errors = [], completed = [];
  let scenario = 'actual-data-projection';
  page.on('pageerror', error => errors.push(error.message));
  await mkdir(output, { recursive: true });
  t.after(async () => {
    try {
      await page.screenshot({ path: resolve(output, 'checkpoint.png'), fullPage: true });
      await writeFile(resolve(output, 'browser-context.json'), JSON.stringify({
        scenario, completed, errors, requests: fixture.requests,
        renderer: 'Chromium', host: 'target/debug/pero-host',
        tested: 'Production Notebook UI, App SDK, Desktop AppCanvasRequests, Rust Host, installed Notebook and Data Python backends',
        substitutes: ['Loopback HTTP replaces Electron custom-protocol transport', 'Test-controlled trusted-shell confirmation callback and theme context'],
        notTested: ['Electron window and native approval dialog', 'Native GPUI/WebView GUI', 'Data HTML panel', 'External services or models'],
        notebookBundleSha256: createHash('sha256').update(await readFile(resolve(root, 'apps/notebook/dist/index.js'))).digest('hex'),
      }, null, 2));
    } finally { await browser.close(); }
  });
  const block = page.locator('[data-kind=appCanvas]');
  const view = block.getByRole('region', { name: 'Declared App view' });
  const button = (name, scope = page) => scope.getByRole('button', { name, exact: true });
  const dataset = async () => (await backend('data', '/api/state')).datasets.find(item => item.id === data.id);
  const confirmation = async (number, actionLabel = 'Archive dataset') => {
    await expect.poll(() => fixture.confirmations.length).toBe(number);
    const latest = fixture.confirmations.at(-1);
    assert.match(latest.summary, /App: data/);
    assert.ok(latest.summary.includes(data.id));
    assert.ok(latest.summary.includes(entry.id));
    await expect(view.getByText('Waiting for trusted Host confirmation…', { exact: true })).toBeVisible();
    await expect(button(actionLabel, view)).toBeDisabled();
    return latest;
  };
  const canvasResponse = operation => page.waitForResponse(response => {
    if (response.url() !== origin + '/host/canvas' || response.request().method() !== 'POST') return false;
    return response.request().postDataJSON().operation === operation;
  });
  const shot = name => page.screenshot({ path: resolve(output, name + '.png'), fullPage: true });
  const savedEntry = () => backend('notebook', `/api/entries/${entry.id}`);
  await page.goto(origin);
  await expect(page.getByRole('textbox', { name: 'Notebook title' })).toHaveValue('Assay dataset review');
  await expect(view.getByText(data.id, { exact: true })).toBeVisible();
  await expect(view.getByRole('cell', { name: createHash('sha256').update(bytes).digest('hex'), exact: true })).toBeVisible();
  await expect(button('Archive dataset', view)).toBeEnabled();
  await expect(block.locator('iframe')).toHaveCount(0);
  await view.scrollIntoViewIfNeeded();
  await shot('canvas-light');
  completed.push(scenario);

  scenario = 'trusted-confirmation-denial-and-cancellation';
  let response = canvasResponse('act');
  await button('Archive dataset', view).click();
  const denied = await confirmation(1);
  assert.equal((await dataset()).archived, false, 'Preparing an action must not mutate Data');
  denied.decide(false);
  assert.equal((await (await response).json()).state, 'cancelled');
  await expect(view.getByText('Action cancelled before execution.', { exact: true })).toBeVisible();
  assert.equal((await dataset()).archived, false);
  response = canvasResponse('act');
  await button('Archive dataset', view).click();
  const cancelled = await confirmation(2);
  await button('Cancel pending action', view).click();
  assert.equal((await (await response).json()).state, 'cancelled');
  await expect.poll(() => cancelled.signal.aborted).toBe(true);
  await expect(button('Archive dataset', view)).toBeEnabled();
  assert.equal((await dataset()).archived, false);
  completed.push(scenario);

  scenario = 'confirmed-owner-action-and-retained-result';
  response = canvasResponse('act');
  await button('Archive dataset', view).click();
  const approved = await confirmation(3);
  assert.equal((await dataset()).archived, false);
  await shot('canvas-pending-confirmation');
  approved.decide(true);
  const result = await (await response).json();
  assert.equal(result.state, 'completed');
  assert.equal(result.receipt.result.dataset.archived, true);
  assert.equal(result.receipt.entryId, entry.id);
  assert.equal((await dataset()).archived, true);
  await expect(view.getByText('The App returned a completed result. This is not independent verification.', { exact: true })).toBeVisible();
  await button('Refresh App view', view).click();
  await expect(button('Restore dataset', view)).toBeVisible();
  await button('Keep returned result in notebook', view).click();
  await button('Save revision').click();
  await expect(page.locator('.notebook-status')).toHaveText('Revision 2');
  const saved = await savedEntry();
  assert.deepEqual(saved.document.content.content.find(node => node.type === 'appCanvas').attrs.binding.receipt, result.receipt);
  completed.push(scenario);

  scenario = 'readonly-revision-and-receipt-inspection';
  await button('Revision history').click();
  await button('Revision 1').click();
  await expect(view.getByText('Read-only view. Actions are unavailable in this instance.', { exact: true })).toBeVisible();
  await expect(button('Restore dataset', view)).toHaveCount(0);
  await expect(view.getByRole('textbox', { name: 'Dataset name', exact: true })).toHaveCount(0);
  await expect(button('Save dataset details', view)).toHaveCount(0);
  await expect(button('Save binding', block)).toHaveCount(0);
  await view.locator('summary').filter({ hasText: 'Inspect retained action' }).click();
  response = canvasResponse('status');
  await button('Check action status', view).click();
  assert.deepEqual((await (await response).json()).receipt, result.receipt);
  await expect(button('Keep returned result in notebook', view)).toHaveCount(0);
  assert.equal(fixture.confirmations.length, 3);
  await page.setViewportSize({ width: 640, height: 900 });
  await page.evaluate(() => window.postMessage({ type: 'pero:app:context', context: { locale: 'en', dark: true, active: true } }, location.origin));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'pero-dark');
  await view.scrollIntoViewIfNeeded();
  await shot('canvas-readonly-narrow-dark');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'The notebook must not overflow the narrow viewport');
  completed.push(scenario);

  scenario = 'actual-host-restart-and-remount-recovery';
  await fixture.restart();
  await page.setViewportSize({ width: 1320, height: 1000 });
  await page.reload();
  await expect(page.locator('.notebook-status')).toHaveText('Revision 2');
  await expect(button('Restore dataset', view)).toBeVisible();
  await view.locator('summary').filter({ hasText: 'Inspect retained action' }).click();
  response = canvasResponse('status');
  await button('Check action status', view).click();
  assert.deepEqual((await (await response).json()).receipt, result.receipt);
  assert.equal(fixture.confirmations.length, 3, 'Recovery must not ask to dispatch the completed action again');
  assert.equal(fixture.requests.filter(request => request.operation === 'act').length, 3);
  assert.equal((await dataset()).archived, true);
  await shot('canvas-recovered');
  completed.push(scenario);

  scenario = 'stale-declaration-and-explicit-saved-rebinding';
  await fixture.changeDataDeclaration();
  await button('Refresh installed Apps', block).click();
  await expect(block.getByText('The App declaration changed. Review and explicitly save a new binding before mounting.', { exact: true })).toBeVisible();
  response = canvasResponse('read');
  await button('Refresh App view', view).click();
  assert.equal((await response).ok(), false);
  await expect(button('Restore dataset', view)).toHaveCount(0);
  assert.equal((await savedEntry()).document.content.content.find(node => node.type === 'appCanvas').attrs.binding.declaration, binding.declaration);
  await shot('canvas-stale-binding');
  response = canvasResponse('mount');
  await button('Save binding', block).click();
  assert.equal((await response).ok(), false, 'An unsaved changed binding cannot mount');
  await expect(button('Restore dataset', view)).toHaveCount(0);
  await button('Save revision').click();
  await expect(page.locator('.notebook-status')).toHaveText('Revision 3');
  await expect(button('Restore dataset', view)).toBeEnabled();
  const rebound = (await savedEntry()).document.content.content.find(node => node.type === 'appCanvas').attrs.binding;
  assert.equal(rebound.id, binding.id);
  assert.notEqual(rebound.declaration, binding.declaration);
  assert.deepEqual(rebound.inputs, binding.inputs);
  assert.equal(fixture.confirmations.length, 3);
  assert.equal((await dataset()).archived, true);
  completed.push(scenario);

  scenario = 'bounded-owner-metadata-inputs-and-confirmation';
  const datasetName = view.getByRole('textbox', { name: 'Dataset name', exact: true });
  const project = view.getByRole('textbox', { name: 'Project reference (Data label)', exact: true });
  await expect(datasetName).toHaveValue(data.name);
  await expect(datasetName).toHaveAttribute('maxlength', '200');
  await expect(project).toHaveAttribute('maxlength', '200');
  await datasetName.fill('Reviewed assay dataset');
  await project.fill('assay-review');
  response = canvasResponse('act');
  await button('Save dataset details', view).click();
  const declinedEdit = await confirmation(4, 'Save dataset details');
  assert.match(declinedEdit.summary, /Action: canvas-update/);
  assert.match(declinedEdit.summary, /Reviewed assay dataset/);
  assert.match(declinedEdit.summary, /assay-review/);
  await expect(datasetName).toBeDisabled();
  assert.equal((await dataset()).name, data.name, 'Editing and preparing a form must not change the owner');
  declinedEdit.decide(false);
  assert.equal((await (await response).json()).state, 'cancelled');
  await expect(datasetName).toBeEnabled();
  assert.equal((await dataset()).name, data.name);
  response = canvasResponse('act');
  await button('Save dataset details', view).click();
  const acceptedEdit = await confirmation(5, 'Save dataset details');
  acceptedEdit.decide(true);
  const edited = await (await response).json();
  assert.equal(edited.state, 'completed');
  assert.equal(edited.receipt.action, 'canvas-update');
  assert.equal((await dataset()).name, 'Reviewed assay dataset');
  assert.equal((await dataset()).projectRef, 'assay-review');
  assert.equal((await dataset()).archived, true, 'The metadata action must preserve archive state');
  assert.deepEqual((await dataset()).versions, data.versions);
  await button('Refresh App view', view).click();
  await expect(view.getByRole('table', { name: 'Reviewed assay dataset', exact: true })).toBeVisible();
  await button('Keep returned result in notebook', view).click();
  await button('Save revision').click();
  await expect(page.locator('.notebook-status')).toHaveText('Revision 4');
  assert.deepEqual((await savedEntry()).document.content.content.find(node => node.type === 'appCanvas').attrs.binding.receipt, edited.receipt);
  await view.scrollIntoViewIfNeeded();
  await shot('canvas-owner-metadata');
  assert.deepEqual(errors, []);
  completed.push(scenario);
  console.log('Actual Chromium/Host/Notebook/Data Canvas flows passed. Confirmation callback and HTTP transport are test seams; Electron/Native GUI was not run.');
});

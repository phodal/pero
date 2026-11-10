import { verifyReferenceControls } from './reference-controls-browser-scenario.mjs';
import { verifyRemainingNotebookWorkflows } from './remaining-workflows-browser-scenario.mjs';
import { verifySourceExtraction } from './source-extraction-browser-scenario.mjs';
import { verifyResearchPrintTools } from './research-print-browser-scenario.mjs';
import { verifyStructuredFieldWorkflows } from './structured-field-browser-scenario.mjs';
import { verifyProcedureParameters } from './procedure-parameters-browser-scenario.mjs';
import { verifyReviewWorkflows } from './review-workflows-browser-scenario.mjs';
import { verifyDirectGridInteractions } from './grid-interaction-browser-scenario.mjs';
import { createNotebook, ensureMoreTools, openNotebookMenu, toggleSpreadsheetPanel } from './notebook-browser-actions.mjs';
import { verifyProcedureWorkspace } from './procedure-workspace-browser-scenario.mjs';
import { verifySourceExcerpts } from './source-excerpt-browser-scenario.mjs';
import { verifyDiagnosticsAndIntake } from './diagnostics-intake-browser-scenario.mjs';
import { verifyScientificDesigns } from './scientific-content-scenario.mjs';
import { verifyTableWorkflows } from './table-workflow-browser-scenario.mjs';
import { verifyNotebookComponents } from './notebook-components-scenario.mjs';
import { verifyGridTools } from './grid-browser-scenario.mjs';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { readWorkbook, writeWorkbook } from '@pero/notebook/workbook';
import { evaluateWorkbook } from '@pero/notebook/spreadsheet';

const app = resolve(import.meta.dirname, '..');
const output = resolve(app, '../../test-results/notebook');
const token = 'notebook-browser-fixture';

test('Notebook saves an Excel workbook, cell evidence and revisions through its real backend', { timeout: 480_000 }, async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'pero-notebook-browser-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const files = new Map(await Promise.all([
    ['/', 'index.html', 'text/html'], ['/index.js', 'index.js', 'text/javascript'], ['/index.css', 'index.css', 'text/css'],
    ['/source-evidence.json', 'source-evidence.json', 'application/json'],
  ].map(async ([path, name, type]) => [path, { body: await readFile(resolve(app, 'dist', name)), type }])));
  const backend = spawn(process.env.PYTHON || 'python3', [resolve(app, 'backend/server.py')], {
    env: { ...process.env, PERO_APP_DATA: directory, PERO_APP_TOKEN: token, PYTHONDONTWRITEBYTECODE: '1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(async () => {
    if (backend.exitCode === null) {
      const stopped = once(backend, 'exit');
      backend.kill();
      await stopped;
    }
  });
  const lines = createInterface({ input: backend.stdout });
  const [ready] = await once(lines, 'line', { signal: AbortSignal.timeout(10_000) });
  lines.close();
  const { port } = JSON.parse(ready);
  const server = createServer(async (request, response) => {
    const file = files.get(request.url);
    if (file) {
      response.writeHead(200, { 'Content-Type': file.type + '; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:" });
      return response.end(file.body);
    }
    if (request.url === '/host/sdk') return response.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
    if (!request.url?.startsWith('/api/')) return response.writeHead(404).end();
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const result = await fetch(`http://127.0.0.1:${port}${request.url}`, {
        method: request.method, headers: { 'Content-Type': 'application/json', 'X-Pero-App-Token': token },
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      });
      response.writeHead(result.status, { 'Content-Type': 'application/json' }).end(await result.text());
    } catch (error) { response.writeHead(502).end(String(error)); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(done => { server.close(done); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.PERO_CHROMIUM_EXECUTABLE, headless: true });
  let scenario = 'workbook-revisions-and-clipboard';
  t.after(async () => {
    try {
      await mkdir(output, { recursive: true });
      await writeFile(resolve(output, 'browser-context.json'), JSON.stringify({ scenario, url: page.url(), errors }, null, 2));
      await page.screenshot({ path: resolve(output, `checkpoint-${scenario}.png`), fullPage: true });
    } finally { await browser.close(); }
  });
  const page = await browser.newPage({ viewport: { width: 1320, height: 950 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await createNotebook(page, origin);
  const newBody = page.getByRole('textbox', { name: 'Notebook content', exact: true });
  await expect(newBody).toBeFocused();
  await expect(newBody.locator('p')).toBeVisible();
  await page.keyboard.type('Calibration and controls');
  await expect(newBody).toHaveText('Calibration and controls');
  await page.getByRole('textbox', { name: 'Notebook title', exact: true }).fill('Assay review');

  const workbook = await writeWorkbook([
    { name: 'Controls', sheet: { rows: 1, columns: 1, cells: { A1: '2' } } },
    { name: 'Results', sheet: { rows: 1, columns: 1, cells: { A1: '=Controls!A1*3' } } },
  ]);
  await ensureMoreTools(page);
  await page.locator('input[type=file][accept=".xlsx"]').setInputFiles({ name: 'assay.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(workbook) });
  const tables = page.locator('[data-kind=spreadsheet]');
  await expect(tables).toHaveCount(2);
  const control = tables.nth(0), result = tables.nth(1);
  await expect(result.locator('[data-cell=A1]')).toHaveValue('6');
  await control.locator('[data-cell=A1]').fill('4');
  await expect(result.locator('[data-cell=A1]')).toHaveValue('12');
  const sheetName = control.getByRole('textbox', { name: 'Sheet name' });
  await sheetName.fill('Calibration data');
  await sheetName.press('Enter');
  const formula = "='Calibration data'!A1*3";
  await expect(result.getByRole('textbox', { name: 'Cell formula or value' })).toHaveValue(formula);
  await expect(result.locator('[data-cell=A1]')).toHaveValue('12');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(sheetName).toHaveValue('Controls');
  await expect(result.getByRole('textbox', { name: 'Cell formula or value' })).toHaveValue('=Controls!A1*3');
  await expect(control.locator('[data-cell=A1]')).toHaveValue('4');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(sheetName).toHaveValue('Calibration data');
  await expect(result.getByRole('textbox', { name: 'Cell formula or value' })).toHaveValue(formula);
  await expect(result.locator('[data-cell=A1]')).toHaveValue('12');

  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Evidence' }).click();
  const evidence = page.locator('[data-kind=evidence]');
  const paperExport = await readFile(resolve(app, '../../packages/notebook/test/fixtures/paper-report.json'));
  const owner = JSON.parse(paperExport);
  await evidence.locator('input[type=file]').setInputFiles({
    name: 'paper-report.json', mimeType: 'application/json', buffer: paperExport,
  });
  await evidence.getByRole('button', { name: 'Choose a citation' }).click();
  await page.getByRole('listbox', { name: 'Choose a citation', exact: true })
    .getByRole('option').filter({ hasText: owner.sections[0].evidence[1].quote }).click();
  await evidence.getByRole('button', { name: 'Attach snapshot' }).click();
  await expect(evidence.locator('blockquote')).toHaveText(owner.sections[0].evidence[1].quote);
  await evidence.getByLabel('Label').fill('Paper passage');

  const controlExport = await readFile(resolve(app, '../../packages/notebook/test/fixtures/control-export.json'));
  const trial = JSON.parse(controlExport).experiment.trials.at(-1);
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Experiment reference', exact: true }).click();
  const experiment = page.locator('[data-kind=experiment]');
  await experiment.locator('input[type=file]').setInputFiles({
    name: 'control-export.json', mimeType: 'application/json', buffer: controlExport,
  });
  await experiment.getByRole('button', { name: 'Choose a trial receipt' }).click();
  await page.getByRole('option', { name: new RegExp(trial.id.slice(0, 12)) }).click();
  await experiment.getByRole('button', { name: 'Attach snapshot' }).click();
  const recordedVerdict = experiment.locator('.notebook-snapshot > .notebook-reference-actions');
  await expect(recordedVerdict).toContainText(trial.report.verdict);
  await experiment.getByLabel('Label').fill('Locked control trial');
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Finding', exact: true }).click();
  const finding = page.locator('[data-kind=finding]');
  await finding.getByLabel('Claim', { exact: true }).fill('Review both sources before accepting the result.');
  await finding.getByRole('checkbox', { name: /Paper passage/ }).click();
  await finding.getByRole('checkbox', { name: /Locked control trial/ }).click();

  await toggleSpreadsheetPanel(page, result, 'Cell details');
  await result.getByLabel('Unit', { exact: true }).fill('µL');
  await result.getByRole('checkbox', { name: 'Paper passage' }).click();
  await page.getByRole('button', { name: 'Save revision' }).click();
  await expect(page.locator('.notebook-status')).toHaveText('Revision 2');

  const catalog = await (await fetch(origin + '/api/entries')).json();
  const entry = await (await fetch(origin + '/api/entries/' + catalog.entries[0].id)).json();
  const sheets = entry.document.content.content.filter(node => node.type === 'spreadsheet');
  const source = entry.document.content.content.find(node => node.type === 'evidence');
  const run = entry.document.content.content.find(node => node.type === 'experiment');
  const review = entry.document.content.content.find(node => node.type === 'finding');
  assert.equal(entry.revision, 2);
  assert.equal(source.attrs.source.locator, `pero-app-location://paper-agent/main/report/${owner.id}/citation/1`);
  assert.equal(source.attrs.snapshot.passageId, owner.sections[0].evidence[1].passageId);
  assert.equal(run.attrs.snapshot.observationId, trial.observation.id);
  assert.equal(run.attrs.snapshot.reportId, trial.report.id);
  assert.deepEqual(review.attrs.evidenceIds, [source.attrs.blockId, run.attrs.blockId]);
  assert.deepEqual(sheets[1].attrs.annotations.A1, { unit: 'µL', evidenceIds: [source.attrs.blockId] });
  assert.equal(sheets[1].attrs.sheet.cells.A1, formula);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Notebook title' })).toHaveValue('Assay review');
  await expect(evidence.locator('blockquote')).toHaveText(owner.sections[0].evidence[1].quote);
  await expect(recordedVerdict).toContainText(trial.report.verdict);
  await expect(result.locator('[data-cell=A1]')).toHaveValue('12');
  const editReference = evidence.locator('summary').filter({ hasText: 'Edit reference' });
  await expect(evidence.getByRole('button', { name: 'Import Paper report JSON' })).toBeHidden();
  await editReference.click();
  await expect(evidence.getByRole('button', { name: 'Import Paper report JSON' })).toBeVisible();
  await evidence.locator('input[type=file]').setInputFiles({
    name: 'invalid-report.json', mimeType: 'application/json', buffer: Buffer.from('{invalid'),
  });
  await expect(evidence.getByText('Paper Agent export must be valid UTF-8 JSON.')).toBeVisible();
  await expect(evidence.locator('blockquote')).toHaveText(owner.sections[0].evidence[1].quote);
  await expect(evidence.getByLabel('Label')).toHaveValue('Paper passage');
  await editReference.click();
  await expect(evidence.locator('blockquote')).toBeVisible();

  // Use the editor's real clipboard serialization, including research payloads.
  const body = page.getByRole('textbox', { name: 'Notebook content' });
  await body.focus();
  await body.press('ControlOrMeta+a');
  const clipboard = await body.evaluate(element => {
    const data = new DataTransfer();
    element.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
    return { html: data.getData('text/html'), text: data.getData('text/plain') };
  });
  assert.match(clipboard.html, /data-notebook-block="evidence"/);

  await openNotebookMenu(page, 'file');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export workbook', exact: true }).click();
  const bytes = await readFile(await (await download).path());
  const reopened = await readWorkbook(Uint8Array.from(bytes).buffer);
  assert.deepEqual(reopened.map(({ name, sheet }) => [name, sheet.cells.A1]), [['Calibration data', '4'], ['Results', formula]]);
  await result.getByRole('button', { name: 'Block actions' }).click();
  const blockDownload = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export workbook' }).click();
  const blockBytes = await readFile(await (await blockDownload).path());
  const blockWorkbook = await readWorkbook(Uint8Array.from(blockBytes).buffer);
  assert.deepEqual(blockWorkbook.map(({ name, sheet }) => [name, sheet.cells.A1]),
    [['Calibration data', '4'], ['Results', formula]]);
  assert.equal(evaluateWorkbook(blockWorkbook).Results.A1, 12);
  await mkdir(output, { recursive: true });
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.getByRole('textbox', { name: 'Notebook title' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, 'saved-notebook.png'), fullPage: true });

  const update = await fetch(origin + '/api/agent-apply', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entryId: entry.id, baseRevision: 2, operations: [
      { op: 'set_cells', blockId: sheets[0].attrs.blockId, cells: { A1: '5' } },
    ] }),
  });
  assert.equal(update.status, 200, await update.text());
  const title = page.getByRole('textbox', { name: 'Notebook title' });
  await title.fill('Unsaved review');
  await page.getByRole('button', { name: 'Save revision' }).click();
  await expect(page.getByRole('button', { name: 'Load latest and discard draft' })).toBeVisible();
  await expect(title).toHaveValue('Unsaved review');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Load latest and discard draft' }).click();
  await expect(result.locator('[data-cell=A1]')).toHaveValue('15');
  await openNotebookMenu(page, 'file');
  await page.getByRole('button', { name: 'Revision history' }).click();
  await page.getByRole('button', { name: 'Revision 2', exact: true }).click();
  await expect(result.locator('[data-cell=A1]')).toHaveValue('12');
  await expect(result.locator('[data-cell=A1]')).toHaveAttribute('readonly', '');
  await result.getByRole('button', { name: 'Block actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Export workbook' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(result.getByRole('button', { name: 'Block actions' })).toBeFocused();

  await createNotebook(page, origin);
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Spreadsheet' }).click();
  const grid = page.locator('[data-kind=spreadsheet]');
  const first = grid.locator('[data-cell=A1]');
  await first.click();
  await first.evaluate(input => {
    const data = new DataTransfer();
    data.setData('text/plain', '2\t=A1*3\n4\t');
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await grid.locator('[data-cell=B1]').click();
  await grid.locator('[data-cell=B2]').click({ modifiers: ['Shift'] });
  const worksheetTools = () => toggleSpreadsheetPanel(page, grid, 'Worksheet tools');
  await worksheetTools();
  await grid.getByRole('button', { name: 'Fill down' }).click();
  await expect(grid.locator('[data-cell=B2]')).toHaveValue('12');
  await first.click();
  await grid.locator('[data-cell=B2]').click({ modifiers: ['Shift'] });
  await grid.getByRole('button', { name: 'Clear cells' }).click();
  await worksheetTools();
  await expect(grid.locator('[data-cell=B2]')).toHaveValue('');
  await expect(first).toHaveValue('');
  await grid.getByRole('button', { name: 'Block actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Export Excel', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(grid.getByRole('button', { name: 'Block actions' })).toBeFocused();
  await worksheetTools();
  await expect(grid.getByRole('button', { name: 'Add row', exact: true })).toBeVisible();
  await worksheetTools();
  await expect(grid.getByRole('button', { name: 'Add row', exact: true })).toBeHidden();
  await grid.locator('[data-cell=B1]').fill('Keep neighboring cell');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  for (const text of ['Sample A, replicate 2', '1,234']) {
    await first.fill('');
    await page.evaluate(text => navigator.clipboard.writeText(text), text);
    await first.press('ControlOrMeta+v');
    await expect(first).toHaveValue(text);
    await expect(grid.locator('[data-cell=B1]')).toHaveValue('Keep neighboring cell');
    await first.click();
    await grid.locator('[data-cell=B1]').click({ modifiers: ['Shift'] });
    await first.evaluate((input, text) => {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, text);
    await expect(first).toHaveValue(text);
    await expect(grid.locator('[data-cell=B1]')).toHaveValue('Keep neighboring cell');
  }
  const created = await createNotebook(page, origin, 'Copied review');
  const copiedBody = page.getByRole('textbox', { name: 'Notebook content' });
  await copiedBody.focus();
  await copiedBody.evaluate((element, clipboard) => {
    const data = new DataTransfer();
    data.setData('text/html', clipboard.html);
    data.setData('text/plain', clipboard.text);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, clipboard);
  await expect(page.locator('[data-kind=evidence]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('[data-kind=evidence]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('[data-kind=evidence]')).toHaveCount(1);
  await expect(page.locator('[data-kind=finding]').getByRole('checkbox', { name: /Paper passage/ })).toBeChecked();
  await expect(page.locator('[data-kind=finding]').getByRole('checkbox', { name: /Locked control trial/ })).toBeChecked();
  await page.getByRole('button', { name: 'Save revision' }).click();
  await expect(page.locator('.notebook-status')).toHaveText('Revision 2');
  const copied = await (await fetch(origin + '/api/entries/' + created.id)).json();
  assert.equal(copied.document.title, 'Copied review');
  assert.equal(copied.revision, 2);
  const copiedNodes = copied.document.content.content;
  const copiedEvidence = copiedNodes.find(node => node.type === 'evidence');
  const copiedExperiment = copiedNodes.find(node => node.type === 'experiment');
  const copiedFinding = copiedNodes.find(node => node.type === 'finding');
  assert.notEqual(copiedEvidence.attrs.blockId, source.attrs.blockId);
  assert.notEqual(copiedExperiment.attrs.blockId, run.attrs.blockId);
  assert.deepEqual(copiedEvidence.attrs.snapshot, source.attrs.snapshot);
  assert.deepEqual(copiedExperiment.attrs.snapshot, run.attrs.snapshot);
  assert.deepEqual(copiedFinding.attrs.evidenceIds, [copiedEvidence.attrs.blockId, copiedExperiment.attrs.blockId]);
  assert.deepEqual(copiedNodes.filter(node => node.type === 'spreadsheet')[1].attrs.annotations.A1,
    { unit: 'µL', evidenceIds: [copiedEvidence.attrs.blockId] });
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Notebook title' })).toHaveValue('Copied review');
  await expect(page.locator('[data-kind=finding]').getByRole('checkbox', { name: /Paper passage/ })).toBeChecked();
  await expect(page.locator('.notebook-menubar [role=tab][data-view=notes]')).toHaveText('Copied review');
  await expect(page.locator('.notebook-statusbar details[data-menu=view]')).toHaveCount(0);
  await page.screenshot({ path: resolve(output, 'copied-notebook.png'), fullPage: true });
  await finding.scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Save revision' })).toBeVisible();
  await expect(page.locator('.notebook-toolbar')).toBeVisible();
  await page.screenshot({ path: resolve(output, 'copied-references.png'), fullPage: true });
  await page.getByRole('textbox', { name: 'Notebook title' }).scrollIntoViewIfNeeded();
  // The Host context, not the OS media query, owns an App's actual theme.
  await page.evaluate(() => window.postMessage({ type: 'pero:app:context',
    context: { locale: 'en', dark: true, active: true } }, location.origin));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'pero-dark');
  await page.setViewportSize({ width: 600, height: 900 });
  const navigation = page.getByRole('button', { name: 'Notebooks', exact: true });
  await navigation.click();
  await expect(navigation).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#notebook-list')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Notebook title' })).toHaveValue('Copied review');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

  await expect(page.locator('[data-kind=spreadsheet]').first().locator('[data-cell=A1]')).toHaveValue('4');
  await page.getByRole('textbox', { name: 'Notebook title' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, 'copied-notebook-narrow-dark.png'), fullPage: true });
  await expect(page.locator('.notebook-menubar [role=tab][data-view=notes]')).toHaveText('Copied review');
  await finding.scrollIntoViewIfNeeded();
  await expect(finding.getByRole('checkbox', { name: /Paper passage/ })).toBeChecked();
  await expect(finding.getByRole('checkbox', { name: /Locked control trial/ })).toBeChecked();
  await page.screenshot({ path: resolve(output, 'copied-references-dark.png'), fullPage: true });
  await navigation.click();
  await expect(navigation).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#notebook-list')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Notebook title' })).toHaveValue('Copied review');
  await expect(finding.getByRole('checkbox', { name: /Paper passage/ })).toBeChecked();
  for (const [name, verify] of [
    ['reference-controls', verifyReferenceControls], ['grid-tools', verifyGridTools], ['notebook-components', verifyNotebookComponents],
    ['table-workflows', verifyTableWorkflows], ['scientific-designs', verifyScientificDesigns],
    ['source-excerpts', verifySourceExcerpts], ['source-extraction', verifySourceExtraction], ['research-print', verifyResearchPrintTools], ['remaining-workflows', verifyRemainingNotebookWorkflows], ['diagnostics-and-intake', verifyDiagnosticsAndIntake],
    ['review-workflows', verifyReviewWorkflows], ['structured-field-workflows', verifyStructuredFieldWorkflows], ['procedure-parameters', verifyProcedureParameters], ['procedure-workspace', verifyProcedureWorkspace], ['direct-grid-interactions', verifyDirectGridInteractions],
  ]) {
    scenario = name;
    try { await verify(page, origin, output); }
    catch (cause) { throw new Error(`Notebook scenario ${name}: ${cause.message}\nBrowser errors: ${JSON.stringify(errors)}`, { cause }); }
  }
  assert.deepEqual(errors, []);
});

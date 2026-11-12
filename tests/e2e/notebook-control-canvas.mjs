import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { chromium, expect } from '@playwright/test';
import { createNotebookCanvasHost } from '../fixtures/notebook-canvas-host.mjs';
import { openNotebookMenu, openNotebookReference, openNotebookView } from '../../apps/notebook/test/notebook-browser-actions.mjs';
import { readControlEvidence } from '../../packages/notebook/src/control-evidence.ts';
import { readPaperEvidence } from '../../packages/notebook/src/paper-evidence.ts';
import { appPresentation } from '../../web/src/app-sdk-presentation.ts';

test('Paper → Notebook → PI verification → Finding → Project preserves PASS, FAIL and old revisions', { timeout: 120_000 }, async t => {
  const fixture = await createNotebookCanvasHost(t, { controlLab: true, interop: true });
  const { backend, backendResponse, origin } = fixture;
  const paper = await readPaperEvidence(Uint8Array.from(fixture.paperExport).buffer);
  const citation = paper.citations[0];
  const sampleColumn = { id: 'samples-column', name: 'Sample count', type: 'decimal', required: true, options: [], units: [] };
  const entry = await backend('notebook', '/api/entries', { document: {
    schemaVersion: 1, title: 'Notebook PI acceptance',
    content: { type: 'doc', content: [
      { type: 'evidence', attrs: { blockId: 'paper-source', label: citation.label, source: citation.reference,
        snapshot: { kind: 'paper-report', ...citation.evidence } } },
      { type: 'inputTable', attrs: { blockId: 'inputs', receipts: [], table: {
        id: 'table', name: 'PI inputs', schema: { id: 'schema', revision: 1, columns: [sampleColumn] },
        rows: [{ id: 'input-row', cells: { 'samples-column': '1001' } }],
      } } },
      { type: 'appCanvas', attrs: { blockId: 'canvas', label: 'PI', binding: null } },
    ] },
    procedures: [{ id: 'method', title: 'PI case', description: '', materials: [], steps: [], parameters: [
      { id: 'window', name: 'Window', type: 'quantity', required: true, options: [], units: ['s'], stepId: null, version: 1,
        source: { kind: 'literal', raw: '8 s' } },
      { id: 'count', name: 'Samples', type: 'decimal', required: true, options: [], units: [], stepId: null, version: 1,
        source: { kind: 'table', blockId: 'inputs', tableId: 'table', rowId: 'input-row', columnId: sampleColumn.id,
          schemaId: 'schema', schemaRevision: 1, observedRevision: 1, column: sampleColumn, raw: '1001' } },
    ] }],
  } });
  const output = resolve(import.meta.dirname, '../../test-results/notebook-canvas');
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PERO_CHROMIUM_EXECUTABLE });
  let page, owner;
  const opened = [], errors = [], responses = [], failedRequests = [];
  // Register evidence before navigation so owner startup failures are retained too.
  t.after(async () => {
    try {
      if (!page || !owner) return;
      await writeFile(resolve(output, 'control-browser-context.json'), JSON.stringify({
        errors, responses, failedRequests, opened,
        owner: { path: new URL(owner.url()).pathname, body: (await owner.locator('body').innerText({ timeout: 3000 })).slice(0, 16000) },
        notebook: { path: new URL(page.url()).pathname, body: (await page.locator('body').innerText({ timeout: 3000 })).slice(0, 16000) },
      }, null, 2));
      await owner.screenshot({ path: resolve(output, 'control-owner-checkpoint.png'), fullPage: true, timeout: 5000 });
      await page.screenshot({ path: resolve(output, 'control-notebook-checkpoint.png'), fullPage: true, timeout: 5000 });
    } catch {
      // Diagnostic capture must not replace the original test failure.
      t.diagnostic('Control Lab checkpoint capture incomplete; inspect retained artifacts.');
    } finally { await browser.close(); }
  });
  page = await browser.newPage({ viewport: { width: 1320, height: 1000 } });
  owner = await browser.newPage();
  for (const [name, tab] of [['notebook', page], ['control-lab', owner]]) {
    tab.on('pageerror', error => {
      if (errors.length < 50) errors.push(`${name}: ${error.message.slice(0, 2000)}`);
    });
    tab.on('response', response => {
      if (responses.length < 200) responses.push({ app: name, path: new URL(response.url()).pathname, status: response.status() });
    });
    tab.on('requestfailed', request => {
      if (failedRequests.length < 50) failedRequests.push({ app: name, path: new URL(request.url()).pathname, error: request.failure()?.errorText });
    });
  }
  await owner.goto(origin + '/control-lab/');
  await expect(owner.getByRole('button', { name: 'Run experiment', exact: true })).toBeVisible({ timeout: 30_000 });
  await page.exposeFunction('openControlLocation', async (operation, input) => {
    const location = appPresentation(operation, input);
    assert.equal(location.kind, 'research-source');
    assert.equal(location.app, 'control-lab');
    opened.push(location.href);
    await owner.evaluate(href => window.postMessage({
      type: 'pero:app:location', location: new URL(href).pathname.replace(/^\/main\//, ''),
    }, location.origin), location.href);
  });
  await page.addInitScript(() => window.addEventListener('message', async event => {
    const { type, id, operation, input } = event.data ?? {};
    if (type !== 'pero:app:sdk' || operation !== 'open-research-source') return;
    try {
      await window.openControlLocation(operation, input);
      window.postMessage({ type: 'pero:app:sdk-result', id, ok: true }, location.origin);
    } catch (error) {
      window.postMessage({ type: 'pero:app:sdk-result', id, ok: false, error: String(error) }, location.origin);
    }
  }));
  await page.goto(origin);
  await expect(page.getByRole('textbox', { name: 'Notebook title' })).toHaveValue('Notebook PI acceptance');
  const block = page.locator('[data-kind=appCanvas]');
  const button = (name, scope = page) => scope.getByRole('button', { name, exact: true });
  const choose = async (label, option) => {
    await button(label, block).click();
    await page.getByRole('option', { name: option }).click();
  };
  const current = () => backend('notebook', '/api/entries/' + entry.id);
  const save = async () => {
    const revision = (await current()).revision;
    await button('Save revision').click();
    await expect.poll(async () => (await current()).revision).toBe(revision + 1);
  };
  const create = async (count, horizon) => {
    await button('Create experiment', block).click();
    await expect.poll(() => fixture.confirmations.length).toBe(count);
    const confirmation = fixture.confirmations.at(-1);
    assert.match(confirmation.summary, /App: control-lab/);
    assert.ok(confirmation.summary.includes(`"value":"${horizon}"`));
    confirmation.decide(true);
    await expect(block.getByText('The App returned a completed result. This is not independent verification.')).toBeVisible();
  };
  const ownerExperiments = async () => (await backend('control-lab', '/api/experiments')).experiments;
  const run = async (record, verdict = 'PASS') => {
    const path = '/api/experiments/' + record.id;
    await backend('control-lab', path + '/search', {});
    await expect.poll(async () => (await backend('control-lab', path)).status, { timeout: 20_000 }).not.toBe('running');
    await backend('control-lab', path + '/lock', { candidateId: 'baseline' });
    await backend('control-lab', path + '/verify', {});
    await expect.poll(async () => (await backend('control-lab', path)).status, { timeout: 20_000 }).not.toBe('running');
    const response = await backendResponse('control-lab', path + '/export');
    assert.equal(response.ok, true, await response.clone().text());
    const bytes = Buffer.from(await response.arrayBuffer());
    const exported = JSON.parse(bytes).experiment;
    const trial = exported.trials.find(item => item.phase === 'verification' && item.report);
    assert.ok(trial?.observation?.series);
    assert.equal(trial.status, 'completed');
    assert.equal(trial.report.verdict, verdict);
    return { bytes, trial, experiment: exported };
  };
  const references = page.locator('[data-kind=experiment]');
  const attach = async (run, label) => {
    const existing = await references.evaluateAll(nodes => nodes.map(node => node.dataset.notebookBlockId));
    await button('Refresh App view', block).click();
    await button('Completed results', block).click();
    await page.getByRole('option', { name: new RegExp(run.trial.id.slice(0, 12)) }).click();
    await button('Attach selected result', block).click();
    await expect(references).toHaveCount(existing.length + 1);
    const reference = page.locator('[data-kind=experiment]' + existing.map(id => `:not([data-notebook-block-id="${id}"])`).join(''));
    const panel = await openNotebookReference(page, reference);
    await expect(panel.getByText('Verification', { exact: true })).toBeVisible();
    await expect(panel.locator('.notebook-snapshot > .notebook-reference-actions').getByText(run.trial.report.verdict, { exact: true })).toBeVisible();
    await panel.getByLabel('Label').fill(label);
    const id = await reference.getAttribute('data-notebook-block-id');
    return references.and(page.locator(`[data-notebook-block-id="${id}"]`));
  };
  await choose('Installed App', /^Control Lab/);
  await choose('Declared view', 'Control Lab');
  await choose('Embedded view', 'PI controller experiment');
  await choose('Observation window (s)', /Window.*8 s/);
  await choose('Sample count', /Samples.*1001/);
  await block.screenshot({ path: resolve(output, 'control-canvas-mapping.png') });
  await button('Save binding', block).click();
  await expect(button('Save revision to enable App view', block)).toBeVisible();
  await expect(block.getByRole('alert')).toHaveCount(0);
  await expect(button('Create experiment', block)).toHaveCount(0);
  await button('Save revision to enable App view', block).click();
  await expect(button('Create experiment', block)).toBeVisible();
  await create(1, 8);
  assert.equal((await ownerExperiments()).length, 1);
  const [firstRecord] = await ownerExperiments();
  const originalOperation = fixture.requests.find(item => item.operation === 'act').operationId;
  const source = async () => {
    const saved = await current();
    return { entryId: saved.id, revision: saved.revision, blockId: 'canvas', readOnly: false,
      binding: saved.document.content.content.find(node => node.type === 'appCanvas').attrs.binding };
  };
  const canvas = request => fixture.request('canvas', { name: 'notebook', request });
  await fixture.restart();
  const restored = await canvas({ operation: 'mount', source: await source() });
  const receipt = await canvas({ operation: 'status', instance: restored.instance, operationId: originalOperation });
  assert.equal(receipt.receipt.result.experimentId, firstRecord.id);
  await canvas({ operation: 'release', instance: restored.instance });
  await page.reload();
  await create(2, 8);
  assert.deepEqual((await ownerExperiments()).map(item => item.id), [firstRecord.id]);
  await button('Keep returned result in notebook', block).click();
  await button('Open created experiment', block).click();
  await expect.poll(() => opened.at(-1)).toBe(`pero-app-location://control-lab/main/experiment/${firstRecord.id}`);
  const first = await run(firstRecord);
  assert.equal(first.experiment.parameters.horizon, 8);
  const oldReference = await attach(first, 'Original PI trial');
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Finding', exact: true }).click();
  const finding = page.locator('[data-kind=finding]');
  await finding.getByLabel('Claim', { exact: true }).fill('The original PI verification met the recorded criteria.');
  await finding.getByRole('checkbox', { name: /Original PI trial/ }).check();
  await save();
  const originalRevision = await current();
  const originalDescription = await backend('notebook', '/api/interop-describe', { entryId: entry.id });

  await openNotebookView(page, 'Procedures');
  await button('Edit parameter', page.locator('[data-parameter-id=window]')).click();
  const edit = page.getByRole('dialog', { name: 'Edit parameter', exact: true });
  await edit.getByLabel('Raw value').fill('2 s');
  await button('Apply parameter', edit).click();
  await openNotebookView(page, 'Notes');
  await expect(block.getByText('Inputs changed. Save a new binding.')).toBeVisible();
  await expect(button('Create experiment', block)).toHaveCount(0);
  await save();
  const stale = await source();
  delete stale.binding.receipt;
  await assert.rejects(canvas({ operation: 'mount', source: stale }), /scoped request/);
  await button('Save binding', block).click();
  await save();
  await create(3, 2);
  const records = await ownerExperiments();
  assert.equal(records.length, 2);
  const secondRecord = records.find(item => item.id !== firstRecord.id);
  assert.notEqual(firstRecord.specHash, secondRecord.specHash);
  const second = await run(secondRecord, 'FAIL');
  assert.equal(second.experiment.parameters.horizon, 2);
  await button('Keep returned result in notebook', block).click();
  await button('Open created experiment', block).click();
  await expect.poll(() => opened.at(-1)).toBe(`pero-app-location://control-lab/main/experiment/${secondRecord.id}`);
  await attach(second, 'Updated PI trial');
  await save();
  await expect(finding.getByRole('checkbox', { name: /Original PI trial/ })).toBeChecked();
  await expect(finding.getByRole('checkbox', { name: /Updated PI trial/ })).not.toBeChecked();
  const latest = await current();
  const evidence = type => latest.document.content.content.filter(node => node.type === type);
  const original = evidence('experiment').find(node => node.attrs.snapshot.trialId === first.trial.id);
  const imported = (await readControlEvidence(new Blob([first.bytes]))).find(item => item.snapshot.trialId === first.trial.id);
  assert.deepEqual(original.attrs.snapshot, imported.snapshot, 'direct owner read must retain the same snapshot as the integrity-checked export');
  assert.deepEqual(evidence('finding')[0].attrs.evidenceIds, [original.attrs.blockId]);
  assert.deepEqual(new Set(evidence('experiment').map(node => node.attrs.snapshot.trialId)), new Set([first.trial.id, second.trial.id]));
  assert.equal(originalRevision.document.content.content.find(node => node.type === 'experiment').attrs.snapshot.reportId, first.trial.report.id);
  await button('Open in Control Lab', await openNotebookReference(page, oldReference)).click();
  await expect.poll(() => opened.at(-1)).toBe(`pero-app-location://control-lab/main/experiment/${firstRecord.id}/trial/${first.trial.id}`);
  await button('Raw evidence / hash', owner).click();
  const raw = owner.getByRole('dialog', { name: 'Raw execution evidence' });
  await expect(raw).toContainText(first.trial.id);
  await expect(raw).toContainText(first.trial.report.id);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: resolve(output, 'control-notebook-finding.png'), fullPage: true });
  await owner.screenshot({ path: resolve(output, 'control-reopened-trial.png'), fullPage: true });
  const sourceLocation = await backend('paper-agent', '/api/evidence', {
    intentId: citation.evidence.intentId, paperId: citation.evidence.paperId,
    passageId: citation.evidence.passageId, quote: citation.evidence.quote,
  });
  assert.equal(sourceLocation.pdf.fileDigest, citation.evidence.fileDigest);
  assert.ok(sourceLocation.pdf.pages.includes(citation.evidence.page));
  const historic = await backend('notebook', '/api/interop-describe', { entryId: entry.id, revision: originalRevision.revision });
  assert.deepEqual(historic, originalDescription);
  await openNotebookMenu(page, 'file');
  await button('Properties').click();
  const properties = page.getByRole('complementary', { name: 'Properties', exact: true });
  const projects = properties.getByRole('region', { name: 'Research project', exact: true });
  await projects.getByLabel('Host project', { exact: true }).selectOption('pi-study');
  await button('Link saved entry', projects).click();
  await expect(projects.getByText('Host project reference saved.')).toBeVisible();
  assert.equal(fixture.projectConfirmations.length, 1);
  await fixture.restart();
  const catalog = await fixture.request('notebook-projects', { name: 'notebook', request: { operation: 'list' } });
  assert.deepEqual(catalog.projects[0].entries, [{ id: entry.id, revision: String(latest.revision) }]);
  await page.screenshot({ path: resolve(output, 'interop-project.png'), fullPage: true });
  await button('Close', properties).click();
  await page.evaluate(location => window.postMessage({ type: 'pero:app:location', location }, window.location.origin),
    new URL(historic.descriptor.location).pathname.replace(/^\/main\//, ''));
  await openNotebookView(page, 'Notes');
  await expect(page.locator('[data-kind=experiment]')).toHaveCount(1);
  const paperPanel = await openNotebookReference(page, page.locator('[data-kind=evidence]'));
  await expect(paperPanel.getByText(citation.evidence.quote, { exact: false }).first()).toBeVisible();
  await expect(block.getByText('Loading declared App view…', { exact: true })).toHaveCount(0, { timeout: 15_000 });
  await expect(block.getByRole('alert')).toHaveCount(0);
  await expect(block).toContainText('8 s');
  await expect(block).toContainText('1001');
  const reopenedOwner = await backend('control-lab', '/api/experiments/' + firstRecord.id);
  assert.equal(reopenedOwner.trials.find(trial => trial.id === first.trial.id).report.id, first.trial.report.id);
  const previousOpens = opened.length;
  await button('Open in Control Lab', await openNotebookReference(page, page.locator('[data-kind=experiment]'))).click();
  await expect.poll(() => opened.length).toBe(previousOpens + 1);
  assert.equal(opened.at(-1), `pero-app-location://control-lab/main/experiment/${firstRecord.id}/trial/${first.trial.id}`);
  await button('Raw evidence / hash', owner).click();
  await expect(raw).toContainText(first.trial.id);
  await expect(raw).toContainText(first.trial.report.id);
  await page.screenshot({ path: resolve(output, 'interop-old-revision.png'), fullPage: true });
  await writeFile(resolve(output, 'control-canvas.json'), JSON.stringify({
    entryId: entry.id, originalRevision: originalRevision.revision, latestRevision: latest.revision,
    trials: [first, second].map(({ experiment, trial }) => ({
      experimentId: experiment.id, specHash: experiment.specHash, trialId: trial.id, observationId: trial.observation.id,
      reportId: trial.report.id, verdict: trial.report.verdict, parameters: experiment.parameters,
    })), opened, duplicatesAfterHostRestart: 0,
    source: { reportId: paper.reportId, citation: citation.evidence, resolved: sourceLocation },
    interop: historic, project: catalog.projects[0], scientificAcceptance: 'not-assessed',
  }, null, 2));
});

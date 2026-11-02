import { paperDocumentBackendFixture } from './paper-backend-fixture.mjs';
// Offline authored corpus through actual Desktop/Host/approved Paper APIs/PDFium.
// No mocked API responses, remote provider or scientific acceptance claim.
// One refresh holds the unchanged real App fetch response to exercise busy UI.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { deferDocumentRefresh } from './paper-document-refresh-gate.mjs';
import { openResearchImport, inspectResearchReview } from './paper-research-ui-controls.mjs';
import { clickAppShortcut } from './sidebar-controls.mjs';
import { setPaperAppearance, backToLibrary, saveLibraryCopies } from './paper-pdf-flow.mjs';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile, cp } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

if (process.env.PERO_PAPER_JOURNEY_AGENT || process.env.PERO_STRUCTURED_READING_LIVE) throw Error('This suite is offline and does not authorize an Agent or live sources.');
const root = resolve(import.meta.dirname, '../..'), out = resolve(root, 'test-results/paper-structured-reading/fixture');
await mkdir(out, { recursive: true });
const profile = await realpath(await mkdtemp(resolve(tmpdir(), 'pero-structured-reading-')));
const settings = resolve(profile, 'settings.json'), agents = resolve(profile, 'agents.json');
await writeFile(settings, JSON.stringify(process.env.PERO_APP_PYTHON ? {
  app_python: { apps: { 'paper-agent': dirname(dirname(process.env.PERO_APP_PYTHON)) } },
} : {}));
await writeFile(agents, JSON.stringify(['pero', 'codex', 'claude', 'copilot', 'grok', 'qoder', 'opencode'].map(id => ({ id, name: id, command: resolve(profile, `unavailable-${id}`) }))));
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(profile, 'desktop'), PERO_SETTINGS_PATH: settings,
  PERO_HISTORY_PATH: resolve(profile, 'history.jsonl'), PERO_AGENTS_FILE: agents, PERO_LOCALE: 'en',
  PERO_BUILTIN_APPS: 'paper-agent', PERO_REQUIRED_APPS: 'paper-agent', PERO_APP_INFRA_EMBED: '0' };
delete env.ELECTRON_RUN_AS_NODE; delete env.PERO_APPS_ROOT;
const seed = 'https://research.example.org/structured-reading', pdfUrl = 'https://arxiv.org/pdf/2606.03979v2', htmlUrl = 'https://arxiv.org/html/2606.03979v2';
const sourceFixture = await readFile(resolve(root, 'apps/paper-agent/test/fixtures/scientific-document.html'), 'utf8');
const original = Buffer.from(sourceFixture.replace('</article>', '<table id="Tgap"><tr><td rowspan="2">A</td></tr><tr></tr><tr><td>B</td></tr></table></article>'));
const checks = [], errors = [], remoteRequests = [];
let app, page, frame;
const launch = () => electron.launch({ args: [resolve(root, 'desktop')], cwd: root, env });
async function ready() {
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https:\/\//.test(request.url())) remoteRequests.push(request.url()); });
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await expect.poll(() => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).apps?.some(app => app.name === 'paper-agent') ?? false)).toBe(true);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  // Desktop can refresh the installed bundle at restart. Reapply only this
  // disposable transport seam before any App backend is opened.
  const installed = resolve(profile, 'desktop/apps/paper-agent/backend');
  for (const [from, to] of [['research-pdf.py', 'pdf_fixture.py'], ['research-structured.py', 'structured_fixture.py']]) {
    await writeFile(resolve(installed, to), await readFile(resolve(root, 'tests/fixtures', from)));
  }
  await writeFile(resolve(installed, 'scientific-document.html'), original);
  const entry = resolve(installed, 'server.py'), text = await readFile(entry, 'utf8');
  if (!text.includes('from structured_fixture import install')) await writeFile(entry, paperDocumentBackendFixture(text));
}
async function openPaper() {
  await page.evaluate(path => window.pero.sessionCommand({ action: 'workspace', path }), profile);
  await expect.poll(() => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).workspace)).toBe(profile);
  await page.waitForFunction(() => { const c = document.querySelector('canvas'); return c?.width === Math.round(innerWidth * devicePixelRatio) && c.height === Math.round(innerHeight * devicePixelRatio); });
  await clickAppShortcut(page, 'paper-agent');
  frame = page.frameLocator('iframe[title="paper-agent"]');
  await expect(frame.getByRole('button', { name: 'Add papers', exact: true })).toBeVisible({ timeout: 30000 });
}
async function api(path, body) {
  return frame.locator('body').evaluate(async (_element, { path, body }) => {
    const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value = await response.json(); if (!response.ok) throw Error(value.detail || JSON.stringify(value)); return value;
  }, { path, body });
}
const requests = async () => (await readFile(resolve(profile, 'desktop/app-data/paper-agent/structured-fixture-requests.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const status = (bundle, resource) => api('/api/research/pdf', { operation: 'status', bundleId: bundle.id, resourceId: resource.id });
try {
  app = await launch(); await ready();
  // Freeze the installed offline fixture across restarts before opening its backend.
  await app.close();
  env.PERO_BUILTIN_APPS = ',';
  app = await launch(); await ready();
  // Retain the upstream wrong-version rejection before publishing any document.
  const installed = resolve(profile, 'desktop/apps/paper-agent/backend');
  const htmlFixture = resolve(installed, 'scientific-document.html');
  await writeFile(htmlFixture, original.toString('utf8').replace('content="2606.03979v2"', 'content="2606.03979v1"'));
  await openPaper(); await openResearchImport(page, frame);
  const review = await inspectResearchReview(frame, seed);
  const draft = (await api('/api/research/drafts')).drafts.find(d => d.seedUrl === seed);
  const resource = draft.resources.find(r => r.originalUrl === pdfUrl);
  expect(resource.revision).toBe('v2'); expect(resource.workIdentity).toBe('arxiv:2606.03979');
  const row = review.locator('.pa-resource-list>li').filter({ hasText: resource.title });
  await expect(row.getByRole('checkbox', { name: /^Allow official HTML for Read/ })).not.toBeChecked();
  expect((await requests()).filter(r => r.url === htmlUrl || r.url === pdfUrl)).toEqual([]);
  await row.getByRole('checkbox', { name: /^Download PDF for reading/ }).check();
  await row.getByRole('checkbox', { name: /^Allow official HTML for Read/ }).check();
  await expect(frame.getByRole('button', { name: 'Save and download', exact: true })).toBeDisabled();
  await frame.getByRole('checkbox', { name: /^I confirm downloading only/ }).check();
  await frame.getByRole('button', { name: 'Save and download', exact: true }).click();
  await expect(frame.getByRole('region', { name: 'PDF reading sources', exact: true })).toBeVisible();
  const bundle = (await api('/api/library')).bundles[0];
  expect(bundle.htmlDownloadIds).toEqual([resource.id]); expect(bundle.pdfDownloadIds).toEqual([resource.id]);
  await expect.poll(async () => (await status(bundle, resource)).status, { timeout: 60000 }).toBe('completed');
  const acquired = await status(bundle, resource), paperId = acquired.receipt.paperId;
  expect((await requests()).filter(r => r.url === htmlUrl)).toEqual([]);
  checks.push('Explicit fixed-v2 PDF and HTML grants; HTML is not fetched until Prepare Read');
  await frame.getByRole('button', { name: 'Open saved PDF', exact: true }).click();
  const viewer = frame.getByRole('region', { name: 'PDF reader', exact: true });
  await expect(viewer.locator('[data-page-number="1"] img,[data-page-number="1"] canvas').first()).toBeVisible({ timeout: 30000 });
  const bar = frame.locator('.pa-reader-tools');
  await expect(bar.getByRole('button', { name: 'PDF', exact: true })).toBeVisible();
  await expect(bar.getByRole('link', { name: 'Open original source', exact: true })).toHaveAttribute('href', pdfUrl);
  await bar.getByRole('spinbutton', { name: 'Page', exact: true }).fill('2');
  await expect(bar.getByRole('spinbutton', { name: 'Page', exact: true })).toHaveValue('2');
  const zoom = await bar.getByRole('button', { name: 'Fit page', exact: true }).innerText();
  await frame.getByRole('button', { name: 'Text', exact: true }).click();
  await frame.getByRole('button', { name: 'Prepare Read · v2', exact: true }).click();
  const rejection = frame.getByText('HTML identity differs from the requested version', { exact: false });
  await expect(rejection).toBeVisible({ timeout: 60000 });
  await expect(frame.getByRole('button', { name: 'Retry v2', exact: true })).toBeEnabled();
  expect((await api(`/api/paper-documents?paperId=${paperId}`)).revisions).toEqual([]);
  expect((await api('/api/research/source-report', { operation: 'observations', bundleId: bundle.id })).observations).toEqual([]);
  expect((await requests()).filter(r => r.url === htmlUrl)).toHaveLength(1);
  await page.screenshot({ path: resolve(out, 'structured-rejected-version.png') });
  await frame.getByRole('button', { name: 'PDF', exact: true }).click();
  await expect(viewer).toBeVisible();
  await expect(bar.getByRole('spinbutton', { name: 'Page', exact: true })).toHaveValue('2');
  await expect(bar.getByRole('button', { name: 'Fit page', exact: true })).toHaveText(zoom);
  await expect(viewer.locator('[data-page-number="2"] img,[data-page-number="2"] canvas').first()).toBeVisible();
  await frame.getByRole('button', { name: 'Text', exact: true }).click();
  await expect(rejection).toBeVisible();
  await writeFile(htmlFixture, original);
  await frame.getByRole('button', { name: 'Retry v2', exact: true }).click();
  await expect(frame.getByRole('button', { name: 'Read version', exact: true })).toBeVisible({ timeout: 60000 });
  const overview = await api(`/api/paper-documents?paperId=${paperId}`), identity = overview.revisions[0].id;
  const document = await api(`/api/paper-documents/${identity}`);
  await expect(rejection).toHaveCount(0);
  await expect(frame.getByRole('button', { name: 'Retry v2', exact: true })).toHaveCount(0);
  checks.push('Wrong-version HTML is visibly rejected without a document or observation; PDF page/zoom state is preserved with visible page content, and explicit Retry recovers through the same transport/parser');
  expect(document.source.digest).toBe(createHash('sha256').update(original).digest('hex'));
  expect(document.sourceIdentity).toBe('response-explicit-version');
  const orderedAnchors = ['S1.p1', 'E1', 'T1', 'F1', 'code', 'note1', 'A'];
  const orderedBlocks = orderedAnchors.map(anchor => document.blocks.find(block => block.anchors.includes(anchor)).id);
  await expect.poll(() => frame.locator('.pa-structured-reading [data-block-id]').evaluateAll(
    (elements, ids) => elements.map(element => element.dataset.blockId).filter(id => ids.includes(id)), orderedBlocks
  )).toEqual(orderedBlocks);
  await expect(frame.locator('.pa-structured-reading [style*="column-count"]')).toHaveCount(0);
  checks.push('Two-column native HTML retains source DOM block order in Read without importing source presentation CSS or claiming PDF column reconstruction');
  expect((await requests()).filter(r => r.url === htmlUrl)).toHaveLength(2);
  const table = document.blocks.find(b => b.kind === 'table'), equation = document.blocks.find(b => b.kind === 'equation'), figure = document.blocks.find(b => b.kind === 'figure');
  const sourceReports = input => api('/api/research/source-report', { bundleId: bundle.id, ...input });
  expect((await sourceReports({ operation: 'observations' })).observations).toEqual([]);
  const tableRead = await api('/api/paper-document', { operation: 'read', documentId: identity, blockId: table.id });
  expect(tableRead.evidenceAdmission).toBe('tool-observed-scope');
  const observedIds = [tableRead.observationId];
  expect(tableRead.unit).toBe('cells'); expect(tableRead.items.map(cell => cell.text)).toContain('−1.20');
  expect(tableRead.items.map(cell => cell.text)).toContain('µL');
  for (const block of [equation, figure]) {
    const value = await api('/api/paper-document', { operation: 'read', documentId: identity, blockId: block.id });
    expect(value.kind).toBe(block.kind); expect(value.evidenceAdmission).toBe('tool-observed-scope');
    expect(value.observationId).toMatch(/^[a-f0-9]{64}$/); observedIds.push(value.observationId);
  }
  const tableView = frame.locator(`[data-block-id="${table.id}"]`);
  await expect(tableView.locator('th[rowspan="2"]')).toHaveText('Method');
  await expect(tableView.locator('th[colspan="2"]')).toHaveText('Score');
  const gap = document.blocks.find(b => b.kind === 'table' && b.anchors.includes('Tgap'));
  const gapRows = frame.locator(`[data-block-id="${gap.id}"] tr`);
  await expect(gapRows).toHaveCount(3);
  await expect(gapRows.nth(1).locator('td,th')).toHaveCount(0);
  await expect(gapRows.first().locator('td')).toHaveAttribute('rowspan', '2');
  await expect(gapRows.nth(2).locator('td')).toHaveText('B');
  await expect(frame.locator(`[data-block-id="${equation.id}"] math`)).toBeVisible();
  await expect(frame.locator(`[data-block-id="${figure.id}"]`)).toContainText('Image bytes not acquired or visually observed.');
  await expect(frame.locator('.pa-structured-reading img')).toHaveCount(0);
  await tableView.getByRole('button', { name: 'Reveal original', exact: true }).click();
  const originalPanel = frame.getByRole('complementary', { name: 'Original HTML source', exact: true });
  await expect(originalPanel.locator('pre')).toContainText('<figure class="ltx_table"');
  await expect(originalPanel.locator('pre')).toContainText('rowspan="2"');
  await originalPanel.getByRole('button', { name: 'Close source', exact: true }).click();
  await frame.getByRole('button', { name: 'Original HTML', exact: true }).click();
  await expect(originalPanel.locator('pre')).toContainText('<!doctype html>');
  await originalPanel.getByRole('button', { name: 'Close source', exact: true }).click();
  const rawWindows = (await sourceReports({ operation: 'observations' })).observations.filter(item => item.anchor.documentScopes?.[0].unit === 'original-html');
  expect(rawWindows).toHaveLength(2);
  observedIds.push(...rawWindows.map(item => item.id));
  const shortRaw = await api('/api/paper-document', { operation: 'source', documentId: identity, start: 13, limit: 17, bundleId: bundle.id, resourceId: resource.id });
  expect(shortRaw.content).toBe(original.toString('utf8').slice(13, 30)); observedIds.push(shortRaw.observationId);
  expect((await sourceReports({ operation: 'observations' })).observations.map(item => item.id).sort()).toEqual([...observedIds].sort());
  await frame.getByText('Recorded evidence', { exact: true }).click();
  await frame.getByRole('button', { name: 'Refresh recorded evidence', exact: true }).click();
  const reports = frame.getByRole('region', { name: 'Source evidence reports', exact: true });
  await reports.getByText('New report from recorded evidence', { exact: true }).click();
  await expect(reports.getByRole('checkbox')).toHaveCount(observedIds.length);
  for (const checkbox of await reports.getByRole('checkbox').all()) await checkbox.check();
  await reports.getByLabel('Report title', { exact: true }).fill('Structured scopes');
  await reports.getByRole('button', { name: 'Save source report', exact: true }).click();
  await expect(reports.getByRole('article', { name: 'Saved source evidence report', exact: true })).toBeVisible();
  const sourceReport = (await sourceReports({ operation: 'list' })).reports[0];
  expect([...sourceReport.observationIds].sort()).toEqual([...observedIds].sort());
  expect(sourceReport.verification).toBe('tool_observed_scopes_only');
  expect(sourceReport.observations.every(item => item.kind === 'scientific_document')).toBe(true);
  expect(sourceReport.observations.find(item => item.anchor.documentScopes[0].unit === 'images').anchor.visualReview).toBe('not_reviewed');
  await reports.getByRole('button', { name: `Open recorded cells 0–${tableRead.end}`, exact: true }).click();
  await expect(tableView).toHaveAttribute('data-focused', 'true');
  await reports.getByRole('button', { name: 'Open recorded original-html 13–30', exact: true }).click();
  await expect(originalPanel.locator('pre')).toHaveText(shortRaw.content);
  await expect(originalPanel).toContainText('characters 13–30');
  expect((await sourceReports({ operation: 'observations' })).observations).toHaveLength(observedIds.length);
  await originalPanel.getByRole('button', { name: 'Close source', exact: true }).click();
  expect((await sourceReports({ operation: 'observations' })).observations).toHaveLength(observedIds.length);
  checks.push('Only actual typed and raw-markup windows enter the existing source-observation ledger; shared source-report UI saves and reopens fixed block scopes without additional observations');
  checks.push('Real LaTeXML parser and authenticated typed block reads preserve table strings, MathML and figure metadata; original byte windows reveal safely');
  // Delay delivery only: the real API has already parsed/persisted its unchanged response.
  await frame.locator('body').evaluate(deferDocumentRefresh);
  try {
    await frame.getByText('Source and parsing details', { exact: true }).click();
    await frame.getByRole('button', { name: 'Prepare fresh parse · v2', exact: true }).click();
    await expect.poll(() => frame.locator('body').evaluate(() => {
      if (window.paperRefreshGate.error) throw Error(window.paperRefreshGate.error);
      return window.paperRefreshGate.arrived;
    }), { message: 'Real document refresh response reached the App fetch gate' }).toBe(true);
    await expect(frame.getByRole('button', { name: 'Read version', exact: true })).toBeDisabled();
    await frame.locator('body').evaluate(() => window.paperRefreshGate.release());
    await expect(frame.getByRole('button', { name: 'Read version', exact: true })).toBeEnabled();
    expect(await frame.locator('body').evaluate(() => window.paperRefreshGate.delivered)).toBe(true);
  } finally {
    await frame.locator('body').evaluate(() => { window.paperRefreshGate.restore(); delete window.paperRefreshGate; });
  }
  expect((await requests()).filter(r => r.url === htmlUrl)).toHaveLength(3);
  checks.push('Logical empty table rows preserve rowspan; version switching is disabled while an actual refresh response is pending and recovers after delivery');
  await page.screenshot({ path: resolve(out, 'structured-light.png') });
  await frame.getByRole('button', { name: 'PDF', exact: true }).click();
  await expect(viewer).toBeVisible();
  await expect(bar.getByRole('spinbutton', { name: 'Page', exact: true })).toHaveValue('2');
  await expect(bar.getByRole('button', { name: 'Fit page', exact: true })).toHaveText(zoom);
  await frame.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(frame.getByRole('button', { name: 'Read version', exact: true })).toHaveAttribute('data-value', identity);
  await setPaperAppearance(page, 'dark');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 800));
  await expect.poll(() => frame.locator('html').evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: resolve(out, 'structured-dark-narrow.png') });
  await backToLibrary(frame);
  await app.close(); app = await launch(); await ready(); await openPaper();
  await frame.getByRole('region', { name: 'Research bundles', exact: true }).getByRole('button', { name: bundle.title, exact: true }).click();
  await frame.locator('.pa-research-bundle').getByText('Saved evidence', { exact: true }).click();
  const bundleReports = frame.locator('.pa-research-bundle').getByRole('region', { name: 'Source evidence reports', exact: true });
  await bundleReports.getByRole('button', { name: 'Structured scopes', exact: true }).click();
  await expect(bundleReports.getByRole('article', { name: 'Saved source evidence report', exact: true })).toBeVisible();
  await expect(bundleReports.getByRole('button', { name: /^Open recorded/ })).toHaveCount(0);
  expect((await requests()).filter(r => r.url === htmlUrl)).toHaveLength(3);
  checks.push('Library bundle opens historical source reports independently of Reader preparation, without fetching originals or offering implicit restore');
  await frame.getByRole('button', { name: 'Open saved PDF', exact: true }).click();
  const readButton = frame.getByRole('button', { name: 'Read', exact: true });
  await expect(readButton).toBeVisible(); await readButton.click();
  await expect(frame.getByRole('button', { name: 'Read version', exact: true })).toHaveAttribute('data-value', identity);
  expect((await requests()).filter(r => r.url === htmlUrl)).toHaveLength(3);
  await frame.getByText('Recorded evidence', { exact: true }).click();
  const reopenedReports = frame.getByRole('region', { name: 'Source evidence reports', exact: true });
  await reopenedReports.getByRole('button', { name: 'Structured scopes', exact: true }).click();
  await expect(reopenedReports.getByRole('article', { name: 'Saved source evidence report', exact: true })).toBeVisible();
  await reopenedReports.getByRole('button', { name: `Open recorded cells 0–${tableRead.end}`, exact: true }).click();
  await expect(frame.locator(`[data-block-id="${table.id}"]`)).toHaveAttribute('data-focused', 'true');
  expect(await sourceReports({ operation: 'read', reportId: sourceReport.id })).toEqual(sourceReport);
  expect((await sourceReports({ operation: 'observations' })).observations).toHaveLength(observedIds.length);
  checks.push('Read/PDF retains page and zoom; real Desktop/backend restart reopens the same offline parse without acquisition');
  // A distinct approved review reuses the exact original, but owns its own
  // evidence receipt. Do not silently attribute its reads to the first bundle.
  await backToLibrary(frame); await openResearchImport(page, frame);
  const secondReview = await inspectResearchReview(frame, seed + '-second');
  const secondDraft = (await api('/api/research/drafts')).drafts.find(d => d.seedUrl === seed + '-second');
  const secondResource = secondDraft.resources.find(r => r.originalUrl === pdfUrl);
  const secondRow = secondReview.locator('.pa-resource-list>li').filter({ hasText: secondResource.title });
  await secondRow.getByRole('checkbox', { name: /^Download PDF for reading/ }).check();
  await secondRow.getByRole('checkbox', { name: /^Allow official HTML for Read/ }).check();
  await frame.getByRole('checkbox', { name: /^I confirm downloading only/ }).check();
  await frame.getByRole('button', { name: 'Save and download', exact: true }).click();
  await expect(frame.getByRole('region', { name: 'PDF reading sources', exact: true })).toBeVisible();
  const secondBundle = (await api('/api/library')).bundles.find(b => b.seedUrl === seed + '-second');
  expect(secondBundle.id).not.toBe(bundle.id);
  await expect.poll(async () => (await status(secondBundle, secondResource)).status, { timeout: 60000 }).toBe('completed');
  expect((await status(secondBundle, secondResource)).receipt.paperId).toBe(paperId);
  await frame.getByRole('button', { name: 'Open saved PDF', exact: true }).click();
  await frame.getByRole('button', { name: 'Read', exact: true }).click();
  await frame.getByText('Source and parsing details', { exact: true }).click();
  await expect(frame.getByRole('button', { name: 'Prepare fresh parse · v2', exact: true })).toHaveCount(2);
  await expect(frame.getByRole('button', { name: 'Read version', exact: true })).toHaveAttribute('data-value', identity);
  expect(await sourceReports({ operation: 'read', reportId: sourceReport.id })).toEqual(sourceReport);
  // Hold only the real refreshed overview after B preparation. The old overview
  // still contains A; no original read may silently fall back to that scope.
  await frame.locator('body').evaluate(() => {
    const original = window.fetch; let release;
    const held = new Promise(resolve => { release = resolve; });
    window.paperScopeOverviewGate = { arrived: false, error: '', release, restore() { window.fetch = original; release(); } };
    window.fetch = async (...args) => {
      const response = await original.apply(window, args);
      if (new URL(typeof args[0] === 'string' ? args[0] : args[0].url, location.href).pathname === '/api/paper-documents') {
        if (!response.ok) window.paperScopeOverviewGate.error = `Overview failed: ${response.status}`;
        await response.clone().arrayBuffer(); window.paperScopeOverviewGate.arrived = true; await held;
      }
      return response;
    };
  });
  try {
    await frame.getByRole('button', { name: 'Use saved Read · v2', exact: true }).click();
    await expect.poll(() => frame.locator('body').evaluate(() => {
      if (window.paperScopeOverviewGate.error) throw Error(window.paperScopeOverviewGate.error);
      return window.paperScopeOverviewGate.arrived;
    })).toBe(true);
    await expect(frame.getByRole('button', { name: 'Original HTML', exact: true })).toBeDisabled();
    await expect(frame.getByRole('button', { name: 'Reveal original', exact: true }).first()).toBeDisabled();
    expect((await api('/api/research/source-report', { operation: 'observations', bundleId: secondBundle.id })).observations).toEqual([]);
    expect((await sourceReports({ operation: 'observations' })).observations).toHaveLength(observedIds.length);
    await frame.locator('body').evaluate(() => window.paperScopeOverviewGate.release());
    await expect(frame.getByRole('button', { name: 'Original HTML', exact: true })).toBeEnabled();
  } finally { await frame.locator('body').evaluate(() => { window.paperScopeOverviewGate.restore(); delete window.paperScopeOverviewGate; }); }
  const selectedEvidence = `${secondBundle.id}:${secondResource.id}`;
  await expect(frame.getByRole('button', { name: 'Evidence bundle', exact: true })).toHaveAttribute('data-value', selectedEvidence);
  expect((await requests()).filter(r => r.url === htmlUrl)).toHaveLength(3);
  await frame.getByRole('button', { name: 'Original HTML', exact: true }).click();
  await expect(frame.getByRole('complementary', { name: 'Original HTML source', exact: true })).toBeVisible();
  const secondScope = { documentId: identity, bundleId: secondBundle.id, resourceId: secondResource.id };
  const secondTyped = await api('/api/paper-document', { operation: 'read', blockId: table.id, ...secondScope });
  const secondRaw = await api('/api/paper-document', { operation: 'source', start: 13, limit: 17, ...secondScope });
  const secondReport = await api('/api/research/source-report', { operation: 'create', bundleId: secondBundle.id,
    title: 'Second scoped report', observationIds: [secondTyped.observationId, secondRaw.observationId] });
  expect(secondReport.observations.every(o => o.bundleId === secondBundle.id && o.resourceId === secondResource.id)).toBe(true);
  expect(await sourceReports({ operation: 'read', reportId: sourceReport.id })).toEqual(sourceReport);
  await backToLibrary(frame); await app.close(); app = await launch(); await ready(); await openPaper();
  await frame.getByRole('region', { name: 'Research bundles', exact: true }).getByRole('button', { name: secondBundle.title, exact: true }).click();
  await frame.getByRole('button', { name: 'Open saved PDF', exact: true }).click();
  await frame.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(frame.getByRole('button', { name: 'Evidence bundle', exact: true })).toHaveAttribute('data-value', selectedEvidence);
  await frame.getByText('Recorded evidence', { exact: true }).click();
  await frame.getByRole('button', { name: 'Second scoped report', exact: true }).click();
  await frame.getByRole('button', { name: 'Open recorded original-html 13–30', exact: true }).click();
  await expect(frame.getByRole('complementary', { name: 'Original HTML source', exact: true }).locator('pre')).toHaveText(secondRaw.content);
  expect((await requests()).filter(r => r.url === htmlUrl)).toHaveLength(3);
  expect(await api('/api/research/source-report', { operation: 'read', bundleId: secondBundle.id, reportId: secondReport.id })).toEqual(secondReport);
  checks.push('Second approved bundle reuses identical HTML without fetching; selected typed/raw report ownership and exact windows survive restart without changing the first report');
  await backToLibrary(frame);
  const toolbarBar = frame.locator('.pa-reader-tools'), toolbarViewer = frame.getByRole('region', { name: 'PDF reader', exact: true });
  const toolbarPaper = await api('/api/papers/import', { title: 'Toolbar reading fixture', sourceId: '2606.03979v2',
    url: 'https://arxiv.org/abs/2606.03979v2', pdfUrl, authors: [], contentKind: 'abstract', content: 'Official abstract fixture.' });
  await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
  const saved = await saveLibraryCopies(frame, toolbarPaper.title);
  await saved.getByRole('button', { name: 'Close', exact: true }).click();
  await frame.locator('.pa-library-list .pero-list-open').filter({ has: frame.getByText(toolbarPaper.title, { exact: true }) }).click();
  await toolbarBar.getByRole('button', { name: 'PDF', exact: true }).click();
  await expect(toolbarViewer).toBeVisible();
  const format = toolbarBar.getByRole('button', { name: 'Format', exact: true });
  const boxes = await Promise.all(['Text', 'PDF', 'Format', 'Zoom in'].map(name => toolbarBar.getByRole('button', { name, exact: true }).boundingBox()));
  expect(boxes.every(box => box && Math.abs(box.y - boxes[0].y) <= 4)).toBe(true);
  await expect(toolbarBar.getByRole('link', { name: 'Open original source', exact: true })).toHaveAttribute('href', toolbarPaper.url);
  await format.click();
  await expect(toolbarBar.getByRole('button', { name: 'Download and format', exact: true })).toBeVisible();
  await expect(toolbarBar.locator('.pa-reading-source-menu')).toContainText('arXiv v2');
  await expect(frame.locator('.pa-structured-reading').getByRole('button', { name: 'Format', exact: true })).toHaveCount(0);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 800));
  await expect.poll(() => toolbarBar.locator('.pa-reading-source-options').evaluate(element => {
    const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth;
  })).toBe(true);
  await page.screenshot({ path: resolve(out, 'toolbar-source-review-narrow.png') });
  await writeFile(resolve(profile, 'desktop/app-data/paper-agent/fail-next-html'), 'synthetic acquisition failure');
  await toolbarBar.getByRole('button', { name: 'Download and format', exact: true }).click();
  await expect(toolbarBar.getByRole('alert')).toContainText('503');
  await expect(toolbarViewer).toBeVisible();
  await page.screenshot({ path: resolve(out, 'toolbar-format-error.png') });
  await toolbarBar.getByRole('button', { name: 'Retry v2', exact: true }).click();
  await expect(frame.getByRole('button', { name: 'Read version', exact: true })).toBeVisible({ timeout: 60000 });
  await expect(toolbarViewer).not.toBeVisible();
  await toolbarBar.getByRole('button', { name: 'PDF', exact: true }).click();
  await expect(toolbarViewer).toBeVisible();
  await expect(toolbarBar.getByRole('button', { name: 'Read', exact: true })).toBeVisible();
  checks.push('Saved arXiv paper reviews and formats beside Text/PDF; original link, one-row controls, narrow source menu, visible acquisition failure/retry and automatic Read/PDF switching work through real APIs');
  expect(errors).toEqual([]); expect(remoteRequests).toEqual([]);
  // Export a private stopped-profile copy through the existing real JSON CLI.
  await app.close(); app = null;
  const exportedCache = resolve(profile, 'export-cache');
  await cp(resolve(profile, 'desktop/app-data/paper-agent'), exportedCache, { recursive: true });
  const exported = JSON.parse(execFileSync(env.PERO_APP_PYTHON || 'python3', [resolve(root, 'apps/paper-agent/tools/research.py'), '--cache', exportedCache], {
    cwd: root, env, timeout: 15000, input: JSON.stringify({ action: 'export', input: { bundleId: bundle.id } }), encoding: 'utf8',
  }));
  expect(exported.ok).toBe(true); expect(exported.result.sourceReports).toEqual([sourceReport]);
  expect(JSON.stringify(exported.result.sourceReports)).not.toContain('−1.20');
  expect(JSON.stringify(exported.result)).not.toContain('<article');
  checks.push('Restart and evidence-only CLI export preserve the same typed-scope report; no original HTML or table strings are exported');
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ checks, errors, network: 'authored offline transport only', agent: 'none', scientificAcceptance: 'unverified', documentId: identity, sourceDigest: document.source.digest }, null, 2));
} catch (error) {
  if (page) await page.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {});
  await writeFile(resolve(out, 'failure.json'), JSON.stringify({ error: String(error), scope: 'Failed attempt, not acceptance; synthetic corpus only.' }, null, 2));
  throw error;
} finally { if (app) await app.close(); await rm(profile, { recursive: true, force: true }); }

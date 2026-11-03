// Actual Electron/Host/Paper source-only UI. All default inputs are authored fixtures; no Agent runs.
import { exerciseLibrarySave } from './paper-library-save-desktop.mjs';
import { execFileSync } from 'node:child_process';
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { openResearchImport, researchUiState } from './paper-research-ui-controls.mjs';
import { clickAppShortcut } from './sidebar-controls.mjs';
import { setPaperAppearance, backToLibrary } from './paper-pdf-flow.mjs';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '../..'), live = process.env.PERO_SOURCE_STUDY_LIVE === '1';
const out = resolve(root, `test-results/paper-source-study/${live ? 'live-network' : 'fixture'}`);
await mkdir(out, { recursive: true });
const profile = await realpath(await mkdtemp(resolve(tmpdir(), 'pero-source-study-')));
const settings = resolve(profile, 'settings.json'), agents = resolve(profile, 'agents.json');
await writeFile(settings, JSON.stringify(process.env.PERO_APP_PYTHON ? { app_python: { apps: { 'paper-agent': dirname(dirname(process.env.PERO_APP_PYTHON)) } } } : {}));
await writeFile(agents, JSON.stringify(['pero', 'codex', 'claude', 'copilot', 'grok', 'qoder', 'opencode'].map(id => ({ id, name: id, command: resolve(profile, `unavailable-${id}`) }))));
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(profile, 'desktop'), PERO_SETTINGS_PATH: settings,
  PERO_HISTORY_PATH: resolve(profile, 'history.jsonl'), PERO_AGENTS_FILE: agents, PERO_LOCALE: 'en', PERO_BUILTIN_APPS: 'paper-agent', PERO_REQUIRED_APPS: 'paper-agent', PERO_APP_INFRA_EMBED: '0' };
delete env.ELECTRON_RUN_AS_NODE; delete env.PERO_APPS_ROOT;
const seed = live ? 'https://arxiv.org/src/2610.24806v1' : 'https://research.example.org/source-study';
const checks = [], errors = [], receipts = [], acquisitionConflicts = [];
let app, page, frame, savedSourceReport, savedWindowReport, savedWindows;
const launch = () => electron.launch({ args: [resolve(root, 'desktop')], cwd: root, env });
async function ready() {
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() === 409 && /\/api\/research\/(?:source|pdf)$/.test(response.url())) acquisitionConflicts.push(response.url()); });
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await expect.poll(() => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).apps?.some(app => app.name === 'paper-agent') ?? false)).toBe(true);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
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
    const value = await response.json(); if (!response.ok) throw Error(value.detail || `HTTP ${response.status}`); return value;
  }, { path, body });
}
async function inspect() {
  await openResearchImport(page, frame);
  await frame.getByRole('textbox', { name: 'Research URL', exact: true }).fill(seed);
  await frame.getByRole('textbox', { name: 'Research URL', exact: true }).press('Enter');
  await expect(frame.getByRole('region', { name: 'Review resources' })).toBeVisible({ timeout: 65000 });
  return (await api('/api/research/drafts')).drafts.find(draft => draft.seedUrl === seed);
}
const sources = () => frame.getByRole('region', { name: 'TeX source', exact: true });
// Display headings collapse to TeX source for one item and work identity for
// several. The exact discovery title remains in each row's provenance.
const row = title => sources().locator(':scope > ul > li').filter({ has: frame.locator('.pa-source-provenance').getByText(title, { exact: true }) });
const sourceDialog = () => frame.getByRole('dialog').filter({ has: frame.locator('.pa-source-browser') });
async function openSource(title, action = 'Browse source files') {
  await row(title).getByRole('button', { name: action, exact: true }).click();
  await expect(sourceDialog()).toBeVisible();
  await expect(sourceDialog().locator('.pa-source-analysis')).not.toHaveAttribute('open', '');
}
async function openSourceAnalysis() {
  await sourceDialog().getByText('PDF comparison and evidence', { exact: true }).click();
  await expect(sourceDialog().locator('.pa-source-analysis')).toHaveAttribute('open', '');
}
async function closeSource() {
  await sourceDialog().getByRole('button', { name: 'Close', exact: true }).click();
  await expect(sourceDialog()).toHaveCount(0);
}
const sourceStatus = (bundle, resource) => api('/api/research/source', { operation: 'status', bundleId: bundle.id, resourceId: resource.id });
const requests = async () => (await readFile(resolve(profile, 'desktop/app-data/paper-agent/source-fixture-requests.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
try {
  app = await launch(); await ready();
  if (!live) {
    const installed = resolve(profile, 'desktop/apps/paper-agent/backend');
    await writeFile(resolve(installed, 'source_fixture.py'), await readFile(resolve(root, 'tests/fixtures/research-source.py')));
    const entry = resolve(installed, 'server.py'), text = await readFile(entry, 'utf8');
    const marker = '    store = ResearchStore(os.environ["PERO_APP_DATA"], open_embedder())'; expect(text.split(marker)).toHaveLength(2);
    expect(text).not.toContain('from source_fixture import install');
    const handler = 'handler(store, os.environ["PERO_APP_TOKEN"]';
    expect(text.split(handler)).toHaveLength(2);
    await writeFile(entry, text.replace(marker, `${marker}\n    from source_fixture import install\n    fixture_pdf_files = install(store)`)
      .replace(handler, `${handler}, pdf_files=fixture_pdf_files`));
  }
  await openPaper(); let draft = await inspect();
  const candidates = draft.resources.filter(resource => resource.kind === 'source_archive');
  expect(candidates.length).toBe(live ? 1 : 3);
  const source = live ? candidates[0] : candidates.find(resource => resource.originalUrl.endsWith('/2610.00001v1'));
  await expect(frame.getByRole('checkbox', { name: /^Get source for read-only inspection/ }).first()).not.toBeChecked();
  await frame.getByRole('button', { name: 'Save references only', exact: true }).click();
  await expect(frame.locator('.pa-research-bundle')).toBeVisible();
  let bundle = (await api('/api/library')).bundles[0];
  await expect(frame.locator('.pa-research-bundle .pa-bundle-header').getByRole('heading', { name: bundle.title, exact: true })).toBeVisible();
  expect(bundle.sourceDownloadIds).toEqual([]);
  if (!live) expect((await requests()).filter(item => item.kind !== 'metadata')).toEqual([]);
  draft = await inspect();
  await frame.getByRole('region', { name: 'Review resources' }).locator('.pa-resource-list>li').filter({ hasText: source.title }).getByRole('checkbox', { name: /^Get source for read-only inspection/ }).check();
  await expect(frame.getByRole('button', { name: 'Save and download', exact: true })).toBeDisabled();
  await frame.getByRole('checkbox', { name: /^I confirm downloading only/ }).check();
  await frame.getByRole('button', { name: 'Save and download', exact: true }).dblclick();
  await expect(sources()).toBeVisible(); bundle = (await api('/api/library')).bundles[0];
  if (!live) {
    await expect(row(source.title)).toContainText('Download failed', { timeout: 15000 });
    expect((await sourceStatus(bundle, source)).receipt).toBeNull();
    await row(source.title).getByRole('button', { name: 'Retry source download', exact: true }).dblclick();
  }
  await expect(row(source.title)).toContainText('Downloaded', { timeout: 60000 });
  const acquired = await sourceStatus(bundle, source); receipts.push(acquired.receipt);
  expect(acquired.localAvailable).toBe(true); expect(bundle.pdfDownloadIds).toEqual([]);
  if (live) {
    await row(source.title).getByText('Source and download details', { exact: true }).click();
    // Live third-party source UI is never captured in public artifacts.
  }
  await openSource(source.title);
  const catalog = await api('/api/research/source-read', { operation: 'list', bundleId: bundle.id, resourceId: source.id });
  const tex = catalog.members.find(member => member.path === 'main.tex') || catalog.members.find(member => member.path.endsWith('.tex'));
  expect(tex).toBeTruthy();
  if (!live) expect((await api('/api/research/source-report', { operation: 'observations', bundleId: bundle.id })).observations).toEqual([]);
  await sourceDialog().getByRole('button', { name: tex.path, exact: true }).click();
  await expect(frame.getByLabel(`Original source: ${tex.path}`, { exact: true })).toBeVisible();
  await openSourceAnalysis();
  await expect(sourceDialog().getByRole('region', { name: 'Compare with saved PDF', exact: true })).toContainText('No PDF saved for comparison. Download a fixed-version PDF first.');
  if (!live) {
    expect((await requests()).filter(item => item.kind === 'pdf')).toEqual([]);
    await page.screenshot({ path: resolve(out, 'source-lines-light.png') });
    await sourceDialog().getByRole('button', { name: 'figure.png', exact: true }).click();
    const image = frame.getByRole('img', { name: 'Source image figure.png', exact: true });
    await expect(image).toBeVisible(); expect(await image.evaluate(element => element.naturalWidth)).toBe(1);
    await setPaperAppearance(page, 'dark'); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 800));
    await expect.poll(() => frame.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: resolve(out, 'source-image-dark-narrow.png') });
    const reports = sourceDialog().getByRole('region', { name: 'Recorded evidence', exact: true });
    await reports.getByText('New report from recorded evidence', { exact: true }).click();
    await expect(reports.getByRole('checkbox')).toHaveCount(2);
    for (const choice of await reports.getByRole('checkbox').all()) await choice.check();
    await reports.getByLabel('Report title', { exact: true }).fill('Authored source evidence');
    await reports.getByLabel('Interpretation (optional; unresolved)', { exact: true }).fill('The authored figure may relate to the table; not established.');
    await reports.getByRole('button', { name: 'Save source report', exact: true }).click();
    await expect(reports.getByRole('article', { name: 'Saved source evidence report', exact: true })).toBeVisible();
    await expect(reports.getByRole('region', { name: 'Unresolved interpretations', exact: true })).toContainText('not established');
    savedSourceReport = (await api('/api/research/source-report', { operation: 'list', bundleId: bundle.id })).reports[0];
    expect(savedSourceReport.observations.map(item => item.kind).sort()).toEqual(['source_image', 'source_text']);
    expect(savedSourceReport.currentAvailability.every(item => item.available)).toBe(true);
    await page.screenshot({ path: resolve(out, 'source-report-dark-narrow.png') });
    const readRequest = { operation: 'read', bundleId: bundle.id, resourceId: source.id, memberId: tex.id };
    const short = await api('/api/research/source-read', { ...readRequest, startLine: 1, endLine: 3 });
    const partial = await api('/api/research/source-read', { ...readRequest, start: 2, end: short.content.indexOf('\n') + 4 });
    savedWindows = [short, partial];
    savedWindowReport = await api('/api/research/source-report', { operation: 'create', bundleId: bundle.id,
      title: 'Exact bounded evidence', observationIds: savedWindows.map(value => value.observationId) });

  }
  checks.push('Explicit source-only consent, failure retry, original source lines and raster preview; no PDF/code/model download or TeX execution');
  await app.close(); app = await launch(); await ready(); await openPaper();
  await frame.getByRole('navigation', { name: 'Papers', exact: true }).getByRole('button', { name: bundle.title, exact: true }).click();
  expect((await sourceStatus(bundle, source)).receipt).toEqual(acquired.receipt);
  await api('/api/research/source', { operation: 'start', bundleId: bundle.id, resourceId: source.id });
  if (!live) expect((await requests()).filter(item => item.url === source.originalUrl)).toHaveLength(2);
  checks.push('Actual Desktop/backend restart and repeated start reuse the same archive receipt without reacquisition');
  if (!live) {
    await openSource(source.title);
    await openSourceAnalysis();
    const reports = sourceDialog().getByRole('region', { name: 'Recorded evidence', exact: true });
    await reports.getByRole('button', { name: 'Authored source evidence', exact: true }).click();
    await expect(reports.getByRole('article', { name: 'Saved source evidence report', exact: true })).toBeVisible();
    const reopened = await api('/api/research/source-report', { operation: 'read', bundleId: bundle.id, reportId: savedSourceReport.id });
    expect(reopened).toEqual(savedSourceReport);
    await reports.getByRole('article', { name: 'Saved source evidence report', exact: true }).getByRole('listitem').filter({ hasText: tex.path }).first().getByRole('button', { name: 'Open original evidence', exact: true }).click();
    await expect(frame.getByLabel(`Original source: ${tex.path}`, { exact: true })).toBeVisible();
    expect(await api('/api/research/source-report', { operation: 'read', bundleId: bundle.id, reportId: savedSourceReport.id })).toEqual(savedSourceReport);
    await reports.getByRole('button', { name: 'Exact bounded evidence', exact: true }).click();
    const observationCount = (await api('/api/research/source-report', { operation: 'observations', bundleId: bundle.id })).observations.length;
    for (const original of savedWindows) {
      const saved = reports.getByRole('article', { name: 'Saved source evidence report', exact: true });
      const label = `${tex.path}, lines ${original.startLine}–${original.endLine}, characters ${original.start}–${original.end}`;
      const evidence = saved.getByRole('listitem').filter({ has: frame.getByText(label, { exact: true }) });
      await evidence.getByRole('button', { name: 'Open original evidence', exact: true }).click();
      await expect(frame.getByLabel(`Original source: ${tex.path}`, { exact: true })).toHaveText(original.content);
      await expect(sourceDialog().getByText(`Lines ${original.startLine}–${original.endLine} of ${original.totalLines}`, { exact: true })).toBeVisible();
      // Character offsets now live in the saved evidence identity, not the
      // compact source header. Verify those exact bounds through the visible UI.
      const identity = evidence.locator(':scope > details');
      if (!await identity.evaluate(element => element.open)) await identity.locator('summary').click();
      await expect(identity.locator('pre')).toBeVisible();
      expect(JSON.parse(await identity.locator('pre').innerText())).toMatchObject({
        archiveDigest: original.archiveDigest, memberId: original.memberId, memberDigest: original.memberDigest,
        start: original.start, end: original.end, startLine: original.startLine, endLine: original.endLine,
      });
      expect((await api('/api/research/source-report', { operation: 'observations', bundleId: bundle.id })).observations).toHaveLength(observationCount);
    }
    expect(await api('/api/research/source-report', { operation: 'read', bundleId: bundle.id, reportId: savedWindowReport.id })).toEqual(savedWindowReport);
    await reports.getByRole('button', { name: 'Authored source evidence', exact: true }).click();
    const originalPath = resolve(profile, 'desktop/app-data/paper-agent/research-v1/source-files', acquired.receipt.archiveDigest + '.bin');
    const originalBytes = await readFile(originalPath);
    await rm(originalPath);
    await closeSource();
    await row(source.title).getByRole('button', { name: 'Refresh source status', exact: true }).click();
    await expect(row(source.title)).toContainText('Local files unavailable');
    await openSource(source.title, 'Open saved source evidence');
    await openSourceAnalysis();
    await reports.getByRole('button', { name: 'Authored source evidence', exact: true }).click();
    await expect(reports.getByText('Original unavailable. Restore its exact version before rereading.', { exact: true })).toHaveCount(2);
    await expect(reports.getByRole('button', { name: 'Open original evidence', exact: true })).toHaveCount(0);
    await writeFile(originalPath, originalBytes); // Restore only the self-authored fixture bytes.
    await closeSource();
    await row(source.title).getByRole('button', { name: 'Refresh source status', exact: true }).click();
    await expect(row(source.title)).toContainText('Downloaded');
    expect(await api('/api/research/source-report', { operation: 'read', bundleId: bundle.id, reportId: savedSourceReport.id })).toEqual(savedSourceReport);
    checks.push('Only actual source/image reads become report evidence; selected scopes and unresolved interpretation persist through Desktop restart and missing-original recovery');
  }
  if (!live) {
    const single = candidates.find(item => item.originalUrl.endsWith('/2610.00002v1')), pdfOnly = candidates.find(item => item.originalUrl.endsWith('/2610.00003v1'));
    await inspect();
    await frame.getByRole('region', { name: 'Review resources' }).locator('.pa-resource-list>li').filter({ hasText: single.title }).getByRole('checkbox', { name: /^Get source for read-only inspection/ }).check();
    await frame.getByRole('checkbox', { name: /^I confirm downloading only/ }).check();
    await frame.getByRole('button', { name: 'Save and download', exact: true }).click();
    await expect.poll(async () => (await requests()).filter(item => item.url === single.originalUrl).length).toBe(1);
    await row(single.title).getByRole('button', { name: 'Cancel source download', exact: true }).click();
    await expect(row(single.title)).toContainText('Download cancelled', { timeout: 10000 });
    expect((await sourceStatus(bundle, single)).receipt).toBeNull();
    expect((await requests()).filter(item => item.kind === 'pdf')).toEqual([]);
    // One new explicit review retries the cancelled source and authorizes the first PDF.
    // The shared worker must finish the gzip source before the PDF queue can start.
    await inspect();
    const pdf = draft.resources.find(resource => resource.kind === 'pdf_candidate');
    const review = frame.getByRole('region', { name: 'Review resources' });
    await review.locator('.pa-resource-list>li').filter({ hasText: single.title }).getByRole('checkbox', { name: /^Get source for read-only inspection/ }).check();
    await review.locator('.pa-resource-list>li').filter({ hasText: pdf.title }).getByRole('checkbox', { name: /^Download PDF/ }).check();
    await review.getByRole('checkbox', { name: /^I confirm downloading only/ }).check();
    await frame.getByRole('button', { name: 'Save and download', exact: true }).click();
    bundle = (await api('/api/library')).bundles[0];
    await expect(row(single.title)).toContainText('Downloaded', { timeout: 15000 });
    const gzipSource = await sourceStatus(bundle, single);
    expect(gzipSource.receipt.texCount).toBe(1);
    const pdfSources = frame.getByRole('region', { name: 'PDF', exact: true });
    await expect(pdfSources.locator(':scope > ul > li').locator('.pa-bundle-resource-row > .pa-bundle-status[role="status"]')).toHaveText('Downloaded', { timeout: 15000 });
    await expect(pdfSources).toContainText('Text on 1 pages');
    const downloadedPdf = await api('/api/research/pdf', { operation: 'status', bundleId: bundle.id, resourceId: pdf.id });
    expect(downloadedPdf.localAvailable).toBe(true);
    expect(downloadedPdf.receipt.textPages).toBe(1);
    expect(downloadedPdf.receipt.textCharacters).toBeGreaterThan(0);
    const acquisitionRequests = (await requests()).filter(item => item.kind !== 'metadata');
    expect(acquisitionRequests.filter(item => item.url === single.originalUrl)).toHaveLength(2);
    expect(acquisitionRequests.filter(item => item.kind === 'pdf')).toHaveLength(1);
    expect(acquisitionRequests.findLastIndex(item => item.url === single.originalUrl)).toBeLessThan(acquisitionRequests.findIndex(item => item.kind === 'pdf'));
    expect(acquisitionConflicts).toEqual([]);
    checks.push('One explicit review selects source plus first PDF: cancelled source retries to gzip before PDF acquisition, with no shared-worker 409');
    await openSource(source.title);
    await openSourceAnalysis();
    const compare = sourceDialog().getByRole('region', { name: 'Compare with saved PDF', exact: true });
    await compare.getByRole('combobox', { name: 'Select a saved PDF', exact: true }).selectOption(pdf.id);
    await compare.getByRole('button', { name: 'Compare source and PDF', exact: true }).click();
    await expect(compare).toContainText('Evidence-backed caption matches');
    await compare.getByRole('button', { name: 'Open matched PDF page 1', exact: true }).first().click();
    // Navigation must release the native modal, not leave the PDF reader inert.
    await expect(frame.locator('.pa-tex-source-dialog[open]')).toHaveCount(0);
    const viewer = frame.getByRole('region', { name: 'PDF reader', exact: true });
    await expect(viewer.locator('[data-page-number="1"] img,[data-page-number="1"] canvas').first()).toBeVisible({ timeout: 30000 });
    await expect(frame.locator('.pa-reader-tools').getByRole('spinbutton', { name: 'Page', exact: true })).toHaveValue('1');
    await page.screenshot({ path: resolve(out, 'source-caption-pdf-page.png') });
    checks.push('Separately approved PDF literal caption comparison resolves source lines and opens the matching version/page');
    await backToLibrary(frame); await inspect();
    await frame.getByRole('region', { name: 'Review resources' }).locator('.pa-resource-list>li').filter({ hasText: pdfOnly.title }).getByRole('checkbox', { name: /^Get source for read-only inspection/ }).check();
    await frame.getByRole('checkbox', { name: /^I confirm downloading only/ }).check();
    await frame.getByRole('button', { name: 'Save and download', exact: true }).click();
    await expect(row(pdfOnly.title)).toContainText('PDF only; no TeX source', { timeout: 15000 });
    checks.push('Cancellation interrupts source acquisition; explicit retry accepts gzip single TeX; PDF-only response never claims TeX');
  }
  if (!live) {
    const priorPdf = await api('/api/research/pdf', { operation: 'status', bundleId: bundle.id, resourceId: bundle.pdfDownloadIds[0] });
    await exerciseLibrarySave({ frame, page, api, requests, out, profile, priorDocumentId: priorPdf.receipt.documentId, restart: async () => {
      await app.close(); app = await launch(); await ready(); await openPaper(); return { frame, page };
    } });
    checks.push('Library explicit fixed-version copies, cancellation, original identity/annotations, evidence ledger and Desktop restart');
  }
  expect(errors).toEqual([]); expect(acquisitionConflicts).toEqual([]);
  if (live) {
    await app.close(); app = null;
    execFileSync(env.PERO_APP_PYTHON || 'python3', [resolve(root, 'tests/e2e/paper-source-live.py'),
      '--cache', resolve(profile, 'desktop/app-data/paper-agent'), '--output', resolve(out, 'three-materials.json'),
      '--aptamer-bundle', bundle.id, '--aptamer-resource', source.id],
      { cwd: root, env, timeout: 105000, stdio: 'pipe' });
    checks.push('Three fixed-v1 real source CLI journeys: classification, original scopes, reports and restart');
  }
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ checks, errors, receipts, acquisitionConflicts, network: live ? 'real arXiv product path' : 'synthetic transport', agent: 'none', compilation: 'none', sourceBytesExported: false }, null, 2));
} catch (error) {
  if (page && !live) {
    await page.screenshot({ path: resolve(out, 'failure.png'),
      ...(live ? { mask: [page.locator('iframe[title="paper-agent"]'), page.locator('canvas')] } : {}) }).catch(() => {});
    await writeFile(resolve(out, 'failure-view.json'), JSON.stringify(
      await researchUiState(page, frame).catch(() => ({ unavailable: true })), null, 2));
  }
  await writeFile(resolve(out, 'failure.json'), JSON.stringify({ error: String(error), live, outcome: 'failed attempt, not acceptance' }, null, 2));
  throw error;
} finally { if (app) await app.close(); await rm(profile, { recursive: true, force: true }); }

// Actual Electron/Host/Paper source-only UI. All default inputs are authored fixtures; no Agent runs.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { openResearchImport, researchUiState } from './paper-research-ui-controls.mjs';
import { clickAppShortcut } from './sidebar-controls.mjs';
import { setPaperAppearance, backToLibrary } from './paper-pdf-flow.mjs';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '../..'), live = process.env.PERO_SOURCE_STUDY_LIVE === '1';
const out = resolve(root, `test-results/paper-source-study/${live ? 'live-network' : 'fixture'}`);
await mkdir(out, { recursive: true });
const profile = await realpath(await mkdtemp(resolve(tmpdir(), 'pero-source-study-')));
const settings = resolve(profile, 'settings.json'), agents = resolve(profile, 'agents.json');
await writeFile(settings, '{}');
await writeFile(agents, JSON.stringify(['pero', 'codex', 'claude', 'copilot', 'grok', 'qoder', 'opencode'].map(id => ({ id, name: id, command: resolve(profile, `unavailable-${id}`) }))));
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(profile, 'desktop'), PERO_SETTINGS_PATH: settings,
  PERO_HISTORY_PATH: resolve(profile, 'history.jsonl'), PERO_AGENTS_FILE: agents, PERO_LOCALE: 'en', PERO_BUILTIN_APPS: 'paper-agent', PERO_REQUIRED_APPS: 'paper-agent', PERO_APP_INFRA_EMBED: '0' };
delete env.ELECTRON_RUN_AS_NODE; delete env.PERO_APPS_ROOT;
const seed = live ? 'https://arxiv.org/src/2610.24806v1' : 'https://research.example.org/source-study';
const checks = [], errors = [], receipts = [], acquisitionConflicts = [];
let app, page, frame, savedSourceReport;
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
const sources = () => frame.getByRole('region', { name: 'Paper source files', exact: true });
const row = title => sources().locator('li').filter({ has: frame.getByRole('heading', { name: title, exact: true }) });
const sourceStatus = (bundle, resource) => api('/api/research/source', { operation: 'status', bundleId: bundle.id, resourceId: resource.id });
const requests = async () => (await readFile(resolve(profile, 'desktop/app-data/paper-agent/source-fixture-requests.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
try {
  app = await launch(); await ready();
  if (!live) {
    const installed = resolve(profile, 'desktop/apps/paper-agent/backend');
    await writeFile(resolve(installed, 'source_fixture.py'), await readFile(resolve(root, 'tests/fixtures/research-source.py')));
    const entry = resolve(installed, 'server.py'), text = await readFile(entry, 'utf8');
    const marker = '    store = ResearchStore(os.environ["PERO_APP_DATA"], open_embedder())'; expect(text).toContain(marker);
    await writeFile(entry, text.replace(marker, `${marker}\n    from source_fixture import install\n    install(store)`));
  }
  await openPaper(); let draft = await inspect();
  const candidates = draft.resources.filter(resource => resource.kind === 'source_archive');
  expect(candidates.length).toBe(live ? 1 : 3);
  const source = live ? candidates[0] : candidates.find(resource => resource.originalUrl.endsWith('/2610.00001v1'));
  await expect(frame.getByRole('checkbox', { name: /^Get source for read-only inspection/ }).first()).not.toBeChecked();
  await frame.getByRole('button', { name: 'Save references only', exact: true }).click();
  await expect(frame.getByText('Saved references', { exact: true })).toBeVisible();
  let bundle = (await api('/api/library')).bundles[0]; expect(bundle.sourceDownloadIds).toEqual([]);
  if (!live) expect((await requests()).filter(item => item.kind !== 'metadata')).toEqual([]);
  draft = await inspect();
  await frame.getByRole('region', { name: 'Review resources' }).locator('.pa-resource-list>li').filter({ hasText: source.title }).getByRole('checkbox', { name: /^Get source for read-only inspection/ }).check();
  await expect(frame.getByRole('button', { name: 'Save and download', exact: true })).toBeDisabled();
  await frame.getByRole('checkbox', { name: /^I confirm downloading only/ }).check();
  await frame.getByRole('button', { name: 'Save and download', exact: true }).dblclick();
  await expect(sources()).toBeVisible(); bundle = (await api('/api/library')).bundles[0];
  if (!live) {
    await expect(row(source.title)).toContainText('Source acquisition failed', { timeout: 15000 });
    expect((await sourceStatus(bundle, source)).receipt).toBeNull();
    await row(source.title).getByRole('button', { name: 'Retry source download', exact: true }).dblclick();
  }
  await expect(row(source.title)).toContainText('Source files available', { timeout: 60000 });
  const acquired = await sourceStatus(bundle, source); receipts.push(acquired.receipt);
  expect(acquired.localAvailable).toBe(true); expect(bundle.pdfDownloadIds).toEqual([]);
  if (live) {
    await row(source.title).getByText('Source archive provenance', { exact: true }).click();
    await sources().screenshot({ path: resolve(out, 'live-source-receipt.png') });
  }
  await row(source.title).getByRole('button', { name: 'Browse source files', exact: true }).click();
  const catalog = await api('/api/research/source-read', { operation: 'list', bundleId: bundle.id, resourceId: source.id });
  const tex = catalog.members.find(member => member.path === 'main.tex') || catalog.members.find(member => member.path.endsWith('.tex'));
  expect(tex).toBeTruthy();
  if (!live) expect((await api('/api/research/source-report', { operation: 'observations', bundleId: bundle.id })).observations).toEqual([]);
  await row(source.title).getByRole('button', { name: tex.path, exact: true }).click();
  await expect(frame.getByLabel(`Original source: ${tex.path}`, { exact: true })).toBeVisible();
  await expect(row(source.title).getByRole('region', { name: 'Source and PDF comparison', exact: true })).toContainText('No PDF approved in this bundle');
  if (!live) {
    expect((await requests()).filter(item => item.kind === 'pdf')).toEqual([]);
    await page.screenshot({ path: resolve(out, 'source-lines-light.png') });
    await row(source.title).getByRole('button', { name: 'figure.png', exact: true }).click();
    const image = frame.getByRole('img', { name: 'Source image figure.png', exact: true });
    await expect(image).toBeVisible(); expect(await image.evaluate(element => element.naturalWidth)).toBe(1);
    await setPaperAppearance(page, 'dark'); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 800));
    await expect.poll(() => frame.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: resolve(out, 'source-image-dark-narrow.png') });
    const reports = row(source.title).getByRole('region', { name: 'Source evidence reports', exact: true });
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
  }
  checks.push('Explicit source-only consent, failure retry, original source lines and raster preview; no PDF/code/model download or TeX execution');
  await app.close(); app = await launch(); await ready(); await openPaper();
  await frame.getByRole('region', { name: 'Research bundles', exact: true }).getByRole('button', { name: bundle.title, exact: true }).click();
  expect((await sourceStatus(bundle, source)).receipt).toEqual(acquired.receipt);
  await api('/api/research/source', { operation: 'start', bundleId: bundle.id, resourceId: source.id });
  if (!live) expect((await requests()).filter(item => item.url === source.originalUrl)).toHaveLength(2);
  checks.push('Actual Desktop/backend restart and repeated start reuse the same archive receipt without reacquisition');
  if (!live) {
    await row(source.title).getByRole('button', { name: 'Browse source files', exact: true }).click();
    const reports = row(source.title).getByRole('region', { name: 'Source evidence reports', exact: true });
    await reports.getByRole('button', { name: 'Authored source evidence', exact: true }).click();
    await expect(reports.getByRole('article', { name: 'Saved source evidence report', exact: true })).toBeVisible();
    const reopened = await api('/api/research/source-report', { operation: 'read', bundleId: bundle.id, reportId: savedSourceReport.id });
    expect(reopened).toEqual(savedSourceReport);
    await reports.getByRole('article', { name: 'Saved source evidence report', exact: true }).getByRole('listitem').filter({ hasText: tex.path }).first().getByRole('button', { name: 'Open original evidence', exact: true }).click();
    await expect(frame.getByLabel(`Original source: ${tex.path}`, { exact: true })).toBeVisible();
    expect(await api('/api/research/source-report', { operation: 'read', bundleId: bundle.id, reportId: savedSourceReport.id })).toEqual(savedSourceReport);
    const originalPath = resolve(profile, 'desktop/app-data/paper-agent/research-v1/source-files', acquired.receipt.archiveDigest + '.bin');
    const originalBytes = await readFile(originalPath);
    await rm(originalPath);
    await sources().getByRole('button', { name: 'Refresh source status', exact: true }).click();
    await expect(row(source.title)).toContainText('Source files or previews unavailable');
    await reports.getByRole('button', { name: 'Authored source evidence', exact: true }).click();
    await expect(reports.getByText('Original currently unavailable. Restore its exact version before rereading.', { exact: true })).toHaveCount(2);
    await expect(reports.getByRole('button', { name: 'Open original evidence', exact: true })).toHaveCount(0);
    await writeFile(originalPath, originalBytes); // Restore only the self-authored fixture bytes.
    await sources().getByRole('button', { name: 'Refresh source status', exact: true }).click();
    await expect(row(source.title)).toContainText('Source files available');
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
    await expect(row(single.title)).toContainText('Source acquisition cancelled', { timeout: 10000 });
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
    await expect(row(single.title)).toContainText('Source files available', { timeout: 15000 });
    const gzipSource = await sourceStatus(bundle, single);
    expect(gzipSource.receipt.texCount).toBe(1);
    const pdfSources = frame.getByRole('region', { name: 'PDF reading sources', exact: true });
    await expect(pdfSources).toContainText('PDF downloaded; text extraction available', { timeout: 15000 });
    const acquisitionRequests = (await requests()).filter(item => item.kind !== 'metadata');
    expect(acquisitionRequests.filter(item => item.url === single.originalUrl)).toHaveLength(2);
    expect(acquisitionRequests.filter(item => item.kind === 'pdf')).toHaveLength(1);
    expect(acquisitionRequests.findLastIndex(item => item.url === single.originalUrl)).toBeLessThan(acquisitionRequests.findIndex(item => item.kind === 'pdf'));
    expect(acquisitionConflicts).toEqual([]);
    checks.push('One explicit review selects source plus first PDF: cancelled source retries to gzip before PDF acquisition, with no shared-worker 409');
    await row(source.title).getByRole('button', { name: 'Browse source files', exact: true }).click();
    const compare = row(source.title).getByRole('region', { name: 'Source and PDF comparison', exact: true });
    await compare.getByRole('combobox', { name: 'PDF for comparison', exact: true }).selectOption(pdf.id);
    await compare.getByRole('button', { name: 'Compare source and PDF', exact: true }).click();
    await expect(compare).toContainText('Evidence-backed caption matches');
    await compare.getByRole('button', { name: 'Open matched PDF page 1', exact: true }).first().click();
    const viewer = frame.getByRole('region', { name: 'PDF reader', exact: true });
    await expect(viewer.locator('[data-page-number="1"] img,[data-page-number="1"] canvas').first()).toBeVisible({ timeout: 30000 });
    await expect(frame.locator('.pa-reading-bar').getByRole('spinbutton', { name: 'Page', exact: true })).toHaveValue('1');
    await page.screenshot({ path: resolve(out, 'source-caption-pdf-page.png') });
    checks.push('Separately approved PDF literal caption comparison resolves source lines and opens the matching version/page');
    await backToLibrary(frame); await inspect();
    await frame.getByRole('region', { name: 'Review resources' }).locator('.pa-resource-list>li').filter({ hasText: pdfOnly.title }).getByRole('checkbox', { name: /^Get source for read-only inspection/ }).check();
    await frame.getByRole('checkbox', { name: /^I confirm downloading only/ }).check();
    await frame.getByRole('button', { name: 'Save and download', exact: true }).click();
    await expect(row(pdfOnly.title)).toContainText('Provider returned PDF only; no TeX source', { timeout: 15000 });
    checks.push('Cancellation interrupts source acquisition; explicit retry accepts gzip single TeX; PDF-only response never claims TeX');
  }
  expect(errors).toEqual([]); expect(acquisitionConflicts).toEqual([]);
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ checks, errors, receipts, acquisitionConflicts, network: live ? 'real arXiv product path' : 'synthetic transport', agent: 'none', compilation: 'none', sourceBytesExported: false }, null, 2));
} catch (error) {
  if (page) {
    await page.screenshot({ path: resolve(out, 'failure.png'),
      ...(live ? { mask: [page.locator('iframe[title="paper-agent"]'), page.locator('canvas')] } : {}) }).catch(() => {});
    await writeFile(resolve(out, 'failure-view.json'), JSON.stringify(
      await researchUiState(page, frame).catch(() => ({ unavailable: true })), null, 2));
  }
  await writeFile(resolve(out, 'failure.json'), JSON.stringify({ error: String(error), live, outcome: 'failed attempt, not acceptance' }, null, 2));
  throw error;
} finally { if (app) await app.close(); await rm(profile, { recursive: true, force: true }); }

// Real Electron/Host/Paper/PDFium + scripted ACP. Live mode changes only external network inputs.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { openResearchImport, researchUiState } from './paper-research-ui-controls.mjs';
import { clickAppShortcut } from './sidebar-controls.mjs';
import { chatState, fillPaperChat, closePaperChat, showPaperReport } from './paper-chat-controls.mjs';
import { setPaperAppearance, backToLibrary } from './paper-pdf-flow.mjs';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '../..');
const live = process.env.PERO_PDF_STUDY_LIVE === '1';
if (process.env.PERO_PAPER_JOURNEY_AGENT) throw Error('This suite accepts scripted ACP only; no real model is authorized.');
const out = resolve(root, `test-results/paper-pdf-study/${live ? 'live-network' : 'fixture'}`);
await mkdir(out, { recursive: true });
const profile = await realpath(await mkdtemp(resolve(tmpdir(), 'pero-pdf-study-')));
const capture = resolve(profile, 'scripted-acp.jsonl'), agents = resolve(profile, 'agents.json');
await writeFile(agents, JSON.stringify([
  ...['pero', 'codex', 'claude', 'copilot', 'grok', 'qoder', 'opencode'].map(id => ({ id, name: id, command: resolve(profile, `unavailable-${id}`) })),
  { id: 'paper-fixture', name: 'Scripted PDF study', command: process.execPath, args: [resolve(root, 'tests/fixtures/paper-agent.mjs'), `--capture=${capture}`] },
]));
await writeFile(resolve(profile, 'settings.json'), JSON.stringify({ chat_agent: 'paper-fixture',
  ...(process.env.PERO_APP_PYTHON ? { app_python: { apps: { 'paper-agent': dirname(dirname(process.env.PERO_APP_PYTHON)) } } } : {}),
}));
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(profile, 'desktop'), PERO_SETTINGS_PATH: resolve(profile, 'settings.json'),
  PERO_HISTORY_PATH: resolve(profile, 'history.jsonl'), PERO_AGENTS_FILE: agents, PERO_LOCALE: 'en',
  PERO_BUILTIN_APPS: 'paper-agent', PERO_REQUIRED_APPS: 'paper-agent', PERO_APP_INFRA_EMBED: '0' };
delete env.ELECTRON_RUN_AS_NODE; delete env.PERO_APPS_ROOT;
const seed = live ? 'https://research.google/blog/grounding-ai-agents-in-biological-reality-building-blocks-for-autonomous-wet-labs/' : 'https://research.example.org/pdf-study';
const selectedUrl = live ? 'https://www.gstatic.com/science-ai/verid_semantic_lab.pdf' : 'https://pdf.example.org/first.pdf';
const checks = [], errors = [], receipts = [];
let app, page, frame;
const launch = () => electron.launch({ args: [resolve(root, 'desktop')], cwd: root, env });
async function ready() {
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await expect.poll(() => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).apps?.some(app => app.name === 'paper-agent') ?? false)).toBe(true);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
}
async function openPaper() {
  await page.evaluate(path => window.pero.sessionCommand({ action: 'workspace', path }), profile);
  await expect.poll(() => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).workspace)).toBe(profile);
  await page.waitForFunction(() => { const c = document.querySelector('canvas'); return c?.width === Math.round(innerWidth * devicePixelRatio) && c.height === Math.round(innerHeight * devicePixelRatio); });
  await clickAppShortcut(page, 'paper-agent');
  await expect.poll(() => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).activeApp?.name)).toBe('paper-agent');
  frame = page.frameLocator('iframe[title="paper-agent"]');
  await expect(frame.getByRole('button', { name: 'Add papers', exact: true })).toBeVisible({ timeout: 30000 });
}
async function api(path, body) {
  return frame.locator('body').evaluate(async (_element, { path, body }) => {
    const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value = await response.json(); if (!response.ok) throw Error(value.detail || JSON.stringify(value)); return value;
  }, { path, body });
}
async function inspect() {
  await openResearchImport(page, frame);
  await frame.getByRole('textbox', { name: 'Research URL', exact: true }).fill(seed);
  await frame.getByRole('textbox', { name: 'Research URL', exact: true }).press('Enter');
  await expect(frame.getByRole('region', { name: 'Review resources' })).toBeVisible({ timeout: 65000 });
  return (await api('/api/research/drafts')).drafts.find(draft => draft.seedUrl === seed);
}
const sources = () => frame.locator('.pa-research-bundle').getByRole('region', { name: 'PDF', exact: true });
const status = (bundle, resource) => api('/api/research/pdf', { operation: 'status', bundleId: bundle.id, resourceId: resource.id });
const pdfRow = title => sources().locator(':scope > ul > li').filter({ has: frame.locator('.pa-source-provenance').getByText(title, { exact: true }) });
async function fixtureRequests() {
  return (await readFile(resolve(profile, 'desktop/app-data/paper-agent/pdf-fixture-requests.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
}
try {
  app = await launch(); await ready();
  if (!live) {
    const installed = resolve(profile, 'desktop/apps/paper-agent/backend');
    await writeFile(resolve(installed, 'pdf_fixture.py'), await readFile(resolve(root, 'tests/fixtures/research-pdf.py')));
    const entry = resolve(installed, 'server.py'), text = await readFile(entry, 'utf8');
    const marker = '    store = ResearchStore(os.environ["PERO_APP_DATA"], open_embedder())';
    expect(text).toContain(marker);
    await writeFile(entry, text.replace(marker, `${marker}\n    from pdf_fixture import install\n    install(store)`));
  }
  await openPaper();
  let draft = await inspect();
  const candidates = draft.resources.filter(resource => resource.kind === 'pdf_candidate');
  expect(candidates).toHaveLength(3);
  const resource = candidates.find(item => item.originalUrl === selectedUrl); expect(resource).toBeTruthy();
  expect(resource.confidence).toBe('unresolved'); expect(resource.paperId).toBeNull();
  await expect(frame.getByRole('checkbox', { name: /^Download PDF/ }).first()).not.toBeChecked();
  if (!live) await page.screenshot({ path: resolve(out, 'candidate-review-light.png') });
  await frame.getByRole('button', { name: 'Save references only', exact: true }).click();
  await expect(frame.locator('.pa-research-bundle').getByRole('heading', { level: 1, name: draft.title, exact: true })).toBeVisible();
  let bundle = (await api('/api/library')).bundles[0];
  expect(bundle.pdfDownloadIds).toEqual([]); expect(bundle.downloadIds).toEqual([]);
  if (!live) expect((await fixtureRequests()).filter(item => item.kind === 'pdf')).toEqual([]);
  checks.push('Three unresolved PDF candidates; references-only has no PDF/model/dataset acquisition');
  draft = await inspect();
  const review = frame.getByRole('region', { name: 'Review resources' });
  await review.locator('.pa-resource-list>li').filter({ hasText: resource.title }).getByRole('checkbox', { name: /^Download PDF/ }).check();
  await expect(frame.getByRole('button', { name: 'Save and download', exact: true })).toBeDisabled();
  await review.getByRole('checkbox', { name: /^I confirm/ }).check();
  await frame.getByRole('button', { name: 'Save and download', exact: true }).dblclick();
  await expect(sources()).toBeVisible();
  bundle = (await api('/api/library')).bundles[0]; expect(bundle.pdfDownloadIds).toEqual([resource.id]);
  await expect.poll(async () => (await status(bundle, resource)).status, { timeout: 60000 }).toBe('completed');
  const acquired = await status(bundle, resource); receipts.push(acquired);
  expect(acquired.receipt.requestUrl).toBe(selectedUrl); expect(acquired.receipt.sourcePageUrl).toBe(seed);
  expect(acquired.receipt.fileDigest).toMatch(/^[a-f0-9]{64}$/); expect(acquired.receipt.explicitVersion).toBe(`sha256:${acquired.receipt.fileDigest}`);
  expect(acquired.readPages).toEqual([]); expect(acquired.receipt.workIdentity).toBeNull();
  if (!live) expect((await fixtureRequests()).filter(item => item.kind === 'pdf').map(item => item.url)).toEqual([selectedUrl]);
  await pdfRow(resource.title).getByText('PDF source and version', { exact: true }).click();
  await expect(pdfRow(resource.title).getByText('No pages read by a study yet.', { exact: true })).toBeVisible();
  if (live) {
    await sources().screenshot({ path: resolve(out, 'live-source-receipt.png') }); // Provenance only, no PDF page or full text.
  }
  await pdfRow(resource.title).getByRole('button', { name: 'Open saved PDF', exact: true }).click();
  const viewer = frame.getByRole('region', { name: 'PDF reader', exact: true });
  await expect(viewer.locator('[data-page-number="1"] img,[data-page-number="1"] canvas').first()).toBeVisible({ timeout: 30000 });
  const reading = await api(`/api/pdf?paperId=${acquired.receipt.paperId}`);
  expect(reading.document.id).toBe(acquired.receipt.documentId); expect(reading.document.fileDigest).toBe(acquired.receipt.fileDigest);
  checks.push('Only explicitly selected PDF acquired via Host/Paper, immutable receipt and real PDFium reader; download is not study');
  if (!live) await page.screenshot({ path: resolve(out, 'saved-pdf-light.png') });
  await frame.locator('.pa-reading-bar').getByRole('button', { name: 'Ask AI', exact: true }).click();
  await fillPaperChat(page, 'Read the saved PDF original page and cite its evidence. This is a scripted transport verification, not a scientific finding.');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await api('/api/library')).reports.length, { timeout: 45000 }).toBe(1);
  await expect.poll(async () => { const state = await chatState(page); return state.chats[state.activeChat].state; }).toBe('idle');
  const reportId = (await api('/api/library')).reports[0].id;
  const report = await api(`/api/reports/${reportId}`), study = await api(`/api/studies/${report.intentId}`);
  expect(study.steps.some(step => step.action === 'read')).toBe(true); expect(study.steps.at(-1).action).toBe('finalize');
  const observed = await status(bundle, resource); expect(observed.readPages).toContain(1);
  // Search and read steps can consult multiple pages. Match the persisted
  // passage ledger for this exact document, never infer full-page reading.
  const consultedPages = [...new Set(study.steps.flatMap(step => step.passages)
    .filter(passage => passage.documentId === acquired.receipt.documentId)
    .map(passage => passage.page))].sort((a, b) => a - b);
  expect(observed.readPages).toEqual(consultedPages);
  receipts.push({ ...observed, reportId, studyId: study.id, actions: study.steps.map(step => step.action) });
  const trace = (await readFile(capture + '.mcp.jsonl', 'utf8')).trim().split('\n').map(JSON.parse);
  expect(trace[0].synthetic).toBe(true); expect(trace[0].tools).toContain('app_write');
  const turn = await showPaperReport(frame, page, report.intentId);
  await turn.locator('.pa-inline-citation').first().click();
  await expect(viewer.locator('[data-citation-region="true"]').first()).toBeVisible();
  await expect(frame.locator('.pa-reader-tools').getByRole('spinbutton', { name: 'Page', exact: true })).toHaveValue('1');
  if (!live) await page.screenshot({ path: resolve(out, 'study-citation.png') });
  checks.push('Scripted ACP uses actual Host MCP prepare/read/search/note/finalize; saved citation reveals the same PDF version/page');
  await closePaperChat(page, frame); await setPaperAppearance(page, 'dark');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 800));
  await expect(viewer).toBeVisible();
  await expect.poll(() => frame.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  if (!live) await page.screenshot({ path: resolve(out, 'study-dark-narrow.png') });
  await backToLibrary(frame);
  await app.close(); app = await launch(); await ready(); await openPaper();
  await frame.getByRole('navigation', { name: 'Papers', exact: true }).getByRole('button', { name: bundle.title, exact: true }).click();
  const reopened = await status(bundle, resource);
  expect(reopened.receipt).toEqual(acquired.receipt);
  expect(reopened.readPages).toEqual(consultedPages);
  await pdfRow(resource.title).getByText('PDF source and version', { exact: true }).click();
  await expect(pdfRow(resource.title).getByText(`Study consulted pages ${consultedPages.join(', ')}; this does not mean every page was read in full.`, { exact: true })).toBeVisible();
  await api('/api/research/pdf', { operation: 'start', bundleId: bundle.id, resourceId: resource.id });
  if (!live) expect((await fixtureRequests()).filter(item => item.kind === 'pdf')).toHaveLength(1);
  checks.push('Actual Desktop/backend restart preserves source/version/read pages and repeated start reuses existing bytes');
  if (!live) {
    // Only delete the known synthetic file inside this disposable profile.
    const savedBytes = resolve(profile, 'desktop/app-data/paper-agent/research-v1/pdf-files', `${acquired.receipt.fileDigest}.pdf`);
    expect(createHash('sha256').update(await readFile(savedBytes)).digest('hex')).toBe(acquired.receipt.fileDigest);
    await rm(savedBytes);
    await pdfRow(resource.title).getByRole('button', { name: 'Refresh PDF status', exact: true }).click();
    await expect(pdfRow(resource.title)).toContainText('Original PDF unavailable');
    await expect(pdfRow(resource.title).getByRole('button', { name: 'Open saved PDF', exact: true })).toBeDisabled();
    const unavailable = await status(bundle, resource);
    expect(unavailable.status).toBe('unavailable'); expect(unavailable.localAvailable).toBe(false);
    expect(unavailable.receipt).toEqual(acquired.receipt);
    expect((await fixtureRequests()).filter(item => item.kind === 'pdf')).toHaveLength(1);
    await pdfRow(resource.title).getByRole('button', { name: 'Restore PDF', exact: true }).click();
    await expect(pdfRow(resource.title).getByRole('button', { name: 'Open saved PDF', exact: true })).toBeEnabled({ timeout: 15000 });
    const restored = await status(bundle, resource);
    expect(restored.status).toBe('completed'); expect(restored.localAvailable).toBe(true);
    expect(restored.receipt).toEqual(acquired.receipt); expect(restored.restoredAt).toBeTruthy();
    expect(restored.restoreFinalUrl).toBe(selectedUrl);
    expect(createHash('sha256').update(await readFile(savedBytes)).digest('hex')).toBe(acquired.receipt.fileDigest);
    expect((await fixtureRequests()).filter(item => item.kind === 'pdf').map(item => item.url)).toEqual([selectedUrl, selectedUrl]);
    checks.push('Missing synthetic PDF is unavailable; only explicit restore reacquires the exact original SHA without changing its receipt');
    await inspect();
    for (const candidate of candidates.slice(1)) await frame.getByRole('region', { name: 'Review resources' }).locator('.pa-resource-list>li').filter({ hasText: candidate.title }).getByRole('checkbox', { name: /^Download PDF/ }).check();
    await frame.getByRole('checkbox', { name: /^I confirm/ }).check();
    await frame.getByRole('button', { name: 'Save and download', exact: true }).click();
    bundle = (await api('/api/library')).bundles[0];
    const retry = candidates.find(item => item.originalUrl.endsWith('/retry.pdf')), cancel = candidates.find(item => item.originalUrl.endsWith('/cancel.pdf'));
    await expect(pdfRow(retry.title)).toContainText('Download failed', { timeout: 15000 });
    expect((await status(bundle, retry)).receipt).toBeNull();
    await pdfRow(retry.title).getByRole('button', { name: 'Retry PDF download', exact: true }).dblclick();
    await expect(pdfRow(retry.title).locator('.pa-bundle-resource-row > .pa-bundle-status[role="status"]')).toHaveText('Downloaded', { timeout: 15000 });
    expect((await status(bundle, retry)).receipt.textPages).toBeGreaterThan(0);
    await pdfRow(cancel.title).getByRole('button', { name: 'Start PDF download', exact: true }).click();
    await expect.poll(async () => (await fixtureRequests()).filter(item => item.url.endsWith('/cancel.pdf')).length).toBe(1);
    await pdfRow(cancel.title).getByRole('button', { name: 'Cancel PDF download', exact: true }).click();
    await expect(pdfRow(cancel.title)).toContainText('Download cancelled', { timeout: 10000 });
    expect((await status(bundle, cancel)).receipt).toBeNull();
    await pdfRow(cancel.title).getByRole('button', { name: 'Retry PDF download', exact: true }).click();
    await expect(pdfRow(cancel.title).locator('.pa-bundle-resource-row > .pa-bundle-status[role="status"]')).toHaveText('Downloaded', { timeout: 15000 });
    expect((await status(bundle, cancel)).receipt.textPages).toBeGreaterThan(0);
    await page.screenshot({ path: resolve(out, 'retry-cancel-recovered.png') });
    checks.push('HTML response fails without publication; explicit retry, duplicate clicks, active cancellation and explicit recovery work through real UI');
  }
  expect(errors).toEqual([]);
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ checks, errors, receipts, network: live ? 'real public Google HTTPS through product path' : 'synthetic transport only', agent: 'scripted ACP; no real LLM', sourceBytesExported: false }, null, 2));
  console.log(JSON.stringify({ checks, network: live ? 'live' : 'fixture' }, null, 2));
} catch (error) {
  // Never publish a real source page/full text via failure artifacts.
  if (page) {
    await page.screenshot({ path: resolve(out, 'failure.png'),
      ...(live ? { mask: [page.locator('iframe[title="paper-agent"]'), page.locator('canvas')] } : {}) }).catch(() => {});
    await writeFile(resolve(out, 'failure-view.json'), JSON.stringify(
      await researchUiState(page, frame).catch(() => ({ unavailable: true })), null, 2));
  }
  await writeFile(resolve(out, 'failure.json'), JSON.stringify({ error: String(error), live, scope: 'Attempt failed; not acceptance. No original PDF or extracted full text included.' }, null, 2));
  throw error;
} finally { if (app) await app.close(); await rm(profile, { recursive: true, force: true }); }

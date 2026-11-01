// Real Electron -> Host App proxy -> Paper HTTP/parser/store. Only metadata fetch is synthetic.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { clickAppShortcut, setAppearance } from './sidebar-controls.mjs';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '../..'), out = resolve(root, 'test-results/research-import-host');
await mkdir(out, { recursive: true });
const profile = await realpath(await mkdtemp(resolve(tmpdir(), 'pero-research-host-')));
const settings = resolve(profile, 'settings.json'), agents = resolve(profile, 'agents.json');
await writeFile(settings, '{}');
await writeFile(agents, JSON.stringify(['pero', 'codex', 'claude', 'copilot', 'grok', 'qoder', 'opencode'].map(id => ({ id, name: id, command: resolve(profile, `unavailable-${id}`) }))));
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(profile, 'desktop'), PERO_LOCALE: 'en', PERO_SETTINGS_PATH: settings,
  PERO_HISTORY_PATH: resolve(profile, 'sessions.jsonl'), PERO_AGENTS_FILE: agents, PERO_BUILTIN_APPS: 'paper-agent', PERO_REQUIRED_APPS: 'paper-agent', PERO_APP_INFRA_EMBED: '0' };
delete env.ELECTRON_RUN_AS_NODE; delete env.PERO_APPS_ROOT;
const launch = () => electron.launch({ args: [resolve(root, 'desktop')], cwd: root, env });
const seed = 'https://research.example.org/forecasting', errors = [], checks = [], assetRequests = [], payloads = {};
let app, page;
function observe(current) {
  current.on('pageerror', error => errors.push(error.message));
  current.on('request', request => { if (request.url().includes('/host/research-assets')) assetRequests.push(request.postData()); });
  current.on('response', response => {
    const extension = /^pero-app:\/\/paper-agent\/dist\/index\.(js|css)$/.exec(response.url())?.[1];
    if (extension) void response.body().then(body => { payloads[extension] = createHash('sha256').update(body).digest('hex'); }).catch(error => errors.push(error.message));
  });
}
async function ready() {
  page = await app.firstWindow(); observe(page);
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await expect.poll(() => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).apps?.some(item => item.name === 'paper-agent') ?? false)).toBe(true);
}
async function openPaper() {
  await page.evaluate(path => window.pero.sessionCommand({ action: 'workspace', path }), profile);
  await expect.poll(() => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).workspace)).toBe(profile);
  await page.waitForFunction(() => { const canvas = document.querySelector('canvas'); return canvas?.width === Math.round(innerWidth * devicePixelRatio) && canvas.height === Math.round(innerHeight * devicePixelRatio); });
  await clickAppShortcut(page, 'paper-agent');
  await expect.poll(() => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).activeApp?.name)).toBe('paper-agent');
  const frame = page.frameLocator('iframe[title="paper-agent"]');
  await expect(frame.getByRole('button', { name: 'Add papers', exact: true })).toBeVisible({ timeout: 30000 });
  return frame;
}
const library = frame => frame.locator('body').evaluate(async () => { const response = await fetch('/api/library'); if (!response.ok) throw Error(await response.text()); return response.json(); });
const openImport = async frame => { await frame.getByRole('button', { name: 'Add papers', exact: true }).click(); await frame.getByRole('tab', { name: 'Research URL', exact: true }).click(); };
try {
  app = await launch(); await ready();
  // Patch the disposable installed package before any Paper backend is opened.
  // The production Host, authenticated App API, parser, domain and persistence stay real.
  const installed = resolve(profile, 'desktop/apps/paper-agent/backend');
  await writeFile(resolve(installed, 'research_fixture.py'), await readFile(resolve(root, 'tests/fixtures/research-resources.py')));
  const entry = resolve(installed, 'server.py'), original = await readFile(entry, 'utf8');
  const marker = '    store = ResearchStore(os.environ["PERO_APP_DATA"], open_embedder())';
  expect(original).toContain(marker);
  await writeFile(entry, original.replace(marker, `${marker}\n    from paper_agent.resource_inspection import ResourceInspector\n    from research_fixture import fetch\n    store.imports.inspector = ResourceInspector(fetch)`));
  let frame = await openPaper(); await openImport(frame);
  await frame.getByRole('textbox', { name: 'Research URL', exact: true }).fill(seed);
  await frame.getByRole('button', { name: 'Inspect link', exact: true }).click();
  let review = frame.getByRole('region', { name: 'Review resources' });
  await expect(review).toBeVisible({ timeout: 15000 });
  await expect(review.locator('.pa-resource-title input')).toHaveCount(5);
  await expect(review).toContainText('Article'); await expect(review).toContainText('Model'); await expect(review).toContainText('Benchmark');
  await expect(review.getByRole('checkbox', { name: /^Download weights.safetensors/ })).not.toBeChecked();
  const draftReply = await frame.locator('body').evaluate(async () => (await (await fetch('/api/research/drafts')).json()));
  const draft = draftReply.drafts.find(value => value.seedUrl === seed);
  expect(draft.id).toMatch(/^[a-f0-9]{64}$/); expect(draft.status).toBe('ready');
  expect(draft.resources.map(resource => resource.kind).sort()).toEqual(['benchmark', 'code', 'model', 'paper', 'web_article']);
  expect(draft.resources.find(resource => resource.kind === 'paper').title).toBe('Earlier foundational paper');
  await page.screenshot({ path: resolve(out, 'host-review-light.png') });
  await setAppearance(page, 'dark');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 800));
  await expect.poll(() => frame.locator('html').evaluate(element => element.style.colorScheme)).toBe('dark');
  await expect.poll(() => frame.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await expect.poll(() => frame.locator('.pa-library-screen').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: resolve(out, 'host-review-dark-narrow.png') });
  await setAppearance(page, 'light');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  // Resume the persisted ready draft through the UI after a real process restart.
  await app.close(); app = await launch(); await ready(); frame = await openPaper(); await openImport(frame);
  await frame.getByText(/^Resume an inspection/).click();
  await frame.getByRole('button', { name: seed, exact: true }).click();
  review = frame.getByRole('region', { name: 'Review resources' });
  await expect(review).toBeVisible();
  checks.push('Ready inspection survives an actual Desktop/backend restart and resumes through the saved review UI');
  await frame.getByRole('button', { name: 'Save references only', exact: true }).click();
  await expect(frame.getByText('Saved references', { exact: true })).toBeVisible();
  const saved = await library(frame); expect(saved.bundles).toHaveLength(1); expect(saved.papers).toHaveLength(2);
  const bundle = saved.bundles[0]; expect(bundle.downloadIds).toEqual([]); expect(bundle.resources).toHaveLength(5);
  const article = saved.papers.find(paper => paper.resourceKind === 'web_article');
  expect(article.title).toBe('Synthetic forecasting release'); expect(article.contentKind).toBe('report');
  expect(article.limitation).toContain('Bounded external source excerpt');
  for (const resource of bundle.resources.filter(resource => ['paper', 'web_article'].includes(resource.kind))) expect(saved.papers.some(paper => paper.id === resource.paperId)).toBe(true);
  await frame.locator('.pa-resource-list>li').filter({ has: frame.getByRole('heading', { name: 'Synthetic forecasting release', exact: true }) }).getByRole('button', { name: 'Read saved source', exact: true }).click();
  await expect(frame.getByText('Article excerpt', { exact: true })).toBeVisible();
  await expect(frame.locator('.pa-source-text')).toContainText('This is a synthetic research article, not a paper.');
  await page.screenshot({ path: resolve(out, 'host-article-excerpt.png') });
  await frame.getByRole('button', { name: 'Back to library', exact: true }).click(); await openImport(frame);
  await frame.getByRole('textbox', { name: 'Research URL', exact: true }).fill(seed);
  await frame.getByRole('button', { name: 'Inspect link', exact: true }).click();
  await expect(review).toBeVisible(); await frame.getByRole('button', { name: 'Save references only', exact: true }).click();
  await expect(frame.getByText('Saved references', { exact: true })).toBeVisible();
  expect((await library(frame)).bundles).toEqual(saved.bundles); expect((await library(frame)).papers).toEqual(saved.papers);
  checks.push('Real Host-authenticated inspection, typed parser/API results, 64-character IDs, reference-only commit, immutable article/paper snapshots and repeat-import reuse');
  expect(assetRequests).toEqual([]);
  await app.close(); app = await launch(); await ready(); frame = await openPaper();
  await frame.getByRole('region', { name: 'Research bundles', exact: true }).getByRole('button', { name: 'Synthetic forecasting release', exact: true }).click();
  await expect(frame.getByText('Saved references', { exact: true })).toBeVisible();
  expect((await library(frame)).bundles).toEqual(saved.bundles); expect((await library(frame)).papers).toEqual(saved.papers);
  await page.screenshot({ path: resolve(out, 'host-reopened-bundle.png') });
  const fetches = (await readFile(resolve(profile, 'desktop/app-data/paper-agent/research-fixture-fetches.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  expect(fetches.length).toBeGreaterThan(2); expect(fetches.every(item => !item.url.includes('/resolve/'))).toBe(true);
  checks.push('Actual Electron/Host/Paper restart preserves bundle and snapshots; zero asset handoffs or binary URLs, no Agent invocation');
  await expect.poll(() => Object.keys(payloads).length).toBe(2);
  for (const extension of ['js', 'css']) expect(payloads[extension]).toBe(createHash('sha256').update(await readFile(resolve(root, `apps/paper-agent/dist/index.${extension}`))).digest('hex'));
  expect(errors).toEqual([]); expect(assetRequests).toEqual([]);
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ checks, errors, payloads, metadataRequests: fetches, scope: 'Real Electron + Rust Host + Paper Python HTTP/parser/store; only external metadata fetch is synthetic. No model, PDF, binary download or live-network acceptance.' }, null, 2));
  console.log(JSON.stringify({ checks, errors, payloads }, null, 2));
} catch (error) {
  if (page) { await page.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {}); await writeFile(resolve(out, 'failure-state.json'), await page.evaluate(() => window.peroDiagnostics?.snapshot() ?? '{}').catch(() => '{}')); }
  throw error;
} finally { if (app) await app.close(); await rm(profile, { recursive: true, force: true }); }

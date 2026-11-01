// Real Electron -> Host App proxy -> Paper HTTP/parser/store. External metadata,
// clone provider proposals and clone transport are explicitly synthetic seams.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { chatState, focusPaperChat } from './paper-chat-controls.mjs';
import { clickAppShortcut, setAppearance } from './sidebar-controls.mjs';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { startFixtureProvider } from '../runtime/research-import/fixture-provider.mjs';
import { prepareCloneFixture } from '../runtime/research-import/clone-fixture.mjs';

const root = resolve(import.meta.dirname, '../..'), out = resolve(root, 'test-results/research-import-host');
await mkdir(out, { recursive: true });
const profile = await realpath(await mkdtemp(resolve(tmpdir(), 'pero-research-host-')));
const settings = resolve(profile, 'settings.json'), agents = resolve(profile, 'agents.json');
const cloneFixture = process.platform === 'linux' ? await prepareCloneFixture(profile) : null;
const cloneOptions = {}, provider = cloneFixture ? await startFixtureProvider('clone', '', cloneOptions) : null;
await writeFile(settings, JSON.stringify(cloneFixture ? { chat_agent: 'clone-fixture' } : {}));
await writeFile(agents, JSON.stringify(['pero', 'codex', 'claude', 'copilot', 'grok', 'qoder', 'opencode'].map(id => ({ id, name: id, command: resolve(profile, `unavailable-${id}`) }))));
if (cloneFixture) {
  const disabled = JSON.parse(await readFile(agents, 'utf8'));
  disabled.push({ id: 'clone-fixture', name: 'Clone protocol fixture', command: resolve(root, 'target/debug/pero-agent-acp'), args: [
    '--endpoint', provider.endpoint, '--model', 'fixture', '--api-key-env', 'PERO_CLONE_FIXTURE_KEY',
    '--session-dir', resolve(profile, 'clone-sessions'), '--workspace', profile, '--enable-research-clone',
    '--shell', cloneFixture.wrapper, '--approval', 'ask', '--max-retries', '0'],
    // Explicit AgentConfig environment survives Desktop's PERO_* Host filtering.
    env: { PERO_CLONE_FIXTURE_KEY: 'local-research-fixture' } });
  await writeFile(agents, JSON.stringify(disabled));
}
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(profile, 'desktop'), PERO_LOCALE: 'en', PERO_SETTINGS_PATH: settings,
  PERO_HISTORY_PATH: resolve(profile, 'sessions.jsonl'), PERO_AGENTS_FILE: agents, PERO_BUILTIN_APPS: 'paper-agent', PERO_REQUIRED_APPS: 'paper-agent', PERO_APP_INFRA_EMBED: '0' };
delete env.ELECTRON_RUN_AS_NODE; delete env.PERO_APPS_ROOT;
const launch = () => electron.launch({ args: [resolve(root, 'desktop')], cwd: root, env });
const seed = 'https://research.example.org/forecasting', errors = [], checks = [], assetRequests = [], payloads = {}, consoleErrors = [], researchResponses = [];
let app, page;
function observe(current) {
  current.on('pageerror', error => errors.push(error.message));
  current.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  current.on('request', request => { if (request.url().includes('/host/research-assets')) assetRequests.push(request.postData()); });
  current.on('response', response => {
    if (response.url().includes('/api/research/')) researchResponses.push({ url: response.url(), status: response.status() });
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
  let metadataFixture = await readFile(resolve(root, 'tests/fixtures/research-resources.py'), 'utf8');
  if (cloneFixture) metadataFixture = metadataFixture.replace("'full_name': 'example/forecast', 'private': False,", "'full_name': 'example/forecast', 'private': False, 'default_branch': 'main',") + `
_original_fetch = fetch
def fetch(url, **options):
    if url == 'https://api.github.com/repos/example/forecast/commits/main':
        from paper_agent.resource_fetch import WebDocument
        return WebDocument(url, 'application/json', json.dumps({'sha': '${cloneFixture.revision}', 'html_url': '${cloneFixture.url}/commit/${cloneFixture.revision}'}))
    return _original_fetch(url, **options)
`;
  await writeFile(resolve(installed, 'research_fixture.py'), metadataFixture);
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
  // The mounted library also has an "Article excerpt" badge. Assert the
  // visible reader and its immutable snapshot, not that unrelated hidden row.
  const reader = frame.getByRole('article', { name: article.title, exact: true });
  await expect(reader).toHaveAttribute('data-paper-id', article.id);
  await expect(reader.getByText('Article excerpt', { exact: true })).toBeVisible();
  await expect(reader.locator('.pa-source-text')).toContainText('This is a synthetic research article, not a paper.');
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
  // First prove the existing Host composer handoff is unsent; Linux then separately
  // submits controlled proposals and exercises actual permission UI and native Git.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await frame.locator('body').evaluate(() => {
    window.researchCloneReplies = [];
    window.addEventListener('message', event => { if (event.source === window.parent && event.data?.type === 'pero:app:chat-result') window.researchCloneReplies.push(event.data); });
  });
  const beforeChat = await page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
  const userMessagesBefore = beforeChat.chats.flatMap(chat => chat.messages).filter(message => message.role === 'user').length;
  await frame.getByRole('button', { name: 'Clone with Agent', exact: true }).click();
  await expect(frame.getByText('Clone request prepared in Host. Nothing cloned yet.', { exact: true })).toBeVisible();
  await expect.poll(() => frame.locator('body').evaluate(() => window.researchCloneReplies.length)).toBe(1);
  const acknowledgment = await frame.locator('body').evaluate(() => window.researchCloneReplies[0]);
  expect(acknowledgment.ok).toBe(true); expect(acknowledgment.value.references).toHaveLength(1);
  await expect.poll(() => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).composer)).toContain('Prepare a repository clone from the attached saved Paper reference.');
  await expect.poll(() => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).attachments.length)).toBe(1);
  const afterChat = await page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
  expect(afterChat.chats.flatMap(chat => chat.messages).filter(message => message.role === 'user')).toHaveLength(userMessagesBefore);
  expect(afterChat.chats[afterChat.activeChat].id).toBe(acknowledgment.value.threadId);
  await expect.poll(() => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).contextPreviewBounds[0]?.bounds?.width ?? 0)).toBeGreaterThan(0);
  const bounds = await page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).contextPreviewBounds[0].bounds);
  const canvas = await page.locator('canvas').first().boundingBox();
  await page.mouse.click(canvas.x + bounds.x + bounds.width / 2, canvas.y + bounds.y + bounds.height / 2);
  const preview = page.getByRole('dialog'); await expect(preview).toBeVisible();
  const frozen = JSON.parse(await preview.locator('pre').innerText()), code = bundle.resources.find(resource => resource.kind === 'code');
  expect(frozen).toMatchObject({ schema: 'pero.app-object.v1', scope: { app: 'paper-agent', panel: 'main' }, objectId: `research-code-${code.id}`, kind: 'research-clone-request', selection: { intent: 'clone-repository', bundleId: bundle.id, resourceId: code.id }, state: { status: 'not_started', bundleId: bundle.id, seedUrl: seed, resourceId: code.id, source: { identity: code.identity, url: code.url, originalUrl: code.originalUrl, revision: code.revision, license: code.license, size: code.size, evidence: code.evidence, unresolved: code.unresolved, observedAt: code.observedAt ?? '' } } });
  await page.screenshot({ path: resolve(out, 'host-clone-frozen-request.png') });
  await preview.getByRole('button', { name: 'Close', exact: true }).click();
  expect((await library(frame)).bundles).toEqual(saved.bundles);
  checks.push('Clone with Agent receives actual Host acknowledgement and a frozen provenance attachment in the unsent composer; user-message count and saved bundle remain unchanged, no clone executed');
  if (cloneFixture) {
    expect(code.revision).toBe(cloneFixture.revision);
    cloneOptions.cloneRequest = { url: code.url, revision: code.revision, destination: 'reviewed-code', license: code.license || 'unknown', sizeBytes: code.size, bundleId: bundle.id, resourceId: code.id };
    const destination = resolve(profile, 'reviewed-code'), threadId = acknowledgment.value.threadId;
    // Desktop Workbench renders floating Chat in its root GPUI canvas (unlike
    // the separate Product Chat iframe). Match paper-chat-controls/workbench-floating.
    // Enter runs send_chat/submit_prompt and preserves frozen attachments.
    const renderCanvas = () => page.locator('canvas:not([role="textbox"])');
    const state = () => chatState(page);
    await expect(renderCanvas()).toHaveCount(1);
    const chat = async () => (await state()).chats.find(item => item.id === threadId);
    const propose = async () => {
      await expect.poll(async () => (await state()).composer).toContain('Prepare a repository clone from the attached saved Paper reference.');
      const current = await state();
      expect(current.chats[current.activeChat]).toMatchObject({ id: threadId, agent: 'clone-fixture' });
      expect(current.attachments).toHaveLength(1);
      expect(current.appChatOpen && current.floatingChat).toBe(true);
      if (current.chats[current.activeChat].error) throw Error(current.chats[current.activeChat].error);
      await focusPaperChat(page);
      await page.keyboard.press('Enter');
      await expect.poll(async () => (await state()).composer).toBe('');
    };
    const choose = async index => {
      await expect.poll(async () => {
        const current = await chat();
        if (current?.error) throw Error(current.error);
        return Boolean(current?.permission);
      }, { timeout: 20000 }).toBe(true);
      await expect.poll(async () => (await state()).permissionBounds.find(item => item.chat === threadId && item.index === index)?.bounds?.width ?? 0).toBeGreaterThan(0);
      const bounds = (await state()).permissionBounds.find(item => item.chat === threadId && item.index === index).bounds;
      const canvas = await renderCanvas().boundingBox();
      await page.mouse.click(canvas.x + bounds.x + bounds.width / 2, canvas.y + bounds.y + bounds.height / 2);
      await expect.poll(async () => (await chat()).state, { timeout: 20000 }).toBe('idle');
    };
    await propose(); await choose(1);
    expect(existsSync(destination)).toBe(false); expect(existsSync(cloneFixture.marker)).toBe(false);
    await page.screenshot({ path: resolve(out, 'host-clone-denied-no-effects.png') });
    await frame.getByRole('button', { name: 'Clone with Agent', exact: true }).click();
    await propose(); await choose(0);
    const tool = (await chat()).tools.at(-1);
    expect(tool.status).toBe('completed');
    const output = tool.output.map(item => item.content?.text || '').join('');
    const receipt = JSON.parse(output);
    expect(receipt).toMatchObject({ state: 'completed', resolvedCommit: cloneFixture.revision, origin: code.url, checkout: false });
    expect(execFileSync('git', ['-C', destination, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(code.revision);
    expect(execFileSync('git', ['-C', destination, 'config', '--get', 'remote.origin.url'], { encoding: 'utf8' }).trim()).toBe(code.url);
    expect(existsSync(resolve(destination, 'README.md'))).toBe(false);
    expect((await readFile(cloneFixture.marker, 'utf8')).trim().split('\n')).toHaveLength(1);
    const expandReceipt = async () => {
      const key = `${threadId}/${tool.id}`;
      if (!(await state()).expandedTools.includes(key)) {
        await expect.poll(async () => (await state()).toolBounds.find(item => item.chat === threadId && item.tool === tool.id)?.bounds?.width ?? 0).toBeGreaterThan(0);
        const bounds = (await state()).toolBounds.find(item => item.chat === threadId && item.tool === tool.id).bounds;
        const canvas = await renderCanvas().boundingBox();
        await page.mouse.click(canvas.x + bounds.x + 20, canvas.y + bounds.y + bounds.height / 2);
      }
      await expect.poll(async () => (await state()).expandedTools).toContain(key);
    };
    await expandReceipt();
    await page.screenshot({ path: resolve(out, 'host-clone-actual-tool-receipt.png') });
    const callsBeforeRestart = provider.requests();
    await app.close(); app = await launch(); await ready(); frame = await openPaper();
    await frame.getByRole('region', { name: 'Research bundles', exact: true }).getByRole('button', { name: 'Synthetic forecasting release', exact: true }).click();
    await frame.getByRole('button', { name: 'Clone with Agent', exact: true }).click();
    await expect.poll(async () => { const current = await state(); return current.chats[current.activeChat]?.id; }).toBe(threadId);
    await expect.poll(async () => (await chat())?.tools.find(item => item.id === tool.id)?.status).toBe('completed');
    const restored = (await chat()).tools.find(item => item.id === tool.id);
    expect(JSON.parse(restored.output.map(item => item.content?.text || '').join(''))).toEqual(receipt);
    await expandReceipt();
    expect(provider.requests()).toBe(callsBeforeRestart); expect(provider.errors).toEqual([]);
    expect((await library(frame)).bundles).toEqual(saved.bundles);
    await page.screenshot({ path: resolve(out, 'host-clone-history-reopened.png') });
    checks.push('Linux real Desktop Host permission Reject has zero Git effects; Allow runs actual Go native and Git through an owned local transport seam; actual tool receipt expands and survives restart without replay. Not a public HTTPS clone or real-model test.');
  }
  const fetches = (await readFile(resolve(profile, 'desktop/app-data/paper-agent/research-fixture-fetches.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  expect(fetches.length).toBeGreaterThan(2); expect(fetches.every(item => !item.url.includes('/resolve/'))).toBe(true);
  checks.push('Actual Electron/Host/Paper restart preserves bundle and snapshots; zero asset handoffs or binary URLs; clone protocol fixture is separately reported');
  await expect.poll(() => Object.keys(payloads).length).toBe(2);
  for (const extension of ['js', 'css']) expect(payloads[extension]).toBe(createHash('sha256').update(await readFile(resolve(root, `apps/paper-agent/dist/index.${extension}`))).digest('hex'));
  expect(errors).toEqual([]); expect(assetRequests).toEqual([]);
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ checks, errors, payloads, metadataRequests: fetches, scope: 'Real Electron + Rust Host + Paper Python HTTP/parser/store; external metadata, scripted provider and clone transport are synthetic. No real model, PDF, model/data download or public-network acceptance. Linux clone uses actual native Git with a test-only local transport wrapper.' }, null, 2));
  console.log(JSON.stringify({ checks, errors, payloads }, null, 2));
} catch (error) {
  if (page) {
    await page.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {});
    await writeFile(resolve(out, 'failure-state.json'), await page.evaluate(() => window.peroDiagnostics?.snapshot() ?? '{}').catch(() => '{}'));
    await writeFile(resolve(out, 'failure-app.json'), JSON.stringify({ consoleErrors, errors, researchResponses,
      text: await page.frameLocator('iframe[title="paper-agent"]').locator('body').innerText({ timeout: 1000 }).catch(() => 'App unavailable') }, null, 2));
  }
  throw error;
} finally { if (app) await app.close(); if (provider) await provider.close(); await rm(profile, { recursive: true, force: true }); }

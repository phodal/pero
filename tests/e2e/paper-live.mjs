// Opt-in: real public sources, real PDF and authenticated Codex through the Host.
import { electron } from './electron.mjs';
import { clickAppOpen } from './sidebar-controls.mjs';
import { expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
if (process.env.PERO_PAPER_LIVE !== '1') throw new Error('Set PERO_PAPER_LIVE=1 to use public literature services and your authenticated Codex account.');
const root = resolve(import.meta.dirname, '../..');
const resumeProfile = process.env.PERO_PAPER_LIVE_PROFILE;
const out = resolve(root, process.env.PERO_PAPER_LIVE_OUTPUT || (resumeProfile ? 'test-results/paper-live-followup' : 'test-results/paper-live-agent'));
await mkdir(out, { recursive: true });
await rm(resolve(out, 'failure.png'), { force: true });
await rm(resolve(out, 'failure.json'), { force: true });
const profile = await realpath(resumeProfile || await mkdtemp(resolve(tmpdir(), 'pero-paper-live-agent-')));
const agents = resolve(profile, 'agents.json');
await writeFile(agents, JSON.stringify([{ id: 'codex', name: 'Codex', command: process.execPath,
  args: [resolve(root, 'node_modules/@agentclientprotocol/codex-acp/dist/index.js')],
  env: { CODEX_PATH: process.env.CODEX_PATH || 'codex' } }]));
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(profile, 'desktop'),
  PERO_SETTINGS_PATH: resolve(profile, 'settings.json'), PERO_HISTORY_PATH: resolve(profile, 'history.jsonl'),
  PERO_AGENTS_FILE: agents, PERO_LOCALE: 'en' };
delete env.ELECTRON_RUN_AS_NODE; delete env.PERO_APPS_ROOT;
let app, page, frame;
const checks = [], errors = [], answers = [], starts = [];
const api = (path) => frame.locator('body').evaluate(async (_element, path) => {
  const response = await fetch(path), value = await response.json();
  if (!response.ok) throw new Error(value.detail ?? JSON.stringify(value));
  return value;
}, path);
async function open() {
  app = await electron.launch({ args: [resolve(root, 'desktop')], cwd: root, env });
  page = await app.firstWindow();
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', request => {
    if (request.url().endsWith('/host/agent') && request.postDataJSON()?.operation === 'start') starts.push(request.postDataJSON().requestId);
  });
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await page.evaluate(path => window.pero.sessionCommand({ action: 'workspace', path }), profile);
  await expect.poll(() => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).workspace)).toBe(profile);
  await page.mouse.click(80, await page.evaluate(() => innerHeight - 60));
  await expect.poll(() => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).appsLoading)).toBe(false);
  await clickAppOpen(page, 'paper-agent');
  frame = page.frameLocator('iframe[title="paper-agent"]');
  await expect(frame.locator('.pa-workbench')).toBeVisible({ timeout: 20000 });
}
async function citeReport(report) {
  const citation = report.locator('.pa-inline-citation').first();
  if (await citation.count()) await citation.click(); else await report.locator('.pa-citations button').first().click();
  await expect(frame.locator('[data-citation-region="true"]').first()).toBeVisible({ timeout: 30000 });
  const sourcePage = frame.locator('.pa-pdf-page').filter({ has: frame.locator('[data-citation-region="true"]') }).first();
  const paint = sourcePage.locator('img,canvas').first();
  await expect(paint).toBeVisible({ timeout: 30000 });
  await expect.poll(() => paint.evaluate(element => element.tagName === 'IMG' ? element.complete && element.naturalWidth > 0 : element.width > 0), { timeout: 30000 }).toBe(true);
}
async function ask(question) {
  const before = await api('/api/library'), startedAt = Date.now(), beforeStarts = starts.length;
  await frame.getByRole('textbox', { name: 'Research question', exact: true }).fill(question);
  await frame.getByRole('button', { name: 'Send question', exact: true }).click();
  let failure = '';
  await expect.poll(async () => {
    const library = await api('/api/library');
    if (library.reports.length > before.reports.length) return true;
    const alerts = await frame.getByRole('alert').allTextContents();
    if (alerts.length) { failure = alerts.join(' | '); return true; }
    return false;
  }, { timeout: 600000, intervals: [1000, 2000, 3000] }).toBe(true);
  if (failure) throw new Error(failure);
  const library = await api('/api/library');
  const summary = library.reports.find(r => !before.reports.some(p => p.id === r.id));
  const report = await api(`/api/reports/${summary.id}`), intent = await api(`/api/intents/${report.intentId}`);
  const study = await api(`/api/studies/${intent.id}`);
  expect(starts.length - beforeStarts).toBe(1);
  expect(study.steps.at(-1).action).toBe('finalize');
  expect(study.passages.length).toBeGreaterThan(0);
  expect(report.sections.some(s => s.evidence?.length)).toBe(true);
  const result = { question, elapsedMs: Date.now() - startedAt, report, intent, study };
  answers.push(result);
  await writeFile(resolve(out, `answer-${answers.length}.json`), JSON.stringify(result, null, 2));
  console.log(`Real answer ${answers.length} saved in ${result.elapsedMs} ms; ${study.steps.length} research steps`);
  await expect(frame.getByRole('textbox', { name: 'Research question', exact: true })).toBeEnabled({ timeout: 30000 });
  result.readyMs = Date.now() - startedAt;
  await writeFile(resolve(out, `answer-${answers.length}.json`), JSON.stringify(result, null, 2));
  return result;
}
try {
  await open();
  if (resumeProfile) {
    const library = await api('/api/library');
    const paper = library.papers.find(p => p.sourceId === '2610.14224');
    const previous = [...library.reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    await frame.locator('.pa-library-list .pero-list-open').filter({ has: frame.getByText(paper.title, { exact: true }) }).click();
    const nav = frame.locator('.pa-reading-bar');
    await expect(nav.getByRole('spinbutton', { name: 'Page', exact: true })).toHaveAttribute('max', '37', { timeout: 30000 });
    await expect(frame.locator('.pa-pdf-page img,.pa-pdf-page canvas').first()).toBeVisible({ timeout: 30000 });
    await nav.getByRole('button', { name: 'Ask', exact: true }).click();
    const turn = frame.locator(`[data-turn-id="${previous.intentId}"]`);
    await turn.locator('summary').first().click();
    await expect(turn.locator('.pa-report')).toBeVisible({ timeout: 30000 });
    await expect(turn.locator('.pa-citations button').first()).toContainText(/Page [0-9]+/);
    await page.screenshot({ path: resolve(out, '01-restored-real-answer.png') });
    checks.push('restart opens the previously saved real answer with page-specific source buttons');
    if (!process.env.PERO_PAPER_LIVE_RESTORE_ONLY) {
    const followup = await ask(process.env.PERO_PAPER_LIVE_QUESTION || '上一轮提到 Composer 可以 KEEP_BASE。请只解释何时保留基线，引用已有方法或提示词原文。');
    expect(followup.intent.parentIntentId).toBe(previous.intentId);
    const parent = await api(`/api/intents/${previous.intentId}`);
    expect(followup.study.passages.some(p => parent.passages.some(old => old.id === p.id))).toBe(true);
    }
    await citeReport(process.env.PERO_PAPER_LIVE_RESTORE_ONLY ? turn.locator('.pa-report') : frame.locator('.pa-turn .pa-report'));
    const citedIntent = await api(`/api/intents/${process.env.PERO_PAPER_LIVE_RESTORE_ONLY ? previous.intentId : answers.at(-1).intent.id}`);
    const citedReport = process.env.PERO_PAPER_LIVE_RESTORE_ONLY ? await api(`/api/reports/${previous.id}`) : answers.at(-1).report;
    const firstRef = citedReport.sections[0].evidence[0];
    const expectedPage = citedIntent.passages.find(p => p.id === firstRef.passageId).page;
    await expect(nav.getByRole('spinbutton', { name: 'Page', exact: true })).toHaveValue(String(expectedPage));
    await page.screenshot({ path: resolve(out, '02-followup-reused-source.png') });
    checks.push(process.env.PERO_PAPER_LIVE_RESTORE_ONLY ? 'restored real report opens a fully rendered PDF page and exact quotation highlight' : 'real follow-up reuses unchanged PDF evidence and retains exact source highlighting');
  } else {
  await frame.getByRole('button', { name: 'Add papers', exact: true }).first().click();
  await frame.getByLabel('Literature source', { exact: true }).selectOption('alphaxiv');
  await expect(frame.getByLabel('Sort', { exact: true })).toHaveValue('recency');
  await frame.getByLabel('Keywords, paper ID or URL', { exact: true }).fill('Harness^2: Recursive Agent Harnessing for an Open World');
  await frame.getByRole('button', { name: 'Search papers', exact: true }).click();
  const result = frame.locator('.pa-search-results>li').filter({ has: frame.getByRole('heading', { name: 'Harness^2: Recursive Agent Harnessing for an Open World', exact: true }) });
  await expect(result).toBeVisible({ timeout: 60000 });
  await page.screenshot({ path: resolve(out, '01-live-search.png') });
  await result.getByRole('button', { name: 'Add', exact: true }).click();
  const nav = frame.locator('.pa-reading-bar');
  await expect(nav.getByRole('spinbutton', { name: 'Page', exact: true })).toHaveAttribute('max', '37', { timeout: 90000 });
  await expect(frame.locator('.pa-pdf-page img,.pa-pdf-page canvas').first()).toBeVisible({ timeout: 30000 });
  const paper = (await api('/api/library')).papers.find(p => p.sourceId === '2610.14224');
  expect(paper).toBeTruthy();
  const reading = await api(`/api/pdf?paperId=${paper.id}`);
  await page.screenshot({ path: resolve(out, '02-real-pdf.png') });
  checks.push('live title search, add from results, complete 37-page PDF rendered');
  await nav.getByRole('button', { name: 'Ask', exact: true }).click();
  await frame.getByRole('button', { name: 'Research settings', exact: true }).click();
  await frame.getByLabel('Agent', { exact: true }).selectOption('codex');
  await frame.getByRole('button', { name: 'Research settings', exact: true }).click();
  const first = await ask('这篇论文中的 task-level recursion 和 harnessing-level recursion 分别做什么？请用中文解释两者如何连接，引用方法章节的原文；不要仅依赖摘要。');
  await citeReport(frame.locator('.pa-turn .pa-report'));
  await page.screenshot({ path: resolve(out, '03-answer-original.png') });
  checks.push('real Codex reads through App MCP, saves report and opens exact PDF quotation');
  const second = await ask('它在没有 ground-truth verifier 的情况下如何评估一次 harness 修改？哪些是论文给出的做法，哪些局限仍然存在？继续引用可回查的原文。');
  expect(second.intent.parentIntentId).toBe(first.intent.id);
  expect(second.intent.conversation.length).toBeGreaterThan(0);
  checks.push('real follow-up retains conversation, reads evidence and saves cited answer');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 800));
  await citeReport(frame.locator('.pa-turn .pa-report'));
  await expect(frame.getByRole('complementary', { name: 'Ask', exact: true })).toHaveCount(0);
  await expect(frame.locator('[data-citation-region="true"]').first()).toBeVisible();
  await page.screenshot({ path: resolve(out, '04-narrow-original.png') });
  checks.push('narrow-window citation reveals the PDF instead of leaving it behind the conversation');
  await app.close(); await open();
  await frame.locator('.pa-library-list .pero-list-open').filter({ has: frame.getByText(paper.title, { exact: true }) }).click();
  const restored = await api(`/api/pdf?paperId=${paper.id}`);
  expect(restored.document.fileDigest).toBe(reading.document.fileDigest);
  const saved = await api('/api/library');
  expect(saved.reports.some(r => r.id === first.report.id)).toBe(true);
  expect(saved.reports.some(r => r.id === second.report.id)).toBe(true);
  await frame.locator('.pa-reading-bar').getByRole('button', { name: 'Ask', exact: true }).click();
  const savedTurn = frame.locator('.pa-turn-history').filter({ hasText: first.question });
  await savedTurn.locator('summary').click();
  await expect(savedTurn.locator('.pa-report')).toBeVisible({ timeout: 30000 });
  await expect(savedTurn.locator('.pa-citations button').first()).toContainText(/Page [0-9]+/);
  await page.screenshot({ path: resolve(out, '05-restarted.png') });
  checks.push('restart preserves real PDF digest, both reports and conversation history');
  }
  expect(errors).toEqual([]);
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ realSources: true, realModel: process.env.PERO_PAPER_LIVE_RESTORE_ONLY ? 'restored-codex-report' : 'codex', profile, checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }));
} catch (error) {
  if (page) await page.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {});
  if (frame) await writeFile(resolve(out, 'failure.json'), JSON.stringify({ message: String(error), profile, checks, errors, library: await api('/api/library').catch(() => null), studies: await api('/api/studies').catch(() => null) }, null, 2));
  throw error;
} finally { if (app) await app.close(); }

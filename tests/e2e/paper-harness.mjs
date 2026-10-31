import { chatState, fillPaperChat, closePaperChat, showPaperReport } from './paper-chat-controls.mjs';
import { clickAppShortcut } from './sidebar-controls.mjs';
// Real PDF + installed Python backend + Host Agent. Fixture and real-provider modes are explicit.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { setPaperAppearance } from './paper-pdf-flow.mjs';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '../..');
const realAgent = process.env.PERO_PAPER_JOURNEY_AGENT;
const requestedModel = process.env.PERO_PAPER_JOURNEY_MODEL;
const requestedEffort = process.env.PERO_PAPER_JOURNEY_EFFORT;
if (requestedModel && realAgent !== 'codex') throw new Error('Explicit model comparison currently supports the Codex adapter only.');
if (requestedEffort && !requestedModel) throw new Error('Explicit reasoning effort requires a comparison model.');
const out = resolve(root, process.env.PERO_PAPER_JOURNEY_OUTPUT || (realAgent ? 'test-results/paper-study/real-agent' : 'test-results/paper-study/fixture'));
await mkdir(out, { recursive: true });
await rm(resolve(out,'failure.json'),{force:true}); await rm(resolve(out,'failure.png'),{force:true});
const profile = await realpath(await mkdtemp(resolve(tmpdir(), 'pero-harness-journey-')));
const pdf = await readFile(resolve(root, process.env.PERO_HARNESS_PDF || 'test-results/paper-harness/meta-harness.pdf'));
const agents = resolve(profile, 'agents.json'), capture = resolve(profile, 'turns.jsonl');
if (!realAgent) await writeFile(agents, JSON.stringify([
  ...['pero', 'codex', 'claude', 'copilot', 'grok', 'qoder', 'opencode'].map(id => ({ id, name: id, command: resolve(profile, `unavailable-${id}`) })),
  { id: 'paper-fixture', name: 'Synthetic Paper fixture', command: process.execPath, args: [resolve(root, 'tests/fixtures/paper-agent.mjs'), `--capture=${capture}`] },
]));
if (requestedModel) await writeFile(agents, JSON.stringify([{ id: 'codex', name: 'Codex comparison', command: process.execPath,
  args: [resolve(root, 'node_modules/@agentclientprotocol/codex-acp/dist/index.js')],
  env: { CODEX_PATH: process.env.CODEX_PATH || 'codex', CODEX_CONFIG: JSON.stringify({ model: requestedModel,
    ...(requestedEffort ? { model_reasoning_effort: requestedEffort } : {}) }) } }]));
const agentId = realAgent || 'paper-fixture';
await writeFile(resolve(profile, 'settings.json'), JSON.stringify({ chat_agent: agentId }));
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(profile, 'desktop'), PERO_SETTINGS_PATH: resolve(profile, 'settings.json'), PERO_HISTORY_PATH: resolve(profile, 'history.jsonl'), PERO_LOCALE: 'en' };
if (!realAgent || requestedModel) env.PERO_AGENTS_FILE = agents;
delete env.ELECTRON_RUN_AS_NODE; delete env.PERO_APPS_ROOT;
const launch = () => electron.launch({ args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), resolve(root, 'desktop')], cwd: root, env });
let app;
const errors = [], stages = [], checks = [], agentTrace = [], agentStarts = [];
let page, frame;
const api = async (path, data) => frame.locator('body').evaluate(async (_element, { path, data }) => {
  const response = await fetch(path, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.detail ?? JSON.stringify(value));
  return value;
}, { path, data });
async function openApp() {
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (!request.url().endsWith('/host/agent')) return;
    const input = request.postDataJSON();
    if (input?.operation === 'start') agentStarts.push({ requestId: input.requestId, agentId: input.agentId,
      study: input.prompt.includes('ResearchStudy:'), startedAt: Date.now() });
  });
  page.on('response', response => {
    if (response.url().endsWith('/host/agent')) void response.json().then(value => { if (value.status) agentTrace.push({status:value.status,text:value.text?.slice(0,800)}); }).catch(()=>{});
    if (/\/api\/research\/(?:plan|search|select)$/.test(response.url())) void response.json().then(value => { stages.push({ stage: value.stage, round: value.round, requestId: value.requestId, error: value.detail }); }).catch(() => {});
    if (response.url().endsWith('/api/studies') && response.request().method() === 'POST') void response.json().then(value => {
      stages.push({ stage: 'study', id: value.id, requestId: value.requestId, error: value.detail });
    }).catch(() => {});
  });
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    return canvas?.width === Math.round(innerWidth * devicePixelRatio) && canvas.height === Math.round(innerHeight * devicePixelRatio);
  });
  await page.evaluate(path => window.pero.sessionCommand({ action: 'workspace', path }), profile);
  await expect.poll(async () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).workspace)).toBe(profile);
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  await clickAppShortcut(page, 'paper-agent');
  await expect.poll(async () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).activeApp?.name)).toBe('paper-agent');
  frame = page.frameLocator('iframe[title="paper-agent"]');
  await expect(frame.locator('.pa-workbench')).toBeVisible({ timeout: 20000 });
}
const active = async () => { const state = await chatState(page); return state.chats[state.activeChat]; };
const stop = async () => {
  await expect.poll(async () => (await chatState(page)).stopButtonBounds).not.toBeNull();
  const bounds = (await chatState(page)).stopButtonBounds;
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect.poll(async () => (await active()).state).toBe('idle');
};
async function ask(question, parent) {
  const before = (await api('/api/library')).reports.map(report => report.id), startedAt = Date.now();
  const previousTools=(await active())?.tools?.length??0;
  if (parent) {
    const turn = await showPaperReport(frame, page, parent.intent.id);
    await turn.getByRole('button', { name: 'Continue from here', exact: true }).click();
  } else await frame.locator('.pa-reading-bar').getByRole('button', { name: 'Ask', exact: true }).click();
  await fillPaperChat(page, question);
  const thread = (await active()).id;
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await api('/api/library')).reports.length, { timeout: realAgent ? 600000 : 30000 }).toBe(before.length + 1);
  await expect.poll(async () => (await active()).state, { timeout: realAgent ? 120000 : 30000 }).toBe('idle');
  const summary = (await api('/api/library')).reports.find(report => !before.includes(report.id));
  const report = await api(`/api/reports/${summary.id}`), intent = await api(`/api/intents/${report.intentId}`), study = await api(`/api/studies/${report.intentId}`);
  expect(study.reportId).toBe(report.id); expect(study.steps.at(-1).action).toBe('finalize');
  await expect.poll(async()=>(await chatState(page)).appLinkBounds?.filter(link=>link.url.includes(`/report/${report.id}/`)).length??0).toBeGreaterThan(0);
  const viewport=page.viewportSize() || await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
  let link;
  for(let attempt=0;attempt<35;attempt++) {
    link=(await chatState(page)).appLinkBounds.find(link=>link.url.includes(`/report/${report.id}/`));
    if(link?.bounds && link.bounds.y>viewport.height-540 && link.bounds.y+link.bounds.height<viewport.height-125)break;
    await page.mouse.move(viewport.width-200,viewport.height-300);
    await page.mouse.wheel(0,-220);
    await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  }
  expect(link?.bounds).toBeTruthy();
  const evidenceReply=page.waitForResponse(response=>response.url().includes('/api/evidence')&&response.request().method()==='POST');
  await page.mouse.click(link.bounds.x+link.bounds.width/2,link.bounds.y+link.bounds.height/2);
  const evidence=await (await evidenceReply).json();
  expect(evidence.quote).toBe(report.sections[0].evidence[0].quote);
  expect(evidence.pdf.fileDigest).toBe(intent.passages.find(p=>p.id===report.sections[0].evidence[0].passageId).fileDigest);
  await expect(frame.locator('[data-citation-region="true"]').first()).toBeVisible();
  await page.screenshot({path:resolve(out,`chat-citation-${before.length+1}.png`)});
  await writeFile(resolve(out,`chat-citation-${before.length+1}.json`),JSON.stringify({link,evidence},null,2));
  await showPaperReport(frame, page, intent.id);
  expect(agentStarts).toEqual([]); // The App never creates or polls a second Host session.
  const chat=await active();
  return { report, intent, study, thread, model:chat.model, toolCalls:chat.tools.slice(previousTools).map(tool=>({id:tool.id,title:tool.title,status:tool.status,error:tool.status==='failed'?tool.content:undefined})), finalMessages:chat.messages.filter(message=>message.role==='assistant').map(message=>message.text), elapsedMs: Date.now() - startedAt };
}
try {
  app = await launch(); await openApp();
  await frame.getByRole('button', { name: 'Add papers', exact: true }).click();
  await frame.getByRole('tab', { name: 'PDF', exact: true }).click();
  await frame.getByLabel('Import PDF', { exact: true }).setInputFiles({ name: process.env.PERO_PAPER_JOURNEY_SYNTHETIC ? 'Synthetic PDF.pdf' : 'Meta-Harness.pdf', mimeType: 'application/pdf', buffer: pdf });
  const viewer = frame.getByRole('region', { name: 'PDF reader', exact: true });
  await expect(viewer.locator('img,canvas').first()).toBeVisible({ timeout: 30000 });
  const paper = (await api('/api/library')).papers[0], reading = await api(`/api/pdf?paperId=${paper.id}`);
  expect(reading.document.fileDigest).toBe(createHash('sha256').update(pdf).digest('hex'));
  await expect(frame.locator('#paper-question')).toHaveCount(0);
  const first = await ask('这篇论文的核心方法是什么？请用证据矩阵整理方法、反馈来源和评估任务。');
  const readPages = [...new Set(first.study.steps.filter(step => step.action === 'read').map(step => step.page))];
  if (!realAgent) expect(readPages).toEqual(reading.document.pages.length >= 5 ? [4, 5] : [1]);
  await writeFile(resolve(out, 'first-answer.json'), JSON.stringify(first, null, 2));
  const firstTurn = frame.locator(`[data-turn-id="${first.intent.id}"]`);
  await firstTurn.locator('.pa-inline-citation').first().click();
  await expect(viewer.locator('[data-citation-region="true"]').first()).toBeVisible();
  await page.screenshot({ path: resolve(out, '02-answer-and-original.png') });
  checks.push('shared Host conversation prepares the study, reads original PDF pages, finalizes exact citations and reveals the source');
  const second = await ask('继续解释这些方法的依据与适用条件。', first);
  expect(second.thread).toBe(first.thread);
  expect(second.intent.parentIntentId).toBe(first.intent.id);
  expect(second.intent.conversation[0].question).toBe(first.intent.question);
  await writeFile(resolve(out, 'followup-answer.json'), JSON.stringify(second, null, 2));
  checks.push('explicit follow-up preserves its parent input and frozen evidence in the same Host conversation');
  const history = await showPaperReport(frame, page, first.intent.id);
  if (first.report.matrix?.cells.length) {
    const column = first.report.matrix.columns.find(column => first.report.matrix.cells.some(cell => cell.columnId === column.id && cell.status === 'supported'));
    const value = first.report.matrix.cells.find(cell => cell.columnId === column.id && cell.status === 'supported').value;
    await history.getByRole('button', { name: `Edit cell: ${column.label}`, exact: true }).first().click();
    await history.getByLabel('Value', { exact: true }).fill(value + ' [reviewed]');
    await history.getByRole('button', { name: 'Save correction', exact: true }).click();
    await expect(history.getByText('Manually corrected', { exact: true }).first()).toBeVisible();
    expect((await api(`/api/reports/${first.report.id}`)).matrix).toEqual(first.report.matrix);
    await setPaperAppearance(page, 'dark');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 900));
    await expect.poll(async () => frame.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: resolve(out, '04-matrix-dark-narrow.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
    await setPaperAppearance(page, 'light');
    checks.push('manual matrix correction preserves the original Agent report and works in dark/narrow layouts');
  }
  let continuation;
  if (!realAgent) {
    await frame.locator('.pa-reading-bar').getByRole('button', { name: 'Ask', exact: true }).click();
    await fillPaperChat(page, 'paper-fixture-pause: Read the methods before continuation.');
    await page.keyboard.press('Enter');
    let paused;
    await expect.poll(async () => {
      const summary = (await api('/api/studies')).studies.find(study => study.question.startsWith('paper-fixture-pause:'));
      if (!summary) return false;
      paused = await api(`/api/studies/${summary.id}`);
      return paused.steps.some(step => step.action === 'read');
    }, { timeout: 30000 }).toBe(true);
    await stop();
    const count = (await api('/api/library')).reports.length;
    await app.close(); app = await launch(); await openApp();
    await frame.locator('.pa-library-list .pero-list-open').filter({ has: frame.getByText(paper.title, { exact: true }) }).click();
    await frame.locator('.pa-reading-bar').getByRole('button', { name: 'Research record', exact: true }).click();
    const saved = frame.locator(`[data-saved-study-id="${paused.id}"]`);
    await saved.locator(':scope>summary').click();
    await expect(saved.locator(`[data-study-id="${paused.id}"]`)).toBeVisible();
    expect((await api(`/api/studies/${paused.id}`)).steps).toEqual(paused.steps);
    await saved.getByRole('button', { name: 'Continue research', exact: true }).click();
    await expect.poll(async () => (await chatState(page)).attachments.length).toBeGreaterThan(0);
    await fillPaperChat(page, 'Continue research');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await api('/api/library')).reports.length, { timeout: 30000 }).toBe(count + 1);
    await expect.poll(async () => (await active()).state).toBe('idle');
    const resumed = await api(`/api/studies/${paused.id}`);
    expect(resumed.requestId).not.toBe(paused.requestId);
    expect(resumed.steps.slice(0, paused.steps.length)).toEqual(paused.steps);
    expect(resumed.steps.filter(step => step.action === 'read')).toHaveLength(paused.steps.filter(step => step.action === 'read').length);
    await showPaperReport(frame, page, resumed.intentId);
    await page.screenshot({ path: resolve(out, '07-continued-study.png') });
    continuation = { paused, resumed };
    checks.push('cancelled study survives restart; declared continuation recalls evidence without replaying reads');
  }
  expect(agentStarts).toEqual([]);
  expect(errors).toEqual([]);
  let fixtureMcp;
  if (!realAgent) {
    fixtureMcp = (await readFile(capture + '.mcp.jsonl', 'utf8')).trim().split('\n').map(JSON.parse);
    expect(fixtureMcp).toHaveLength(3);
    expect(fixtureMcp.find(turn => turn.studyId === continuation.resumed.id).steps.some(step => step.action === 'recall')).toBe(true);
  }
  const result = { realPdf: !process.env.PERO_PAPER_JOURNEY_SYNTHETIC, realAgent: !!realAgent, agent: agentId,
    sha256: reading.document.fileDigest, checks, first, second, continuation, fixtureMcp, errors, agentStarts };
  await writeFile(resolve(out, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ checks, errors, realAgent: !!realAgent }));
} catch (error) {
  if (app && page) {
    await page.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {});
    await writeFile(resolve(out, 'failure.json'), JSON.stringify({ error: String(error), state: await chatState(page), library: await api('/api/library').catch(() => null) }, null, 2));
  }
  throw error;
} finally { await app?.close(); await rm(profile, { recursive: true, force: true }); }

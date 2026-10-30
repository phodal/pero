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
  await page.mouse.click(80, await page.evaluate(() => innerHeight - 60));
  await expect.poll(async () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).navigation)).toBe(7);
  await expect.poll(async () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).appsLoading)).toBe(false);
  await expect.poll(async () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).apps.some(app => app.name === 'paper-agent'))).toBe(true);
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  const catalog = await page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
  const row = catalog.apps.findIndex(app => app.name === 'paper-agent');
  // The retained content tab strip adds 30px after restart; the catalog uses 58px rows.
  await page.screenshot({ path: resolve(out, '00-app-catalog.png') });
  await page.mouse.click(await page.evaluate(() => innerWidth - 172), 76 + (catalog.contentTabs.length ? 30 : 0) + row * 58);
  await expect.poll(async () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).activeApp?.name)).toBe('paper-agent');
  frame = page.frameLocator('iframe[title="paper-agent"]');
  await expect(frame.locator('.pa-workbench')).toBeVisible({ timeout: 20000 });
}
async function ask(question) {
  const before = (await api('/api/library')).reports.length;
  const beforeStarts = agentStarts.length, startedAt = Date.now();
  await frame.getByRole('textbox', { name: 'Research question', exact: true }).fill(question);
  await frame.getByRole('button', { name: 'Send question', exact: true }).click();
  await expect.poll(async () => {
    if ((await api('/api/library')).reports.length === before + 1) return true;
    return (await frame.getByRole('alert').allTextContents()).some(text => /Research failed|report was not saved/.test(text));
  }, { timeout: realAgent ? 600000 : 30000 }).toBe(true);
  if ((await api('/api/library')).reports.length !== before + 1) throw new Error((await frame.getByRole('alert').allTextContents()).join(' | '));
  const library = await api('/api/library');
  const reportSummary = library.reports.find(report => !seenReports.has(report.id));
  seenReports.add(reportSummary.id);
  const report = await api(`/api/reports/${reportSummary.id}`), intent = await api(`/api/intents/${report.intentId}`);
  await expect(frame.locator('.pa-turn .pa-report')).toHaveAttribute('data-report-id', report.id);
  await expect(frame.getByRole('textbox', { name: 'Research question', exact: true })).toBeEnabled({ timeout: 30000 });
  const study = await api(`/api/studies/${report.intentId}`);
  const starts = agentStarts.slice(beforeStarts);
  expect(starts).toHaveLength(1);
  expect(starts[0]).toMatchObject({ requestId: study.requestId, study: true });
  expect(study.reportId).toBe(report.id);
  expect(study.steps.at(-1).action).toBe('finalize');
  return { report, intent, study, elapsedMs: Date.now() - startedAt, hostSessionStarts: starts };
}
const seenReports = new Set();
try {
  app = await launch(); await openApp();
  await frame.getByRole('button', { name: 'Add papers', exact: true }).click();
  await frame.getByRole('tab', { name: 'PDF', exact: true }).click();
  await frame.getByLabel('Import PDF', { exact: true }).setInputFiles({ name: 'Meta-Harness - End-to-End Optimization of Model Harnesses.pdf', mimeType: 'application/pdf', buffer: pdf });
  const viewer = frame.getByRole('region', { name: 'PDF reader', exact: true });
  await expect(viewer).toBeVisible({ timeout: 30000 });
  await expect(viewer.locator('img,canvas').first()).toBeVisible();
  await expect(frame.locator('.pa-conversation')).toHaveCount(0);
  const library = await api('/api/library'), paper = library.papers[0];
  const reading = await api(`/api/pdf?paperId=${paper.id}`);
  expect(reading.document.fileDigest).toBe(createHash('sha256').update(pdf).digest('hex'));
  expect(reading.document.pages).toHaveLength(26);
  await page.screenshot({ path: resolve(out, '01-import-and-read.png') });
  checks.push('actual 26-page Meta-Harness PDF uploaded through Desktop binary proxy, saved by digest, reading-only default');
  // Duplicates retain the existing paper, independent of its filename.
  const duplicate = await frame.locator('body').evaluate(async (_element, bytes) => {
    const response = await fetch('/api/pdf/import?filename=renamed.pdf', { method:'POST',headers:{'Content-Type':'application/pdf'},body:new Uint8Array(bytes) });
    return response.json();
  }, [...pdf]);
  expect(duplicate.id).toBe(paper.id); expect((await api('/api/library')).papers).toHaveLength(1);
  await frame.getByRole('button', { name: 'Ask', exact: true }).click();
  await frame.getByRole('button', { name: 'Research settings', exact: true }).click();
  const agent = frame.getByLabel('Agent', { exact: true });
  const agentId = realAgent || 'paper-fixture';
  await expect(agent.locator(`option[value="${agentId}"]`)).toHaveCount(1);
  await agent.selectOption(agentId);
  await frame.getByRole('button', { name: 'Research settings', exact: true }).click();
  const first = await ask('这篇论文的核心方法是什么？proposer 使用哪些历史信息？请用证据矩阵整理方法、反馈来源、评估任务。');
  expect(first.intent.passages.length).toBeGreaterThan(0);
  const readPages = new Set(first.study.steps.filter(step => step.action === 'read').map(step => step.page));
  expect(readPages.has(4)).toBe(true);
  expect(readPages.has(5)).toBe(true);
  const methodPassages = first.study.steps.filter(step => step.action === 'read' && [4, 5].includes(step.page)).flatMap(step => step.passages);
  expect(first.report.sections.some(section => section.evidence.some(ref => methodPassages.some(passage => passage.id === ref.passageId)))).toBe(true);
  await writeFile(resolve(out, 'first-answer.json'), JSON.stringify(first, null, 2));
  // Click the actual rendered inline reference or its section fallback.
  const cite = frame.locator('.pa-turn .pa-report .pa-inline-citation').first();
  if (await cite.count()) await cite.click(); else await frame.locator('.pa-turn .pa-citations button').first().click();
  await expect(viewer.locator('[data-citation-region="true"]').first()).toBeVisible();
  await page.screenshot({ path: resolve(out, '02-answer-and-original.png') });
  checks.push('one Host session reads actual formal-method pages 4 and 5 through App MCP, saves its evidence ledger, finalizes exact citations and highlights the PDF');
  const second = await ask('它为什么保留这些历史信息，而不是只把反馈压缩成一段摘要？请结合论文解释这一设计的依据与适用条件。');
  expect(second.intent.parentIntentId).toBe(first.intent.id);
  expect(second.intent.conversation[0].question).toContain('proposer');
  await writeFile(resolve(out, 'followup-answer.json'), JSON.stringify(second, null, 2));
  await page.screenshot({ path: resolve(out, '03-followup.png') });
  checks.push('follow-up uses saved conversation, a separate study and exactly one Host session; source observations and final report remain inspectable');
  // Edit a matrix produced in the first answer, preserving its source evidence.
  expect(first.report.matrix?.columns.length).toBeGreaterThan(0);
  const history = frame.locator(`[data-turn-id="${first.intent.id}"]`);
  await history.locator(':scope>summary').click();
  const column = first.report.matrix.columns.find(column => first.report.matrix.cells.some(cell => cell.columnId === column.id && cell.status === 'supported'));
  const value = first.report.matrix.cells.find(cell => cell.columnId === column.id && cell.status === 'supported').value;
  await history.getByRole('button', { name: `Edit cell: ${column.label}`, exact:true }).first().click();
  await history.getByLabel('Value', {exact:true}).fill(value + ' [reviewed]');
  await history.getByLabel('Correction note (optional)', {exact:true}).fill('Journey validation: checked original PDF; preserve Agent version.');
  await history.getByRole('button',{name:'Save correction',exact:true}).click();
  await expect(history.getByText('Manually corrected',{exact:true}).first()).toBeVisible();
  const revised = await api(`/api/reports/${first.report.id}/matrix`);
  expect(revised.revisions).toHaveLength(1);
  expect((await api(`/api/reports/${first.report.id}`)).matrix).toEqual(first.report.matrix);
  await history.locator('.pa-matrix').scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(out, '04-matrix-correction.png') });
  checks.push('manual matrix correction, exact evidence validation, persisted revision and unchanged original Agent report');
  if (!realAgent) {
    await setPaperAppearance(page,'dark');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000,900));
    await history.getByRole('button',{name:`Edit cell: ${column.label}`,exact:true}).first().click();
    await expect(history.getByLabel('Value',{exact:true})).toBeVisible();
    await expect.poll(async () => frame.locator('html').evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
    const editorFits = await history.locator('.pa-cell-editor').evaluate(element => { const form = element.getBoundingClientRect(), panel = element.closest('.pa-conversation').getBoundingClientRect(); return form.left >= panel.left && form.right <= panel.right; });
    expect(editorFits).toBe(true);
    await page.screenshot({path:resolve(out,'05-editor-dark-narrow.png')});
    await history.getByLabel('Value',{exact:true}).press('Escape');
    await expect(history.getByRole('button',{name:`Edit cell: ${column.label}`,exact:true}).first()).toBeFocused();
    await setPaperAppearance(page,'light');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440,900));
    checks.push('matrix correction editor works in dark narrow overlay; Escape returns focus to its cell');
  }
  if (realAgent) {
    // This question is deliberately outside what this source reports.
    const priorReports = (await api('/api/library')).reports.length, beforeStarts = agentStarts.length;
    await frame.getByRole('textbox',{name:'Research question',exact:true}).fill('论文是否报告了在 NVIDIA H100 上训练新模型的具体 GPU 小时和训练费用？如果没有证据，请明确说明，不能估算。');
    await frame.getByRole('button',{name:'Send question',exact:true}).click();
    await expect.poll(async () => {
      const count = (await api('/api/library')).reports.length;
      const alerts = await frame.getByRole('alert').allTextContents();
      return count > priorReports ? 'answer' : alerts.some(text => /No supporting PDF evidence/.test(text)) ? 'no-evidence' : '';
    }, {timeout:600000}).not.toBe('');
    const unsupported = { reports: (await api('/api/library')).reports, alerts: await frame.getByRole('alert').allTextContents() };
    const extra = unsupported.reports.find(report => !seenReports.has(report.id));
    if (extra) {
      unsupported.answer = await api(`/api/reports/${extra.id}`); unsupported.intent = await api(`/api/intents/${unsupported.answer.intentId}`);
      unsupported.study = await api(`/api/studies/${unsupported.answer.intentId}`);
      expect(unsupported.intent.parentIntentId).toBe(second.intent.id);
    }
    expect(agentStarts.slice(beforeStarts)).toHaveLength(1);
    await writeFile(resolve(out,'unsupported-question.json'),JSON.stringify(unsupported,null,2));
    await page.screenshot({path:resolve(out,'05-unsupported-question.png')});
    checks.push('out-of-scope GPU cost question recorded for manual review; source validity is not inferred from quote presence');
  }
  const beforeRestartStarts = agentStarts.length;
  await app.close(); app = await launch(); await openApp();
  await frame.getByRole('button',{name:paper.title,exact:true}).click();
  await frame.getByRole('button',{name:'Ask',exact:true}).click();
  const restored = frame.locator(`[data-turn-id="${first.intent.id}"]`);
  await restored.locator(':scope>summary').click();
  await expect(restored.getByText('Manually corrected',{exact:true}).first()).toBeVisible();
  expect((await api(`/api/pdf?paperId=${paper.id}`)).document.fileDigest).toBe(reading.document.fileDigest);
  const restoredStudy = await api(`/api/studies/${first.study.id}`);
  expect(restoredStudy.steps).toEqual(first.study.steps);
  expect(restoredStudy.reportId).toBe(first.report.id);
  expect(agentStarts).toHaveLength(beforeRestartStarts);
  checks.push('trusted App open after restart recovers PDF bytes, study ledger, reports and matrix revisions without rerunning research');
  let continuation;
  if (!realAgent) {
    const beforePauseStarts = agentStarts.length;
    await frame.getByRole('textbox', { name: 'Research question', exact: true }).fill('paper-fixture-pause: Read the formal methods and keep the study available for continuation.');
    await frame.getByRole('button', { name: 'Send question', exact: true }).click();
    let paused;
    await expect.poll(async () => {
      const summary = (await api('/api/studies')).studies.find(study => study.question.startsWith('paper-fixture-pause:'));
      if (!summary) return false;
      paused = await api(`/api/studies/${summary.id}`);
      return [4, 5].every(page => paused.steps.some(step => step.action === 'read' && step.page === page));
    }, { timeout: 30000 }).toBe(true);
    await frame.getByRole('button', { name: 'Cancel research', exact: true }).click();
    await expect(frame.getByRole('button', { name: 'Continue research', exact: true })).toBeVisible();
    await writeFile(resolve(out, 'paused-layout.json'), JSON.stringify(await frame.locator('.pa-conversation').evaluate(element => {
      const scroll = element.querySelector('.pa-conversation-scroll'), composer = element.querySelector('.pa-composer');
      const rect = node => ({ top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom });
      return { scrollTop: scroll.scrollTop, scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight,
        scroll: rect(scroll), composer: rect(composer), buttons: [...scroll.querySelectorAll('button')].slice(-3).map(node => ({ text: node.textContent, ...rect(node) })) };
    }), null, 2));
    await expect(frame.getByRole('button', { name: 'Continue research', exact: true })).toBeInViewport({ ratio: 1 });
    paused = await api(`/api/studies/${paused.id}`);
    expect(paused.reportId).toBeNull();
    expect(agentStarts).toHaveLength(beforePauseStarts + 1);
    await page.screenshot({ path: resolve(out, '06-paused-study.png') });
    await app.close(); app = await launch(); await openApp();
    await frame.getByRole('button', { name: paper.title, exact: true }).click();
    await frame.getByRole('button', { name: 'Ask', exact: true }).click();
    await frame.locator(`[data-saved-study-id="${paused.id}"]`).getByRole('button', { name: 'Open research record', exact: true }).click();
    await expect(frame.locator(`[data-study-id="${paused.id}"]`)).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Continue research', exact: true })).toBeEnabled();
    expect((await api(`/api/studies/${paused.id}`)).steps).toEqual(paused.steps);
    expect(agentStarts).toHaveLength(beforePauseStarts + 1);
    await frame.getByRole('button', { name: 'Continue research', exact: true }).click();
    let resumed;
    await expect.poll(async () => {
      resumed = await api(`/api/studies/${paused.id}`);
      return !!resumed.reportId;
    }, { timeout: 30000 }).toBe(true);
    await expect(frame.locator('.pa-turn .pa-report')).toHaveAttribute('data-report-id', resumed.reportId);
    await expect(frame.getByRole('textbox', { name: 'Research question', exact: true })).toBeEnabled();
    expect(resumed.id).toBe(paused.id);
    expect(resumed.requestId).not.toBe(paused.requestId);
    expect(resumed.steps.slice(0, paused.steps.length)).toEqual(paused.steps);
    expect(resumed.steps.filter(step => step.action === 'read')).toHaveLength(paused.steps.filter(step => step.action === 'read').length);
    expect(resumed.steps.at(-1).action).toBe('finalize');
    expect(agentStarts).toHaveLength(beforePauseStarts + 2);
    continuation = { paused, resumed, hostSessionStarts: agentStarts.slice(beforePauseStarts) };
    await writeFile(resolve(out, 'continuation.json'), JSON.stringify(continuation, null, 2));
    await page.screenshot({ path: resolve(out, '07-continued-study.png') });
    checks.push('cancelled unfinished study survives restart; explicit continuation uses a new Host request and recalls saved evidence without replaying reads');
  }
  const legacyPlannerStages = stages.filter(stage => stage.stage !== 'study');
  expect(legacyPlannerStages).toEqual([]);
  let fixtureMcp;
  if (!realAgent) {
    fixtureMcp = (await readFile(capture + '.mcp.jsonl', 'utf8')).trim().split('\n').map(JSON.parse);
    expect(fixtureMcp).toHaveLength(3);
    expect(fixtureMcp.every(turn => turn.tools.includes('app_describe') && turn.tools.includes('app_write'))).toBe(true);
    const continued = fixtureMcp.find(turn => turn.studyId === continuation.resumed.id);
    expect(continued.steps.some(step => step.action === 'recall')).toBe(true);
    expect(continued.steps.some(step => step.action === 'read')).toBe(false);
  }
  expect(errors).toEqual([]);
  const models = [...new Set((await readFile(resolve(profile, 'history.jsonl'), 'utf8')).split('\n').filter(Boolean)
    .map(line => JSON.parse(line)).filter(event => event.kind === 'session_ready').map(event => event.data?.models?.currentModelId).filter(Boolean))];
  if (requestedModel) {
    expect(models).toHaveLength(1);
    expect(models[0].split('[')[0]).toBe(requestedModel);
    if (requestedEffort) expect(models[0]).toBe(`${requestedModel}[${requestedEffort}]`);
  }
  const result = { paper:'https://arxiv.org/abs/2603.28052v1',sha256:reading.document.fileDigest,realPdf:true,realAgent:!!realAgent,agent:agentId,
    models,checks,stages,agentStarts,legacyPlannerStages,firstAnswerMs:first.elapsedMs,followupAnswerMs:second.elapsedMs,
    readPages:[...readPages],continuation,fixtureMcp,errors };
  await writeFile(resolve(out,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({ realAgent: !!realAgent, models, checks, firstAnswerMs: first.elapsedMs, followupAnswerMs: second.elapsedMs, readPages: [...readPages], errors }));
} catch(error) {
  if (app) {
    await page.screenshot({path:resolve(out,'failure.png')}).catch(()=>{});
    await writeFile(resolve(out,'failure.json'),JSON.stringify({error:String(error),stages,errors,agentStarts,agentTrace,fixture: !realAgent ? await readFile(capture,'utf8').catch(()=>null) : null,library:await api('/api/library').catch(()=>null),alerts:await frame?.getByRole('alert').allTextContents().catch(()=>[]),raw:await frame?.getByRole('textbox',{name:'Report JSON',exact:true}).inputValue().catch(()=>null),frozen:await api('/api/library').then(async library=>await Promise.all(library.intents.map(intent=>api(`/api/intents/${intent.id}`)))).catch(()=>[]),studies:await api('/api/studies').catch(()=>null)},null,2));
  }
  throw error;
} finally { if(app)await app.close(); await rm(profile,{recursive:true,force:true}); }

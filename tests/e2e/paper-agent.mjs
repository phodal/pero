import { exerciseLocalSearch } from './paper-search-flow.mjs';
// Real Electron -> Rust Host -> Python App; Agent output is a labelled ACP fixture.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { exercisePdf, reopenPdf, backToLibrary, setPaperAppearance as setAppearance } from './paper-pdf-flow.mjs';

const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, process.env.PERO_PAPER_TEST_OUTPUT || 'test-results/paper-agent');
await mkdir(out, { recursive: true });
await rm(resolve(out, 'failure.png'), { force: true });
const profile = await mkdtemp(resolve(tmpdir(), 'pero-paper-e2e-'));
const pdfPath = resolve(profile, 'source.pdf');
const pdfFixture = JSON.parse(execFileSync(process.env.PERO_APP_PYTHON || 'python3', ['-c', `
import runpy,sys,json
from pathlib import Path
from contextlib import closing
import pypdfium2 as pdfium
fixture=runpy.run_path(sys.argv[1])
real=bool(sys.argv[3])
data=Path(sys.argv[3]).read_bytes() if real else fixture['pdf_fixture']()
Path(sys.argv[2]).write_bytes(data)
with closing(pdfium.PdfDocument(data)) as pdf, closing(pdf[0]) as page, closing(page.get_textpage()) as text:
 quote='Attention Is All You Need' if real else 'Exact original evidence.'
 with closing(text.search(quote)) as search:
  start,count=search.get_next()
 a=text.get_charbox(start); b=text.get_charbox(start+count-1)
 width,height=page.get_size()
 print(json.dumps(dict(realPdf=real,pages=len(pdf),quote=quote,text=text.get_text_range(),selection=dict(x1=(a[0]+1)/width,x2=(b[2]-1)/width,y=(height-(a[1]+a[3])/2)/height))))
`, resolve(root, 'apps/paper-agent/test/test_pdf.py'), pdfPath, process.env.PERO_PAPER_PDF_FILE || ''], { encoding: 'utf8' }));
const capture = resolve(profile, 'fixture-turns.jsonl');
const agents = resolve(profile, 'agents.json');
await writeFile(agents, JSON.stringify([{ id: 'paper-fixture', name: 'Synthetic Paper fixture', command: process.execPath,
  args: [resolve(root, 'tests/fixtures/paper-agent.mjs'), `--capture=${capture}`] }]));
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(profile, 'desktop'), PERO_LOCALE: 'en',
  PERO_SETTINGS_PATH: resolve(profile, 'settings.json'), PERO_HISTORY_PATH: resolve(profile, 'sessions.jsonl'), PERO_AGENTS_FILE: agents };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PERO_APPS_ROOT;
const launch = () => electron.launch({ args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), resolve(root, 'desktop')], cwd: root, env });
let app;
const errors = [];
const checks = [];
const payloads = {};
const expectedConsole = [];
const agentTrace = [];
const fixtureTurns = async () => { try { return (await readFile(capture, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };
const observe = page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const url = message.location().url;
    if (/\b(?:400|403|503)\b/.test(message.text()) && /\/(?:api\/(?:reports|discover|pdf|library\/search)|host\/agent)$/.test(url)) expectedConsole.push({ url, text: message.text() });
    else errors.push({ url, text: message.text() });
  });
  page.on('response', response => {
    if (response.url().endsWith('/host/agent')) void response.json().then(value => { agentTrace.push({ operation: response.request().postDataJSON()?.operation, status: value.status, cursor: value.cursor, textLength: value.text?.length }); }).catch(() => {});
    const asset = /^pero-app:\/\/paper-agent\/dist\/index\.(js|css)$/.exec(response.url())?.[1];
    if (asset) void response.body().then(body => { payloads[asset] = createHash('sha256').update(body).digest('hex'); }).catch(error => errors.push(error.message));
  });
};

async function openPaper(page) {
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await expect.poll(async () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).apps?.some(item => item.name === 'paper-agent') ?? false)).toBe(true);
  await page.mouse.click(80, await page.evaluate(() => innerHeight - 76));
  await expect.poll(async () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).navigation)).toBe(7);
  await expect.poll(async () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).appsLoading)).toBe(false);
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  await page.mouse.click(await page.evaluate(() => innerWidth - 183), 110);
  await expect.poll(async () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).activeApp?.name)).toBe('paper-agent');
  const frame = page.frameLocator('iframe[title="paper-agent"]');
  await expect(frame.getByRole('button', { name: 'Add papers', exact: true }).first()).toBeVisible({ timeout: 20000 });
  return frame;
}
const library = frame => frame.locator('body').evaluate(async () => (await (await fetch('/api/library')).json()));
const savedCount = async frame => (await library(frame)).reports.length;

try {
  app = await launch();
  let page = await app.firstWindow();
  observe(page);
  // Change only the disposable installed package: keep the real Python transport,
  // adapter and store while replacing the external HTTP seam with synthetic data.
  await page.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).apps?.some(item => item.name === 'paper-agent'));
  const installedBackend = resolve(profile, 'desktop/apps/paper-agent/backend');
  await writeFile(resolve(installedBackend, 'discovery_fixture.py'), await readFile(resolve(root, 'tests/fixtures/paper-discovery.py')));
  const serverPath = resolve(installedBackend, 'server.py');
  await writeFile(serverPath, (await readFile(serverPath, 'utf8')).replace('from paper_agent.http import handler', 'from paper_agent.http import handler\nfrom paper_agent.literature import LiteratureClient\nfrom discovery_fixture import fetch').replace('os.environ["PERO_APP_TOKEN"]))', 'os.environ["PERO_APP_TOKEN"], LiteratureClient(fetch), pdf_files=PdfFiles(lambda *_args, **_kwargs: BytesIO(Path(' + JSON.stringify(pdfPath) + ').read_bytes()))))').replace('from paper_agent.http import handler\n', 'from paper_agent.http import handler\nfrom paper_agent.pdf_files import PdfFiles\nfrom io import BytesIO\nfrom pathlib import Path\n'));
  let frame = await openPaper(page);
  if (process.env.PERO_PAPER_PDF_ONLY !== '1') {
    await expect(frame.getByText('Add a paper to start reading', { exact: true })).toBeVisible();
    expect(await fixtureTurns()).toHaveLength(0);
    await page.screenshot({ path: resolve(out, 'empty.png') });
    // Synthetic content is explicit test input, imported through the real UI.
    const sample = await frame.locator('body').evaluate(async () => (await fetch('/api/example')).json());
    await frame.getByRole('button', { name: 'Add papers', exact: true }).click();
    await frame.getByRole('tab', { name: 'Import text', exact: true }).click();
    await frame.getByLabel('Paper title', { exact: true }).fill(sample.title);
    await frame.getByLabel('Original URL (HTTPS)', { exact: true }).fill(sample.url);
    await frame.getByLabel('Source text or abstract', { exact: true }).fill(sample.content);
    await frame.getByRole('button', { name: 'Save source snapshot', exact: true }).click();
    await expect(frame.getByRole('heading', { name: sample.title, exact: true })).toBeVisible();
    const paper = await frame.locator('body').evaluate(async () => { const library = await (await fetch('/api/library')).json(); return (await fetch(`/api/papers/${library.papers[0].id}`)).json(); });
    await expect(frame.getByRole('heading', { name: paper.title, exact: true })).toBeVisible();
    await expect(frame.locator('.pa-conversation')).toHaveCount(0);
    await expect(frame.locator('.pa-library-screen')).not.toBeVisible();
    expect(await frame.locator('body').evaluate(() => typeof window.pero)).toBe('undefined');
    expect(await fixtureTurns()).toHaveLength(0);
    await page.screenshot({ path: resolve(out, 'source.png') });
    checks.push('reading opens without Agent, permanent navigation, synthetic UI actions or implicit execution; installed Python backend and immutable source');
    await backToLibrary(frame);
    await exerciseLocalSearch({ frame, page, app, out });
    checks.push('local indexed search, digest, empty/error recovery and source opening from the library');

    await frame.locator('.pa-library-list>li').first().getByRole('button', { name: 'Discover', exact: true }).click();
    await expect(frame.getByRole('heading', { name: 'Confirm seed paper', exact: true })).toBeVisible();
    await frame.getByRole('button', { name: 'Use this match', exact: true }).click();
    const discovered = frame.locator('.pa-discovery [data-work-id="W2"]');
    await discovered.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(discovered.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
    const metadataOnly = frame.locator('.pa-discovery [data-work-id="W4"]');
    await metadataOnly.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(metadataOnly.getByRole('button', { name: 'Compare', exact: true })).toBeDisabled();
    expect((await library(frame)).papers).toHaveLength(1);
    await frame.getByRole('button', { name: 'Citing papers', exact: true }).click();
    await expect(frame.getByRole('alert')).toContainText('429');
    await frame.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(frame.getByText('No papers found', { exact: true })).toBeVisible();
    await frame.getByRole('button', { name: 'References', exact: true }).click();
    await expect(frame.locator('.pa-discovery-results>li')).toHaveCount(12);
    await frame.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(frame.locator('.pa-discovery-results>li')).toHaveCount(1);
    await frame.getByRole('button', { name: 'Related papers', exact: true }).click();
    await page.screenshot({ path: resolve(out, 'discovery-browse.png') });
    await discovered.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(frame.getByRole('complementary', { name: 'Ask', exact: true })).toBeVisible();
    await expect(frame.getByRole('textbox', { name: 'Research question', exact: true })).toContainText('Compare the selected papers');
    expect(await fixtureTurns()).toHaveLength(0);
    checks.push('discovery remains in library: confirmation, related/reference/citing directions, pagination, retry, metadata favorites and explicit comparison');
    await frame.getByRole('button', { name: 'Research settings', exact: true }).click();
    await expect(frame.getByLabel('Agent', { exact: true })).toContainText('Synthetic Paper fixture');
    await frame.getByLabel('Agent', { exact: true }).selectOption('paper-fixture');
    await frame.locator('.pa-conversation-settings details>summary').filter({hasText:'Choose papers'}).click();
    await expect(frame.locator('.pa-conversation-settings input[type=checkbox]:checked')).toHaveCount(2);
    await frame.getByRole('button', { name: 'Research settings', exact: true }).click();
    await frame.getByRole('textbox', { name: 'Research question', exact: true }).fill('What does this synthetic source establish?');
    await frame.getByRole('button', { name: 'Send question', exact: true }).click();
    await expect(frame.getByRole('heading', { name: 'Synthetic research report', exact: true })).toBeVisible({ timeout: 30000 });
    expect(await savedCount(frame)).toBe(1);
    await expect(frame.locator('.pa-turn .pa-scientific table')).toBeVisible();
    await expect(frame.locator('.pa-turn .pa-scientific .katex-display')).toBeVisible();
    await expect(frame.locator('.pa-turn .pa-scientific code .hljs-built_in')).toContainText('print');
    await expect(frame.locator('.pa-turn .pa-matrix td[data-status="missing"]').first()).toContainText('Not provided');
    await expect(frame.locator('.pa-turn .pa-matrix')).toContainText('Synthetic W2');
    await frame.getByRole('button', { name: 'Scope Citation evidence 1', exact: true }).click();
    await expect(frame.getByRole('complementary', { name: 'Citation evidence', exact: true }).locator('mark')).toBeVisible();
    await frame.getByRole('complementary', { name: 'Citation evidence', exact: true }).getByRole('button', {name:'Close',exact:true}).press('Escape');
    await expect(frame.getByRole('button', { name: 'Scope Citation evidence 1', exact: true })).toBeFocused();
    await page.screenshot({ path: resolve(out, 'scientific-matrix.png') });
    checks.push('inline answers, GFM/math/code, evidence matrices, exact source citations and keyboard focus restoration');

    await frame.getByRole('textbox', { name: 'Research question', exact: true }).fill('paper-fixture-invalid: What does this synthetic source establish?');
    await frame.getByRole('button', { name: 'Send question', exact: true }).click();
    await expect(frame.getByText('The report was not saved. Correct the output below and validate again.', { exact: true })).toBeVisible({timeout:30000});
    await expect(frame.getByRole('alert').filter({hasText:'Evidence quotation'})).toBeVisible();
    expect(await savedCount(frame)).toBe(1);
    const raw = frame.getByLabel('Report JSON', {exact:true});
    const output = JSON.parse(await raw.inputValue());
    await raw.fill('{broken JSON');
    await frame.getByRole('button', { name: 'Validate and save report', exact: true }).click();
    await expect(frame.getByRole('alert').filter({hasText:'No valid JSON report'})).toBeVisible();
    output.title = 'Corrected synthetic report';
    output.sections[0].content += '\n\n<script>window.paperInjected = true</script>\n\n[unsafe](javascript:alert(1))';
    output.sections[0].evidence[0].quote = paper.content.split('\n').find(line => line.trim() && !line.startsWith('#'));
    await raw.fill(JSON.stringify(output));
    await frame.getByRole('button', { name: 'Validate and save report', exact: true }).click();
    await expect(frame.getByRole('heading', { name: 'Corrected synthetic report', exact: true })).toBeVisible();
    expect(await savedCount(frame)).toBe(2);
    expect(await frame.locator('body').evaluate(() => window.paperInjected)).toBeUndefined();
    await expect(frame.locator('.pa-scientific script,.pa-scientific a[href^="javascript:"]')).toHaveCount(0);
    await frame.getByRole('button', {name:'Dismiss error',exact:true}).click();
    await frame.getByRole('button', { name: 'Research settings', exact: true }).click();
    checks.push('invalid Agent evidence rejected, editable output retained, explicit JSON repair and safe rendering');
    await frame.locator('.pa-turn .pa-answer-actions>summary').click();
    for (const [label, filename] of [['Export Markdown','research.md'],['Export JSON','research.json']]) {
      const destination=resolve(out,filename); await rm(destination,{force:true});
      await app.evaluate(({session},path)=>session.defaultSession.once('will-download',(_event,item)=>item.setSavePath(path)),destination);
      await frame.getByRole('button',{name:label,exact:true}).click();
      await expect.poll(async()=>{try{return(await readFile(destination,'utf8')).length;}catch{return 0;}}).toBeGreaterThan(100);
    }
    expect(await readFile(resolve(out,'research.md'),'utf8')).toContain('Acceptance: unverified');
    await page.emulateMedia({media:'print'});
    await expect(frame.locator('.pa-turn .pa-print-appendix')).toContainText(paper.contentDigest);
    await expect(frame.locator('.pa-turn .pa-print-appendix')).toBeVisible();
    await page.emulateMedia({media:'screen'});
    checks.push('report exports and print appendix preserve evidence and source versions');
    await frame.getByRole('textbox',{name:'Research question',exact:true}).fill('paper-fixture-wait: cancellation acceptance');
    await frame.getByRole('button',{name:'Send question',exact:true}).click();
    await frame.getByRole('button',{name:'Cancel research',exact:true}).click();
    await expect(frame.getByText('Research cancelled',{exact:true})).toBeVisible({timeout:15000});
    expect(await savedCount(frame)).toBe(2);
    checks.push('Host cancellation works from the conversation without committing an answer');
    await setAppearance(page,'dark');
    await app.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('locale-zh-CN').click());
    await expect(frame.getByRole('button',{name:'关闭 Agent',exact:true})).toBeVisible();
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,800));
    await expect.poll(async()=>frame.locator('html').evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
    await page.screenshot({path:resolve(out,'dark-zh-narrow.png')});
    await app.evaluate(({Menu,BrowserWindow})=>{Menu.getApplicationMenu().getMenuItemById('locale-en').click();BrowserWindow.getAllWindows()[0].setSize(1440,900);});
    await setAppearance(page,'light');
    checks.push('dark theme, Chinese locale and narrow Agent overlay');
  }
  const savedPdf = await exercisePdf({frame,page,app,out,fixture:pdfFixture});
  checks.push('reading-only default at 1440x900, retained viewer/zoom/selection across Ask, selected-text question context');
  checks.push('PDF pointer highlight, contextual crop, native image copy, inline manual matrix, source navigation and PDF failure recovery');
  checks.push('full-text retrieval -> Host ACP answer -> exact PDF quotation highlight');
  const beforeRestart=(await fixtureTurns()).length;
  await app.close();app=await launch();page=await app.firstWindow();observe(page);
  await app.evaluate(({Menu,BrowserWindow})=>{Menu.getApplicationMenu().getMenuItemById('locale-en').click();BrowserWindow.getAllWindows()[0].setSize(1440,900);});
  frame=await openPaper(page);
  await reopenPdf({frame,saved:savedPdf});
  const state=await library(frame),pdfIntent=state.reports.find(report=>report.title==='PDF answer fixture').intentId;
  await frame.locator(`[data-turn-id="${pdfIntent}"]>summary`).click();
  await expect(frame.getByRole('heading',{name:'PDF answer fixture',exact:true})).toBeVisible();
  await frame.locator(`[data-turn-id="${pdfIntent}"] .pa-scientific`).getByRole('button',{name:'Citation evidence 1',exact:true}).click();
  await expect(frame.locator('[data-citation-region="true"]').first()).toBeVisible();
  expect((await fixtureTurns()).length).toBe(beforeRestart);
  checks.push('conversation history, reports, PDF bytes, annotations, matrices and exact citations survive Desktop restart without Agent replay');
  await page.screenshot({path:resolve(out,'conversation-reopened.png')});
  await page.evaluate(()=>window.pero.appsCommand({action:'apps_open',name:'virtual-cell',panel:'main'}));
  const other=page.frameLocator('iframe[title="virtual-cell"]');
  await expect(other.locator('body')).toBeAttached();
  const denied=await other.locator('body').evaluate(async()=>{const response=await fetch('/host/agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'info'})});return{status:response.status,text:await response.text()};});
  expect(denied.status).toBeGreaterThanOrEqual(400);expect(denied.text).toMatch(/permission|grant|Agent|agent/i);
  checks.push('real Host Agent grant boundary remains enforced');
  await expect.poll(() => Object.keys(payloads).length).toBe(2);
  for (const extension of ['js', 'css']) expect(payloads[extension]).toBe(createHash('sha256').update(await readFile(resolve(root, `apps/paper-agent/dist/index.${extension}`))).digest('hex'));
  expect(errors).toEqual([]);
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ fixtureOnly: !pdfFixture.realPdf, realPdf: pdfFixture.realPdf, realModel: false, payloads, checks, errors, expectedConsole }, null, 2));
  console.log(JSON.stringify({ fixtureOnly: !pdfFixture.realPdf, realPdf: pdfFixture.realPdf, realModel: false, payloads, checks, errors, expectedConsole }));
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    await page.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {});
    console.error('Paper Agent failure state', { errors, agentTrace: agentTrace.slice(-8), fixtureTurns: await fixtureTurns(), state: await page.evaluate(() => {
      const value = JSON.parse(window.peroDiagnostics?.snapshot() ?? '{}');
      return { navigation: value.navigation, activeApp: value.activeApp, appError: value.appError,
        chats: value.chats?.map(chat => ({ id: chat.id, state: chat.state, agent: chat.agent })) };
    }).catch(() => 'unavailable') });
  }
  throw error;
} finally {
  if (app) await app.close();
  await rm(profile, { recursive: true, force: true });
}

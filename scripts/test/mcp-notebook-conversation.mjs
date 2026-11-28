// Real Workbench/Host/Go ACP and the Host-registered Notebook App.
// Notebook owns the revision. The tool row opens that pinned Inspector.
import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {copyFileSync, existsSync, unlinkSync} from 'node:fs';
import {mkdir,mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {expect} from '@playwright/test';
import {electron} from '../../tests/e2e/electron.mjs';
import {clickSessionRow} from '../../tests/e2e/sidebar-controls.mjs';
import {notebookConversationProvider, notebookConversationPrompt, notebookInitialAnswer,
  notebookContextPrompt, notebookContextAnswer} from '../../tests/fixtures/mcp-app/notebook-conversation-provider.mjs';

const root = resolve(import.meta.dirname, '../..');
const html = resolve('desktop/dist/notebook-inspector.html');
assert.equal(existsSync(html), true, 'Build Desktop so the registered inspector document exists');
await promisify(execFile)(process.execPath, ['scripts/build/apps.mjs', '--app', 'notebook']);
const sourceTools = resolve('apps/notebook/backend/pero_source_tools.py');
const copiedTools = !existsSync(sourceTools);
if (copiedTools) copyFileSync(resolve('packages/source-extraction/python/pero_source_tools.py'), sourceTools);
const home = await realpath(await mkdtemp(join(tmpdir(), 'pero-notebook-conversation-')));
const evidence = resolve('test-results/mcp-notebook-conversation');
await mkdir(evidence, {recursive: true});
const pythonRoot = join(home, 'python');
const pythonBin = join(pythonRoot, 'bin', 'python');
const dependencies = JSON.parse(await readFile(resolve('apps/notebook/app.json'), 'utf8')).backend.dependencies;
await promisify(execFile)('python3', ['-m', 'venv', pythonRoot]);
await promisify(execFile)(pythonBin, ['-m', 'pip', 'install', '--disable-pip-version-check', '--only-binary=:all:', ...dependencies], {timeout: 180000});
const notebookData = join(home, 'profile', 'app-data', 'notebook');
await mkdir(notebookData, {recursive: true});
const seed = spawn(pythonBin, ['-E', '-s', '-u', '-B', resolve('apps/notebook/backend/server.py')], {
  cwd: resolve('apps/notebook'),
  env: {...process.env, PERO_APP_DATA: notebookData, PERO_APP_TOKEN: 'seed-notebook-token', PYTHONDONTWRITEBYTECODE: '1'},
  stdio: ['ignore', 'pipe', 'pipe'],
});
let seedError = '';
seed.stderr.on('data', chunk => { seedError += chunk; });
const ready = await new Promise((done, reject) => {
  const timer = setTimeout(() => reject(new Error(`Notebook did not start: ${seedError}`)), 15000);
  createInterface({input: seed.stdout}).once('line', line => { clearTimeout(timer); done(JSON.parse(line)); });
  seed.once('exit', () => { clearTimeout(timer); reject(new Error(`Notebook exited: ${seedError}`)); });
});
const notebookURL = `http://127.0.0.1:${ready.port}`;
const request = async (path, body) => {
  const response = await fetch(notebookURL + path, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-Pero-App-Token': 'seed-notebook-token'},
    body: JSON.stringify(body),
  });
  const value = await response.json();
  assert(response.ok, JSON.stringify(value));
  return value;
};
const document = {schemaVersion: 1, title: 'Enzyme assay', content: {type: 'doc', content: [
  {type: 'heading', attrs: {blockId: 'title', level: 2}, content: [{type: 'text', text: 'Saved observations'}]},
  {type: 'paragraph', attrs: {blockId: 'observations'}, content: [{type: 'text', text: 'Sample A: 12.5 U/mL. Review pending.'}]},
]}};
const entry = await request('/api/entries', {document});
await request('/api/agent-apply', {entryId: entry.id, baseRevision: 1, operations: [
  {op: 'replace_text', blockId: 'observations', match: '12.5', replacement: '13.0'},
]});
if (seed.exitCode === null) { const exited = once(seed, 'exit'); seed.kill(); await exited; }
const provider = await notebookConversationProvider(entry.id);
const workspace = join(home, 'workspace');
await mkdir(workspace);
const settings = join(home, 'settings.json'), agents = join(home, 'agents.json');
await writeFile(agents, JSON.stringify([{id: 'notebook-conversation', name: 'Real harness / local model fixture', command: resolve('target/debug/pero-agent-acp'), args: [
  '--endpoint', provider.endpoint, '--model', 'fixture', '--session-dir', join(home, 'sessions'), '--approval', 'ask', '--max-retries', '0',
], env: {AGENT_PROVIDER_API_KEY: 'loopback-fixture-only'}}]));
await writeFile(settings, JSON.stringify({chat_agent: 'notebook-conversation', app_python: {default: pythonRoot}}));
const logs = [], errors = [];
let desktop, page;
try {
  desktop = await electron.launch({args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), resolve('desktop')], cwd: root,
    env: {...process.env, PERO_DESKTOP_DATA_DIR: join(home, 'profile'), PERO_SETTINGS_PATH: settings,
      PERO_HISTORY_PATH: join(home, 'history.jsonl'), PERO_AGENTS_FILE: agents, PERO_LOCALE: 'en'}});
  desktop.process().stderr?.on('data', data => logs.push(String(data)));
  page = await desktop.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
  await page.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).connected && !document.getElementById('loading'), undefined, {timeout: 60000});
  await page.evaluate(() => {
    window.notebookWrites = [];
    window.notebookReady = false;
    window.pero.onEvent(event => {
      if (event.kind === 'apps_catalog' && Array.isArray(event.data) && event.data.some(app => app.name === 'notebook' && app.enabled)) window.notebookReady = true;
      if (event.kind === 'app_written' && event.data?.tool === 'read-entry') window.notebookWrites.push(event.data);
    });
  });
  await page.evaluate(() => window.pero.appsCommand({action: 'apps_list'}));
  await expect.poll(() => page.evaluate(() => window.notebookReady), {timeout: 20000}).toBe(true);
  await desktop.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 1050));
  await desktop.evaluate(({dialog}, path) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [path]}); }, workspace);
  await page.evaluate(() => window.pero.chooseWorkspace());
  await expect.poll(async () => (await state()).workspace).toBe(workspace);
  const thread = 'notebook-inspector-entry';
  await page.evaluate(threadId => window.pero.sessionCommand({
    action: 'new_session', thread_id: threadId, agent_id: 'notebook-conversation', scope: {app: 'notebook', panel: 'main'},
  }), thread);
  const conversation = async () => (await state()).chats.find(chat => chat.id === thread);
  await expect.poll(async () => (await conversation())?.state, {timeout: 30000}).toBe('idle');
  await clickSessionRow(page, thread);
  await expect.poll(async () => (await state()).chats[(await state()).activeChat]?.id).toBe(thread);
  const approve = async () => {
    await expect.poll(async () => !!(await conversation()).permission, {timeout: 20000}).toBe(true);
    const index = (await conversation()).permission.options.findIndex(option => option.kind === 'allow_once');
    assert(index >= 0, 'The Host must offer allow_once');
    let bounds;
    await expect.poll(async () => { bounds = (await state()).permissionBounds.find(item => item.chat === thread && item.index === index)?.bounds; return !!bounds && bounds.width > 0 && bounds.height > 0; }, {timeout: 20000}).toBe(true);
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await expect.poll(async () => (await conversation()).permission, {timeout: 20000}).toBeNull();
  };
  const writes = () => page.evaluate(() => window.notebookWrites.length);
  await page.evaluate(({threadId, text}) => window.pero.sessionCommand({action: 'prompt', thread_id: threadId, text}), {threadId: thread, text: notebookConversationPrompt});
  await expect.poll(async () => {
    if ((await conversation())?.permission) return 'ask';
    return await page.locator('section[aria-label="Interactive tool result"] > iframe').count() ? 'mounted' : '';
  }, {timeout: 30000}).not.toBe('');
  if ((await conversation())?.permission) await approve();
  await expect.poll(async () => (await conversation()).messages.filter(message => message.role === 'assistant').map(message => message.text).join('\n'), {timeout: 30000}).toContain(notebookInitialAnswer);
  const outer = page.locator('section[aria-label="Interactive tool result"] > iframe');
  await expect(outer).toHaveCount(1);
  await expect(outer).toBeVisible();
  await expect(outer).toHaveAttribute('src', /tool_call=notebook-read-call/);
  const inline = page.frameLocator('section[aria-label="Interactive tool result"] > iframe');
  const app = inline.frameLocator('#view iframe').frameLocator('iframe');
  await expect(app.getByRole('heading', {name: 'Enzyme assay', exact: true})).toBeVisible({timeout: 20000});
  await expect(app.getByText('Sample A: 12.5 U/mL. Review pending.', {exact: true})).toBeVisible();
  await expect(app.getByText('Revision 1', {exact: true})).toBeVisible();
  await expect(app.getByText('13.0', {exact: false})).toHaveCount(0);
  assert.equal(await writes(), 1, 'mounting the Inspector called Notebook again');
  assert.equal(provider.calls.length, 2);
  const savedTool = (await conversation()).tools.find(tool => tool.id === 'notebook-read-call');
  assert(savedTool?.content?.includes('12.5'));
  assert(!savedTool.content.includes('13.0'));
  assert(savedTool.app_links.some(link => link.url === `pero-app-location://notebook/main/entry/${entry.id}/revision/1`));
  assert.ok(Buffer.byteLength(savedTool.content) < 1_000_000, 'The Notebook route response must stay inside the 1 MiB App write limit');
  await page.screenshot({path: join(evidence, 'notebook-inline-pinned.png'), scale: 'css'});
  const historyRow = async () => (await state()).mcpHistory?.find(item => item.chat === thread && item.tool === 'notebook-read-call');
  const togglePlacement = async (expanded) => {
    let bounds;
    await expect.poll(async () => {
      const row = await historyRow();
      bounds = row?.placementBounds;
      return row?.expanded === !expanded && !!bounds?.width && !!bounds?.height;
    }).toBe(true);
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await expect(outer.locator('..')).toHaveAttribute('data-expanded', String(expanded));
  };
  await outer.evaluate(frame => { frame.dataset.retained = 'yes'; });
  await app.locator('body').evaluate(body => { body.dataset.retained = 'yes'; });
  await togglePlacement(true);
  await expect(app.getByText('Revision 1', {exact: true})).toBeVisible();
  await expect(outer).toHaveAttribute('data-retained', 'yes');
  await expect(app.locator('body')).toHaveAttribute('data-retained', 'yes');
  await page.screenshot({path: join(evidence, 'notebook-workbench-pinned.png'), scale: 'css'});
  const appearance = mode => page.evaluate(value => window.pero.sessionCommand({method: 'settings.workbench',
    preferences: {...JSON.parse(window.peroDiagnostics.snapshot()).preferences, appearance: value},
  }), mode);
  await appearance('dark');
  await desktop.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 760));
  await expect(app.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => app.locator('html').evaluate(el => el.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: join(evidence, 'notebook-workbench-dark-narrow.png'), scale: 'css'});
  await desktop.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 1050));
  await appearance('light');
  await app.getByRole('button', {name: 'Browse blocks', exact: true}).evaluate(button => button.click());
  await expect.poll(async () => (await conversation())?.permission ? 'ask' : await writes() >= 2 ? 'read' : '', {timeout: 20000}).not.toBe('');
  if ((await conversation())?.permission) await approve();
  await expect(app.getByRole('button', {name: 'Read observations', exact: true})).toBeVisible({timeout: 20000});
  await expect(app.getByText('13.0', {exact: false})).toHaveCount(0);
  assert.equal(await writes(), 2);
  assert.equal(provider.calls.length, 2, 'Inspector interaction invoked the model');
  await app.getByRole('button', {name: 'Read observations', exact: true}).evaluate(button => button.click());
  await expect.poll(async () => (await conversation())?.permission ? 'ask' : await writes() >= 3 ? 'read' : '', {timeout: 20000}).not.toBe('');
  if ((await conversation())?.permission) await approve();
  await app.getByRole('button', {name: 'Add block to chat', exact: true}).click();
  await expect(app.getByText('Added to the chat draft.')).toBeVisible();
  await app.getByRole('button', {name: 'Add block to chat', exact: true}).click();
  await expect(app.getByText('Added to the chat draft.')).toBeVisible();
  await expect.poll(async () => ((await state()).composer.match(/ui:\/\/pero\/notebook\/inspector-v1/g) ?? []).length).toBe(1);
  assert.equal(provider.calls.length, 2, 'Attaching context invoked the model');
  await togglePlacement(false);
  await expect(outer).toHaveAttribute('data-retained', 'yes');
  await expect(app.locator('body')).toHaveAttribute('data-retained', 'yes');
  assert.equal(await writes(), 3, 'changing the Inspector placement called Notebook');
  // The inline iframe moves when the Inspector returns to the conversation.
  // Wait until the painted Composer is outside that iframe before typing.
  let input;
  await expect.poll(async () => {
    const bounds = (await state()).composerBounds.input;
    if (!bounds?.width || !bounds.height) return false;
    const point = {x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2};
    const reachable = await page.evaluate(({x, y}) => {
      const canvas = document.querySelector('canvas:not([data-gpui-input])');
      return !!canvas && document.elementFromPoint(x, y) === canvas;
    }, point);
    if (reachable) input = point;
    return reachable;
  }).toBe(true);
  await page.mouse.click(input.x, input.y);
  await expect.poll(async () => {
    const active = await page.evaluate(() => document.activeElement?.tagName ?? '');
    return (await state()).composerFocused && active !== 'IFRAME';
  }).toBe(true);
  await page.keyboard.press('End');
  await page.keyboard.insertText(' ' + notebookContextPrompt);
  await expect.poll(async () => (await state()).composer).toContain(notebookContextPrompt);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await conversation()).messages.some(message => message.text.includes(notebookContextAnswer)), {timeout: 30000}).toBe(true);
  await inline.getByRole('button', {name: 'Close view', exact: true}).click();
  await expect(inline.locator('#view iframe')).toHaveCount(0);
  await inline.getByRole('button', {name: 'Open view', exact: true}).click();
  await expect(app.getByText('Sample A: 12.5 U/mL. Review pending.', {exact: true})).toBeVisible({timeout: 20000});
  assert.equal(await writes(), 3, 'reopening the Inspector called Notebook');
  assert.equal(provider.calls.length, 3);
  const savedContent = savedTool.content;
  const callsBeforeRestart = await writes();
  const modelsBeforeRestart = provider.calls.length;
  const readOnlyNotice = async phase => {
    let row;
    await expect.poll(async () => { row = await historyRow(); return row?.notice; }, {timeout: 30000}).toBe('历史结果，当前不可交互');
    row = await historyRow();
    assert.equal(row.interactive, false, `${phase} stayed interactive`);
    return row;
  };
  await page.evaluate(() => window.pero.setLocale('zh-CN'));
  await expect.poll(async () => (await state()).locale).toBe('zh-CN');
  await page.evaluate(threadId => window.pero.sessionCommand({action: 'close', thread_id: threadId}), thread);
  await expect(outer).toHaveCount(0);
  const closedInProcess = await readOnlyNotice('closing the live session');
  assert.equal(closedInProcess.historical, false);
  assert.equal(closedInProcess.server, 'pero-app-use');
  assert.equal(closedInProcess.resourceUri, 'ui://pero/notebook/inspector-v1');
  assert.equal(await writes(), callsBeforeRestart);
  assert.equal(provider.calls.length, modelsBeforeRestart);
  await page.screenshot({path: join(evidence, 'notebook-history-closed-zh.png'), scale: 'css'});
  await desktop.close();
  desktop = await electron.launch({args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), resolve('desktop')], cwd: root,
    env: {...process.env, PERO_DESKTOP_DATA_DIR: join(home, 'profile'), PERO_SETTINGS_PATH: settings,
      PERO_HISTORY_PATH: join(home, 'history.jsonl'), PERO_AGENTS_FILE: agents, PERO_LOCALE: 'zh-CN'}});
  desktop.process().stderr?.on('data', data => logs.push(String(data)));
  page = await desktop.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).connected && !document.getElementById('loading'), undefined, {timeout: 60000});
  await desktop.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 1050));
  await page.evaluate(() => {
    window.notebookWrites = [];
    window.pero.onEvent(event => { if (event.kind === 'app_written' && event.data?.tool === 'read-entry') window.notebookWrites.push(event.data); });
  });
  await clickSessionRow(page, thread);
  const restoredRow = await readOnlyNotice('reopening archived history');
  assert.equal(restoredRow.historical, true);
  assert.equal(restoredRow.server, 'pero-app-use');
  assert.equal(restoredRow.resourceUri, 'ui://pero/notebook/inspector-v1');
  const restoredTool = (await state()).chats.find(chat => chat.id === thread).tools.find(tool => tool.id === 'notebook-read-call');
  assert.equal(restoredTool.content, savedContent);
  await expect(page.locator('section[aria-label="Interactive tool result"] > iframe')).toHaveCount(0);
  assert.equal(await writes(), 0, 'Restoring history called Notebook');
  assert.equal(provider.calls.length, modelsBeforeRestart);
  await page.screenshot({path: join(evidence, 'notebook-history-readonly-zh.png'), scale: 'css'});
  const afterRestart = await historyRow();
  let sourceBounds;
  await expect.poll(async () => {
    sourceBounds = (await state()).appLinkBounds.find(link => link.chat === thread &&
      link.url === `pero-app-location://notebook/main/entry/${entry.id}/revision/1`)?.bounds;
    return !!sourceBounds?.height;
  }).toBe(true);
  await page.mouse.click(sourceBounds.x + sourceBounds.width / 2, sourceBounds.y + sourceBounds.height / 2);
  const notebook = page.frameLocator('iframe[title="notebook"]');
  await expect(notebook.getByRole('heading', {level: 1, name: 'Enzyme assay'})).toBeVisible({timeout: 20000});
  await expect(notebook.getByRole('textbox', {name: '笔记正文', exact: true})).toHaveAttribute('contenteditable', 'false');
  await expect(notebook.locator('.notebook-status')).toHaveText('修订 1');
  await expect(notebook.getByText('Sample A: 12.5 U/mL. Review pending.', {exact: true})).toBeVisible();
  await expect(notebook.getByText('13.0', {exact: false})).toHaveCount(0);
  assert.equal(await writes(), 0, 'Opening the saved Notebook version called the MCP tool');
  assert.equal(provider.calls.length, modelsBeforeRestart);
  await page.screenshot({path: join(evidence, 'notebook-reopened-pinned.png'), scale: 'css'});
  assert.deepEqual(provider.errors, []);
  console.log(JSON.stringify({
    source: 'mcpHistory snapshot', entryId: entry.id, route: 'pero-app-use app__notebook__read-entry',
    callsBeforeRestart, modelsBeforeRestart, toolResultBytes: Buffer.byteLength(savedContent),
    modelRequests: provider.calls.length,
    sameProcessClose: {notice: closedInProcess.notice, interactive: closedInProcess.interactive, historical: closedInProcess.historical, server: closedInProcess.server, resourceUri: closedInProcess.resourceUri},
    afterRestart: {notice: afterRestart.notice, interactive: afterRestart.interactive, historical: afterRestart.historical, server: afterRestart.server, resourceUri: afterRestart.resourceUri},
  }));
  await writeFile(join(evidence, 'result.json'), JSON.stringify({
    passed: true, route: 'host-registered-notebook-app', entryId: entry.id, pinnedRevision: 1, laterRevision: 2,
    modelRequests: provider.calls.length, notebookReadsBeforeRestart: callsBeforeRestart,
    toolResultBytes: Buffer.byteLength(savedContent), retainedAcrossPlacement: true, contextReachedModelAfterSubmit: true, sourceReopenedAfterRestart: true,
    historyRestore: {sameProcessClose: closedInProcess, afterRestart}, errors,
  }, null, 2));
  console.log('Notebook Inspector: pinned revision mounted from the registered App tool row.');
} catch (error) {
  if (page) {
    await page.screenshot({path: join(evidence, 'failure.png'), scale: 'css'}).catch(() => {});
    await writeFile(join(evidence, 'failure-state.json'), await page.evaluate(() => window.peroDiagnostics?.snapshot() || '{}').catch(() => '{}'));
  }
  const focus = await page?.evaluate(() => ({
    composerFocused: JSON.parse(window.peroDiagnostics?.snapshot() || '{}').composerFocused,
    activeElement: document.activeElement?.tagName,
    inputConduit: document.activeElement?.getAttribute('data-gpui-input'),
    title: document.activeElement?.getAttribute?.('title') ?? null,
  })).catch(() => null);
  await writeFile(join(evidence, 'failure-log.json'), JSON.stringify({
    error: String(error), modelRequests: provider.calls.length, providerErrors: provider.errors, errors, logs, seedError, focus,
  }, null, 2));
  throw error;
} finally {
  await desktop?.close();
  await provider.close();
  await rm(home, {recursive: true, force: true});
  if (copiedTools) unlinkSync(sourceTools);
}

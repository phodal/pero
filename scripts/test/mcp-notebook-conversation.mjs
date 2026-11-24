// Real Workbench/Host/Go ACP. Notebook owns the saved revision; the tool row mounts its Inspector.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {mkdir,mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {expect} from '@playwright/test';
import {electron} from '../../tests/e2e/electron.mjs';
import {clickAppShortcut, clickSessionRow} from '../../tests/e2e/sidebar-controls.mjs';
import {notebookConversationProvider, notebookConversationPrompt, notebookInitialAnswer} from '../../tests/fixtures/mcp-app/notebook-conversation-provider.mjs';

const root = resolve(import.meta.dirname, '../..');
const html = resolve('desktop/dist/notebook-inspector.html');
await readFile(html, 'utf8');
const home = await realpath(await mkdtemp(join(tmpdir(), 'pero-notebook-conversation-')));
const evidence = resolve('test-results/mcp-notebook-conversation');
await mkdir(evidence, {recursive: true});
const notebookHome = join(home, 'notebook');
await mkdir(notebookHome);
const gate = 'isolated-notebook-token';
const backend = spawn(process.env.PERO_APP_PYTHON || 'python3', ['-u', 'apps/notebook/backend/server.py'], {
  cwd: root,
  env: {...process.env, PERO_APP_DATA: notebookHome, PERO_APP_TOKEN: gate,
    PYTHONPATH: resolve('packages/source-extraction/python')},
  stdio: ['ignore', 'pipe', 'pipe'],
});
let backendError = '';
backend.stderr.on('data', chunk => { backendError += chunk; });
const ready = await new Promise((done, reject) => {
  const timer = setTimeout(() => reject(new Error(`Notebook did not start: ${backendError}`)), 15000);
  createInterface({input: backend.stdout}).once('line', line => { clearTimeout(timer); done(JSON.parse(line)); });
  backend.once('exit', () => { clearTimeout(timer); reject(new Error(`Notebook exited: ${backendError}`)); });
});
const notebookURL = `http://127.0.0.1:${ready.port}`;
const request = async (path, body) => {
  const response = await fetch(notebookURL + path, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-Pero-App-Token': gate},
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
const provider = await notebookConversationProvider(entry.id);
const audit = join(home, 'notebook-tools.jsonl');
const workspace = join(home, 'workspace');
await mkdir(workspace);
const settings = join(home, 'settings.json'), agents = join(home, 'agents.json');
await writeFile(agents, JSON.stringify([{id: 'notebook-conversation', name: 'Real harness / local model fixture', command: resolve('target/debug/pero-agent-acp'), args: [
  '--endpoint', provider.endpoint, '--model', 'fixture', '--session-dir', join(home, 'sessions'), '--approval', 'ask', '--max-retries', '0',
], env: {AGENT_PROVIDER_API_KEY: 'loopback-fixture-only', PERO_NOTEBOOK_URL: notebookURL, PERO_NOTEBOOK_GATE: gate, PERO_NOTEBOOK_HTML: html, PERO_NOTEBOOK_AUDIT: audit}}]));
await writeFile(settings, JSON.stringify({chat_agent: 'notebook-conversation', local_mcp: {'notebook-conversation': {revision: 1, servers: [{
  name: 'Notebook', enabled: true, transport: {type: 'stdio', command: process.execPath, args: [
    resolve('tests/fixtures/mcp-app/notebook-inspector-server.mjs'),
  ]}, tool_policy: {default: 'deny', tools: {'app__notebook__read-entry': 'ask'}},
}]}}}));
const businessCalls = async () => {
  let text;
  try { text = await readFile(audit, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  return text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
};
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
  await desktop.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 1050));
  await desktop.evaluate(({dialog}, path) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [path]}); }, workspace);
  await page.evaluate(() => window.pero.chooseWorkspace());
  await expect.poll(async () => (await state()).workspace).toBe(workspace);
  await clickAppShortcut(page, 'sessions');
  await expect.poll(async () => { const snapshot = await state(); return snapshot.chats[snapshot.activeChat]?.state; }, {timeout: 30000}).toBe('idle');
  const initial = await state(), thread = initial.chats[initial.activeChat].id;
  const conversation = async () => (await state()).chats.find(chat => chat.id === thread);
  const approve = async () => {
    await expect.poll(async () => !!(await conversation()).permission, {timeout: 20000}).toBe(true);
    const index = (await conversation()).permission.options.findIndex(option => option.kind === 'allow_once');
    assert(index >= 0, 'The Host must offer allow_once');
    let bounds;
    await expect.poll(async () => { bounds = (await state()).permissionBounds.find(item => item.chat === thread && item.index === index)?.bounds; return !!bounds && bounds.width > 0 && bounds.height > 0; }, {timeout: 20000}).toBe(true);
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await expect.poll(async () => (await conversation()).permission, {timeout: 20000}).toBeNull();
  };
  await page.evaluate(({thread, text}) => window.pero.sessionCommand({action: 'prompt', thread_id: thread, text}), {thread, text: notebookConversationPrompt});
  await approve();
  await expect.poll(async () => (await conversation()).messages.filter(message => message.role === 'assistant').map(message => message.text).join('\n'), {timeout: 30000}).toContain(notebookInitialAnswer);
  const outer = page.locator('section[aria-label="Interactive tool result"] > iframe');
  await expect(outer).toHaveCount(1);
  await expect(outer).toBeVisible();
  await expect(outer).toHaveAttribute('src', /tool_call=notebook-read-call/);
  const inline = page.frameLocator('section[aria-label="Interactive tool result"] > iframe');
  const app = inline.frameLocator('#view iframe').frameLocator('iframe');
  await expect(app.getByRole('heading', {name: 'Enzyme assay', exact: true})).toBeVisible({timeout: 15000});
  await expect(app.getByText('Sample A: 12.5 U/mL. Review pending.', {exact: true})).toBeVisible();
  await expect(app.getByText('Revision 1', {exact: true})).toBeVisible();
  await expect(app.getByText('13.0', {exact: false})).toHaveCount(0);
  assert.equal((await businessCalls()).length, 1, 'mounting the Inspector replayed the Notebook read');
  assert.equal(provider.calls.length, 2);
  await page.screenshot({path: join(evidence, 'notebook-inline-pinned.png'), scale: 'css'});
  await app.getByRole('button', {name: 'Browse blocks', exact: true}).evaluate(button => button.click());
  await approve();
  await expect(app.getByRole('button', {name: 'Read observations', exact: true})).toBeVisible({timeout: 15000});
  await expect(app.getByText('13.0', {exact: false})).toHaveCount(0);
  assert.equal((await businessCalls()).length, 2, 'browsing blocks did not call the pinned revision');
  assert.equal((await businessCalls())[1].arguments.revision, 1);
  assert.equal(provider.calls.length, 2, 'Inspector interaction invoked the model');
  await inline.getByRole('button', {name: 'Close view', exact: true}).click();
  await expect(inline.locator('#view iframe')).toHaveCount(0);
  await inline.getByRole('button', {name: 'Open view', exact: true}).click();
  await expect(app.getByText('Sample A: 12.5 U/mL. Review pending.', {exact: true})).toBeVisible({timeout: 15000});
  assert.equal((await businessCalls()).length, 2, 'reopening the Inspector called Notebook');
  assert.equal(provider.calls.length, 2, 'reopening the Inspector invoked the model');
  const savedTool = (await conversation()).tools.find(tool => tool.id === 'notebook-read-call');
  assert(savedTool?.content?.includes('12.5'), 'The pinned Notebook text must be saved before restart');
  assert(!savedTool.content.includes('13.0'));
  const savedContent = savedTool.content;
  const callsBeforeRestart = (await businessCalls()).length;
  const modelsBeforeRestart = provider.calls.length;
  const historyRow = async () => (await state()).mcpHistory?.find(item => item.chat === thread && item.tool === 'notebook-read-call');
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
  assert.equal((await businessCalls()).length, callsBeforeRestart);
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
  await clickSessionRow(page, thread);
  const restoredRow = await readOnlyNotice('reopening archived history');
  assert.equal(restoredRow.historical, true);
  assert.equal(restoredRow.server, 'Notebook');
  assert.equal(restoredRow.resourceUri, 'ui://pero/notebook/inspector-v1');
  const restoredTool = (await state()).chats.find(chat => chat.id === thread).tools.find(tool => tool.id === 'notebook-read-call');
  assert.equal(restoredTool.content, savedContent);
  assert(!restoredTool.content.includes('13.0'));
  await expect(page.locator('section[aria-label="Interactive tool result"] > iframe')).toHaveCount(0);
  assert.equal((await businessCalls()).length, callsBeforeRestart);
  assert.equal(provider.calls.length, modelsBeforeRestart);
  await page.screenshot({path: join(evidence, 'notebook-history-readonly-zh.png'), scale: 'css'});
  const afterRestart = await historyRow();
  assert.deepEqual(errors, []);
  assert.deepEqual(provider.errors, []);
  const businessAfterRestart = await businessCalls();
  console.log(JSON.stringify({
    source: 'mcpHistory snapshot', entryId: entry.id, callsBeforeRestart, modelsBeforeRestart,
    businessCalls: businessAfterRestart, modelRequests: provider.calls.length,
    sameProcessClose: {notice: closedInProcess.notice, interactive: closedInProcess.interactive, historical: closedInProcess.historical},
    afterRestart: {notice: afterRestart.notice, interactive: afterRestart.interactive, historical: afterRestart.historical, server: afterRestart.server, resourceUri: afterRestart.resourceUri},
  }));
  await writeFile(join(evidence, 'result.json'), JSON.stringify({
    passed: true, entryId: entry.id, pinnedRevision: 1, laterRevision: 2,
    modelRequests: provider.calls.length, businessCalls: businessAfterRestart,
    historyRestore: {sameProcessClose: closedInProcess, afterRestart}, errors,
  }, null, 2));
  console.log('Notebook Inspector: pinned revision mounted from the Agent tool row.');
} catch (error) {
  if (page) await page.screenshot({path: join(evidence, 'failure.png'), scale: 'css'}).catch(() => {});
  await writeFile(join(evidence, 'failure-log.json'), JSON.stringify({
    error: String(error), modelRequests: provider.calls.length, providerErrors: provider.errors, errors, logs, backendError,
  }, null, 2));
  throw error;
} finally {
  await desktop?.close();
  await provider.close();
  if (backend.exitCode === null) { const exited = once(backend, 'exit'); backend.kill(); await exited; }
  await rm(home, {recursive: true, force: true});
}

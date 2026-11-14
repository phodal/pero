// Actual Electron, Rust Host, Go Harness, MCP and shell. The model is scripted
// on loopback; these receipts do not establish real-model or science acceptance.
import { expect } from '@playwright/test';
import { mkdir, mkdtemp, realpath, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { electron, focusPage } from './electron.mjs';
import { clickAppShortcut, setAppearance } from './sidebar-controls.mjs';
import { projectAgentProvider } from '../fixtures/project-agent-provider.mjs';

const root = resolve(import.meta.dirname, '../..');
const temp = await realpath(await mkdtemp(join(tmpdir(), 'pero-project-agent-ui-')));
const out = join(root, 'test-results/project-agent');
const workspace = join(temp, 'source');
await Promise.all([mkdir(out, { recursive: true }), mkdir(workspace)]);
execFileSync('git', ['init', '-q', workspace]);
await writeFile(join(workspace, 'README.md'), '# Project Agent UI acceptance\n');
execFileSync('git', ['-C', workspace, 'add', 'README.md']);
execFileSync('git', ['-C', workspace, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Seed isolated acceptance repository']);
const provider = await projectAgentProvider();
const settings = join(temp, 'settings.json');
const agents = join(temp, 'agents.json');
const projectId = 'project-agent-ui';
const projectKey = `research:${projectId}`;
await writeFile(settings, JSON.stringify({ locale: 'en', chat_agent: 'project-fixture', workbench: {
  appearance: 'light', research_projects: [{ id: projectId, title: 'Project Agent acceptance',
    goal: 'Delegate an evidence check, inspect the original work, and summarize observed results.', workspace, resources: [] }],
} }));
await writeFile(agents, JSON.stringify([{ id: 'project-fixture', name: 'Harness / scripted project model',
  command: join(root, 'target/debug/pero-agent-acp'), args: ['--endpoint', provider.endpoint, '--model', 'project-fixture',
    '--session-dir', join(temp, 'sessions'), '--workspace', workspace, '--enable-shell', '--approval', 'ask', '--max-requests', '12',
    '--max-tokens', '2048', '--max-retries', '0'], env: { AGENT_PROVIDER_API_KEY: 'loopback-fixture-only' } }]));
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: join(temp, 'desktop'), PERO_SETTINGS_PATH: settings,
  PERO_HISTORY_PATH: join(temp, 'history.jsonl'), PERO_AGENTS_FILE: agents, PERO_ENV_FILE: join(temp, 'no-env'),
  PERO_LOCALE: 'en', PERO_REQUIRED_APPS: 'scientific-viewer', PERO_BUILTIN_APPS: 'scientific-viewer', PERO_APP_INFRA_EMBED: '0' };
for (const key of ['ELECTRON_RUN_AS_NODE', 'PERO_CLOUD_URL', 'PERO_CLIENT_TOKEN', 'PERO_OPERATOR_TOKEN']) delete env[key];
let app, page;
const errors = [], checks = [];
const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
const paint = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
const snapshot = async () => (await state()).projectAgent.snapshots[projectId];
const sessions = async () => (await snapshot())?.sessions || [];
async function capture(name) { await paint(); await page.screenshot({ path: join(out, `${name}.png`) }); }
async function click(read) {
  let bounds;
  await expect.poll(async () => { bounds = await read(); return !!bounds && bounds.width > 0 && bounds.height > 0; }).toBe(true);
  const height = await page.evaluate(() => innerHeight);
  for (let attempt = 0; attempt < 12 && (bounds.y < 0 || bounds.y + bounds.height > height - 35); attempt++) {
    await page.mouse.move(Math.max(300, Math.min(bounds.x + bounds.width / 2, 800)), height / 2);
    await page.mouse.wheel(0, bounds.y < 0 ? -420 : 420);
    await paint(); bounds = await read();
  }
  await paint(); bounds = await read();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await paint();
}
const control = id => click(async () => (await state()).projectControls[id]);
async function launch() {
  app = await electron.launch({ args: ['--use-mock-keychain', join(root, 'desktop')], cwd: root, env });
  page = await app.firstWindow(); await focusPage(page);
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 1020));
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 120000 });
  await paint();
}
async function close() {
  if (!app) return;
  await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); });
  await app.close(); app = undefined;
}
async function project() {
  await clickAppShortcut(page, 'projects');
  await control(`open:${projectKey}`);
  await expect.poll(async () => (await state()).projectTab).toBe('agent');
  await expect.poll(async () => (await snapshot())?.project_id).toBe(projectId);
}
async function wideColumns(id) {
  await expect.poll(async () => {
    const s = await state(), controls = s.projectControls;
    return ['agent:conversation', 'agent:context', `agent:open:${id}`].every(key => controls[key]?.width > 0);
  }).toBe(true);
  const s = await state(), nav = s.projectControls[`agent:open:${id}`];
  const conversation = s.projectControls['agent:conversation'], context = s.projectControls['agent:context'];
  expect(nav.x + nav.width).toBeLessThanOrEqual(conversation.x + 2);
  expect(conversation.width).toBeGreaterThan(context.width);
  expect(context.x).toBeGreaterThanOrEqual(conversation.x + conversation.width - 2);
  expect(s.composerBounds.input.x).toBeGreaterThanOrEqual(conversation.x);
  expect(s.composerBounds.input.x + s.composerBounds.input.width).toBeLessThanOrEqual(context.x + 2);
}
async function open(id) {
  await expect.poll(async () => {
    const before = await state();
    if (before.chats[before.activeChat]?.id !== id) await control(`agent:open:${id}`);
    const s = await state(); return s.chats[s.activeChat]?.id;
  }).toBe(id);
}
async function draft(text) {
  await click(async () => (await state()).composerBounds.input);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  if (text) await page.keyboard.insertText(text);
  else await page.keyboard.press('Backspace');
  await expect.poll(async () => (await state()).composer).toBe(text);
}
async function submit(text) {
  const before = await state(), id = before.chats[before.activeChat].id;
  const users = before.chats[before.activeChat].messages.filter(message => message.role === 'user').length;
  await draft(text); await page.keyboard.press('Enter');
  await expect.poll(async () => (await state()).chats.find(chat => chat.id === id)?.messages.filter(message => message.role === 'user').length,
    { timeout: 30000 }).toBe(users + 1);
}
async function permissionMode(id, mode) {
  await open(id);
  await expect.poll(async () => (await state()).chats.find(chat => chat.id === id)?.state).toBe('idle');
  await click(async () => (await state()).composerBounds.permissions);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight');
  await paint(); await capture('permission-mode-menu');
  // Permission choices follow their advertised order in the shared menu.
  for (let index = 0; index < (mode === 'full-access' ? 2 : 3); index++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state()).chats.find(chat => chat.id === id)?.settings.options.find(option => option.id === 'permission')?.current).toBe(mode);
}
async function approve(id) {
  await open(id);
  await expect.poll(async () => (await state()).chats.find(chat => chat.id === id)?.permission).not.toBeNull();
  await capture(`approval-${checks.length}`);
  await click(async () => {
    const s = await state(), chat = s.chats.find(chat => chat.id === id);
    const index = chat.permission.options.findIndex(option => option.kind === 'allow_once');
    return s.permissionBounds.find(item => item.chat === id && item.index === index)?.bounds;
  });
}
async function completed(id) {
  await expect.poll(async () => {
    if (provider.errors.length) throw Error(provider.errors.join('\n'));
    return (await sessions()).find(session => session.thread_id === id)?.status;
  }, { timeout: 60000 }).toBe('completed');
}
try {
  await launch(); await project();
  await capture('01-ready-light');
  await control('agent:start');
  await expect.poll(async () => (await sessions()).length).toBe(1);
  const main = (await sessions())[0].thread_id;
  await wideColumns(main);
  checks.push('research-project-opens-central-agent-chat-with-left-navigation-and-right-materials');
  const singleLine = (await state()).composerBounds.input.height;
  await draft('Inspect the evidence.\nKeep the original files.\nExplain what remains unverified.');
  await expect.poll(async () => (await state()).composerBounds.input.height).toBeGreaterThan(singleLine * 2);
  await capture('01-multiline-composer');
  await draft('');
  await expect.poll(async () => (await state()).composerBounds.input.height).toBe(singleLine);
  checks.push('single-line-composer-expands-for-multiline-and-collapses-without-submission');
  await draft('Overview keeps the central draft');
  await control('edit');
  await expect.poll(async () => !!(await state()).researchProjects.editor).toBe(true);
  const overviewEditing = await state();
  expect(overviewEditing.projectControls['research-goal'].x).toBeGreaterThanOrEqual(overviewEditing.projectControls['agent:context'].x);
  expect(overviewEditing.composer).toBe('Overview keeps the central draft');
  await capture('01-overview-editor-right');
  await control('edit-cancel');
  await expect.poll(async () => (await state()).researchProjects.editor).toBeNull();
  expect((await state()).composer).toBe('Overview keeps the central draft');
  await control('agent:views');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state()).projectTab).toBe('tasks');
  await control('tab:project.overview');
  await wideColumns(main);
  expect((await state()).composer).toBe('Overview keeps the central draft');
  await draft('');
  checks.push('overview-edits-in-right-context-with-central-conversation-and-draft-retained');

  await permissionMode(main, 'full-access');
  expect((await sessions()).find(session => session.thread_id === main)?.error).toBeNull();
  await submit('PROJECT_DELEGATE');
  await expect.poll(async () => (await sessions()).filter(session => session.binding.parent_thread).length, { timeout: 60000 }).toBe(1);
  const child = (await sessions()).find(session => session.binding.parent_thread);
  const delegatedState = await state();
  expect(delegatedState.chats[delegatedState.activeChat].id).toBe(main);
  await approve(child.thread_id);
  await completed(child.thread_id);
  expect(child.workspace).not.toBe(workspace);
  expect(await readFile(join(child.workspace, 'evidence.txt'), 'utf8')).toContain('observed fixture evidence');
  await wideColumns(child.thread_id);
  await capture('02-child-evidence');
  checks.push('primary-MCP-delegation-and-child-shell-with-real-approval-cards');

  await open(child.thread_id); await submit('PROJECT_FOLLOWUP');
  await approve(child.thread_id);
  await expect.poll(() => readFile(join(child.workspace, 'evidence.txt'), 'utf8')).toContain('followup evidence');
  await completed(child.thread_id);
  await capture('03-followup');
  checks.push('left-child-navigation-and-shared-composer-append-to-original-session');

  await open(main); await submit('PROJECT_WAIT');
  await expect.poll(async () => (await sessions()).filter(session => session.binding.parent_thread).length).toBe(2);
  const slow = (await sessions()).find(session => session.thread_id !== child.thread_id && session.binding.parent_thread);
  await approve(slow.thread_id);
  await expect.poll(() => readFile(join(slow.workspace, 'slow-ready'), 'utf8').catch(() => '')).toBe('ready');
  await expect.poll(async () => (await sessions()).find(session => session.thread_id === slow.thread_id)?.status).toBe('running');
  await capture('04-running');
  await open(slow.thread_id);
  await click(async () => (await state()).stopButtonBounds);
  await expect.poll(async () => (await sessions()).find(session => session.thread_id === slow.thread_id)?.status, { timeout: 30000 }).toBe('cancelled');
  await capture('05-cancelled');
  checks.push('shared-composer-stop-and-confirmed-original-child-cancellation');

  await control('agent:summarize');
  await expect.poll(async () => (await sessions()).find(session => session.thread_id === main)?.result, { timeout: 30000 }).toContain('PROJECT_SUMMARY_VERIFIED');
  await completed(main);
  await expect.poll(async () => { const s = await state(); return s.chats[s.activeChat]?.id; }).toBe(main);
  const result = (await sessions()).find(session => session.thread_id === main).result;
  expect(result).toContain(child.thread_id);
  await capture('06-evidence-summary');
  checks.push('primary-summary-with-source-conversation-evidence');

  const summaryState = await state(), summaryChat = summaryState.chats.find(chat => chat.id === main);
  const summaryIndex = summaryChat.messages.findLastIndex(message => message.role === 'assistant');
  await click(async () => (await state()).artifacts?.bounds[`save-reply:${summaryIndex}`]);
  await expect.poll(async () => (await state()).artifacts?.items.length).toBe(1);
  const artifact = (await state()).artifacts.items[0];
  expect(artifact.thread_id).toBe(main);
  expect(artifact.versions[0].source_message_id).toBe(`message:${summaryIndex}`);
  expect(artifact.versions[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  await expect.poll(async () => (await state()).artifacts.open).toBe(true);
  const viewerFrame = page.locator('iframe[title="Scientific Viewer"]');
  const viewer = page.frameLocator('iframe[title="Scientific Viewer"]');
  await expect(viewer.locator(`[data-artifact-id="${artifact.id}"]`)).toBeVisible({ timeout: 60000 });
  await viewer.locator(`[data-artifact-id="${artifact.id}"]`).dblclick();
  await expect(viewer.locator('.artifact-markdown:visible')).toContainText('PROJECT_SUMMARY_VERIFIED', { timeout: 60000 });
  const artifactBounds = await viewerFrame.boundingBox(), conversationBounds = (await state()).projectControls['agent:conversation'];
  expect(artifactBounds.x).toBeGreaterThanOrEqual(conversationBounds.x + conversationBounds.width - 2);
  await capture('06-saved-summary-artifact');
  await control('agent:materials');
  await expect.poll(async () => (await state()).artifacts.open).toBe(false);
  await wideColumns(main);
  await control('agent:artifacts');
  await expect.poll(async () => (await state()).artifacts.open).toBe(true);
  if (!await viewer.locator('.artifact-markdown:visible').isVisible()) {
    await viewer.locator(`[data-artifact-id="${artifact.id}"]`).dblclick();
  }
  await expect(viewer.locator('.artifact-markdown:visible')).toContainText('PROJECT_SUMMARY_VERIFIED');
  checks.push('right-materials-and-real-versioned-artifact-switch-with-central-chat-retained');

  await open(main); await submit('PROJECT_FAIL');
  await expect.poll(async () => (await sessions()).some(session => session.binding.label === 'Failed check' && session.status === 'failed' && session.error), { timeout: 30000 }).toBe(true);
  await capture('06-provider-failure');
  checks.push('provider-failure-visible-with-original-error-and-retained-results');

  await open(child.thread_id); await draft('Preserved composer draft');
  const settingsBeforeError = await readFile(settings, 'utf8');
  await writeFile(settings, 'invalid');
  await control('agent:refresh');
  await expect.poll(async () => (await state()).projectAgent.errors[projectId]).toBeTruthy();
  expect((await state()).composer).toBe('Preserved composer draft');
  expect((await sessions()).some(session => session.thread_id === child.thread_id)).toBe(true);
  await capture('06-refresh-error-retains-draft');
  await writeFile(settings, settingsBeforeError); await control('agent:refresh');
  await expect.poll(async () => (await state()).projectAgent.errors[projectId]).toBeUndefined();
  await open(main); await open(child.thread_id);
  expect((await state()).composer).toBe('Preserved composer draft');
  checks.push('refresh-failure-and-left-navigation-retain-shared-composer-draft-and-content');

  await setAppearance(page, 'dark'); await capture('07-dark');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 740));
  await capture('08-narrow-dark');
  expect((await state()).composer).toBe('Preserved composer draft');
  await control('agent:materials');
  await expect.poll(async () => (await state()).projectControls['agent:context']?.width).toBeGreaterThan(0);
  await capture('08-narrow-materials-dark');
  await control('agent:context-close');
  await expect.poll(async () => (await state()).projectControls['agent:conversation']?.width).toBeGreaterThan(0);
  expect((await state()).composer).toBe('Preserved composer draft');
  await open(main); await open(child.thread_id);
  expect((await state()).composer).toBe('Preserved composer draft');
  checks.push('dark-narrow-shared-chat-keeps-draft-and-project-session-navigation');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 1020));
  await setAppearance(page, 'light');
  const ids = (await sessions()).map(session => session.thread_id);
  await close(); await launch();
  await expect.poll(async () => (await state()).projectTab, {timeout:30000}).toBe('agent');
  await expect.poll(async () => (await state()).projectControls['agent:context']?.width).toBeGreaterThan(0);
  await expect.poll(async () => (await snapshot())?.project_id).toBe(projectId);
  expect((await sessions()).map(session => session.thread_id)).toEqual(ids);
  await open(main);
  await expect.poll(async () => (await state()).artifacts?.items.some(item => item.id === artifact.id)).toBe(true);
  expect((await state()).artifacts.items.find(item => item.id === artifact.id).versions[0].sha256).toBe(artifact.versions[0].sha256);
  await open(child.thread_id);
  const restoredMessages = (await state()).chats.find(chat => chat.id === child.thread_id).messages;
  expect(restoredMessages.length).toBeGreaterThan(0);
  const historyBeforeResume = (await readFile(join(temp, 'history.jsonl'), 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
  const originalAcp = historyBeforeResume.find(event => event.kind === 'session_ready' && event.thread_id === child.thread_id).data.sessionId;
  await submit('PROJECT_FOLLOWUP'); await approve(child.thread_id);
  await expect.poll(async () => (await readFile(join(child.workspace, 'evidence.txt'), 'utf8')).split('followup evidence')).toHaveLength(3);
  await completed(child.thread_id);
  const resumedMessages = (await state()).chats.find(chat => chat.id === child.thread_id).messages;
  expect(resumedMessages.slice(0, restoredMessages.length)).toEqual(restoredMessages);
  expect(resumedMessages).toHaveLength(restoredMessages.length + 2);
  expect((await readFile(join(child.workspace, 'evidence.txt'), 'utf8')).split('followup evidence')).toHaveLength(3);
  const historyAfterResume = (await readFile(join(temp, 'history.jsonl'), 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
  expect(historyAfterResume.filter(event => event.kind === 'session_ready' && event.thread_id === child.thread_id).at(-1).data.sessionId).toBe(originalAcp);
  await capture('09-restored-original-conversations');
  checks.push('restart-restores-project-navigation-artifact-and-composer-resumes-exact-original-ACP-session');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1920, 1181));
  await paint();
  await capture('10-cursor-comparison-wide');
  expect(errors).toEqual([]);
  await writeFile(join(out, 'results.json'), JSON.stringify({ scope: 'Electron L1 / scripted model / actual shell and MCP',
    checks, errors, artifact, sessions: await sessions(), calls: provider.calls.length, temp,
    history: (await readFile(join(temp, 'history.jsonl'), 'utf8')).split('\n').filter(Boolean).length }, null, 2));
  console.log(JSON.stringify({ checks, output: out, temp }, null, 2));
} catch (error) {
  if (page) { await capture('failure').catch(() => {}); await writeFile(join(out, 'failure.json'), JSON.stringify({ error: String(error), state: await state().catch(() => null), providerErrors: provider.errors, temp }, null, 2)); }
  throw error;
} finally { await close(); await provider.close(); }

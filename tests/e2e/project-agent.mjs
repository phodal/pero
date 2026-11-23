// Actual Electron, Rust Host, Go Harness, MCP and shell. The model is scripted
// on loopback; these receipts do not establish real-model or science acceptance.
import { expect } from '@playwright/test';
import { mkdir, mkdtemp, realpath, readFile, unlink, writeFile } from 'node:fs/promises';
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
const notes = join(workspace, 'notes.txt');
const frozenNotes = 'PROJECT_FIRST_TURN_FROZEN_EVIDENCE';
const roadmapTask = 'Check the linked project evidence';
await Promise.all([mkdir(out, { recursive: true }), mkdir(workspace)]);
execFileSync('git', ['init', '-q', workspace]);
await writeFile(join(workspace, 'README.md'), '# Project Agent UI acceptance\n');
await writeFile(join(workspace, 'ROADMAP.md'), `- [ ] ${roadmapTask}\n`);
await writeFile(notes, frozenNotes);
execFileSync('git', ['-C', workspace, 'add', 'README.md', 'ROADMAP.md', 'notes.txt']);
execFileSync('git', ['-C', workspace, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Seed isolated acceptance repository']);
const provider = await projectAgentProvider();
const settings = join(temp, 'settings.json');
const agents = join(temp, 'agents.json');
const startupFailure = join(temp, 'fail-agent-start');
const projectId = 'project-agent-ui';
const projectKey = `research:${projectId}`;
const secondProjectId = 'project-agent-ui-second';
const secondDraft = 'A distinct draft for the second project';
const secondGoal = 'Keep this investigation separate.';
await writeFile(settings, JSON.stringify({ locale: 'en', chat_agent: 'project-fixture', workbench: {
  appearance: 'light', research_projects: [{ id: projectId, title: 'Project Agent acceptance',
    goal: 'Delegate an evidence check, inspect the original work, and summarize observed results.', workspace, resources: [] },
  { id: secondProjectId, title: 'Second research project', goal: secondGoal, resources: [] }],
} }));
await writeFile(agents, JSON.stringify([{ id: 'project-fixture', name: 'Harness / scripted project model',
  command: '/bin/sh', args: ['-c', 'if [ -e "$1" ]; then exit 70; fi; shift; exec "$@"',
    'project-agent-fixture', startupFailure, join(root, 'target/debug/pero-agent-acp'),
    '--endpoint', provider.endpoint, '--model', 'project-fixture',
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
const snapshot = async (id = projectId) => (await state()).projectAgent.snapshots[id];
const sessions = async id => (await snapshot(id))?.sessions || [];
async function capture(name) { await paint(); await page.screenshot({ path: join(out, `${name}.png`) }); }
async function click(read) {
  let bounds;
  await expect.poll(async () => { bounds = await read(); return !!bounds && bounds.width > 0 && bounds.height > 0; }).toBe(true);
  const {height, width} = await page.evaluate(() => ({height:innerHeight,width:innerWidth}));
  for (let attempt = 0; attempt < 12 && (bounds.y < 0 || bounds.y + bounds.height > height - 35); attempt++) {
    await page.mouse.move(Math.max(1, Math.min(bounds.x + bounds.width / 2, width - 1)), height / 2);
    await page.mouse.wheel(0, bounds.y < 0 ? -420 : 420);
    await paint(); bounds = await read();
  }
  await paint(); bounds = await read();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await paint();
}
const control = id => click(async () => (await state()).projectControls[id]);
async function showProjectInspector() {
  if (!((await state()).projectControls['agent:context']?.width > 0)) {
    await control('agent:materials');
    await expect.poll(async () => (await state()).projectControls['agent:context']?.width || 0).toBeGreaterThan(0);
  }
}
async function rightTab(key, tab, fromMenu = false) {
  const controls = (await state()).projectControls;
  const button = controls[`tab:${key}`];
  const toolbar = controls['agent:context-toolbar'];
  const overflow = controls['agent:views-overflow'];
  const fullyVisible = button?.width > 0 && button.x >= toolbar.x && button.x + button.width <= overflow.x;
  if (fullyVisible && !fromMenu) {
    await control(`tab:${key}`);
  } else {
    await control('agent:views-overflow');
    await control(`agent:views-select:${key}`);
  }
  await expect.poll(async () => (await state()).projectTab).toBe(tab);
}
async function launch() {
  app = await electron.launch({ args: ['--use-mock-keychain', join(root, 'desktop')], cwd: root, env });
  page = await app.firstWindow(); await focusPage(page);
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 1020));
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 120000 });
  await paint();
}
async function resize(width, height) {
  const size = await app.evaluate(({ BrowserWindow }, [width, height]) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setSize(width, height);
    return window.getContentSize();
  }, [width, height]);
  await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual(size);
  await paint();
}
async function close() {
  if (!app) return;
  await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); });
  await app.close(); app = undefined;
}
async function project(id = projectId) {
  const key = `research:${id}`;
  await control(`sidebar:open:${key}`);
  await expect.poll(async () => (await state()).selectedProject).toBe(key);
  await expect.poll(async () => {
    const { projectAgent } = await state();
    return projectAgent.snapshots[id]?.project_id === id && !projectAgent.loading.includes(id);
  }).toBe(true);
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
async function sendDraft() {
  await click(async () => (await state()).composerBounds.input);
  await page.keyboard.press('Enter');
}
async function chooseContext(label) {
  await expect.poll(async () => {
    const { completion } = await state();
    return !completion.loading && completion.items.includes(label);
  }).toBe(true);
  const { completion } = await state();
  const count = completion.items.length;
  const steps = (completion.items.indexOf(label) - completion.selected + count) % count;
  for (let i = 0; i < steps; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state()).attachments).toEqual([label]);
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
async function completed(id, project = projectId) {
  await expect.poll(async () => {
    if (provider.errors.length) throw Error(provider.errors.join('\n'));
    return (await sessions(project)).find(session => session.thread_id === id)?.status;
  }, { timeout: 60000 }).toBe('completed');
}
try {
  await launch(); await project();
  expect((await state()).remote.state.configured).toBe(false);
  expect((await state()).projectTab).toBe('overview');
  expect(await sessions()).toHaveLength(0);
  await capture('01-ready-light');

  const firstPrompt = 'PROJECT_FIRST_TURN: Read this frozen note';
  await draft(`${firstPrompt} @file notes`);
  await chooseContext('notes.txt');
  const firstDraft = (await state()).composer;
  await project(secondProjectId);
  expect((await state()).composer).toBe('');
  expect((await state()).attachments).toEqual([]);
  await draft(secondDraft);
  await project();
  expect((await state()).composer).toBe(firstDraft);
  expect((await state()).attachments).toEqual(['notes.txt']);
  await project(secondProjectId);
  expect((await state()).composer).toBe(secondDraft);
  await project();
  expect(await sessions()).toHaveLength(0);
  expect((await state()).projectAgent.snapshots[secondProjectId].sessions).toHaveLength(0);
  expect(provider.calls).toHaveLength(0);
  checks.push('local-project-sidebar-switches-between-two-independent-unstarted-drafts');

  const validSettings = await readFile(settings, 'utf8');
  await writeFile(settings, 'invalid');
  await sendDraft();
  await expect.poll(async () => (await state()).projectAgent.errors[projectId]).toBeTruthy();
  expect((await state()).composer).toBe(firstDraft);
  expect((await state()).attachments).toEqual(['notes.txt']);
  expect(await sessions()).toHaveLength(0);
  expect(provider.calls).toHaveLength(0);
  await writeFile(settings, validSettings);
  await control('agent:refresh');
  await expect.poll(async () => {
    const { projectAgent } = await state();
    return !projectAgent.errors[projectId] && !projectAgent.loading.includes(projectId);
  }).toBe(true);
  checks.push('first-submit-host-failure-keeps-text-and-frozen-reference-for-retry');

  await writeFile(notes, 'PROJECT_FIRST_TURN_CHANGED_AFTER_SELECTION');
  await capture('01-first-draft-with-reference');
  await sendDraft();
  await expect.poll(async () => (await sessions()).length).toBe(1);
  const main = (await sessions())[0].thread_id;
  await completed(main);
  await expect.poll(async () => {
    const s = await state();
    return s.chats[s.activeChat]?.id;
  }).toBe(main);
  const firstChat = (await state()).chats.find(chat => chat.id === main);
  expect(firstChat.messages.filter(message => message.role === 'user').map(message => message.text)).toEqual([firstDraft.trim()]);
  const firstRequests = provider.calls.filter(call => call.messages.some(message =>
    message.role === 'user' && JSON.stringify(message.content).includes(firstPrompt)));
  expect(firstRequests).toHaveLength(1);
  const firstUser = firstRequests[0].messages.findLast(message => message.role === 'user');
  const firstInput = typeof firstUser.content === 'string'
    ? firstUser.content
    : firstUser.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
  expect(firstInput.startsWith(firstPrompt)).toBe(true);
  expect(firstInput).toContain(frozenNotes);
  expect(firstInput).not.toContain('PROJECT_FIRST_TURN_CHANGED_AFTER_SELECTION');
  const instructions = firstInput.indexOf("\n\nHost Project Agent instructions\nYou are this Project's primary Agent.");
  const projectContext = firstInput.indexOf('\n\nProject context (data)\n');
  expect(instructions).toBeGreaterThan(firstInput.indexOf(frozenNotes));
  expect(projectContext).toBeGreaterThan(instructions);
  expect(firstInput.slice(projectContext)).toContain(projectId);
  expect(firstInput.slice(projectContext)).toContain('Delegate an evidence check');
  expect(firstInput).not.toContain('Host-mounted App Agent Plugin instructions:');
  const systemInput = firstRequests[0].messages.find(message => message.role === 'system')?.content;
  expect(systemInput).not.toContain('Host Project Agent instructions');
  expect(systemInput).not.toContain('Delegate an evidence check');
  await writeFile(notes, frozenNotes);
  checks.push('first-project-submit-binds-primary-once-and-sends-frozen-composer-reference');
  checks.push('model-input-separates-user-turn-coordinator-instructions-and-project-context');

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
  const originalGoal = (await state()).preferences.research_projects.find(project => project.id === projectId).goal;
  await control('edit');
  await expect.poll(async () => !!(await state()).researchProjects.editor).toBe(true);
  const overviewEditing = await state();
  expect(overviewEditing.projectControls['research-goal'].x).toBeGreaterThanOrEqual(overviewEditing.projectControls['agent:context'].x);
  expect(overviewEditing.composer).toBe('Overview keeps the central draft');
  await capture('01-overview-editor-right');
  const editedGoal = 'Unsaved Project goal to retain when the view closes.';
  await control('research-goal');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText(editedGoal);
  await expect.poll(async () => (await state()).researchProjects.editor?.goal).toBe(editedGoal);
  await control('agent:context-close');
  await expect.poll(async () => (await state()).projectControls['agent:context']?.width || 0).toBe(0);
  await showProjectInspector();
  expect((await state()).researchProjects.editor?.goal).toBe(editedGoal);
  await control('agent:close');
  await expect.poll(async () => (await state()).contentTabs.some(item => item.kind === 'project' && item.value === projectKey)).toBe(false);
  await project(secondProjectId);
  await showProjectInspector();
  await control('edit');
  await expect.poll(async () => (await state()).researchProjects.editor?.goal).toBe(secondGoal);
  await control('edit-cancel');
  await project();
  await showProjectInspector();
  await expect.poll(async () => (await state()).researchProjects.editor?.goal).toBe(editedGoal);
  await capture('01-restored-unsaved-goal');
  await control('edit-cancel');
  await expect.poll(async () => (await state()).researchProjects.editor).toBeNull();
  expect((await state()).preferences.research_projects.find(project => project.id === projectId).goal).toBe(originalGoal);
  expect((await state()).composer).toBe('Overview keeps the central draft');
  checks.push('unsaved-goal-is-retained-by-project-across-pane-and-tab-close-with-explicit-cancel');
  for (const [key, tab] of [['nav.tasks', 'tasks'], ['research.linked', 'research_resources'],
    ['project.sources', 'sources'], ['project.execution', 'execution'],
    ['settings.title', 'settings'], ['project.overview', 'overview']]) {
    await rightTab(key, tab, tab === 'settings');
    const s = await state();
    expect(s.chats[s.activeChat]?.id).toBe(main);
    expect(s.composer).toBe('Overview keeps the central draft');
    expect(s.composerBounds.input.x).toBeLessThan(s.projectControls['agent:context'].x);
    if (tab === 'tasks') {
      await expect.poll(async () => (await state()).localRoadmap.data?.items.some(item => item.title === roadmapTask)).toBe(true);
      await capture('01-right-tasks-with-central-draft');
    }
  }
  await rightTab('nav.tasks', 'tasks');
  await project(secondProjectId);
  expect((await state()).projectTab).toBe('overview');
  expect((await state()).composer).toBe(secondDraft);
  await project();
  expect((await state()).projectTab).toBe('tasks');
  const beforeHide = (await state()).projectControls['agent:conversation'].width;
  await control('agent:context-close');
  await expect.poll(async () => (await state()).projectControls['agent:context']?.width || 0).toBe(0);
  const hidden = await state();
  expect(hidden.projectControls['agent:conversation'].width).toBeGreaterThan(beforeHide);
  expect(hidden.chats[hidden.activeChat]?.id).toBe(main);
  expect(hidden.composer).toBe('Overview keeps the central draft');
  await capture('01-project-inspector-closed');
  await showProjectInspector();
  expect((await state()).projectTab).toBe('tasks');
  expect((await state()).composer).toBe('Overview keeps the central draft');
  await capture('01-project-inspector-reopened');
  await rightTab('project.overview', 'overview');
  await wideColumns(main);
  expect((await state()).composer).toBe('Overview keeps the central draft');
  await control('agent:close');
  await expect.poll(async () => (await state()).contentTabs.some(item => item.kind === 'project' && item.value === projectKey)).toBe(false);
  await project();
  const mouseReopened = await state();
  expect(mouseReopened.chats[mouseReopened.activeChat]?.id).toBe(main);
  expect(mouseReopened.composer).toBe('Overview keeps the central draft');
  await capture('01-project-tab-reopened');

  await clickAppShortcut(page, 'scientific-viewer');
  await expect.poll(async () => (await state()).activeApp?.name).toBe('scientific-viewer');
  const appState = await state();
  const appPane = appState.workspaceNavigation.panes.root;
  expect(appPane.kind).toBe('leaf');
  const appView = appPane.view.tabs.items.find(item => item.route.value?.value?.name === 'scientific-viewer');
  expect(appView).toBeTruthy();
  await project();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+w' : 'Control+w');
  await expect.poll(async () => (await state()).contentTabs.some(item => item.kind === 'project' && item.value === projectKey)).toBe(false);
  expect((await state()).activeContent?.value).not.toBe(projectKey);
  expect((await state()).workspaceNavigation.panes.root.view.tabs.items).toContainEqual(appView);
  await clickAppShortcut(page, 'scientific-viewer');
  await expect.poll(async () => (await state()).activeContent).toEqual(appState.activeContent);
  await project();
  const keyboardReopened = await state();
  expect(keyboardReopened.chats[keyboardReopened.activeChat]?.id).toBe(main);
  expect(keyboardReopened.composer).toBe('Overview keeps the central draft');
  await draft('');
  checks.push('independent-right-tabs-and-goal-edit-retain-central-conversation-and-draft');
  checks.push('wide-inspector-close-and-reopen-retains-task-view-and-central-draft');
  checks.push('project-tab-click-and-shortcut-close-only-the-view-and-retain-draft-and-hidden-app-pane');

  const longGoal = Array.from({length:40}, (_, i) => `Evidence check ${i}: inspect the original record and keep linked materials reachable.`).join('\n');
  async function saveGoal(goal) {
    await control('edit'); await control('research-goal');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.insertText(goal); await control('save');
    await expect.poll(async () => (await state()).researchProjects.editor).toBeNull();
    await expect.poll(async () => (await state()).preferences.research_projects.find(project => project.id === projectId).goal).toBe(goal);
  }
  await saveGoal(longGoal);
  await resize(920, 740);
  await showProjectInspector();
  await rightTab('research.linked', 'research_resources');
  await control('link');
  const reachableLink = (await state()).projectControls.link;
  expect(reachableLink.y).toBeGreaterThan(40);
  expect(reachableLink.y + reachableLink.height).toBeLessThan(705);
  await capture('01-long-goal-materials-reachable');
  await control('link');
  await resize(1500, 1020);
  await showProjectInspector();
  await rightTab('project.overview', 'overview');
  await saveGoal(originalGoal);
  await wideColumns(main);
  checks.push('materials-remain-reachable-with-long-goal-at-minimum-window-height');

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
  const childState = await state();
  const childReply = childState.readableReplies.find(reply => reply.chat === child.thread_id);
  expect(childReply.text).toContain('execution evidence');
  expect(childReply.text).not.toContain('readIsolated');
  expect(childState.chats.find(chat => chat.id === child.thread_id).messages.at(-1).text).toContain('readIsolated');
  const tool = childState.toolBounds.find(tool => tool.chat === child.thread_id);
  const toolKey = `${child.thread_id}/${tool.tool}`;
  expect(childState.expandedTools).not.toContain(toolKey);
  await capture('02-child-evidence');
  await click(async () => (await state()).toolBounds.find(item => item.chat === child.thread_id && item.tool === tool.tool)?.bounds);
  await expect.poll(async () => (await state()).expandedTools.includes(toolKey)).toBe(true);
  await capture('02-expanded-execution-evidence');
  await click(async () => (await state()).toolBounds.find(item => item.chat === child.thread_id && item.tool === tool.tool)?.bounds);
  await expect.poll(async () => (await state()).expandedTools.includes(toolKey)).toBe(false);
  checks.push('raw-tool-echo-is-readable-by-default-with-original-reply-and-expandable-evidence-retained');
  checks.push('primary-MCP-delegation-and-child-shell-with-real-approval-cards');

  await open(child.thread_id); await submit('PROJECT_FOLLOWUP');
  await approve(child.thread_id);
  await expect.poll(() => readFile(join(child.workspace, 'evidence.txt'), 'utf8')).toContain('followup evidence');
  await completed(child.thread_id);
  await capture('03-followup');
  checks.push('left-child-navigation-and-shared-composer-append-to-original-session');
  await project();
  await expect.poll(async () => {
    const s = await state();
    return s.chats[s.activeChat]?.id;
  }).toBe(main);
  checks.push('clicking-the-project-row-returns-from-a-child-to-its-main-coordinator');

  await submit('PROJECT_WAIT');
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
  await resize(1100, 830);
  await expect.poll(async () => {
    const s = await state();
    const resourcesClose = s.artifacts.bounds.close;
    const projectClose = s.projectControls['agent:close'];
    return resourcesClose?.width > 0 && projectClose?.width > 0
      && resourcesClose.y < s.projectControls['agent:conversation'].y
      && resourcesClose.x > projectClose.x;
  }).toBe(true);
  const medium = await state(), mediumPreview = await viewerFrame.boundingBox();
  const mediumConversation = medium.projectControls['agent:conversation'];
  expect(medium.chats[medium.activeChat]?.id).toBe(main);
  expect(medium.projectControls['agent:context']?.width || 0).toBe(0);
  expect(mediumPreview.x).toBeGreaterThanOrEqual(mediumConversation.x + mediumConversation.width - 2);
  expect(medium.artifacts.bounds.close.y + medium.artifacts.bounds.close.height).toBeLessThanOrEqual(mediumPreview.y);
  await capture('06-midwidth-artifact-titlebar');
  await resize(1500, 1020);
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
  checks.push('midwidth-artifact-owns-right-titlebar-and-keeps-the-project-conversation-visible');

  await open(main); await submit('PROJECT_FAIL');
  await expect.poll(async () => (await sessions()).some(session => session.binding.label === 'Failed check' && session.status === 'failed' && session.error), { timeout: 30000 }).toBe(true);
  await capture('06-provider-failure');
  const projectChildren = (await sessions()).filter(session => session.binding.parent_thread);
  await clickAppShortcut(page, 'projects');
  await expect.poll(async () => (await state()).projectControls[`open:${projectKey}`]?.width || 0).toBeGreaterThan(0);
  await capture('06-clean-project-catalog');
  for (const child of projectChildren) expect((await state()).projectControls[`open:workspace:${child.workspace}`]?.width || 0).toBe(0);
  await control(`open:${projectKey}`);
  await showProjectInspector();
  await wideColumns(main);
  checks.push('project-catalog-excludes-delegated-workspaces-and-keeps-saved-project-entry');
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

  await project(secondProjectId);
  expect((await state()).composer).toBe(secondDraft);
  const beforeStartupFailure = provider.calls.length;
  await writeFile(startupFailure, '');
  await sendDraft();
  await expect.poll(async () => {
    const s = await state();
    const failed = s.projectAgent.snapshots[secondProjectId].sessions[0];
    return failed?.status === 'failed' && s.retryButtonBounds?.width > 0;
  }, { timeout: 30000 }).toBe(true);
  const failed = (await sessions(secondProjectId))[0].thread_id;
  expect((await state()).composer).toBe(secondDraft);
  expect(provider.calls).toHaveLength(beforeStartupFailure);
  const failedEvents = (await readFile(join(temp, 'history.jsonl'), 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
  expect(failedEvents.some(event => event.thread_id === failed && event.kind === 'session_ready')).toBe(false);
  await capture('06-first-acp-start-failure-with-draft');
  await unlink(startupFailure);
  await click(async () => (await state()).retryButtonBounds);
  await expect.poll(async () => {
    const chat = (await state()).chats.find(chat => chat.id === failed);
    return chat && { state: chat.state, error: chat.error };
  }, { timeout: 30000 }).toEqual({ state: 'idle', error: null });
  expect((await sessions(secondProjectId)).map(session => session.thread_id)).toEqual([failed]);
  expect((await state()).composer).toBe(secondDraft);
  expect(provider.calls).toHaveLength(beforeStartupFailure);
  await sendDraft();
  await completed(failed, secondProjectId);
  expect((await state()).chats.find(chat => chat.id === failed).messages.filter(message => message.role === 'user')
    .map(message => message.text)).toEqual([secondDraft]);
  expect(provider.calls).toHaveLength(beforeStartupFailure + 1);
  await capture('06-first-acp-start-retried-in-original-project');
  checks.push('failed-acp-initialize-retains-draft-and-explicit-retry-opens-same-primary-before-one-send');
  await project();
  await open(child.thread_id);

  await setAppearance(page, 'dark'); await capture('07-dark');
  await resize(920, 740);
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
  await resize(1500, 1020);
  await setAppearance(page, 'light');
  const ids = (await sessions()).map(session => session.thread_id);
  await close(); await launch();
  await expect.poll(async () => (await state()).selectedProject, {timeout:30000}).toBe(projectKey);
  await expect.poll(async () => (await state()).projectControls['agent:context']?.width).toBeGreaterThan(0);
  await expect.poll(async () => (await snapshot())?.project_id).toBe(projectId);
  expect((await sessions()).map(session => session.thread_id)).toEqual(ids);
  await open(main);
  await expect.poll(async () => (await state()).artifacts?.items.some(item => item.id === artifact.id)).toBe(true);
  expect((await state()).artifacts.items.find(item => item.id === artifact.id).versions[0].sha256).toBe(artifact.versions[0].sha256);
  await open(child.thread_id);
  const restoredMessages = (await state()).chats.find(chat => chat.id === child.thread_id).messages;
  expect((await state()).readableReplies.filter(reply => reply.chat === child.thread_id).every(reply => !reply.text.includes('readIsolated'))).toBe(true);
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
  await resize(1920, 1181);
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

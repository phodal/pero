// Real Electron/Host and App backends, with synthetic records seeded only through
// their existing APIs. No model, remote service, solver or physical experiment runs.
import { expect } from '@playwright/test';
import { electron, focusPage } from './electron.mjs';
import { clickAppShortcut, setAppearance } from './sidebar-controls.mjs';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const temp = await realpath(await mkdtemp(resolve(tmpdir(), 'pero-research-projects-')));
const out = resolve(root, process.env.PERO_RESEARCH_TEST_OUTPUT || 'test-results/research-projects');
await mkdir(out, { recursive: true });
const settings = resolve(temp, 'settings.json');
const agents = resolve(temp, 'agents.json');
const pythonEnv = process.env.PERO_RESEARCH_TEST_PYTHON_ENV;
await writeFile(settings, JSON.stringify({
  locale: 'en', workbench: { appearance: 'light' },
  app_python: pythonEnv ? { default: resolve(pythonEnv) } : undefined,
}));
await writeFile(agents, JSON.stringify(['pero', 'codex', 'claude', 'copilot', 'grok', 'qoder', 'opencode'].map(id => ({
  id, name: id, command: resolve(temp, `unavailable-${id}`),
}))));
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(temp, 'desktop'), PERO_SETTINGS_PATH: settings,
  PERO_HISTORY_PATH: resolve(temp, 'history.jsonl'), PERO_AGENTS_FILE: agents, PERO_LOCALE: 'en',
  PERO_BUILTIN_APPS: 'paper-agent,control-lab,lab', PERO_REQUIRED_APPS: 'paper-agent,control-lab,lab', PERO_APP_INFRA_EMBED: '0' };
for (const key of ['ELECTRON_RUN_AS_NODE', 'PERO_CLOUD_URL', 'PERO_CLIENT_TOKEN', 'PERO_OPERATOR_TOKEN', 'PERO_APPS_ROOT']) delete env[key];
let app, page;
const errors = [], checks = [], seeds = {};
let projectId, projectKey;
const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
const frames = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
const capture = async name => { await frames(); await page.screenshot({ path: resolve(out, `${name}.png`) }); };
const savedProject = async () => (await state()).preferences.research_projects.find(item => item.id === projectId);
async function hideReadyBanner() {
  const hide = page.getByRole('button', { name: 'Hide', exact: true });
  if (await hide.isVisible()) await hide.click();
}
async function launch() {
  app = await electron.launch({ args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), resolve(root, 'desktop')], cwd: root, env });
  page = await app.firstWindow(); await focusPage(page);
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1488, 1000));
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 120000 });
  await expect.poll(async () => {
    const apps = (await state()).apps;
    return ['paper-agent', 'control-lab', 'lab'].every(name => apps.some(item => item.name === name && item.enabled));
  }, { timeout: 120000 }).toBe(true);
  await hideReadyBanner();
  await frames();
}
async function close() { await app.close(); app = undefined; }
async function clickControl(id) {
  let bounds;
  await expect.poll(async () => {
    bounds = (await state()).projectControls?.[id];
    return !!bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) && bounds.width > 0 && bounds.height > 0;
  }).toBe(true);
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await frames();
}
async function fillControl(id, text) {
  await clickControl(id);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText(text);
}
async function projectOverview() {
  await clickAppShortcut(page, 'projects');
  await clickControl(`open:${projectKey}`);
  await expect.poll(async () => (await state()).selectedProject).toBe(projectKey);
  await expect.poll(async () => (await state()).projectTab).toBe('overview');
  await expect.poll(async () => (await state()).researchProjects.loading).toEqual([]);
}
async function openApp(name) {
  await clickAppShortcut(page, name);
  await expect.poll(async () => (await state()).activeApp?.name).toBe(name);
  const frame = page.frameLocator(`iframe[title="${name}"]`);
  await expect(frame.locator('body')).toBeAttached({ timeout: 120000 });
  if (name === 'paper-agent') await expect(frame.getByRole('button', { name: 'Add papers', exact: true }).first()).toBeVisible({ timeout: 120000 });
  else await expect(frame.getByRole('heading', { name: name === 'lab' ? 'Lab' : 'Control Lab', exact: true }).first()).toBeVisible({ timeout: 120000 });
  return frame;
}
async function api(frame, path, data) {
  return frame.locator('body').evaluate(async (_body, { path, data }) => {
    const response = await fetch(path, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const value = await response.json();
    if (!response.ok) throw Error(value.detail || value.error || `App API failed (${response.status})`);
    return value;
  }, { path, data });
}
async function attach(name, id, count) {
  if (!(await state()).researchProjects.choosing) await clickControl('link');
  await clickControl(`catalog:${name}`);
  await expect.poll(async () => (await state()).researchProjects.catalogs[name]?.resources.some(item => item.reference.id === id), { timeout: 120000 }).toBe(true);
  await clickControl(`attach:${name}:${id}`);
  await expect.poll(async () => (await savedProject()).resources.length).toBe(count);
  await expect.poll(async () => (await state()).researchProjects.saving).toBe(false);
  expect((await state()).projectTab).toBe('research_resources');
  await expect.poll(async () => (await state()).researchProjects.loading).toEqual([]);
  await clickControl('link');
}
try {
  await launch();
  expect((await state()).remote.state.configured).toBe(false);
  // Explicit fixture data uses the real owning App stores; no project association exists yet.
  let frame = await openApp('paper-agent');
  seeds.paper = await api(frame, '/api/papers/import', { title: 'Synthetic control evidence', sourceId: 'research-project-fixture',
    url: 'https://example.invalid/research-project-fixture', authors: ['Fixture'], contentKind: 'full-text',
    content: '# Synthetic control evidence\n\nThis is a synthetic source used only to verify project links. It establishes no scientific claim.' });
  frame = await openApp('control-lab');
  seeds.control = await api(frame, '/api/experiments', { templateId: 'p-golden', candidateBudget: 1 });
  frame = await openApp('lab');
  seeds.lab = await api(frame, '/api/experiments', { objective: 'Synthetic mixing study', target_fraction: 0.5, tolerance: 0.05, max_trials: 2 });
  expect(seeds.control.trials).toEqual([]); expect(seeds.lab.trials).toEqual([]);
  await hideReadyBanner();
  checks.push('real-app-backend-synthetic-records-without-execution');

  await clickAppShortcut(page, 'projects');
  await clickControl('new');
  await clickControl('save');
  await expect.poll(async () => (await state()).researchProjects.error).not.toBeNull();
  expect((await state()).preferences.research_projects).toEqual([]);
  await fillControl('research-title', 'Control evidence');
  await fillControl('research-goal', 'Compare the saved source and two experimental plans.');
  expect((await state()).researchProjects.editor.workspace).toBe('');
  await clickControl('save');
  await expect.poll(async () => (await state()).preferences.research_projects.length).toBe(1);
  projectId = (await state()).preferences.research_projects[0].id; projectKey = `research:${projectId}`;
  await expect.poll(async () => (await state()).selectedProject).toBe(projectKey);
  expect((await savedProject()).workspace).toBeNull();
  await capture('01-project-without-directory');
  checks.push('invalid-title-recovery-and-project-without-directory');

  await clickControl('research-continue');
  await expect.poll(async () => (await state()).projectTab).toBe('research_resources');
  expect((await state()).researchProjects.choosing).toBe(true);
  await attach('paper-agent', seeds.paper.id, 1);
  await attach('control-lab', seeds.control.id, 2);
  await attach('lab', seeds.lab.id, 3);
  await capture('02-three-linked-app-records');
  checks.push('explicit-cross-app-resource-links');
  await clickControl('tab:project.overview');
  for (const [index, name, record] of [[0, 'paper-agent', seeds.paper], [1, 'control-lab', seeds.control], [2, 'lab', seeds.lab]]) {
    await clickControl('research-continue');
    await clickControl(`resource-open:${index}`);
    await expect.poll(async () => (await state()).activeApp?.name).toBe(name);
    frame = page.frameLocator(`iframe[title="${name}"]`);
    if (name === 'lab') {
      await expect(frame.getByRole('combobox', { name: 'Saved experiments', exact: true })).toHaveValue(record.id);
    } else {
      await expect(frame.getByRole('heading', { name: record.title, exact: true }).first()).toBeVisible({ timeout: 120000 });
    }
    if (name === 'paper-agent') expect((await api(frame, '/api/library')).papers.some(item => item.id === record.id)).toBe(true);
    else expect(await api(frame, `/api/experiments/${record.id}`)).toEqual(record);
    await capture(`03-open-${name}`);
    if (name === 'control-lab') {
      const separator = frame.getByRole('separator').first();
      await expect(separator).toBeVisible();
      const original = await frame.locator('#model').evaluate(element => element.getBoundingClientRect().width);
      await separator.focus(); await separator.press('ArrowRight');
      await expect.poll(() => frame.locator('#model').evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(original);
      await separator.dblclick();
      await expect.poll(() => frame.locator('#model').evaluate(element => element.getBoundingClientRect().width)).toBe(original);
    }
    await setAppearance(page, 'dark'); await capture(`03-dark-${name}`);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 760));
    if (name === 'control-lab') await expect(frame.locator('.workbench')).toHaveAttribute('data-stacked', '');
    await expect.poll(() => frame.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await capture(`03-narrow-${name}`);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1488, 1000));
    await setAppearance(page, 'light');
    await projectOverview();
  }
  checks.push('precise-app-record-navigation-without-experiment-mutation');
  const beforeEdit = await savedProject(), validSettings = await readFile(settings, 'utf8');
  await clickControl('edit');
  await fillControl('research-title', 'Control evidence revised');
  await fillControl('research-goal', 'Review the linked source and experimental plans together.');
  // Force the real preference writer to reject a malformed isolated settings file.
  await writeFile(settings, 'invalid');
  await clickControl('save');
  await expect.poll(async () => (await state()).error).toBe('error.preferences');
  expect(await savedProject()).toEqual(beforeEdit);
  expect((await state()).researchProjects.editor).toMatchObject({ title: 'Control evidence revised',
    goal: 'Review the linked source and experimental plans together.', workspace: '' });
  expect(await readFile(settings, 'utf8')).toBe('invalid');
  await capture('04-preference-save-error');
  await writeFile(settings, validSettings);
  await clickControl('save');
  await expect.poll(async () => (await savedProject()).title).toBe('Control evidence revised');
  await expect.poll(async () => (await state()).error).toBeNull();
  expect((await savedProject()).goal).toBe('Review the linked source and experimental plans together.');
  expect((await state()).researchProjects.editor).toBeNull();
  checks.push('preference-save-failure-keeps-project-and-draft-then-recovers');
  expect((await savedProject()).id).toBe(projectId);
  expect((await savedProject()).resources).toHaveLength(3);
  const beforeDirectory = await savedProject();
  const workspaceDirectory = resolve(temp, 'canonical-workspace'), workspaceAlias = resolve(temp, 'workspace-alias');
  await mkdir(workspaceDirectory);
  await writeFile(resolve(workspaceDirectory, 'ROADMAP.md'), '- [ ] Canonical project task\n');
  const canonicalWorkspace = await realpath(workspaceDirectory);
  await symlink(canonicalWorkspace, workspaceAlias, 'dir');
  await clickControl('edit');
  await fillControl('research-workspace', `${workspaceAlias}/`);
  await clickControl('save');
  await expect.poll(async () => (await savedProject()).workspace).toBe(canonicalWorkspace);
  expect((await savedProject()).id).toBe(projectId);
  expect((await savedProject()).resources).toEqual(beforeDirectory.resources);
  await clickControl('tab:nav.tasks');
  await expect.poll(async () => (await state()).localRoadmap.data.workspace).toBe(canonicalWorkspace);
  await expect.poll(async () => (await state()).localRoadmap.data.items.map(item => item.title)).toEqual(['Canonical project task']);
  await capture('04-canonical-workspace-plan');
  await clickControl('tab:project.overview');
  await expect.poll(async () => (await state()).projectTab).toBe('overview');
  checks.push('host-canonicalizes-symlink-directory-before-persisting-and-loads-its-plan');
  await setAppearance(page, 'dark'); await capture('04-dark');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 720));
  await capture('05-narrow-dark');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1488, 1000));
  await setAppearance(page, 'light');
  await close();
  const persisted = JSON.parse(await readFile(settings, 'utf8'));
  const durable = persisted.workbench.research_projects.find(item => item.id === projectId);
  expect(durable.title).toBe('Control evidence revised'); expect(durable.resources).toHaveLength(3);
  expect(durable.workspace).toBe(canonicalWorkspace);
  // Only the project reference is stale; the owning App's source remains unchanged.
  durable.resources.find(item => item.app === 'paper-agent' && item.id === seeds.paper.id).revision = 'prior-observation';
  await writeFile(settings, JSON.stringify(persisted));
  await launch(); await projectOverview();
  expect((await savedProject()).id).toBe(projectId); expect((await savedProject()).resources).toHaveLength(3);
  await clickControl('research-continue');
  await capture('06-restart-persistent-links');
  checks.push('rename-stable-identity-and-restart-persistence');
  const currentPaper = (await state()).researchProjects.catalogs['paper-agent'].resources.find(item => item.reference.id === seeds.paper.id);
  expect((await savedProject()).resources[0].revision).toBe('prior-observation');
  expect(currentPaper.reference.revision).not.toBe('prior-observation');
  await capture('06-changed-observation');
  await clickControl('update:0');
  await expect.poll(async () => (await savedProject()).resources[0].revision).toBe(currentPaper.reference.revision);
  expect((await savedProject()).resources[0]).toEqual(currentPaper.reference);
  expect((await savedProject()).resources).toHaveLength(3);
  await expect.poll(async () => (await state()).researchProjects.saving).toBe(false);
  checks.push('stale-reference-update-keeps-the-same-app-object');

  await clickControl('unlink:2');
  await expect.poll(async () => (await savedProject()).resources.length).toBe(2);
  await clickAppShortcut(page, 'lab');
  frame = page.frameLocator('iframe[title="lab"]');
  expect(await api(frame, `/api/experiments/${seeds.lab.id}`)).toEqual(seeds.lab);
  await projectOverview(); await clickControl('research-continue');
  await capture('07-unlinked-reference-only');
  checks.push('unlink-keeps-owning-app-data');
  await close();
  // Remove only this isolated fixture source to prove stale references remain visible.
  const paperPath = resolve(temp, 'desktop/app-data/paper-agent/research-v1/papers', `${seeds.paper.id}.json`);
  await rename(paperPath, `${paperPath}.missing`);
  await launch(); await projectOverview();
  expect((await savedProject()).resources).toHaveLength(2);
  expect((await state()).researchProjects.catalogs['paper-agent'].resources.some(item => item.reference.id === seeds.paper.id)).toBe(false);
  await clickControl('research-continue');
  expect((await state()).projectControls['resource-open:0']).toBeUndefined();
  expect((await state()).projectControls['unlink:0']).toBeDefined();
  await capture('08-missing-original-record');
  checks.push('missing-original-retains-link-and-recovery-action');
  expect(errors).toEqual([]);
  expect((await state()).chats).toEqual([]);
  await writeFile(resolve(out, 'results.json'), JSON.stringify({ level: 'L1', records: 'synthetic inputs in real App backends', checks, errors, project: await savedProject(), seeds }, null, 2));
  console.log(`Research Projects passed: ${checks.join(', ')}.`);
} catch (error) {
  if (page) { await capture('failure'); await writeFile(resolve(out, 'failure-state.json'), JSON.stringify(await state(), null, 2)); }
  throw error;
} finally {
  await app?.close();
  if (process.env.PERO_KEEP_TEST_DATA) console.log(`Research Projects fixture data: ${temp}`);
  else await rm(temp, { recursive: true, force: true });
}

// Real Electron, Host and ACP fixture. The fixture writes only in the test workspace.
import { expect } from '@playwright/test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { electron } from './electron.mjs';
import { clickNewChat } from './sidebar-controls.mjs';

const root = resolve(import.meta.dirname, '../..');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-artifact-presentation-'));
const workspace = resolve(temp, 'workspace'), output = resolve(root, 'test-results/artifact-presentation');
await Promise.all([mkdir(workspace), mkdir(output, { recursive: true })]);
const agents = resolve(temp, 'agents.json'), settings = resolve(temp, 'settings.json');
await writeFile(agents, JSON.stringify([{ id: 'artifact-fixture', name: 'Artifact fixture', command: process.execPath,
  args: [resolve(root, 'tests/fixtures/session-artifact-agent.mjs'), `--output=${resolve(temp, 'fixture')}`] }]));
await writeFile(settings, JSON.stringify({ chat_agent: 'artifact-fixture',
  workbench: { appearance: 'light', layout: { artifact_view: 'list' } } }));
let app;
try {
  app = await electron.launch({ args: ['--use-mock-keychain', resolve(root, 'desktop')], cwd: root,
    env: { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(temp, 'profile'), PERO_SETTINGS_PATH: settings,
      PERO_HISTORY_PATH: resolve(temp, 'history.jsonl'), PERO_AGENTS_FILE: agents, PERO_ENV_FILE: resolve(temp, 'no-env'),
      PERO_BUILTIN_APPS: 'scientific-viewer', PERO_REQUIRED_APPS: 'scientific-viewer', PERO_LOCALE: 'en' } });
  const page = await app.firstWindow();
  const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
  await page.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).connected && !document.getElementById('loading'));
  await app.evaluate(({ BrowserWindow, dialog }, directory) => {
    BrowserWindow.getAllWindows()[0].setSize(1600, 1000);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
  }, workspace);
  await page.evaluate(() => window.pero.chooseWorkspace());
  await clickNewChat(page);
  const active = async () => { const s = await state(); return s.chats[s.activeChat]; };
  const status = async () => (await active())?.state;
  const click = async bounds => {
    const box = await bounds();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };
  const send = async (prompt, version) => {
    await expect.poll(status).toBe('idle');
    expect((await active()).agent).toBe('artifact-fixture');
    expect(await realpath((await active()).workspace)).toBe(await realpath(workspace));
    await click(async () => (await state()).composerBounds.input);
    await page.keyboard.type(prompt);
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await state()).artifacts?.items[0]?.versions.length).toBe(version);
    await expect.poll(status).toBe('idle');
  };
  const frame = page.locator('iframe[title="Scientific Viewer"]');
  const viewer = page.frameLocator('iframe[title="Scientific Viewer"]');
  const width = async () => (await frame.boundingBox())?.width ?? 0;
  await send('Deliver the report', 1);
  expect((await state()).artifacts.open).toBe(false);
  await send('Deliver the report and present side with previous input', 2);
  await expect(viewer.getByRole('button', { name: 'Back to artifacts' })).toBeVisible();
  await expect(viewer.locator('.artifact-browser-versions')).toContainText('v2 / 2');
  const sideWidth = await width();
  expect(sideWidth).toBeGreaterThan(0);
  await page.screenshot({ path: resolve(output, 'side.png'), scale: 'css' });
  await viewer.getByRole('button', { name: 'Version details' }).click();
  await expect(viewer.getByRole('button', { name: 'Input · report.md · v1' })).toBeVisible();
  await page.screenshot({ path: resolve(output, 'linked-input.png'), scale: 'css' });
  await viewer.getByRole('button', { name: 'Input · report.md · v1' }).click();
  await expect(viewer.locator('.artifact-browser-versions')).toContainText('v1 / 2');
  await click(async () => (await state()).artifacts.bounds.close);
  await send('Deliver the report and present expanded', 3);
  await expect(viewer.locator('.artifact-browser-versions')).toContainText('v3 / 3');
  await expect.poll(width).toBeGreaterThan(sideWidth + 300);
  expect((await state()).preferences.layout.artifact_view).toBe('list');
  await page.screenshot({ path: resolve(output, 'expanded.png'), scale: 'css' });
  console.log('Artifact presentation passed: ordinary delivery, side reader and expanded exact version.');
} finally {
  await app?.close();
  await rm(temp, { recursive: true, force: true });
}

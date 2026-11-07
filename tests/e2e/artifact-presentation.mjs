// Real Electron, Host and ACP fixture. The fixture writes only in the test workspace.
import { expect } from '@playwright/test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { electron } from './electron.mjs';
import { clickNewChat } from './sidebar-controls.mjs';

const root = resolve(import.meta.dirname, '../..');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-artifact-presentation-'));
const appearance = process.env.PERO_ARTIFACT_TEST_APPEARANCE === 'dark' ? 'dark' : 'light';
const workspace = resolve(temp, 'workspace');
const output = resolve(root, 'test-results/artifact-presentation', appearance === 'dark' ? 'dark' : '.');
await Promise.all([mkdir(workspace), mkdir(output, { recursive: true })]);
const agents = resolve(temp, 'agents.json'), settings = resolve(temp, 'settings.json');
await writeFile(agents, JSON.stringify([{ id: 'artifact-fixture', name: 'Artifact fixture', command: process.execPath,
  args: [resolve(root, 'tests/fixtures/session-artifact-agent.mjs'), `--output=${resolve(temp, 'fixture')}`] }]));
await writeFile(settings, JSON.stringify({ chat_agent: 'artifact-fixture',
  ...(process.env.PERO_NOTEBOOK_TEST_PREFIX ? { app_python: { default: process.env.PERO_NOTEBOOK_TEST_PREFIX } } : {}),
  workbench: { appearance, layout: { artifact_view: 'list' } } }));
let app, page;
try {
  app = await electron.launch({ args: ['--use-mock-keychain', resolve(root, 'desktop')], cwd: root,
    env: { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(temp, 'profile'), PERO_SETTINGS_PATH: settings,
      PERO_HISTORY_PATH: resolve(temp, 'history.jsonl'), PERO_AGENTS_FILE: agents, PERO_ENV_FILE: resolve(temp, 'no-env'),
      PERO_BUILTIN_APPS: 'scientific-viewer', PERO_REQUIRED_APPS: 'scientific-viewer', PERO_LOCALE: 'en' } });
  page = await app.firstWindow();
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
  const send = async (prompt, version, filename = 'report.md') => {
    await expect.poll(status).toBe('idle');
    expect((await active()).agent).toBe('artifact-fixture');
    expect(await realpath((await active()).workspace)).toBe(await realpath(workspace));
    await click(async () => (await state()).composerBounds.input);
    await page.keyboard.type(prompt);
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await state()).artifacts?.items.find(item => item.versions[0].filename === filename)?.versions.length).toBe(version);
    await expect.poll(status).toBe('idle');
  };
  const frame = page.locator('iframe[title="Scientific Viewer"]');
  const viewer = page.frameLocator('iframe[title="Scientific Viewer"]');
  const width = async () => (await frame.boundingBox())?.width ?? 0;
  await send('Deliver the report', 1);
  expect((await state()).artifacts.open).toBe(false);
  await send('Deliver the report and present side with previous input and external run', 2);
  await expect(viewer.getByRole('button', { name: 'Back to artifacts' })).toBeVisible();
  await expect(viewer.locator('.artifact-browser-versions')).toContainText('v2 / 2');
  const sideWidth = await width();
  expect(sideWidth).toBeGreaterThan(0);
  await page.screenshot({ path: resolve(output, 'side.png'), scale: 'css' });
  await viewer.getByRole('tab', { name: 'Code' }).click();
  await expect(viewer.locator('.artifact-markdown:visible')).toContainText('版本：1');
  await expect(viewer.locator('.artifact-browser-versions')).toContainText('v2 / 2');
  await page.screenshot({ path: resolve(output, 'inspector-evidence.png'), scale: 'css' });
  await viewer.getByRole('tab', { name: 'Execution log' }).click();
  await viewer.getByRole('button', { name: /solver\.log/ }).click();
  await expect(viewer.locator('.cm-content:visible')).toContainText('residual 0.001');
  await viewer.getByRole('tab', { name: 'Environment' }).click();
  await expect(viewer.locator('.cm-content:visible')).toContainText('local-fixture');
  await viewer.getByRole('tab', { name: 'Review', exact: true }).click();
  await expect(viewer.locator('.artifact-markdown:visible')).toContainText('Check mesh convergence');
  await viewer.getByRole('tab', { name: 'Messages' }).click();
  await expect(viewer.locator('.artifact-inspector-message')).toContainText('第 2 次交付已完成');
  await viewer.getByRole('tab', { name: 'Preview' }).click();
  await viewer.getByRole('button', { name: 'Version details' }).click();
  await expect(viewer.getByRole('button', { name: 'Input · report.md · v1' })).toBeVisible();
  await page.screenshot({ path: resolve(output, 'linked-input.png'), scale: 'css' });
  await viewer.getByRole('button', { name: 'Input · report.md · v1' }).click();
  await expect(viewer.locator('.artifact-browser-versions')).toContainText('v1 / 2');
  const layoutButton = async () => (await state()).artifacts.bounds.bottom;
  await click(layoutButton);
  await expect.poll(width).toBeGreaterThan(sideWidth + 300);
  await expect.poll(async () => (await layoutButton())?.y).toBeGreaterThan(400);
  await click(layoutButton);
  await expect.poll(width).toBeLessThan(sideWidth + 20);
  await click(async () => (await state()).artifacts.bounds.close);
  await send('Deliver the report and present expanded', 3);
  await expect(viewer.locator('.artifact-browser-versions')).toContainText('v3 / 3');
  await expect.poll(width).toBeGreaterThan(sideWidth + 300);
  expect((await state()).preferences.layout.artifact_view).toBe('list');
  await page.screenshot({ path: resolve(output, 'expanded.png'), scale: 'css' });
  await click(async () => (await state()).artifacts.bounds.close);
  await send('Deliver the report and present below', 4);
  const lowerPane = await frame.boundingBox();
  expect(lowerPane?.y).toBeGreaterThan(400);
  expect(lowerPane?.width).toBeGreaterThan(sideWidth + 300);
  await expect(viewer.locator('.artifact-browser-versions')).toContainText('v4 / 4');
  await page.screenshot({ path: resolve(output, 'below.png'), scale: 'css' });
  await click(async () => (await state()).artifacts.bounds.close);
  await send('Deliver the report and present inline', 5);
  expect((await state()).artifacts.open).toBe(false);
  await expect(viewer.locator('.artifact-browser-versions')).toContainText('v5 / 5');
  await expect(viewer.locator('.artifact-markdown')).toContainText('版本：5');
  await page.screenshot({ path: resolve(output, 'inline.png'), scale: 'css' });
  await send('Show existing v1 below', 5);
  await expect(viewer.locator('.artifact-browser-versions')).toContainText('v1 / 5');
  expect((await frame.boundingBox())?.y).toBeGreaterThan(400);
  await click(async () => (await state()).artifacts.bounds.close);
  await send('Show existing v2 inline', 5);
  await expect(viewer.locator('.artifact-browser-versions')).toContainText('v2 / 5');
  expect((await state()).artifacts.open).toBe(false);
  await send('Deliver rich and present inline image', 1, 'chart.png');
  await expect(viewer.getByRole('img', { name: 'chart.png' })).toBeVisible();
  await expect.poll(() => viewer.locator('.artifact-image-scroll').evaluate(node => node.scrollHeight - node.clientHeight)).toBeLessThan(3);
  await page.screenshot({ path: resolve(output, 'inline-image.png'), scale: 'css' });
  if (process.env.PERO_NOTEBOOK_TEST_PREFIX) {
    await send('Deliver Notebook and present expanded notebook', 2, 'analysis.ipynb');
    await viewer.getByRole('button', { name: 'Start Python kernel' }).click();
    await viewer.getByRole('textbox', { name: 'Code cell 2' }).fill('shared = 40\nprint(shared)');
    await viewer.getByRole('button', { name: 'Run cell 2' }).click();
    await expect(viewer.getByRole('region', { name: 'Cell 2', exact: true }).locator('.notebook-live-output')).toContainText('40');
    await viewer.getByRole('button', { name: 'Add cell' }).click();
    const editor = viewer.getByRole('textbox', { name: 'Code cell 3' });
    const run = viewer.getByRole('button', { name: 'Run cell 3' });
    const outputCell = viewer.getByRole('region', { name: 'Cell 3', exact: true }).locator('.notebook-live-output');
    await editor.fill(`from IPython.display import Image, display\ndisplay(Image(filename=${JSON.stringify(resolve(workspace, 'chart.png'))}))\nshared + 2`);
    await editor.press('Shift+Enter');
    await expect(outputCell).toContainText('42');
    await expect(outputCell.getByRole('img', { name: 'Cell image output' })).toBeVisible();
    await expect(run).toBeEnabled();
    await viewer.getByRole('tab', { name: 'Messages' }).click();
    await viewer.getByRole('tab', { name: 'Preview' }).click();
    await viewer.getByRole('button', { name: 'Source', exact: true }).click();
    await viewer.getByRole('button', { name: 'Back to preview' }).click();
    await expect(outputCell).toContainText('42');
    await expect(viewer.locator('.jp-CodeCell .cm-content')).toContainText('value = 9');
    await editor.evaluate(node => { node.scrollTop = 0; });
    await page.screenshot({ path: resolve(output, 'notebook-live.png'), scale: 'css' });
    await editor.fill('import time\nprint("running", flush=True)\nwhile True: time.sleep(0.1)');
    await run.click();
    await expect(outputCell).toContainText('running');
    await viewer.getByRole('button', { name: 'Interrupt' }).click();
    await expect(outputCell).toContainText('KeyboardInterrupt');
    await expect(run).toBeEnabled();
    await viewer.getByRole('button', { name: 'Restart kernel' }).click();
    await expect(run).toBeEnabled();
    await editor.fill('print("shared" in globals())');
    await run.click();
    await expect(outputCell).toContainText('False');
    await expect(run).toBeEnabled();
    await viewer.getByRole('button', { name: 'Close kernel' }).click();
    await expect(viewer.getByRole('button', { name: 'Start Python kernel' })).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Download working copy' })).toBeEnabled();
  }
  console.log('Artifact presentation passed: ordinary delivery and exact versions inline, below, side-by-side and expanded.');
} catch (error) {
  await page?.screenshot({ path: resolve(output, 'failure.png'), scale: 'css' });
  throw error;
} finally {
  await app?.close();
  await rm(temp, { recursive: true, force: true });
}

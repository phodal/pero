// Recent source previews use real Kit list keyboard input and ordinary pane tabs.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { mkdtemp, realpath, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
const root = resolve(process.env.PERO_CONTENT_TEST_ROOT || resolve(import.meta.dirname, '../..'));
const out = resolve(root, 'test-results/recent-content');
const profile = await realpath(await mkdtemp(resolve(tmpdir(), 'pero-recent-content-')));
await mkdir(out, { recursive: true });
await writeFile(resolve(profile, 'agents.json'), '[]');
const files = ['first.txt', 'second.txt', 'third.txt'].map(name => resolve(profile, name));
for (const path of files) await writeFile(path, `${path.split('/').at(-1)} source\n`);
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(profile, 'desktop'), PERO_LOCALE: 'en',
  PERO_APPS_ROOT: resolve(profile, 'apps'), PERO_SETTINGS_PATH: resolve(profile, 'settings.json'),
  PERO_HISTORY_PATH: resolve(profile, 'history.jsonl'), PERO_AGENTS_FILE: resolve(profile, 'agents.json') };
delete env.ELECTRON_RUN_AS_NODE;
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const app = await electron.launch({ args: ['--use-mock-keychain', resolve(root, 'desktop')], cwd: root, env });
let page;
let phase = 'start';
const errors = [];
const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
const leaves = node => !node ? [] : node.kind === 'leaf' ? [node.view] : [...leaves(node.first), ...leaves(node.second)];
const focused = s => leaves(s.workspaceNavigation.panes?.root).find(p => p.id === s.workspaceNavigation.panes.focused);
const activePath = s => s.activeContent?.value?.source;
async function open(path) {
  await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, path);
  await page.keyboard.press(`${mod}+o`);
  await expect.poll(async () => activePath(await state())).toBe(path);
}
try {
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).connected && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1400, 1000));
  for (const file of files) await open(file);
  await page.keyboard.press(`${mod}+w`);
  await expect.poll(async () => activePath(await state())).toBe(files[1]);
  await page.keyboard.press(`${mod}+w`);
  await expect.poll(async () => activePath(await state())).toBe(files[0]);
  const origin = focused(await state());
  const initial = { pane: origin.id, view: origin.tabs.active, items: origin.tabs.items };

  phase = 'arrow-preview-and-cancel';
  await page.keyboard.press(`${mod}+p`);
  await expect.poll(async () => typeof focused(await state()).tabs.preview).toBe('number');
  await expect.poll(async () => activePath(await state())).toBe(files[2]);
  const temporary = focused(await state()).tabs.preview;
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => activePath(await state())).toBe(files[1]);
  expect(focused(await state()).tabs.items.length).toBe(2);
  expect(focused(await state()).tabs.items.some(item => item.id === temporary)).toBe(false);
  await page.screenshot({ path: resolve(out, 'recent-preview.png'), scale: 'css' });
  await page.keyboard.press('Escape');
  await expect.poll(async () => ({ pane: focused(await state()).id, view: focused(await state()).tabs.active, items: focused(await state()).tabs.items })).toEqual(initial);
  await expect.poll(async () => activePath(await state())).toBe(files[0]);

  phase = 'search-and-keep';
  await page.keyboard.press(`${mod}+p`);
  await page.keyboard.type('second');
  await expect.poll(async () => activePath(await state())).toBe(files[1]);
  await page.keyboard.press('Enter');
  await expect.poll(async () => focused(await state()).tabs.preview).toBeNull();
  await page.keyboard.type('Z');
  await expect.poll(async () => (await state()).documents.some(doc => doc.item?.value?.source === files[1] && doc.reader.dirty)).toBe(true);
  // The next picker search must receive typing instead of sending it to the source editor.
  await page.keyboard.press(`${mod}+p`);
  await page.keyboard.type('third');
  await expect.poll(async () => activePath(await state())).toBe(files[2]);
  expect(focused(await state()).tabs.items.length).toBe(3);
  await page.keyboard.press('Escape');
  await expect.poll(async () => activePath(await state())).toBe(files[1]);
  expect(focused(await state()).tabs.items.length).toBe(2);
  expect(errors).toEqual([]);
  await page.screenshot({ path: resolve(out, 'kept-source.png'), scale: 'css' });
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ status: 'passed', profile, checks: ['arrow previews replace the temporary view', 'Escape restores original pane and view', 'search filters recent typed descriptors', 'Enter retains and focuses the source editor', 'later previews preserve the dirty retained tab'], errors }, null, 2));
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {});
    await writeFile(resolve(out, 'failure.json'), JSON.stringify(await state(), null, 2)).catch(() => {});
  }
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ status: 'failed', phase, error: error.message, profile, errors }, null, 2));
  throw error;
} finally {
  // This test deliberately leaves a dirty editor; close only the process it owns.
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  if (app.process().exitCode === null) {
    const exited = new Promise(done => app.process().once('exit', done));
    app.process().kill('SIGKILL');
    await exited;
  }
}

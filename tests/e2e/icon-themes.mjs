// Real Settings import/select/remove/restart. Only theme OS selection is stubbed.
// Documents are admitted by the real Host; general Ctrl+O was removed from the product.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { openSettings, setAppearance } from './sidebar-controls.mjs';
import { mkdtemp, realpath, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(process.env.PERO_CONTENT_TEST_ROOT || resolve(import.meta.dirname, '../..'));
const out = resolve(root, 'test-results/icon-themes');
const profile = await realpath(await mkdtemp(resolve(tmpdir(), 'pero-icon-themes-')));
const fixture = await realpath(resolve(import.meta.dirname, '../fixtures/icon-themes/source-shapes.json'));
const installed = resolve(profile, 'icon-themes/source-shapes.json');
await mkdir(out, { recursive: true });
await writeFile(resolve(profile, 'agents.json'), '[]');
const files = { rust: resolve(profile, 'source.rs'), json: resolve(profile, 'data.json'), fallback: resolve(profile, 'unknown.filetype') };
await writeFile(files.rust, 'fn main() {}\n');
await writeFile(files.json, '[{"id":1}]\n');
await writeFile(files.fallback, 'Unknown extensions remain readable.\n');
const env = {
  ...process.env, PERO_DESKTOP_DATA_DIR: resolve(profile, 'desktop'), PERO_LOCALE: 'en',
  PERO_APPS_ROOT: resolve(profile, 'apps'), PERO_SETTINGS_PATH: resolve(profile, 'settings.json'),
  PERO_HISTORY_PATH: resolve(profile, 'history.jsonl'), PERO_AGENTS_FILE: resolve(profile, 'agents.json'),
};
delete env.ELECTRON_RUN_AS_NODE;
const checks = [];
const errors = [];
let app;
let page;
let failed = false;
let phase = 'startup';
const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
const preferences = async () => JSON.parse(await readFile(resolve(profile, 'settings.json'), 'utf8'));
const paint = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const leaves = node => !node ? [] : node.kind === 'leaf' ? [node.view] : [...leaves(node.first), ...leaves(node.second)];
async function launch() {
  app = await electron.launch({ args: ['--use-mock-keychain', resolve(root, 'desktop')], cwd: root, env });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).connected && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1508, 1035));
  await paint();
}
async function capture(name) {
  await paint();
  await page.screenshot({ scale: 'css', path: resolve(out, `${name}.png`) });
  await writeFile(resolve(out, `${name}.json`), JSON.stringify(await state(), null, 2));
}
async function picker(path) {
  expect(path === fixture || Object.values(files).includes(path)).toBe(true);
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
  }, path);
}
async function settings() {
  await openSettings(page);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state()).settingsOpen).toBe(true);
  const bounds = (await state()).settings.bounds;
  await page.mouse.click(bounds.x + 100, bounds.y + 24);
  await page.keyboard.insertText('Icon theme');
  await expect.poll(async () => (await state()).settings.matches).toEqual(['settings.theme']);
  await expect.poll(async () => (await state()).settings.scroll.anchors.length).toBeGreaterThan(0);
  await paint();
}
async function closeSettings() {
  const bounds = (await state()).settings.bounds;
  // The header has 16px horizontal padding and a 24px icon button.
  await page.mouse.click(bounds.x + bounds.width - 28, bounds.y + 16);
  await expect.poll(async () => (await state()).settingsOpen).toBe(false);
}
async function themeRow() {
  // The filtered Theme section is the sole content anchor. Its final row owns
  // the real icon controls, aligned to the section's right edge.
  const settings = (await state()).settings;
  const section = settings.scroll.anchors[0];
  return { right: section.x + section.width, y: section.y + section.height + settings.scroll.offsetY - 18 };
}
async function open(path) {
  // Fixture setup through the real Desktop → Host document admission boundary.
  await page.evaluate(path => window.pero.sessionCommand({ method: 'documents', action: 'open', request_id: 'icon-fixture-open', path }), path);
  await expect.poll(async () => (await state()).activeContent?.value?.source).toBe(path);
}
async function icons() {
  const snapshot = await state();
  const tabs = leaves(snapshot.workspaceNavigation.panes?.root).flatMap(pane => pane.tabs.items);
  return Object.fromEntries(Object.entries(files).map(([name, path]) => {
    const view = tabs.find(item => item.route?.value?.value?.source === path)?.id;
    return [name, snapshot.paneTabs?.flatMap(strip => strip.tabs).find(tab => tab.view === view)?.icon];
  }));
}
async function gracefulClose() {
  await app.close();
  app = undefined;
}
try {
  await launch();
  await setAppearance(page, 'light');
  phase = 'settings-import';
  await settings();
  await picker(fixture);
  const installRow = await themeRow();
  await page.mouse.click(installRow.right - 75, installRow.y);
  await expect.poll(async () => (await state()).settings.iconTheme?.installed.some(theme => theme.id === 'source-shapes')).toBe(true);
  expect((await state()).settings.iconTheme.selected).toBeNull();
  expect(JSON.parse(await readFile(installed, 'utf8')).id).toBe('source-shapes');
  checks.push('Settings installs an admitted local SVG package without changing selection');
  await capture('01-installed');

  phase = 'settings-select';
  const selectionRow = await themeRow();
  await page.mouse.click(selectionRow.right - 200, selectionRow.y);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state()).settings.iconTheme?.selected).toBe('source-shapes');
  await expect.poll(async () => (await preferences()).icon_theme).toBe('source-shapes');
  await capture('02-selected');
  await closeSettings();
  for (const path of Object.values(files)) await open(path);
  await expect.poll(async () => (await icons()).rust?.startsWith('icon-themes/source-shapes/rust/')).toBe(true);
  await expect.poll(async () => (await icons()).json?.startsWith('icon-themes/source-shapes/json/')).toBe(true);
  expect((await icons()).fallback).toBe('icons/file.svg');
  const light = await icons();
  await capture('03-light-custom-and-fallback');
  checks.push('Rust and JSON tabs resolve admitted artwork; unknown source types keep a bundled fallback');

  phase = 'dark-variant';
  await setAppearance(page, 'dark');
  await expect.poll(async () => (await icons()).rust).not.toBe(light.rust);
  expect((await icons()).json).toBe(light.json);
  expect((await icons()).fallback).toBe(light.fallback);
  const dark = await icons();
  await capture('04-dark-variant');
  checks.push('Rust switches to its dark artwork while JSON falls back to its light asset');

  phase = 'restart';
  await expect.poll(async () => {
    const saved = JSON.parse(await readFile(resolve(profile, 'settings.workspace/session.json'), 'utf8'));
    return saved.session.navigation.items.length;
  }).toBe(3);
  await gracefulClose();
  await launch();
  await expect.poll(icons).toEqual(dark);
  expect((await state()).documents.length).toBe(1);
  await expect.poll(async () => (await icons()).rust?.startsWith('icon-themes/source-shapes/rust/')).toBe(true);
  expect((await state()).dark).toBe(true);
  await settings();
  await expect.poll(async () => (await state()).settings.iconTheme?.selected).toBe('source-shapes');
  await capture('05-restored-selection');
  checks.push('Installed artwork and selected theme survive a real Host/Desktop restart');

  phase = 'settings-remove';
  const removeRow = await themeRow();
  await page.mouse.click(removeRow.right - 90, removeRow.y);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state()).settings.iconTheme?.selected).toBeNull();
  expect((await state()).settings.iconTheme.installed.some(theme => theme.id === 'source-shapes')).toBe(false);
  await expect.poll(async () => (await preferences()).icon_theme ?? null).toBeNull();
  await expect.poll(async () => access(installed).then(() => true, () => false)).toBe(false);
  await closeSettings();
  await expect.poll(async () => (await icons()).rust).toBe('icons/file-cog.svg');
  expect((await icons()).json).toBe('icons/file-braces.svg');
  expect((await icons()).fallback).toBe('icons/file.svg');
  await capture('06-removed-fallback-restored');
  checks.push('Confirmed removal clears persistent selection and restores bundled source icons');
  expect(errors).toEqual([]);
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ status: 'passed', checks, profile, errors }, null, 2));
  console.log('Verified local icon theme Settings lifecycle using actual Desktop input.');
} catch (error) {
  failed = true;
  await capture('failure').catch(() => {});
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ status: 'failed', phase, checks, remaining: error.message, profile, errors }, null, 2));
  throw error;
} finally {
  if (app && failed) {
    const owned = app;
    await owned.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
    owned.process().kill('SIGKILL');
    await owned.close().catch(() => {});
  } else if (app) await gracefulClose();
}

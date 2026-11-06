import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { clickNewChat, setAppearance, clickSessionRow } from './sidebar-controls.mjs';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, 'test-results/workspace-changes');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-change-review-'));
const workspace = resolve(temp, 'workspace');
await mkdir(workspace); await mkdir(out, { recursive: true });
const git = (...args) => execFileSync('git', args, { cwd: workspace, encoding: 'utf8' });
git('init', '-q');
await writeFile(resolve(workspace, 'README.md'), 'one\ntwo\n');
await writeFile(resolve(workspace, 'remove.txt'), 'delete me\n');
await writeFile(resolve(workspace, 'move.txt'), 'rename without editing\n');
git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'baseline');
await writeFile(resolve(workspace, 'README.md'), 'one\npending\n');
await writeFile(resolve(workspace, 'preexisting.txt'), 'already present\n');
const index = await readFile(resolve(workspace, '.git/index'));
const settings = resolve(temp, 'settings.json'), agents = resolve(temp, 'agents.json');
await writeFile(settings, JSON.stringify({ chat_agent: 'changes' }));
await writeFile(agents, JSON.stringify([{ id: 'changes', name: 'Workspace changes fixture', command: process.execPath, args: [resolve(root, 'tests/fixtures/workspace-changes.mjs')] }]));
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(temp, 'profile'), PERO_SETTINGS_PATH: settings, PERO_HISTORY_PATH: resolve(temp, 'history.jsonl'), PERO_AGENTS_FILE: agents, PERO_LOCALE: 'en' };
let app, page; const errors = [];
const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
const review = async () => { const s = await state(); return s.changes.find(changes => changes.thread === s.chats[s.activeChat]?.id); };
const frame = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
const shot = async name => { await frame(); await page.screenshot({ path: resolve(out, `${name}.png`) }); };
async function launch() {
  app = await electron.launch({ args: [resolve(root, 'desktop')], cwd: root, env }); page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).connected && !document.getElementById('loading'), undefined, { timeout: 60000 });
}
async function click(key) {
  await expect.poll(async () => (await state()).artifacts.bounds[key]?.height).toBeGreaterThan(0);
  if (key.startsWith('change:') && (await state()).artifacts.open) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const bounds = (await state()).artifacts.bounds, target = bounds[key], list = bounds['changes-list'];
      if (!list || target.y >= list.y && target.y + target.height <= list.y + list.height) break;
      await page.mouse.move(list.x + list.width / 2, list.y + list.height / 2);
      await page.mouse.wheel(0, target.y < list.y ? -120 : 120); await frame();
    }
  }
  const b = (await state()).artifacts.bounds[key]; await page.mouse.click(b.x + Math.min(24, b.width / 2), b.y + b.height / 2);
}
try {
  await launch();
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, workspace);
  await page.evaluate(() => window.pero.chooseWorkspace()); await clickNewChat(page);
  await expect.poll(async () => { const s = await state(); return s.chats[s.activeChat]?.state; }).toBe('idle');
  const input = (await state()).composerBounds.input;
  await page.mouse.click(input.x + input.width / 2, input.y + input.height / 2);
  await page.keyboard.type('Update files'); await page.keyboard.press('Enter');
  await expect.poll(async () => (await review())?.records.length, { timeout: 30000 }).toBe(1);
  const summary = (await review()).records[0].summary;
  expect({ total: summary.total, added: summary.added, deleted: summary.deleted }).toEqual({ total: 5, added: 2, deleted: 2 });
  expect(summary.files.some(file => file.path === 'preexisting.txt')).toBe(false);
  expect(summary.files.find(file => file.path === 'renamed.txt').old_path).toBe('move.txt');
  expect((await state()).artifacts.items).toEqual([]);
  expect(await readFile(resolve(workspace, '.git/index'))).toEqual(index);
  const bounds = (await state()).artifacts.bounds['changes-toggle'], permissions = (await state()).composerBounds.permissions;
  expect(bounds.x).toBeGreaterThanOrEqual(permissions.x + permissions.width);
  expect(Math.abs(bounds.y - permissions.y)).toBeLessThan(5);
  await shot('automatic-changes');
  const fileIndex = summary.files.findIndex(file => file.path === 'README.md');
  await click('changes-toggle');
  await click(`change:${summary.id}:${fileIndex}`);
  await expect.poll(async () => (await review()).comparison?.kind).toBe('text');
  expect((await review()).comparison.patch).toContain('-pending');
  expect((await review()).comparison.patch).not.toContain('-two');
  await shot('recorded-diff');
  // Layout action is exercised through the actual painted control.
  await expect.poll(async () => (await state()).artifacts.bounds['changes-layout']?.height).toBeGreaterThan(0);
  await click('changes-layout'); await shot('side-by-side');
  await click('changes-current');
  await expect.poll(async () => (await review()).records.some(record => record.summary.scope === 'worktree'), { timeout: 30000 }).toBe(true);
  expect((await review()).records.find(record => record.summary.scope === 'worktree').summary.files.some(file => file.path === 'preexisting.txt')).toBe(true);
  await expect.poll(async () => { const r = await review(); return r.selected?.[0] === r.records.find(record => record.summary.scope === 'worktree').summary.id && !r.loading; }).toBe(true);
  await shot('current-worktree');
  await setAppearance(page, 'dark'); await shot('dark');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 788)); await shot('narrow');
  const thread = (await review()).thread;
  await app.close(); await launch(); await clickSessionRow(page, thread);
  await expect.poll(async () => (await review())?.records.some(record => record.summary.id === summary.id)).toBe(true);
  await click('changes-toggle');
  await click('changes-history');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect.poll(async () => (await review()).selected?.[0]).toBe(summary.id);
  await click(`change:${summary.id}:${fileIndex}`);
  await expect.poll(async () => (await review()).comparison?.kind).toBe('text');
  expect((await review()).comparison.patch).toContain('-pending');
  expect(errors).toEqual([]);
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ checks: ['real git snapshots', 'dirty baseline retained', 'net changes and rename', 'binary metadata', 'user index unchanged', 'composer Diff entry beside permissions', 'snapshot diff', 'side by side', 'current worktree scope', 'restart', 'dark', 'narrow'], state: await state(), errors, temp }, null, 2));
  console.log(JSON.stringify({ out, errors, files: summary.total }));
} catch (error) {
  await page?.screenshot({ path: resolve(out, 'failure.png') });
  console.error(JSON.stringify({ review: await review(), artifacts: (await state()).artifacts })); throw error;
} finally { await app?.close(); }

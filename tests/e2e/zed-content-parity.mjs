// Real keyboard/pointer acceptance of Zed's core content and pane workflow.
// Only the OS file picker is stubbed; diagnostics are observations, never commands.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { setAppearance } from './sidebar-controls.mjs';
import { mkdtemp, realpath, mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(process.env.PERO_CONTENT_TEST_ROOT || resolve(import.meta.dirname, '../..'));
const out = resolve(root, 'test-results/zed-content-parity');
const profile = await realpath(await mkdtemp(resolve(tmpdir(), 'pero-zed-parity-')));
await mkdir(out, { recursive: true });
const rust = resolve(profile, 'source.rs');
const json = resolve(profile, 'records.json');
const markdown = resolve(profile, 'notes.md');
const text = resolve(profile, 'ordinary.txt');
const rustText = 'fn main() {\n    println!("shared source");\n}\n';
await writeFile(rust, rustText);
await writeFile(json, '[{"id":9007199254740993,"name":"中文"}]\n');
await writeFile(markdown, '# Source notes\n\nA **shared** Markdown document.\n\n## Second section\n\nPreview and source use the same document.\n');
await writeFile(text, 'An ordinary unpinned tab.\n');
await writeFile(resolve(profile, 'agents.json'), '[]');
const env = {
  ...process.env, PERO_DESKTOP_DATA_DIR: resolve(profile, 'desktop'),
  PERO_LOCALE: 'en', PERO_APPS_ROOT: resolve(profile, 'apps'),
  PERO_SETTINGS_PATH: resolve(profile, 'settings.json'),
  PERO_HISTORY_PATH: resolve(profile, 'history.jsonl'),
  PERO_AGENTS_FILE: resolve(profile, 'agents.json'),
};
delete env.ELECTRON_RUN_AS_NODE;
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const checks = [];
const errors = [];
let phase = 'startup';
let failed = false;
let app;
let page;
const leaves = node => !node ? [] : node.kind === 'leaf' ? [node.view] : [...leaves(node.first), ...leaves(node.second)];
const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
const panes = snapshot => leaves(snapshot.workspaceNavigation.panes?.root);
const focused = snapshot => panes(snapshot).find(pane => pane.id === snapshot.workspaceNavigation.panes?.focused);
const sourcePath = item => item?.route?.value?.value?.source;
const tabAtPath = (pane, path) => pane?.tabs.items.find(item => sourcePath(item) === path);
const readerFor = (snapshot, view) => snapshot.paneViews?.find(item => item.view === view)?.reader;
const compactLayout = snapshot => ({
  focused: snapshot.workspaceNavigation.panes?.focused,
  panes: panes(snapshot).map(pane => ({
    pane: pane.id, active: pane.tabs.active, preview: pane.tabs.preview ?? null,
    pinned: pane.tabs.pinned_count,
    tabs: pane.tabs.items.map(item => ({ view: item.id, route: item.route, kind: item.kind ?? 'primary' })),
  })),
});
const paint = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function capture(name) {
  await paint();
  await page.screenshot({ scale: 'css', path: resolve(out, `${name}.png`) });
  await writeFile(resolve(out, `${name}.json`), JSON.stringify(await state(), null, 2));
}
async function start() {
  app = await electron.launch({ args: ['--use-mock-keychain', resolve(root, 'desktop')], cwd: root, env });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).connected && !document.getElementById('loading'), undefined, { timeout: 60000 });
  // Content size is Chromium's logical viewport, matching the Zed reference captures.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1508, 1035));
  await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([1508, 1035]);
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    return canvas?.width === Math.round(innerWidth * devicePixelRatio) && canvas.height === Math.round(innerHeight * devicePixelRatio);
  });
  await paint();
}
async function open(path) {
  expect(path.startsWith(`${profile}/`), 'The picker stub may select only this test’s explicit temporary files').toBe(true);
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
  }, path);
  await page.keyboard.press(`${modifier}+o`);
  await expect.poll(async () => (await state()).activeContent?.value?.source).toBe(path);
  await expect.poll(async () => Boolean(tabAtPath(focused(await state()), path))).toBe(true);
}
async function geometry(view) {
  await expect.poll(async () => (await state()).paneTabs?.flatMap(strip => strip.tabs).some(tab => tab.view === view && tab.visible)).toBe(true);
  return (await state()).paneTabs.flatMap(strip => strip.tabs).find(tab => tab.view === view);
}
function center(tab) {
  return { x: (Math.max(tab.left, tab.stripLeft) + Math.min(tab.right - 25, tab.stripRight)) / 2, y: (tab.top + tab.bottom) / 2 };
}
async function clickTab(view, button = 'left') {
  const point = center(await geometry(view));
  await page.mouse.click(point.x, point.y, { button });
  if (button === 'left') await expect.poll(async () => focused(await state())?.tabs.active).toBe(view);
}
async function dragTab(view, targetView) {
  const from = center(await geometry(view));
  const target = await geometry(targetView);
  // A tab's visible left insertion edge is a real drop target.
  const to = { x: Math.max(target.left, target.stripLeft) + 8, y: (target.top + target.bottom) / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 4, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 18 });
  await page.mouse.up();
  await paint();
}
async function ensureSource(view) {
  await clickTab(view);
  let reader = readerFor(await state(), view);
  expect(reader, `Missing retained reader for ViewId ${view}; rebuild the pane diagnostics`).toBeTruthy();
  if (!reader.source) {
    await page.mouse.click(reader.bounds.x + 110, reader.bounds.y + 16);
    await expect.poll(async () => readerFor(await state(), view)?.source).toBe(true);
    reader = readerFor(await state(), view);
  }
  await page.mouse.click(reader.bounds.x + 100, reader.bounds.y + 75);
}
async function finish() {
  if (!app) return;
  // Normal restart and success use the actual graceful checkpoint/close path.
  await app.close();
  app = undefined;
}
async function cleanupFailure() {
  if (!app) return;
  const owned = app;
  app = undefined;
  // A failed test may leave a dirty Kit modal. This destroys only this test's
  // Electron windows/process; it is cleanup, never evidence of close behavior.
  await owned.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  }).catch(() => {});
  owned.process().kill('SIGKILL');
  await owned.close().catch(() => {});
}

try {
  await start();
  phase = 'shared-source-split';
  await page.mouse.click(500, 300);
  await open(rust);
  await page.keyboard.press(`${modifier}+Alt+Shift+ArrowRight`);
  await expect.poll(async () => panes(await state()).length).toBe(2);
  let snapshot = await state();
  const leftPane = panes(snapshot)[0].id;
  const rightPane = panes(snapshot)[1].id;
  const leftRust = tabAtPath(panes(snapshot)[0], rust).id;
  const rightRust = tabAtPath(panes(snapshot)[1], rust).id;
  expect(leftRust).not.toBe(rightRust);
  await expect.poll(async () => readerFor(await state(), leftRust)?.editorBytes).toBe(Buffer.byteLength(rustText));
  await expect.poll(async () => readerFor(await state(), rightRust)?.editorBytes).toBe(Buffer.byteLength(rustText));
  const leftBefore = panes(snapshot)[0].tabs.items.map(item => item.id);
  await open(json);
  const jsonView = tabAtPath(focused(await state()), json).id;
  await open(markdown);
  let markdownView = tabAtPath(focused(await state()), markdown).id;
  snapshot = await state();
  expect(panes(snapshot).find(pane => pane.id === leftPane).tabs.items.map(item => item.id)).toEqual(leftBefore);
  expect(panes(snapshot).find(pane => pane.id === rightPane).tabs.items).toHaveLength(3);
  checks.push('same source has distinct ViewIds; opening JSON and Markdown changes only the focused pane');
  await capture('01-independent-tabs');

  phase = 'shared-edit-undo';
  await ensureSource(leftRust);
  await page.keyboard.press(`${modifier}+a`);
  const changed = 'fn main() { println!("edited 中文"); }\n';
  await page.keyboard.insertText(changed);
  await expect.poll(async () => readerFor(await state(), leftRust)?.dirty).toBe(true);
  await clickTab(rightRust);
  await expect.poll(async () => readerFor(await state(), rightRust)?.editorBytes).toBe(Buffer.byteLength(changed));
  expect(readerFor(await state(), rightRust).dirty).toBe(true);
  await ensureSource(rightRust);
  await page.keyboard.press(`${modifier}+z`);
  await expect.poll(async () => readerFor(await state(), rightRust)?.editorBytes).toBe(Buffer.byteLength(rustText));
  await clickTab(leftRust);
  await expect.poll(async () => readerFor(await state(), leftRust)?.editorBytes).toBe(Buffer.byteLength(rustText));
  expect(readerFor(await state(), leftRust).dirty).toBe(false);
  expect(await readFile(rust, 'utf8')).toBe(rustText);
  checks.push('cross-view edit shares dirty state and one Undo history without saving the file');

  phase = 'pane-mru-close-reopen';
  await clickTab(rightRust);
  await clickTab(jsonView);
  await clickTab(markdownView);
  await page.keyboard.down('Control');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  // The active view remains stable while the switcher's MRU highlight changes.
  expect(focused(await state()).tabs.active).toBe(markdownView);
  await page.keyboard.up('Control');
  await expect.poll(async () => focused(await state()).tabs.active).toBe(rightRust);
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await expect.poll(async () => focused(await state()).tabs.active).toBe(jsonView);
  await clickTab(markdownView, 'middle');
  await expect.poll(async () => Boolean(panes(await state()).find(pane => pane.id === rightPane).tabs.items.find(item => item.id === markdownView))).toBe(false);
  expect(focused(await state()).tabs.active).toBe(jsonView);
  await page.keyboard.press(`${modifier}+Shift+t`);
  await expect.poll(async () => Boolean(tabAtPath(focused(await state()), markdown))).toBe(true);
  const previousMarkdown = markdownView;
  markdownView = tabAtPath(focused(await state()), markdown).id;
  expect(markdownView).not.toBe(previousMarkdown);
  checks.push('per-pane Ctrl-Tab uses stable MRU; background close does not change focus; Cmd-Shift-T reopens it');
  await capture('02-mru-and-reopen');

  phase = 'drag-and-pinned-boundary';
  await dragTab(markdownView, leftRust);
  await expect.poll(async () => Boolean(tabAtPath(panes(await state()).find(pane => pane.id === leftPane), markdown))).toBe(true);
  expect(tabAtPath(panes(await state()).find(pane => pane.id === rightPane), markdown)).toBeUndefined();
  expect(tabAtPath(panes(await state()).find(pane => pane.id === leftPane), markdown).id).toBe(markdownView);
  await clickTab(leftRust);
  // The real tab context menu's first item on a permanent tab is Pin tab.
  await clickTab(leftRust, 'right');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(async () => panes(await state()).find(pane => pane.id === leftPane).tabs.pinned_count).toBe(1);
  await dragTab(markdownView, leftRust);
  await expect.poll(async () => panes(await state()).find(pane => pane.id === leftPane).tabs.pinned_count).toBe(2);
  await clickTab(leftRust);
  await open(text);
  const ordinary = tabAtPath(focused(await state()), text).id;
  await dragTab(leftRust, ordinary);
  await expect.poll(async () => panes(await state()).find(pane => pane.id === leftPane).tabs.pinned_count).toBe(1);
  await clickTab(markdownView);
  const beforeClose = focused(await state()).tabs.items.map(item => item.id);
  await page.keyboard.press(`${modifier}+w`);
  await expect.poll(async () => focused(await state()).tabs.active).not.toBe(markdownView);
  expect(focused(await state()).tabs.items.map(item => item.id)).toEqual(beforeClose);
  expect(focused(await state()).tabs.items[0].id).toBe(markdownView);
  checks.push('pointer drag preserves identity across panes and toggles pinning across the fixed boundary; Cmd-W preserves pinned tabs');
  await capture('03-drag-and-fixed-boundary');

  phase = 'markdown-preview-to-side';
  await ensureSource(markdownView);
  const originalPane = focused(await state()).id;
  const paneCount = panes(await state()).length;
  await page.keyboard.press(`${modifier}+k`);
  await page.keyboard.press('v');
  await expect.poll(async () => panes(await state()).length, { message: 'Pending capability: Markdown preview-to-side must create another real pane' }).toBe(paneCount + 1);
  await expect.poll(async () => (await state()).workspaceNavigation.panes.focused).toBe(originalPane);
  snapshot = await state();
  const markdownCopies = panes(snapshot).flatMap(pane => pane.tabs.items.filter(item => sourcePath(item) === markdown).map(item => ({ pane: pane.id, view: item.id, kind: item.kind ?? 'primary' })));
  expect(markdownCopies).toHaveLength(2);
  const previewCopy = markdownCopies.find(item => item.view !== markdownView);
  expect(previewCopy.kind).toBe('rendered_preview');
  expect(markdownCopies.find(item => item.view === markdownView).kind).toBe('primary');
  await expect.poll(async () => readerFor(await state(), previewCopy.view)?.source).toBe(false);
  expect(readerFor(await state(), markdownView).source).toBe(true);
  checks.push('Markdown side preview has its own ViewId and mode while preserving original pane focus');
  await capture('04-markdown-side-preview');

  phase = 'same-source-preview-drag';
  await dragTab(previewCopy.view, markdownView);
  await expect.poll(async () => panes(await state()).length).toBe(paneCount);
  await expect.poll(async () => {
    const pane = panes(await state()).find(pane => pane.id === originalPane);
    return pane.tabs.items.filter(item => sourcePath(item) === markdown).map(item => ({
      view: item.id, kind: item.kind ?? 'primary',
    })).sort((a, b) => a.view - b.view);
  }).toEqual([
    {view: markdownView, kind: 'primary'},
    {view: previewCopy.view, kind: 'rendered_preview'},
  ].sort((a, b) => a.view - b.view));
  await clickTab(markdownView);
  await expect.poll(async () => readerFor(await state(), markdownView)?.source).toBe(true);
  await clickTab(previewCopy.view);
  await expect.poll(async () => readerFor(await state(), previewCopy.view)?.source).toBe(false);
  await clickTab(markdownView);
  await expect.poll(async () => readerFor(await state(), markdownView)?.source).toBe(true);
  checks.push('dragging a rendered preview beside its source in one pane preserves both ViewIds, distinct item kinds, and independent modes');
  await capture('04b-same-source-two-kinds');

  phase = 'theme-narrow-and-active-reveal';
  await setAppearance(page, 'dark');
  await expect.poll(async () => (await state()).dark).toBe(true);
  await capture('05-dark-1508');
  await setAppearance(page, 'light');
  await expect.poll(async () => (await state()).dark).toBe(false);
  await capture('06-light-1508');
  // Force actual overflow in the original pane using ordinary file-open actions.
  for (let index = 0; index < 5; index++) {
    const path = resolve(profile, `overflow-${index}-long-source-name.txt`);
    await writeFile(path, `Source ${index}\n`);
    await open(path);
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(840, 1035));
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(840);
  await expect.poll(async () => {
    const current = await state();
    const active = current.activeTabBounds;
    if (!active) return false;
    const width = active.right - active.left;
    const available = active.stripRight - active.stripLeft;
    return width > available
      ? active.right > active.stripLeft && active.left < active.stripRight
      : active.left >= active.stripLeft - 2 && active.right <= active.stripRight + 2;
  }).toBe(true);
  await capture('07-light-840-active-reveal');
  checks.push('dark/light and narrow viewport keep the active overflowed tab revealed');

  phase = 'restart-restore';
  const expected = compactLayout(await state());
  // Observe the actual Host checkpoint rather than sleep for its debounce interval.
  await expect.poll(async () => {
    const saved = JSON.parse(await readFile(resolve(profile, 'settings.workspace/session.json'), 'utf8'));
    return compactLayout({ workspaceNavigation: saved.session.navigation });
  }).toEqual(expected);
  await finish();
  await start();
  await expect.poll(async () => compactLayout(await state()), { timeout: 30000 }).toEqual(expected);
  expect((await state()).preferences.appearance).toBe('light');
  await clickTab(markdownView);
  await expect.poll(async () => readerFor(await state(), markdownView)?.source).toBe(true);
  await clickTab(previewCopy.view);
  await expect.poll(async () => readerFor(await state(), previewCopy.view)?.source).toBe(false);
  checks.push('Host restart restores pane tree, view identities, tab order, pins, active view, and per-view Markdown mode');
  await capture('08-restored');
  expect(errors).toEqual([]);
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ status: 'passed', checks, viewport: [1508, 1035], narrow: [840, 1035], profile, reference: 'test-results/zed-reference/05–16.jpg', errors }, null, 2));
  console.log(`Verified ${checks.length} Zed core content workflows using real Desktop input.`);
} catch (error) {
  failed = true;
  if (page && !page.isClosed()) await capture('failure').catch(() => {});
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ status: 'failed', phase, checks, remaining: error.message, profile, errors }, null, 2));
  throw error;
} finally {
  if (failed) await cleanupFailure();
  else await finish();
}

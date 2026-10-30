// Actual canvas interactions: anchors, source mapping, regex and whole-word search.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { setAppearance } from './sidebar-controls.mjs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(process.env.PERO_CONTENT_TEST_ROOT || resolve(import.meta.dirname, '../..'));
const out = resolve(import.meta.dirname, '../../test-results/reader-navigation');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-reader-navigation-'));
const file = resolve(temp, 'navigation.md');
const source = '# Reader navigation\n\nrow 12 rowboat row 24\n\n[Jump to target](#target)\n\n'
  + Array.from({ length: 100 }, (_, i) => `Paragraph ${i}: retained source.\n\n`).join('')
  + '## Target\n\nAnchor destination with 中文.\n';
await mkdir(out, { recursive: true });
await writeFile(file, source);
await writeFile(resolve(temp, 'agents.json'), '[]');
const env = {
  ...process.env,
  PERO_DESKTOP_DATA_DIR: resolve(temp, 'desktop'),
  PERO_LOCALE: 'en',
  PERO_APPS_ROOT: resolve(temp, 'apps'),
  PERO_SETTINGS_PATH: resolve(temp, 'settings.json'),
  PERO_HISTORY_PATH: resolve(temp, 'history.jsonl'),
  PERO_AGENTS_FILE: resolve(temp, 'agents.json'),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['--use-mock-keychain', resolve(root, 'desktop')], cwd: root, env });
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
let page;
try {
  page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
  const reader = () => state().then(s => s.documents[0]?.reader);
  const paint = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  const screen = name => page.screenshot({ scale: 'css', path: resolve(out, `${name}.png`) });
  await page.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).connected && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1488, 1086));
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, file);
  await paint();
  await page.mouse.click(500, 300);
  await page.keyboard.press(`${modifier}+o`);
  await expect.poll(async () => (await reader())?.markdown).toBe(true);
  await paint();
  let bounds = (await reader()).bounds;
  // Heading, paragraph, then the actual rendered link, matching the file fixture.
  await page.mouse.click(bounds.x + 55, bounds.y + 124);
  const target = Buffer.byteLength(source.slice(0, source.indexOf('## Target')));
  await expect.poll(async () => (await reader()).markdownReveal?.start).toBe(target);
  await expect.poll(async () => (await reader()).previewScroll[1]).toBeLessThan(-500);
  expect((await state()).documents.length).toBe(1);
  await screen('heading-anchor');
  await page.mouse.click(bounds.x + 100, bounds.y + 16);
  await expect.poll(async () => (await reader()).source).toBe(true);
  expect((await reader()).selection.start).toBe(target);
  await page.mouse.click(bounds.x + 30, bounds.y + 16);
  await expect.poll(async () => (await reader()).source).toBe(false);

  // Scroll back and drag actual rendered heading text; opening Source must
  // select its exact source bytes instead of resetting to the first cursor.
  await page.mouse.move(bounds.x + 200, bounds.y + 180);
  await page.mouse.wheel(0, -50000);
  await paint();
  await page.mouse.move(bounds.x + 12, bounds.y + 53);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 130, bounds.y + 53, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    const range = (await reader()).markdownSelection;
    return range && range.end > range.start;
  }).toBe(true);
  const renderedSelection = (await reader()).markdownSelection;
  await expect.poll(async () => (await reader()).markdownObservedSelection).toEqual(renderedSelection);
  await page.mouse.click(bounds.x + 100, bounds.y + 16);
  await expect.poll(async () => (await reader()).source).toBe(true);
  expect((await reader()).selection).toEqual(renderedSelection);
  await page.mouse.click(bounds.x + 30, bounds.y + 16);
  await expect.poll(async () => (await reader()).source).toBe(false);
  await expect.poll(async () => (await reader()).markdownReveal).toEqual(renderedSelection);
  await screen('rendered-source-mapping');

  await page.mouse.click(bounds.x + 100, bounds.y + 16);
  await paint();
  expect((await reader()).selection).toEqual(renderedSelection);
  // A cancelled Source press must not retain the previous rendered range.
  await page.keyboard.press('End');
  const beforeCancelledPress = (await reader()).selection;
  await page.mouse.click(bounds.x + 30, bounds.y + 16);
  await expect.poll(async () => (await reader()).source).toBe(false);
  await page.mouse.move(bounds.x + 12, bounds.y + 53);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 130, bounds.y + 53, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await reader()).markdownObservedSelection?.end).toBeGreaterThan(0);
  await page.mouse.move(bounds.x + 100, bounds.y + 16);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 700, bounds.y + 53);
  await page.mouse.up();
  expect((await reader()).source).toBe(false);
  await page.mouse.click(bounds.x + 700, bounds.y + 53);
  await expect.poll(async () => (await reader()).markdownObservedSelection).toBe(null);
  await page.mouse.click(bounds.x + 100, bounds.y + 16);
  await expect.poll(async () => (await reader()).source).toBe(true);
  expect((await reader()).selection).toEqual(beforeCancelledPress);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press(`${modifier}+f`);
  await expect.poll(async () => (await reader()).search?.open).toBe(true);
  const query = async value => {
    bounds = (await reader()).bounds;
    await page.mouse.click(bounds.x + 100, bounds.y + 48);
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.insertText(value);
    await paint();
  };
  await query('row');
  await expect.poll(async () => (await reader()).search.matches).toBe(3);
  // Input -> case -> previous -> next -> regex. Matches are available, so
  // both navigation buttons participate in the keyboard focus order.
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await expect.poll(async () => (await reader()).searchOptions.regex).toBe(true);
  await query('row \\d+');
  await expect.poll(async () => (await reader()).search.matches).toBe(2);
  const beforeNext = (await reader()).search.current;
  await page.keyboard.press('Enter');
  await paint();
  expect((await reader()).search.current).not.toEqual(beforeNext);
  await page.keyboard.press('Shift+Enter');
  await paint();
  expect((await reader()).search.current).toEqual(beforeNext);
  await screen('regex-search');
  await query('[');
  await expect.poll(async () => !!(await reader()).searchError).toBe(true);
  expect((await reader()).search.matches).toBe(0);
  await screen('invalid-regex');
  await query('row');
  await expect.poll(async () => (await reader()).searchError).toBe(null);
  for (let i = 0; i < 5; i++) await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await expect.poll(async () => (await reader()).searchOptions.whole_word).toBe(true);
  await expect.poll(async () => (await reader()).search.matches).toBe(2);
  await screen('whole-word-search');
  await setAppearance(page, 'dark');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 800));
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    return canvas?.width === Math.round(innerWidth * devicePixelRatio) && canvas.height === Math.round(innerHeight * devicePixelRatio);
  });
  await paint();
  expect((await reader()).search.matches).toBe(2);
  await screen('whole-word-search-dark-narrow');
  await query('[');
  await expect.poll(async () => !!(await reader()).searchError).toBe(true);
  await screen('invalid-regex-dark-narrow');
  await query('row');
  await expect.poll(async () => (await reader()).search.matches).toBe(2);
  expect(errors).toEqual([]);
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ checks: ['actual Markdown heading link', 'rendered selection to exact source range', 'source selection to rendered reveal', 'cancelled source gesture and cleared rendered selection', 'regex match painting and Enter/Shift+Enter navigation', 'invalid regex recovery', 'whole-word keyboard toggle'], errors }, null, 2));
  console.log('Verified Markdown anchors, rendered/source mapping, regex and whole-word search.');
} catch (error) {
  if (page) {
    await page.screenshot({ scale: 'css', path: resolve(out, 'failure.png') });
    await writeFile(resolve(out, 'failure.json'), await page.evaluate(() => window.peroDiagnostics.snapshot()));
  }
  throw error;
} finally {
  await app.close();
}

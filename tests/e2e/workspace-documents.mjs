// Actual code/document workspace flow; the source is a synthetic ACP result.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
const root = resolve(
  process.env.PERO_CONTENT_TEST_ROOT || resolve(import.meta.dirname, '../..'),
);
const out = resolve(
  import.meta.dirname,
  '../../test-results/workspace-documents',
);
const temp = await mkdtemp(resolve(tmpdir(), 'pero-document-flow-'));
await mkdir(out, { recursive: true });
const source =
  '// Retained source fixture: 中文\n' +
  Array.from(
    { length: 80 },
    (_, i) => `pub fn helper_${i}(value: i64) -> i64 {\n    value + ${i}\n}\n`,
  ).join('\n');
const content = resolve(temp, 'example.rs.txt');
await writeFile(content, '```rust\n' + source + '\n```');
await writeFile(
  resolve(temp, 'settings.json'),
  JSON.stringify({ chat_agent: 'fixture' }),
);
await writeFile(
  resolve(temp, 'agents.json'),
  JSON.stringify([
    {
      id: 'fixture',
      name: 'Document fixture',
      command: process.execPath,
      args: [
        resolve(root, 'tests/fixtures/acp-agent.mjs'),
        `--content-file=${content}`,
        '--content-title=Code result',
      ],
    },
  ]),
);
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
const app = await electron.launch({
  args: ['--use-mock-keychain', resolve(root, 'desktop')],
  cwd: root,
  env,
});
let page;
try {
  page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const state = () =>
    page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
  const paint = () =>
    page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done)),
        ),
    );
  const screenshot = (name) =>
    page.screenshot({ scale: 'css', path: resolve(out, name + '.png') });
  await page.waitForFunction(
    () =>
      window.peroDiagnostics &&
      JSON.parse(window.peroDiagnostics.snapshot()).connected &&
      !document.getElementById('loading'),
    undefined,
    { timeout: 60000 },
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1488, 1086),
  );
  await page.waitForFunction(
    () =>
      document.querySelector('canvas')?.width ===
      Math.round(innerWidth * devicePixelRatio),
  );
  await paint();
  await expect
    .poll(async () =>
      (await state()).agents.some((agent) => agent.id === 'fixture'),
    )
    .toBe(true);
  await page.mouse.click(100, 28);
  await expect.poll(async () => (await state()).composerFocused).toBe(true);
  expect((await state()).chats[0].agent).toBe('fixture');
  await page.keyboard.type('contentview');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await state()).chats[0].state, { timeout: 15000 })
    .toBe('idle');
  await expect
    .poll(async () => (await state()).toolBounds[0]?.bounds?.width)
    .toBeGreaterThan(0);
  const toggle = (await state()).toolBounds[0].bounds;
  await page.mouse.click(toggle.x + 80, toggle.y + 12);
  await paint();
  const inline = () => state().then((s) => s.contentReaders[0]);
  await expect.poll(async () => (await inline())?.language).toBe('rust');
  const open = async () => {
    const b = (await inline()).bounds;
    await page.mouse.click(b.x + 100, b.y - 15);
    await paint();
  };
  await screenshot('inline-code');
  await open();
  await expect.poll(async () => (await state()).documents?.length).toBe(1);
  const document = () => state().then((s) => s.documents[0].reader);
  expect((await state()).activeContent.kind).toBe('document');
  expect((await state()).documents[0].title).toBe('Code result');
  expect((await state()).contentTabs.length).toBe(2);
  await expect
    .poll(async () => (await document()).bounds?.height)
    .toBeGreaterThan(600);
  expect((await document()).workspace).toBe(true);
  expect((await document()).language).toBe('rust');
  expect((await document()).bytes).toBe(Buffer.byteLength(source.trimEnd()));
  await screenshot('workspace-code');
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+f`);
  await expect.poll(async () => (await document()).search.open).toBe(true);
  await page.waitForFunction(
    () =>
      document.activeElement?.tagName === 'TEXTAREA' &&
      document.activeElement.value === '',
  );
  await page.keyboard.type('helper_42', { delay: 20 });
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await document()).search.matches).toBe(1);
  const retained = (await document()).search;
  await screenshot('workspace-find');
  await page.keyboard.press('Control+Shift+Tab');
  await paint();
  expect((await state()).activeContent.kind).toBe('conversation');
  await open();
  expect((await state()).documents.length).toBe(1);
  expect((await state()).contentTabs.length).toBe(2);
  expect((await document()).search).toEqual(retained);
  expect((await inline()).search.query).toBe('');
  await screenshot('reopened-document');
  const tab = (await state()).activeTabBounds;
  await page.mouse.click(tab.right - 13, 18);
  await paint();
  expect((await state()).activeContent.kind).toBe('conversation');
  expect((await state()).documents.length).toBe(0);
  expect((await state()).chats.length).toBe(1);
  expect((await state()).chats[0].tools[0].content).toBe(
    '```rust\n' + source + '\n```',
  );
  await screenshot('closed-document');
  expect(errors).toEqual([]);
  await writeFile(
    resolve(out, 'result.json'),
    JSON.stringify(
      {
        checks: [
          'code opens as a workspace document',
          'full-height shared reader',
          'source identity deduplicates reopen',
          'retained query across workspace switches',
          'separate inline and workspace reading state',
          'closing the view preserves its conversation and source',
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    'Verified workspace document opening, retained state, identity, focus and closing.',
  );
} catch (error) {
  if (page) {
    await page.screenshot({ scale: 'css', path: resolve(out, 'failure.png') });
    await writeFile(
      resolve(out, 'failure.json'),
      await page.evaluate(() => window.peroDiagnostics.snapshot()),
    );
  }
  throw error;
} finally {
  await app.close();
}

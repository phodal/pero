import { expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { electron } from './electron.mjs';
import { clickNewChat, clickSessionRow } from './sidebar-controls.mjs';

const source = resolve(import.meta.dirname, '../..');
const root = resolve(process.env.PERO_CONTENT_TEST_ROOT || source);
const temp = await mkdtemp(resolve(tmpdir(), 'pero-browser-use-'));
const profile = resolve(temp, 'profile');
const output = resolve(source, 'test-results/browser-use');
await mkdir(output, { recursive: true });
const agent = 'browser-use-fixture';
const agents = resolve(temp, 'agents.json');
const settings = resolve(temp, 'settings.json');
await writeFile(agents, JSON.stringify([{ id: agent, name: 'Browser Use fixture', command: process.execPath,
  args: [resolve(source, 'tests/fixtures/browser-use-agent.mjs')] }]));
await writeFile(settings, JSON.stringify({ chat_agent: agent, workbench: { layout: { chat_open: true } } }));

let foreignHits = 0;
async function serve(handler) {
  const server = createServer(handler);
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(done => server.close(done)) };
}
const foreign = await serve((_request, response) => {
  foreignHits++;
  response.end('Foreign tab');
});
const site = await serve((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (request.url === '/redirect') {
    response.writeHead(302, { Location: foreign.origin });
    response.end();
    return;
  }
  response.end(request.url === '/next' ? '<title>Destination</title><h1>Destination</h1>' : `
    <title>Browser Use fixture</title><h1>Browser Use fixture</h1>
    <label for="draft">Page draft</label><input id="draft">
    <input type="password" aria-label="Secret field" value="inaccessible-secret">
    <button onclick="document.querySelector('output').textContent=document.querySelector('#draft').value">Apply draft</button>
    <output></output><a href="${foreign.origin}">Other site</a>
    <iframe srcdoc="<p>Nested document text</p>"></iframe>`);
});
const original = site.origin + '/';
let app, page;
try {
  app = await electron.launch({
    args: ['--use-mock-keychain', resolve(root, 'desktop')], cwd: root,
    env: { ...process.env, PERO_DESKTOP_DATA_DIR: profile, PERO_SETTINGS_PATH: settings,
      PERO_AGENTS_FILE: agents, PERO_HISTORY_PATH: resolve(temp, 'sessions.jsonl'), PERO_LOCALE: 'en', PERO_APPS_ROOT: resolve(temp, 'apps') },
  });
  page = await app.firstWindow();
  await page.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).connected && !document.getElementById('loading'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000));
  const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
  const active = async () => { const s = await state(); return s.chats[s.activeChat]; };
  const prompt = async commands => {
    await expect.poll(async () => (await active())?.state).toBe('idle');
    const previous = (await active()).messages.length;
    const input = (await state()).composerBounds.input;
    expect(input?.width).toBeGreaterThan(0);
    await page.mouse.click(input.x + input.width / 2, input.y + input.height / 2);
    await page.keyboard.insertText(JSON.stringify(commands));
    await page.keyboard.press('Enter');
    let response;
    await expect.poll(async () => {
      response = (await active()).messages.slice(previous).find(item => item.role === 'assistant')?.text || '';
      return response.startsWith('BROWSER_RESULT:') && (await active()).state === 'idle';
    }, { timeout: 15000 }).toBe(true);
    return JSON.parse(response.slice('BROWSER_RESULT:'.length));
  };
  const menu = id => app.evaluate(({ Menu, BrowserWindow }, key) => {
    const item = Menu.getApplicationMenu().getMenuItemById(key);
    if (!item) throw new Error(`Missing desktop menu action ${key}`);
    item.click(undefined, BrowserWindow.getAllWindows()[0]);
  }, id);
  const document = id => state().then(s => s.webDocuments.find(item => item.id === id));
  const browserCommand = command => page.evaluate(input => window.pero.webCommand(input), command);
  const open = async url => {
    await browserCommand({ action: 'web_open', url });
    await expect.poll(async () => (await document(url))?.observation.load.kind).toBe('ready');
    await expect.poll(async () => (await state()).activeContent?.value).toBe(url);
  };
  const confirm = async response => {
    await app.evaluate(({ dialog }, value) => {
      globalThis.browserUsePrompt = undefined;
      dialog.showMessageBox = async (_window, options) => {
        globalThis.browserUsePrompt = options;
        return { response: value, checkboxChecked: false };
      };
    }, response);
    await menu('browser-use-allow');
    await expect.poll(() => app.evaluate(() => globalThis.browserUsePrompt?.detail)).toContain(site.origin);
  };

  await clickNewChat(page);
  await open(original);
  if (!(await state()).chatVisible) await menu('toggle_chat');
  await expect.poll(async () => (await state()).chatVisible).toBe(true);

  await confirm(0);
  expect(await prompt([{ action: 'status' }, { action: 'observe' }])).toEqual([
    { authorized: false, isError: false },
    expect.objectContaining({ isError: true, error: expect.stringContaining('Allow a Web tab') }),
  ]);
  // Composer focus can change in a split, so focus the live surface before granting it.
  if ((await state()).activeContent.kind !== 'web') await open(original);
  await confirm(1);
  await expect.poll(async () => (await document(original))?.observation.notice).toBe('Browser Use allowed');
  await page.screenshot({ path: resolve(output, 'authorized-workbench.png') });
  const actions = await prompt([
    { action: 'status' }, { action: 'observe' }, { action: 'fill', name: 'Page draft', text: 'Pero verified' },
    { action: 'fill', name: 'Page draft', text: 'stale write' },
    { action: 'observe' }, { action: 'click', name: 'Apply draft' }, { action: 'observe' },
    { action: 'click', name: 'Other site' }, { action: 'navigate', url: foreign.origin },
  ]);
  expect(Array.isArray(actions), JSON.stringify(actions)).toBe(true);
  expect(actions[0]).toMatchObject({ authorized: true, origin: site.origin, visible: true });
  expect(JSON.stringify(actions[1])).not.toMatch(/Secret field|inaccessible-secret|Nested document text/);
  expect(actions[2]).toMatchObject({ outcome: 'dispatched', verified: false });
  expect(actions[3]).toMatchObject({ isError: true, error: expect.stringContaining('stale') });
  expect(actions[5]).toMatchObject({ outcome: 'dispatched', verified: false });
  expect(actions[6].nodes).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'Pero verified' })]));
  expect(actions[7]).toMatchObject({ isError: true, outcome: 'rejected' });
  expect(actions[8]).toMatchObject({ isError: true, error: expect.stringContaining('outside the authorized site') });
  const displayed = await app.evaluate(async ({ webContents }, url) => {
    const contents = webContents.getAllWebContents().find(view => view.getURL() === url);
    return contents.executeJavaScript("document.querySelector('output').textContent");
  }, original);
  expect(displayed).toBe('Pero verified');

  const navigation = await prompt([
    { action: 'navigate', url: site.origin + '/redirect' }, { action: 'navigate', url: site.origin + '/next' },
    { action: 'observe' },
  ]);
  expect(navigation[0]).toMatchObject({ isError: true, outcome: 'rejected', reason: expect.stringContaining('redirected') });
  expect(foreignHits).toBe(0);
  expect(navigation[1]).toMatchObject({ outcome: 'dispatched' });
  expect(navigation[2]).toMatchObject({ title: 'Destination', url: site.origin + '/next' });
  const thread = await active();
  await clickNewChat(page);
  await expect.poll(async () => (await active())?.id).not.toBe(thread.id);
  expect(await prompt([{ action: 'status' }])).toEqual([{ authorized: false, isError: false }]);
  await clickSessionRow(page, thread.id);
  await expect.poll(async () => (await active())?.id).toBe(thread.id);
  // The second tab shares the origin but cannot inherit the first tab's grant.
  const second = site.origin + '/second';
  await browserCommand({ action: 'web_open', url: second });
  await expect.poll(async () => (await document(second))?.observation.load.kind).toBe('ready');
  expect(await prompt([{ action: 'status' }, { action: 'observe' }])).toEqual([
    { authorized: true, origin: site.origin, visible: false, isError: false },
    expect.objectContaining({ isError: true, error: expect.stringContaining('Show the authorized Web tab') }),
  ]);
  await browserCommand({ action: 'web_open', url: original });
  await expect.poll(async () => (await state()).activeContent?.value).toBe(original);
  await menu('browser-use-revoke');
  await expect.poll(async () => (await document(original))?.observation.notice ?? null).toBe(null);
  expect(await prompt([{ action: 'status' }, { action: 'observe' }])).toEqual([
    { authorized: false, isError: false }, expect.objectContaining({ isError: true }),
  ]);

  await confirm(1);
  await expect.poll(async () => (await document(original))?.observation.notice).toBe('Browser Use allowed');
  await browserCommand({ action: 'web_navigate', id: original, url: foreign.origin });
  await expect.poll(async () => (await document(original))?.observation.url).toBe(foreign.origin + '/');
  expect(await prompt([{ action: 'status' }, { action: 'observe' }])).toEqual([
    { authorized: false, isError: false }, expect.objectContaining({ isError: true }),
  ]);
  await browserCommand({ action: 'web_navigate', id: original, url: original });
  await expect.poll(async () => (await document(original))?.observation.load.kind).toBe('ready');
  await confirm(1);
  await expect.poll(async () => (await document(original))?.observation.notice).toBe('Browser Use allowed');
  await browserCommand({ action: 'web_close', id: original });
  await expect.poll(async () => await document(original) ?? null).toBe(null);
  expect(await prompt([{ action: 'status' }])).toEqual([{ authorized: false, isError: false }]);
  const evidence = resolve(profile, 'browser-use-evidence');
  const [directory] = await readdir(evidence);
  const names = await readdir(resolve(evidence, directory));
  const saved = await Promise.all(names.map(name => readFile(resolve(evidence, directory, name), 'utf8').then(JSON.parse)));
  const fill = actions[2].receiptId;
  expect(saved).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: fill, observationId: actions[1].observationId, thread: thread.id, action: 'fill' }),
    expect.objectContaining({ id: fill, outcome: 'dispatched' }),
    expect.objectContaining({ id: actions[1].observationId, outcome: expect.objectContaining({ kind: 'observation' }) }),
  ]));
  expect(saved.find(record => record.id === fill && record.action === 'fill')).not.toHaveProperty('text');
  await page.screenshot({ path: resolve(output, 'workbench.png') });
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ passed: true, actions, navigation, displayed, foreignHitsAfterUserNavigation: foreignHits }, null, 2));
  await rm(resolve(output, 'failure-state.json'), { force: true });
  await rm(resolve(output, 'failure.png'), { force: true });
  console.log('Browser Use passed through actual Electron, Rust Host and ACP MCP.');
} catch (error) {
  if (page) {
    await page.screenshot({ path: resolve(output, 'failure.png') });
    await writeFile(resolve(output, 'failure-state.json'), await page.evaluate(() => window.peroDiagnostics?.snapshot() || '{}'));
  }
  throw error;
} finally {
  await app?.close();
  await Promise.all([site.close(), foreign.close()]);
  await rm(temp, { recursive: true, force: true });
}

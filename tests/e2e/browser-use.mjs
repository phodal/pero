import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { electron } from './electron.mjs';
import { clickNewChat, clickSessionRow } from './sidebar-controls.mjs';

const source = resolve(import.meta.dirname, '../..');
const root = resolve(process.env.PERO_CONTENT_TEST_ROOT || source);
const temp = await mkdtemp(resolve(tmpdir(), 'pero-browser-use-'));
const profile = resolve(temp, 'profile');
const workspace = resolve(temp, 'workspace');
await mkdir(workspace);
const attachmentText = 'A file chosen in the Pero composer.\n';
const attachment = resolve(workspace, 'browser-input.txt');
await writeFile(attachment, attachmentText);
const downloadText = 'status,value\nverified,7\n';
let uploaded, filePageLoads = 0;
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
const site = await serve(async (request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (request.url === '/redirect') {
    response.writeHead(302, { Location: foreign.origin });
    response.end();
    return;
  }
  if (request.url === '/files') {
    filePageLoads++;
    response.setHeader('Set-Cookie','pero_browser_fixture=ready; Path=/');
    response.end(`<title>Browser files</title>
      <form action="/received" method="post" enctype="multipart/form-data">
        <label>Upload source <input name="source" type="file"></label><button>Send attachment</button>
      </form>
      <a href="/download-entry" download>Report download</a>
      <a href="/redirect" download>Cross-origin download</a>`);
    return;
  }
  if (request.url === '/download-entry') {
    response.writeHead(302, {Location:'/report.csv'});
    response.end();
    return;
  }
  if (request.url === '/report.csv') {
    if (!request.headers.cookie?.includes('pero_browser_fixture=ready')) {
      response.writeHead(401);
      response.end('Expected a cookie from the existing Chromium session.');
      return;
    }
    response.setHeader('Content-Type', 'text/csv');
    response.setHeader('Content-Disposition', 'attachment; filename="report.csv"');
    response.end(downloadText);
    return;
  }
  if (request.url === '/received' && request.method === 'POST') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = new Request('http://127.0.0.1/upload', {method:'POST', headers:request.headers, body:Buffer.concat(chunks)});
    const file = (await body.formData()).get('source');
    uploaded = {name:file.name, text:await file.text()};
    response.end('<title>Upload receipt</title><p>Upload received</p>');
    return;
  }
  if (request.url === '/controls') {
    response.end(`<title>Browser controls</title>
      <label><input id="archive" type="checkbox">Include archived</label>
      <label>Mode <select id="mode">
        <option value="basic">Basic</option><option value="full">Full</option><option value="blocked" disabled>Unavailable</option>
      </select></label>
      <button data-testid="defer">Start deferred update</button>
      <p data-testid="status">Pending</p>
      <button>Duplicate</button><button>Duplicate</button>
      <button data-testid="available" disabled>Available later</button>
      <iframe title="Details" src="/details" style="display:block;width:520px;height:280px;border:4px solid black"></iframe>
      <iframe title="Outside" src="${foreign.origin}"></iframe>
      <script>
        window.checkboxChanges = 0;
        document.querySelector('#archive').addEventListener('change', () => { window.checkboxChanges++; });
        document.querySelector('[data-testid=defer]').addEventListener('click', () => setTimeout(() => {
          document.querySelector('[data-testid=status]').textContent = 'Deferred ready';
          document.querySelector('[data-testid=available]').disabled = false;
        }, 450));
      </script>`);
    return;
  }
  if (request.url === '/details') {
    response.end('<title>Details</title><iframe data-testid="nested-frame" src="/nested" style="width:450px;height:205px;border:3px solid black"></iframe>');
    return;
  }
  if (request.url === '/nested') {
    response.end(`<title>Nested details</title>
      <label for="detail">Detail draft</label><input id="detail">
      <button id="apply-detail">Apply detail</button><p data-testid="detail-status">Not applied</p><p data-testid="detail-key">No key</p>
      <script>
        let pointed = false;
        const detail = document.querySelector('#detail');
        detail.addEventListener('keydown', event => {
          if (event.isTrusted && event.key === 'Enter') document.querySelector('[data-testid=detail-key]').textContent = 'Frame Enter';
        });
        const button = document.querySelector('#apply-detail');
        button.addEventListener('pointerdown', event => pointed = event.isTrusted);
        button.addEventListener('click', event => {
          if (pointed && event.isTrusted) document.querySelector('[data-testid=detail-status]').textContent =
            'Applied: ' + document.querySelector('#detail').value;
        });
      </script>`);
    return;
  }
  if (request.url === '/framed') {
    response.end(`<title>Other origin frame</title><iframe src="${foreign.origin}"></iframe>`);
    return;
  }
  response.end(request.url === '/next' ? '<title>Destination</title><h1>Destination</h1>' : `
    <title>Browser Use fixture</title><h1>Browser Use fixture</h1>
    <label for="draft">Page draft</label><input id="draft">
    <input type="password" aria-label="Secret field" value="inaccessible-secret">
    <button id="apply">Apply draft</button>
    <output></output><a href="${foreign.origin}">Other site</a>
    <p id="keyboard">No key yet</p>
    <form><label for="foreign">Foreign submission</label><input id="foreign">
      <button formaction="${foreign.origin}">Send elsewhere</button>
    </form>
    <iframe srcdoc="<p>Nested document text</p>"></iframe>
    <div style="height:3000px" aria-hidden="true"></div>
    <script>
      const draft = document.querySelector('#draft');
      let trustedPointer = false;
      document.querySelector('#apply').addEventListener('pointerdown', event => { trustedPointer = event.isTrusted; });
      document.querySelector('#apply').addEventListener('click', event => {
        if (trustedPointer && event.isTrusted) document.querySelector('output').textContent = draft.value;
      });
      draft.addEventListener('keydown', event => {
        if (event.isTrusted && event.key === 'Enter') document.querySelector('#keyboard').textContent = 'Enter: ' + draft.value;
      });
    </script>`);
});
const original = site.origin + '/';
let app, page;
try {
  const launch = () => electron.launch({
    args: ['--use-mock-keychain', resolve(root, 'desktop')], cwd: root,
    env: { ...process.env, PERO_DESKTOP_DATA_DIR: profile, PERO_SETTINGS_PATH: settings,
      PERO_AGENTS_FILE: agents, PERO_HISTORY_PATH: resolve(temp, 'sessions.jsonl'), PERO_LOCALE: 'en', PERO_APPS_ROOT: resolve(temp, 'apps') },
  });
  app = await launch();
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
    await expect.poll(async () => (await state()).composerFocused).toBe(true);
    const text = JSON.stringify(commands);
    await page.keyboard.insertText(text);
    await expect.poll(async () => (await state()).composer).toContain(text);
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

  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled:false, filePaths:[path] }); }, workspace);
  await page.evaluate(() => window.pero.chooseWorkspace());
  await expect.poll(async () => (await state()).workspace).toBe(await realpath(workspace));
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

  const input = await prompt([
    { action: 'observe' }, { action: 'press', name: 'Foreign submission', key: 'Enter' },
    { action: 'observe' }, { action: 'press', name: 'Page draft', key: 'Enter' },
    { action: 'press', name: 'Page draft', key: 'Enter' }, { action: 'observe' },
    { action: 'screenshot' }, { action: 'scroll', deltaX: 0, deltaY: 620 }, { action: 'scroll', deltaX: 0, deltaY: 620 },
  ]);
  const [, foreignPress, , enter, stalePress, observedKey, screenshot, scroll, staleScroll] = input;
  expect(foreignPress).toMatchObject({ outcome: 'rejected', reason: expect.stringContaining('form leaves') });
  expect(enter).toMatchObject({ outcome: 'dispatched', verified: false });
  expect(stalePress).toMatchObject({ isError: true, error: expect.stringContaining('stale') });
  expect(observedKey.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'Enter: Pero verified' })]));
  expect(screenshot).toMatchObject({ kind: 'screenshot', isError: false, receipt: screenshot.pixels });
  expect(screenshot.pixels.bytes).toBeGreaterThan(1000);
  expect(scroll).toMatchObject({ outcome: 'dispatched', verified: false });
  expect(staleScroll).toMatchObject({ isError: true, error: expect.stringContaining('stale') });
  let scrollY;
  await expect.poll(async () => {
    scrollY = await app.evaluate(({ webContents }, url) => webContents.getAllWebContents()
      .find(view => view.getURL() === url).executeJavaScript('window.scrollY'), original);
    return scrollY;
  }).toBeGreaterThan(0);

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
  const [unauthorized, ...denied] = await prompt([
    { action: 'status' }, { action: 'observe' }, { action: 'screenshot' },
    { action: 'click', ref: observedKey.nodes.find(node => node.name === 'Apply draft').ref },
    { action: 'press', ref: observedKey.nodes.find(node => node.name === 'Page draft').ref, key: 'Enter' },
    { action: 'scroll', observationId: observedKey.observationId, deltaX: 0, deltaY: 620 },
  ]);
  expect(unauthorized).toEqual({ authorized: false, isError: false });
  expect(denied).toEqual(Array(5).fill(expect.objectContaining({ isError: true, error: expect.stringContaining('Allow a Web tab') })));

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
  const beforeHistoryRefusal = foreignHits;
  expect(await prompt([{action:'back'}])).toEqual([
    expect.objectContaining({ outcome:'rejected', reason:expect.stringContaining('outside the authorized site') }),
  ]);
  expect(foreignHits).toBe(beforeHistoryRefusal);
  await browserCommand({ action: 'web_close', id: original });
  await expect.poll(async () => await document(original) ?? null).toBe(null);
  expect(await prompt([{ action: 'status' }])).toEqual([{ authorized: false, isError: false }]);

  const framed = site.origin + '/framed';
  await open(framed);
  await confirm(1);
  await expect.poll(async () => (await document(framed))?.observation.notice).toBe('Browser Use allowed');
  expect(await prompt([{ action: 'screenshot' }])).toEqual([
    expect.objectContaining({ isError: true, error: expect.stringContaining('frame outside the authorized site') }),
  ]);

  const controlsUrl = site.origin + '/controls';
  await open(controlsUrl);
  await confirm(1);
  await expect.poll(async () => (await document(controlsUrl))?.observation.notice).toBe('Browser Use allowed');
  const formThread = await active();
  const archive = { by: 'label', value: 'Include archived' };
  const mode = { by: 'role', role: 'combobox', name: 'Mode' };
  const status = { by: 'testId', value: 'status' };
  const available = { by: 'testId', value: 'available' };
  const form = await prompt([
    { action: 'observe' },
    { action: 'locate', locator: { by: 'role', role: 'button', name: 'Duplicate' } },
    { action: 'locate', locator: archive }, { action: 'setChecked', name: 'Include archived', checked: true },
    { action: 'wait', locator: archive, condition: { kind: 'checked', value: true } },
    { action: 'setChecked', name: 'Include archived', checked: true },
    { action: 'locate', locator: mode }, { action: 'selectOption', name: 'Mode', value: 'blocked' },
    { action: 'locate', locator: mode }, { action: 'selectOption', name: 'Mode', value: 'full' },
    { action: 'wait', locator: mode, condition: { kind: 'value', value: 'full' } },
    { action: 'locate', locator: available },
    { action: 'locate', locator: { by: 'testId', value: 'defer' } }, { action: 'click', name: 'Start deferred update' },
    { action: 'wait', locator: available, condition: { kind: 'enabled' } },
    { action: 'wait', locator: status, condition: { kind: 'text', value: 'Deferred ready' } },
    { action: 'locate', locator: { by: 'text', value: 'Deferred ready' } },
    { action: 'wait', locator: { by: 'testId', value: 'missing' }, condition: { kind: 'visible' }, timeoutMs: 150 },
    { action: 'wait', locator: { by: 'testId', value: 'missing' }, condition: { kind: 'hidden' } },
  ]);
  expect(Array.isArray(form), JSON.stringify(form)).toBe(true);
  const [layout, duplicate, unchecked, set, checked, repeatSet, menuOptions, blockedOption, , select,
    selected, disabledControl, , , enabled, ready, readyText, timedOut, hidden] = form;
  expect(layout.frames).toEqual([
    { selector: { by: 'title', value: 'Details' }, sameOrigin: true },
    { selector: { by: 'title', value: 'Outside' }, sameOrigin: false },
  ]);
  expect(duplicate).toMatchObject({ isError: true, error: expect.stringContaining('ambiguous') });
  expect(unchecked.nodes[0]).toMatchObject({ state: { checked: false, disabled: false } });
  expect(set).toMatchObject({ outcome: 'dispatched' });
  expect(checked).toMatchObject({ matched: true, nodes: [expect.objectContaining({ state: { checked: true, disabled: false } })] });
  expect(repeatSet).toMatchObject({ outcome: 'dispatched' });
  expect(menuOptions.nodes[0].state.options).toEqual(expect.arrayContaining([expect.objectContaining({ value: 'blocked', disabled: true })]));
  expect(blockedOption).toMatchObject({ outcome: 'rejected', reason: expect.stringContaining('disabled') });
  expect(select).toMatchObject({ outcome: 'dispatched' });
  expect(selected).toMatchObject({ matched: true, nodes: [expect.objectContaining({ state: expect.objectContaining({ value: 'full' }) })] });
  expect(disabledControl.nodes[0]).toMatchObject({ state: { disabled: true } });
  expect(enabled).toMatchObject({ matched: true, nodes: [expect.objectContaining({ state: { disabled: false } })] });
  expect(ready).toMatchObject({ matched: true, nodes: [expect.objectContaining({ text: 'Deferred ready' })] });
  expect(readyText.nodes[0]).toMatchObject({ text: 'Deferred ready' });
  expect(timedOut).toMatchObject({ kind: 'waitTimeout', matched: false, timeoutMs: 150 });
  expect(timedOut).not.toHaveProperty('observationId');
  expect(hidden).toMatchObject({ matched: true, nodes: [] });

  const outer = [{ by: 'title', value: 'Details' }];
  const framedPath = [...outer, { by: 'testId', value: 'nested-frame' }];
  const detail = { by: 'label', value: 'Detail draft' };
  const applyDetail = { by: 'role', role: 'button', name: 'Apply detail' };
  const frame = await prompt([
    { action: 'observe', frame: outer },
    { action: 'locate', frame: framedPath, locator: detail }, { action: 'fill', name: 'Detail draft', text: 'Inside frame' },
    { action: 'wait', frame: framedPath, locator: detail, condition: { kind: 'value', value: 'Inside frame' } },
    { action: 'press', name: 'Detail draft', key: 'Enter' },
    { action: 'wait', frame: framedPath, locator: { by: 'testId', value: 'detail-key' }, condition: { kind: 'text', value: 'Frame Enter' } },
    { action: 'locate', frame: framedPath, locator: applyDetail }, { action: 'click', name: 'Apply detail' },
    { action: 'wait', frame: framedPath, locator: { by: 'testId', value: 'detail-status' }, condition: { kind: 'text', value: 'Applied: Inside frame' } },
    { action: 'observe', frame: [{ by: 'title', value: 'Outside' }] },
  ]);
  expect(Array.isArray(frame), JSON.stringify(frame)).toBe(true);
  const [outerPage, draft, filled, draftValue, framePress, frameKey, locatedClick, frameClick, frameResult, foreignFrame] = frame;
  expect(outerPage).toMatchObject({ title: 'Details', frame: outer, frames: [{ selector: framedPath[1], sameOrigin: true }] });
  expect(draft).toMatchObject({ frame: framedPath, frameUrl: site.origin + '/nested' });
  expect(filled).toMatchObject({ outcome: 'dispatched' });
  expect(draftValue).toMatchObject({ matched: true });
  expect(framePress).toMatchObject({ outcome: 'dispatched' });
  expect(frameKey).toMatchObject({ matched: true, nodes: [expect.objectContaining({ text: 'Frame Enter' })] });
  expect(frameClick).toMatchObject({ outcome: 'dispatched' });
  expect(frameResult).toMatchObject({ matched: true, nodes: [expect.objectContaining({ text: 'Applied: Inside frame' })] });
  expect(foreignFrame).toMatchObject({ isError: true, error: expect.stringContaining('outside the authorized origin') });

  const readControls = expression => app.evaluate(({ webContents }, { url, expression }) => webContents
    .getAllWebContents().find(view => view.getURL() === url).executeJavaScript(expression), { url: controlsUrl, expression });
  expect(await readControls(`({
    checked: document.querySelector('#archive').checked,
    changes: window.checkboxChanges,
    mode: document.querySelector('#mode').value,
    applied: document.querySelector('[title=Details]').contentDocument
      .querySelector('[data-testid=nested-frame]').contentDocument.querySelector('[data-testid=detail-status]').textContent
  })`)).toEqual({ checked: true, changes: 1, mode: 'full', applied: 'Applied: Inside frame' });
  const [oldFrame] = await prompt([{ action: 'locate', frame: framedPath, locator: applyDetail }]);
  await readControls(`document.querySelector('[title=Details]').contentDocument
    .querySelector('[data-testid=nested-frame]').contentWindow.location.reload()`);
  await expect.poll(() => readControls(`document.querySelector('[title=Details]').contentDocument
    .querySelector('[data-testid=nested-frame]').contentDocument.querySelector('[data-testid=detail-status]')?.textContent`)).toBe('Not applied');
  expect(await prompt([{ action: 'click', ref: oldFrame.nodes[0].ref }])).toEqual([
    expect.objectContaining({ isError: true, outcome: 'rejected', reason: expect.stringContaining('iframe changed') }),
  ]);

  const [duplicateTab] = await prompt([{ action: 'open', tabId: controlsUrl, url: controlsUrl }]);
  expect(duplicateTab).toMatchObject({ kind:'tabOpened', authorized:false, tabId:expect.stringMatching(/^web-tab:/) });
  const tabId = duplicateTab.tabId;
  await expect.poll(async () => (await document(tabId))?.observation.load.kind).toBe('ready');
  const [beforeApproval, unknownTab] = await prompt([{ action: 'tabs' }, { action: 'status', tabId }]);
  expect(beforeApproval.tabs.map(tab => tab.tabId)).toContain(controlsUrl);
  expect(beforeApproval.tabs.map(tab => tab.tabId)).not.toContain(tabId);
  expect(unknownTab).toEqual({ authorized:false, isError:false });
  await confirm(1);
  await expect.poll(async () => (await document(tabId))?.observation.notice).toBe('Browser Use allowed');
  const [both, distinctValue, activate] = await prompt([
    { action: 'tabs' }, { action: 'locate', tabId, locator: mode }, { action: 'activate', tabId:controlsUrl },
  ]);
  expect(both.tabs).toEqual(expect.arrayContaining([
    expect.objectContaining({ tabId, url:controlsUrl }), expect.objectContaining({ tabId:controlsUrl, url:controlsUrl }),
  ]));
  expect(distinctValue.nodes[0]).toMatchObject({ state: { value:'basic' } });
  expect(activate).toMatchObject({ kind:'tabActivated', tabId:controlsUrl });
  await expect.poll(async () => (await state()).activeContent?.value).toBe(controlsUrl);
  expect((await prompt([{ action:'locate', tabId:controlsUrl, locator:mode }]))[0].nodes[0]).toMatchObject({ state:{ value:'full' } });
  await prompt([{ action:'activate', tabId }]);
  await expect.poll(async () => (await state()).activeContent?.value).toBe(tabId);

  const filesUrl = site.origin + '/files';
  const history = await prompt([
    { action:'navigate', tabId, url:filesUrl }, { action:'back', tabId },
    { action:'forward', tabId }, { action:'reload', tabId },
  ]);
  expect(history).toEqual([
    expect.objectContaining({ outcome:'dispatched' }),
    expect.objectContaining({ outcome:'dispatched', url:controlsUrl }),
    expect.objectContaining({ outcome:'dispatched', url:filesUrl }),
    expect.objectContaining({ outcome:'dispatched', url:filesUrl }),
  ]);
  expect(filePageLoads).toBeGreaterThanOrEqual(2);
  expect((await document(controlsUrl)).observation.url).toBe(controlsUrl);

  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled:false, filePaths:[path] }); }, attachment);
  const attach = (await state()).composerBounds.context;
  await page.mouse.click(attach.x + attach.width / 2, attach.y + attach.height / 2);
  // This fixture does not advertise images, so the Image entry is disabled.
  for (let i=0; i<2; i++) await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state()).attachments).toEqual(['browser-input.txt']);
  const fileThread = await active();
  const beforeDownload = foreignHits;
  const transfers = await prompt([
    { action:'files', tabId },
    { action:'locate', tabId, locator:{by:'label',value:'Upload source'} },
    { action:'upload', tabId, name:'Upload source', fileRef:'sha256:'+'0'.repeat(64) },
    { action:'upload', tabId, name:'Upload source' },
    { action:'locate', tabId, locator:{by:'role',role:'link',name:'Cross-origin download'} },
    { action:'download', tabId, name:'Cross-origin download' },
    { action:'locate', tabId, locator:{by:'role',role:'link',name:'Report download'} },
    { action:'download', tabId, name:'Report download' },
    { action:'locate', tabId, locator:{by:'role',role:'button',name:'Send attachment'} },
    { action:'click', tabId, name:'Send attachment' },
  ]);
  expect(Array.isArray(transfers), JSON.stringify(transfers)).toBe(true);
  expect(transfers[0].files).toEqual([expect.objectContaining({
    name:'browser-input.txt', ref:'sha256:'+createHash('sha256').update(attachmentText).digest('hex'),
  })]);
  expect(transfers[2]).toMatchObject({ isError:true, error:expect.stringContaining('does not belong') });
  expect(transfers[3]).toMatchObject({ outcome:'dispatched' });
  expect(transfers[5]).toMatchObject({ isError:true, reason:expect.stringContaining('outside the authorized site') });
  expect(foreignHits).toBe(beforeDownload);
  const downloadable = transfers[7];
  expect(downloadable).toMatchObject({ outcome:'dispatched', transfer:{ bytes:Buffer.byteLength(downloadText), url:site.origin+'/report.csv' } });
  expect(transfers[9]).toMatchObject({ outcome:'dispatched' });
  await expect.poll(() => uploaded).toEqual({name:'browser-input.txt', text:attachmentText});
  await expect.poll(async () => (await document(tabId))?.observation.title).toBe('Upload receipt');
  const artifact = downloadable.transfer.artifactReceipt.artifact;
  const version = artifact.versions[0];
  expect(version).toMatchObject({ filename:'report.csv', version:1, sha256:createHash('sha256').update(downloadText).digest('hex') });
  expect(artifact.thread_id).toBe(fileThread.id);
  const threadDigest=createHash('sha256').update(fileThread.id).digest('hex');
  expect(await readFile(resolve(temp,'settings.artifacts',threadDigest,'snapshots',version.sha256+'.bin'),'utf8')).toBe(downloadText);
  expect((await readdir(workspace)).filter(name=>name.startsWith('.pero-browser-download-'))).toEqual([]);
  await expect.poll(async () => (await state()).artifacts?.items?.map(item => item.id)||[]).toContain(artifact.id);
  const [backToFiles, backToControls] = await prompt([{action:'back',tabId},{action:'back',tabId}]);
  expect(backToFiles).toMatchObject({url:filesUrl});
  expect(backToControls).toMatchObject({url:controlsUrl});

  const beforeOpenRefusal = foreignHits;
  const [blockedTab] = await prompt([{action:'open',tabId,url:site.origin+'/redirect'}]);
  expect(blockedTab).toMatchObject({kind:'tabOpened',authorized:false});
  await expect.poll(async () => (await document(blockedTab.tabId))?.observation.load).toMatchObject({
    kind:'failed', message:expect.stringContaining('outside the authorized site'),
  });
  expect(foreignHits).toBe(beforeOpenRefusal);
  await browserCommand({action:'web_close',id:blockedTab.tabId});
  await expect.poll(() => document(blockedTab.tabId)).toBeUndefined();
  await expect.poll(async () => (await state()).activeContent?.value).toBe(tabId);

  const [scratch] = await prompt([{action:'open',tabId,url:site.origin+'/scratch'}]);
  await expect.poll(async () => (await document(scratch.tabId))?.observation.load.kind).toBe('ready');
  await confirm(1);
  await expect.poll(async () => (await document(scratch.tabId))?.observation.notice).toBe('Browser Use allowed');
  const [closed, remaining] = await prompt([{action:'closeTab',tabId:scratch.tabId},{action:'tabs'}]);
  expect(closed).toMatchObject({kind:'tabClosed',tabId:scratch.tabId});
  expect(remaining.tabs.map(tab=>tab.tabId)).toEqual(expect.arrayContaining([controlsUrl,tabId]));
  expect(remaining.tabs.map(tab=>tab.tabId)).not.toContain(scratch.tabId);

  const evidence = resolve(profile, 'browser-use-evidence');
  const directory = createHash('sha256').update(thread.id).digest('hex');
  const names = await readdir(resolve(evidence, directory));
  const saved = await Promise.all(names.filter(name => name.endsWith('.json'))
    .map(name => readFile(resolve(evidence, directory, name), 'utf8').then(JSON.parse)));
  const fill = actions[2].receiptId;
  expect(saved).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: fill, observationId: actions[1].observationId, thread: thread.id, action: 'fill' }),
    expect.objectContaining({ id: fill, outcome: 'dispatched' }),
    expect.objectContaining({ id: actions[1].observationId, outcome: expect.objectContaining({ kind: 'observation' }) }),
    expect.objectContaining({ id: enter.receiptId, action: 'press', key: 'Enter' }),
    expect.objectContaining({ id: enter.receiptId, outcome: 'dispatched' }),
    expect.objectContaining({ id: scroll.receiptId, action: 'scroll', observationId: observedKey.observationId, deltaY: 620 }),
    expect.objectContaining({ id: scroll.receiptId, outcome: 'dispatched' }),
  ]));
  expect(saved.find(record => record.id === fill && record.action === 'fill')).not.toHaveProperty('text');
  expect(saved).toContainEqual(screenshot.receipt);
  const frameReceipts = resolve(evidence, createHash('sha256').update(formThread.id).digest('hex'));
  expect(JSON.parse(await readFile(resolve(frameReceipts, frameClick.receiptId + '.intent.json'), 'utf8'))).toMatchObject({
    action: 'click', observationId: locatedClick.observationId, frame: framedPath, frameUrl: site.origin + '/nested',
  });
  const capture = await readFile(resolve(evidence, directory, screenshot.receipt.id + '.png'));
  expect(createHash('sha256').update(capture).digest('hex')).toBe(screenshot.pixels.sha256);
  await writeFile(resolve(output, 'browser-viewport.png'), capture);
  await page.screenshot({ path: resolve(output, 'workbench.png') });
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).connected && !document.getElementById('loading'));
  await expect.poll(async () => {
    const docs=(await state()).webDocuments;
    return [controlsUrl,tabId].map(id=>docs.find(item=>item.id===id)?.observation);
  }).toEqual([0,1].map(()=>expect.objectContaining({url:controlsUrl,load:{kind:'ready'}})));
  const restoredModes = await app.evaluate(async ({ webContents }, url) => Promise.all(webContents.getAllWebContents()
    .filter(view=>view.getURL()===url).map(view=>view.executeJavaScript("document.querySelector('#mode').value"))), controlsUrl);
  expect(restoredModes.sort()).toEqual(['basic','full']);
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ passed: true, actions, input, navigation, displayed, scrollY, denied, form, frame, history, uploaded, transfers, restoredModes, foreignHits }, null, 2));
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

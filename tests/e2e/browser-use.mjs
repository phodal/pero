import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { electron } from './electron.mjs';
import { browserFiles, browserInputCommands, browserInputFrame, browserInputPage, verifyBrowserInputs } from '../fixtures/browser-use-inputs.mjs';
import { browserDiagnosticPage, checkEmbeddedDiagnostics, serveDiagnosticAssets } from '../fixtures/browser-diagnostics.mjs';
import { axPath, axPage, axFramePath, axFramePage, foreignAxPath, foreignAxPage, checkEmbeddedAccessibility } from '../fixtures/browser-accessibility.mjs';
import { checkSiteTools, siteToolPage, partnerSiteToolPath, partnerSiteToolPage } from '../fixtures/browser-site-tools.mjs';
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
const batchFiles = browserFiles.map(({ name }) => resolve(workspace, name));
await Promise.all(batchFiles.map((path, index) => writeFile(path, browserFiles[index].text)));
const downloadText = 'status,value\nverified,7\n';
const linkedBlobText = 'source,城市\nlink,上海\n';
const scriptedBlobText = 'source,城市\nbutton,南京\n';
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
const foreign = await serve((request, response) => {
  if (serveDiagnosticAssets(request, response, site.origin)) return;
  if (request.url.startsWith('/diagnostic-cross-origin?')) { response.writeHead(204).end(); return; }
  if (request.url === foreignAxPath) { response.setHeader('Content-Type', 'text/html'); response.end(foreignAxPage); return; }
  if (request.url === partnerSiteToolPath) { response.setHeader('Content-Type', 'text/html'); response.end(partnerSiteToolPage(site.origin)); return; }
  foreignHits++;
  response.end('Foreign tab');
});
const site = await serve(async (request, response) => {
  if (serveDiagnosticAssets(request, response, foreign.origin)) return;
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (request.url.startsWith('/diagnostic-request?')) { response.writeHead(202).end(); return; }
  if (request.url === '/diagnostics') { response.end(browserDiagnosticPage(foreign.origin)); return; }
  if (request.url === axPath || request.url === axFramePath) { response.end(request.url === axPath ? axPage(foreign.origin) : axFramePage); return; }
  if (request.url === '/webmcp' || request.url === '/webmcp-frame') {
    response.end(siteToolPage(request.url === '/webmcp-frame', foreign.origin));
    return;
  }
  if (request.url === '/redirect') {
    response.writeHead(302, { Location: foreign.origin });
    response.end();
    return;
  }
  if (request.url === '/batch-frame') {
    response.end(browserInputFrame);
    return;
  }
  if (request.url === '/batch-inputs') {
    response.end(browserInputPage);
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
  if (request.url.split('?', 1)[0] === '/download-entry') {
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
  if (request.url === '/popup-target') {
    response.end('<title>Page opened tab</title><h1>Opened by the page</h1>');
    return;
  }
  if (request.url === '/dialogs') {
    response.end(`<!doctype html><title>Embedded JavaScript dialogs</title>
      <button onclick="document.querySelector('output').textContent = String(confirm('Embedded fixture confirm'))">Open confirmation</button>
      <button onclick="setTimeout(() => { alert('Embedded fixture alert'); document.querySelector('output').textContent = 'alert closed'; }, 150)">Open delayed alert</button>
      <output data-testid="dialog-result">Waiting</output>`);
    return;
  }
  if (request.url === '/arrival-dialog') {
    response.end(`<!doctype html><title>Arrival dialog</title><output data-testid="dialog-result">Waiting</output>
      <script>alert('Embedded fixture arrival'); document.querySelector('output').textContent = 'arrival resumed';</script>`);
    return;
  }
  if (request.url === '/page-effects') {
    response.end(`<!doctype html><title>Browser page effects</title>
      <a href="/popup-target" target="_blank">Open target blank</a>
      <button id="script-popup">Open from script</button>
      <button id="foreign-popup">Open foreign site</button>
      <p><a id="linked-blob" download="linked-blob.csv">Save linked Blob</a></p>
      <button id="script-blob">Generate Blob report</button>
      <button id="large-blob">Generate oversized Blob</button>
      <form action="/download-entry"><button>Submit HTTP download</button></form>
      <button id="no-download" onclick="location.href='/popup-target'">Navigate instead</button>
      <script>
        document.querySelector('#script-popup').onclick = () => setTimeout(() => window.open('/popup-target', '_blank'), 150);
        document.querySelector('#foreign-popup').onclick = () => window.open(${JSON.stringify(foreign.origin)}, '_blank');
        const blob = text => URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
        document.querySelector('#linked-blob').href = blob(${JSON.stringify(linkedBlobText)});
        function download(text, name) {
          const link = document.createElement('a');
          link.href = blob(text);
          link.download = name;
          document.body.append(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(link.href), 0);
        }
        document.querySelector('#script-blob').onclick = event => {
          if (event.isTrusted) download(${JSON.stringify(scriptedBlobText)}, 'scripted-blob.csv');
        };
        document.querySelector('#large-blob').onclick = () => download('x'.repeat(10 * 1024 * 1024 + 1), 'large-blob.csv');
      </script>`);
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
  if (request.url === '/interactions') {
    response.end(`<!doctype html><title>Browser interactions</title>
      <style>
        body { margin: 0; }
        #capture { position: absolute; left: 16px; top: 8px; width: 356px; height: 116px;
          background: #2468b4; color: white; font: 16px sans-serif; }
        #capture p { margin: 12px; }
        main { padding: 132px 24px 16px; font: 16px sans-serif; }
        [contenteditable] { border: 1px solid; width: 260px; margin: 6px 0; }
        .stack { position: relative; width: 200px; height: 32px; margin: 6px 0; }
        .stack > * { position: absolute; inset: 0; }
      </style>
      <div id="capture"><p>Browser Use interactions</p>
        <p data-testid="hover-result">Awaiting hover</p><p data-testid="double-result">Awaiting double-click</p></div>
      <main>
        <span data-testid="hover-target" aria-label="Hover target">Hover target</span> <button id="double">Open details</button>
        <div class="stack"><button id="under">Underlying action</button><button id="remove">Replace on click</button></div>
        <div class="stack"><button>Covered action</button><div aria-hidden="true" style="background: #ddd"></div></div>
        <label>Modes <select id="modes" multiple>
          <option value="alpha">Alpha</option><option value="beta" selected>Beta</option><option value="gamma">Gamma</option>
          <optgroup label="Unavailable" disabled><option value="blocked">Blocked</option></optgroup>
          <option value="repeat">Repeat one</option><option value="repeat">Repeat two</option>
        </select></label>
        <div contenteditable="true" id="editor" aria-label="Editable note"><strong>Initial note</strong></div>
        <div contenteditable="true" id="read-only" aria-label="Read-only note" aria-readonly="true">Keep this text</div>
      </main>
      <div aria-hidden="true" style="position:absolute;top:2100px;left:0;right:0;height:100px;background:#2468b4"></div>
      <script>
        const metrics = window.interactionEvents = { clickDetails: [], underlyingClicks: 0, selectionInputs: 0, selectionChanges: 0, edits: 0 };
        document.querySelector('[data-testid=hover-target]').addEventListener('mouseenter', event => {
          if (event.isTrusted) document.querySelector('[data-testid=hover-result]').textContent = 'Trusted hover';
        });
        const button = document.querySelector('#double');
        button.addEventListener('click', event => { if (event.isTrusted) metrics.clickDetails.push(event.detail); });
        button.addEventListener('dblclick', event => {
          if (event.isTrusted) document.querySelector('[data-testid=double-result]').textContent = 'Trusted double-click';
        });
        document.querySelector('#remove').addEventListener('click', event => { if (event.isTrusted) event.target.remove(); });
        document.querySelector('#under').addEventListener('click', () => metrics.underlyingClicks++);
        const modes = document.querySelector('#modes');
        modes.addEventListener('input', () => metrics.selectionInputs++);
        modes.addEventListener('change', () => metrics.selectionChanges++);
        document.querySelector('#editor').addEventListener('input', () => metrics.edits++);
      </script>`);
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
  const menu = (id, checked) => app.evaluate(({ Menu, BrowserWindow }, { id, checked }) => {
    const item = Menu.getApplicationMenu().getMenuItemById(id);
    if (!item) throw new Error(`Missing desktop menu action ${id}`);
    if (checked === undefined || item.checked !== checked) item.click(undefined, BrowserWindow.getAllWindows()[0]);
    if (checked !== undefined && item.checked !== checked) throw new Error(`Menu action ${id} did not toggle.`);
  }, { id, checked });
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

  const diagnostics = await checkEmbeddedDiagnostics({ app, origin: site.origin, foreignOrigin: foreign.origin,
    menu, prompt, open, confirm, document });
  const accessibility = await checkEmbeddedAccessibility({ app, origin: site.origin, prompt, open, confirm, document });

  const siteTools = await checkSiteTools({ app, origin: site.origin, foreignOrigin: foreign.origin, menu, prompt, open, confirm, document,
    receiptDir: resolve(profile, 'browser-use-evidence', createHash('sha256').update((await active()).id).digest('hex')) });

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
    { action: 'hover', ref: observedKey.nodes.find(node => node.name === 'Apply draft').ref },
    { action: 'dblclick', ref: observedKey.nodes.find(node => node.name === 'Apply draft').ref },
    { action: 'screenshot', clip: { x: 0, y: 0, width: 10, height: 10 } },
  ]);
  expect(unauthorized).toEqual({ authorized: false, isError: false });
  expect(denied).toEqual(Array(8).fill(expect.objectContaining({ isError: true, error: expect.stringContaining('Allow a Web tab') })));

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
  expect(await prompt([{ action: 'screenshot' },
    { action: 'screenshot', clip: { x: 0, y: 0, width: 10, height: 10 } }, { action: 'screenshot', fullPage: true }])).toEqual(
    Array(3).fill(expect.objectContaining({ isError: true, error: expect.stringContaining('frame outside the authorized site') })));

  const interactionsUrl = site.origin + '/interactions';
  await open(interactionsUrl);
  await confirm(1);
  await expect.poll(async () => (await document(interactionsUrl))?.observation.notice).toBe('Browser Use allowed');
  const interactionThread = await active();
  const locateInteraction = name => ({ action: 'locate', locator: { by: 'role', role: 'button', name } });
  const readInteraction = expression => app.evaluate(({ webContents }, { url, expression }) => webContents
    .getAllWebContents().find(view => view.getURL() === url).executeJavaScript(expression), { url: interactionsUrl, expression });
  const scale = await readInteraction('window.devicePixelRatio');
  const clip = { x: Math.round(24 * scale), y: Math.round(16 * scale),
    width: Math.round(340 * scale), height: Math.round(100 * scale) };
  const pointer = await prompt([
    { action: 'locate', locator: { by: 'testId', value: 'hover-target' } }, { action: 'hover', name: 'Hover target' },
    { action: 'hover', name: 'Hover target' },
    { action: 'wait', locator: { by: 'testId', value: 'hover-result' }, condition: { kind: 'text', value: 'Trusted hover' } },
    locateInteraction('Covered action'), { action: 'hover', name: 'Covered action' },
    locateInteraction('Open details'), { action: 'dblclick', name: 'Open details' },
    { action: 'wait', locator: { by: 'testId', value: 'double-result' }, condition: { kind: 'text', value: 'Trusted double-click' } },
    locateInteraction('Replace on click'), { action: 'dblclick', name: 'Replace on click' },
    { action: 'screenshot', clip }, { action: 'screenshot', clip: { ...clip, x: 1000000 } },
  ]);
  expect(Array.isArray(pointer), JSON.stringify(pointer)).toBe(true);
  const [hoveredTarget, hover, staleHover, hoverResult, , covered, doubleTarget, double, doubleResult, , replaced, cropped, outsideClip] = pointer;
  expect(hoveredTarget.nodes[0].actions).toContain('hover');
  expect(hover).toMatchObject({ outcome: 'dispatched', verified: false });
  expect(staleHover).toMatchObject({ isError: true, error: expect.stringContaining('stale') });
  expect(hoverResult).toMatchObject({ matched: true });
  expect(covered).toMatchObject({ isError: true, outcome: 'rejected', reason: expect.stringContaining('covered') });
  expect(doubleTarget.nodes[0].actions).toContain('dblclick');
  expect(double).toMatchObject({ outcome: 'dispatched', verified: false });
  expect(doubleResult).toMatchObject({ matched: true });
  expect(replaced).toMatchObject({ outcome: 'unknown', verified: false });
  expect(await readInteraction('window.interactionEvents')).toMatchObject({ clickDetails: [1, 2], underlyingClicks: 0 });
  expect(cropped).toMatchObject({ kind: 'screenshot', isError: false, receipt: { ...cropped.pixels, clip } });
  expect(cropped.pixels).toMatchObject({ width: clip.width, height: clip.height });
  expect(outsideClip).toMatchObject({ isError: true, error: expect.stringContaining('inside the visible viewport') });

  const interactionEvidence = resolve(profile, 'browser-use-evidence', createHash('sha256').update(interactionThread.id).digest('hex'));
  for (const [observation, receipt, action] of [[hoveredTarget, hover, 'hover'], [doubleTarget, double, 'dblclick']]) {
    expect(JSON.parse(await readFile(resolve(interactionEvidence, receipt.receiptId + '.intent.json'), 'utf8'))).toMatchObject({
      action, observationId: observation.observationId, ref: observation.nodes[0].ref, tabId: interactionsUrl,
    });
  }
  expect(JSON.parse(await readFile(resolve(interactionEvidence, cropped.receipt.id + '.json'), 'utf8'))).toEqual(cropped.receipt);
  const croppedPng = await readFile(resolve(interactionEvidence, cropped.receipt.id + '.png'));
  expect(createHash('sha256').update(croppedPng).digest('hex')).toBe(cropped.pixels.sha256);
  await writeFile(resolve(output, 'browser-clip.png'), croppedPng);
  const corners = await app.evaluate(({ nativeImage }, png) => {
    const pixels = nativeImage.createFromBuffer(Buffer.from(png, 'base64')).toBitmap();
    return [...pixels.subarray(0, 4), ...pixels.subarray(-4)];
  }, croppedPng.toString('base64'));
  // NativeImage decodes into the display color space, which may round a channel by one.
  const marker = [180, 104, 36, 255];
  for (const [index, channel] of corners.entries())
    expect(Math.abs(channel - marker[index % marker.length])).toBeLessThanOrEqual(2);

  const [full, conflictingCapture] = await prompt([
    { action: 'screenshot', fullPage: true }, { action: 'screenshot', fullPage: true, clip },
  ]);
  expect(conflictingCapture).toMatchObject({ isError: true });
  expect(full).toMatchObject({ kind: 'screenshot', isError: false, receipt: { ...full.pixels, fullPage: true } });
  const { innerHeight, scrollHeight, scrollY: currentScroll } = await readInteraction('({ innerHeight, scrollHeight: document.documentElement.scrollHeight, scrollY })');
  expect(currentScroll).toBe(0);
  expect(full.pixels.height).toBeGreaterThan(innerHeight);
  const fullPng = await readFile(resolve(interactionEvidence, full.receipt.id + '.png'));
  expect(createHash('sha256').update(fullPng).digest('hex')).toBe(full.pixels.sha256);
  const bottomPixel = await app.evaluate(({ nativeImage }, { data, y }) => {
    const image = nativeImage.createFromBuffer(Buffer.from(data, 'base64'));
    return [...image.crop({ x: 5, y: Math.round(image.getSize().height * y), width: 1, height: 1 }).toBitmap()];
  }, { data: fullPng.toString('base64'), y: 2150 / scrollHeight });
  expect(bottomPixel).toHaveLength(4);
  for (const [index, channel] of bottomPixel.entries())
    expect(Math.abs(channel - marker[index])).toBeLessThanOrEqual(2);
  await writeFile(resolve(output, 'browser-full-page.png'), fullPng);

  const modes = { action: 'locate', locator: { by: 'role', role: 'listbox', name: 'Modes' } };
  const note = { by: 'role', role: 'textbox', name: 'Editable note' };
  const noteText = 'Literal <b>markup</b>\nSecond line';
  const edits = await prompt([
    modes, { action: 'selectOption', name: 'Modes', value: ['alpha', 'gamma'] },
    modes, { action: 'selectOption', name: 'Modes', value: ['gamma', 'alpha'] },
    modes, { action: 'selectOption', name: 'Modes', value: ['beta', 'blocked'] },
    modes, { action: 'selectOption', name: 'Modes', value: ['repeat'] }, modes,
    { action: 'locate', locator: note }, { action: 'fill', name: 'Editable note', text: noteText },
    { action: 'wait', locator: note, condition: { kind: 'value', value: noteText } },
    { action: 'locate', locator: { by: 'label', value: 'Read-only note' } },
    { action: 'fill', name: 'Read-only note', text: 'Should not change' },
  ]);
  expect(Array.isArray(edits), JSON.stringify(edits)).toBe(true);
  const [initialModes, chosen, , repeated, , disabledOption, , ambiguousOption, selectedModes, , edited, editedNote, , readOnlyFill] = edits;
  expect(initialModes.nodes[0].actions).toContain('selectOption');
  expect(chosen).toMatchObject({ outcome: 'dispatched' });
  expect(repeated).toMatchObject({ outcome: 'dispatched' });
  expect(disabledOption).toMatchObject({ outcome: 'rejected' });
  expect(ambiguousOption).toMatchObject({ outcome: 'rejected' });
  expect(selectedModes.nodes[0].state.options.filter(option => option.selected).map(option => option.value)).toEqual(['alpha', 'gamma']);
  expect(edited).toMatchObject({ outcome: 'dispatched' });
  expect(editedNote).toMatchObject({ matched: true, nodes: [{ state: { value: noteText } }] });
  expect(readOnlyFill).toMatchObject({ outcome: 'rejected' });
  expect(await readInteraction(`({
    events: window.interactionEvents,
    selected: Array.from(document.querySelector('#modes').selectedOptions, option => option.value),
    text: document.querySelector('#editor').innerText,
    bold: document.querySelector('#editor b, #editor strong') !== null,
    readOnly: document.querySelector('#read-only').innerText,
  })`)).toMatchObject({ events: { selectionInputs: 1, selectionChanges: 1, edits: 1 }, selected: ['alpha', 'gamma'],
    text: noteText, bold: false, readOnly: 'Keep this text' });
  expect(JSON.parse(await readFile(resolve(interactionEvidence, edited.receiptId + '.intent.json'), 'utf8'))).not.toHaveProperty('text');
  const [, cleared, empty] = await prompt([modes, { action: 'selectOption', name: 'Modes', value: [] }, modes]);
  expect(cleared).toMatchObject({ outcome: 'dispatched' });
  expect(empty.nodes[0].state.options.some(option => option.selected)).toBe(false);

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

  const effectsUrl = site.origin + '/page-effects';
  const popupUrl = site.origin + '/popup-target';
  await open(effectsUrl);
  await confirm(1);
  await expect.poll(async () => (await document(effectsUrl))?.observation.notice).toBe('Browser Use allowed');
  const effectsThread = await active();
  const effectsEvidence = resolve(profile, 'browser-use-evidence', createHash('sha256').update(effectsThread.id).digest('hex'));
  const target = (name, role = 'button') => ({ action: 'locate', locator: { by: 'role', role, name } });
  const [, linkPopup] = await prompt([target('Open target blank', 'link'), { action: 'click', name: 'Open target blank', expectPopup: true }]);
  expect(linkPopup).toMatchObject({ outcome: 'dispatched', popup: { kind: 'tabOpened', authorized: false, tabId: expect.stringMatching(/^web-tab:/) } });
  const popupId = linkPopup.popup.tabId;
  await expect.poll(async () => (await document(popupId))?.observation).toMatchObject({ url: popupUrl, load: { kind: 'ready' } });
  const [unauthorizedPopup, refusedPopup, popupTabs] = await prompt([
    { action: 'status', tabId: popupId }, { action: 'observe', tabId: popupId }, { action: 'tabs' },
  ]);
  expect(unauthorizedPopup).toMatchObject({ authorized: false });
  expect(refusedPopup).toMatchObject({ isError: true, error: expect.stringContaining('Allow a Web tab') });
  expect(popupTabs.tabs.map(tab => tab.tabId)).not.toContain(popupId);
  await confirm(1);
  await expect.poll(async () => (await document(popupId))?.observation.notice).toBe('Browser Use allowed');
  expect((await prompt([{ action: 'observe', tabId: popupId }]))[0]).toMatchObject({ url: popupUrl, title: 'Page opened tab' });
  expect(JSON.parse(await readFile(resolve(effectsEvidence, linkPopup.receiptId + '.result.json'), 'utf8'))).toMatchObject({ popup: linkPopup.popup });

  await open(effectsUrl);
  const [, scriptPopup] = await prompt([target('Open from script'), { action: 'click', name: 'Open from script', expectPopup: true }]);
  expect(scriptPopup).toMatchObject({ outcome: 'dispatched', popup: { kind: 'tabOpened', authorized: false } });
  expect(scriptPopup.popup.tabId).not.toBe(popupId);
  await expect.poll(async () => (await document(scriptPopup.popup.tabId))?.observation).toMatchObject({ url: popupUrl, load: { kind: 'ready' } });
  await open(effectsUrl);
  const beforeForeignPopup = foreignHits;
  const [, blockedPopup] = await prompt([target('Open foreign site'), { action: 'click', name: 'Open foreign site', expectPopup: true }]);
  expect(blockedPopup).toMatchObject({ outcome: 'dispatched', popup: { kind: 'blocked', reason: expect.stringContaining('outside the authorized site') } });
  expect(foreignHits).toBe(beforeForeignPopup);

  const triggerDownload = async (name, role) => (await prompt([target(name, role), { action: 'download', name }]))[1];
  const linkedBlob = await triggerDownload('Save linked Blob', 'link');
  const oversizedBlob = await triggerDownload('Generate oversized Blob');
  const scriptedBlob = await triggerDownload('Generate Blob report');
  const httpEvent = await triggerDownload('Submit HTTP download');
  expect(oversizedBlob).toMatchObject({ isError: true, reason: expect.stringContaining('exceeds 10 MiB') });
  expect(oversizedBlob).not.toHaveProperty('transfer');
  expect(linkedBlob.transfer?.url).toMatch(/^blob:/);
  expect(scriptedBlob.transfer?.url).toMatch(/^blob:/);
  expect(httpEvent.transfer?.url).toBe(site.origin + '/report.csv');
  for (const [receipt, filename, expected] of [[linkedBlob, 'linked-blob.csv', linkedBlobText],
    [scriptedBlob, 'scripted-blob.csv', scriptedBlobText], [httpEvent, 'report.csv', downloadText]]) {
    expect(receipt).toMatchObject({ outcome: 'dispatched', transfer: { bytes: Buffer.byteLength(expected) } });
    const registered = receipt.transfer.artifactReceipt.artifact;
    expect(registered.thread_id).toBe(effectsThread.id);
    const hash = createHash('sha256').update(expected).digest('hex');
    expect(registered.versions[0]).toMatchObject({ filename, version: 1, sha256: hash });
    expect(await readFile(resolve(temp, 'settings.artifacts', threadDigest, 'snapshots', hash + '.bin'))).toEqual(Buffer.from(expected));
    await expect.poll(async () => (await state()).artifacts?.items?.map(item => item.id) || []).toContain(registered.id);
    expect(JSON.parse(await readFile(resolve(effectsEvidence, receipt.receiptId + '.result.json'), 'utf8'))).toMatchObject({ transfer: receipt.transfer });
  }
  const noDownload = await triggerDownload('Navigate instead');
  expect(noDownload).toMatchObject({ outcome: 'unknown', isError: true, reason: expect.stringContaining('page navigated') });
  expect(noDownload).not.toHaveProperty('transfer');
  expect((await readdir(workspace)).filter(name => name.startsWith('.pero-browser-download-'))).toEqual([]);

  const dialogsUrl = site.origin + '/dialogs';
  await open(dialogsUrl);
  const [ungranted] = await prompt([{ action: 'getJsDialog', tabId: dialogsUrl }]);
  expect(ungranted).toMatchObject({ isError: true, error: expect.stringContaining('Allow a Web tab') });
  await confirm(1);
  await expect.poll(async () => (await document(dialogsUrl))?.observation.notice).toBe('Browser Use allowed');
  // Playwright dismisses Chromium dialogs without a subscriber.
  const visibleDialogs = [];
  app.context().on('dialog', dialog => visibleDialogs.push({ type: dialog.type(), message: dialog.message() }));
  await app.evaluate(({ dialog }) => {
    const original = dialog.showMessageBox;
    dialog.showMessageBox = (...args) => {
      const options = args.at(-1);
      if (!options.message?.startsWith('Embedded fixture')) return original(...args);
      // Keep Electron's native callback pending while the agent answers the
      // real renderer dialog. Only presentation is replaced by the fixture.
      return new Promise(resolve => {
        const finish = () => resolve({ response: 1, checkboxChecked: false });
        options.signal.addEventListener('abort', finish, { once: true });
        globalThis.dismissEmbeddedFixture = finish;
      });
    };
  });
  const waitDialog = async type => {
    let reply;
    await expect.poll(async () => {
      [reply] = await prompt([{ action: 'getJsDialog', tabId: dialogsUrl }]);
      return reply.dialog?.type;
    }).toBe(type);
    return reply.dialog;
  };
  const answerDialog = (dialogId, decision) => ({ action: 'handleJsDialog', tabId: dialogsUrl, dialogId, decision });
  const embeddedDialogReceipts = [];
  let previousDialogId;
  for (const [name, type, decision, marker] of [
    ['Open confirmation', 'confirm', 'accept', 'true'],
    ['Open confirmation', 'confirm', 'dismiss', 'false'],
    ['Open delayed alert', 'alert', 'dismiss', 'alert closed'],
  ]) {
    const [, click] = await prompt([target(name), { action: 'click', name }]);
    expect(click).toMatchObject({ outcome: 'dispatched' });
    const { id, message } = await waitDialog(type);
    expect(message).toBe(`Embedded fixture ${type}`);
    expect(visibleDialogs.at(-1)).toEqual({ type, message });
    if (previousDialogId) {
      const [stale] = await prompt([answerDialog(previousDialogId, decision)]);
      expect(stale).toMatchObject({ outcome: 'rejected' });
    }
    const [handled, cleared, effect] = await prompt([answerDialog(id, decision), { action: 'getJsDialog' },
      { action: 'wait', locator: { by: 'testId', value: 'dialog-result' }, condition: { kind: 'text', value: marker } }]);
    expect(handled).toMatchObject({ outcome: 'dispatched', dialogId: id });
    expect(cleared.dialog).toBe(null);
    expect(effect.matched).toBe(true);
    const receipt = JSON.parse(await readFile(resolve(effectsEvidence, handled.receiptId + '.result.json'), 'utf8'));
    expect(receipt).toEqual({ id: handled.receiptId, dialogId: id, decision, outcome: 'dispatched' });
    embeddedDialogReceipts.push(receipt);
    previousDialogId = id;
  }
  const [arrival] = await prompt([{ action: 'navigate', url: site.origin + '/arrival-dialog' }]);
  expect(arrival).toMatchObject({ outcome: 'dispatched' });
  const arrivalDialog = await waitDialog('alert');
  expect(arrivalDialog.message).toBe('Embedded fixture arrival');
  const [arrivalHandled] = await prompt([answerDialog(arrivalDialog.id, 'dismiss')]);
  expect(arrivalHandled).toMatchObject({ outcome: 'dispatched' });
  await expect.poll(async () => (await document(dialogsUrl))?.observation.load.kind).toBe('ready');
  const [arrivalEffect] = await prompt([
    { action: 'wait', locator: { by: 'testId', value: 'dialog-result' }, condition: { kind: 'text', value: 'arrival resumed' } },
  ]);
  expect(arrivalEffect.matched).toBe(true);
  expect((await prompt([{ action: 'back' }]))[0]).toMatchObject({ outcome: 'dispatched', url: dialogsUrl });

  await prompt([target('Open confirmation'), { action: 'click', name: 'Open confirmation' }]);
  const pending = await waitDialog('confirm');
  await menu('browser-use-revoke');
  const [afterRevoke] = await prompt([answerDialog(pending.id, 'accept')]);
  expect(afterRevoke).toMatchObject({ isError: true, error: expect.stringContaining('Allow a Web tab') });
  expect(await app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(view => view.getURL() === url)?.debugger.isAttached(), dialogsUrl)).toBe(false);
  await app.evaluate(() => globalThis.dismissEmbeddedFixture?.());

  await clickNewChat(page);
  const batchUrl = site.origin + '/batch-inputs';
  await open(batchUrl);
  await confirm(1);
  await expect.poll(async () => (await document(batchUrl))?.observation.notice).toBe('Browser Use allowed');
  for (const [index, path] of batchFiles.entries()) {
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled:false, filePaths:[path] }); }, path);
    const batchAttach = (await state()).composerBounds.context;
    await page.mouse.click(batchAttach.x + batchAttach.width / 2, batchAttach.y + batchAttach.height / 2);
    for (let i=0; i<2; i++) await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await state()).attachments.length).toBe(index + 1);
  }
  await expect.poll(async () => (await state()).attachments).toEqual(browserFiles.map(({ name }) => name));
  const batchInputs = await prompt(browserInputCommands);
  verifyBrowserInputs(batchInputs);

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
  app = undefined;
  page = undefined;
  const restoredIds = [controlsUrl, tabId];
  const { session: checkpoint } = JSON.parse(await readFile(resolve(temp, 'settings.workspace/session.json'), 'utf8'));
  expect(checkpoint.web.filter(tab => restoredIds.includes(tab.id)), 'Both Web tabs were saved before restart')
    .toEqual(expect.arrayContaining(restoredIds.map(id => expect.objectContaining({ id, url: controlsUrl }))));
  app = await launch();
  page = await app.firstWindow();
  await page.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).connected && !document.getElementById('loading'), undefined, { timeout: 15000 });
  await expect.poll(async () => {
    const docs = (await state()).webDocuments;
    return restoredIds.map(id => docs.find(item => item.id === id)?.observation);
  }, { message: 'Restore both saved tab identities after restarting Electron', timeout: 10000 })
    .toEqual(restoredIds.map(() => expect.objectContaining({ url: controlsUrl, load: { kind: 'ready' } })));
  const restoredModes = await app.evaluate(async ({ webContents }, url) => Promise.all(webContents.getAllWebContents()
    .filter(view=>view.getURL()===url).map(view=>view.executeJavaScript("document.querySelector('#mode').value"))), controlsUrl);
  expect(restoredModes.sort()).toEqual(['basic','full']);
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ passed: true, restoredIds, actions, input, navigation, displayed, scrollY, denied, pointer, edits, form, frame, history, uploaded, transfers, batchInputs, popups: { linkPopup, scriptPopup, blockedPopup }, downloadEvents: { linkedBlob, scriptedBlob, oversizedBlob, httpEvent, noDownload }, embeddedDialogReceipts, arrivalDialogHandled: true, browserDiagnostics: { metrics: diagnostics.metrics, cpu: diagnostics.cpu, cdp: diagnostics.cdp }, accessibility, siteTools, restoredModes, foreignHits }, null, 2));
  await rm(resolve(output, 'failure-state.json'), { force: true });
  await rm(resolve(output, 'failure.png'), { force: true });
  console.log('Browser Use passed through actual Electron, Rust Host and ACP MCP.');
} catch (error) {
  if (page) {
    const capture = Promise.allSettled([
      page.screenshot({ path: resolve(output, 'failure.png'), timeout: 2000 }),
      page.evaluate(() => window.peroDiagnostics?.snapshot() || '{}')
        .then(snapshot => writeFile(resolve(output, 'failure-state.json'), snapshot)),
    ]);
    const { setTimeout: delay } = await import('node:timers/promises');
    await Promise.race([capture, delay(2500, undefined, { ref: false })]);
  }
  throw error;
} finally {
  await app?.close();
  await Promise.all([site.close(), foreign.close()]);
  await rm(temp, { recursive: true, force: true });
}

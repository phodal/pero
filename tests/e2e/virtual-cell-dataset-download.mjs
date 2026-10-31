// Real Desktop UI and DatasetDownload; only the external byte source is a fixture.
// Sample data, not a public Norman download or scientific acceptance.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, 'test-results/virtual-cell-dataset-download');
await mkdir(out, { recursive: true });
// Do this before loading dependencies: an unavailable build is never stale success.
await rm(resolve(out, 'result.json'), { force: true });
await rm(resolve(out, 'failure.json'), { force: true });
await rm(resolve(out, 'failure-datasets'), { recursive: true, force: true });
const execute = promisify(execFile);
const label = 'Sample data: deterministic test bytes, not a real Norman H5AD download or validation.';
const body = Buffer.alloc(4 * 1024 * 1024);
for (let i = 0; i < body.length; i++) body[i] = i % 251;
const md5 = createHash('md5').update(body).digest('hex');
const sha256 = createHash('sha256').update(body).digest('hex');
const prefixBytes = 2 * 1024 * 1024;
const checks = [], errors = [], expectedTransportErrors = [], fixtureEvents = [], apiRequests = [], sourceRequests = [], states = [], cleanup = [];
const sockets = new Set();
let expect, electron, clickAppOpen, setAppearance, app, page, frame, panel, temp, profile, source, failure, droppedResponseExpected = false;
const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
const apiPosts = () => apiRequests.filter(request => request.method === 'POST');
const status = () => panel.locator(':scope > .pero-ui-toolbar > [role="status"]');
const alive = pid => {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
};
const read = () => frame.locator('body').evaluate(async () => {
  const response = await fetch('/api/dataset'); // Read-only evidence, never an action.
  if (!response.ok) throw new Error(`GET /api/dataset: ${response.status}`);
  return response.json();
});

function observe(current) {
  current.on('pageerror', error => errors.push({ type: 'pageerror', message: error.message }));
  current.on('console', message => {
    if (message.type() !== 'error') return;
    const entry = { type: 'console', message: message.text(), url: message.location().url };
    if (droppedResponseExpected && entry.url.endsWith('/api/dataset/download') && /503/.test(entry.message)) expectedTransportErrors.push(entry);
    else errors.push(entry);
  });
  current.on('request', request => {
    const url = new URL(request.url());
    if (url.protocol === 'pero-app:' && url.hostname === 'virtual-cell' && url.pathname.startsWith('/api/')) {
      apiRequests.push({ path: url.pathname, method: request.method(),
        ...(request.method() === 'POST' ? { body: request.postDataJSON() } : {}) });
    }
  });
}

async function painted() {
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    return canvas?.width === Math.round(innerWidth * devicePixelRatio) && canvas.height === Math.round(innerHeight * devicePixelRatio);
  });
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
}

async function openPanel() {
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await expect.poll(async () => (await state()).apps?.some(item => item.name === 'virtual-cell')).toBe(true);
  await painted();
  await page.mouse.click(80, await page.evaluate(() => innerHeight - 55));
  await expect.poll(async () => (await state()).navigation).toBe(7);
  await expect.poll(async () => (await state()).appsLoading).toBe(false);
  await painted();
  await clickAppOpen(page, 'virtual-cell');
  await expect.poll(async () => (await state()).activeContent).toEqual({ kind: 'app', value: { name: 'virtual-cell', panel: 'main' } });
  frame = page.frameLocator('iframe[title="virtual-cell"]');
  await expect(frame.getByLabel('Data view', { exact: true })).toBeVisible({ timeout: 20000 });
  await frame.getByLabel('Data view', { exact: true }).selectOption('comparison');
  panel = frame.getByRole('region', { name: 'Norman data', exact: true });
  await expect(panel.getByText(label, { exact: true })).toBeVisible();
  await expect(panel.getByText('Raw H5AD still needs preparation and import before baseline comparison.', { exact: true })).toBeVisible();
}

async function clickAction(name, endpoint) {
  const waiting = page.waitForResponse(response => response.url().endsWith(`/api/dataset/${endpoint}`) && response.request().method() === 'POST');
  await panel.getByRole('button', { name, exact: true }).click();
  const response = await waiting;
  expect(response.status()).toBe(endpoint === 'cancel' ? 200 : 202);
  expect(response.request().postDataJSON()).toEqual({});
  return response.json();
}

async function terminal(expected, text) {
  let value;
  await expect.poll(async () => {
    value = await read();
    return value.transferStopped ? value.status : null;
  }, { timeout: 15000, intervals: [100, 200, 500] }).toBe(expected);
  expect(value.prepared).toBe(false);
  await expect(status()).toHaveText(text);
  states.push(value);
  return value;
}

async function screenshot(name) {
  await panel.scrollIntoViewIfNeeded();
  await expect(panel.getByText(label, { exact: true })).toBeInViewport();
  await page.screenshot({ path: resolve(out, name) });
}

async function closeDesktop() {
  if (!app) return;
  const current = app, pid = current.process().pid, owned = new Set([pid]), closeErrors = [];
  try {
    const { stdout } = await execute('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' });
    const tree = stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
    for (let changed = true; changed;) {
      changed = false;
      for (const [child, parent] of tree) if (owned.has(parent) && !owned.has(child)) { owned.add(child); changed = true; }
    }
  } catch (error) { closeErrors.push(error); }
  try { await current.close(); } catch (error) { closeErrors.push(error); }
  app = undefined;
  try { await expect.poll(() => [...owned].filter(alive), { timeout: 10000 }).toEqual([]); }
  catch (error) {
    closeErrors.push(error);
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      for (const child of [...owned].filter(alive)) {
        try { process.kill(child, signal); } catch (killError) { if (killError.code !== 'ESRCH') closeErrors.push(killError); }
      }
      try { await expect.poll(() => [...owned].filter(alive), { timeout: 10000 }).toEqual([]); break; }
      catch (waitError) { closeErrors.push(waitError); }
    }
  }
  cleanup.push({ electronPid: pid, ownedPids: [...owned], allExited: [...owned].every(child => !alive(child)), recoveredShutdown: closeErrors.length > 0 });
  if (closeErrors.length) throw new AggregateError(closeErrors, 'Desktop/backend shutdown failed; no success receipt');
}

async function saveFailure(error) {
  const document = { status: 'failed', scope: 'sample-download-development-only', publicNormanDownload: false,
    error: String(error.stack || error), checks, errors, expectedTransportErrors, fixtureEvents, apiRequests, sourceRequests, states, cleanup };
  if (page && !page.isClosed()) {
    try { document.desktop = await state(); } catch (capture) { document.stateCaptureError = String(capture); }
    try { await page.screenshot({ path: resolve(out, 'failure.png') }); } catch (capture) { document.screenshotError = String(capture); }
    try { document.appText = await frame.locator('body').innerText(); } catch (capture) { document.appCaptureError = String(capture); }
  }
  await writeFile(resolve(out, 'failure.json'), JSON.stringify(document, null, 2));
}

try {
  ({ expect } = await import('@playwright/test'));
  ({ electron } = await import('./electron.mjs'));
  ({ clickAppOpen, setAppearance } = await import('./sidebar-controls.mjs'));
  if (!['linux', 'darwin'].includes(process.platform)) throw new Error('This Desktop development suite requires Linux or macOS; not a skipped success.');
  temp = await mkdtemp(resolve(tmpdir(), 'pero-dataset-download-e2e-'));
  profile = resolve(temp, 'desktop');
  source = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/sample-source') { response.writeHead(404).end(); return; }
    const attempt = sourceRequests.length + 1;
    const evidence = { attempt, path: request.url, range: request.headers.range ?? null,
      scenario: attempt === 1 ? 'stream-then-stall' : attempt === 2 ? 'bad-checksum' : 'correct-bytes',
      closed: false, finished: false };
    sourceRequests.push(evidence);
    response.on('close', () => { evidence.closed = true; evidence.finished = response.writableFinished; });
    response.on('error', error => { evidence.error = error.code; });
    response.writeHead(200, { 'Content-Length': body.length, 'Content-Type': 'application/octet-stream', Connection: 'close' });
    if (attempt === 1) {
      // A genuine stalled network read exposes progress and pending cancel.
      // No timer or production delay: the real downloader closes this socket
      // when its bounded read notices cancellation (or its normal timeout).
      response.write(body.subarray(0, prefixBytes));
    } else if (attempt === 2) {
      const corrupt = Buffer.from(body); corrupt[0] ^= 1;
      response.end(corrupt);
    } else response.end(body);
  });
  source.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((done, reject) => { source.once('error', reject); source.listen(0, '127.0.0.1', done); });
  const origin = `http://127.0.0.1:${source.address().port}`;
  const fixed = { id: 'synthetic-download-sample', revision: 'sample-bytes-v1', filename: 'sample-not-a-real-h5ad.h5ad',
    url: `${origin}/sample-source`, record: `${origin}/sample-record`, bytes: body.length, md5, sha256,
    sha256_evidence: 'Sample data digest computed independently by this test, not Norman provenance.',
    license_id: 'Sample data only', license_url: `${origin}/sample-license`, warning: label };
  await writeFile(resolve(out, 'sample-source.json'), JSON.stringify(fixed, null, 2));
  const agents = resolve(temp, 'agents.json');
  await writeFile(agents, JSON.stringify(['pero', 'codex', 'claude', 'copilot', 'grok', 'qoder', 'opencode'].map(id => ({ id, name: id, command: resolve(temp, `unavailable-${id}`) }))));
  const env = { ...process.env, PERO_DESKTOP_DATA_DIR: profile, PERO_LOCALE: 'en', PERO_AGENTS_FILE: agents,
    PERO_SETTINGS_PATH: resolve(temp, 'settings.json'), PERO_HISTORY_PATH: resolve(temp, 'history.jsonl') };
  delete env.ELECTRON_RUN_AS_NODE; delete env.PERO_APPS_ROOT;
  const launch = async () => {
    app = await electron.launch({ args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), resolve(root, 'desktop')], cwd: root, env });
    page = await app.firstWindow(); observe(page);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1488, 1086));
  };
  await launch();
  // The Host installs builtins before any App opens. Alter only this disposable
  // package's composition root; no production URL option, hook or fixture flag.
  await page.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).apps?.some(item => item.name === 'virtual-cell'), undefined, { timeout: 60000 });
  const installed = resolve(profile, 'apps/virtual-cell/backend');
  await cp(resolve(root, 'tests/fixtures/virtual-cell-dataset-download.py'), resolve(installed, 'download_fixture.py'));
  await writeFile(resolve(installed, 'download-fixture-source.json'), JSON.stringify(fixed));
  const entry = resolve(installed, 'server.py'), original = await readFile(entry, 'utf8');
  const binding = 'from dataset_download import DatasetDownload';
  expect(original.split(binding)).toHaveLength(2);
  const handlerBinding = 'handler(workbench, os.environ["PERO_APP_TOKEN"], comparisons, dataset)';
  expect(original.split(handlerBinding)).toHaveLength(2);
  await writeFile(entry, original.replace(binding, 'from download_fixture import make_download as DatasetDownload, wrap_handler')
    .replace(handlerBinding, 'wrap_handler(handler)(workbench, os.environ["PERO_APP_TOKEN"], comparisons, dataset)'));
  await openPanel();
  await expect(status()).toHaveText('Not downloaded');
  await expect(panel.getByRole('button', { name: 'Download dataset', exact: true })).toBeEnabled();
  const initial = await read(); states.push(initial);
  expect(initial.attempt).toBe(0); expect(initial.prepared).toBe(false);
  expect(sourceRequests).toEqual([]); expect(apiPosts()).toEqual([]);
  // Re-entering the view is an observed GET window, not a timed no-op pause.
  await frame.getByLabel('Data view', { exact: true }).selectOption('atlas');
  await frame.getByLabel('Data view', { exact: true }).selectOption('comparison');
  await expect(status()).toHaveText('Not downloaded');
  expect((await read()).attempt).toBe(0);
  expect(sourceRequests).toEqual([]); expect(apiPosts()).toEqual([]);
  await screenshot('sample-idle-light.png');
  checks.push('GPUI opens the real App; initial GET and view re-entry do not download');

  await clickAction('Download dataset', 'download');
  await expect.poll(async () => (await read()).receivedBytes, { timeout: 4000, intervals: [50, 100] }).toBeGreaterThan(0);
  const progress = panel.getByRole('progressbar', { name: 'Download progress', exact: true });
  await expect(progress).toBeVisible();
  await expect.poll(() => progress.evaluate(element => element.value), { timeout: 4000, intervals: [50, 100] }).toBeGreaterThan(0);
  const beforeCancel = await read(); states.push(beforeCancel);
  expect(beforeCancel.status).toBe('downloading'); expect(beforeCancel.transferStopped).toBe(false);
  expect(sourceRequests).toHaveLength(1); expect(sourceRequests[0].closed).toBe(false);
  await screenshot('sample-downloading.png');
  const cancelReply = page.waitForResponse(response => response.url().endsWith('/api/dataset/cancel') && response.request().method() === 'POST');
  await panel.getByRole('button', { name: 'Cancel download', exact: true }).click();
  await expect(status()).toHaveText('Cancelling download');
  const pending = await read(); states.push(pending);
  expect(pending.status).toBe('cancelling'); expect(pending.transferStopped).toBe(false);
  await expect(panel.getByRole('button', { name: 'Cancelling download', exact: true })).toBeDisabled();
  const cancelResponse = await cancelReply;
  expect(cancelResponse.status()).toBe(200); expect(cancelResponse.request().postDataJSON()).toEqual({});
  const cancelled = await terminal('cancelled', 'Download cancelled');
  expect(cancelled.attempt).toBe(1); expect(cancelled.checksums).toBeNull();
  expect(cancelled.receivedBytes).toBeGreaterThan(0); expect(cancelled.receivedBytes).toBeLessThan(body.length);
  await expect.poll(() => sourceRequests[0].closed).toBe(true);
  expect(sourceRequests[0].finished).toBe(false);
  expect((await stat(cancelled.partialPath)).size).toBe(cancelled.receivedBytes);
  await expect(stat(cancelled.path)).rejects.toMatchObject({ code: 'ENOENT' });
  await screenshot('sample-cancelled.png');
  checks.push('Click starts actual streaming/progress; Cancel shows pending before transferStopped; response/file close and socket disconnect precede terminal confirmation');

  const cancelledPosts = apiPosts().length;
  await closeDesktop(); await launch(); await openPanel();
  await expect(status()).toHaveText('Download cancelled');
  await expect(panel.getByRole('button', { name: 'Retry download', exact: true })).toBeEnabled();
  expect((await read()).attempt).toBe(1); expect(sourceRequests).toHaveLength(1);
  expect(apiPosts()).toHaveLength(cancelledPosts);
  await clickAction('Retry download', 'download');
  const failed = await terminal('failed', 'Download or verification failed');
  expect(failed.attempt).toBe(2); expect(failed.error).toBe('download_md5_mismatch');
  expect(failed.checksums).toBeNull(); expect(failed.receivedBytes).toBe(body.length);
  await expect(panel.getByRole('alert')).toContainText('download_md5_mismatch');
  await expect(stat(failed.path)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(panel.getByText('Raw file verified', { exact: true })).toHaveCount(0);
  expect(sourceRequests).toHaveLength(2); expect(sourceRequests.every(item => item.range === null)).toBe(true);
  await screenshot('sample-checksum-failed.png');
  checks.push('Restart never retries cancelled transfer; explicit Retry starts from zero; same-size corrupt bytes fail checksum and never publish a ready file');

  const failedPosts = apiPosts().length;
  await closeDesktop(); await launch(); await openPanel();
  await expect(status()).toHaveText('Download or verification failed');
  await expect(panel.getByRole('button', { name: 'Retry download', exact: true })).toBeEnabled();
  expect((await read()).attempt).toBe(2); expect(sourceRequests).toHaveLength(2);
  expect(apiPosts()).toHaveLength(failedPosts);
  await clickAction('Retry download', 'download');
  const ready = await terminal('ready', 'Raw file verified');
  expect(ready.attempt).toBe(3); expect(ready.receivedBytes).toBe(body.length); expect(ready.verifiedBytes).toBe(body.length);
  expect(ready.checksums).toEqual({ md5, sha256 }); expect(ready.verificationRequired).toBe(false);
  expect(Buffer.compare(await readFile(ready.path), body)).toBe(0);
  await expect(stat(ready.partialPath)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(sourceRequests).toHaveLength(3);
  await expect(panel.getByText(ready.path, { exact: true })).toBeVisible();
  await expect(frame.getByText('No prepared dataset imported', { exact: true })).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Start comparison', exact: true })).toHaveCount(0);
  const artifacts = await frame.locator('body').evaluate(async () => ({
    inputs: await (await fetch('/api/inputs')).json(), comparisons: await (await fetch('/api/comparisons')).json(),
  }));
  expect(artifacts.inputs.items).toEqual([]); expect(artifacts.comparisons.items).toEqual([]);
  await setAppearance(page, 'dark');
  await expect.poll(() => frame.locator('html').evaluate(element => element.style.colorScheme)).toBe('dark');
  await screenshot('sample-ready-dark.png');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 788));
  await painted();
  await expect.poll(() => frame.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await screenshot('sample-ready-narrow.png');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1488, 1086));
  await setAppearance(page, 'light');
  checks.push('Failed transfer survives restart without retry; a new explicit Retry verifies both digests and atomically publishes bytes; ready does not prepare/import/run');

  const readyPosts = apiPosts().length;
  await closeDesktop(); await launch(); await openPanel();
  await expect(status()).toHaveText('Local file needs verification');
  await expect(panel.getByRole('button', { name: 'Verify local file', exact: true })).toBeEnabled();
  const cached = await read(); states.push(cached);
  expect(cached.status).toBe('cached'); expect(cached.verificationRequired).toBe(true); expect(cached.checksums).toBeNull();
  expect(cached.attempt).toBe(3); expect(sourceRequests).toHaveLength(3); expect(apiPosts()).toHaveLength(readyPosts);
  const verify = panel.getByRole('button', { name: 'Verify local file', exact: true });
  await verify.focus(); await expect(verify).toBeFocused();
  await clickAction('Verify local file', 'verify');
  const verified = await terminal('ready', 'Raw file verified');
  expect(verified.attempt).toBe(4); expect(verified.checksums).toEqual({ md5, sha256 });
  expect(sourceRequests).toHaveLength(3); // Cached verification must not contact source.
  await panel.getByText('Source and verification', { exact: true }).click();
  await expect(panel.getByText(sha256, { exact: true })).toHaveCount(2);
  await screenshot('sample-cached-verified.png');
  checks.push('Restart marks cache unverified; visible Verify hashes local bytes without network; source/hash details, light/dark/narrow layouts and keyboard focus');

  // Damage only this disposable sample file while its owner is stopped. A
  // Verify click grants local hashing, not an implicit replacement download.
  await closeDesktop();
  const damaged = Buffer.from(body); damaged[damaged.length - 1] ^= 1;
  await writeFile(verified.path, damaged);
  await launch(); await openPanel();
  await expect(status()).toHaveText('Local file needs verification');
  await clickAction('Verify local file', 'verify');
  const corruptCache = await terminal('failed', 'Download or verification failed');
  expect(corruptCache.attempt).toBe(5); expect(corruptCache.error).toBe('download_md5_mismatch');
  expect(corruptCache.cacheRejected).toBe(true);
  expect(corruptCache.checksums).toBeNull(); expect(sourceRequests).toHaveLength(3);
  await expect(panel.getByRole('button', { name: 'Retry download', exact: true })).toBeEnabled();
  await screenshot('sample-corrupt-cache-failed.png');
  const corruptPosts = apiPosts().length;
  await closeDesktop(); await launch(); await openPanel();
  await expect(status()).toHaveText('Download or verification failed');
  await expect(panel.getByRole('button', { name: 'Retry download', exact: true })).toBeEnabled();
  expect((await read()).cacheRejected).toBe(true);
  expect(sourceRequests).toHaveLength(3); expect(apiPosts()).toHaveLength(corruptPosts);
  checks.push('Corrupt cached bytes fail explicit local verification without contacting source; replacement requires another Retry click');

  // Lose one response only at the temporary fixture HTTP composition. The
  // actual download is accepted and runs, so automatic POST replay is unsafe.
  await writeFile(resolve(installed, 'drop-next-download-response'), 'sample transport fault\n');
  droppedResponseExpected = true;
  const unknownReply = page.waitForResponse(response => response.url().endsWith('/api/dataset/download') && response.request().method() === 'POST');
  await panel.getByRole('button', { name: 'Retry download', exact: true }).click();
  expect((await unknownReply).status()).toBe(503);
  const recovered = await terminal('ready', 'Raw file verified');
  expect(recovered.attempt).toBe(6); expect(recovered.checksums).toEqual({ md5, sha256 });
  expect(Buffer.compare(await readFile(recovered.path), body)).toBe(0); expect(sourceRequests).toHaveLength(4);
  fixtureEvents.push(...(await readFile(resolve(installed, 'download-fixture-events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse));
  expect(fixtureEvents).toHaveLength(2);
  expect(fixtureEvents[0]).toEqual({ event: 'cancel_returned', status: 'cancelled', workerAlive: false, observerAlive: false });
  expect(fixtureEvents[1]).toMatchObject({ event: 'accepted_response_dropped', path: '/api/dataset/download', attempt: 6, source: fixed.id });
  await expect(stat(resolve(installed, 'drop-next-download-response'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(panel.getByRole('alert')).toContainText('The request was not retried.');
  const postsAfterUnknown = apiPosts().length;
  await panel.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(status()).toHaveText('Raw file verified');
  expect((await read()).attempt).toBe(6); expect(sourceRequests).toHaveLength(4);
  expect(apiPosts()).toHaveLength(postsAfterUnknown);
  await screenshot('sample-lost-response-reconciled.png');
  expect(apiPosts().filter(item => item.path === '/api/dataset/download')).toHaveLength(4);
  expect(apiPosts().filter(item => item.path === '/api/dataset/verify')).toHaveLength(2);
  expect(apiPosts().filter(item => item.path === '/api/dataset/cancel')).toHaveLength(1);
  expect(apiPosts().map(item => item.path)).toEqual(['download', 'cancel', 'download', 'download', 'verify', 'verify', 'download'].map(action => `/api/dataset/${action}`));
  expect(apiPosts().every(item => Object.keys(item.body).length === 0)).toBe(true);
  await expect.poll(() => sourceRequests.every(item => item.closed)).toBe(true);
  await expect.poll(() => sockets.size).toBe(0);
  expect(errors).toEqual([]);
  checks.push('An accepted POST with a genuinely lost response is reconciled via GET, never replayed; explicit Refresh clears the transport warning without another download');
} catch (error) {
  failure = error; await saveFailure(error);
} finally {
  try { await closeDesktop(); } catch (error) { failure ||= error; await saveFailure(failure); }
  if (source?.listening) {
    for (const socket of sockets) socket.destroy();
    try { await new Promise((done, reject) => source.close(error => error ? reject(error) : done())); }
    catch (error) { failure ||= error; await saveFailure(failure); }
    cleanup.push({ loopbackSourceClosed: !source.listening, socketsRemaining: sockets.size });
  }
  if (failure && profile) {
    try { await cp(resolve(profile, 'app-data/virtual-cell/datasets'), resolve(out, 'failure-datasets'), { recursive: true, force: true }); }
    catch (error) { if (error.code !== 'ENOENT') failure ||= error; }
  }
  if (temp) {
    try { await rm(temp, { recursive: true, force: true }); }
    catch (error) { failure ||= error; await saveFailure(failure); }
  }
}
if (!failure && errors.length) { failure = new Error('Renderer errors observed, including during shutdown'); await saveFailure(failure); }
if (!failure && (source?.listening || sockets.size)) {
  failure = new Error('The loopback fixture still owns a listener or socket after cleanup');
  await saveFailure(failure);
}
if (failure) throw failure;
const receipt = { status: 'passed', scope: 'sample-download-development-only', publicNormanDownload: false,
  checks, errors, expectedTransportErrors, fixtureEvents, apiRequests, sourceRequests, states, cleanup, temporaryInputsRemoved: true,
  actionCounts: Object.fromEntries(['download', 'verify', 'cancel'].map(action => [action, apiPosts().filter(item => item.path === `/api/dataset/${action}`).length])) };
await writeFile(resolve(out, 'result.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ status: receipt.status, scope: receipt.scope, actionCounts: receipt.actionCounts, checks }));

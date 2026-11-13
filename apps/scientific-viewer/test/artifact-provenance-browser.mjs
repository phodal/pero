// Production Viewer + actual retained Host bytes produced by tests/runtime/artifact-provenance.mjs.
// Only the shell's read-only HTTP/context transport is substituted. No model or scientific acceptance.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { unzipSync } from 'fflate';

const root = resolve(import.meta.dirname, '../../..');
const evidenceRoot = join(root, 'test-results/artifact-provenance');
const output = join(evidenceRoot, 'browser'), dist = join(root, 'apps/scientific-viewer/dist');
const catalog = JSON.parse(await readFile(join(evidenceRoot, 'catalog.json'), 'utf8'));
const snapshots = JSON.parse(await readFile(join(evidenceRoot, 'snapshots.json'), 'utf8'));
const hostResult = JSON.parse(await readFile(join(evidenceRoot, 'result.json'), 'utf8'));
assert.equal(hostResult.passed, true, 'Run tests/runtime/artifact-provenance.mjs first');
await mkdir(output, { recursive: true });
await rm(join(output, 'result.json'), { force: true });
const temporary = await mkdtemp(join(tmpdir(), 'pero-artifact-replay-'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const selected = catalog.artifacts.find(item => item.id === hostResult.selected.artifactId);
const thread = catalog.thread_id;
const mime = media => ({ csv: 'text/csv', tsv: 'text/tab-separated-values', pdf: 'application/pdf',
  html: 'text/html', notebook: 'application/x-ipynb+json', image: media.mime_type,
  document: media.format?.kind === 'json' ? 'application/json' : media.format?.kind === 'json_lines'
    ? 'application/x-ndjson' : media.format?.kind === 'markdown' ? 'text/markdown' : 'text/plain' })[media.kind];
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/host/sdk') return response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
      name: 'scientific-viewer', version: '0.4.0', permissions: { api: [], events: [], host: [] },
    }));
    if (path.startsWith('/host/artifacts/')) {
      const [, , , requestedThread, id, version] = path.split('/').map(decodeURIComponent);
      const snapshot = snapshots[`${id}/${version}`];
      if (requestedThread !== thread || !snapshot) return response.writeHead(404).end('Unknown retained snapshot');
      const bytes = await readFile(join(evidenceRoot, snapshot.file));
      assert.equal(digest(bytes), snapshot.sha256);
      return response.writeHead(200, { 'Content-Type': mime(snapshot.media), 'Content-Length': bytes.length,
        'X-Pero-Artifact-Name': encodeURIComponent(snapshot.filename), 'X-Pero-Artifact-Sha256': snapshot.sha256,
        'X-Pero-Artifact-Kind': snapshot.media.kind }).end(bytes);
    }
    const file = resolve(dist, decodeURIComponent(path).slice(1));
    if (!file.startsWith(dist + sep)) return response.writeHead(404).end();
    const bytes = await readFile(file);
    response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
      '.mjs': 'text/javascript', '.wasm': 'application/wasm' })[extname(file)] ?? 'application/octet-stream',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'" }).end(bytes);
  } catch (error) { response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const errors = [], checks = [], screenshots = [];
let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.PERO_CHROMIUM_PATH ? { executablePath: process.env.PERO_CHROMIUM_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, acceptDownloads: true });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(origin) || route.request().url().startsWith('blob:')
    ? route.continue() : route.abort());
  await page.addInitScript(() => {
    window.__provenanceContext = null;
    window.__provenanceTheme = { locale: 'en', dark: false, active: true };
    window.addEventListener('message', event => {
      if (event.source !== window || event.data?.type !== 'pero:artifact:select' || !window.__provenanceContext) return;
      window.__provenanceContext.selected = event.data.target;
      window.postMessage({ type: 'pero:app:context', context: {
        ...window.__provenanceTheme, artifactBrowser: window.__provenanceContext,
      } }, '*');
    });
  });
  await page.goto(`${origin}/artifact.html?thread_id=${encodeURIComponent(thread)}`);
  await expect(page.getByRole('main', { name: 'Artifact browser' })).toBeVisible();
  await page.evaluate(context => {
    window.__provenanceContext = { ...context, view: 'gallery' };
    window.postMessage({ type: 'pero:app:context', context: {
      ...window.__provenanceTheme, artifactBrowser: window.__provenanceContext,
    } }, '*');
  }, catalog);
  const summary = page.getByRole('region', { name: 'Artifact provenance' });
  const status = summary.getByRole('status');
  const codeView = page.locator('.cm-content:visible');
  const screenshot = async name => {
    const file = `${name}.png`;
    await page.screenshot({ path: join(output, file) }); screenshots.push(file);
  };
  const select = async (artifactId, version = 1) => {
    await page.evaluate(({ artifactId, version }) => {
      window.__provenanceContext.selected = { thread_id: window.__provenanceContext.thread_id,
        artifact_id: artifactId, version };
      window.__provenanceContext.preview_request = (window.__provenanceContext.preview_request ?? 0) + 1;
      window.postMessage({ type: 'pero:app:context', context: {
        ...window.__provenanceTheme, artifactBrowser: window.__provenanceContext,
      } }, '*');
    }, { artifactId, version });
  };
  await expect(status).toHaveText('Recorded execution: succeeded');
  await expect(summary).toContainText('compute.py');
  await expect(summary).toContainText('An execution receipt does not establish scientific acceptance.');
  await expect(codeView).toContainText('"sum": 10');
  await expect(summary).not.toContainText('Not observed:');
  await screenshot('retained-v1-light');
  await page.getByRole('button', { name: 'Next version', exact: true }).click();
  await expect(codeView).toContainText('"sum": 40');
  await expect(summary.locator('code')).toContainText('"2"');
  await page.getByRole('button', { name: 'Previous version', exact: true }).click();
  await expect(codeView).toContainText('"sum": 10');
  checks.push('Selected old version displays its actual success receipt, command and retained output after a newer version and source deletion');

  const inspectorTabs = page.getByRole('tablist', { name: 'Artifact inspector' });
  await inspectorTabs.getByRole('tab', { name: 'Preview', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(inspectorTabs.getByRole('tab', { name: 'Code', exact: true })).toBeFocused();
  await expect(codeView).toContainText('values=json.loads');
  await page.locator('.artifact-evidence-list').getByRole('button', { name: /input.json/ }).click();
  await expect(codeView).toContainText('[1,2,3,4]');
  await inspectorTabs.getByRole('tab', { name: 'Environment', exact: true }).click();
  await expect(codeView).toContainText('"status": "observed"');
  await expect(codeView).toContainText(hostResult.python.executable);
  await expect(codeView).toContainText('"packages"');
  await screenshot('observed-environment-light');
  await inspectorTabs.getByRole('tab', { name: 'Preview', exact: true }).click();
  checks.push('Keyboard tabs reach actual frozen code; input and observed interpreter/packages remain readable');

  const exportButton = summary.getByRole('button', { name: 'Export reproduction', exact: true });
  await exportButton.focus(); await expect(exportButton).toBeFocused();
  const downloadEvent = page.waitForEvent('download');
  await exportButton.press('Enter');
  const download = await downloadEvent;
  const zipBytes = await readFile(await download.path());
  await writeFile(join(output, 'retained-v1-reproduction.zip'), zipBytes);
  const archive = unzipSync(zipBytes);
  const manifest = JSON.parse(new TextDecoder().decode(archive['reproduction.json']));
  assert.equal(manifest.version, 1);
  assert.equal(manifest.artifact_id, selected.id);
  assert.equal(manifest.output.sha256, selected.versions[0].sha256);
  assert.notEqual(manifest.output.sha256, selected.versions[1].sha256);
  assert.equal(manifest.provenance.run_id, 'sum-1');
  assert.deepEqual(manifest.provenance.invocation.args, ['compute.py', 'input.json', 'result.json', '1']);
  assert.ok(archive['replay.mjs']);
  assert.match(new TextDecoder().decode(archive['README.txt']), /not an environment lock/);
  for (const scenario of ['replay', 'tampered']) {
    const folder = join(temporary, scenario); await mkdir(folder);
    for (const [name, bytes] of Object.entries(archive)) {
      const target = join(folder, name); await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes);
    }
    if (scenario === 'tampered') {
      const code = manifest.files.find(file => file.role === 'code');
      await writeFile(join(folder, code.archive_path), '# changed after export\n');
    }
    const replay = spawnSync(process.execPath, [join(folder, 'replay.mjs')], { cwd: folder, encoding: 'utf8', timeout: 15000 });
    assert.equal(replay.error, undefined);
    await writeFile(join(output, `${scenario}.log`), replay.stdout + replay.stderr);
    if (scenario === 'replay') {
      assert.equal(replay.status, 0, replay.stderr);
      assert.match(replay.stdout, /Output SHA-256 matches retained version:/);
      const bytes = await readFile(join(folder, 'replay-workspace', manifest.output.workspace_path));
      assert.equal(digest(bytes), selected.versions[0].sha256);
      assert.deepEqual(JSON.parse(bytes), { count: 4, sum: 10 });
    } else {
      assert.notEqual(replay.status, 0);
      assert.match(replay.stderr, /Retained file digest mismatch/);
    }
  }
  checks.push('Keyboard export downloads fixed v1 bytes; exported replay runs real Python in a fresh directory, matches v1 digest and rejects tampered retained code');

  await page.evaluate(() => {
    window.__provenanceTheme.dark = true;
    window.postMessage({ type: 'pero:app:context', context: window.__provenanceTheme }, '*');
  });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'pero-dark');
  await expect(codeView).toContainText('"sum": 10');
  await screenshot('retained-v1-dark');
  await page.setViewportSize({ width: 320, height: 760 });
  await expect(exportButton).toBeVisible();
  await screenshot('retained-v1-dark-narrow');
  assert.equal(await page.locator('html').evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
  await exportButton.focus(); await expect(exportButton).toBeFocused();
  checks.push('Actual SDK dark theme and 320px viewport retain the selected version and keyboard-accessible export');

  await page.setViewportSize({ width: 1100, height: 800 });
  await page.evaluate(() => {
    window.__provenanceTheme.dark = false;
    window.postMessage({ type: 'pero:app:context', context: window.__provenanceTheme }, '*');
  });
  await select(hostResult.failed);
  await expect(status).toHaveText('Recorded execution: failed');
  await page.getByRole('tablist', { name: 'Artifact inspector' }).getByRole('tab', { name: 'Execution log', exact: true }).click();
  await expect(codeView).toContainText('partial computation');
  await page.locator('.artifact-evidence-list').getByRole('button', { name: /stderr.log/ }).click();
  await expect(codeView).toContainText('intentional failure');
  await screenshot('failed-log-light');
  await select(hostResult.cancelled);
  await expect(status).toHaveText('Recorded execution: cancelled');
  await page.getByRole('tablist', { name: 'Artifact inspector' }).getByRole('tab', { name: 'Execution log', exact: true }).click();
  await expect(codeView).toContainText('interrupted; no final result');
  await screenshot('cancelled-log-light');
  await select(hostResult.noOutputFailure);
  await expect(status).toHaveText('Recorded execution: failed');
  await expect(codeView).toContainText('"outputs": []');
  await screenshot('no-output-failure-light');
  checks.push('Failed output, caught cancellation and no-output spawn failure keep their actual outcomes and retained logs');

  await select(hostResult.unknown);
  await expect(status).toHaveText('Execution not observed');
  await expect(summary).toContainText('Not observed: execution receipt, code, input files, environment observation, execution log');
  await expect(summary.locator('code')).toHaveCount(0);
  await screenshot('unknown-provenance-light');
  const unknownDownload = page.waitForEvent('download');
  await summary.getByRole('button', { name: 'Export reproduction', exact: true }).click();
  const unknownArchive = unzipSync(await readFile(await (await unknownDownload).path()));
  assert.equal(unknownArchive['replay.mjs'], undefined);
  const unknownManifest = JSON.parse(new TextDecoder().decode(unknownArchive['reproduction.json']));
  assert.equal(unknownManifest.provenance, null);
  assert.ok(unknownManifest.unavailable.includes('execution receipt'));
  await select(hostResult.legacy);
  await expect(status).toHaveText('Recorded execution: failed');
  await expect(summary).toContainText('Not observed: command and arguments');
  await expect(summary.locator('code')).toHaveCount(0);
  checks.push('Unknown and legacy v1 outputs display unavailable observations explicitly; unknown export contains no invented replay');
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'result.json'), JSON.stringify({ passed: true,
    scope: 'Production Viewer in Chromium with real retained Rust Host/Python output; read-only shell HTTP/context transport substituted',
    hostBinarySha256: hostResult.binarySha256, browserVersion: browser.version(),
    export: { artifactId: selected.id, version: 1, outputSha256: selected.versions[0].sha256,
      replayPython: hostResult.python, matched: true },
    checks, screenshots, errors,
    exclusions: ['Electron/Native shell integration', 'signed package', 'real model', 'scientific acceptance'] }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, output }));
} finally {
  await browser?.close(); server.close(); await once(server, 'close');
  await rm(temporary, { recursive: true, force: true });
}

// Actual Electron → Host → Paper. Original PDF and computation; no Agent/model calls.
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { clickAppShortcut } from './sidebar-controls.mjs';
import { backToLibrary, setPaperAppearance } from './paper-pdf-flow.mjs';
import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const original = process.env.PERO_FISHER_PDF, python = process.env.PERO_APP_PYTHON;
if (!original || !python) throw Error('Set PERO_FISHER_PDF and PERO_APP_PYTHON to the reviewed PDF and prepared interpreter');
assert.equal(createHash('sha256').update(await readFile(original)).digest('hex'), 'd3a49aaa4f2d283931544f58cb12b1174f537642b83def7ae9119a1d8717b740');
const out = resolve(root, 'test-results/paper-fisher/desktop'); await mkdir(out, { recursive: true });
const profile = await realpath(await mkdtemp(resolve(tmpdir(), 'pero-fisher-desktop-')));
const settings = resolve(profile, 'settings.json');
await writeFile(settings, JSON.stringify({ app_python: { apps: { 'paper-agent': dirname(dirname(python)) } } }));
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(profile, 'desktop'), PERO_SETTINGS_PATH: settings,
  PERO_HISTORY_PATH: resolve(profile, 'history.jsonl'), PERO_LOCALE: 'en', PERO_BUILTIN_APPS: 'paper-agent',
  PERO_REQUIRED_APPS: 'paper-agent', PERO_APP_INFRA_EMBED: '0' };
delete env.ELECTRON_RUN_AS_NODE; delete env.PERO_APPS_ROOT;
let app, page, frame, sourceId, paperId, originalMethod;
const errors = [];
const method = resolve(profile, 'desktop/apps/paper-agent/backend/paper_agent/fisher_reproduction.py');
async function launch() {
  app = await electron.launch({ args: [resolve(root, 'desktop')], cwd: root, env });
  page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1000));
  await page.evaluate(path => window.pero.sessionCommand({ action: 'workspace', path }), profile);
  await expect.poll(() => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()).workspace)).toBe(profile);
  await clickAppShortcut(page, 'paper-agent');
  frame = page.frameLocator('iframe[title="paper-agent"]');
  await expect(frame.getByRole('button', { name: 'Add papers', exact: true })).toBeVisible({ timeout: 30000 });
}
async function api(path, body) {
  return frame.locator('body').evaluate(async (_, { path, body }) => {
    const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw Error(await response.text()); return response.json();
  }, { path, body });
}
const panel = () => frame.locator('.pa-fisher-reproduction');
const status = () => api('/api/fisher/step', { action: 'status', annotationId: sourceId });
async function freeze() {
  await panel().getByRole('checkbox').check();
  await panel().getByRole('button', { name: 'Freeze protocol', exact: true }).click();
  await expect(panel().getByRole('button', { name: 'Confirm and run fixed arithmetic', exact: true })).toBeEnabled();
}
async function run(name = 'Confirm and run fixed arithmetic') {
  await panel().getByRole('button', { name, exact: true }).click();
  await expect(panel().getByRole('button', { name: 'Confirm and run a new attempt', exact: true })).toBeEnabled();
}
try {
  await launch();
  await frame.getByRole('button', { name: 'Add papers', exact: true }).click();
  await frame.getByRole('tab', { name: 'PDF', exact: true }).click();
  await frame.locator('input[type=file][accept="application/pdf,.pdf"]').setInputFiles(original);
  await frame.getByRole('button', { name: 'Select Fisher Table III result', exact: true }).click({ timeout: 30000 });
  await expect(frame.getByRole('spinbutton', { name: 'Page', exact: true })).toHaveValue('4');
  sourceId = await frame.locator('[data-annotation-id][data-focused="true"]').getAttribute('data-annotation-id');
  const papers = await api('/api/library'); paperId = papers.papers[0].id;
  await panel().getByText('Review input observations', { exact: true }).click();
  await expect(frame.getByRole('spinbutton', { name: 'Page', exact: true })).toHaveValue('4');
  await expect(panel().locator('tbody tr')).toHaveCount(100);
  await expect(panel().locator('tbody tr').nth(31)).toContainText('5.4');
  await panel().getByText('Review input observations', { exact: true }).click();
  await expect(frame.getByRole('spinbutton', { name: 'Page', exact: true })).toHaveValue('4');
  await freeze(); const frozen = (await status()).items[0];
  assert.deepEqual(frozen.spec.comparison, { mode: 'absolute', tolerance: .00005 });
  await run();
  await expect(frame.getByRole('spinbutton', { name: 'Page', exact: true })).toHaveValue('4');
  await expect(panel().getByText('Single-result verdict: REPRODUCED')).toBeVisible();
  await expect(panel().locator('dd')).toHaveText(['19.1434', '19.1434', '0']);
  const first = (await status()).items[0].attempts[0];
  assert.equal(first.independent.numeric_recomputation, 'PASS');
  const reading = await api(`/api/pdf?paperId=${paperId}`);
  const source = reading.annotations.find(a => a.id === sourceId);
  const note = reading.annotations.find(a => a.id === first.annotation.resultAnnotationId);
  assert.deepEqual(note.anchor, source.anchor);
  assert.deepEqual(note.rects, source.rects); assert.equal(note.page, 4);
  assert.match(note.note, /Reported 19.1434; actual 19.1434; difference \+0/);
  await run('Confirm and run a new attempt');
  assert.equal((await status()).items[0].attempts.length, 2);
  // Save the real download via Electron's download owner, then independently recheck it.
  const archivePath = resolve(out, 'handoff.zip');
  await app.evaluate(({ session }, path) => {
    globalThis.fisherDownload = 'pending';
    session.defaultSession.once('will-download', (_, item) => { item.setSavePath(path); item.once('done', (_, state) => { globalThis.fisherDownload = state; }); });
  }, archivePath);
  await panel().getByRole('button', { name: 'Export standalone handoff ZIP' }).click();
  await expect.poll(() => app.evaluate(() => globalThis.fisherDownload)).toBe('completed');
  const checked = execFileSync(python, ['-c', `import json,sys,zipfile,tempfile,subprocess\nwith tempfile.TemporaryDirectory() as d:\n zipfile.ZipFile(sys.argv[1]).extractall(d)\n r=subprocess.run([sys.executable,'-I','-S',d+'/verify.py'],capture_output=True,text=True,check=True)\n print(r.stdout)`, archivePath], { encoding: 'utf8' });
  assert.equal(JSON.parse(checked).exact_numerator, 95717);
  await panel().getByRole('button', { name: 'View original Table III cell' }).click();
  await expect(frame.locator('[data-annotation-id][data-focused="true"]')).toBeInViewport();
  await panel().getByText('Single-result verdict: REPRODUCED').scrollIntoViewIfNeeded(); await page.screenshot({ path: resolve(out, 'reproduced-light.png') });
  // A real frozen-method fingerprint mismatch in this disposable installed package.
  originalMethod = await readFile(method, 'utf8');
  await writeFile(method, originalMethod + '\n# Disposable acceptance: method version changed after freeze.\n');
  await run('Confirm and run a new attempt');
  await expect(panel().getByText('Execution status: environment_failed')).toBeVisible();
  await expect(panel().getByText('Single-result verdict: INCONCLUSIVE')).toBeVisible();
  await expect(panel().getByText('Independent numerical check: Not checked')).toBeVisible();
  await expect(panel().getByText('The environment differs', { exact: false })).toBeVisible();
  await expect(panel().getByText('result annotation has not been confirmed saved', { exact: false })).toHaveCount(0);
  await panel().getByRole('button', { name: 'Read attempt logs' }).click();
  await expect(panel().locator('pre')).toContainText(['prepare a new protocol']);
  await page.screenshot({ path: resolve(out, 'environment-failed.png') });
  await writeFile(method, originalMethod);
  await run('Confirm and run a new attempt');
  await expect(panel().getByText('Single-result verdict: REPRODUCED')).toBeVisible();
  assert.equal((await status()).items[0].attempts.length, 4);
  await panel().getByRole('button', { name: 'Create new protocol (retain earlier versions)' }).click();
  await panel().getByRole('button', { name: 'Predeclare comparison rule', exact: true }).click();
  await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await panel().getByLabel('Lower bound', { exact: true }).fill('0');
  await panel().getByLabel('Upper bound', { exact: true }).fill('1');
  await freeze(); await run();
  await expect(panel().getByText('Execution status: completed')).toBeVisible();
  await expect(panel().getByText('Single-result verdict: MISMATCH')).toBeVisible();
  await expect(panel().getByText('Independent numerical check: PASS')).toBeVisible();
  const final = await status(); assert.equal(final.items.length, 2);
  assert.deepEqual(final.items.find(i => i.itemId === frozen.itemId).spec, frozen.spec);
  await panel().getByRole('button', { name: 'Read attempt logs' }).click();
  await expect(panel().locator('pre')).toContainText(['MISMATCH']);
  await setPaperAppearance(page, 'dark');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 900));
  await expect.poll(() => frame.locator('html').evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: resolve(out, 'mismatch-dark-narrow.png') });
  await panel().getByRole('button', { name: 'View original Table III cell' }).focus();
  await page.keyboard.press('Enter');
  await expect(frame.getByRole('spinbutton', { name: 'Page', exact: true })).toHaveValue('4');
  await expect(frame.locator('[data-annotation-id][data-focused="true"]')).toBeInViewport();
  await panel().getByText('Single-result verdict: MISMATCH').scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(out, 'mismatch-source-dark.png') });
  await backToLibrary(frame);
  await frame.locator('.pa-library-list .pero-list-open').first().dblclick();
  await frame.getByRole('button', { name: 'Select Fisher Table III result', exact: true }).click();
  await expect(panel().getByText('Single-result verdict: MISMATCH')).toBeVisible();
  await app.close(); app = null; await launch();
  await frame.locator('.pa-library-list .pero-list-open').first().dblclick();
  await frame.getByRole('button', { name: 'Select Fisher Table III result', exact: true }).click();
  await expect(panel().getByText('Single-result verdict: MISMATCH')).toBeVisible();
  assert.deepEqual((await status()).items, final.items);
  await page.screenshot({ path: resolve(out, 'restarted.png') });
  assert.deepEqual(errors, []);
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ profile, sourceId, paperId, items: final.items,
    scope: 'Real development Electron/Host/Paper and original Fisher PDF. Deliberate method-file change tests environment rejection. Bounds 0..1 are a deliberate mismatch scenario, not the default policy. No model, scientific peer review, Native or signed package acceptance.', errors }, null, 2));
  console.log('PASS: Electron/Host PDF import, source anchor, 100 inputs, immutable protocol, actual arithmetic, rerun, export/recheck, environment failure/restoration, mismatch, keyboard source navigation, dark/narrow, close/reopen, restart persistence.');
} catch (error) {
  if (page && !page.isClosed()) { await page.screenshot({ path: resolve(out, 'failure.png') }); console.error(await frame.locator('body').innerText().catch(() => 'No App frame')); }
  throw error;
} finally { if (originalMethod) await writeFile(method, originalMethod); await app?.close(); }

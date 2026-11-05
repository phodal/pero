// Opt-in Desktop acceptance with the original PDF and a prepared local interpreter.
import { expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { electron } from './electron.mjs';
import { clickAppShortcut } from './sidebar-controls.mjs';
import { setPaperAppearance } from './paper-pdf-flow.mjs';

const root = resolve(import.meta.dirname, '../..');
const { PERO_PCGYM_PDF: pdf, PERO_PCGYM_VENV: venv, PERO_PAPER_PCGYM_CHECKOUT: checkout } = process.env;
const runProfile = process.env.PERO_PCGYM_DESKTOP_PROFILE || 'smoke';
const expectedFailure = process.env.PERO_PCGYM_DESKTOP_EXPECT_ENV_FAILURE === '1';
const secondSeed = process.env.PERO_PCGYM_DESKTOP_SECOND_SEED === '1';
const linkData = process.env.PERO_PCGYM_DESKTOP_DATA_PIN === '1';
if (process.env.PERO_PCGYM_DESKTOP_LIVE !== '1' || !pdf || !venv || !checkout) {
  throw Error('Set PERO_PCGYM_DESKTOP_LIVE=1, PERO_TEST_HEADED=1, PERO_PCGYM_PDF, PERO_PCGYM_VENV and PERO_PAPER_PCGYM_CHECKOUT. The native dialog requires an explicit Run once.');
}
const fileDigest = createHash('sha256').update(await readFile(pdf)).digest('hex');
expect(fileDigest).toBe('f3aeddb2f1a29992a52088faf019dea66e2c31a30f134dedca8df40dbe7f5ee7');
const python = resolve(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const selection = JSON.parse(execFileSync(python, ['-c', `
import json, sys
import pypdfium2 as pdfium
from contextlib import closing
with closing(pdfium.PdfDocument(sys.argv[1])) as doc, closing(doc[19]) as page, closing(page.get_textpage()) as text:
    with closing(text.search('0.0727')) as search:
        start, count = search.get_next()
        assert search.get_next() is None
    first, last = text.get_charbox(start), text.get_charbox(start + count - 1)
    width, height = page.get_size()
    print(json.dumps(dict(x1=first[0]/width, x2=last[2]/width, y=(height-(first[1]+first[3])/2)/height)))
`, pdf], { encoding: 'utf8' }));

expect(['smoke', 'table6']).toContain(runProfile);
const out = resolve(root, 'test-results/paper-pcgym-live', expectedFailure ? 'preflight-failure' : linkData ? `${runProfile}-data` : runProfile);
const profile = await realpath(await mkdtemp(join(tmpdir(), 'pero-pcgym-desktop-')));
await mkdir(out, { recursive: true });
await rm(join(out, 'report.json'), { force: true });
await writeFile(join(profile, 'settings.json'), JSON.stringify({ workbench: { appearance: 'light' },
  app_python: { apps: { 'paper-agent': venv, ...(linkData ? { data: venv } : {}) } } }));
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: join(profile, 'desktop'),
  PERO_SETTINGS_PATH: join(profile, 'settings.json'), PERO_HISTORY_PATH: join(profile, 'history.jsonl'),
  PERO_ENV_FILE: join(profile, '.env'), PERO_LOCALE: 'en' };
delete env.PERO_APPS_ROOT;
let app, page, frame;
const errors = [];
const api = (path, body) => frame.locator('body').evaluate(async (_, { path, body }) => {
  const response = await fetch(path, body === undefined ? undefined : { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw Error(await response.text());
  return response.json();
}, { path, body });
async function launch() {
  app = await electron.launch({ requiresNativeWindow: true, args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []),
    resolve(root, 'desktop')], cwd: root, env });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await clickAppShortcut(page, 'paper-agent');
  frame = page.frameLocator('iframe[title="paper-agent"]');
}

async function exercise() {
  await launch();
  const dataFile = 'context-sample.csv';
  let dataset;
  if (linkData) {
    await clickAppShortcut(page, 'data');
    const data = page.frameLocator('iframe[title="data"]');
    await data.getByRole('button', { name: 'Add data', exact: true }).click();
    const dialog = data.getByRole('dialog');
    await dialog.locator('input[type="file"]').setInputFiles({ name: dataFile, mimeType: 'text/csv', buffer: Buffer.from('sample,value\n1,1.25\n') });
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(dialog).toBeHidden();
    dataset = await data.locator('body').evaluate(async () => (await (await fetch('/api/state')).json()).assets[0]);
    await clickAppShortcut(page, 'paper-agent');
  }
  await frame.getByRole('button', { name: 'Add papers', exact: true }).first().click();
  await frame.getByRole('tab', { name: 'PDF', exact: true }).click();
  await frame.locator('input[type="file"][accept*="pdf"]').setInputFiles(pdf);
  const viewer = frame.getByRole('region', { name: 'PDF reader', exact: true });
  await expect(viewer).toBeVisible({ timeout: 30000 });
  const { papers: [paper] } = await api('/api/library');
  const pageNumber = frame.getByRole('spinbutton', { name: 'Page', exact: true });
  await expect(viewer.locator('[data-page-number="1"]')).toHaveAttribute('data-selection-ready', 'true', { timeout: 30000 });
  await frame.getByRole('button', { name: 'Fit page', exact: true }).click();
  await pageNumber.fill('20');
  const tablePage = viewer.locator('[data-page-number="20"]');
  await expect(tablePage).toHaveAttribute('data-selection-ready', 'true', { timeout: 30000 });
  const box = await tablePage.boundingBox();
  await page.mouse.move(box.x + selection.x1 * box.width, box.y + selection.y * box.height);
  await page.mouse.down();
  await page.mouse.move(box.x + selection.x2 * box.width, box.y + selection.y * box.height, { steps: 15 });
  await page.mouse.up();
  await viewer.getByRole('button', { name: 'Highlight', exact: true }).click();
  const reading = () => api(`/api/pdf?paperId=${paper.id}`);
  await expect.poll(async () => (await reading()).annotations.length).toBe(1);
  const { annotations: [annotation], document } = await reading();
  expect(annotation.page).toBe(20);
  expect(annotation.quote).toBe('0.0727');
  expect(annotation.anchor.fileDigest).toBe(document.fileDigest);
  expect(document.fileDigest).toBe(fileDigest);
  const evidence = () => api('/api/reproduction/step', { action: 'annotation-evidence', annotationId: annotation.id });
  const note = () => frame.locator(`[data-note-id="${annotation.id}"]`);
  await note().getByRole('button', { name: 'Verify this result', exact: true }).click();
  await note().getByRole('combobox', { name: /^Run profile/ }).selectOption(runProfile);
  await note().getByLabel('Tolerance', { exact: true }).fill('0.001');
  await note().getByRole('button', { name: 'Save frozen verification item', exact: true }).click();
  await expect.poll(async () => (await evidence()).items.length).toBe(1);
  const frozen = (await evidence()).items[0];
  expect(frozen.spec.profile).toBe(runProfile);
  expect(frozen.item.reported).toBe(0.0727);
  expect(frozen.attempts).toEqual([]);
  async function run(item, expected) {
    await note().getByRole('button', { name: 'Approve and run once', exact: true }).click();
    console.log(`Native confirmation requested for PC-Gym ${item.spec.profile}, seed ${item.spec.seed}, spec ${item.spec.id}. Review the dialog and select Run once.`);
    const current = async () => (await evidence()).items.find(row => row.item.id === item.item.id);
    await expect.poll(async () => (await current()).attempts.find(attempt => ['completed', 'failed', 'cancelled'].includes(attempt.status))?.status,
      { timeout: (item.spec.timeout_seconds + 180) * 1000 }).toBe(expected);
    return current();
  }
  const saved = await run(frozen, expectedFailure ? 'failed' : 'completed');
  expect(saved.attempts).toHaveLength(1);
  const attempt = saved.attempts[0];
  expect(saved.requests.find(request => request.attempt_id === attempt.attempt_id)?.item_id).toBe(saved.item.id);
  const compare = () => api('/api/reproduction/step', { action: 'compare-item', itemId: saved.item.id, attemptId: attempt.attempt_id });
  const comparison = await compare();
  if (expectedFailure) {
    expect(attempt.phase).toBe('preflight');
    expect(attempt.worker_started).toBe(false);
    expect(comparison.actual).toBeNull();
    await expect(note().getByText('Environment preflight failed (computation not started)', { exact: false })).toBeVisible();
    await note().getByRole('button', { name: 'View execution log', exact: true }).click();
    await expect(note().locator('pre').last()).toContainText('preflight: Prepare the scientific environment explicitly');
    await note().locator('pre').last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(out, 'preflight-failure.png') });
    await writeFile(join(out, 'report.json'), JSON.stringify({ fileDigest, item: saved.item, attempt, comparison }, null, 2));
    console.log('Real Desktop preflight refusal retained its log without starting a scientific worker.');
    return;
  }
  expect(comparison.actual).not.toBeNull();
  expect(comparison.paper_verdict).toBe('INCONCLUSIVE');
  expect(comparison.metrics).toHaveLength(3);
  expect(comparison.metrics.every(metric => metric.total_episodes === saved.spec.episodes && metric.total_samples === saved.spec.episodes * 60)).toBe(true);
  await expect(note().getByText('Paper verdict: INCONCLUSIVE', { exact: true })).toBeVisible();
  await note().getByText('Violation counts', { exact: true }).click();
  await page.screenshot({ path: join(out, 'annotation-light.png') });
  await note().getByRole('button', { name: 'View execution log', exact: true }).click();
  await expect(note().locator('pre').last()).toBeVisible();
  await setPaperAppearance(page, 'dark');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 760));
  await expect.poll(() => frame.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: join(out, 'annotation-dark-narrow.png') });

  let variant;
  if (secondSeed) {
    await note().locator('summary').filter({ hasText: 'Save frozen verification item' }).click();
    await note().getByRole('combobox', { name: /^Run profile/ }).selectOption('smoke');
    await note().getByLabel('Random seed', { exact: true }).fill('1');
    await note().getByRole('button', { name: 'Save frozen verification item', exact: true }).click();
    await expect.poll(async () => (await evidence()).items.length).toBe(2);
    const changed = (await evidence()).items.find(row => row.spec.seed === 1);
    expect(changed.spec.id).not.toBe(saved.spec.id);
    expect(changed.spec.pipeline_digest).toBe(saved.spec.pipeline_digest);
    variant = await run(changed, 'completed');
    expect(variant.attempts[0].attempt_id).not.toBe(attempt.attempt_id);
  }

  await frame.getByRole('button', { name: 'Research record', exact: true }).click();
  const records = frame.locator('.pa-manual-records');
  await records.getByText('Question and scope', { exact: true }).click();
  await records.getByRole('button', { name: 'New record', exact: true }).click();
  await records.getByLabel('Question', { exact: true }).fill('Can the adapted PC-Gym case recompute the selected Table 6 result?');
  await records.getByLabel('Scope', { exact: true }).fill('One pinned CSTR case with both metric definitions retained.');
  await records.getByLabel('Inclusion criteria', { exact: true }).fill('The saved v4 original and the frozen local attempt.');
  await records.getByLabel('Exclusion criteria', { exact: true }).fill('Unversioned outputs and unaudited trajectories.');
  await records.getByRole('combobox', { name: /^Decision/ }).selectOption('include');
  await records.getByLabel('Reason', { exact: true }).fill('Source contains the original Table 6 result.');
  await records.getByText('Execution history', { exact: true }).click();
  await records.getByRole('button', { name: 'Find attempts', exact: true }).click();
  await records.getByRole('checkbox', { name: /base, seed 0 \/ completed/ }).check();
  if (variant) await records.getByRole('checkbox', { name: /base, seed 1 \/ completed/ }).check();
  if (dataset) {
    await records.getByText('Data Workspace', { exact: true }).click();
    await records.getByRole('button', { name: 'Choose Data versions' }).click();
    await records.getByRole('combobox', { name: new RegExp(`^${dataFile}`) }).selectOption(dataset.id);
  }
  await records.getByRole('button', { name: 'Save revision', exact: true }).click();
  const record = records.getByRole('article', { name: 'Saved research record' });
  const firstAttempt = record.getByRole('listitem').filter({ hasText: /base, seed 0 \/ completed/ });
  const handoffButton = firstAttempt.getByRole('button', { name: 'Export research handoff', exact: true });
  await expect(handoffButton).toBeDisabled();
  await record.getByRole('checkbox', { name: /Include this revision/ }).check();
  const archive = join(out, 'research-handoff.zip');
  await rm(archive, { force: true });
  await app.evaluate(({ session }, destination) => session.defaultSession.once('will-download', (_event, item) => item.setSavePath(destination)), archive);
  const [handoff] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/research/record-handoff'),
    handoffButton.click(),
  ]);
  expect(handoff.status()).toBe(200);
  const expectedDigest = createHash('sha256').update(await handoff.body()).digest('hex');
  await expect.poll(async () => createHash('sha256').update(await readFile(archive).catch(() => '')).digest('hex')).toBe(expectedDigest);
  await page.screenshot({ path: join(out, 'research-handoff-dark-narrow.png') });
  const checkUpdates = record.getByRole('button', { name: 'Check saved source updates', exact: true });
  await checkUpdates.focus();
  await checkUpdates.press('Enter');
  await expect(record.getByRole('region', { name: 'Source update impact' })).toContainText('Saved versions match');
  await firstAttempt.getByRole('button', { name: 'Open result in PDF', exact: true }).click();
  await expect(pageNumber).toHaveValue('20');
  await expect(note().getByRole('combobox', { name: /^Existing execution attempt/ })).toHaveValue(attempt.attempt_id);
  await expect(note().getByText('Paper verdict: INCONCLUSIVE', { exact: true })).toBeVisible();

  await app.close();
  await launch();
  expect((await reading()).annotations[0].id).toBe(annotation.id);
  expect((await evidence()).items.find(row => row.item.id === saved.item.id).attempts).toEqual(saved.attempts);
  expect(await compare()).toEqual(comparison);
  expect(errors).toEqual([]);
  const bundle = join(profile, 'desktop/app-data/paper-agent/research-v1/pcgym-bundles', saved.spec.id);
  const runCli = (...args) => execFileSync(python, ['-m', 'paper_agent.pcgym', ...args], {
    cwd: resolve(root, 'apps/paper-agent/backend'), encoding: 'utf8' });
  const verification = JSON.parse(runCli('verify', '--bundle', bundle, '--attempt', attempt.attempt_id));
  expect(verification.numeric_recomputation).toBe('PASS');
  const unpacked = join(profile, 'clean-check');
  execFileSync(python, ['-m', 'zipfile', '-e', archive, unpacked]);
  const checked = JSON.parse(execFileSync(python, ['-E', '-s', '-S', 'verify.py'], { cwd: unpacked, encoding: 'utf8' }));
  expect(checked).toEqual(Object.fromEntries(Object.entries(verification).filter(([key]) => !['observation_sha256', 'checker_sha256'].includes(key))));
  const researchRecord = JSON.parse(await readFile(join(unpacked, 'research-record.json'), 'utf8'));
  const handoffReadme = await readFile(join(unpacked, 'README.md'), 'utf8');
  expect(handoffReadme).toContain('python3.12 -E -s -S verify.py');
  expect(handoffReadme).toContain(`--spec-sha ${saved.spec.id}`);
  if (dataset) {
    expect(researchRecord.dataVersions).toMatchObject([{ versionId: dataset.id, sha256: dataset.sha256, name: dataFile }]);
    expect(execFileSync(python, ['-m', 'zipfile', '-l', archive], { encoding: 'utf8' })).not.toContain(dataFile);
  }
  expect(researchRecord.attempts[0].attemptId).toBe(attempt.attempt_id);
  if (variant) expect(researchRecord.attempts[1].attemptId).toBe(variant.attempts[0].attempt_id);
  expect(JSON.parse(await readFile(join(unpacked, 'verification-item.json'), 'utf8'))).toEqual(saved.item);
  expect(researchRecord.sourceVersions[0].pdfDigest).toBe(fileDigest);
  expect((await api('/api/research/record', { operation: 'read', recordId: researchRecord.id })).attempts).toEqual(researchRecord.attempts);
  const execution = JSON.parse(await readFile(join(unpacked, 'execution.json'), 'utf8'));
  const environment = JSON.parse(await readFile(join(unpacked, 'environment.json'), 'utf8'));
  expect(execution.worker_started).toBe(true);
  for (const policy of ['base', 'shaped']) {
    expect(environment.training[policy].actual_timesteps).toBe(saved.spec.steps);
    expect(environment.training[policy].gradient_updates).toBeGreaterThan(0);
  }
  await writeFile(join(out, 'report.json'), JSON.stringify({ fileDigest, annotationId: annotation.id,
    item: saved.item, spec: saved.spec, comparison, verification, execution, training: environment.training, researchRecordId: researchRecord.id,
    dataVersions: researchRecord.dataVersions,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    archiveSha256: createHash('sha256').update(await readFile(archive)).digest('hex') }, null, 2));
  console.log('Original PDF selection, native approval, real PC-Gym worker, annotation comparison, restart and offline checker passed.');
}
try {
  await exercise();
} catch (error) {
  await page?.screenshot({ path: join(out, 'failure.png'), timeout: 4000 }).catch(() => {});
  throw error;
} finally {
  try { await app?.close(); } finally { await rm(profile, { recursive: true, force: true }); }
}

/** Actual Paper UI in Chromium; backend/Host seam is deterministic synthetic HTTP. */
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { groupResearchResources } from '../../apps/paper-agent/ui-src/research-groups.ts';
import { researchFixture, installResearchChatFixture } from '../fixtures/research-import.mjs';

// Presentation grouping cannot establish file equivalence or transfer grants.
const representations = [
  { id: 'pdf-v1', kind: 'pdf_candidate', workIdentity: 'arxiv:2606.03979', revision: 'v1', title: 'Same title' },
  { id: 'paper-v1', kind: 'paper', workIdentity: 'arxiv:2606.03979', revision: 'v1', title: 'Same title' },
  { id: 'source-v1', kind: 'source_archive', workIdentity: 'arxiv:2606.03979', revision: 'v1', title: 'Different caption' },
];
for (const { members, expected } of [
  { members: representations, expected: [['pdf-v1', 'paper-v1', 'source-v1']] },
  { members: [...representations, { ...representations[0], id: 'pdf-v2', revision: 'v2' }], expected: [['pdf-v1', 'paper-v1', 'source-v1'], ['pdf-v2']] },
  { members: representations.map(value => ({ ...value, revision: null })), expected: [['pdf-v1'], ['paper-v1'], ['source-v1']] },
  { members: representations.map(value => ({ ...value, workIdentity: null })), expected: [['pdf-v1'], ['paper-v1'], ['source-v1']] },
  { members: [representations[0], { ...representations[0], id: 'other-file' }], expected: [['pdf-v1', 'other-file']] },
  { members: [representations[0], { ...representations[0], id: 'other-work', workIdentity: 'arxiv:2606.03980' }], expected: [['pdf-v1'], ['other-work']] },
]) expect(groupResearchResources(members).map(group => group.resources.map(resource => resource.id))).toEqual(expected);
expect(groupResearchResources(representations)[0].html.id).toBe('paper-v1');
expect(groupResearchResources(representations)[0].primary.id).toBe('paper-v1');

const root = resolve(import.meta.dirname, '../..'), dist = resolve(root, 'apps/paper-agent/dist');
const out = resolve(process.env.PERO_RESEARCH_TEST_OUTPUT || resolve(root, 'test-results/research-import'));
await mkdir(out, { recursive: true });
const fixture = researchFixture(), errors = [], checks = [];
const server = createServer(async (request, response) => {
  try {
    if (await fixture.handle(request, response)) return;
    const path = resolve(dist, `.${new URL(request.url, 'http://localhost').pathname === '/' ? '/index.html' : new URL(request.url, 'http://localhost').pathname}`);
    if (!path.startsWith(dist + sep)) throw Error('Invalid fixture path');
    const data = await readFile(path);
    // Match the production App frame's sandbox flags, including no allow-forms.
    // CSP applies the same browser restrictions without replacing the SDK seam.
    const sandbox = extname(path) === '.html' ? { 'Content-Security-Policy': 'sandbox allow-scripts allow-same-origin allow-downloads allow-popups' } : {};
    response.writeHead(200, { ...sandbox, 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' })[extname(path)] || 'application/octet-stream' }); response.end(data);
  } catch (error) { response.writeHead(404); response.end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.PERO_CHROMIUM_PATH || '/usr/bin/chromium', headless: true });
const page = await browser.newPage({ viewport: { width: 1060, height: 960 } });
await page.addInitScript(installResearchChatFixture);
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
const urlInput = () => page.getByRole('textbox', { name: 'Research URL', exact: true });
const review = () => page.getByRole('region', { name: 'Review resources' });
const openImport = async () => { await page.getByRole('button', { name: 'Add papers', exact: true }).click(); await page.getByRole('tab', { name: 'Research URL', exact: true }).click(); };
const inspect = async url => { await urlInput().fill(url); await urlInput().press('Enter'); };
const capture = name => page.screenshot({ path: resolve(out, `${name}.png`), fullPage: true });
try {
  await page.goto(origin); await openImport();
  // Negative control: native submission must really be blocked in this fixture.
  expect(await page.evaluate(() => {
    const form = document.createElement('form'); let submitted = false;
    form.addEventListener('submit', event => { event.preventDefault(); submitted = true; });
    document.body.append(form); form.requestSubmit(); form.remove(); return submitted;
  })).toBe(false);
  await page.getByRole('tab', { name: 'Research URL', exact: true }).focus();
  await page.keyboard.press('Home'); await expect(page.getByRole('tab', { name: 'Search', exact: true })).toBeFocused();
  await page.keyboard.press('End'); await expect(page.getByRole('tab', { name: 'Research URL', exact: true })).toBeFocused();
  await inspect('http://example.org/article'); await expect(page.getByRole('alert')).toContainText('Use a public HTTPS URL');
  expect(fixture.requests.filter(item => item.path.endsWith('/inspect'))).toHaveLength(0);
  await urlInput().fill('https://example.org/article');
  await page.getByRole('button', { name: 'Inspect link', exact: true }).click(); await expect(review()).toBeVisible();
  expect(fixture.requests.filter(item => item.path.endsWith('/inspect') && item.body.url)).toHaveLength(1);
  await expect(review().getByRole('checkbox')).toHaveCount(6);
  const references = review().locator('.pa-resource-title').getByRole('checkbox');
  await expect(references).toHaveCount(5);
  for (const checkbox of await references.all()) await expect(checkbox).toBeChecked();
  await expect(review().getByRole('checkbox', { name: /^Download / })).not.toBeChecked();
  const downloadRow = review().locator('.pa-resource-list>li').filter({ has: page.getByRole('checkbox', { name: /^Download / }) });
  const identityBox = await downloadRow.locator('.pa-resource-identity').boundingBox(), filesBox = await downloadRow.locator('.pa-resource-files').boundingBox();
  expect(filesBox.x).toBeGreaterThanOrEqual(identityBox.x + identityBox.width);
  await expect(review().locator('.pa-resource-actions details[open]')).toHaveCount(0);
  for (const checkbox of await references.all()) await checkbox.uncheck();
  await expect(page.getByRole('button', { name: 'Save references only', exact: true })).toBeDisabled();
  await expect(review().getByRole('checkbox', { name: /^Download / })).toBeDisabled();
  for (const checkbox of await references.all()) await checkbox.check();
  await expect(review()).toContainText('Article'); await expect(review()).toContainText('Model'); await expect(review()).toContainText('License unknown');
  await expect(review()).toContainText('Earlier paper; not evidence of this model version.');
  await expect(review().getByRole('button', { name: 'Clone with Agent', exact: true })).toHaveCount(0);
  await review().getByText('Source details', { exact: true }).first().click();
  await expect(review()).toContainText('<img src=x'); expect(await page.evaluate(() => window.externalExecuted)).toBeUndefined();
  await expect(review().locator('img')).toHaveCount(0);
  await capture('review-light');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.postMessage({ type: 'pero:app:context', context: { locale: 'en', dark: true, active: true } }, '*'));
  await expect.poll(() => page.locator('html').evaluate(element => element.style.colorScheme)).toBe('dark');
  await expect.poll(() => page.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect.poll(() => page.locator('.pa-library-screen').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await capture('review-dark-narrow');
  checks.push('Typed review, default reference selection, plain untrusted text, HTTPS affordance, keyboard tabs and narrow dark layout');
  await page.getByRole('button', { name: 'Inspect again', exact: true }).click(); await expect(review()).toBeVisible();
  expect(fixture.requests.filter(item => item.path.endsWith('/inspect') && item.body.url).at(-1).body.refresh).toBe(true);
  await page.setViewportSize({ width: 1060, height: 960 });
  await page.evaluate(() => window.postMessage({ type: 'pero:app:context', context: { locale: 'en', dark: false, active: true } }, '*'));
  await review().getByRole('checkbox', { name: 'Forecast evaluation', exact: true }).uncheck();
  fixture.failCommit = true;
  await page.getByRole('button', { name: 'Save references only', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic save failed');
  await expect(review().getByRole('checkbox', { name: 'Forecast evaluation', exact: true })).not.toBeChecked();
  fixture.failCommit = false;
  await page.getByRole('button', { name: 'Save references only', exact: true }).dblclick();
  await expect(page.locator('.pa-research-bundle').getByRole('heading', { name: 'Synthetic forecasting article', level: 1, exact: true })).toBeVisible();
  expect(fixture.bundles.size).toBe(1); expect([...fixture.bundles.values()][0].resources).toHaveLength(4);
  await expect(page.locator('.pa-research-bundle .pa-bundle-resources>li')).toHaveCount(4);
  const referenceCommits = fixture.requests.filter(item => item.path.endsWith('/commit'));
  expect(referenceCommits).toHaveLength(2); expect(referenceCommits.at(-1).body.downloadIds).toEqual([]); expect(referenceCommits.at(-1).body.confirmedDownloads).toBe(false);
  expect(fixture.requests.filter(item => item.path === '/host/research-assets')).toHaveLength(0);
  await capture('saved-bundle');
  const codeRow = page.locator('.pa-research-bundle .pa-bundle-resources>li').filter({ hasText: 'Forecast implementation' });
  await expect(codeRow.getByRole('button', { name: 'Clone with Agent', exact: true })).toBeVisible();
  const mutationsBeforeClone = fixture.requests.filter(item => item.path.endsWith('/commit') || item.path.startsWith('/host/')).length;
  await page.evaluate(() => { window.researchChatFixture.failNext = true; });
  await codeRow.getByRole('button', { name: 'Clone with Agent', exact: true }).click();
  await expect(codeRow.getByRole('alert')).toContainText('Synthetic draft unavailable');
  await codeRow.getByRole('button', { name: 'Clone with Agent', exact: true }).click();
  await expect(codeRow.getByText('Clone request prepared in Host. Nothing cloned yet.', { exact: true })).toBeVisible();
  const chat = await page.evaluate(() => window.researchChatFixture);
  expect(chat.requests).toHaveLength(2); expect(chat.snapshots).toHaveLength(1);
  const options = chat.requests[1].options, snapshot = chat.snapshots[0];
  expect(Object.keys(options).sort()).toEqual(['attachments', 'message']);
  expect(options.message).toContain('Prepare a repository clone from the attached saved Paper reference.');
  expect(options.message).toContain('not permission or a completed clone');
  expect(options.attachments).toEqual([{ type: 'app-object', objectId: 'research-code-code', revision: snapshot.revision, selection: { intent: 'clone-repository', bundleId: [...fixture.bundles.keys()][0], resourceId: 'code' } }]);
  expect(snapshot).toMatchObject({ id: 'research-code-code', kind: 'research-clone-request', state: { status: 'not_started', bundleId: [...fixture.bundles.keys()][0], seedUrl: 'https://example.org/article', resourceId: 'code', source: { identity: 'github:example/forecast', url: 'https://github.com/example/forecast', license: 'Apache-2.0', revision: null, evidence: [{ url: 'https://example.org/article', label: 'Linked from the article' }] } } });
  expect(fixture.requests.filter(item => item.path.endsWith('/commit') || item.path.startsWith('/host/'))).toHaveLength(mutationsBeforeClone);
  await capture('clone-unsent-request');
  checks.push('Saved code opens only a frozen SDK composer request; failed Host acknowledgement is retryable, success does not claim cloning or mutate references/assets');
  await page.reload();
  await page.getByRole('navigation', { name: 'Papers', exact: true }).getByRole('button', { name: 'Synthetic forecasting article', exact: true }).click();
  await expect(page.locator('.pa-research-bundle').getByRole('heading', { name: 'Synthetic forecasting article', level: 1, exact: true })).toBeVisible();
  checks.push('Save error preserves selections; reference-only commit makes zero Host download calls; bundle survives App reload and reopens');
  await page.getByRole('button', { name: 'Back to library', exact: true }).click(); await openImport();
  await inspect('https://example.org/article'); await expect(review()).toBeVisible();
  await review().getByRole('checkbox', { name: /^Download / }).check();
  await expect(page.getByRole('button', { name: 'Save and download' })).toBeDisabled();
  await review().getByRole('checkbox', { name: /^I confirm downloading/ }).check();
  fixture.failDownload = true;
  await page.getByRole('button', { name: 'Save and download' }).click();
  await expect(page.getByRole('region', { name: 'Downloads', exact: true }).getByRole('alert')).toContainText('Synthetic transfer failed');
  expect(fixture.bundles.size).toBe(1); await expect(page.locator('.pa-research-bundle').getByRole('heading', { name: 'Synthetic forecasting article', level: 1, exact: true })).toBeVisible();
  await capture('download-error'); fixture.failDownload = false; fixture.holdDownloads = true;
  await page.getByRole('button', { name: 'Retry download', exact: true }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel download', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('cancelled');
  fixture.holdDownloads = false;
  await page.getByRole('button', { name: 'Retry download', exact: true }).click();
  await expect(page.getByText('Available in Data', { exact: true })).toBeVisible();
  await page.getByText('Download receipt', { exact: true }).click(); await expect(page.getByText('catalog-model', { exact: true })).toBeVisible();
  await capture('download-complete');
  checks.push('Explicit consolidated download confirmation, same-bundle reuse, Host-only progress/cancel/retry and receipt; failed transfer leaves references saved');
  // A prior failed choice must not be replayed by a later confirmation of another file.
  fixture.extraAsset = true;
  for (const job of fixture.jobs.values()) { job.status = 'failed'; job.error = 'Earlier failed choice'; }
  const oldStarts = fixture.requests.filter(item => item.path === '/host/research-assets' && item.body.operation === 'start' && item.body.assetId === 'model-file').length;
  await page.getByRole('button', { name: 'Back to library', exact: true }).click(); await openImport();
  await inspect('https://example.org/article'); await expect(review()).toBeVisible();
  await review().getByRole('checkbox', { name: /^Download config.json/ }).check();
  await review().getByRole('checkbox', { name: /^I confirm downloading/ }).check();
  await page.getByRole('button', { name: 'Save and download' }).click();
  await expect.poll(() => fixture.requests.filter(item => item.path === '/host/research-assets' && item.body.operation === 'start' && item.body.assetId === 'second-file').length).toBe(1);
  await expect(page.getByText('Available in Data', { exact: true })).toBeVisible();
  expect(fixture.requests.filter(item => item.path === '/host/research-assets' && item.body.operation === 'start' && item.body.assetId === 'model-file')).toHaveLength(oldStarts);
  checks.push('Same-bundle new save refreshes the view; automatic download uses only the current exact confirmation, not historical failed choices');
  await page.getByRole('button', { name: 'Back to library', exact: true }).click(); await openImport();
  fixture.failInspection = true; await inspect('https://example.org/failed');
  await expect(page.getByRole('alert')).toContainText('Synthetic source timed out');
  fixture.failInspection = false; await page.getByRole('button', { name: 'Retry inspection', exact: true }).click(); await expect(review()).toBeVisible();
  await page.getByRole('button', { name: 'New URL', exact: true }).click(); fixture.holdInspection = true;
  await inspect('https://example.org/slow'); await expect(page.getByText('Inspecting sources…', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel inspection', exact: true }).click(); await expect(page.getByText('Inspection cancelled.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'New URL', exact: true }).click(); fixture.delayedStart = 'https://example.org/delayed';
  await inspect(fixture.delayedStart); await expect.poll(() => typeof fixture.releaseStart).toBe('function');
  await expect(page.getByRole('button', { name: 'Inspecting…', exact: true })).toBeDisabled();
  await urlInput().press('Enter'); await urlInput().press('Enter');
  expect(fixture.requests.filter(item => item.body.url === fixture.delayedStart)).toHaveLength(1);
  await page.getByRole('button', { name: 'New URL', exact: true }).click();
  fixture.releaseStart(); fixture.holdInspection = false;
  await inspect('https://example.org/new'); await expect(review()).toBeVisible(); await expect(urlInput()).toHaveValue('https://example.org/new');
  await expect.poll(() => [...fixture.drafts.values()].find(draft => draft.seedUrl === 'https://example.org/delayed').status).toBe('cancelled');
  await page.getByRole('button', { name: 'Back to library', exact: true }).click(); await openImport();
  await expect(review()).toBeVisible(); await expect(urlInput()).toHaveValue('https://example.org/new');
  await page.reload(); await openImport(); await page.getByText(/^Resume an inspection/).click();
  await page.getByRole('button', { name: 'https://example.org/new', exact: true }).click(); await expect(review()).toBeVisible();
  checks.push('No-forms App sandbox with pointer/Enter inspection, no duplicate pending starts; error/retry/cancel, stale response rejection and persisted draft resume');
  fixture.groupedVersions = true;
  await page.getByRole('button', { name: 'New URL', exact: true }).click();
  await inspect('https://example.org/grouped'); await expect(review()).toBeVisible();
  await expect(review().locator('.pa-resource-list>li')).toHaveCount(2);
  const version1 = review().locator('[data-resource-group="work:arxiv:2606.03979:v1"]');
  const version2 = review().locator('[data-resource-group="work:arxiv:2606.03979:v2"]');
  for (const row of [version1, version2]) {
    await expect(row.getByRole('checkbox', { name: /^Allow official HTML for Read/ })).toHaveCount(1);
    await expect(row.getByRole('checkbox', { name: /^Download PDF for reading/ })).toHaveCount(1);
    await expect(row.getByRole('checkbox', { name: /^Get source for read-only inspection/ })).toHaveCount(1);
  }
  await expect(version1.getByRole('checkbox', { name: 'Same paper title v1', exact: true })).toBeChecked();
  await version2.getByRole('checkbox', { name: 'Same paper title v2', exact: true }).uncheck();
  await expect(version2.getByRole('checkbox', { name: /^Download PDF/ })).toBeDisabled();
  await version1.getByRole('checkbox', { name: /^Allow official HTML/ }).check();
  await version1.getByRole('checkbox', { name: /^Download PDF/ }).check();
  await version1.getByRole('checkbox', { name: /^Download PDF/ }).uncheck();
  await expect(page.locator('.pa-download-confirm')).toContainText('(1)');
  await page.getByRole('checkbox', { name: /^I confirm downloading/ }).check();
  await page.setViewportSize({ width: 1060, height: 960 });
  await page.evaluate(() => window.postMessage({ type: 'pero:app:context', context: { locale: 'en', dark: false, active: true } }, '*'));
  await capture('review-grouped-versions');
  await page.getByRole('button', { name: 'Save HTML permission', exact: true }).click();
  await expect(page.locator('.pa-research-bundle').getByRole('heading', { name: 'Synthetic forecasting article', level: 1, exact: true })).toBeVisible();
  const groupedCommit = fixture.requests.filter(request => request.path === '/api/research/commit').at(-1).body;
  expect(groupedCommit.resourceIds).toEqual(['paper-v1', 'pdf_candidate-v1', 'source_archive-v1']);
  expect(groupedCommit.htmlIds).toEqual(['paper-v1']); expect(groupedCommit.pdfIds).toEqual([]); expect(groupedCommit.sourceIds).toEqual([]);
  expect(fixture.requests.some(request => ['/api/research/pdf', '/api/research/source'].includes(request.path) && request.body.operation === 'start')).toBe(false);
  await page.getByRole('button', { name: 'Back to library', exact: true }).click(); await openImport();
  await page.getByText(/^Resume an inspection/).click();
  await page.getByRole('button', { name: 'https://example.org/grouped', exact: true }).click(); await expect(review()).toBeVisible();
  checks.push('Confirmed work/version representations share one row and one HTML choice; versions and unknown identities remain separate, file IDs/grants stay independent');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.postMessage({ type: 'pero:app:context', context: { locale: 'zh-CN', dark: true, active: true } }, '*'));
  await expect(page.getByRole('tab', { name: '链接导入', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '研究链接', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '仅保存引用', exact: true })).toBeVisible();
  await expect.poll(() => page.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await capture('review-zh-dark-narrow');
  checks.push('Resource identity and file choices use separate columns, details start folded, and Chinese narrow mode keeps the save action and URL control usable');
  expect(errors).toEqual([]);
  const hashes = Object.fromEntries(await Promise.all(['js', 'css'].map(async extension => [extension, createHash('sha256').update(await readFile(resolve(dist, `index.${extension}`))).digest('hex')])));
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ checks, errors, hashes, scope: 'Chromium real Paper UI with synthetic HTTP Paper and Host seams. No Electron/native Host, real network, LLM, or actual asset download.' }, null, 2));
  console.log(JSON.stringify({ checks, errors, hashes }, null, 2));
} catch (error) { await capture('failure'); throw error; }
finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }

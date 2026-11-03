// Browser acceptance against the shipped bundle, real IndexedDB and real local RDKit.
// No Electron/GPUI, signed installer, Agent review or scientific-validity claim.
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { scientificViewerPreview } from '../fixtures/scientific-viewer-browser.mjs';

const root = resolve(import.meta.dirname, '../..');
const preview = await scientificViewerPreview();
if (process.argv.includes('--serve')) {
  console.log(JSON.stringify({ ...preview, close: undefined }));
  try { for await (const line of createInterface({ input: process.stdin })) if (line === 'stop') break; }
  finally { await preview.close(); process.stdin.pause(); }
} else {
  const { chromium, expect } = await import('@playwright/test');
  const out = resolve(process.env.PERO_VIEWER_TEST_OUTPUT || resolve(root, 'test-results/scientific-viewer-browser'));
  await mkdir(out, { recursive: true });
  const errors = [], checks = [];
  let browser, page, phase = 'launch';
  try {
    browser = await chromium.launch({ ...(process.env.PERO_CHROMIUM_PATH ? { executablePath: process.env.PERO_CHROMIUM_PATH } : {}), headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().url().startsWith(preview.url) ? route.continue() : route.abort());
    await page.goto(preview.url);
    const app = page.frameLocator('iframe[title="scientific-viewer"]');
    const example = async name => {
      await app.getByLabel('Example', { exact: true }).selectOption(name);
      await expect(app.getByLabel('Current file', { exact: true }).locator('option:checked')).toHaveText(name);
      await expect(app.getByText('Synthetic example, unverified', { exact: true })).toBeVisible();
    };
    const capture = name => page.locator('iframe').screenshot({ path: resolve(out, `${name}.png`) });
    const noOverflow = async () => expect(await app.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    phase = 'molecules';
    await example('solvents.smi');
    await expect(app.getByRole('img', { name: 'Molecule 1', exact: true })).toBeVisible({ timeout: 30000 });
    await expect(app.getByRole('button', { name: /^Select Molecule / })).toHaveCount(3);
    // Shared illustration CSS must never position imported structures over the workbench.
    for (let index = 1; index <= 3; index++) {
      const card = await app.getByRole('button', { name: `Select Molecule ${index}`, exact: true }).boundingBox();
      const image = await app.getByRole('img', { name: `Molecule ${index}`, exact: true }).boundingBox();
      expect(image.x).toBeGreaterThanOrEqual(card.x);
      expect(image.y).toBeGreaterThanOrEqual(card.y);
      expect(image.x + image.width).toBeLessThanOrEqual(card.x + card.width + 1);
      expect(image.y + image.height).toBeLessThanOrEqual(card.y + card.height + 1);
    }
    await app.getByRole('button', { name: 'Select Molecule 3', exact: true }).click();
    const ethanol = app.getByRole('button', { name: 'Select Molecule 2', exact: true });
    await ethanol.focus(); await page.keyboard.press('Enter');
    await expect(ethanol).toHaveAttribute('aria-pressed', 'true');
    const details = app.getByRole('complementary', { name: 'Molecule details', exact: true });
    await expect(details.getByRole('heading', { name: 'Molecule 2', exact: true })).toBeVisible();
    await expect(details.getByText('CCO', { exact: true })).toBeVisible();
    await expect(details).toContainText('Molar mass');
    await expect(details).toContainText(/46\.0[67]/);
    const separator = app.getByRole('separator', { name: 'Resize molecule details', exact: true });
    await separator.focus(); const before = await separator.getAttribute('aria-valuenow');
    await page.keyboard.press('ArrowLeft');
    await expect(separator).not.toHaveAttribute('aria-valuenow', before);
    await ethanol.click();
    await noOverflow(); await capture('molecules-light');
    checks.push('Real RDKit structures and selected ethanol descriptors; keyboard selection and SDK splitter');

    phase = 'numeric-chart';
    await example('diffraction.csv');
    await expect(app.getByRole('button', { name: 'Chart', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(app.getByRole('img', { name: 'Chart of intensity against 2theta[deg]', exact: true })).toBeVisible();
    await expect(app.locator('.numeric-point')).toHaveCount(4);
    await app.getByRole('img', { name: 'Chart of intensity against 2theta[deg]', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(app.locator('.numeric-chart-caption output')).toHaveText('Row 2: 2theta[deg] 20, intensity 8');
    await capture('diffraction-chart');
    await app.getByRole('button', { name: 'Table', exact: true }).click();
    await expect(app.getByRole('table', { name: 'diffraction.csv data', exact: true }).locator('tbody tr')).toHaveCount(4);
    await expect(app.getByText('Showing up to 200 rows', { exact: true })).toHaveCount(0);
    await example('voltage-gaps.csv');
    await expect(app.locator('.numeric-point')).toHaveCount(2);
    const path = await app.locator('.numeric-series').getAttribute('d');
    expect(path.match(/M/g)).toHaveLength(2); expect(path).not.toMatch(/L/);
    await expect(app.locator('.numeric-metadata')).toContainText('1 missing value');
    await expect(app.getByRole('alert')).toContainText('1 missing or nonnumeric pairs; gaps are not interpolated.');
    await expect(app.locator('.numeric-chart-caption')).toContainText('2 of 3 numeric pairs');
    await capture('voltage-gaps-chart');
    await app.getByRole('button', { name: 'Table', exact: true }).click();
    await expect(app.getByRole('cell', { name: 'Missing', exact: true })).toHaveCount(1);
    await capture('voltage-missing-table');
    await app.getByRole('button', { name: 'Chart', exact: true }).click();
    await app.getByLabel('X axis', { exact: true }).selectOption('1');
    await app.getByLabel('Y axis', { exact: true }).selectOption('0');
    await expect(app.getByRole('img', { name: 'Chart of time[s] against voltage[V]', exact: true })).toBeVisible();
    await app.getByRole('button', { name: 'Table', exact: true }).click();
    await app.getByRole('button', { name: 'Chart', exact: true }).click();
    await expect(app.getByLabel('X axis', { exact: true })).toHaveValue('1');
    await expect(app.getByLabel('Y axis', { exact: true })).toHaveValue('0');
    checks.push('Labeled chart from exact numeric inputs; missing rows remain discontinuities and visible table cells; axis selection retained');

    phase = 'import-and-pagination';
    const long = 'time[s],signal[V]\n' + Array.from({ length: 205 }, (_, i) => `${i},${i / 10}`).join('\n') + '\n';
    await app.getByLabel('Import file', { exact: true }).setInputFiles({ name: '205-observations.csv', mimeType: 'text/csv', buffer: Buffer.from(long) });
    await expect(app.getByLabel('Current file', { exact: true }).locator('option:checked')).toHaveText('205-observations.csv');
    await app.getByRole('button', { name: 'Table', exact: true }).click();
    await expect(app.getByRole('table').locator('tbody tr')).toHaveCount(100);
    await app.getByRole('button', { name: 'Next page', exact: true }).click();
    await app.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(app.getByRole('table').locator('tbody tr')).toHaveCount(5);
    await expect(app.getByText('Rows 201–205 of 205', { exact: true })).toBeVisible();
    await expect(app.getByRole('button', { name: 'Next page', exact: true })).toBeDisabled();
    await page.reload();
    await app.getByLabel('Current file', { exact: true }).selectOption({ label: '205-observations.csv' });
    await expect(app.locator('.numeric-point')).toHaveCount(205);
    checks.push('Native file import persists exact 205 rows through IndexedDB reload; every row reachable by pagination');

    phase = 'invalid-and-recovery';
    await example('invalid-molecules.smi');
    await expect(app.getByRole('alert')).toContainText('Invalid molecule', { timeout: 30000 });
    await expect(app.getByRole('img', { name: 'Molecule 1', exact: true })).toBeVisible();
    await app.getByLabel('Import file', { exact: true }).setInputFiles({ name: 'empty.smi', mimeType: 'text/plain', buffer: Buffer.from(' \n\t\n') });
    await expect(app.getByRole('alert')).toContainText('No molecule records');
    await expect(app.getByRole('button', { name: 'Retry molecule preview', exact: true })).toBeVisible();
    await example('solvents.smi');
    await expect(app.getByRole('img', { name: 'Molecule 3', exact: true })).toBeVisible({ timeout: 30000 });
    checks.push('Per-record RDKit failure remains visible; empty-file error and subsequent import recovery');

    phase = 'theme-and-narrow';
    await page.getByLabel('Theme', { exact: true }).selectOption('dark');
    await expect(app.locator('html')).toHaveAttribute('data-theme', 'pero-dark');
    await capture('molecules-dark');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(app.getByRole('separator')).toHaveCount(0);
    await noOverflow(); await capture('molecules-dark-narrow');
    await example('voltage-gaps.csv');
    await expect(app.locator('.numeric-point')).toHaveCount(2);
    await noOverflow(); await capture('chart-dark-narrow');
    await app.getByRole('button', { name: 'Table', exact: true }).click();
    await expect(app.getByRole('cell', { name: 'Missing', exact: true })).toBeVisible();
    await noOverflow(); await capture('table-dark-narrow');
    checks.push('Real SDK dark theme; 390px stacked molecule panes, chart/table and no document overflow');
    expect(errors).toEqual([]);
    await writeFile(resolve(out, 'result.json'), JSON.stringify({ scope: 'Production App bundle in Chromium with real local RDKit and IndexedDB; Desktop transport replaced by fixture', engine: preview.engine, checks, errors,
      bundleSha256: createHash('sha256').update(await readFile(resolve(root, 'apps/scientific-viewer/dist/index.js'))).digest('hex'),
      exclusions: ['Electron/GPUI integration', 'PDF/Agent/evidence workflow', 'scientific validity', 'signed package or cross-platform certification'] }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, engine: preview.engine, output: out }));
  } catch (error) {
    if (page) await page.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {});
    await writeFile(resolve(out, 'failure.json'), JSON.stringify({ phase, checks, errors, error: String(error.stack || error) }, null, 2));
    throw error;
  } finally { await browser?.close(); await preview.close(); }
}

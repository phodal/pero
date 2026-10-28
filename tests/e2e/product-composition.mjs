// Two built fixture Apps prove product composition and retained panel state.
import { _electron as electron, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const temp = mkdtempSync(join(tmpdir(), 'pero-product-composition-'));
const out = resolve(root, 'test-results/product-composition');
mkdirSync(out, { recursive: true });
const product = { schemaVersion: 1, id: 'com.openpero.lab', name: 'Research Lab', version: '1.0.0', shell: 'app', apps: ['atlas', 'simulation'], entry: { app: 'atlas', panel: 'main' }, python: 'system' };
const distribution = join(temp, 'distribution');
// Like the single-App suite, use the current product build outputs and real Host.
cpSync(resolve(root, 'target/products/virtual-cell'), distribution, { recursive: true });
rmSync(join(distribution, 'apps'), { recursive: true });
writeFileSync(join(distribution, 'product.json'), JSON.stringify(product));
for (const name of product.apps) {
  const directory = join(distribution, 'apps', name);
  mkdirSync(join(directory, 'dist'), { recursive: true });
  writeFileSync(join(directory, 'app.json'), JSON.stringify({ schemaVersion: 1, name, version: '1.0.0', displayName: name === 'atlas' ? 'Cell Atlas' : 'Reaction Simulation', contributes: { panels: [{ id: 'main', title: name, entry: 'dist/index.html' }] } }));
  writeFileSync(join(directory, 'app-bundle.json'), JSON.stringify({ schemaVersion: 1, name, files: ['app.json', 'dist/index.html', 'dist/index.js'] }));
  writeFileSync(join(directory, 'dist/index.html'), `<!doctype html><h1>${name}</h1><label>Notes <input></label><script src="index.js"></script>`);
  writeFileSync(join(directory, 'dist/index.js'), "parent.postMessage({type:'pero:app:ready'}, '*');");
}
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: join(temp, 'profile'), PERO_LOCALE: 'en' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['--use-mock-keychain', join(temp, 'distribution')], env });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await expect(page).toHaveTitle('Research Lab');
  const selector = page.getByRole('combobox', { name: 'Switch App' });
  await expect(selector).toBeVisible();
  const atlas = page.frameLocator('iframe[title="atlas"]');
  await expect(atlas.getByRole('heading', { name: 'atlas' })).toBeVisible();
  await expect(selector.locator('option')).toHaveText(['Cell Atlas', 'Reaction Simulation']);
  await atlas.getByLabel('Notes').fill('Keep these notes');
  await selector.selectOption('simulation');
  await expect(page.frameLocator('iframe[title="simulation"]').getByRole('heading', { name: 'simulation' })).toBeVisible();
  await selector.selectOption('atlas');
  await expect(atlas.getByLabel('Notes')).toHaveValue('Keep these notes');
  const rejection = await page.evaluate(async () => {
    try { await window.product.open('not-in-product'); return ''; } catch (error) { return error.message; }
  });
  expect(rejection).toContain('included in this Product');
  await page.screenshot({ path: join(out, 'switching.png') });
  expect(errors).toEqual([]);
  writeFileSync(join(out, 'result.json'), JSON.stringify({ checks: ['configuration selects two Apps', 'catalog display names', 'switch retains input', 'excluded App refused'], errors }, null, 2));
  console.log('Multi-App product composition passed');
} finally { await app.close(); }

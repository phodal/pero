// Real standalone Data shell + Host + backend. Development system-Python override
// only; this does not establish bundled-runtime or signed-installer acceptance.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { productShellStyle } from '../../scripts/build/shell-style.mjs';
import { build } from 'esbuild';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '../..');
const output = resolve(root, 'test-results/data-product');
await mkdir(output, { recursive: true });
for (const name of ['result.json', 'failure.json']) await rm(join(output, name), { force: true });
const temp = await realpath(await mkdtemp(join(tmpdir(), 'pero-data-product-')));
const distribution = join(temp, 'distribution');
const errors = [], requests = [], checks = [];
let app, page, frame;
const bytes = Buffer.from('time,voltage\n0,12.1\n1,12.2\n2,12.3\n');
const profile = join(temp, 'profile');
await mkdir(profile, { recursive: true });
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: profile, PERO_LOCALE: 'en' };
delete env.ELECTRON_RUN_AS_NODE;
const state = () => frame.locator('body').evaluate(async () => {
  const response = await fetch('/api/state');
  if (!response.ok) throw new Error(`Data state: HTTP ${response.status}`);
  return response.json();
});
async function launch() {
  app = await electron.launch({ args: [distribution], env });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.protocol === 'pero-app:' && url.hostname === 'data' && url.pathname.startsWith('/api/'))
      requests.push({ method: request.method(), path: url.pathname });
  });
  await expect(page).toHaveTitle('Data');
  frame = page.frameLocator('iframe[title="data"]');
  await expect(frame.getByRole('heading', { name: 'Data', exact: true })).toBeVisible({ timeout: 30000 });
  await expect.poll(async () => (await state()).sources.length).toBe(2);
}
async function close() {
  if (!app) return;
  const current = app;
  app = undefined;
  await current.close();
}
try {
  await mkdir(join(distribution, 'desktop/dist'), { recursive: true });
  await mkdir(join(distribution, 'bin'), { recursive: true });
  const host = process.platform === 'win32' ? 'pero-host.exe' : 'pero-host';
  await cp(process.env.PERO_TEST_HOST_BINARY || resolve(root, 'target/debug', host), join(distribution, 'bin', host));
  await build({ entryPoints: { product: resolve(root, 'desktop/src/main/product.ts'), 'product-preload': resolve(root, 'desktop/src/product/preload.ts') },
    outdir: join(distribution, 'desktop/dist'), outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
  const script = await build({ entryPoints: [resolve(root, 'desktop/src/product/shell.ts')], bundle: true, platform: 'browser', format: 'iife', write: false });
  await writeFile(join(distribution, 'desktop/dist/product.html'), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${productShellStyle(root)}</style></head><body><script>${script.outputFiles[0].text}</script></body></html>`);
  await writeFile(join(distribution, 'package.json'), JSON.stringify({ main: 'desktop/dist/product.cjs' }));
  const production = JSON.parse(await readFile(resolve(root, 'products/data/product.json'), 'utf8'));
  expect(production.python).toBe('bundled');
  expect(production.entry).toEqual({ app: 'data', panel: 'main' });
  expect(production.chat ?? false).toBe(false);
  await writeFile(join(distribution, 'product.json'), JSON.stringify({ ...production, python: 'system' }));
  await cp(resolve(root, 'apps/data'), join(distribution, 'apps/data'), {
    recursive: true, filter: path => !['node_modules', '__pycache__', '.git'].includes(basename(path)),
  });
  await launch();
  expect((await state()).assets).toEqual([]);
  expect((await state()).download).toBeNull();
  expect(await frame.locator('body').evaluate(() => ({ product: typeof window.product, pero: typeof window.pero })))
    .toEqual({ product: 'undefined', pero: 'undefined' });
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(page.locator('#product-chat-toggle')).toBeHidden();
  checks.push('production Data entry opens directly in standalone shell without chat or App preload access');
  // Capture the OS boundary: exercise the actual link without opening a browser.
  await app.evaluate(({ shell }) => {
    globalThis.dataExternalUrls = [];
    shell.openExternal = async url => { globalThis.dataExternalUrls.push(url); };
  });
  for (const url of ['http://example.test/source', 'file:///tmp/not-opened', 'pero://workbench/', 'ftp://example.test/source'])
    await page.evaluate(url => window.open(url, '_blank'), url);
  await expect.poll(() => app.evaluate(() => globalThis.dataExternalUrls)).toEqual(['http://example.test/source']);
  expect(app.windows()).toHaveLength(1);
  checks.push('HTTP(S) window.open reaches the stubbed OS opener; other schemes and child windows denied');

  await frame.getByRole('button', { name: 'Add data', exact: true }).click();
  const dialog = frame.getByRole('dialog');
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'standalone.csv', mimeType: 'text/csv', buffer: bytes });
  await expect(dialog).toBeHidden();
  await expect(frame.getByRole('button', { name: 'standalone.csv', exact: true })).toBeVisible();
  expect((await state()).assets).toEqual([]);
  expect((await state()).download).toBeNull();
  await page.screenshot({ path: join(output, 'standalone-data.png') });
  await close();
  await launch();
  expect((await state()).assets).toEqual([]);
  expect((await state()).download).toBeNull();
  await expect(frame.getByRole('button', { name: 'servo-response.csv', exact: true })).toBeVisible();
  await expect(frame.getByRole('button', { name: 'standalone.csv', exact: true })).toHaveCount(0);
  expect(requests.filter(request => request.method === 'POST')).toEqual([]);
  expect(errors).toEqual([]);
  checks.push('in-browser CSV add stays out of the catalog; restart shows the sample library; no import POST');
  await close();
  await writeFile(join(output, 'result.json'), JSON.stringify({ scope: 'standalone-development-system-python', checks, errors, requests,
    productionPython: production.python, temporaryTestPython: 'system', exclusions: ['bundled Python acceptance', 'signed installer', 'live source downloads', 'model execution'] }, null, 2));
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: String(error.stack || error), checks, requests, errors }, null, 2));
  throw error;
} finally {
  await close();
  await rm(temp, { recursive: true, force: true });
}

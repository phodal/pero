// Actual production bundle/Three.js/IndexedDB in Chromium; fixture replaces only shell transport.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { scientificViewerPreview } from '../fixtures/scientific-viewer-browser.mjs';
import { embeddedPngMesh } from '../../apps/scientific-viewer/test/mesh-fixture.mjs';
import { unzipSync, strFromU8 } from '../../apps/scientific-viewer/node_modules/fflate/esm/index.mjs';

const root = resolve(import.meta.dirname, '../..'), out = resolve(root, 'test-results/research-lab-browser');
const manifest = JSON.parse(await readFile(resolve(root, 'apps/scientific-viewer/assets/research-lab/manifest.json'), 'utf8'));
await mkdir(out, { recursive: true });
const preview = await scientificViewerPreview(), errors = [], requests = [], checks = [];
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PERO_CHROMIUM_PATH ? { executablePath: process.env.PERO_CHROMIUM_PATH } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await page.route('**/*', route => route.request().url().startsWith(preview.url) ? route.continue() : route.abort());
  await page.goto(preview.url);
  const app = page.frameLocator('iframe[title="scientific-viewer"]');
  const capture = name => page.locator('iframe').screenshot({ path: resolve(out, `${name}.png`) });
  const openLibrary = () => app.getByRole('button', { name: 'Research Lab', exact: true }).click();
  const ready = () => expect(app.getByRole('button', { name: 'Reset / fit view', exact: true })).toBeEnabled();
  await openLibrary();
  await expect(app.getByRole('heading', { name: 'Research Lab', exact: true })).toBeVisible();
  await capture('research-lab-library');
  for (const entry of manifest) {
    await openLibrary();
    await app.getByRole('button', { name: `Open ${entry.name}`, exact: true }).click();
    await ready();
    await expect(app.getByRole('img', { name: `${entry.file} 3D illustration`, exact: true })).toBeVisible();
    await expect(app.getByText(entry.attribution, { exact: true })).toBeVisible();
    await app.getByText('Geometry and units', { exact: true }).click();
    await expect(app.getByText(/Bounds \(X × Y × Z\)/)).toBeVisible();
    await capture(entry.id);
    const [download] = await Promise.all([page.waitForEvent('download'), app.getByRole('button', { name: 'Download with attribution', exact: true }).click()]);
    const zipped = unzipSync(new Uint8Array(await readFile(await download.path())));
    expect(createHash('sha256').update(zipped[entry.file]).digest('hex')).toBe(entry.sha256);
    expect(strFromU8(zipped['ATTRIBUTION.txt'])).toContain(entry.attribution);
    expect(strFromU8(zipped['ATTRIBUTION.txt'])).toContain(entry.licenseUrl);
  }
  checks.push('Three real bundled GLBs render; attribution visible; every ZIP download retains byte-exact GLB and attribution/license');
  await app.getByRole('img', { name: /3D illustration$/ }).focus();
  const before = await app.locator('.mesh-viewport canvas').screenshot();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('+');
  const after = await app.locator('.mesh-viewport canvas').screenshot();
  expect(before.equals(after)).toBe(false);
  await page.keyboard.press('Home');
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await capture('mesh-dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(await app.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await app.getByRole('button', { name: 'Reset / fit view', exact: true }).click();
  await capture('mesh-dark-narrow');
  checks.push('Keyboard orbit/zoom/reset and SDK dark/narrow 390px surface without horizontal overflow');

  await page.setViewportSize({ width: 1280, height: 900 });
  const oldCanvases = [];
  for (let i = 0; i < 5; i++) {
    oldCanvases.push(await app.locator('.mesh-viewport canvas').elementHandle());
    await openLibrary();
    expect(await oldCanvases.at(-1).evaluate(canvas => canvas.getContext('webgl2').isContextLost())).toBe(true);
    await app.getByRole('button', { name: 'Open Optics Table', exact: true }).click(); await ready();
  }
  await app.getByRole('button', { name: 'Current file', exact: true }).click();
  await expect(app.getByRole('option', { name: 'optics-table-66db15.glb', exact: true })).toHaveCount(1);
  await page.keyboard.press('Escape');
  checks.push('Repeated opens reuse saved local copy; every unmounted mesh canvas loses its WebGL context');

  await context.setOffline(true);
  await openLibrary();
  await app.getByRole('button', { name: 'Open Research Microscope', exact: true }).click(); await ready();
  await context.setOffline(false);
  await page.reload();
  await app.getByRole('button', { name: 'Current file', exact: true }).click();
  await app.getByRole('option', { name: 'research-microscope-77ce04.glb', exact: true }).click(); await ready();
  checks.push('Saved model opens offline and survives IndexedDB reload');

  await app.locator('input[type=file][aria-label="Import file"]').setInputFiles({ name: 'bad.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from('not a GLB') });
  await expect(app.getByRole('alert')).toContainText('Invalid mesh');
  await capture('invalid-glb');
  // A familiar filename must not silently give a user import Polyfork provenance.
  await app.locator('input[type=file][aria-label="Import file"]').setInputFiles(resolve(root, 'apps/scientific-viewer/assets/research-lab/sample-tube-rack-3a32bd.glb'));
  await ready();
  await expect(app.getByText('Source and license unknown; a filename does not establish permission.', { exact: true })).toBeVisible();
  const [raw] = await Promise.all([page.waitForEvent('download'), app.getByRole('button', { name: 'Download original GLB', exact: true }).click()]);
  expect(createHash('sha256').update(await readFile(await raw.path())).digest('hex')).toBe(manifest[2].sha256);
  checks.push('Invalid GLB gives local error; subsequent local import recovers; unknown provenance stays unknown; original download byte-exact');

  await app.locator('input[type=file][aria-label="Import file"]').setInputFiles({ name: 'embedded-texture.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from(embeddedPngMesh()) });
  await ready();
  await capture('embedded-texture-csp');
  checks.push("Embedded PNG texture renders under production connect-src 'self' without fetching its blob");

  await app.locator('.mesh-viewport canvas').evaluate(canvas => canvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
  await expect(app.getByRole('alert')).toContainText('context was lost');
  await app.getByRole('button', { name: 'Retry 3D preview', exact: true }).click(); await ready();
  checks.push('Forced WebGL context loss reports locally and Retry creates a working renderer');
  await app.getByRole('button', { name: 'Examples', exact: true }).click();
  await app.getByRole('menuitem', { name: 'temperature.csv', exact: true }).click();
  await expect(app.getByRole('tab', { name: 'Chart', exact: true })).toHaveAttribute('aria-selected', 'true');
  checks.push('CSV chart remains reachable after mesh teardown');

  const unsupported = await context.newPage();
  await unsupported.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type.startsWith('webgl') ? null : original.call(this, type, ...args); };
  });
  await unsupported.goto(preview.url);
  const noGl = unsupported.frameLocator('iframe[title="scientific-viewer"]');
  await noGl.getByRole('button', { name: 'Research Lab', exact: true }).click();
  await noGl.getByRole('button', { name: 'Open Optics Table', exact: true }).click();
  await expect(noGl.getByRole('alert')).toContainText('Error creating WebGL context');
  await expect(noGl.getByRole('button', { name: 'Download with attribution', exact: true })).toBeEnabled();
  await expect(noGl.getByRole('button', { name: 'Retry 3D preview', exact: true })).toBeEnabled();
  checks.push('WebGL unavailable retains download and recovery actions');
  await unsupported.close();
  expect(requests.filter(url => !url.startsWith(preview.url) && !url.startsWith(`blob:${preview.url}`))).toEqual([]);
  expect(requests.filter(url => /polyfork|\.mjs|draco|meshopt|\.png|\.jpg/.test(new URL(url).pathname))).toEqual([]);
  expect(errors).toEqual([]);
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ checks, errors, externalRequests: [], renderer: 'Chromium + SwiftShader', shell: 'fixture, not Electron/Native', assets: manifest.map(({ id, sha256 }) => ({ id, sha256 })) }, null, 2));
  console.log(checks.join('\n'));
} finally { await browser?.close(); await preview.close(); }

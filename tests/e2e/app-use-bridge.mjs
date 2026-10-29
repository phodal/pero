// Real cross-origin documents exercise the shared App bridge and SDK under App CSP.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const root = resolve(import.meta.dirname, '../..');
const temporary = await mkdtemp(resolve(tmpdir(), 'pero-app-use-bridge-'));
const servers = [];
let browser;
const checks = [];
const errors = [];

try {
  for (const [entry, output] of [['packages/app-sdk/src/app-use.ts', 'sdk.js'], ['web/src/apps.ts', 'apps.js']]) {
    await build({ entryPoints: [resolve(root, entry)], outfile: resolve(temporary, output), bundle: true, format: 'esm', platform: 'browser' });
  }
  const sdk = await readFile(resolve(temporary, 'sdk.js'));
  const apps = await readFile(resolve(temporary, 'apps.js'));
  const appScript = `
    import { AppSurface, installAppUseBridge } from '/sdk.js';
    const surface = new AppSurface();
    let count = 0;
    const update = () => { document.querySelector('output').textContent = count; entry.update(object()); };
    const object = () => ({ id: 'probe', kind: 'counter', label: 'Counter', state: { count }, actions: {
      set: { parameters: { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'], additionalProperties: false },
        run: ({ value }) => { count = value; update(); return count; } },
      hold: { run: () => { document.body.dataset.holding = 'true'; return new Promise(() => {}); } },
    } });
    const entry = surface.register(object());
    document.querySelector('button').onclick = () => { count++; update(); };
    window.addEventListener('message', event => {
      if (!window.geometryOverride || event.data?.request?.action !== 'geometry') return;
      event.stopImmediatePropagation();
      parent.postMessage({ type: 'pero:app-use:result', id: event.data.id, ok: true, value: { rect: window.geometryOverride } }, event.origin);
    });
    installAppUseBridge(surface);
    document.body.dataset.ready = 'true';
    parent.postMessage({ type: 'pero:app:ready' }, '*');
  `;
  const child = createServer((request, response) => {
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'");
    response.setHeader('Content-Type', ['/sdk.js', '/app.js'].includes(request.url) ? 'text/javascript' : 'text/html');
    response.end(request.url === '/sdk.js' ? sdk : request.url === '/app.js' ? appScript : `
      <section data-app-object="probe" style="padding:20px">
        <button>Increment</button><input aria-label="Name"><output>0</output>
      </section><script type="module" src="/app.js"></script>
    `);
  });
  servers.push(child);
  child.listen(0, '127.0.0.1'); await once(child, 'listening');
  const childOrigin = `http://127.0.0.1:${child.address().port}`;
  const parent = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/apps.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/apps.js' ? apps : `
      <style>
        #pero-app-surface { position:fixed }
        #pero-app-surface iframe { width:100%;height:100%;border:0;display:block }
        [hidden] { display:none!important }
      </style>
      <script type="module">
        import { mountAppSurfaces } from '/apps.js';
        window.revoked = [];
        window.peroAppUseRevoke = async thread => window.revoked.push(thread);
        window.surface = mountAppSurfaces(async () => {});
        surface.event({ kind:'apps_opened', data:{ name:'probe', panel:'main', url:'${childOrigin}/' } });
        window.setVisible = visible => surface.surface({ visible, name:'probe', panel:'main', left:50, top:50,
          width:700, height:500, dark:false, locale:'en' });
        setVisible(true);
      </script>
    `);
  });
  servers.push(parent);
  parent.listen(0, '127.0.0.1'); await once(parent, 'listening');
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const executablePath = process.env.PERO_CHROMIUM_EXECUTABLE || (process.platform === 'darwin' && existsSync(chrome) ? chrome : undefined);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${parent.address().port}`);
  const frame = page.frameLocator('iframe[title="probe"]');
  await frame.getByRole('button', { name: 'Increment' }).waitFor();
  const call = request => page.evaluate(request => window.peroAppUse({ scope: { app: 'probe', panel: 'main' }, request }), request);

  const inventory = await call({ action: 'inventory' });
  assert.equal(inventory.ok, true);
  const initial = inventory.value.surfaces[0];
  assert.equal(initial.visible, true); assert.equal(initial.operable, true);
  checks.push('cross-origin managed frame inventory');
  await page.evaluate(url => surface.event({ kind: 'apps_opened', data: { name: 'other', panel: 'main', url } }), `${childOrigin}/?other`);
  await expect.poll(() => page.frameLocator('iframe[title="other"]').locator('body').getAttribute('data-ready')).toBe('true');
  const all = await page.evaluate(() => window.peroAppUse({ request: { action: 'inventory' } }));
  assert.deepEqual(all.value.surfaces.map(item => item.surfaceId).sort(), ['other:main', 'probe:main']);
  assert.equal((await call({ action: 'inventory' })).value.surfaces.length, 1);
  assert.equal((await page.evaluate(() => window.peroAppUse({ request: { action: 'observe' } }))).error.code, 'APP_SURFACE_REQUIRED');
  checks.push('ordinary Chat inventory lists mounted Apps and requires an explicit surface');

  let observed = await call({ action: 'observe', instance: initial.instance });
  assert.equal(observed.ok, true); assert.equal(observed.value.objects[0].state.count, 0);
  assert.equal((await call({ action: 'invoke', instance: initial.instance, target: 'probe', name: 'set', params: { value: 7 }, revision: observed.value.objects[0].revision })).ok, true);
  assert.equal((await call({ action: 'verify', instance: initial.instance, target: 'probe', key: 'count', equals: 7 })).value.verdict, 'pass');
  checks.push('strict CSP without unsafe-eval permits declared parameter schemas');
  checks.push('semantic invoke changes App state and verify reads the result');

  const geometry = await call({ action: 'geometry', instance: initial.instance, target: 'probe' });
  assert.equal(geometry.ok, true); assert.ok(geometry.value.rect.x >= 50); assert.ok(geometry.value.rect.y >= 50);
  checks.push('App geometry translated into parent coordinates');
  for (const rect of [
    { x: -50, y: 0, width: 2000, height: 2000 },
    { x: 0, y: 0, width: NaN, height: 10 },
    { x: 0, y: 0, width: 10, height: 0 },
  ]) {
    await frame.locator('body').evaluate((_body, rect) => { window.geometryOverride = rect; }, rect);
    const invalid = await call({ action: 'geometry', instance: initial.instance, target: 'probe' });
    assert.equal(invalid.error.code, 'APP_GEOMETRY_INVALID', JSON.stringify({ rect, errors }));
  }
  await frame.locator('body').evaluate(() => { window.geometryOverride = { x: 0, y: 0, width: 2000, height: 2000 }; });
  assert.deepEqual((await call({ action: 'geometry', instance: initial.instance, target: 'probe' })).value.rect, initial.rect);
  await frame.locator('body').evaluate(() => { window.geometryOverride = { x: 900, y: 0, width: 20, height: 20 }; });
  assert.equal((await call({ action: 'geometry', instance: initial.instance, target: 'probe' })).error.code, 'APP_OBJECT_NOT_RENDERED');
  await frame.locator('body').evaluate(() => { delete window.geometryOverride; });
  checks.push('untrusted capture geometry cannot expand beyond the managed App frame');
  observed = await call({ action: 'observe', instance: initial.instance });
  const increment = observed.value.dom.find(item => item.label === 'Increment');
  assert.ok(increment);
  assert.equal((await call({ action: 'dom.click', instance: initial.instance, target: increment.ref, expectedRevisions: observed.value.revisions })).ok, true);
  assert.equal((await call({ action: 'verify', instance: initial.instance, target: 'probe', key: 'count', equals: 8 })).value.verdict, 'pass');
  checks.push('fresh DOM snapshot controls an existing App button');

  await frame.getByRole('button', { name: 'Increment' }).click();
  await expect.poll(async () => (await call({ action: 'status' })).value.operable).toBe(false);
  observed = await call({ action: 'observe', instance: initial.instance });
  assert.equal((await call({ action: 'invoke', instance: initial.instance, target: 'probe', name: 'set', params: { value: 5 }, revision: observed.value.objects[0].revision })).error.code, 'APP_USER_ACTIVE');
  assert.equal(observed.value.objects[0].state.count, 9);
  checks.push('trusted human input pauses Agent operation');
  await page.evaluate(() => setVisible(false));
  assert.equal((await call({ action: 'observe', instance: initial.instance })).ok, true);
  assert.equal((await page.evaluate(instance => window.peroAppUse({ request: { action: 'observe', surfaceId: 'probe:main', instance } }), initial.instance)).ok, true);
  assert.equal((await page.evaluate(() => window.peroAppUse({ scope: { app: 'other', panel: 'main' }, request: { action: 'observe', surfaceId: 'probe:main' } }))).error.code, 'APP_SURFACE_UNAVAILABLE');
  assert.equal((await call({ action: 'dom.click', instance: initial.instance, target: increment.ref, expectedRevisions: observed.value.revisions })).error.code, 'APP_SURFACE_HIDDEN');
  checks.push('retained hidden App remains readable and refuses operation');

  await page.evaluate(() => {
    setVisible(true);
    surface.event({ kind: 'app_use_presence', thread_id: 'thread-a', data: { scope: { app: 'probe', panel: 'main' }, title: 'Probe Agent', standing: [], tasks: [{ id: 't', actions: ['semantic.invoke'], expiresAt: Date.now() + 60000 }] } });
    surface.event({ kind: 'app_use_presence', thread_id: 'thread-a', data: { scope: { app: 'other', panel: 'main' }, title: 'Probe Agent', standing: ['observe'], tasks: [] } });
  });
  await page.getByRole('button', { name: 'Revoke Probe Agent App Use' }).click();
  assert.deepEqual(await page.evaluate(() => window.revoked), ['thread-a']);
  checks.push('visible operating state exposes the matching conversation revoke action');
  await page.evaluate(() => surface.event({ kind: 'app_use_presence', thread_id: 'thread-a', data: { scope: { app: 'probe', panel: 'main' }, title: 'Probe Agent', standing: [], tasks: [{ id: 't', actions: ['observe'], expiresAt: Date.now() + 150 }] } }));
  await expect(page.getByRole('button', { name: 'Revoke Probe Agent App Use' })).toBeHidden();
  checks.push('presence clears at its Host-provided deadline without another event');

  await expect.poll(async () => (await call({ action: 'status' })).value.operable).toBe(true);
  observed = await call({ action: 'observe', instance: initial.instance });
  const pendingReload = call({ action: 'invoke', instance: initial.instance, target: 'probe', name: 'hold', revision: observed.value.objects[0].revision });
  await expect.poll(() => frame.locator('body').getAttribute('data-holding')).toBe('true');
  await page.evaluate(() => { document.querySelector('iframe[title="probe"]').src += '?reload'; });
  assert.equal((await pendingReload).error.code, 'APP_SURFACE_REPLACED');
  await expect.poll(async () => (await call({ action: 'inventory' })).value.surfaces[0].instance).not.toBe(initial.instance);
  assert.equal((await call({ action: 'observe', instance: initial.instance })).error.code, 'APP_SURFACE_REPLACED');
  checks.push('reload replaces instance and invalidates a pending invocation');

  const current = (await call({ action: 'inventory' })).value.surfaces[0];
  await frame.getByRole('button', { name: 'Increment' }).waitFor();
  observed = await call({ action: 'observe', instance: current.instance });
  const pendingRemoval = call({ action: 'invoke', instance: current.instance, target: 'probe', name: 'hold', revision: observed.value.objects[0].revision });
  await expect.poll(() => frame.locator('body').getAttribute('data-holding')).toBe('true');
  await page.evaluate(() => surface.event({ kind: 'apps_catalog', data: [] }));
  assert.equal((await pendingRemoval).error.code, 'APP_SURFACE_REPLACED');
  assert.equal((await call({ action: 'observe' })).error.code, 'APP_SURFACE_UNAVAILABLE');
  checks.push('disabling an App disposes its frame and pending invocation');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser?.close();
  for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await rm(temporary, { recursive: true, force: true });
}

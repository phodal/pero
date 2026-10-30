// Real Electron/GPUI controls → Desktop IPC → Host → ACP fixture. No MCP client.
import { expect } from '@playwright/test';
import { electron, focusPage } from './electron.mjs';
import { openSettings } from './sidebar-controls.mjs';
import { mcpSettingsFixture } from '../fixtures/mcp-settings.mjs';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const fixture = await mcpSettingsFixture(root);
const out = resolve(root, 'test-results/mcp-settings');
await mkdir(out, { recursive: true });
let app, page;
const errors = [];
const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
const mcp = async () => (await state()).settings.mcp;
const frame = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
async function capture(name) { await frame(); await page.screenshot({ path: resolve(out, `${name}.png`) }); }
async function click(name) {
  await expect.poll(async () => (await mcp()).controls[name]?.width || 0).toBeGreaterThan(0);
  await frame();
  const b = (await mcp()).controls[name];
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}
async function input(index, text) {
  await frame(); const b = (await mcp()).inputs[index];
  await page.mouse.click(b.x + Math.min(20, b.width / 2), b.y + b.height / 2);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.insertText(text);
  await expect.poll(async () => (await mcp()).inputs[index].value).toBe(text);
}
async function settled() {
  await expect.poll(async () => (await mcp()).pending).toBe(false);
  expect((await mcp()).error).toBeNull();
}
async function open() {
  await openSettings(page); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
  await expect.poll(async () => (await state()).settingsOpen).toBe(true);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
  await frame(); await page.keyboard.type('MCP');
  await expect.poll(async () => (await state()).settings.matches).toEqual(['mcp.title']);
  await settled();
  await click('mcp-agent'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
  await expect.poll(async () => (await mcp()).agent).toBe('fixture'); await settled();
}
async function launch() {
  app = await electron.launch({ args: [resolve(root, 'desktop')], cwd: root, env: fixture.env });
  page = await app.firstWindow(); await focusPage(page);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).connected, undefined, { timeout: 60000 });
  await page.evaluate(() => { window.mcpAcceptanceEvents = []; window.pero.onEvent(event => window.mcpAcceptanceEvents.push(event)); });
}
async function session(id) {
  await page.evaluate(thread_id => window.pero.sessionCommand({ action: 'new_session', thread_id, agent_id: 'fixture' }), id);
  await expect.poll(() => page.evaluate(id => window.mcpAcceptanceEvents.some(event => event.kind === 'session_ready' && event.thread_id === id), id), { timeout: 15000 }).toBe(true);
  return (await fixture.sessions()).at(-1).mcpServers.filter(server => !['operator-only', 'pero-app-use'].includes(server.name));
}
try {
  await launch(); await open();
  expect((await mcp()).config.servers).toEqual([]); await capture('empty');
  await click('mcp-add'); await expect.poll(async () => (await mcp()).editing).toBe(true);
  await click('mcp-http'); await input(0, 'Local docs'); await input(1, fixture.url);
  await click('mcp-save'); await settled();
  expect((await mcp()).config.servers[0].enabled).toBe(false);
  expect(await session('ui-disabled')).toEqual([]); await capture('configured-disabled');
  await click('mcp-toggle-0');
  await expect.poll(async () => (await mcp()).confirm).toEqual([0, true]);
  expect((await mcp()).config.servers[0].enabled).toBe(false); await capture('server-wide-grant');
  await click('mcp-confirm'); await settled();
  expect((await mcp()).config.servers[0].enabled).toBe(true);
  expect((await session('ui-enabled')).map(server => server.name)).toEqual(['Local docs']);
  await capture('enabled-not-observed');
  await click('mcp-edit-0'); await input(0, 'Renamed docs'); await click('mcp-save'); await settled();
  expect((await mcp()).config.servers[0]).toMatchObject({ name: 'Renamed docs', enabled: false });
  expect((await fixture.sessions()).length).toBe(2);
  expect(await session('ui-edited-disabled')).toEqual([]);
  // A persistence error must not falsely report a successful grant or lose the list.
  const saved = await readFile(fixture.settings, 'utf8');
  await rm(fixture.settings); await mkdir(fixture.settings);
  await click('mcp-toggle-0'); await click('mcp-confirm');
  await expect.poll(async () => (await mcp()).error).toBe('mcp.error.read_write');
  expect((await mcp()).config.servers[0].enabled).toBe(false); await capture('save-error');
  await rm(fixture.settings, { recursive: true }); await writeFile(fixture.settings, saved, { mode: 0o600 });
  await click('mcp-confirm'); await settled();
  expect((await mcp()).config.servers[0].enabled).toBe(true);
  await page.evaluate(() => { const preferences = JSON.parse(window.peroDiagnostics.snapshot()).preferences;
    return window.pero.sessionCommand({ method: 'settings.workbench', preferences: { ...preferences, appearance: 'dark' } }); });
  await expect.poll(async () => (await state()).preferences.appearance).toBe('dark'); await capture('dark');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 760));
  await capture('narrow');
  await page.evaluate(() => window.pero.setLocale('zh-CN')); await expect.poll(async () => (await state()).locale).toBe('zh-CN');
  await capture('zh-CN-narrow');
  const publicText = JSON.stringify(await state()) + JSON.stringify(await page.evaluate(() => window.mcpAcceptanceEvents));
  expect(publicText.includes(fixture.secret)).toBe(false);
  expect(publicText.includes('operator-only')).toBe(false);
  await app.close(); app = undefined;
  await launch(); await open();
  expect((await mcp()).config.servers[0]).toMatchObject({ name: 'Renamed docs', enabled: true });
  // A second writer removes the selected row while this editor holds a stale revision.
  await click('mcp-edit-0');
  await page.evaluate(revision => window.pero.sessionCommand({ method: 'settings.mcp.set',
    request_id: 'external-mcp-edit', agent_id: 'fixture', revision, servers: [] }), (await mcp()).config.revision);
  await expect.poll(() => page.evaluate(() => window.mcpAcceptanceEvents.some(event => event.kind === 'mcp_settings' && event.request_id === 'external-mcp-edit'))).toBe(true);
  await click('mcp-save'); await expect.poll(async () => (await mcp()).error).toBe('mcp.error.conflict');
  await click('mcp-cancel-edit'); await click('mcp-refresh'); await settled();
  expect((await mcp()).editing).toBe(false); expect((await mcp()).config.servers).toEqual([]);
  // Import is another draft, never an implicit grant even when enabled is supplied.
  await click('mcp-import'); await input(3, JSON.stringify([{ name: 'Imported docs', enabled: true,
    transport: { type: 'http', url: fixture.url } }]));
  await click('mcp-import-save'); await settled();
  expect((await mcp()).config.servers[0]).toMatchObject({ name: 'Imported docs', enabled: false });
  await click('mcp-remove-0'); await expect.poll(async () => (await mcp()).confirm).toEqual([0, false]);
  expect((await mcp()).config.servers).toHaveLength(1);
  await click('mcp-confirm'); await settled(); expect((await mcp()).config.servers).toEqual([]);
  expect(await session('ui-removed')).toEqual([]);
  expect(fixture.requests()).toBe(0); expect(errors).toEqual([]);
  await capture('removed');
  await writeFile(resolve(out, 'ui-result.json'), JSON.stringify({ passed: true, checks: [
    'actual GPUI add disabled', 'explicit server-wide enable confirmation', 'real ACP injection',
    'edit revokes grant for new sessions', 'write failure and retry', 'dark/narrow/Chinese',
    'restart persistence', 'stale-write conflict and refresh recovery', 'import is disabled', 'confirmed removal', 'no operator credential disclosure',
    'configured state does not imply connected or discovered tools',
  ], errors }, null, 2));
  console.log('MCP settings Electron/GPUI acceptance passed. No MCP connectivity or model calls.');
} catch (error) {
  if (page) await capture('ui-failure');
  throw error;
} finally { await app?.close(); await fixture.close(); }

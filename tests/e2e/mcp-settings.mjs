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
// A previous pass must not survive a new failed run.
await rm(resolve(out, 'ui-result.json'), { force: true });
let fixtureClosed = false;
let app, page, lastSnapshot, runtimeLog = '', transportFaultInstalled = false;
const errors = [];
const progress = label => console.log(`MCP UI: ${label}`);
async function bounded(promise, label, timeout = 15000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`MCP UI did not respond: ${label}`)), timeout);
  })]); } finally { clearTimeout(timer); }
}
const evaluate = (fn, value) => bounded(page.evaluate(fn, value), 'renderer evaluation');
const state = async () => (lastSnapshot = await evaluate(() => JSON.parse(window.peroDiagnostics.snapshot())));
async function close() {
  if (!app) return;
  try { if (transportFaultInstalled) await restoreTransport(); }
  finally {
    const closing = app; app = undefined;
    try { await bounded(closing.close(), 'Electron shutdown'); }
    catch (error) { console.error('MCP UI shutdown failed; killing only test-owned Electron:', String(error)); closing.process().kill('SIGKILL'); throw error; }
  }
}
const mcp = async () => (await state()).settings.mcp;
const frame = () => evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
async function capture(name) { progress(`capture ${name}`); await frame(); await bounded(page.screenshot({ path: resolve(out, `${name}.png`), timeout: 10000 }), `capture ${name}`); }
async function click(name) {
  progress(`click ${name}`);
  await expect.poll(async () => (await mcp()).controls[name]?.width || 0).toBeGreaterThan(0);
  await frame();
  const b = (await mcp()).controls[name];
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}
async function input(index, text) {
  progress(`fill field ${index}`);
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
async function open(direct = false) {
  progress(direct ? 'open MCP category without search' : 'open settings');
  await bounded(openSettings(page), 'settings menu');
  // All settings is the last footer action; categories live in its navigation tree.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state()).settingsOpen).toBe(true);
  if (direct) {
    await frame();
    const { query, matches } = (await state()).settings;
    expect(query).toBe(''); expect(matches).toContain('mcp.title');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+e' : 'Control+Shift+e');
    // Follow the visible tree, including its appearance group, rather than a stale row offset.
    for (let remaining = matches.length + 1; remaining > 0 && (await state()).settings.section !== 'mcp.title'; remaining--) {
      await page.keyboard.press('ArrowDown'); await frame();
    }
    await expect.poll(async () => (await state()).settings.section).toBe('mcp.title');
    expect((await state()).settings.query).toBe('');
  } else {
    await capture('settings-before-search');
    progress('focus Settings search');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
    await frame();
    for (const character of 'MCP') {
      progress(`type Settings search character ${character}`);
      await page.keyboard.type(character); await frame(); await state();
    }
    await expect.poll(async () => (await state()).settings.matches).toEqual(['mcp.title']);
  }
  await settled();
  if ((await mcp()).agent !== 'fixture') {
    // Session history promotes the preferred Agent on restart; use the live order.
    const index = (await state()).agents.findIndex(agent => agent.id === 'fixture');
    expect(index).toBeGreaterThanOrEqual(0);
    await click('mcp-agent'); await frame();
    // Leave any hovered row before keyboard navigation starts from no selection.
    await page.mouse.move(0, 0); await frame();
    for (let i = 0; i <= index; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
  }
  await expect.poll(async () => (await mcp()).agent).toBe('fixture'); await settled();
}
async function launch() {
  progress('launch Electron');
  app = await electron.launch({ args: [resolve(root, 'desktop'), ...(process.env.PERO_MCP_TEST_HEADLESS === '1' ? ['--headless'] : [])], cwd: root, env: fixture.env });
  app.process().stderr.on('data', chunk => { runtimeLog = (runtimeLog + String(chunk).replaceAll(fixture.secret, '[redacted]')).slice(-32768); });
  await bounded(app.evaluate(({ BrowserWindow }) => {
    globalThis.mcpRendererExits = [];
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.on('render-process-gone', (_event, details) => {
        globalThis.mcpRendererExits.push({ reason: details.reason, exitCode: details.exitCode });
      });
    }
  }), 'renderer crash observer');
  page = await bounded(app.firstWindow(), 'first window'); await bounded(focusPage(page), 'page focus');
  page.on('pageerror', error => {
    const detail = (error.stack || `${error.name}: ${error.message}`).replaceAll(fixture.secret, '[redacted]');
    errors.push(detail); console.error('MCP renderer error:', detail);
  });
  await page.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).connected, undefined, { timeout: 60000 });
  await evaluate(() => { window.mcpAcceptanceEvents = []; window.pero.onEvent(event => window.mcpAcceptanceEvents.push(event)); });
}
// Fault only the existing Desktop IPC seam, then restore the exact real handler.
async function interruptTransport() {
  await bounded(app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('pero:session');
    if (typeof original !== 'function') throw new Error('Electron session IPC handler unavailable');
    globalThis.mcpTransportFault = { original, commands: [], reject: null };
    ipcMain.removeHandler('pero:session');
    ipcMain.handle('pero:session', (event, command) => {
      if (!command.method?.startsWith('settings.mcp.')) return original(event, command);
      globalThis.mcpTransportFault.commands.push(command);
      return new Promise((_resolve, reject) => { globalThis.mcpTransportFault.reject = reject; });
    });
  }), 'install IPC fault');
  transportFaultInstalled = true;
}
async function restoreTransport() {
  await bounded(app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('pero:session');
    ipcMain.handle('pero:session', globalThis.mcpTransportFault.original);
  }), 'restore real IPC');
  transportFaultInstalled = false;
}
const faultCount = () => bounded(app.evaluate(() => globalThis.mcpTransportFault.commands.length), 'IPC command count');
async function rejectTransport() {
  await bounded(app.evaluate(() => globalThis.mcpTransportFault.reject(new Error('Synthetic MCP IPC rejection'))), 'reject IPC');
}
async function session(id) {
  progress(`create session ${id}`);
  await evaluate(thread_id => window.pero.sessionCommand({ action: 'new_session', thread_id, agent_id: 'fixture' }), id);
  await expect.poll(() => evaluate(id => window.mcpAcceptanceEvents.some(event => event.kind === 'session_ready' && event.thread_id === id), id), { timeout: 15000 }).toBe(true);
  return (await fixture.sessions()).at(-1).mcpServers.filter(server => !['operator-only', 'pero-app-use'].includes(server.name));
}
try {
  await bounded((async () => {
  await launch(); await open();
  expect((await mcp()).config.servers).toEqual([]); await capture('empty');
  await click('mcp-add'); await expect.poll(async () => (await mcp()).editing).toBe(true);
  await click('mcp-http'); await input(0, 'Local docs'); await input(1, fixture.url);
  await interruptTransport();
  await click('mcp-save');
  await expect.poll(async () => (await mcp()).pending).toBe(true);
  const pendingRequest = (await mcp()).request_id;
  expect(pendingRequest).toBeTruthy();
  await bounded(app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('pero:event', {
    version: 1, kind: 'error', request_id: 'unrelated-failure', text: 'Synthetic unrelated error',
  })), 'unrelated Host error');
  await frame();
  expect((await mcp()).request_id).toBe(pendingRequest);
  expect((await mcp()).pending).toBe(true); expect((await mcp()).saving).toBe(true);
  await rejectTransport();
  await expect.poll(async () => (await mcp()).error).toBe('mcp.error.interrupted_save');
  expect((await mcp()).pending).toBe(false); expect((await mcp()).saving).toBe(false);
  expect((await mcp()).needs_reload).toBe(true); expect((await mcp()).editing).toBe(true);
  expect((await mcp()).inputs.slice(0, 2).map(input => input.value)).toEqual(['Local docs', fixture.url]);
  await capture('interrupted-save');
  await click('mcp-save'); await frame(); expect(await faultCount()).toBe(1);
  await restoreTransport();
  await click('mcp-cancel-edit'); await click('mcp-refresh'); await settled();
  expect((await mcp()).needs_reload).toBe(false); expect((await mcp()).config.servers).toEqual([]);
  await click('mcp-add'); await click('mcp-http'); await input(0, 'Local docs'); await input(1, fixture.url);
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
  await evaluate(() => { const preferences = JSON.parse(window.peroDiagnostics.snapshot()).preferences;
    return window.pero.sessionCommand({ method: 'settings.workbench', preferences: { ...preferences, appearance: 'dark' } }); });
  await expect.poll(async () => (await state()).preferences.appearance).toBe('dark'); await capture('dark');
  await bounded(app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 760)), 'resize Electron');
  await capture('narrow');
  await evaluate(() => window.pero.setLocale('zh-CN')); await expect.poll(async () => (await state()).locale).toBe('zh-CN');
  await capture('zh-CN-narrow');
  const publicText = JSON.stringify(await state()) + JSON.stringify(await evaluate(() => window.mcpAcceptanceEvents));
  expect(publicText.includes(fixture.secret)).toBe(false);
  expect(publicText.includes('operator-only')).toBe(false);
  progress('restart Electron'); await close();
  await launch(); await open(true);
  expect((await mcp()).config.servers[0]).toMatchObject({ name: 'Renamed docs', enabled: true });
  // A second writer removes the selected row while this editor holds a stale revision.
  await click('mcp-edit-0');
  await evaluate(revision => window.pero.sessionCommand({ method: 'settings.mcp.set',
    request_id: 'external-mcp-edit', agent_id: 'fixture', revision, servers: [] }), (await mcp()).config.revision);
  await expect.poll(() => evaluate(() => window.mcpAcceptanceEvents.some(event => event.kind === 'mcp_settings' && event.request_id === 'external-mcp-edit'))).toBe(true);
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
  await interruptTransport(); await click('mcp-refresh');
  await expect.poll(async () => (await mcp()).pending).toBe(true);
  await rejectTransport();
  await expect.poll(async () => (await mcp()).error).toBe('mcp.error.interrupted');
  expect((await mcp()).saving).toBe(false); expect((await mcp()).pending).toBe(false);
  await restoreTransport(); await click('mcp-refresh'); await settled();
  await click('mcp-add'); await input(0, 'Disconnect draft');
  await input(1, process.execPath);
  await interruptTransport(); await click('mcp-save');
  await expect.poll(async () => (await mcp()).pending).toBe(true);
  await bounded(app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('pero:event', {
    version: 1, kind: 'disconnected', request_id: null, text: '',
  })), 'Host disconnect');
  await expect.poll(async () => (await mcp()).pending).toBe(false);
  expect((await mcp()).saving).toBe(false); expect((await mcp()).needs_reload).toBe(true);
  expect((await mcp()).editing).toBe(true); expect((await mcp()).inputs[0].value).toBe('Disconnect draft');
  await capture('disconnected-draft');
  await click('mcp-save'); await frame(); expect(await faultCount()).toBe(1);
  await close(); await launch(); await open(true);
  expect((await mcp()).config.servers).toEqual([]); expect(errors).toEqual([]);

  })(), 'complete acceptance suite', 600000);
  progress('final cleanup');
  await close();
  await bounded(fixture.close(), 'fixture cleanup'); fixtureClosed = true;
  // Opt-in fault proves a cleanup error cannot leave a successful receipt.
  if (process.env.PERO_MCP_TEST_FAIL_CLEANUP === '1') throw new Error('Synthetic MCP cleanup failure');
  await writeFile(resolve(out, 'ui-result.json'), JSON.stringify({ passed: true, headless: process.env.PERO_MCP_TEST_HEADLESS === '1', checks: [
    'actual GPUI add disabled', 'explicit server-wide enable confirmation', 'real ACP injection',
    'edit revokes grant for new sessions', 'write failure and retry', 'dark/narrow/Chinese',
    'restart persistence and visible MCP category navigation without search', 'stale-write conflict and refresh recovery', 'import is disabled', 'confirmed removal', 'no operator credential disclosure',
    'configured state does not imply connected or discovered tools',
    'correlated IPC rejection settles busy and preserves draft', 'unrelated error does not settle pending save',
    'unknown save requires real Host reload before retry without replay', 'read rejection reload recovery',
    'disconnect preserves draft and clears busy without replay', 'cleanup completes before success receipt',
  ], errors }, null, 2));
  console.log('MCP settings Electron/GPUI acceptance passed. No MCP connectivity or model calls.');
} catch (error) {
  console.error('MCP UI acceptance failed:', String(error).replaceAll(fixture.secret, '[redacted]'));
  // Preserve public state and bounded native diagnostics even after a renderer crash.
  let rendererExits;
  if (app) {
    try { rendererExits = await bounded(app.evaluate(() => globalThis.mcpRendererExits), 'renderer crash details'); }
    catch (diagnosticError) { console.error(String(diagnosticError)); }
  }
  console.error('MCP renderer exits:', JSON.stringify(rendererExits));
  await writeFile(resolve(out, 'ui-failure.json'), JSON.stringify({ error: String(error), lastSnapshot, errors, rendererExits, runtimeLog }, null, 2).replaceAll(fixture.secret, '[redacted]'));
  if (page) {
    try { await bounded(page.screenshot({ path: resolve(out, 'ui-failure.png'), timeout: 10000 }), 'failure screenshot'); }
    catch (captureError) { console.error(String(captureError)); }
  }
  throw error;
} finally { try { await close(); } finally { if (!fixtureClosed) await bounded(fixture.close(), 'fixture cleanup'); } }

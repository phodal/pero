import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { setAppearance } from './sidebar-controls.mjs';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
const root = resolve(import.meta.dirname, '../..');
const real = process.env.PERO_STREAM_REAL_AGENT === '1';
const output = resolve(root, 'test-results/streaming-presentation', real ? 'qoder' : 'fixture');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-stream-ui-'));
const workspace = resolve(temp, 'workspace');
const phase = resolve(temp, 'phase');
const marker = `READ_PROOF_${randomUUID()}`;
await mkdir(output, { recursive: true }); await mkdir(workspace);
await writeFile(resolve(workspace, 'notes.txt'), marker);
await writeFile(phase, '0');
const agentId = real ? 'qoder' : 'presentation';
const agents = resolve(temp, 'agents.json');
await writeFile(agents, JSON.stringify(real ? [{ id: 'qoder', name: 'Qoder', command: resolve(process.env.HOME, '.local/bin/qodercli'), args: ['--acp', '--tools', 'Read'] }] : [
  ...['codex', 'claude', 'grok', 'copilot', 'qoder', 'opencode'].map(id => ({ id, name: id, command: '/no-such-agent' })),
  { id: agentId, name: 'Presentation', command: process.execPath, args: [resolve(root, 'tests/fixtures/streaming-presentation.mjs'), phase] },
]));
const settings = resolve(temp, 'settings.json'), history = resolve(temp, 'history.jsonl');
await writeFile(settings, JSON.stringify({ chat_agent: agentId }));
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(temp, 'profile'), PERO_SETTINGS_PATH: settings,
  PERO_HISTORY_PATH: history, PERO_AGENTS_FILE: agents, PERO_LOCALE: 'en' };
delete env.ELECTRON_RUN_AS_NODE;
let app, page;
const errors = [];
async function launch() {
  app = await electron.launch({ args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), resolve(root, 'desktop')], cwd: root, env });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).connected, undefined, { timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById('loading'));
}
const state = () => page.evaluate(() => window.peroDiagnostics ? JSON.parse(window.peroDiagnostics.snapshot()) : { chats: [] });
const chat = async () => { const s = await state(); return s.chats[s.activeChat]; };
const frame = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
const shot = async name => { await frame(); await page.screenshot({ path: resolve(output, `${name}.png`) }); };
async function clickBounds(kind, predicate = () => true) {
  await expect.poll(async () => (await state())[kind]?.find(item => predicate(item) && item.bounds?.height > 0)?.bounds).not.toBe(undefined);
  const item = (await state())[kind].find(item => predicate(item) && item.bounds?.height > 0);
  await page.mouse.click(item.bounds.x + Math.min(24, item.bounds.width / 2), item.bounds.y + item.bounds.height / 2);
}
try {
  await launch();
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, workspace);
  await page.evaluate(() => window.pero.chooseWorkspace());
  await page.mouse.click(100, 28);
  await expect.poll(async () => (await chat())?.state, { timeout: 60000 }).toBe('idle');
  await page.mouse.click(800, await page.evaluate(() => innerHeight - 70));
  await page.keyboard.type(real ? 'Use the Read tool to read notes.txt in this workspace. Reply with exactly its full contents. Do not write files, execute commands, or use network tools.' : 'hi');
  await page.keyboard.press('Enter');
  if (real) {
    await expect.poll(async () => {
      const c = await chat();
      if (c.permission) {
        const options = c.permission.options;
        const index = options.findIndex(option => option.kind === 'allow_once');
        expect(index).toBeGreaterThanOrEqual(0);
        const title = JSON.stringify(c.permission.toolCall).toLowerCase();
        expect(title.includes('read') || title.includes('notes.txt')).toBe(true);
        await clickBounds('permissionBounds', item => item.index === index);
      }
      return c.state;
    }, { timeout: 120000, intervals: [200, 500] }).toBe('idle');
    const c = await chat();
    expect(c.messages.filter(message => message.role === 'assistant').map(message => message.text).join('')).toContain(marker);
    expect(c.tools.some(tool => tool.content.includes(marker))).toBe(true);
    expect(c.tools.some(tool => tool.transcript.input !== null)).toBe(true);
    await shot('real-reply');
    await clickBounds('toolBounds');
    await clickBounds('inputBounds');
    await expect.poll(async () => (await chat()).tools[0].input_open).toBe(true);
    await clickBounds('inputBounds');
    await shot('real-tool-result');
    for (const reader of (await state()).contentReaders) {
      if (reader.bytes < 200) expect(reader.bounds.height).toBeLessThan(200);
    }
  } else {
    await expect.poll(async () => (await state()).reasoningBounds.length).toBe(1);
    await expect.poll(async () => (await state()).reasoningBounds[0].open).toBe(true);
    await shot('thinking-streaming');
    await clickBounds('reasoningBounds');
    await writeFile(phase, '1');
    await expect.poll(async () => (await chat()).messages.at(-1).text).toContain('More reasoning');
    expect((await state()).reasoningBounds[0].open).toBe(false);
    await clickBounds('reasoningBounds');
    await writeFile(phase, '2');
    await expect.poll(async () => (await chat()).title).toBe('杭州天气检索');
    await expect.poll(async () => (await chat()).tools.length).toBe(1);
    expect((await chat()).tools[0].content).toBe('');
    expect((await chat()).tools[0].output).toEqual([]);
    expect((await state()).reasoningBounds[0].open).toBe(true);
    await clickBounds('toolBounds', item => item.tool === 'search');
    await clickBounds('inputBounds', item => item.tool === 'search');
    await expect.poll(async () => (await chat()).tools[0].input_open).toBe(true);
    expect((await state()).contentReaders).toEqual([]);
    await shot('parameters-only');
    await writeFile(phase, '3');
    await expect.poll(async () => Boolean((await chat()).permission)).toBe(true);
    expect((await chat()).tools[0].content).not.toContain('must not duplicate');
    await clickBounds('inputBounds', item => item.tool === 'fetch');
    expect((await chat()).tools[1].input_open).toBe(true);
    await shot('fetch-parameters');
    await clickBounds('inputBounds', item => item.tool === 'fetch');
    await shot('search-and-approval');
    await clickBounds('permissionBounds', item => item.index === 0);
    await expect.poll(async () => (await state()).reasoningBounds.length).toBe(2);
    expect((await state()).reasoningBounds[1].open).toBe(true);
    await clickBounds('toolBounds', item => item.tool === 'search');
    await clickBounds('toolBounds', item => item.tool === 'search');
    await expect.poll(async () => (await state()).contentReaders.length).toBe(1);
    await expect.poll(async () => (await state()).contentReaders[0].bounds?.height).toBeLessThan(200);
    await shot('compact-json-result');
    await writeFile(phase, '4');
    await expect.poll(async () => (await chat()).state).toBe('idle');
    expect((await state()).reasoningBounds.map(item => item.open)).toEqual([true, false]);
    expect((await chat()).title).toBe('杭州天气检索');
    await shot('final');
    await setAppearance(page, 'dark'); await shot('dark');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 788));
    await page.waitForFunction(() => innerWidth === 1000); await shot('narrow');
    const id = (await chat()).id;
    await page.reload();
    await expect.poll(async () => (await state()).chats?.find(chat => chat.id === id)?.title, { timeout: 30000 }).toBe('杭州天气检索');
    await app.close(); await launch();
    await expect.poll(async () => (await state()).chats?.find(chat => chat.id === id)?.title).toBe('杭州天气检索');
  }
  expect(errors).toEqual([]);
  const events = (await readFile(history, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ real, state: await state(), errors,
    titleUpdates: events.filter(event => event.data?.sessionUpdate === 'session_info_update'), temp }, null, 2));
  console.log(JSON.stringify({ output, real, errors }));
} catch (error) {
  console.error(await page?.evaluate(() => window.peroDiagnostics?.snapshot()));
  await page?.screenshot({ path: resolve(output, 'failure.png') }); throw error;
} finally { await app?.close(); }

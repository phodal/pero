// Composer behavior against the actual Electron/GPUI renderer and a bounded ACP fixture.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '../..');
const output = resolve(root, 'test-results/composer');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-composer-'));
const workspace = resolve(temp, 'workspace');
const capture = resolve(temp, 'prompts.jsonl');
await mkdir(output, { recursive: true });
await mkdir(resolve(workspace, '.agents/skills/composer-demo'), { recursive: true });
await writeFile(resolve(workspace, 'notes.txt'), 'FROZEN_COMPOSER_CONTEXT_42\n');
await writeFile(resolve(workspace, '.agents/skills/composer-demo/SKILL.md'), '---\nname: composer-demo\ndescription: Composer fixture skill\n---\nCOMPOSER_SKILL_CONTENT_42\n');
await writeFile(resolve(workspace, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l3sAAAAASUVORK5CYII=', 'base64'));
const agents = resolve(temp, 'agents.json');
await writeFile(agents, JSON.stringify([
  { id: 'unsupported-fixture', name: 'ACP text fixture', command: process.execPath, args: [resolve(root, 'tests/fixtures/acp-agent.mjs')] },
  { id: 'fixture', name: 'ACP composer fixture', command: process.execPath, args: [resolve(root, 'tests/fixtures/acp-agent.mjs'), '--composer', `--capture=${capture}`] },
]));
await writeFile(resolve(temp, 'settings.json'), JSON.stringify({ chat_agent: 'fixture' }));
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(temp, 'profile'), PERO_SETTINGS_PATH: resolve(temp, 'settings.json'), PERO_HISTORY_PATH: resolve(temp, 'sessions.jsonl'), PERO_LOCALE: 'en', PERO_AGENTS_FILE: agents };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), resolve(root, 'desktop')], cwd: root, env });
const errors = [];
const modifier = process.env.PERO_COMPOSER_TEST_MODIFIER || (process.platform === 'darwin' ? 'Meta' : 'Control');
try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.peroDiagnostics && JSON.parse(window.peroDiagnostics.snapshot()).connected, undefined, { timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById('loading'));
  const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
  const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const height = () => page.evaluate(() => innerHeight);
  const promptLog = async () => (await readFile(capture, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const input = async text => {
    await page.mouse.click(950, await height() - 55);
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press('Backspace');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.insertText', { text });
    await cdp.detach();
    await expect.poll(async () => (await state()).composer).toBe(text);
  };
  const choose = async label => {
    await expect.poll(async () => {
      const snapshot = await state();
      return !snapshot.completion.loading && snapshot.completion.items.includes(label);
    }).toBe(true);
    const snapshot = await state();
    const index = snapshot.completion.items.indexOf(label);
    const count = snapshot.completion.items.length;
    for (let i = 0; i < (index - snapshot.completion.selected + count) % count; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
  };
  const send = async () => {
    const before = (await state()).chats[0].messages.filter(message => message.role === 'user').length;
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await state()).chats[0].messages.filter(message => message.role === 'user').length).toBe(before + 1);
    await expect.poll(async () => (await state()).chats[0].state, { timeout: 15000 }).toBe('idle');
  };

  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, workspace);
  await page.evaluate(() => window.pero.chooseWorkspace());
  await expect.poll(async () => (await state()).workspace).toBe(await realpath(workspace));
  await page.mouse.click(100, 28);
  await expect.poll(async () => (await state()).navigation).toBe(0);
  await frame();
  await expect.poll(async () => (await state()).chats.length).toBe(1);
  await frame();
  await expect.poll(async () => (await state()).chats[0].agent).toBe('fixture');
  await expect.poll(async () => (await state()).chats[0].state).toBe('idle');
  await input('composer fixture ready');
  await send();
  await expect.poll(async () => (await state()).chats[0].commands?.map(command => command.name)).toContain('compact');
  expect((await state()).chats[0].capabilities.images).toBe(true);
  expect((await state()).chats[0].settings.options.map(option => option.id)).toEqual(['mode', 'effort', 'approval']);
  await page.screenshot({ path: resolve(output, 'controls.png') });
  const setting = async (id, x, expected, screenshot, previous = 1) => {
    await expect.poll(async () => (await state()).chats[0].pending_setting).toBe(null);
    await frame();
    await page.mouse.click(x, await height() - 20);
    await frame();
    if (id === 'mode') { await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight'); }
    if (id === 'approval') { await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowRight'); }
    await frame();
    await page.screenshot({ path: resolve(output, screenshot) });
    for (let i = 0; i < previous; i++) await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await state()).chats[0].settings.options.find(option => option.id === id)?.current).toBe(expected);
    await expect.poll(async () => (await state()).chats[0].pending_setting).toBe(null);
  };
  await setting('effort', 1360, 'high', 'effort-menu.png');
  await setting('effort', 1360, 'none', 'thinking-off-menu.png', 4);
  await frame();
  await page.screenshot({ path: resolve(output, 'thinking-off.png'), clip: { x: 260, y: await height() - 130, width: await page.evaluate(() => innerWidth - 260), height: 130 } });
  await setting('effort', 1360, 'high', 'effort-menu.png');
  await setting('approval', 322, 'read', 'permission-profile-menu.png');
  await setting('mode', 322, 'minimal', 'mode-menu.png');
  await frame();
  await page.screenshot({ path: resolve(output, 'toolbar.png'), clip: { x: 260, y: await height() - 130, width: await page.evaluate(() => innerWidth - 260), height: 130 } });

  await page.mouse.click(290, await height() - 20);
  await frame();
  await page.screenshot({ path: resolve(output, 'context-types.png') });
  await page.keyboard.press('Escape');

  await input('@file notes');
  await choose('notes.txt');
  await expect.poll(async () => (await state()).attachments).toEqual(['notes.txt']);
  const draft = (await state()).composer;
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.press('Backspace');
  await expect.poll(async () => (await state()).attachments).toEqual([]);
  await page.keyboard.press(`${modifier}+z`);
  await expect.poll(async () => (await state()).attachments).toEqual(['notes.txt']);
  expect((await state()).composer).toBe(draft);
  await page.screenshot({ path: resolve(output, 'reference-undo.png') });
  // Freeze proof: changing the file after selection must not alter the sent resource.
  await writeFile(resolve(workspace, 'notes.txt'), 'CHANGED_AFTER_SELECTION\n');
  await page.keyboard.press('End');
  await page.keyboard.type(' inspect the selected context');
  await send();
  const filePrompt = (await promptLog()).at(-1);
  expect(filePrompt.some(block => block.type === 'resource' && block.resource.text.includes('FROZEN_COMPOSER_CONTEXT_42'))).toBe(true);
  expect(JSON.stringify(filePrompt)).not.toContain('CHANGED_AFTER_SELECTION');

  await input('/com');
  await choose('compact');
  await expect.poll(async () => (await state()).composer).toBe('/compact ');
  expect((await state()).chats[0].state).toBe('idle');
  await send();
  expect((await promptLog()).at(-1)[0].text).toBe('/compact');

  await input('/composer-demo');
  await choose('composer-demo');
  await expect.poll(async () => (await state()).attachments).toEqual(['composer-demo']);
  await page.screenshot({ path: resolve(output, 'skill-reference.png') });
  await send();
  expect(JSON.stringify((await promptLog()).at(-1))).toContain('COMPOSER_SKILL_CONTENT_42');

  await input('@image pixel');
  await choose('pixel.png');
  await expect.poll(async () => (await state()).attachments).toEqual(['pixel.png']);
  await send();
  expect((await promptLog()).at(-1).some(block => block.type === 'image' && block.mimeType === 'image/png')).toBe(true);

  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, resolve(workspace, 'notes.txt'));
  await page.mouse.click(290, await height() - 20);
  // Footer order is files, image, directory. Up begins at the final enabled item.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state()).attachments).toEqual(['notes.txt']);
  await input('');
  await expect.poll(async () => (await state()).attachments).toEqual([]);

  await input('clipboard image');
  await expect.poll(async () => (await state()).composerFocused).toBe(true);
  await page.evaluate(() => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l3sAAAAASUVORK5CYII='), char => char.charCodeAt(0));
    const clipboard = new DataTransfer();
    clipboard.items.add(new File([bytes], 'clipboard.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
  });
  await expect.poll(async () => (await state()).attachments.length).toBe(1);
  await send();
  expect((await promptLog()).at(-1).some(block => block.type === 'image' && block.mimeType === 'image/png')).toBe(true);

  await input('permission');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state()).chats[0].permission !== null).toBe(true);
  await page.screenshot({ path: resolve(output, 'permission.png') });
  const permission = (await state()).permissionBounds.find(item => item.index === 0).bounds;
  await page.mouse.click(permission.x + permission.width / 2, permission.y + permission.height / 2);
  await expect.poll(async () => (await state()).chats[0].state).toBe('idle');

  await input('@');
  await expect.poll(async () => (await state()).completion.open).toBe(true);
  await page.screenshot({ path: resolve(output, 'mention-types.png') });
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await state()).completion.selected).toBe(1);
  await page.keyboard.press('Tab');
  await expect.poll(async () => (await state()).composer).toBe('@directory ');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state()).completion.open).toBe(false);
  await page.mouse.click(100, await height() - 28);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state()).dark).toBe(true);
  await input('/');
  await expect.poll(async () => (await state()).completion.loading).toBe(false);
  await page.screenshot({ path: resolve(output, 'dark-slash.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 788));
  await page.waitForFunction(() => innerWidth === 1000);
  await frame();
  await page.screenshot({ path: resolve(output, 'narrow.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1488, 1086));
  await page.waitForFunction(() => innerWidth === 1488);
  await frame();
  await page.mouse.click(100, 28);
  await expect.poll(async () => (await state()).chats.length).toBe(2);
  await expect.poll(async () => (await state()).chats[1].state).toBe('idle');
  await frame();
  await page.mouse.click(1130, await height() - 20);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state()).chats[1].agent).toBe('unsupported-fixture');
  await input('text fixture ready');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state()).chats[1].state).toBe('idle');
  expect((await state()).chats[1].capabilities.images).toBe(false);
  await input('@image pixel');
  await expect.poll(async () => (await state()).completion.error).toBe('This Agent does not support images.');
  expect((await state()).attachments).toEqual([]);
  await page.screenshot({ path: resolve(output, 'unsupported-image.png') });
  expect(errors).toEqual([]);
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ checks: ['advertised-controls', 'advertised-thinking-off', 'context-type-menu', 'mention-file', 'reference-delete-undo', 'frozen-resource', 'slash-command', 'slash-skill', 'image-content', 'browser-image-paste', 'native-file-picker', 'permission', 'arrow-tab-completion', 'escape', 'dark', 'narrow', 'unsupported-image'], state: await state(), errors }, null, 2));
  console.log(JSON.stringify({ checks: 'composer parity', errors, output }));
} catch (error) {
  const page = await app.firstWindow();
  console.error({ errors, state: await page.evaluate(() => window.peroDiagnostics?.snapshot()).catch(() => 'unavailable') });
  await page.screenshot({ path: resolve(output, 'failure.png') });
  throw error;
} finally {
  await app.close();
}

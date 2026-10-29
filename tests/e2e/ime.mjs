// Drive the compiled Web backend, including the keydown before compositionstart.
import { expect } from '@playwright/test';
import { electron } from './electron.mjs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const output = resolve(root, 'test-results/ime');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-ime-'));
await mkdir(output, { recursive: true });
const app = await electron.launch({
  args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), resolve(root, 'desktop')],
  cwd: root,
  env: { ...process.env, PERO_DESKTOP_DATA_DIR: resolve(temp, 'profile'), PERO_LOCALE: 'en',
    PERO_SETTINGS_PATH: resolve(temp, 'settings.json'), PERO_HISTORY_PATH: resolve(temp, 'sessions.jsonl') },
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60000 });
  const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
  await page.mouse.click(100, 28);
  await expect.poll(async () => (await state()).chats.length).toBe(1);
  await page.mouse.click(950, await page.evaluate(() => innerHeight - 55));
  await expect.poll(async () => (await state()).composerFocused).toBe(true);

  for (const [preedit, committed] of [['ni', '你'], ['hao', '好'], ['shijie', '世界']]) {
    const before = (await state()).composer;
    const result = await page.evaluate(({ preedit, committed }) => {
      const target = document.activeElement;
      if (!(target instanceof HTMLTextAreaElement)) throw new Error('GPUI IME mirror is not focused');
      const start = target.selectionStart;
      const prefix = target.value.slice(0, start);
      const suffix = target.value.slice(target.selectionEnd);
      const key = (type, value, keyCode, isComposing = false) => {
        const event = new KeyboardEvent(type, { key: value, keyCode, isComposing, bubbles: true, cancelable: true });
        target.dispatchEvent(event);
        return event.defaultPrevented;
      };
      // macOS can deliver this before either composition flag is true.
      const cancelled = [key('keydown', preedit[0], 229)];
      const boundaryText = JSON.parse(window.peroDiagnostics.snapshot()).composer;
      target.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      for (const data of [preedit, committed]) {
        target.value = prefix + data + suffix;
        target.setSelectionRange(start + data.length, start + data.length);
        target.dispatchEvent(new CompositionEvent('compositionupdate', { data, bubbles: true }));
      }
      // Internal flag only: these must neither edit the draft nor submit it.
      for (const value of ['Backspace', 'Escape', 'Enter', 'ArrowLeft']) {
        cancelled.push(key('keydown', value, 0));
      }
      target.dispatchEvent(new CompositionEvent('compositionend', { data: committed, bubbles: true }));
      cancelled.push(key('keyup', 'Enter', 229));
      return { cancelled, boundaryText };
    }, { preedit, committed });
    expect(result.boundaryText).toBe(before);
    expect(result.cancelled).toEqual(Array(6).fill(false));
    await expect.poll(async () => (await state()).composer).toBe(before + committed);
    expect((await state()).chats[0].messages).toHaveLength(0);
  }

  // Browser flag alone must protect text even before compositionstart.
  expect(await page.evaluate(() => {
    const event = new KeyboardEvent('keydown', { key: 'x', keyCode: 88, isComposing: true, bubbles: true, cancelable: true });
    document.activeElement.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(false);
  expect((await state()).composer).toBe('你好世界');
  await page.keyboard.type(' abc');
  await expect.poll(async () => (await state()).composer).toBe('你好世界 abc');
  await page.keyboard.press('Backspace');
  await expect.poll(async () => (await state()).composer).toBe('你好世界 ab');
  await page.screenshot({ path: resolve(output, 'pinyin.png') });
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+a`);
  await page.keyboard.press('Backspace');
  await expect.poll(async () => (await state()).composer).toBe('');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'nihaoshijie', selectionStart: 10, selectionEnd: 10 });
  await cdp.send('Input.insertText', { text: '你好世界' });
  await expect.poll(async () => (await state()).composer).toBe('你好世界');
  await cdp.send('Input.imeSetComposition', { text: 'quxiao', selectionStart: 6, selectionEnd: 6 });
  await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
  await expect.poll(async () => (await state()).composer).toBe('你好世界');
  await cdp.detach();
  expect(errors).toEqual([]);
  console.log('Web IME passed: boundary keys, successive Pinyin, editing, shortcuts, compositor commit/cancel.');
} finally {
  await app.close();
}

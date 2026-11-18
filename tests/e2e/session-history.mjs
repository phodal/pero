// Restore complete conversations through the real Host and GPUI, without an Agent prompt.
import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { electron } from './electron.mjs';
import { clickAppShortcut, clickSessionRow } from './sidebar-controls.mjs';

const root = resolve(import.meta.dirname, '../..'), temp = await mkdtemp(resolve(tmpdir(), 'pero-history-'));
const out = resolve(root, 'test-results/session-history');
await mkdir(out, { recursive: true });
for (const filename of ['result.json', 'restored-conversation.png', 'failure.json', 'failure.png']) {
  await rm(resolve(out, filename), { force: true });
}
await copyFile(resolve(root, 'target/debug/pero-host'), resolve(temp, 'pero-host'));
const events = [], old = 'restored-long', recent = 'restored-recent', gone = 'deleted-thread';
const record = (kind, thread_id, text = '', data) => events.push({ version: 1, kind, request_id: null, thread_id, text, ...(data ? { data } : {}) });
const update = (thread, data) => record('session_update', thread, '', data);
for (const id of [old, gone]) {
  record('session_created', id, '', { agent: 'fixture', workspace: root });
  record('user_message', id, id === old ? 'Restore this complete conversation' : 'Do not restore this');
}
const delta = '恢复🙂 ', expected = delta.repeat(6000);
for (let i = 0; i < 6000; i++) update(old, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: delta } });
update(old, { sessionUpdate: 'tool_call', toolCallId: 'evidence', title: 'Retained source evidence', kind: 'read', status: 'completed',
  content: [{ type: 'content', content: { type: 'text', text: 'Original evidence remains separate.' } }] });
update(old, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Retained reasoning' } });
update(old, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Final result after tool evidence.' } });
update(old, { sessionUpdate: 'session_info_update', title: 'Restored long conversation' });
record('turn_finished', old);
record('session_deleted', gone);
record('session_closed', gone);
record('session_created', recent, '', { agent: 'fixture', workspace: root });
record('user_message', recent, 'Recent question');
update(recent, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Recent answer' } });
record('turn_finished', recent);
const history = resolve(temp, 'history.jsonl');
const rows = events.map(event => JSON.stringify(event));
rows.splice(2, 0, '{damaged record}');
await writeFile(history, rows.join('\n') + '\n');
const digest = async () => createHash('sha256').update(await readFile(history)).digest('hex');
const original = await digest();
await writeFile(resolve(temp, 'agents.json'), JSON.stringify([{ id: 'fixture', name: 'Unavailable fixture', command: resolve(temp, 'absent-agent') }]));
let app, page;
let phase = 'startup';
const errors = [];
let lastObservation;
const state = async () => {
  const snapshot = await page.evaluate(() => window.peroDiagnostics ? JSON.parse(window.peroDiagnostics.snapshot()) : {});
  const { navigation, tab, activeContent, sessionRowBounds, chats } = snapshot;
  lastObservation = { navigation, tab, activeContent, sessionRowBounds,
    threads: chats?.map(chat => ({ id: chat.id, messages: chat.messages.length, state: chat.state })) };
  return snapshot;
};
async function waitForBounds(field, id) {
  // The session catalog can arrive before the navigator paints its controls.
  await expect.poll(async () => {
    const bounds = (await state())[field]?.[id];
    return bounds?.width > 0 && bounds?.height > 0;
  }, { timeout: 30000 }).toBe(true);
}
async function selectHistory(thread) {
  phase = `open session navigator for ${thread}`;
  await waitForBounds('sidebarButtonBounds', 'sessions');
  await clickAppShortcut(page, 'sessions');
  phase = `select ${thread}`;
  await waitForBounds('sessionRowBounds', thread);
  await clickSessionRow(page, thread);
  await expect.poll(async () => (await state()).activeContent, { timeout: 30000 })
    .toEqual({ kind: 'conversation', value: thread });
}
try {
  const env = { ...process.env, PERO_HOST_EXECUTABLE: resolve(temp, 'pero-host'), PERO_DESKTOP_DATA_DIR: resolve(temp, 'profile'),
    PERO_HISTORY_PATH: history, PERO_SETTINGS_PATH: resolve(temp, 'settings.json'), PERO_AGENTS_FILE: resolve(temp, 'agents.json'), PERO_LOCALE: 'en' };
  app = await electron.launch({
    args: [...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), resolve(root, 'desktop')], cwd: root, env,
  });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1488, 1000));
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    return !document.getElementById('loading') && canvas?.width === Math.round(innerWidth * devicePixelRatio)
      && canvas.height === Math.round(innerHeight * devicePixelRatio);
  }, undefined, { timeout: 30000 });
  await expect.poll(async () => (await state()).historyStatus, { timeout: 30000 }).toEqual({
    read_failed: false, malformed_records: 1, save_failure: null,
  });
  await selectHistory(old);
  phase = 'restore long conversation';
  await expect.poll(async () => (await state()).chats?.find(chat => chat.id === old)?.messages.length, { timeout: 30000 }).toBe(4);
  const chats = (await state()).chats, restored = chats.find(chat => chat.id === old);
  expect(restored.title).toBe('Restored long conversation');
  expect(restored.messages.map(message => message.text)).toEqual(['Restore this complete conversation', expected, 'Retained reasoning', 'Final result after tool evidence.']);
  expect(restored.tools[0].content).toContain('Original evidence remains separate.');
  expect(chats.some(chat => chat.id === gone)).toBe(false);
  await selectHistory(recent);
  phase = 'restore recent conversation';
  await expect.poll(async () => (await state()).chats?.find(chat => chat.id === recent)?.messages.at(-1)?.text).toBe('Recent answer');
  await selectHistory(old);
  phase = 'verify restored conversation';
  expect((await state()).chats.find(chat => chat.id === old)?.messages[1]?.text).toBe(expected);
  await page.screenshot({ path: resolve(out, 'restored-conversation.png') });
  expect(await digest()).toBe(original);
  expect(errors).toEqual([]);
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ passed: true, journalEvents: events.length, messages: restored.messages.length, tools: restored.tools.length, originalJournalUnchanged: true, historyStatus: (await state()).historyStatus, errors }, null, 2));
  console.log('Session history passed: >6000 deltas, intact conversations, tools/reasoning, deletion, visible degradation and unchanged journal.');
} catch (error) {
  const observation = await page?.waitForFunction(() => {
    if (!window.peroDiagnostics) return { loading: document.getElementById('loading')?.textContent };
    const { navigation, tab, activeContent, sessionRowBounds, chats } = JSON.parse(window.peroDiagnostics.snapshot());
    return { viewport: { width: innerWidth, height: innerHeight }, navigation, tab, activeContent, sessionRowBounds,
      threads: chats?.map(chat => ({ id: chat.id, messages: chat.messages.length, state: chat.state })) };
  }, undefined, { timeout: 3000 }).then(value => value.jsonValue()).catch(() => undefined);
  await writeFile(resolve(out, 'failure.json'), JSON.stringify({ phase, error: String(error), errors,
    observation, lastObservation }, null, 2));
  await page?.screenshot({ path: resolve(out, 'failure.png'), timeout: 3000 }).catch(() => {});
  throw error;
} finally { await app?.close(); await rm(temp, { recursive: true, force: true }); }

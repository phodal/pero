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
await writeFile(history, events.map(event => JSON.stringify(event)).join('\n') + '\n');
const digest = async () => createHash('sha256').update(await readFile(history)).digest('hex');
const original = await digest();
await writeFile(resolve(temp, 'agents.json'), JSON.stringify([{ id: 'fixture', name: 'Unavailable fixture', command: resolve(temp, 'absent-agent') }]));
let app;
try {
  const env = { ...process.env, PERO_HOST_EXECUTABLE: resolve(temp, 'pero-host'), PERO_DESKTOP_DATA_DIR: resolve(temp, 'profile'),
    PERO_HISTORY_PATH: history, PERO_SETTINGS_PATH: resolve(temp, 'settings.json'), PERO_AGENTS_FILE: resolve(temp, 'agents.json'), PERO_LOCALE: 'en' };
  app = await electron.launch({ args: [resolve(root, 'desktop')], cwd: root, env });
  const page = await app.firstWindow(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const state = () => page.evaluate(() => window.peroDiagnostics ? JSON.parse(window.peroDiagnostics.snapshot()) : {});
  await expect.poll(async () => (await state()).chats?.find(chat => chat.id === old)?.messages.length, { timeout: 30000 }).toBe(4);
  const chats = (await state()).chats, restored = chats.find(chat => chat.id === old);
  expect(restored.title).toBe('Restored long conversation');
  expect(restored.messages.map(message => message.text)).toEqual(['Restore this complete conversation', expected, 'Retained reasoning', 'Final result after tool evidence.']);
  expect(restored.tools[0].content).toContain('Original evidence remains separate.');
  expect(chats.some(chat => chat.id === gone)).toBe(false);
  expect(chats.find(chat => chat.id === recent).messages.at(-1).text).toBe('Recent answer');
  await page.waitForFunction(() => !document.getElementById('loading'));
  await clickAppShortcut(page, 'sessions');
  await clickSessionRow(page, old);
  await page.screenshot({ path: resolve(out, 'restored-conversation.png') });
  expect(await digest()).toBe(original);
  expect(errors).toEqual([]);
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ passed: true, journalEvents: events.length, messages: restored.messages.length, tools: restored.tools.length, originalJournalUnchanged: true, errors }, null, 2));
  console.log('Session history passed: >6000 deltas, full identities/text, tools/reasoning, deletion and unchanged journal.');
} finally { await app?.close(); await rm(temp, { recursive: true, force: true }); }

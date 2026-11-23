// A project-bound composer hands a draft to the real task form without creating or dispatching it.
import { expect } from '@playwright/test';
import { realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { electron } from './electron.mjs';
import { clickNewChat, clickSessionRow } from './sidebar-controls.mjs';
import { setupSelfHostedMachines } from './self-hosted-machines-fixture.mjs';

const fixture = await setupSelfHostedMachines(process.env.PERO_TEST_DATABASE_URL, {
  outputDirectory: resolve(import.meta.dirname, '../../test-results/composer-remote'),
});
let app;
try {
  const { temp, root, url, client, agents } = fixture;
  const workspace = await realpath(temp);
  const settings = resolve(temp, 'settings.json');
  await writeFile(settings, JSON.stringify({chat_agent: 'fixture', workbench: {
    projects: [{workspace, project_id: 'team'}],
  }}));
  app = await electron.launch({cwd: root, args: ['--use-mock-keychain', resolve(root, 'desktop')],
    env: {...fixture.env, PERO_CLOUD_URL: url, PERO_CLIENT_TOKEN: client.token, PERO_LOCALE: 'en',
      PERO_DESKTOP_DATA_DIR: resolve(temp, 'desktop'), PERO_HISTORY_PATH: resolve(temp, 'history.jsonl'),
      PERO_AGENTS_FILE: agents, PERO_SETTINGS_PATH: settings}});
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'));
  const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
  await app.evaluate(({dialog, Menu}, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    Menu.getApplicationMenu().getMenuItemById('remote-tasks').click();
  }, workspace);
  await expect.poll(async () => (await state()).remote.state.identity?.role).toBe('client');
  await page.evaluate(() => window.pero.chooseWorkspace());
  await expect.poll(async () => (await state()).workspace).toBe(workspace);
  await clickNewChat(page);
  await expect.poll(async () => (await state()).chats[(await state()).activeChat]?.state).toBe('idle');
  await expect.poll(async () => (await state()).composerBounds.input?.height ?? 0).toBeGreaterThan(0);
  const original = (await state()).chats[(await state()).activeChat].id;
  const box = (await state()).composerBounds.input;
  await page.mouse.click(box.x + box.width/2, box.y + box.height/2);
  await page.keyboard.insertText('Compare results @worker');
  const label = 'Worker task';
  await expect.poll(async () => (await state()).completion.items).toContain(label);
  const {items, selected} = (await state()).completion;
  for (let n = (items.indexOf(label) - selected + items.length) % items.length; n; n--) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state()).remote.creating).toBe(true);
  expect((await state()).remote).toMatchObject({project:'team', prompt:'Compare results ', target_worker:null});
  expect(fixture.creationAttempts).toHaveLength(0);
  expect(fixture.dispatches).toHaveLength(0);
  await page.screenshot({path: resolve(fixture.out, 'worker-task-draft.png')});
  await clickSessionRow(page, original);
  await expect.poll(async () => (await state()).composer).toBe('Compare results ');
  const chatInput = (await state()).composerBounds.input;
  await page.mouse.click(chatInput.x + chatInput.width/2, chatInput.y + chatInput.height/2);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.insertText('/compute');
  await expect.poll(async () => (await state()).completion.items).toContain('Compute');
  const compute = (await state()).completion;
  for (let n = (compute.items.indexOf('Compute') - compute.selected + compute.items.length) % compute.items.length; n; n--) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state()).activeContent).toEqual({kind:'app', value:{name:'compute', panel:'main'}});
  expect(fixture.creationAttempts).toHaveLength(0);
  expect(fixture.dispatches).toHaveLength(0);
  console.log('Worker draft, retained chat text and Compute navigation passed without a remote submission.');
} finally {
  try { await app?.close(); } finally { await fixture.close(); }
}

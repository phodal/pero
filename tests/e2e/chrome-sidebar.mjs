// Headed extension and real Relay/Host, with a deterministic paired conversation.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { chromium, expect } from '@playwright/test';
import { WorkbenchBrowserUse } from '../../desktop/src/main/browser-use/chrome-relay.ts';
import { projectSourceCommand } from '../../desktop/src/main/browser-use/chrome-sidebar.ts';
import { EXTENSION_ID } from '../../packages/chrome-extension/src/protocol.ts';

const root = await mkdtemp(resolve(tmpdir(), 'pero-sidepanel-'));
const settings = resolve(root, 'settings.json');
const project = { id: 'observatory', title: 'Observatory', goal: '', workspace: null };
const otherProject = { ...project, id: 'other-project', title: 'Another Project' };
await writeFile(settings, JSON.stringify({ workbench: { research_projects: [project, otherProject] } }));
await writeFile(resolve(root, 'agents.json'), '[]');
let host, hostExit, hostError = '';
const pending = new Map();
function startHost() {
  host = spawn(process.env.PERO_COLLECTOR_HOST || resolve('target/debug/pero-host'), ['--stdio'], {
    cwd: root,
    env: { ...process.env, PERO_SETTINGS_PATH: settings, PERO_HISTORY_PATH: resolve(root, 'history.jsonl'),
      PERO_APPS_ROOT: resolve(root, 'apps'), PERO_AGENTS_FILE: resolve(root, 'agents.json'),
      PERO_BUILTIN_APPS: '', PERO_REQUIRED_APPS: '' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  hostExit = once(host, 'exit');
  host.stderr.on('data', chunk => { hostError += chunk; });
  createInterface({ input: host.stdout }).on('line', line => {
    const event = JSON.parse(line);
    if (event.kind === 'project_sources_result') pending.get(event.request_id)?.(event.data);
  });
}
async function stopHost() {
  if (!host) return;
  host.stdin.end();
  const [code, signal] = await hostExit;
  host = undefined;
  assert.deepEqual([code, signal], [0, null], hostError);
}
async function projectRequest(request, expectOk = true) {
  const request_id = randomUUID();
  const data = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(request_id); reject(new Error(hostError || 'Project source request timed out')); }, 10000);
    pending.set(request_id, value => { clearTimeout(timer); pending.delete(request_id); resolve(value); });
    host.stdin.write(JSON.stringify({ method: 'project_sources', request_id, request }) + '\n');
  });
  assert.equal(data.ok, expectOk, JSON.stringify(data));
  return expectOk ? data.value : data.error;
}
const output = resolve('test-results/chrome-sidebar');
await mkdir(output, { recursive: true });
const thread = 'acceptance';
let selectedThread = thread;
const messages = [];
const composer = { text: '', model: 'one', models: [['one','One'],['two','Two']], references: [], items: [] };
let saved, savedProjectRequest, loseProjectReply = true;
const owner = new WorkbenchBrowserUse({ tool: { description: '' } }, async () => selectedThread, root,
  async (sessionId, request, check) => {
    const source = projectSourceCommand(request);
    if (source) {
      check();
      if (source.kind === 'save') savedProjectRequest = source;
      const value = await projectRequest(source);
      if (source.kind === 'save' && loseProjectReply) {
        loseProjectReply = false;
        owner.relay.revoke(thread);
      }
      return value;
    }
    if (request.kind === 'edit') {
      assert.equal(composer.text, request.before);
      const bytes = Buffer.from(composer.text);
      composer.text = bytes.subarray(0,request.start).toString() + request.insert + bytes.subarray(request.end).toString();
    }
    if (request.kind === 'model') composer.model = request.id;
    if (request.kind === 'submit') {
      assert.equal(request.text, composer.text);
      messages.push({ role: 'user', text: request.text });
      composer.text = '';
    }
    if (request.kind === 'collect') {
      saved = request;
      return { artifactReceipt: { id: 'reviewed-source' } };
    }
    return { sessionId, title: 'Browser acceptance', workspace: root, projectCollector: true, messages, composer, sessions: [] };
  });
const site = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end('<title>Collector fixture</title><main>Amber observatory <input value="private field"></main>');
});
owner.relay.attach(site);
await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
const extension = resolve('target/chrome-extension');
const origin = 'chrome-extension://' + EXTENSION_ID;
let chrome;
try {
  startHost();
  chrome = await chromium.launchPersistentContext(root, { executablePath: chromium.executablePath(), headless: false,
    args: ['--load-extension=' + extension, '--disable-extensions-except=' + extension] });
  const target = chrome.pages()[0];
  const url = 'http://127.0.0.1:' + site.address().port + '/';
  await target.goto(url);
  const panel = await chrome.newPage();
  await panel.goto(origin + '/sidepanel.html');
  await panel.getByRole('textbox', { name: 'Message Pero' }).fill('Chrome sidebar message');
  await expect(panel.getByRole('button', { name: 'Send message' })).toBeDisabled();
  await panel.reload();
  await expect(panel.getByRole('textbox', { name: 'Message Pero' })).toHaveValue('Chrome sidebar message');
  const review = await chrome.newPage();
  const pairing = await owner.relay.pairing('Browser acceptance');
  await review.goto(origin + '/relay.html#' + new URLSearchParams({ pair: pairing }));
  await expect(review.locator('#status')).toContainText('Connected');
  await expect(panel.getByRole('textbox', { name: 'Message Pero' })).toHaveValue('Chrome sidebar message');
  await panel.getByLabel('Model', {exact:true}).selectOption('two');
  await expect.poll(() => composer.model).toBe('two');
  await panel.getByRole('button', { name: 'Send message' }).click();
  await expect(panel.locator('.bubble')).toContainText('Chrome sidebar message');
  await panel.setViewportSize({ width: 420, height: 760 });
  await target.bringToFront();
  await panel.getByRole('button', { name: 'Tab screenshot', exact: true }).evaluate(button => button.click());
  const removeScreenshot = panel.getByRole('button', { name: 'Remove Tab screenshot.png' });
  await expect(removeScreenshot).toBeVisible();
  await panel.screenshot({ path: resolve(output, 'testing-chat.png') });
  await removeScreenshot.click();
  await expect(panel.getByRole('button', { name: 'Send message' })).toBeDisabled();
  await panel.getByRole('button', { name: 'More' }).click();
  await panel.getByRole('menuitem', { name: 'Collector' }).click();
  await target.bringToFront();
  await panel.locator('#collector-capture').evaluate(button => button.click());
  await expect(panel.locator('#collector-content')).toHaveValue('Amber observatory');
  await panel.locator('#collector-reason').fill('Review destination');
  await panel.locator('#collector-save').click();
  await expect(panel.locator('#collector-receipt')).toContainText('reviewed-source');
  await panel.screenshot({ path: resolve(output, 'testing-collector.png') });
  assert.equal(saved.url, url);
  assert.equal(saved.reason, 'Review destination');
  assert.equal(saved.content, 'Amber observatory');

  await panel.locator('#collector-another').click();
  await target.locator('main').evaluate(main => getSelection().selectAllChildren(main));
  await panel.locator('#collector-capture-scope').selectOption('selection');
  await target.bringToFront();
  await panel.locator('#collector-capture').evaluate(button => button.click());
  await expect(panel.locator('#collector-editor')).toBeVisible();
  await panel.getByLabel('Save to').selectOption(project.id);
  await panel.locator('#collector-title').fill('Observatory 摘录');
  await panel.locator('#collector-content').fill('Amber observatory 🌱');
  await panel.locator('#collector-reason').fill('Record the observation');
  await panel.locator('#collector-question').fill('Which source supports it?');
  const exported = await panel.locator('#collector-final-preview').textContent();
  await panel.locator('#collector-save').click();
  await expect(panel.getByRole('heading', { name: 'Unconfirmed Project save' })).toBeVisible();
  await expect(panel.locator('#collector-capture')).toBeDisabled();
  await expect(panel.locator('#collector-editor')).toBeHidden();
  await panel.screenshot({ path: resolve(output, 'pending-project-collector.png') });
  assert.equal(savedProjectRequest.projectId, project.id);
  const { id } = savedProjectRequest.source;
  const { sources: [receipt] } = await projectRequest({ kind: 'list', projectId: project.id });
  assert.equal(receipt.id, id);
  assert.equal(receipt.scope, 'selection');
  assert.equal(receipt.url, url);
  assert.equal(receipt.sha256, createHash('sha256').update(exported).digest('hex'));
  await target.goto(url + '?later');
  await panel.reload();
  await expect(panel.getByRole('heading', { name: 'Unconfirmed Project save' })).toBeVisible();
  selectedThread = 'another-conversation';
  const wrong = await chrome.newPage();
  await wrong.goto(origin + '/relay.html#' + new URLSearchParams({ pair: await owner.relay.pairing('Another session') }));
  await expect(wrong.locator('#status')).toContainText('Connected');
  await panel.getByRole('button', { name: 'Recover save' }).click();
  await expect(panel.getByRole('alert')).toContainText('Pair the original conversation');
  await expect(panel.getByRole('heading', { name: 'Unconfirmed Project save' })).toBeVisible();
  selectedThread = thread;
  await stopHost();
  startHost();
  const recovery = await chrome.newPage();
  await recovery.goto(origin + '/relay.html#' + new URLSearchParams({ pair: await owner.relay.pairing('Recovered session') }));
  await expect(recovery.locator('#status')).toContainText('Connected');
  await panel.getByRole('button', { name: 'Recover save' }).click();
  await expect(panel.locator('#collector-receipt')).toContainText('Saved to Project · Observatory');
  await expect(panel.getByRole('heading', { name: 'Unconfirmed Project save' })).toBeHidden();
  await panel.screenshot({ path: resolve(output, 'testing-project-collector.png') });
  assert.deepEqual(await projectRequest({ kind: 'list', projectId: project.id }), { sources: [receipt] });
  await panel.reload();
  await expect(panel.locator('#collector-capture')).toBeEnabled();
  await expect(panel.getByRole('heading', { name: 'Unconfirmed Project save' })).toBeHidden();
  assert.deepEqual((await projectRequest(savedProjectRequest)).sourceReceipt, receipt);
  assert.match(await projectRequest({ ...savedProjectRequest, source: { ...savedProjectRequest.source, content: 'Different text' } }, false), /different content/);
  assert.deepEqual(await projectRequest({ kind: 'list', projectId: otherProject.id }), { sources: [] });
  await projectRequest({ kind: 'read', projectId: otherProject.id, id }, false);
  await projectRequest({ ...savedProjectRequest, projectId: '../unavailable-project' }, false);
  await projectRequest({ ...savedProjectRequest, source: { ...savedProjectRequest.source, id: randomUUID(), content: '研'.repeat(5600) } }, false);
  const { source } = await projectRequest({ kind: 'read', projectId: project.id, id });
  assert.deepEqual(source.source, savedProjectRequest.source);
  assert.equal(source.sha256, receipt.sha256);
  console.log('Verified Chrome collection, scope, review bytes and original Project receipt recovery after a dropped reply, panel reload, navigation and Host restart.');
} finally {
  owner.relay.close();
  await chrome?.close();
  site.close();
  await stopHost();
  await rm(root, { recursive: true, force: true });
}

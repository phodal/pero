// Headed extension and real Relay, with a deterministic conversation at the Native UI boundary.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { WorkbenchBrowserUse } from '../../desktop/src/main/browser-use/chrome-relay.ts';
import { EXTENSION_ID } from '../../packages/chrome-extension/src/protocol.ts';

const root = await mkdtemp(resolve(tmpdir(), 'pero-sidepanel-'));
const output = resolve('test-results/chrome-sidebar');
await mkdir(output, { recursive: true });
const thread = 'acceptance';
const messages = [];
const composer = { text: '', model: 'one', models: [['one','One'],['two','Two']], references: [], items: [] };
let saved;
const owner = new WorkbenchBrowserUse({ tool: { description: '' } }, async () => thread, root,
  async (_, request) => {
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
    return { sessionId: thread, title: 'Browser acceptance', workspace: root, messages, composer, sessions: [] };
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
  await expect(review.locator('#status')).toContainText('awaiting tab approval');
  await expect(panel.getByRole('textbox', { name: 'Message Pero' })).toHaveValue('Chrome sidebar message');
  await panel.getByLabel('Model', {exact:true}).selectOption('two');
  await expect.poll(() => composer.model).toBe('two');
  await panel.getByRole('button', { name: 'Send message' }).click();
  await expect(panel.locator('.bubble')).toContainText('Chrome sidebar message');
  await panel.setViewportSize({ width: 420, height: 760 });
  await panel.screenshot({ path: resolve(output, 'testing-chat.png') });
  await panel.getByRole('button', { name: 'More' }).click();
  await panel.getByRole('menuitem', { name: 'Collector' }).click();
  await target.bringToFront();
  await panel.locator('#collector-capture').evaluate(button => button.click());
  await expect(panel.locator('#collector-error')).toContainText('allow this tab');
  await expect(review.locator('#tab')).toContainText('Collector fixture');
  await review.locator('#review').evaluate(button => button.click());
  await review.locator('#allow').evaluate(button => button.click());
  await expect(review.locator('#status')).toContainText('1 approved tab');
  await panel.locator('#collector-capture').evaluate(button => button.click());
  await expect(panel.locator('#collector-content')).toHaveValue('Amber observatory');
  await panel.locator('#collector-reason').fill('Review destination');
  await panel.locator('#collector-save').click();
  await expect(panel.locator('#collector-receipt')).toContainText('reviewed-source');
  await panel.screenshot({ path: resolve(output, 'testing-collector.png') });
  assert.equal(saved.url, url);
  assert.equal(saved.reason, 'Review destination');
  assert.equal(saved.content, 'Amber observatory');
  console.log('Verified sidebar message, tab denial, approved capture and reviewed receipt.');
} finally {
  owner.relay.close();
  await chrome?.close();
  site.close();
  await rm(root, { recursive: true, force: true });
}

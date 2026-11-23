// Headed extension and real Relay, with a deterministic conversation at the Native UI boundary.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { WorkbenchBrowserUse } from '../../desktop/src/main/browser-use/chrome-relay.ts';
import { EXTENSION_ID } from '../../packages/chrome-extension/src/protocol.ts';

const root = await mkdtemp(resolve(tmpdir(), 'pero-sidepanel-'));
const thread = 'acceptance';
const messages = [];
let saved;
const owner = new WorkbenchBrowserUse({ tool: { description: '' } }, async () => thread, root,
  async (_, request) => {
    if (request.kind === 'send') messages.push({ role: 'user', text: request.text });
    if (request.kind === 'collect') {
      saved = request;
      return { artifactReceipt: { id: 'reviewed-source' } };
    }
    return { sessionId: thread, title: 'Browser acceptance', workspace: root, messages, sessions: [] };
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
  const review = await chrome.newPage();
  const pairing = await owner.relay.pairing('Browser acceptance');
  await review.goto(origin + '/relay.html#' + new URLSearchParams({ pair: pairing }));
  await expect(review.locator('#status')).toContainText('awaiting tab approval');
  const panel = await chrome.newPage();
  await panel.goto(origin + '/sidepanel.html');
  await panel.getByRole('textbox', { name: 'Message Pero' }).fill('Chrome sidebar message');
  await panel.getByRole('button', { name: 'Send message' }).click();
  await expect(panel.locator('.bubble')).toContainText('Chrome sidebar message');
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

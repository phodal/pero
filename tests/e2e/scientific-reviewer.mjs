// Actual Electron/Host/Go harness and shell; the loopback model is explicitly scripted.
// Prerequisites: build:harness, build:host, build:wasm, build:web, build:desktop,
// and the Scientific Viewer App bundle. This is integration evidence, not science acceptance.
import { expect } from '@playwright/test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { electron } from './electron.mjs';
import { clickNewChat, setAppearance } from './sidebar-controls.mjs';

const root = resolve(import.meta.dirname, '../..');
const output = join(root, 'test-results/scientific-reviewer');
const temp = await realpath(await mkdtemp(join(tmpdir(), 'pero-scientific-reviewer-')));
const workspace = join(temp, 'workspace');
await Promise.all([mkdir(output, { recursive: true }), mkdir(workspace)]);
const calls = [], packets = [], providerErrors = [], errors = [], logs = [];
const wrongClaim = 'The executed mean is 9.';
const correction = 'Correction: the observed mean is 2. REVIEWER_FIXTURE_CORRECTED';
let mainCalls = 0;
const plain = message => typeof message.content === 'string' ? message.content
  : (message.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');
const server = createServer(async (req, res) => {
  try {
    let raw = '';
    for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    calls.push(body);
    const tools = (body.tools || []).map(tool => tool.function?.name);
    let delta, finish;
    if (tools.includes('structured_output')) {
      expect(tools).toEqual(['structured_output']);
      const packetText = body.messages.map(plain).find(text => text.includes('Frozen packet SHA-256:'));
      expect(packetText).toBeTruthy();
      const match = packetText.match(/Frozen packet SHA-256: [a-f0-9]{64}\n(\{[^]*\})/);
      expect(match).toBeTruthy();
      const packet = JSON.parse(match[1]);
      packets.push(packet);
      const message = packet.messages.find(item => item.text.includes(wrongClaim));
      const evidence = packet.evidence.find(item => item.kind === 'tool_result'
        && JSON.parse(item.text).content.some(block => block.type === 'text'
          && JSON.parse(block.text).stdout?.text === '{"mean":2}\n'));
      expect(message).toBeTruthy();
      expect(evidence).toBeTruthy();
      delta = { tool_calls: [{ index: 0, id: `review-output-${packets.length}`, type: 'function', function: {
        name: 'structured_output', arguments: JSON.stringify({ findings: [{ category: 'numeric_conflict',
          messageId: message.id, quote: wrongClaim, evidenceIds: [evidence.id],
          rationale: 'The actual shell result records mean 2 while the answer states 9.',
          suggestion: 'Correct the answer to mean 2 and retain the execution record.', certainty: 'possible_issue' }] }),
      } }] };
      finish = 'tool_calls';
    } else {
      mainCalls++;
      if (mainCalls === 1) {
        expect(tools).toContain('shell');
        delta = { tool_calls: [{ index: 0, id: 'observed-mean', type: 'function', function: {
          name: 'shell', arguments: JSON.stringify({ command: `printf '%s\\n' '{"mean":2}'` }),
        } }] };
        finish = 'tool_calls';
      } else if (mainCalls === 2) {
        expect(body.messages.some(message => message.role === 'tool'
          && JSON.parse(plain(message)).stdout?.text === '{"mean":2}\n')).toBe(true);
        delta = { content: `${wrongClaim} REVIEWER_FIXTURE_ANSWER` };
        finish = 'stop';
      } else {
        expect(body.messages.map(plain).join('\n')).toContain('Unresolved evidence-consistency findings');
        delta = { content: correction };
        finish = 'stop';
      }
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ id: `fixture-${calls.length}`, object: 'chat.completion.chunk', model: 'reviewer-fixture',
      choices: [{ index: 0, delta, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`);
  } catch (error) {
    providerErrors.push(String(error));
    res.writeHead(500);
    res.end('Scientific Reviewer fixture failed');
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const settings = join(temp, 'settings.json'), agents = join(temp, 'agents.json');
await writeFile(agents, JSON.stringify([{ id: 'reviewer-harness', name: 'Scientific Reviewer / loopback model fixture',
  command: process.env.PERO_REVIEWER_HARNESS || join(root, 'target/debug/pero-agent-acp'),
  args: ['--endpoint', `http://127.0.0.1:${server.address().port}/v1`, '--model', 'reviewer-fixture',
    '--session-dir', join(temp, 'sessions'), '--workspace', workspace, '--enable-shell', '--max-requests', '12',
    '--max-tokens', '2048', '--max-retries', '0'], env: { AGENT_PROVIDER_API_KEY: 'loopback-fixture-only' } }]));
await writeFile(settings, JSON.stringify({ chat_agent: 'reviewer-harness',
  workbench: { appearance: 'light', layout: { artifact_view: 'list' } } }));
const env = { ...process.env, PERO_DESKTOP_DATA_DIR: join(temp, 'profile'), PERO_SETTINGS_PATH: settings,
  PERO_HISTORY_PATH: join(temp, 'history.jsonl'), PERO_AGENTS_FILE: agents, PERO_ENV_FILE: join(temp, 'no-env'),
  PERO_BUILTIN_APPS: 'scientific-viewer', PERO_REQUIRED_APPS: 'scientific-viewer', PERO_LOCALE: 'en' };
let app, page;
const state = () => page.evaluate(() => JSON.parse(window.peroDiagnostics.snapshot()));
const active = async () => { const snapshot = await state(); return snapshot.chats[snapshot.activeChat] || snapshot.chats[0]; };
const paint = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
async function click(read) {
  let box;
  await expect.poll(async () => { box = await read(); return !!box && box.width > 0 && box.height > 0; }).toBe(true);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
async function prompt(text) {
  await expect.poll(async () => (await active())?.state).toBe('idle');
  const users = (await active()).messages.filter(message => message.role === 'user').length;
  await click(async () => (await state()).composerBounds.input);
  await page.keyboard.insertText(text);
  if (text.startsWith('/')) await page.keyboard.press('Escape'); // Keep command text and dismiss completion.
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await active()).messages.filter(message => message.role === 'user').length).toBe(users + 1);
  await expect.poll(async () => {
    const chat = await active();
    if (chat.error) throw Error(chat.error);
    if (providerErrors.length) throw Error(providerErrors.join('\n'));
    return chat.state;
  }, { timeout: 60000 }).toBe('idle');
  await paint();
  return active();
}
async function reviewerMode(value) {
  await click(async () => (await state()).composerBounds.permissions);
  await page.keyboard.press('ArrowUp'); // Last submenu: Scientific Reviewer.
  await page.keyboard.press('ArrowRight');
  await paint();
  await page.screenshot({ path: join(output, `reviewer-menu-${value}.png`), scale: 'css' });
  if (value === 'auto') await page.keyboard.press('ArrowUp'); // Submenu opens on Manual.
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await active()).settings.options.find(option => option.id === 'scientific_review')?.current).toBe(value);
  await expect.poll(async () => (await active()).pending_setting).toBe(null);
}
async function launch() {
  app = await electron.launch({ args: ['--use-mock-keychain', join(root, 'desktop')], cwd: root, env });
  app.process().stderr?.on('data', data => logs.push(String(data)));
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') logs.push(message.text()); });
  page.on('requestfailed', request => logs.push(`${request.url()}: ${request.failure()?.errorText}`));
  await page.waitForFunction(() => window.peroDiagnostics && !document.getElementById('loading'), undefined, { timeout: 60000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 1050));
}
async function close() {
  if (!app) return;
  await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
  await app.close();
  app = null;
}
try {
  await launch();
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, workspace);
  await page.evaluate(() => window.pero.chooseWorkspace());
  await clickNewChat(page);
  await expect.poll(async () => (await active())?.state, { timeout: 30000 }).toBe('idle');
  expect((await active()).settings.options.find(option => option.id === 'scientific_review')?.current).toBe('off');
  expect(calls).toHaveLength(0);
  await reviewerMode('auto');
  let current = await prompt('Run the local mean fixture and report the observed value.');
  expect(mainCalls).toBe(2);
  expect(packets).toHaveLength(1);
  expect(current.tools.find(tool => tool.id === 'observed-mean')?.status).toBe('completed');
  expect(JSON.parse(current.tools.find(tool => tool.id === 'observed-mean').content).stdout.text).toBe('{"mean":2}\n');
  let review = current.messages.filter(message => message.role === 'assistant').at(-1).text;
  expect(review).toContain('Evidence consistency review');
  expect(review).toContain('numeric_conflict');
  expect(review).toContain('scientific acceptance remains unverified');
  expect(review).toContain('**open**');
  const automaticFinding = review.match(/finding-[a-f0-9]{16}/)?.[0];
  expect(automaticFinding).toBeTruthy();
  await page.mouse.move(1050, 550);
  await page.mouse.wheel(0, 10000);
  await paint();
  await page.screenshot({ path: join(output, 'open-finding-light.png'), scale: 'css' });
  await reviewerMode('off');
  current = await prompt('/review');
  expect(mainCalls).toBe(2);
  expect(packets).toHaveLength(2);
  review = current.messages.filter(message => message.role === 'assistant').at(-1).text;
  const finding = review.match(/finding-[a-f0-9]{16}/)?.[0];
  expect(finding).toBeTruthy();
  expect(review).toContain('numeric_conflict');
  current = await prompt('Correct the reported mean using the recorded execution result.');
  expect(current.messages.filter(message => message.role === 'assistant').at(-1).text).toContain(correction);
  expect(packets).toHaveLength(2); // Manual mode adds no background review.
  const requestsBeforeDisposition = calls.length;
  const reason = 'Corrected the answer to mean 2 in the next user-requested turn.';
  for (const id of new Set([automaticFinding, finding])) await prompt(`/review resolve ${id} ${reason}`);
  current = await prompt('/review status');
  expect(calls).toHaveLength(requestsBeforeDisposition);
  review = current.messages.filter(message => message.role === 'assistant').at(-1).text;
  expect(review).toContain('**resolved**');
  expect(review).not.toContain('**open**');
  expect(review).toContain(reason);
  expect(review).toContain(wrongClaim);
  const messageIndex = current.messages.findLastIndex(message => message.role === 'assistant');
  await page.mouse.move(1050, 550);
  await page.mouse.wheel(0, 10000);
  await paint();
  await click(async () => (await state()).artifacts?.bounds[`save-reply:${messageIndex}`]);
  await expect.poll(async () => (await state()).artifacts?.items.length).toBe(1);
  const artifact = (await state()).artifacts.items[0];
  expect(artifact.versions[0].source_message_id).toBe(`message:${messageIndex}`);
  expect(artifact.versions[0].version).toBe(1);
  const viewer = page.frameLocator('iframe[title="Scientific Viewer"]');
  await viewer.locator(`[data-artifact-id="${artifact.id}"]`).dblclick();
  await click(async () => (await state()).artifacts.bounds.expand);
  await expect(viewer.locator('.artifact-markdown:visible')).toContainText('Evidence consistency review');
  await expect(viewer.locator('.artifact-markdown:visible')).toContainText(finding);
  await expect(viewer.locator('.artifact-markdown:visible')).toContainText(reason);
  await page.screenshot({ path: join(output, 'saved-report-inspector-light.png'), scale: 'css' });
  await setAppearance(page, 'dark');
  await page.screenshot({ path: join(output, 'saved-report-inspector-dark.png'), scale: 'css' });
  await close();
  await launch();
  // Desktop restores historical conversations closed; viewing retained evidence makes no provider request.
  await expect.poll(async () => (await active())?.state, { timeout: 30000 }).toBe('closed');
  await expect.poll(async () => (await state()).artifacts?.items.some(item => item.id === artifact.id)).toBe(true);
  current = await active();
  expect(current.messages.filter(message => message.role === 'assistant').at(-1).text).toContain(reason);
  expect((await state()).artifacts.items.find(item => item.id === artifact.id).versions[0].sha256).toBe(artifact.versions[0].sha256);
  await click(async () => (await state()).artifacts.bounds.toggle);
  const restoredViewer = page.frameLocator('iframe[title="Scientific Viewer"]');
  await restoredViewer.locator(`[data-artifact-id="${artifact.id}"]`).dblclick();
  await expect(restoredViewer.locator('.artifact-markdown:visible')).toContainText(reason);
  await page.screenshot({ path: join(output, 'restored-report-dark.png'), scale: 'css' });
  expect(calls).toHaveLength(requestsBeforeDisposition);
  expect((await active()).settings.options.find(option => option.id === 'scientific_review')?.current).toBe('off');
  expect(providerErrors).toEqual([]);
  expect(errors).toEqual([]);
  await writeFile(join(output, 'result.json'), JSON.stringify({ realHarness: true, realHost: true,
    realShell: true, realModel: false, scientificAcceptance: 'unverified', requests: calls.length,
    mainRequests: mainCalls, reviewerRequests: packets.length, artifact, finding, temp, errors }, null, 2));
  await writeFile(join(output, 'frozen-packets.json'), JSON.stringify(packets, null, 2));
  console.log('Scientific Reviewer: actual shell contradiction, automatic/manual review, correction context, reasoned resolution, saved Inspector and restart passed. Model is a loopback fixture.');
} catch (error) {
  if (page) {
    await page.screenshot({ path: join(output, 'failure.png'), scale: 'css' }).catch(() => {});
    await writeFile(join(output, 'failure-state.json'), await page.evaluate(() => window.peroDiagnostics?.snapshot() || '{}').catch(() => '{}'));
    await writeFile(join(output, 'failure-frames.json'), JSON.stringify(await Promise.all(page.frames().map(async frame => ({
      url: frame.url(), text: await frame.locator('body').innerText().catch(() => ''),
    }))), null, 2));
  }
  await writeFile(join(output, 'failure-log.json'), JSON.stringify({ error: String(error), temp, providerErrors,
    requests: calls.length, mainCalls, packets, errors, logs }, null, 2));
  throw error;
} finally {
  await close();
  await new Promise(done => server.close(done));
}

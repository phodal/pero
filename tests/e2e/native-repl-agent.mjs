// Opt-in: installed Native probe, signed-in Codex, and two owned local fixtures.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { computerEvidenceDirectory, computerFixture } from '../fixtures/computer-app.mjs';

const installed = process.env.PERO_NATIVE_REPL_INSTALLED_APP;
assert(process.platform === 'darwin' && installed && process.env.PERO_NATIVE_REPL_REAL_AGENT === '1',
  'Set PERO_NATIVE_REPL_INSTALLED_APP to the signed Native probe app and PERO_NATIVE_REPL_REAL_AGENT=1 to use signed-in Codex.');
const app = await realpath(installed);
const root = resolve(import.meta.dirname, '../..');
const binary = resolve(app, 'Contents/MacOS/pero-native');
const bundledPython = await realpath(resolve(app, 'Contents/Resources/app/runtime/python/bin/python3'));
for (const bundle of [app, resolve(dirname(app), 'Pero Computer Use.app')]) {
  execFileSync('/usr/bin/codesign', ['--verify', '--strict', '--deep', bundle]);
}
assert((await readFile(binary)).includes(Buffer.from('Native real Agent REPL timed out')), 'Build with native-probe.');
const run = await mkdtemp(resolve(tmpdir(), 'pero-native-repl-agent-'));
const data = resolve(run, 'profile');
const workspace = resolve(run, 'workspace');
const output = resolve(computerEvidenceDirectory(root), 'native-repl-codex');
const report = resolve(output, 'session.json');
const marker = randomBytes(3).toString('hex').toUpperCase();
const hash = value => createHash('sha256').update(value).digest('hex');
let browserClicks = 0;
const server = createServer((request, response) => {
  if (request.method === 'POST' && request.url === '/clicked') {
    browserClicks++;
    response.writeHead(204).end();
    return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><title>Native REPL fixture</title>
    <h1>Native REPL fixture</h1>
    <button id="apply">Apply</button><output>Waiting</output>
    <canvas width="500" height="130" aria-label="Verification image"></canvas>
    <script>document.querySelector('#apply').onclick = event => {
      if (!event.isTrusted) return;
      document.querySelector('output').textContent = 'Trusted input';
      const context = document.querySelector('canvas').getContext('2d');
      context.fillStyle = '#173354'; context.fillRect(0, 0, 500, 130);
      context.fillStyle = '#fff'; context.font = 'bold 72px monospace';
      context.fillText('${marker}', 30, 90);
      fetch('/clicked', {method: 'POST'});
    };</script>`);
});
let fixture, child;
let log = '';
try {
  await Promise.all([mkdir(data), mkdir(workspace), mkdir(output, { recursive: true })]);
  await rm(report, { force: true });
  await writeFile(resolve(data, 'settings.json'), JSON.stringify({ chat_agent: 'codex', computer_use: { enabled: true } }));
  fixture = await computerFixture(root, run, false, { background: true });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/`;
  const prompt = `This is an authorized acceptance test on two disposable fixtures. Use only the Native python_repl tool. Run the following two cells exactly once each, in separate tool calls. You may discover the REPL if needed. Use no shell, files, page source, direct browser/desktop tools, or other tabs/windows.

First cell, authorized WebKit fixture:
import sys
print(sys.executable)
proof = 41
button = await cua.browser({"action":"locate","locator":{"by":"role","role":"button","name":"Apply"}})
click = await cua.browser({"action":"click","ref":button["nodes"][0]["ref"]})
assert click["outcome"] == "dispatched"
observed = await cua.browser({"action":"observe"})
assert any(node.get("text") == "Trusted input" for node in observed["nodes"])
cua.emit_image(await cua.browser({"action":"screenshot"}))

Second cell, authorized AppKit fixture:
print("Persisted", proof + 1)
status = (await cua.computer({"operation":"status"}))["status"]
print(status["accessibility"], status["screen_recording"])
targets = (await cua.computer({"operation":"targets"}))["targets"]
owned = [item for item in targets if item.get("application_id") == "dev.pero.perocomputerfixture"]
assert len(owned) == 1
target = owned[0]["reference"]
before = await cua.computer({"operation":"observe","target":target,"options":{"want_image":True}})
cua.emit_image(before)
element = next(e for e in before["observation"]["elements"] if e.get("label") == "Increment")
action = {"request_id":"native-repl-real-click","target":target,"observation_id":before["observation"]["id"],"delivery":"background","input":{"kind":"click","button":"left","count":1,"anchor":{"kind":"element","element_id":element["id"]}}}
receipt = await cua.computer({"operation":"act","action":action})
assert receipt["receipt"]["outcome"]["status"] == "executed"
after = await cua.computer({"operation":"observe","target":target,"options":{"want_image":True}})
assert any("Count: 1" in str(e.get("value")) for e in after["observation"]["elements"])
cua.emit_image(after)
print("Count: 1")

Read the six-character code visually from the first cell's browser screenshot. If both cells succeeded, reply PERO_NATIVE_REPL_OK, the visually read browser code, and Count: 1. If either cell failed, stop and report its specific blocker and the browser code if the first image arrived. Do not retry an input.`;
  const env = { ...process.env, PATH: '/usr/bin:/bin', DEVELOPER_DIR: resolve(run, 'no-developer-tools'),
    CODEX_CONFIG: JSON.stringify({ model: process.env.PERO_NATIVE_REPL_CODEX_MODEL || 'gpt-5.6-sol' }),
    PERO_NATIVE_EPHEMERAL_SECRETS: '1', PERO_NATIVE_DATA_DIR: data, PERO_ENV_FILE: '/dev/null', PERO_LOCALE: 'en',
    PERO_NATIVE_REPL_PROBE_AGENT: 'codex', PERO_NATIVE_REPL_PROBE_PROMPT: prompt,
    PERO_NATIVE_BROWSER_PROBE_URL: url, PERO_NATIVE_BROWSER_PROBE_WORKSPACE: workspace };
  for (const key of ['PERO_AGENTS_FILE', 'PERO_NATIVE_HOST', 'PERO_ADAPTER_NODE', 'PERO_AGENT_ROOT', 'PERO_BUILTIN_APPS_ROOT', 'PERO_BUILTIN_APPS', 'PERO_REQUIRED_APPS']) delete env[key];
  child = spawn(binary, ['--verify-apps', report, 'browser'], { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => { log += chunk; });
  child.stderr.on('data', chunk => { log += chunk; });
  const timeout = setTimeout(() => child.kill('SIGTERM'), 190_000);
  try { assert.deepEqual(await once(child, 'exit'), [0, null], log); }
  finally { clearTimeout(timeout); }
  const result = JSON.parse(await readFile(report, 'utf8'));
  assert.equal(result.error, null, result.error ?? result.reply);
  assert.equal(result.agent, 'codex');
  assert(result.reply.includes(marker), 'The Agent must read the canvas-only marker from the image.');
  assert.equal(browserClicks, 1, 'The page independently observed one trusted click.');
  assert.match(result.reply, /PERO_NATIVE_REPL_OK/);
  assert.equal((await fixture.state()).count, 1, 'The AppKit fixture independently observed one click.');
  const repl = result.tools.filter(tool => tool.status === 'completed' && tool.title.includes('python_repl'));
  assert(repl.length >= 2);
  const blocks = repl.flatMap(tool => tool.transcript.raw_output?.result?.content ?? []);
  const text = blocks.filter(block => block.type === 'text').map(block => block.text).join('\n');
  assert(text.includes(bundledPython), 'The worker must report the installed executable.');
  assert(text.includes('Persisted 42'), 'The second cell must see the first cell’s binding.');
  const delivered = new Set(blocks.filter(block => block.type === 'image').map(block => hash(Buffer.from(block.data, 'base64'))));
  const thread = hash(result.thread);
  const browser = resolve(data, 'browser-use-evidence', thread);
  const desktop = resolve(data, 'computer-use', thread);
  const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
  const rows = async directory => Promise.all((await readdir(directory)).filter(name => name.endsWith('.json'))
    .map(name => readJson(resolve(directory, name))));
  const browserRows = await rows(browser);
  const clicks = browserRows.filter(row => row.action === 'click');
  assert.equal(clicks.length, 1);
  assert.equal((await readJson(resolve(browser, clicks[0].id + '.result.json'))).outcome, 'dispatched');
  const saved = await readJson(resolve(desktop, hash('native-repl-real-click') + '.json'));
  assert.equal(saved.receipt.outcome.status, 'executed');
  assert.equal(saved.action.delivery, 'background');
  const images = [
    ...browserRows.filter(row => row.action === 'screenshot' && row.sha256)
      .map(row => ({ ...row, source: resolve(browser, row.id + '.png') })),
    ...(await rows(resolve(desktop, 'images'))).map(row => ({
      ...row, source: resolve(desktop, 'images', `${row.id}.${row.media_type === 'image/png' ? 'png' : 'jpg'}`),
    })),
  ];
  assert(images.some(image => image.action === 'screenshot'));
  assert(images.filter(image => image.target).length >= 2);
  const captures = [];
  for (const { source, ...image } of images) {
    const bytes = await readFile(source);
    assert.equal(hash(bytes), image.sha256);
    assert(image.width > 0 && image.height > 0 && bytes.length === image.bytes);
    assert(delivered.has(image.sha256), 'The Codex ACP transcript must return the same image bytes as the Host.');
    const file = basename(source);
    await copyFile(source, resolve(output, file));
    captures.push({ ...image, file });
  }
  await writeFile(resolve(output, 'evidence.json'), JSON.stringify({ passed: true, app, bundledPython, model: result.model,
    browserClicks, desktopCount: (await fixture.state()).count, visualMarker: marker, images: captures, receipt: saved.receipt }, null, 2));
  console.log('Installed Native + Codex: bundled Python, trusted browser input, background desktop input, and screenshot round trip passed.');
} finally {
  child?.kill();
  await fixture?.close();
  await new Promise(done => server.close(done));
  await writeFile(resolve(output, 'native.log'), log);
  await rm(run, { recursive: true, force: true });
}

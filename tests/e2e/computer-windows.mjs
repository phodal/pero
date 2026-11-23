import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { release, tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { computerEvidenceDirectory, waitFor } from '../fixtures/computer-app.mjs';

if (process.platform !== 'win32' || process.env.PERO_COMPUTER_NATIVE !== '1') {
  throw new Error('Requires PERO_COMPUTER_NATIVE=1 from an unlocked Windows desktop');
}

const root = resolve(import.meta.dirname, '../..');
const run = await mkdtemp(resolve(tmpdir(), 'pero-computer-winforms-'));
const out = computerEvidenceDirectory(root);
const fixturePath = resolve(run, 'fixture.exe');
const title = `Pero WinForms ${randomUUID().slice(0, 8)}`;
const results = { platform: { release: release(), arch: process.arch }, receipts: [], cases: [] };
const children = [];
let fixtureState, target, native, sequence = 0;

function worker(executable, args, stdin, onLine) {
  const child = spawn(executable, args, { windowsHide: executable !== fixturePath, stdio: [stdin, 'pipe', 'inherit'] });
  const owned = { child, exited: false };
  child.on('exit', code => { owned.exited = true; owned.exitCode = code; });
  child.on('close', () => { owned.closed = true; });
  child.on('error', error => { owned.error = error; });
  child.stdin?.on('error', error => { owned.error = error; });
  createInterface({ input: child.stdout }).on('line', line => onLine(JSON.parse(line)));
  children.push(owned);
  return owned;
}

function running(owned, name) {
  if (owned.error) throw owned.error;
  assert.ok(!owned.exited, `${name} exited with code ${owned.exitCode}`);
}

const state = predicate => waitFor(() => {
  running(children[0], 'WinForms fixture');
  return fixtureState && predicate(fixtureState) && fixtureState;
}, 'WinForms fixture effect');

const replies = new Map();
async function call(request) {
  running(native, 'Pero Computer Use');
  const id = `winforms-${++sequence}`;
  native.child.stdin.write(JSON.stringify({ id, thread: 'windows-acceptance', request }) + '\n');
  const response = await waitFor(() => {
    const reply = replies.get(id);
    if (!reply && (native.closed || native.error)) running(native, 'Pero Computer Use');
    return reply;
  }, `${request.operation} reply`);
  replies.delete(id);
  assert.equal(response.error, undefined, JSON.stringify(response.error));
  return response.value;
}

const observe = (wantImage = false) => call({ operation: 'observe', target, options: { want_image: wantImage } });
const element = (observation, label) => {
  const match = observation.elements.find(item => item.label === label);
  assert.ok(match, `Missing ${label} in ${JSON.stringify(observation.elements)}`);
  return { kind: 'element', element_id: match.id };
};
const click = anchor => ({ kind: 'click', anchor, button: 'left', count: 1 });
const point = (image, frame, rect, dx = 0, dy = 0) => ({
  x: Math.round((rect.x + rect.width / 2 + dx - frame.x) * image.width / frame.width),
  y: Math.round((rect.y + rect.height / 2 + dy - frame.y) * image.height / frame.height),
});

async function act(observation, input, delivery, errorCode, outcome = errorCode ? 'rejected' : 'executed') {
  const { receipt } = await call({ operation: 'act', action: {
    request_id: `effect-${sequence}`, target, observation_id: observation.id, delivery, input,
  } });
  results.receipts.push(receipt);
  assert.equal(receipt.outcome.status, outcome, JSON.stringify(receipt));
  if (errorCode) assert.equal(receipt.outcome.error.code, errorCode, JSON.stringify(receipt));
}

try {
  await mkdir(out, { recursive: true });
  const compiler = resolve(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  execFileSync(compiler, ['/nologo', '/target:exe', '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll',
    '/r:System.Web.Extensions.dll', `/out:${fixturePath}`, resolve(root, 'tests/fixtures/computer-app-windows.cs')], { stdio: 'inherit' });
  worker(fixturePath, [title], 'ignore', value => { fixtureState = value; });
  const initial = await state(value => value.foreground === 'guard');
  native = worker(process.env.PERO_COMPUTER_BINARY || resolve(root, 'target/debug/pero-computer.exe'), [], 'pipe',
    reply => replies.set(reply.id, reply));
  const { status } = await call({ operation: 'status' });
  assert.equal(status.available, true, status.message);
  const listed = await call({ operation: 'targets' });
  const fixtureTarget = listed.targets.find(item => item.title === `${title} Target`);
  const guardTarget = listed.targets.find(item => item.title === `${title} Guard`);
  assert.ok(fixtureTarget && guardTarget,
    `Both owned WinForms windows must be discoverable (target: ${Boolean(fixtureTarget)}, guard: ${Boolean(guardTarget)})`);
  assert.notDeepEqual(fixtureTarget.reference, guardTarget.reference);
  assert.equal(listed.capabilities.environment.platform, 'windows');
  target = fixtureTarget.reference;

  let sample = await observe();
  const invoke = click(element(sample.observation, 'Increment fixture'));
  await act(sample.observation, invoke, 'background');
  await act(sample.observation, invoke, 'background', 'stale_observation');
  const invokedState = await state(value => value.count === 1);
  assert.equal(invokedState.foreground, 'guard');
  assert.deepEqual(invokedState.pointer, initial.pointer);
  assert.equal(invokedState.guardCount, 0);
  results.cases.push('Background UIA invocation, exact effect, unchanged foreground and pointer, stale observation refusal');

  sample = await observe(true);
  const image = sample.observation.screenshot;
  assert.equal(image?.media_type, 'image/jpeg');
  assert.equal(sample.image?.media_type, image.media_type);
  const bytes = Buffer.from(sample.image.data, 'base64');
  assert.equal(bytes.readUInt16BE(0), 0xffd8);
  await writeFile(resolve(out, 'windows-winforms.jpg'), bytes);
  results.screenshot = { ...image, sha256: createHash('sha256').update(bytes).digest('hex') };
  const capture = [invokedState.visibleFrame, invokedState.frame].find(frame =>
    frame && image.width === frame.width && image.height === frame.height);
  assert.ok(capture, 'The screenshot geometry must match the visible or full WinForms frame');
  const buttonPixel = { kind: 'pixel', screenshot_id: image.id, point: point(image, capture, invokedState.button) };
  await act(sample.observation, click(buttonPixel), 'background', 'unsupported');
  assert.equal((await state(value => value.foreground === 'guard')).count, 1);
  results.cases.push('JPEG tied to the owned window and background pixel refusal');

  sample = await observe(true);
  await act(sample.observation, { kind: 'move', anchor: {
    kind: 'pixel', screenshot_id: sample.observation.screenshot.id,
    point: { x: image.width - 20, y: 65 },
  } }, 'foreground', 'target_unavailable');
  assert.deepEqual((await state(value => value.foreground === 'guard')).pointer, initial.pointer);
  results.cases.push('Pointer move refused when an overlapping window in the same process owns the pixel');

  sample = await observe(true);
  await act(sample.observation, click({ ...buttonPixel, screenshot_id: sample.observation.screenshot.id }), 'foreground');
  const clicked = await state(value => value.count === 2 && value.foreground === 'target');
  assert.ok(Math.abs(clicked.pointer.x - (clicked.button.x + clicked.button.width / 2)) <= 2);
  assert.ok(Math.abs(clicked.pointer.y - (clicked.button.y + clicked.button.height / 2)) <= 2);
  sample = await observe();
  await act(sample.observation, click(element(sample.observation, 'Fixture Unicode text')), 'foreground');
  await state(value => value.fieldFocused);
  sample = await observe();
  const text = 'Pero 你好 🌱';
  await act(sample.observation, { kind: 'type_text', anchor: element(sample.observation, 'Fixture Unicode text'), text: text + '!' }, 'foreground');
  await state(value => value.text === text + '!');
  sample = await observe();
  await act(sample.observation, { kind: 'press_key', anchor: element(sample.observation, 'Fixture Unicode text'), keys: ['Backspace'] }, 'foreground');
  await state(value => value.text === text);
  results.cases.push('Foreground pixel and element click, Unicode text and Backspace in the observed edit control');

  sample = await observe();
  await act(sample.observation, { kind: 'scroll', anchor: element(sample.observation, 'Fixture scrolling list'), delta_x: 0, delta_y: 360 }, 'foreground');
  const scrolled = await state(value => value.topRow > 0);
  sample = await observe(true);
  const screenshot = sample.observation.screenshot;
  await act(sample.observation, { kind: 'drag', screenshot_id: screenshot.id,
    from: point(screenshot, capture, scrolled.square), to: point(screenshot, capture, scrolled.square, 60, 40) }, 'foreground');
  const final = await state(value => Math.abs(value.squarePosition.x - scrolled.squarePosition.x - 60) <= 3
    && Math.abs(value.squarePosition.y - scrolled.squarePosition.y - 40) <= 3 && value.dragReleases === 1);
  assert.equal(final.dragPresses, 1);
  assert.ok(final.dragMoves >= 1);
  assert.equal(final.count, 2);
  assert.equal(final.guardCount, 0);
  results.cases.push('Actual list scrolling and 60 × 40 pixel drag verified by WinForms');

  const canvasPixel = (observation, dx) => {
    const screenshot = observation.screenshot;
    return { kind: 'pixel', screenshot_id: screenshot.id, point: point(screenshot, capture, final.canvas, dx, -55) };
  };
  const pointerAtCanvas = (value, dx) => Math.abs(value.pointer.x - (final.canvas.x + final.canvas.width / 2 + dx)) <= 2
    && Math.abs(value.pointer.y - (final.canvas.y + final.canvas.height / 2 - 55)) <= 2;
  sample = await observe(true);
  await act(sample.observation, { kind: 'move', anchor: canvasPixel(sample.observation, -50) }, 'foreground');
  assert.equal((await state(value => pointerAtCanvas(value, -50))).holdPresses, 0);
  sample = await observe(true);
  const hoverStarted = performance.now();
  await act(sample.observation, { kind: 'hover', anchor: canvasPixel(sample.observation, 30), dwell_ms: 300 }, 'foreground');
  assert.ok(performance.now() - hoverStarted >= 300);
  const hovered = await state(value => pointerAtCanvas(value, 30));
  assert.equal(hovered.holdPresses, 0);
  assert.equal(hovered.count, 2);
  results.cases.push('Move and timed hover reach separate owned points without a button press');

  sample = await observe(true);
  await act(sample.observation, { kind: 'hold', anchor: canvasPixel(sample.observation, 30), button: 'left', hold_ms: 400 }, 'foreground');
  const held = await state(value => value.holdReleases === 1);
  assert.equal(held.holdPresses, 1);
  assert.equal(held.heldButton, 'Left');
  assert.ok(held.heldMilliseconds >= 375);

  sample = await observe(true);
  const pending = act(sample.observation, { kind: 'hold', anchor: canvasPixel(sample.observation, 30), button: 'right', hold_ms: 9_000 },
    'foreground', 'cancelled', 'unknown');
  await Promise.race([
    state(value => value.holdPresses === 2 && value.holdReleases === 1),
    pending.then(() => assert.fail('Hold ended before the fixture observed the press')),
  ]);
  native.child.stdin.end();
  await pending;
  const cancelled = await state(value => value.holdReleases === 2);
  assert.equal(cancelled.holdPresses, 2);
  assert.equal(cancelled.heldButton, 'Right');
  assert.ok(cancelled.heldMilliseconds < 9_000);
  assert.equal(cancelled.guardCount, 0);
  results.cases.push('One release per hold, including when the owning connection closes mid-hold');
  results.passed = true;
  console.log(`Windows WinForms passed (${results.cases.length} scenarios, ${results.receipts.length} receipts).`);
} catch (error) {
  results.passed = false;
  results.error = error.message;
  throw error;
} finally {
  results.effects = fixtureState;
  try {
    for (const { child, exited } of children.reverse()) {
      if (child.pid && !exited) {
        const closed = once(child, 'exit');
        child.kill();
        await closed;
      }
    }
    await rm(run, { recursive: true, force: true });
    results.cleanedUp = true;
  } finally {
    await writeFile(resolve(out, 'windows-winforms.json'), JSON.stringify(results, null, 2));
  }
}

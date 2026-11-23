// Exercises actual Blender UI through the managed desktop's X11 driver.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { waitFor } from '../fixtures/computer-app.mjs';

const { jpegjs } = createRequire(import.meta.url)('playwright-core/lib/utilsBundle');
const root = resolve(import.meta.dirname, '../..');
const runner = resolve(root, 'environments/linux-desktop/run.sh');
const output = resolve(root, 'test-results/linux-desktop-blender');
const guest = 'pero-blender-test-' + randomUUID();
const image = process.env.PERO_REMOTE_DESKTOP_IMAGE || 'pero/linux-desktop:blender';
const context = process.env.PERO_REMOTE_DESKTOP_CONTEXT || 'colima-pero-remote-desktop';
const env = { ...process.env, PERO_REMOTE_DESKTOP_IMAGE: image, PERO_REMOTE_DESKTOP_CONTAINER: guest };
const command = promisify(execFile);
const docker = async (...args) => (await command(process.env.PERO_REMOTE_DESKTOP_DOCKER || 'docker',
  ['--context', context, ...args])).stdout.trim();
const run = async action => command(runner, [action], { env });
const sha256 = value => createHash('sha256').update(value).digest('hex');
const blend = '/home/pero/untitled.blend';
const obj = '/home/pero/untitled.obj';

const captures = {};
const receipts = [];
let worker, started = false, sequence = 0, lastFrame, result;
await mkdir(output, { recursive: true });
await Promise.all(['result.json', 'failure.jpg'].map(name => rm(resolve(output, name), { force: true })));

try {
  await run('start');
  started = true;
  await waitFor(() => run('probe').then(() => true, () => false), 'managed desktop readiness', 30_000);
  assert.equal(await docker('port', guest), '');
  const mode = await docker('inspect', '--format', '{{.HostConfig.NetworkMode}}', guest);
  assert.equal(mode, 'none');
  worker = spawn(runner, ['computer'], { env, stdio: ['pipe', 'pipe', 'inherit'] });
  const responses = new Map();
  createInterface({ input: worker.stdout }).on('line', line => {
    const response = JSON.parse(line);
    responses.set(response.id, response);
  });
  const call = async request => {
    const id = 'blender-' + ++sequence;
    worker.stdin.write(JSON.stringify({ id, thread: 'blender-acceptance', request }) + '\n');
    const response = await waitFor(() => responses.get(id), 'driver response for ' + id);
    responses.delete(id);
    assert(!response.error, JSON.stringify(response));
    return response.value;
  };
  const targets = async () => (await call({ operation: 'targets' })).targets;
  const main = /^(?!Blender File View$).*Blender/;
  const file = /^Blender File View$/;
  const shot = async pattern => {
    const target = (await targets()).find(item => pattern.test(item.title));
    if (!target) return;
    const { observation, image } = await call({ operation: 'observe', target: target.reference });
    const bytes = Buffer.from(image.data, 'base64');
    lastFrame = bytes;
    const picture = jpegjs.decode(bytes);
    const rgb = (x, y) => picture.data.subarray((y * picture.width + x) * 4, (y * picture.width + x) * 4 + 3);
    return { target, observation, bytes, width: picture.width, height: picture.height,
      dark(x, y) { return Math.max(...rgb(x, y)) < 35; },
      blue(x, y) { const [r, g, b] = rgb(x, y); return b - r > 35 && g - r > 14; },
      orange(x, y) { const [r, g, b] = rgb(x, y); return r > 150 && r - g > 40 && g - b > 50; } };
  };
  const frame = async (name, pattern, ready) => {
    const value = await waitFor(async () => {
      const candidate = await shot(pattern);
      return candidate && ready(candidate) && candidate;
    }, name, 25_000);
    const path = resolve(output, name + '.jpg');
    await writeFile(path, value.bytes);
    captures[name] = { sha256: sha256(value.bytes), width: value.width, height: value.height };
    return value;
  };
  const scene = () => waitFor(() => shot(main), 'Blender scene window');
  const act = async (basis, label, makeInput) => {
    const screenshotId = basis.observation.screenshot.id;
    const pixel = (x, y) => ({ kind: 'pixel', screenshot_id: screenshotId, point: { x, y } });
    const action = { request_id: label, target: basis.target.reference,
      observation_id: basis.observation.id, delivery: 'foreground', input: makeInput(pixel, screenshotId) };
    const { receipt } = await call({ operation: 'act', action });
    assert.equal(receipt.outcome.status, 'executed', JSON.stringify(receipt));
    receipts.push({ label, receipt });
    return action;
  };
  const click = (basis, label, x, y) =>
    act(basis, label, pixel => ({ kind: 'click', anchor: pixel(x, y), button: 'left', count: 1 }));
  const key = (basis, label, x, y, keys) =>
    act(basis, label, pixel => ({ kind: 'press_key', anchor: pixel(x, y), keys }));
  const drag = (basis, label, end) =>
    act(basis, label, (_, screenshot_id) => ({ kind: 'drag', screenshot_id,
      from: { x: 1190, y: 410 }, to: { x: end, y: 410 } }));

  const status = await call({ operation: 'status' });
  assert.equal(status.status.environment.platform, 'linux');
  assert.equal(status.status.environment.display, 'x11');
  const setup = await frame('quick-setup', main, img =>
    img.width === 1280 && img.height === 781 && img.blue(700, 200) && !img.blue(760, 604));
  await key(setup, 'finish-setup', 798, 604, ['Enter']);
  const startup = await frame('startup', main, img => !img.blue(700, 200) || img.blue(760, 604));
  if (startup.blue(700, 200)) await click(startup, 'dismiss-startup', 350, 500);
  const workspace = await frame('workspace', main, img => !img.blue(700, 200) && !img.dark(425, 450));
  await click(workspace, 'select-cube', 528, 365);
  const original = await frame('original-scene', main, img => img.orange(474, 336));
  const edit = await drag(original, 'move-cube-x', 1210);
  const stale = (await call({ operation: 'act', action: { ...edit, request_id: 'stale-edit' } })).receipt;
  assert.equal(stale.outcome.error.code, 'stale_observation');
  await key(await scene(), 'open-save-dialog', 528, 365, ['Control', 'Shift', 's']);
  const save = await frame('save-dialog', file, img => img.width === 1104 && img.height === 625 && img.blue(1030, 606));
  await click(save, 'save-scene', 1030, 603);
  const stored = await frame('saved-scene', main, img => img.target.title === 'Blender [' + blend + ']' &&
    !img.dark(425, 450) && !img.blue(700, 200));
  const sourceHash = (await docker('exec', guest, 'sha256sum', blend)).split(' ')[0];
  const readback = await docker('exec', guest, 'blender', '-b', blend, '-t', '1', '--python-expr',
    'import bpy; print("PERO_CUBE_X", bpy.data.objects["Cube"].location.x)');
  const cubeX = Number(readback.match(/PERO_CUBE_X ([^\n]+)/)?.[1]);
  assert(Number.isFinite(cubeX) && Math.abs(cubeX) > 0.001, readback);

  await drag(stored, 'create-unsaved-change', 1230);
  await key(await scene(), 'close-with-unsaved-change', 530, 365, ['Control', 'q']);
  const confirmation = await frame('discard-dialog', main, img => img.dark(500, 365) && img.blue(790, 426));
  await click(confirmation, 'discard-unsaved-change', 548, 425);
  await waitFor(async () => !(await targets()).some(item => main.test(item.title)), 'Blender window closed');
  assert.equal((await docker('exec', guest, 'sha256sum', blend)).split(' ')[0], sourceHash);
  await docker('exec', '-d', guest, 'blender', blend);
  const reopened = await frame('reopened-scene', main, img => img.target.title === 'Blender [' + blend + ']' &&
    (img.orange(474, 336) || img.orange(475, 345)));
  assert.notEqual(reopened.target.reference.target_id, original.target.reference.target_id);

  await click(reopened, 'open-file-menu', 46, 12);
  const fileMenu = await frame('file-menu', main, img => img.dark(180, 96));
  await act(fileMenu, 'reveal-export-menu', pixel => ({ kind: 'hover', anchor: pixel(95, 316), dwell_ms: 400 }));
  const exportMenu = await frame('export-menu', main, img => img.dark(250, 305) && img.dark(350, 350));
  await click(exportMenu, 'choose-wavefront-obj', 323, 358);
  const exportDialog = await frame('export-dialog', file, img => img.blue(1030, 606));
  await click(exportDialog, 'export-scene', 1030, 603);
  await waitFor(() => docker('exec', guest, 'test', '-s', obj).then(() => true, () => false), 'exported OBJ');
  const model = await docker('exec', guest, 'cat', obj);
  const vertices = [...model.matchAll(/^v (\S+) (\S+) (\S+)$/gm)].map(match => match.slice(1).map(Number));
  assert.equal(vertices.length, 8);
  const centroidX = vertices.reduce((sum, coordinates) => sum + coordinates[0], 0) / vertices.length;
  assert(Math.abs(centroidX - cubeX) < 0.00001, JSON.stringify({ cubeX, centroidX }));
  assert.equal((await docker('exec', guest, 'sha256sum', blend)).split(' ')[0], sourceHash);
  await docker('cp', guest + ':' + blend, resolve(output, 'untitled.blend'));
  await docker('cp', guest + ':' + obj, resolve(output, 'untitled.obj'));
  await docker('cp', guest + ':/home/pero/untitled.mtl', resolve(output, 'untitled.mtl'));
  const modelHash = sha256(await readFile(resolve(output, 'untitled.obj')));
  result = {
    passed: true, image, platform: await docker('exec', guest, 'uname', '-m'), blender: readback.match(/Blender [^\n]+/)?.[0],
    cubeX, centroidX, sourceHash, modelHash, captures, receipts, stale: stale.outcome.error.code,
  };
} catch (error) {
  if (lastFrame) await writeFile(resolve(output, 'failure.jpg'), lastFrame);
  throw error;
} finally {
  if (worker && worker.exitCode === null) {
    const exited = once(worker, 'exit');
    worker.stdin.end();
    await exited;
  }
  if (started) await run('stop');
}
await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
console.log('Linux Blender saved and reopened an edited scene, exported matching OBJ geometry and preserved the source.');

// Opt-in macOS acceptance with only test-owned AppKit windows.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { computerFixture } from '../fixtures/computer-app.mjs';

assert(process.platform === 'darwin' && process.env.PERO_COMPUTER_NATIVE === '1',
  'Run with PERO_COMPUTER_NATIVE=1 and an authorized macOS Computer Use helper.');
const root = resolve(import.meta.dirname, '../..');
const run = await mkdtemp(resolve(tmpdir(), 'pero-computer-appshot-'));
const bridge = resolve(run, 'client.mjs');
let client, fixture, guard;
try {
  await build({
    entryPoints: [resolve(root, 'desktop/src/main/computer-client.ts')], outfile: bridge,
    bundle: true, platform: 'node', format: 'esm',
  });
  const { ComputerClient } = await import(bridge);
  client = new ComputerClient(process.env.PERO_COMPUTER_BINARY || resolve(root, 'target/debug/pero-computer'));
  fixture = await computerFixture(root, run, false, { name: 'PeroAppshotWindow', background: true });
  guard = await computerFixture(root, run, true, { name: 'PeroAppshotOtherWindow', background: true });
  await fixture.activate();
  const capture = () => client.appshot(fixture.pid, AbortSignal.timeout(10_000));
  const shot = await capture();
  assert.equal(shot.title, 'Pero Computer Fixture');
  assert.match(shot.text, /(?:Increment|Count: 0)/);
  assert.equal(shot.image.media_type, 'image/jpeg');
  assert.equal(Buffer.from(shot.image.data, 'base64').readUInt16BE(), 0xffd8);
  assert.equal('target' in shot || 'observation' in shot, false);

  await guard.activate();
  await assert.rejects(capture, error => error.detail?.code === 'target_unavailable');
  await fixture.activate();
  await fixture.command('secure');
  await assert.rejects(capture, error => error.detail?.code === 'permission_required' && /secure input/.test(error.message));
  console.log('Appshot captured the focused test window and readable text. A changed app or secure control withheld capture.');
} finally {
  await client?.stop();
  await fixture?.close();
  await guard?.close();
  await rm(run, { recursive: true, force: true });
}

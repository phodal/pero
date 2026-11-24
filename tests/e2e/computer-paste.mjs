// Opt-in: inserts only harmless text into an owned native rich-text view.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';
import { computerFixture, waitFor } from '../fixtures/computer-app.mjs';

if (process.platform !== 'darwin' || process.env.PERO_COMPUTER_NATIVE !== '1')
  throw new Error('Run with PERO_COMPUTER_NATIVE=1 on macOS');
const root = resolve(import.meta.dirname, '../..');
const temp = await mkdtemp(resolve(tmpdir(), 'pero-native-paste-'));
await build({ entryPoints: [resolve(root, 'desktop/src/main/computer.ts')], bundle: true, platform: 'node',
  format: 'esm', outfile: resolve(temp, 'computer.mjs') });
const { DesktopComputer } = await import(resolve(temp, 'computer.mjs'));
const desktop = new DesktopComputer(process.env.PERO_COMPUTER_BINARY || resolve(root, 'target/debug/pero-computer'),
  resolve(temp, 'journal'), () => {});
const signal = new AbortController().signal;
const call = request => desktop.call('rich-paste', request, signal);
let fixture;
try {
  fixture = await computerFixture(root, temp, false, { name: 'PeroRichEditor',
    source: 'tests/fixtures/computer-rich-text.swift' });
  const application = 'dev.pero.peroricheditor';
  await desktop.restore(true, [application]);
  const target = await waitFor(async () => (await call({ operation: 'targets' })).targets
    .find(item => item.application_id === application)?.reference, 'rich editor window');
  const { observation: opening } = await call({ operation: 'observe', target, options: { want_image: false } });
  const { receipt } = await call({ operation: 'act', action: { request_id: 'raise-rich-editor', target,
    observation_id: opening.id, delivery: 'foreground', input: { kind: 'focus_window' },
  } });
  assert.equal(receipt.outcome.status, 'executed', JSON.stringify(receipt.outcome));
  await waitFor(async () => (await fixture.state()).frontmostPID === fixture.pid, 'frontmost rich editor');
  await fixture.command('clipboard');
  const previous = (await fixture.state()).clipboard;
  for (const [format, text, expected, bold] of [
    ['text', ' Plain 🌱', 'Plain 🌱', ''],
    ['html', '<b>HTML marker</b><span> normal</span>', 'HTML marker normal', 'HTML marker'],
    ['md', '**Markdown marker** end', 'Markdown marker end', 'Markdown marker'],
  ]) {
    await fixture.command('clear');
    const { observation } = await call({ operation: 'observe', target,
      options: { want_image: false, disable_diffing: true } });
    const control = observation.elements.find(item => item.label === 'Rich editor');
    assert.ok(control?.actions.includes('paste'));
    const { receipt } = await call({ operation: 'act', action: { request_id: `paste-${format}`, target,
      observation_id: observation.id, delivery: 'foreground',
      input: { kind: 'paste', anchor: { kind: 'element', element_id: control.id }, format, text },
    } });
    if (receipt.outcome.status !== 'executed') {
      const editor = await fixture.state();
      assert.fail(JSON.stringify({ format, outcome: receipt.outcome, text: editor.text, keyCode: editor.keyCode,
        keyModifiers: editor.keyModifiers, pasteCount: editor.pasteCount, readableTypes: editor.readableTypes }));
    }
    await waitFor(async () => (await fixture.state()).text.includes(expected), `${format} paste effect`, 1500)
      .catch(async error => {
        const {text, keyCode, keyModifiers, pasteCount, readableTypes} = await fixture.state();
        assert.fail(JSON.stringify({format, error: error.message, text, keyCode, keyModifiers, pasteCount, readableTypes}));
      });
    const styles = (await fixture.state()).bold;
    if (bold) assert.ok(styles.includes(bold)); else assert.ok(!styles.includes(expected));
    await fixture.command('clipboard');
    assert.ok(isDeepStrictEqual((await fixture.state()).clipboard, previous), 'Original clipboard representations were restored');
  }
  await fixture.command('ignore_paste');
  const { observation } = await call({ operation: 'observe', target,
    options: { want_image: false, disable_diffing: true } });
  const control = observation.elements.find(item => item.label === 'Rich editor');
  const pasteCount = (await fixture.state()).pasteCount;
  const pending = call({ operation: 'act', action: { request_id: 'cancel-paste', target,
    observation_id: observation.id, delivery: 'foreground',
    input: { kind: 'paste', anchor: { kind: 'element', element_id: control.id }, text: 'Ignored paste' },
  } });
  await waitFor(async () => (await fixture.state()).pasteCount > pasteCount, 'paste command before cancellation');
  await desktop.endThread('rich-paste');
  assert.equal((await pending).receipt.outcome.status, 'unknown');
  await fixture.command('clipboard');
  assert.ok(isDeepStrictEqual((await fixture.state()).clipboard, previous), 'Cancellation restored the original clipboard');
  console.log('Native paste passed: HTML and Markdown formatting, plain Unicode, and clipboard restoration after completion and cancellation.');

} finally {
  await desktop.stop();
  await fixture?.close();
  await rm(temp, { recursive: true, force: true });
}

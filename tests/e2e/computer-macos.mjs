// Opt-in native effects: only temporary owned windows are controlled.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { computerFixture, computerEvidenceDirectory, waitFor } from '../fixtures/computer-app.mjs';

if (process.platform !== 'darwin' || process.env.PERO_COMPUTER_NATIVE !== '1') throw new Error('Requires PERO_COMPUTER_NATIVE=1 on an interactive macOS desktop');
const root = resolve(import.meta.dirname, '../..');
const run = await mkdtemp(resolve(root, 'target/computer-macos-'));
const out = computerEvidenceDirectory(root); await mkdir(out, { recursive: true });
await build({ entryPoints: [resolve(root, 'desktop/src/main/computer.ts')], outfile: resolve(run, 'computer.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { DesktopComputer } = await import(resolve(run, 'computer.mjs'));
const desktop = new DesktopComputer(resolve(root, 'target/debug/pero-computer'), resolve(run, 'evidence'), () => {});
const signal = new AbortController().signal;
const call = request => desktop.call('macos-capabilities', request, signal);
let fixture, guard, target, sequence = 0;
const foreground = process.env.PERO_COMPUTER_FOREGROUND === '1';
const results = { foreground, receipts: [], observations: [], cases: [] };
const observe = async options => {
  const result = await call({ operation: 'observe', target, ...(options ? { options } : {}) });
  results.observations.push(result.observation);
  if (result.image) await writeFile(resolve(out, 'macos-latest.jpg'), Buffer.from(result.image.data, 'base64'));
  return result.observation;
};
const act = async (observation, input, delivery = 'background', expected = 'executed') => {
  const result = await call({ operation: 'act', action: { request_id: `macos-${++sequence}`, target, observation_id: observation.id, delivery, input } });
  results.receipts.push(result.receipt);
  assert.equal(result.receipt.outcome.status, expected, JSON.stringify(result.receipt));
  return result.receipt.outcome;
};
const element = (observation, label) => {
  const control = observation.elements.find(e => e.label === label);
  assert.ok(control, `Missing ${label}: ${JSON.stringify(observation.elements)}`); return control;
};
try {
  fixture = await computerFixture(root, run, false, { background: !foreground }); guard = await computerFixture(root, run, true, { background: !foreground });
  if (foreground) await guard.activate(); await desktop.restore(true);
  const discovery = await call({ operation: 'targets' });
  const selected = discovery.targets.find(t => t.title === 'Pero Computer Fixture'); assert.ok(selected);
  target = selected.reference;
  assert.equal(selected.application_id, 'dev.pero.perocomputerfixture');
  const opened = await call({ operation: 'open', application: { kind: 'bundle_id', bundle_id: selected.application_id } });
  assert.deepEqual(opened.target.reference, target);
  const initialForeground = (await fixture.state()).foregroundPID;
  const initialActivations = (await fixture.state()).activations ?? 0;
  let o = await observe({ want_image: false }); assert.equal(o.screenshot, undefined);
  let field = element(o, 'Fixture text'); assert.equal(field.state.value_settable, true);
  for (const value of ['按值替换 🌱', '']) {
    const outcome = await act(o, { kind: 'set_value', element_id: field.id, value });
    assert.equal(outcome.execution.route, 'semantic');
    await waitFor(async () => (await fixture.state()).text === value, 'value replacement/clear');
    o = await observe({ want_image: false }); field = element(o, 'Fixture text');
  }
  assert.equal((await guard.state()).foregroundPID, initialForeground);
  assert.equal((await fixture.state()).activations ?? 0, initialActivations);
  results.cases.push('Unicode replacement and empty clear without activating target');
  await fixture.command('readonly'); o = await observe({ want_image: false }); field = element(o, 'Fixture text');
  assert.equal(field.state.value_settable, false); assert.ok(!field.actions.includes('set_value'));
  await act(o, { kind: 'set_value', element_id: field.id, value: 'must not write' }, 'background', 'rejected');
  assert.equal((await fixture.state()).text, ''); await fixture.command('editable');
  await fixture.command('disabled'); o = await observe({ want_image: false }); field = element(o, 'Fixture text');
  assert.equal(field.state.enabled, false); assert.deepEqual(field.actions, []);
  await fixture.command('enabled');
  o = await observe(); const button = element(o, 'Increment'); assert.ok(button.semantic_actions.includes('press'));
  const press = await act(o, { kind: 'perform_action', element_id: button.id, action: 'press' });
  assert.deepEqual(press.execution, { route: 'semantic', semantic_action: 'press' });
  await waitFor(async () => (await fixture.state()).count === 1, 'AXPress');
  o = await observe();
  await act(o, { kind: 'perform_action', element_id: element(o, 'Increment').id, action: 'decrement' }, 'background', 'rejected');
  results.cases.push('Native writable/enabled facts and finite semantic action admission');
  o = await observe({ max_nodes: 1, max_depth: 1 }); assert.equal(o.truncated, true); assert.equal(o.elements.length, 1); assert.equal(o.screenshot, undefined);
  const previous = o;
  o = await observe({ root: { observation_id: previous.id, element_id: previous.elements[0].id }, want_image: false });
  assert.notEqual(o.id, previous.id); assert.ok(o.elements.some(e => e.label === 'Fixture text'));
  await act(previous, { kind: 'set_value', element_id: field.id, value: 'stale' }, 'background', 'rejected');
  await assert.rejects(() => observe({ root: { observation_id: o.id, element_id: o.elements[0].id } }), e => e.detail?.code === 'stale_observation');
  results.cases.push('Bounded subtree expansion renews and consumes observation identities');
  await fixture.command('secure'); o = await observe();
  const secure = element(o, 'Fixture password'); assert.equal(secure.state.secure, true); assert.equal(secure.value, undefined); assert.deepEqual(secure.actions, []); assert.equal(o.screenshot, undefined);
  await fixture.command('remove_secure');
  results.cases.push('Secure control values, actions and entire-window image suppressed');

  // Element centers do not depend on a screenshot's backing scale.
  for (const delivery of (foreground ? ['background', 'foreground'] : ['background'])) {
    if (delivery === 'foreground') await fixture.activate(); else if (foreground) await guard.activate();
    for (const button of ['left', 'right', 'middle']) for (const count of [1, 2, 3]) {
      o = await observe(); const canvas = element(o, 'Gesture canvas');
      const key = `${button}Down`, before = (await fixture.state()).mouseEvents[key] ?? 0;
      const outcome = await act(o, { kind: 'click', anchor: { kind: 'element', element_id: canvas.id }, button, count }, delivery);
      assert.equal(outcome.execution.route, delivery === 'foreground' ? 'foreground_event' : 'window_event');
      await waitFor(async () => {
        const events = (await fixture.state()).mouseEvents;
        return events[key] === before + count && events[`${button}Up`] === before + count;
      }, `${delivery} ${button} ${count}`);
      const effects = await fixture.state();
      assert.equal(effects.mouseEvents[`${button}Up`], effects.mouseEvents[key]);
      assert.equal(effects.mouseEvents[`${button}DownCount`], count);
    }
  }
  results.cases.push(`${foreground ? 18 : 9} element mouse button/count/delivery combinations, exact down/up and clickCount`);
  if (foreground) await guard.activate();
  o = await observe(); const canvas = element(o, 'Gesture canvas');
  const hoverBefore = (await fixture.state()).hover;
  const pointerBefore = (await fixture.state()).pointer;
  await act(o, { kind: 'move', anchor: { kind: 'element', element_id: canvas.id } });
  await waitFor(async () => (await fixture.state()).hover > hoverBefore, 'background hover callback');
  assert.deepEqual((await fixture.state()).pointer, pointerBefore);
  results.cases.push('Background move/hover preserves real cursor');
  if (foreground) {
    o = await observe();
    await act(o, { kind: 'focus_window' }, 'foreground');
    await waitFor(async () => {
      const current = await fixture.state();
      return current.foregroundPID === fixture.pid && current.keyWindow;
    }, 'focus_window activation and selected key window');
    o = await observe();
    assert.ok(o.screenshot);
    await act(o, { kind: 'move', anchor: { kind: 'pixel', screenshot_id: o.screenshot.id, point: { x: Math.round(o.screenshot.width * 0.15), y: Math.round(o.screenshot.height * 0.65) } } }, 'foreground');
    await waitFor(async () => JSON.stringify((await fixture.state()).pointer) !== JSON.stringify(pointerBefore), 'foreground pointer move');
  }
  o = await observe(); assert.ok(o.screenshot);
  const imagePoint = (x, y) => ({ x: Math.round(x / 600 * o.screenshot.width), y: Math.round(y / 472 * o.screenshot.height) });
  const beforeDrag = (await fixture.state()).rectangle;
  await act(o, { kind: 'drag', screenshot_id: o.screenshot.id, from: imagePoint(25 + beforeDrag.x + 20, 142 + beforeDrag.y + 20), to: imagePoint(25 + beforeDrag.x + 100, 142 + beforeDrag.y + 60) });
  await waitFor(async () => { const p = (await fixture.state()).rectangle; return Math.abs(p.x - beforeDrag.x - 80) <= 2 && Math.abs(p.y - beforeDrag.y - 40) <= 2; }, 'actual dragged object displacement');
  results.cases.push('Dragging changes object position by 80 x 40 logical points');
  await fixture.command('overlay'); o = await observe();
  if (foreground) {
    const covered = await act(o, { kind: 'click', anchor: { kind: 'element', element_id: element(o, 'Gesture canvas').id }, button: 'left', count: 1 }, 'foreground', 'unknown');
    assert.equal(covered.error.code, 'target_unavailable'); assert.equal((await fixture.state()).overlayClicks, 0);
  }
  o = await observe(); const before = (await fixture.state()).clicks;
  const middleBeforeOverlay = (await fixture.state()).mouseEvents.middleUp;
  await act(o, { kind: 'click', anchor: { kind: 'element', element_id: element(o, 'Gesture canvas').id }, button: 'middle', count: 1 });
  await waitFor(async () => (await fixture.state()).mouseEvents.middleUp === middleBeforeOverlay + 1, 'middle click delivered to covered selected window');
  assert.equal((await fixture.state()).clicks, before); assert.equal((await fixture.state()).overlayClicks, 0);
  await fixture.command('hide_overlay');
  results.cases.push('Same-process overlay preserves selected background window; foreground refusal checked only with foreground opt-in');
  o = await observe(); await fixture.command('move');
  await act(o, { kind: 'perform_action', element_id: element(o, 'Increment').id, action: 'press' }, 'background', 'rejected');
  assert.equal((await fixture.state()).count, 1);
  assert.equal((await guard.state()).count, 0); assert.equal((await guard.state()).clicks, 0); assert.equal((await guard.state()).text, '');
  o = await observe();
  let middle = (await fixture.state()).mouseEvents.middleUp;
  await act(o, { kind: 'long_press', anchor: { kind: 'element', element_id: element(o, 'Gesture canvas').id }, button: 'middle', hold_ms: 160 });
  await waitFor(async () => (await fixture.state()).mouseEvents.middleUp === middle + 1, 'long press button up');
  assert.ok((await fixture.state()).holdDurations.middle >= 0.14);
  o = await observe(); middle = (await fixture.state()).mouseEvents.middleUp;
  const controller = new AbortController();
  const hold = desktop.call('macos-capabilities', { operation: 'act', action: { request_id: 'cancel-held-input', target, observation_id: o.id, delivery: foreground ? 'foreground' : 'background', input: { kind: 'long_press', anchor: { kind: 'element', element_id: element(o, 'Gesture canvas').id }, button: 'middle', hold_ms: 10000 } } }, controller.signal).catch(e => e);
  await waitFor(async () => (await fixture.state()).mouseEvents.middleDown === middle + 1, 'held button before cancellation');
  controller.abort(); await hold; await desktop.stop();
  await waitFor(async () => (await fixture.state()).mouseEvents.middleUp === middle + 1, 'button released when connection cancelled');
  const interrupted = await call({ operation: 'receipt', request_id: 'cancel-held-input' });
  assert.equal(interrupted.receipt.outcome.status, 'unknown');
  assert.ok((await fixture.state()).holdDurations.middle < 2);
  results.cases.push('Timed long press and cancellation release button before worker exit, preserving unknown receipt');
  results.passed = true; results.effects = await fixture.state(); results.guard = await guard.state();
  results.platform = { os: execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(), arch: process.arch };
  console.log(`macOS native capabilities passed (${results.cases.length} scenarios, ${results.receipts.length} receipts).`);
} catch (error) {
  results.passed = false; results.error = String(error); results.effects = await fixture?.state(); throw error;
} finally {
  await writeFile(resolve(out, 'macos-capabilities.json'), JSON.stringify(results, null, 2));
  await desktop.stop(); await guard?.close(); await fixture?.close();
}

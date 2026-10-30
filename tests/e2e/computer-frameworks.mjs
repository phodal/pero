// Real SwiftUI and Electron applications; all inputs travel through the native worker.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { computerFixture, computerEvidenceDirectory, waitFor } from '../fixtures/computer-app.mjs';
import { assertDesktopAccess } from './electron.mjs';
if (process.platform !== 'darwin' || process.env.PERO_COMPUTER_NATIVE !== '1') throw new Error('Requires opt-in native macOS');
assertDesktopAccess();
const root = resolve(import.meta.dirname, '../..');
const run = await mkdtemp(resolve(root, 'target/computer-frameworks-'));
const out = computerEvidenceDirectory(root); await mkdir(out, { recursive: true });
await build({ entryPoints: [resolve(root, 'desktop/src/main/computer.ts')], outfile: resolve(run, 'computer.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { DesktopComputer } = await import(resolve(run, 'computer.mjs'));
const desktop = new DesktopComputer(resolve(root, 'target/debug/pero-computer'), resolve(run, 'evidence'), () => {});
const call = request => desktop.call('framework-acceptance', request, new AbortController().signal);
let fixture, child; const results = [];
try {
  await desktop.restore(true);
  for (const framework of ['SwiftUI', 'Electron']) {
    if (framework === 'SwiftUI') fixture = await computerFixture(root, run, false, { background: true, source: 'tests/fixtures/computer-swiftui.swift', name: 'PeroSwiftUIFixture' });
    else {
      const output = resolve(run, 'electron-effects.json');
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
      child = spawn(resolve(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [resolve(root, 'tests/fixtures/computer-electron.cjs'), output], { env, stdio: ['ignore', 'ignore', 'pipe'] });
      child.stderr.on('data', () => {});
      fixture = { state: async () => JSON.parse(await readFile(output, 'utf8')), close: async () => { child.kill('SIGTERM'); }, pid: await waitFor(async () => { try { return JSON.parse(await readFile(output, 'utf8')).pid; } catch { return false; } }, 'Electron readiness') };
    }
    const target = await waitFor(async () => (await call({ operation: 'targets' })).targets.find(t => t.title === `Pero ${framework} Fixture`)?.reference, `${framework} target`);
    const observe = async () => (await call({ operation: 'observe', target, options: { want_image: false } })).observation;
    let o = await waitFor(async () => { const value = await observe(); return value.elements.some(e => e.label === 'Framework increment') ? value : false; }, `${framework} native AX controls`);
    const receipts = [];
    const act = async input => {
      const value = await call({ operation: 'act', action: { request_id: `${framework}-${receipts.length}`, target, observation_id: o.id, delivery: 'background', input } });
      receipts.push(value.receipt); assert.equal(value.receipt.outcome.status, 'executed', JSON.stringify(value));
    };
    await act({ kind: 'perform_action', element_id: o.elements.find(e => e.label === 'Framework increment').id, action: 'press' });
    await waitFor(async () => (await fixture.state()).count === 1, `${framework} native button effect`);
    for (const text of ['Native 跨框架 🌱', '']) {
      o = await observe(); const field = o.elements.find(e => e.label === 'Framework text' && e.actions.includes('set_value')); assert.ok(field, JSON.stringify(o.elements));
      await act({ kind: 'set_value', element_id: field.id, value: text });
      await waitFor(async () => (await fixture.state()).text === text, `${framework} native replacement effect`);
    }
    results.push({ framework, passed: true, effects: await fixture.state(), receipts });
    await fixture.close(); fixture = undefined;
  }
  console.log('Native AX effects passed in real SwiftUI and Electron windows.');
} finally {
  await writeFile(resolve(out, 'frameworks.json'), JSON.stringify(results, null, 2));
  await desktop.stop(); await fixture?.close();
}

import '../ci/paper-pdf-restore.test.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { stageBuiltinApp } from './builtin-app-payload.mjs';

const root = resolve(import.meta.dirname, '../..');
const modules = resolve(root, 'apps/paper-agent/node_modules');

for (const ancestorReact of [false, true]) {
  test(`App and shared SDK use one App-owned React runtime (ancestor React: ${ancestorReact})`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'pero-app-react-'));
    try {
      const checkout = join(directory, 'checkout');
      const app = join(checkout, 'apps/sample');
      const sdk = join(checkout, 'packages/app-sdk/src');
      const reader = join(directory, 'reader');
      for (const path of [join(app, 'ui-src'), sdk, reader, join(checkout, 'node_modules')]) mkdirSync(path, { recursive: true });
      // Copy real packages, not symlinks: two physical copies of even the same
      // React version have different module identity and reproduce the failure.
      for (const name of ['react', 'react-dom', 'scheduler']) {
        cpSync(join(modules, name), join(app, 'node_modules', name), { recursive: true });
        if (ancestorReact) cpSync(join(modules, name), join(directory, 'node_modules', name), { recursive: true });
      }
      symlinkSync(resolve(root, 'node_modules/esbuild'), join(checkout, 'node_modules/esbuild'), 'junction');
      cpSync(join(root, 'scripts'), join(checkout, 'scripts'), { recursive: true });
      writeFileSync(join(sdk, '../package.json'), JSON.stringify({exports:{'.':'./src/index.tsx','./core':'./src/core.mjs'}}));
      writeFileSync(join(sdk, 'core.mjs'), 'export const supported = true;');
      writeFileSync(join(app, 'app.json'), JSON.stringify({ displayName: 'React fixture' }));
      writeFileSync(join(reader, 'index.html'), 'reader fixture');
      const imports = `import React from 'react';
import jsxRuntime from 'react/jsx-runtime';
import jsxDevRuntime from 'react/jsx-dev-runtime';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
`;
      writeFileSync(join(sdk, 'index.tsx'), `${imports}
export const runtime = { React, jsxRuntime, jsxDevRuntime, flushSync, createRoot };
export function Shared() { const [value] = React.useState('mounted'); return <span>{value}</span>; }
`);
      writeFileSync(join(app, 'ui-src/frame.tsx'), `${imports}
import { renderToString } from 'react-dom/server';
import ownedReact from '../node_modules/react/index.js';
import { runtime, Shared } from '@pero/app-sdk';
import { supported } from '@pero/app-sdk/core';
if (!supported) throw new Error('SDK subpath resolution failed');
const local = { React, jsxRuntime, jsxDevRuntime, flushSync, createRoot };
globalThis.result = Object.fromEntries(Object.entries(local).map(([name, value]) => [name, value === runtime[name]]));
globalThis.appOwned = React === ownedReact;
globalThis.render = () => renderToString(<Shared />);
`);
      execFileSync(process.execPath, [join(checkout, 'scripts/build/apps.mjs'), '--app', 'sample', '--reader-dist', reader], { cwd: checkout, stdio: 'pipe', timeout: 30_000 });
      const verify = path => {
        const channels = [];
        class ScopedMessageChannel extends MessageChannel {
          constructor() { super(); channels.push(this); }
        }
        const context = { TextEncoder, TextDecoder, ReadableStream, MessageChannel: ScopedMessageChannel, console };
        try {
          runInNewContext(readFileSync(path, 'utf8'), context, { timeout: 10_000 });
          assert.equal(context.appOwned, true);
          for (const name of ['React', 'jsxRuntime', 'jsxDevRuntime', 'flushSync', 'createRoot']) assert.equal(context.result[name], true, `${name} identity in ${path}`);
          assert.equal(context.render(), '<span>mounted</span>');
        } finally { for (const { port1, port2 } of channels) { port1.close(); port2.close(); } }
      };
      verify(join(app, 'dist/index.js'));
      const staged = join(directory, 'distribution/apps/sample');
      stageBuiltinApp(app, 'sample', staged);
      assert.equal(existsSync(join(staged, 'node_modules')), false);
      rmSync(checkout, { recursive: true, force: true });
      rmSync(join(directory, 'node_modules'), { recursive: true, force: true });
      verify(join(staged, 'dist/index.js'));
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}

// This is a contract of the installed (pinned) PDF dependency, not a substitute
// for the Desktop reopen/visible-canvas/search assertions.
test('Paper boots EmbedPDF with an auto mode before restoring numeric zoom', async () => {
  const { ZoomPlugin, ZoomMode } = await import(join(modules, '@embedpdf/plugin-zoom/dist/index.js'));
  const source = readFileSync(join(root, 'apps/paper-agent/ui-src/pdf-reader.tsx'), 'utf8');
  assert.match(source, /defaultZoomLevel: ZoomMode\.FitPage/);
  for (const initial of [ZoomMode.FitPage, 1.25]) {
    const requests = [], gates = new Set();
    let state;
    const scope = {
      defaultZoomLevel: initial,
      viewport: { gate: (kind, id) => gates.add(`${kind}:${id}`) },
      dispatch(action) { state = action.payload.state; },
      logger: { debug() {} },
      getDocumentState: () => state,
      handleRequest({ level }, id) { requests.push(level); gates.delete(`zoom:${id}`); },
      recalcAuto: ZoomPlugin.prototype.recalcAuto,
    };
    ZoomPlugin.prototype.onDocumentLoadingStarted.call(scope, 'paper');
    ZoomPlugin.prototype.onDocumentLoaded.call(scope, 'paper');
    if (initial === ZoomMode.FitPage) {
      assert.deepEqual(requests, [ZoomMode.FitPage]);
      assert.equal(gates.size, 0);
      // The existing restore uses the public scoped request path after layout.
      scope.handleRequest({ level: 1.25 }, 'paper');
      assert.deepEqual(requests, [ZoomMode.FitPage, 1.25]);
    } else {
      assert.deepEqual(requests, []);
      assert.equal(gates.size, 1, 'numeric startup never opens the initial viewport gate');
    }
  }
});

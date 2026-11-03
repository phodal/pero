import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// Electron's file transport is the only substituted seam; the App serves real
// temporary assets and resolves its permissions through the Host protocol.
const electron = 'data:text/javascript,import {readFile} from "node:fs/promises"; export const net={async fetch(url){return new Response(await readFile(new URL(url)),{headers:{"Content-Type":"text/html"}});}};';
registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === 'electron' ? { url: electron, shortCircuit: true } : nextResolve(specifier, context);
} });
const { DesktopApps } = await import('./apps.ts');

test('App assets embed only Host-declared frame origins', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pero-app-frames-'));
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist/index.html'), '<h1>App frame policy fixture</h1>');
  const apps = new DesktopApps(command => {
    const request = command as { id: string; name: string; action: string };
    assert.equal(request.action, 'resolve');
    apps.accept({ version: 1, kind: 'apps_result', request_id: request.id, text: '', data: {
      ok: true, value: { root, entry: 'dist/index.html', ...(request.name === 'paper-agent' ? { frameOrigins: ['https://arxiv.org'] } : {}) },
    } });
  }, () => { throw new Error('Private Host access must not be published'); }, async () => undefined);
  try {
    for (const [name, expected] of [['paper-agent', "'self' https://arxiv.org"], ['other-app', "'self'"]]) {
      const response = await apps.serve(new Request(`pero-app://${name}/dist/index.html`));
      assert.equal(response.status, 200);
      const csp = response.headers.get('Content-Security-Policy')!;
      assert.equal(csp.match(/(?:^|; )frame-src ([^;]+)/)?.[1].trim(), expected);
      assert.ok(csp.includes("connect-src 'self'"));
      assert.ok(csp.includes("script-src 'self' 'wasm-unsafe-eval'"));
      assert.equal(await response.text(), '<h1>App frame policy fixture</h1>');
    }
  } finally { apps.close(); await rm(root, { recursive: true, force: true }); }
});

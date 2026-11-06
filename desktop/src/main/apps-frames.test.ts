import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
import { transformSync } from 'esbuild';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { richArtifactFiles } from '../../../tests/fixtures/session-artifact-files.mjs';
import type { ArtifactMedia } from '../../../protocol/generated/host';

// Electron's file transport is the only substituted seam; the App serves real
// temporary assets and resolves its permissions through the Host protocol.
const electron = 'data:text/javascript,import {readFile} from "node:fs/promises"; export const net={async fetch(url){return new Response(await readFile(new URL(url)),{headers:{"Content-Type":"text/html"}});}};';
registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === 'electron' ? { url: electron, shortCircuit: true } : nextResolve(specifier, context);
}, load(url, context, nextLoad) {
  const loaded = nextLoad(url, context);
  // Match the Desktop build transform: Node 26 no longer transforms TS parameter properties.
  if (url.endsWith('.ts') && loaded.source) return { ...loaded, format: 'module',
    source: transformSync(typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source as Uint8Array).toString('utf8'), { loader: 'ts', format: 'esm' }).code };
  return loaded;
} });
const { DesktopApps } = await import('./apps.ts');

test('App assets keep declared frame origins and allow same-app ancestors only for bundled reader frames', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pero-app-frames-'));
  const assets = ['index.html', 'artifact.html', '_reader/reader.html', '_paper-reader/frame.html',
    '_paper-reader/frame-copy.html', '_paper-reader/frame.html.bak', 'untrusted/_paper-reader/frame.html'];
  for (const asset of assets) {
    await mkdir(dirname(join(root, 'dist', asset)), { recursive: true });
    await writeFile(join(root, 'dist', asset), '<h1>App frame policy fixture</h1>');
  }
  const apps = new DesktopApps(command => {
    const request = command as { id: string; name: string; action: string };
    assert.equal(request.action, 'resolve_static');
    apps.accept({ version: 1, kind: 'apps_result', request_id: request.id, text: '', data: {
      ok: true, value: { root, entry: 'dist/index.html', ...(request.name === 'paper-agent' ? { frameOrigins: ['https://arxiv.org'] } : {}) },
    } });
  }, () => { throw new Error('Private Host access must not be published'); }, async () => undefined);
  try {
    for (const [name, expected] of [['paper-agent', "'self' https://arxiv.org"], ['other-app', "'self'"], ['scientific-viewer', "'self'"]]) {
      for (const asset of assets) {
        const response = await apps.serve(new Request(`pero-app://${name}/dist/${asset}`));
        assert.equal(response.status, 200);
        const csp = response.headers.get('Content-Security-Policy')!;
        assert.equal(csp.match(/(?:^|; )frame-src ([^;]+)/)?.[1].trim(), expected);
        const ancestors = csp.match(/(?:^|; )frame-ancestors ([^;]+)/)?.[1].trim();
        const nested = asset === '_reader/reader.html' || name === 'paper-agent' && asset === '_paper-reader/frame.html';
        assert.equal(ancestors, name === 'scientific-viewer' && asset === 'artifact.html' ? 'pero://workbench pero://chat' : nested ? "'self' pero://workbench" : 'pero://workbench', `${name}/${asset}`);
        assert.ok(csp.includes("connect-src 'self'"));
        assert.ok(csp.includes("script-src 'self' 'wasm-unsafe-eval'"));
        assert.equal(await response.text(), '<h1>App frame policy fixture</h1>');
      }
    }
  } finally { apps.close(); await rm(root, { recursive: true, force: true }); }
});

test('Scientific Viewer reads fixed Host snapshots without backend startup or publishing private paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pero-app-artifact-'));
  let enabled = true, resolutions = 0;
  const apps = new DesktopApps(command => {
    const request = command as { id: string; name: string; action: string };
    assert.equal(request.action, 'sdkcontext', 'Snapshot reads must not resolve a Python backend');
    assert.equal(request.name, 'scientific-viewer');
    apps.accept({ version: 1, kind: 'apps_result', request_id: request.id, text: '', data: enabled
      ? { ok: true, value: { name: 'scientific-viewer' } } : { ok: false, error: 'App disabled' } });
  }, () => { throw new Error('Private Host paths must not be published'); }, async () => undefined);
  const media: Record<string, ArtifactMedia> = {
    'analysis.py': { kind: 'document', format: { kind: 'code', language: 'python' } },
    'results.csv': { kind: 'csv' }, 'chart.svg': { kind: 'image', mime_type: 'image/svg+xml' },
    'chart.png': { kind: 'image', mime_type: 'image/png' }, 'report.html': { kind: 'html' },
    'evidence.pdf': { kind: 'pdf' }, 'analysis.ipynb': { kind: 'notebook' },
  };
  const fixtures = richArtifactFiles();
  try {
    for (const [index, file] of fixtures.entries()) {
      const path = join(root, file.name);
      await writeFile(path, file.data);
      const sha256 = createHash('sha256').update(file.data).digest('hex');
      apps.artifactSnapshot = async (thread, artifact, version, signal) => {
        resolutions++;
        assert.deepEqual([thread, artifact, version], ['chat/with space', `item-${index}`, 2]);
        signal.throwIfAborted();
        return { thread_id: thread, artifact_id: artifact, version, filename: file.title + ' ' + file.name,
          media: media[file.name], sha256, bytes: file.data.length, path };
      };
      const response = await apps.serve(new Request(`pero-app://scientific-viewer/host/artifacts/chat%2Fwith%20space/item-${index}/2`));
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), file.data);
      assert.equal(response.headers.get('Content-Type')?.split(';')[0], file.mediaType === 'text/x-python' ? 'text/plain' : file.mediaType);
      assert.equal(decodeURIComponent(response.headers.get('X-Pero-Artifact-Name')!), file.title + ' ' + file.name);
      assert.equal(response.headers.get('X-Pero-Artifact-Sha256'), sha256);
      assert.equal(response.headers.get('X-Pero-Artifact-Kind'), media[file.name].kind);
      assert.ok(response.headers.get('Content-Security-Policy')?.startsWith('sandbox;'));
    }
    for (const [url, init, status] of [
      ['pero-app://other-app/host/artifacts/chat/item/1', {}, 404],
      ['pero-app://scientific-viewer/host/artifacts/chat/item/1', { method: 'POST' }, 405],
      ['pero-app://scientific-viewer/host/artifacts/chat/item/1?path=other', {}, 405],
      ['pero-app://scientific-viewer/host/artifacts/chat/item/0', {}, 400],
      ['pero-app://scientific-viewer/host/artifacts/chat/item/1', { headers: { Origin: 'pero-app://other-app' } }, 403],
    ] as const) {
      assert.equal((await apps.serve(new Request(url, init))).status, status);
    }
    enabled = false;
    assert.equal((await apps.serve(new Request('pero-app://scientific-viewer/host/artifacts/chat/item/1'))).status, 503);
    assert.equal(resolutions, fixtures.length, 'Refused requests must not resolve or read a snapshot');
  } finally { apps.close(); await rm(root, { recursive: true, force: true }); }
});

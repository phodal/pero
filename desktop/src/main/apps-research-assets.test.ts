import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// This Host route must never issue Electron HTTP calls or resolve backend credentials.
const electron = 'data:text/javascript,export const net = { fetch() { throw new Error("Unexpected Electron HTTP"); } };';
registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === 'electron' ? { url: electron, shortCircuit: true } : nextResolve(specifier, context);
} });
const { DesktopApps } = await import('./apps.ts');

test('research assets keep the Host as the only cross-App authority', async () => {
  const commands: Record<string, unknown>[] = [];
  const apps = new DesktopApps(command => {
    const value = command as Record<string, unknown>;
    commands.push(value);
    assert.equal(apps.accept({ version: 1, kind: 'apps_result', request_id: value.id as string,
      text: '', data: { ok: true, value: { state: 'queued' } } }), true);
  }, () => { throw new Error('Private Host result was published'); }, async () => undefined);
  try {
    for (const operation of ['start', 'status', 'cancel']) {
      const body = { operation, bundleId: 'a'.repeat(64), assetId: 'b'.repeat(64) };
      const response = await apps.serve(new Request('pero-app://paper-agent/host/research-assets', {
        method: 'POST', headers: { Origin: 'pero-app://paper-agent' }, body: JSON.stringify(body),
      }));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.deepEqual(await response.json(), { state: 'queued' });
      const command = commands.at(-1)!;
      assert.deepEqual({ ...command, id: 'opaque' }, {
        method: 'apps', id: 'opaque', action: 'research-assets', name: 'paper-agent', request: body,
      });
    }
    assert.equal(commands.length, 3);
    for (const [method, origin, body, status] of [
      ['GET', 'pero-app://paper-agent', undefined, 405],
      ['POST', 'pero-app://paper-agent', ' '.repeat(4097), 413],
      ['POST', 'pero-app://other-app', '{}', 403],
    ] as const) {
      const response = await apps.serve(new Request('pero-app://paper-agent/host/research-assets', {
        method, headers: { Origin: origin }, body,
      }));
      assert.equal(response.status, status);
      assert.equal(commands.length, 3);
    }
  } finally { apps.close(); }
});

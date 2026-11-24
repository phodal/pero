import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

export function browserDiagnosticPage(foreignOrigin) {
  const foreign = new URL('/diagnostic-cross-origin?outside-query-marker', foreignOrigin).href;
  return `<!doctype html><title>Browser diagnostics fixture</title><h1 style="color:rgb(24, 70, 120)">Browser diagnostics fixture</h1>
<script>
function runDiagnosticWorkload() {
  const deadline = performance.now() + 12;
  let total = 0;
  while (performance.now() < deadline) total += Math.random();
  window.diagnosticTotal = total;
}
setInterval(() => {
  runDiagnosticWorkload();
  console.warn('diagnostic console marker');
  fetch('/diagnostic-request?private-query-marker').catch(() => {});
  fetch(${JSON.stringify(foreign)}, { mode: 'no-cors' }).catch(() => {});
  throw new Error('diagnostic runtime marker');
}, 125);
</script>`;
}

export function verifyBrowserDiagnostics(result, origin, { profileRequired = true } = {}) {
  assert.equal(result.kind, 'diagnostics', JSON.stringify(result));
  assert.equal(result.origin, origin);
  assert(result.console.some(item => item.level === 'warning' && item.text === 'diagnostic console marker'));
  assert(result.errors.some(message => message.includes('diagnostic runtime marker')));
  assert(result.network.some(item => item.url === origin + '/diagnostic-request' &&
    item.method === 'GET' && item.status === 202 && Number.isFinite(item.durationMs)));
  assert(result.metrics.ScriptDuration > 0);
  assert.deepEqual(result.style, { matched: true, values: { color: 'rgb(24, 70, 120)' } });
  if (profileRequired || !result.profileUnavailable)
    assert(result.cpu?.some(item => item.name === 'runDiagnosticWorkload' && item.samples > 0), JSON.stringify(result.cpu));
  else assert.equal(result.cpu, undefined);
  assert.doesNotMatch(JSON.stringify(result), /private-query-marker|diagnostic-cross-origin|outside-query-marker/);
}

export async function checkEmbeddedDiagnostics({ app, origin, menu, prompt, open, confirm, document }) {
  const tabId = origin + '/diagnostics';
  await open(tabId);
  await confirm(1);
  await expect.poll(async () => (await document(tabId))?.observation.notice).toBe('Browser Use allowed');
  await menu('browser-use-developer-mode', true);
  const [diagnostics] = await prompt([{ action: 'diagnose', tabId, captureMs: 1500, profile: true,
    style: { selector: 'h1', properties: ['color'] } }]);
  verifyBrowserDiagnostics(diagnostics, origin);
  expect(await app.evaluate(() => globalThis.browserUsePrompt?.message)).toBe('Allow browser diagnostics on this site?');
  await menu('browser-use-developer-mode', false);
  const original = origin + '/';
  const [, activated] = await prompt([{ action: 'closeTab', tabId }, { action: 'activate', tabId: original }]);
  expect(activated).toMatchObject({ kind: 'tabActivated', tabId: original });
  return diagnostics;
}

import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

export function browserDiagnosticPage(foreignOrigin) {
  const foreign = new URL('/diagnostic-cross-origin?outside-query-marker', foreignOrigin).href;
  return `<!doctype html><title>Browser diagnostics fixture</title><h1 style="color:rgb(24, 70, 120)">Browser diagnostics fixture</h1>
<button onclick="console.info('cdp action marker')">Log CDP event</button>
<iframe title="CDP child fixture" srcdoc="<script>console.warn('cdp child marker')</script>"></iframe>
<script>
console.info('cdp loaded marker');
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

export async function checkCdp({ prompt, tabId }) {
  const read = { action: 'cdpReadEvents', tabId, methods: ['Runtime.consoleAPICalled'], limit: 50 };
  const [layout, metrics, dom, rejected, baseline] = await prompt([
    { action: 'cdpSend', tabId, command: { method: 'Page.getLayoutMetrics' } },
    { action: 'cdpSend', tabId, command: { method: 'Performance.getMetrics' } },
    { action: 'cdpSend', tabId, command: { method: 'DOM.getDocument', params: { depth: 1 } } },
    { action: 'cdpSend', tabId, command: { method: 'Runtime.evaluate' } },
    read,
  ]);
  assert.equal(layout.kind, 'cdpResult', JSON.stringify(layout));
  assert(layout.result.cssLayoutViewport.clientWidth > 0);
  assert(metrics.result.metrics.some(item => item.name === 'ScriptDuration'));
  assert.equal(dom.result.root.nodeName, '#document');
  assert.equal(rejected.isError, true);
  assert(baseline.events.some(item => item.text === 'cdp loaded marker'), JSON.stringify(baseline));
  assert(!baseline.events.some(item => item.text === 'cdp child marker'));
  const [clicked, delta] = await prompt([
    { action: 'act', tabId, locator: { by: 'role', role: 'button', name: 'Log CDP event' }, operation: { action: 'click' } },
    { ...read, after: baseline.cursor },
  ]);
  assert.equal(clicked.outcome, 'dispatched', JSON.stringify(clicked));
  assert.equal(delta.cursor.stream, baseline.cursor.stream);
  assert(delta.events.every(event => event.sequence > baseline.cursor.sequence));
  assert.equal(delta.events.filter(event => event.text === 'cdp action marker').length, 1);
  const [next, reloaded, stale, fresh] = await prompt([
    { ...read, after: delta.cursor }, { action: 'reload', tabId }, { ...read, after: delta.cursor }, read,
  ]);
  assert(!next.events.some(item => item.text === 'cdp action marker'));
  assert.equal(reloaded.outcome, 'dispatched', JSON.stringify(reloaded));
  assert.match(stale.error, /cursor is stale/i);
  assert.notEqual(fresh.cursor.stream, delta.cursor.stream);
  return { metrics: true, layout: true, boundedDocument: true, unsupportedCommandRejected: true,
    sameDocumentCursor: true, childFrameExcluded: true, duplicateReplaySuppressed: true, staleAfterReload: true };
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
  const cdp = await checkCdp({ prompt, tabId });
  await menu('browser-use-developer-mode', false);
  const original = origin + '/';
  const [, activated] = await prompt([{ action: 'closeTab', tabId }, { action: 'activate', tabId: original }]);
  expect(activated).toMatchObject({ kind: 'tabActivated', tabId: original });
  return { ...diagnostics, cdp };
}

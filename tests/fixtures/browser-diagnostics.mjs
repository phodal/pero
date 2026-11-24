import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

export function browserDiagnosticPage(foreignOrigin) {
  const foreign = new URL('/diagnostic-cross-origin?outside-query-marker', foreignOrigin).href;
  const foreignFrame = new URL('/diagnostic-frame?outside-frame-marker', foreignOrigin).href;
  const oopif = new URL(foreignFrame);
  oopif.hostname = 'localhost';
  const foreignStyle = new URL('/diagnostic.css?outside-style-marker', foreignOrigin).href;
  return `<!doctype html><title>Browser diagnostics fixture</title><h1 style="color:rgb(24, 70, 120)">Browser diagnostics fixture</h1>
<link rel="stylesheet" href="/diagnostic.css"><link rel="stylesheet" href="${foreignStyle}">
<button onclick="console.info('cdp action marker')">Log CDP event</button>
<button onclick="runLiveFixture()">Run live capture fixture</button><output>Waiting for network fixture</output>
<iframe title="CDP child fixture" srcdoc="<script>console.warn('cdp child marker')</script>"></iframe>
<iframe title="Same origin CDP frame" src="/diagnostic-frame"></iframe>
<iframe title="Foreign CDP frame" id="cdp-child" src="${oopif.href}" onload="document.querySelector('#cdp-child-loaded').textContent = 'CDP child loaded'"></iframe>
<span id="cdp-child-loaded">Loading CDP child</span>
<button onclick="replaceCdpChild()">Replace child document</button><output id="cdp-child-state">Child waiting</output>
<button onclick="runScopedNetwork()">Run scoped network fixture</button><p id="scoped-network-state">Waiting for scoped network</p>
<script>
console.info('cdp loaded marker');
function runDiagnosticWorkload() {
  const deadline = performance.now() + 12;
  let total = 0;
  while (performance.now() < deadline) total += Math.random();
  window.diagnosticTotal = total;
}
const diagnosticTimer = setInterval(() => {
  runDiagnosticWorkload();
  console.warn('diagnostic console marker');
  fetch('/diagnostic-request?private-query-marker').catch(() => {});
  fetch(${JSON.stringify(foreign)}, { mode: 'no-cors' }).catch(() => {});
  throw new Error('diagnostic runtime marker');
}, 125);
async function runLiveFixture() {
  clearInterval(diagnosticTimer);
  console.info('live network action');
  const [response] = await Promise.all([
    fetch('/cdp-response?cdp-private-query'),
    fetch('/cdp-redirect', { mode: 'no-cors' }),
    fetch(${JSON.stringify(foreign)}, { mode: 'no-cors' }),
  ]);
  await response.json();
  document.querySelector('output').textContent = 'Live fixture complete';
}
function replaceCdpChild() {
  const child = document.querySelector('#cdp-child');
  child.addEventListener('load', () => document.querySelector('#cdp-child-state').textContent = 'Child replaced', { once: true });
  child.src = ${JSON.stringify(oopif.origin + '/diagnostic-frame?replacement')};
}
${scopedNetworkScript(oopif.origin)}
</script>`;
}

export function scopedNetworkScript(childOrigin) {
  return `
async function runScopedNetwork() {
  const child = document.querySelector('#cdp-child');
  const childOrigin = ${JSON.stringify(childOrigin)};
  const ready = new Promise(resolve => {
    const receive = event => {
      if (event.origin !== childOrigin || event.source !== child.contentWindow || event.data !== 'Scoped network ready') return;
      window.removeEventListener('message', receive);
      resolve();
    };
    window.addEventListener('message', receive);
  });
  child.contentWindow.postMessage('Run scoped network', childOrigin);
  await Promise.all([ready, fetch('/cdp-parent-response?parent-private-query').then(reply => reply.json())]);
  document.querySelector('#scoped-network-state').textContent = 'Scoped network complete';
}`;
}

export function serveDiagnosticAssets(request, response, peerOrigin) {
  if (request.url.split('?', 1)[0] === '/diagnostic.css') {
    response.writeHead(200, { 'Content-Type': 'text/css' }).end('body { margin: 10px; }');
    return true;
  }
  if (request.url.split('?', 1)[0] === '/diagnostic-frame') {
    const isChild = peerOrigin && new URL(request.url, peerOrigin).searchParams.has('outside-frame-marker');
    response.writeHead(200, { 'Content-Type': 'text/html' }).end(isChild ? `<p>Browser diagnostics frame</p>
      <script>console.info('direct target log'); throw new Error('direct target exception')</script>
      <script>
        window.addEventListener('message', async event => {
          const rootOrigin = ${JSON.stringify(peerOrigin)};
          if (event.origin !== rootOrigin || event.source !== window.parent || event.data !== 'Run scoped network') return;
          const response = await fetch('/cdp-child-response?child-private-query');
          await response.json();
          window.parent.postMessage('Scoped network ready', rootOrigin);
        });
      </script>
      <iframe title="Nested CDP fixture" src="${new URL('/cdp-nested', peerOrigin).href}"></iframe>`
      : '<p>Browser diagnostics frame</p>');
    return true;
  }
  if (request.url === '/cdp-nested') {
    response.writeHead(200, { 'Content-Type': 'text/html' }).end('<p>Nested CDP fixture</p><script>console.info("nested target log")</script>');
    return true;
  }
  if (request.url.startsWith('/cdp-response?')) {
    response.writeHead(202, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ fixture: 'network-response' }));
    return true;
  }
  const scoped = /^\/cdp-(parent|child)-response\?/.exec(request.url);
  if (scoped) {
    response.writeHead(202, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ fixture: scoped[1] }));
    return true;
  }
  if (request.url === '/cdp-redirect' && peerOrigin) {
    response.writeHead(302, { Location: new URL('/cdp-response?cdp-foreign-query', peerOrigin).href }).end();
    return true;
  }
  return false;
}

export async function checkCdpNetwork({ prompt, tabId, menu }) {
  const command = (method, params) => ({ action: 'cdpSend', tabId, command: { method, ...(params && { params }) } });
  const [started, checkpoint, clicked, ready] = await prompt([
    command('Network.enable'), { action: 'cdpReadEvents', tabId },
    { action: 'act', tabId, locator: { by: 'role', role: 'button', name: 'Run live capture fixture' }, operation: { action: 'click' } },
    { action: 'wait', tabId, locator: { by: 'text', value: 'Live fixture complete' }, condition: { kind: 'visible' }, timeoutMs: 3000 },
  ]);
  assert.equal(started.kind, 'cdpResult', JSON.stringify(started));
  assert(started.result.captureMs > 0);
  assert.deepEqual(checkpoint.events, []);
  assert.equal(checkpoint.cursor.stream, started.result.cursor.stream);
  assert.equal(clicked.outcome, 'dispatched');
  assert.equal(ready.matched, true);
  const read = { action: 'cdpReadEvents', tabId, methods: ['Network.requestWillBeSent', 'Network.responseReceived',
    'Network.loadingFinished', 'Network.loadingFailed', 'Runtime.consoleAPICalled'] };
  const [first] = await prompt([{ ...read, after: checkpoint.cursor, limit: 1 }]);
  assert.equal(first.hasMore, true);
  const [next] = await prompt([{ ...read, after: first.cursor, limit: 50 }]);
  assert.equal(next.hasMore, false);
  const events = [...first.events, ...next.events];
  const response = events.find(event => event.method === 'Network.responseReceived' && event.params.url.endsWith('/cdp-response'));
  assert.equal(response?.params.status, 202, JSON.stringify(events));
  assert(events.some(event => event.method === 'Runtime.consoleAPICalled' && event.text === 'live network action'));
  assert(events.some(event => event.method === 'Network.loadingFinished' && event.params.requestId === response.params.requestId));
  assert.doesNotMatch(JSON.stringify(events), /cdp-private-query|cdp-foreign-query|diagnostic-cross-origin/);
  const redirect = events.find(event => event.method === 'Network.requestWillBeSent' && event.params.url.endsWith('/cdp-redirect'));
  assert(redirect, JSON.stringify(events));
  const bodyRequest = command('Network.getResponseBody', { requestId: response.params.requestId });
  const [body, blocked, noNewEvents] = await prompt([
    bodyRequest, command('Network.getResponseBody', { requestId: redirect.params.requestId }),
    { ...read, after: next.cursor, timeoutMs: 250, methods: ['Network.responseReceived'] },
  ]);
  assert.deepEqual(body.result, { body: '{"fixture":"network-response"}', base64Encoded: false });
  assert.match(blocked.error, /same-origin/);
  assert.deepEqual(noNewEvents.events, []);
  await menu('browser-use-developer-mode', false);
  await menu('browser-use-developer-mode', true);
  const [revoked, expired, restarted, stopped, stoppedRead] = await prompt([
    bodyRequest, { ...read, after: checkpoint.cursor }, command('Network.enable'), command('Network.disable'), bodyRequest,
  ]);
  assert.match(revoked.error, /Enable Network/);
  assert.match(expired.error, /capture ended|cursor is stale/);
  assert.notEqual(restarted.result.cursor.stream, checkpoint.cursor.stream);
  assert.equal(stopped.kind, 'cdpResult');
  assert.match(stoppedRead.error, /Enable Network/);
  return { body: true, paged: true, timeout: true, redirectedBodyRejected: true, modeRevocation: true, explicitStop: true };
}

export async function checkCdpTargets({ prompt, tabId, foreignOrigin, topOrigin, menu }) {
  const child = new URL(foreignOrigin);
  child.hostname = 'localhost';
  const list = { action: 'cdpListTargets', tabId };
  const approved = { ...list, fromOrigins: [child.origin] };
  const [loaded, scoped, direct, discovered] = await prompt([
    { action: 'wait', tabId, locator: { by: 'text', value: 'CDP child loaded' }, condition: { kind: 'visible' }, timeoutMs: 3000 },
    { ...list, depth: 2 }, approved, { ...approved, depth: 2 },
  ]);
  assert.equal(loaded.matched, true, JSON.stringify(loaded));
  assert.deepEqual(scoped.targets, [], JSON.stringify(scoped));
  assert.equal(direct.targets.length, 1, JSON.stringify({ direct, discovered }));
  assert.equal(discovered.kind, 'cdpTargets', JSON.stringify(discovered));
  assert.equal(discovered.targets.length, 2, JSON.stringify(discovered));
  const { id, origin, url } = discovered.targets[0];
  assert.equal(origin, child.origin);
  assert.equal(url, child.origin + '/diagnostic-frame');
  const nested = discovered.targets[1];
  assert.equal(nested.parentId, id);
  assert.equal(nested.origin, topOrigin);
  assert.equal(nested.url, topOrigin + '/cdp-nested');
  const command = { action: 'cdpSend', tabId, target: { id, origin }, command: { method: 'DOM.getDocument', params: { depth: 1 } } };
  const nestedTarget = { id: nested.id, origin: nested.origin };
  const nestedCommand = { ...command, target: nestedTarget };
  const read = { action: 'cdpReadEvents', tabId, methods: ['Runtime.consoleAPICalled', 'Runtime.exceptionThrown'] };
  const childRead = { ...read, target: command.target };
  const nestedRead = { ...read, target: nestedTarget };
  const [dom, nestedDom, wrongOrigin, wrongCommand, childEvents, nestedEvents, topEvents] = await prompt([command, nestedCommand,
    { ...command, target: { id, origin: new URL(foreignOrigin).origin } },
    { ...command, command: { method: 'Runtime.evaluate' } }, childRead, nestedRead, read,
  ]);
  assert.equal(dom.kind, 'cdpResult', JSON.stringify(dom));
  assert.equal(dom.result.root.documentURL, url + '?outside-frame-marker');
  assert.equal(nestedDom.result.root.documentURL, nested.url);
  assert.match(wrongOrigin.error, /stale/);
  assert.equal(wrongCommand.isError, true);
  assert.deepEqual(childEvents.events.map(event => event.text), ['direct target log', 'Error: direct target exception']);
  assert.deepEqual(nestedEvents.events.map(event => event.text), ['nested target log']);
  assert(!topEvents.events.some(event => event.text.includes('target log')));
  const [same, foreignCursor] = await prompt([{ ...childRead, after: childEvents.cursor }, { ...nestedRead, after: childEvents.cursor }]);
  assert.deepEqual(same.events, []);
  assert.match(foreignCursor.error, /cursor is stale/);
  const target = command.target;
  const cdp = (method, params, scopedTarget) => ({ action: 'cdpSend', tabId, target: scopedTarget, command: { method, params } });
  const [rootStart, childStart, networkClick, networkReady] = await prompt([
    cdp('Network.enable'), cdp('Network.enable', undefined, target),
    { action: 'act', tabId, locator: { by: 'role', role: 'button', name: 'Run scoped network fixture' }, operation: { action: 'click' } },
    { action: 'wait', tabId, locator: { by: 'text', value: 'Scoped network complete' }, condition: { kind: 'visible' }, timeoutMs: 3000 },
  ]);
  assert.equal(rootStart.kind, 'cdpResult', JSON.stringify(rootStart));
  assert.equal(childStart.kind, 'cdpResult', JSON.stringify(childStart));
  assert.equal(networkClick.outcome, 'dispatched', JSON.stringify(networkClick));
  assert.equal(networkReady.matched, true, JSON.stringify(networkReady));
  const networkRead = { action: 'cdpReadEvents', tabId, methods: ['Network.responseReceived', 'Network.loadingFinished'] };
  const [rootNetwork, childNetwork] = await prompt([
    { ...networkRead, after: rootStart.result.cursor },
    { ...networkRead, target, after: childStart.result.cursor, timeoutMs: 1500 },
  ]);
  const responseId = (page, path) => {
    const response = page.events.find(event => event.method === 'Network.responseReceived' && event.params.url.endsWith(path));
    assert.equal(response?.params.status, 202, JSON.stringify(page));
    assert(page.events.some(event => event.method === 'Network.loadingFinished' && event.params.requestId === response.params.requestId));
    return response.params.requestId;
  };
  const rootBody = cdp('Network.getResponseBody', { requestId: responseId(rootNetwork, '/cdp-parent-response') });
  const childBody = cdp('Network.getResponseBody', { requestId: responseId(childNetwork, '/cdp-child-response') }, target);
  assert.doesNotMatch(JSON.stringify(rootNetwork), /cdp-child-response|parent-private-query/);
  assert.doesNotMatch(JSON.stringify(childNetwork), /cdp-parent-response|child-private-query/);
  const [rootReply, childReply, foreignBody, quiet, stop, expired, rootStillRunning, rootStop, restarted] = await prompt([
    rootBody, childBody, { ...childBody, target: undefined },
    { ...networkRead, target, after: childNetwork.cursor, timeoutMs: 200 },
    cdp('Network.disable', undefined, target), childBody, rootBody, cdp('Network.disable'), cdp('Network.enable', undefined, target),
  ]);
  assert.equal(rootReply.result.body, '{"fixture":"parent"}');
  assert.equal(childReply.result.body, '{"fixture":"child"}');
  assert.match(foreignBody.error, /same-origin/);
  assert.deepEqual(quiet.events, []);
  assert.equal(stop.kind, 'cdpResult');
  assert.match(expired.error, /Enable Network/);
  assert.equal(rootStillRunning.result.body, rootReply.result.body);
  assert.equal(rootStop.kind, 'cdpResult');
  assert.equal(restarted.kind, 'cdpResult');
  await menu('browser-use-developer-mode', false);
  await menu('browser-use-developer-mode', true);
  const [revoked] = await prompt([{ ...networkRead, target, after: restarted.result.cursor }]);
  assert.match(revoked.error, /capture ended/);
  const [click, changed, stale, staleDescendant, newTargets] = await prompt([
    { action: 'act', tabId, locator: { by: 'role', role: 'button', name: 'Replace child document' }, operation: { action: 'click' } },
    { action: 'wait', tabId, locator: { by: 'text', value: 'Child replaced' }, condition: { kind: 'visible' }, timeoutMs: 3000 },
    command, nestedRead, approved,
  ]);
  assert.equal(click.outcome, 'dispatched');
  assert.equal(changed.matched, true);
  assert.match(stale.error, /child document changed|target is stale/);
  assert.match(staleDescendant.error, /child document changed|target is stale/);
  assert.equal(newTargets.targets.length, 1);
  assert.notEqual(newTargets.targets[0].id, id);
  const [newDom] = await prompt([{ ...command, target: { id: newTargets.targets[0].id, origin } }]);
  assert.equal(newDom.result.root.documentURL, url + '?replacement');
  return { defaultOriginScope: true, childQuery: true, nestedQuery: true, isolatedEvents: true,
    cursorIsolation: true, wrongOriginRejected: true, staleAfterNavigation: true,
    networkIsolation: true, childBody: true, childTimeout: true, childRevocation: true };
}

export async function checkCdp({ prompt, tabId }) {
  const read = { action: 'cdpReadEvents', tabId, methods: ['Runtime.consoleAPICalled'], limit: 50 };
  const [layout, metrics, dom, frames, resources, rejected, baseline] = await prompt([
    { action: 'cdpSend', tabId, command: { method: 'Page.getLayoutMetrics' } },
    { action: 'cdpSend', tabId, command: { method: 'Performance.getMetrics' } },
    { action: 'cdpSend', tabId, command: { method: 'DOM.getDocument', params: { depth: 1 } } },
    { action: 'cdpSend', tabId, command: { method: 'Page.getFrameTree' } },
    { action: 'cdpSend', tabId, command: { method: 'Page.getResourceTree' } },
    { action: 'cdpSend', tabId, command: { method: 'Runtime.evaluate' } },
    read,
  ]);
  assert.equal(layout.kind, 'cdpResult', JSON.stringify(layout));
  assert(layout.result.cssLayoutViewport.clientWidth > 0);
  assert(metrics.result.metrics.some(item => item.name === 'ScriptDuration'));
  assert.equal(dom.result.root.nodeName, '#document');
  const frameTree = frames.result.frameTree;
  const origin = new URL(frameTree.frame.url).origin;
  assert.equal(new URL(frameTree.frame.url).pathname, '/diagnostics');
  assert.deepEqual(frameTree.childFrames.map(({ frame }) => frame.url), [origin + '/diagnostic-frame']);
  const resourceTree = resources.result.frameTree;
  assert.equal(resourceTree.frame.id, frameTree.frame.id);
  assert(resourceTree.resources.some(resource => resource.url === origin + '/diagnostic.css' && resource.type === 'Stylesheet'));
  assert.doesNotMatch(JSON.stringify(resourceTree), /outside-frame-marker|outside-style-marker/);
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
  return { metrics: true, layout: true, boundedDocument: true, scopedFrameTree: true, scopedResourceTree: true, unsupportedCommandRejected: true,
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

export async function checkEmbeddedDiagnostics({ app, origin, foreignOrigin, menu, prompt, open, confirm, document }) {
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
  const network = await checkCdpNetwork({ prompt, tabId, menu });
  const targets = await checkCdpTargets({ prompt, tabId, foreignOrigin, topOrigin: origin, menu });
  await menu('browser-use-developer-mode', false);
  const original = origin + '/';
  const [, activated] = await prompt([{ action: 'closeTab', tabId }, { action: 'activate', tabId: original }]);
  expect(activated).toMatchObject({ kind: 'tabActivated', tabId: original });
  return { ...diagnostics, cdp: { ...cdp, network, targets } };
}

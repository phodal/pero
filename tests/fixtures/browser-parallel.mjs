import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

export function parallelBrowserFixture() {
  const events = [];
  const waiting = new Set();
  let navigation;
  return {
    events,
    handle(request, response) {
      if (request.url === '/parallel-source') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><h1>Navigation source</h1>');
      } else if (request.url === '/parallel-held') {
        events.push('slow-request');
        navigation = response;
        response.on('close', () => { if (navigation === response) navigation = undefined; });
        for (const ready of waiting) ready.writeHead(204).end();
        waiting.clear();
      } else if (request.url === '/parallel-ready') {
        if (navigation) response.writeHead(204).end();
        else {
          waiting.add(response);
          response.on('close', () => waiting.delete(response));
        }
      } else if (request.url === '/parallel-effect' && request.method === 'POST') {
        assert(navigation);
        events.push('fast-click');
        response.writeHead(204).end();
      } else if (request.url === '/parallel-release' && request.method === 'POST') {
        assert(navigation);
        events.push('release');
        navigation.setHeader('Content-Type', 'text/html');
        navigation.end('<!doctype html><h1>Slow navigation completed</h1>');
        navigation = undefined;
        response.writeHead(204).end();
      } else if (request.url === '/parallel-peer') {
        response.setHeader('Content-Type', 'text/html');
        response.end(`<!doctype html><h1>Independent tab</h1><button id="apply" disabled>Apply in other tab</button>
          <button id="release" disabled>Release navigation</button><output>Waiting</output>
          <script>
          const apply = document.querySelector('#apply'), release = document.querySelector('#release');
          fetch('/parallel-ready').then(() => { apply.disabled = false; });
          apply.onclick = async event => {
            if (!event.isTrusted) return;
            await fetch('/parallel-effect', {method:'POST'});
            document.querySelector('output').textContent = 'Trusted independent click';
            release.disabled = false;
          };
          release.onclick = event => {
            if (event.isTrusted) fetch('/parallel-release', {method:'POST'});
          };
          </script>`);
      } else return false;
      return true;
    },
    close() {
      navigation?.writeHead(503).end();
      for (const response of waiting) response.writeHead(503).end();
      waiting.clear();
    },
  };
}

export async function verifyParallelBrowser({ chrome, base, prompt, events, repl = false }) {
  const slowPage = await chrome.newPage();
  const fastPage = await chrome.newPage();
  try {
    const source = new URL('/parallel-source', base).href;
    const peer = new URL('/parallel-peer', base).href;
    const held = new URL('/parallel-held', base).href;
    await slowPage.goto(source);
    await fastPage.goto(peer, { waitUntil: 'domcontentloaded' });
    await fastPage.bringToFront();
    const [inventory] = await prompt([{ action: 'tabs' }]);
    const slow = inventory.tabs.find(tab => tab.url === source).tabId;
    const fast = inventory.tabs.find(tab => tab.url === peer).tabId;
    const button = name => ({ by: 'role', role: 'button', name });
    const waitFor = name => ({ action: 'wait', tabId: fast, locator: button(name),
      condition: { kind: 'enabled' }, timeoutMs: 6000 });
    const click = name => ({ action: 'act', tabId: fast, locator: button(name), operation: { action: 'click' } });
    const lanes = [
      [{ action: 'navigate', tabId: slow, background: true, url: held }],
      [
        waitFor('Apply in other tab'),
        { action: 'observe', tabId: slow, background: true },
        click('Apply in other tab'),
        waitFor('Release navigation'),
        click('Release navigation'),
      ],
    ];
    const [response] = await prompt(repl ? [{ action: 'repl', tool: 'javascript_repl', code: `
      const parallelResults = await Promise.all(${JSON.stringify(lanes)}.map(async lane => {
        const results = [];
        for (const request of lane) {
          try { results.push(await cua.browser(request)); }
          catch (error) { results.push({ ...error.result, error: error.message }); }
        }
        return results;
      }));
      nodeRepl.write(parallelResults);
    ` }] : [{ action: 'parallel', lanes }]);
    assert.equal(response.isError, repl ? false : undefined, JSON.stringify(response));
    const results = repl ? JSON.parse(response.text) : response;
    const [[navigation], [ready, collision, applied, releaseReady, released]] = results;
    assert.equal(ready.matched, true, JSON.stringify(results));
    assert.match(collision.error, /already in progress for this target/);
    assert.equal(applied.outcome, 'dispatched', JSON.stringify(applied));
    assert.equal(releaseReady.matched, true, JSON.stringify(releaseReady));
    assert.equal(released.outcome, 'dispatched', JSON.stringify(released));
    assert.equal(navigation.outcome, 'dispatched', JSON.stringify(navigation));
    await expect(fastPage.locator('output')).toHaveText('Trusted independent click');
    await expect(slowPage.getByRole('heading')).toHaveText('Slow navigation completed');
    assert.deepEqual(events, ['slow-request', 'fast-click', 'release']);
    return { independentChromeTabs: true, sameTabConflictRejected: true, events: [...events] };
  } finally {
    await Promise.all([slowPage.close(), fastPage.close()]);
  }
}

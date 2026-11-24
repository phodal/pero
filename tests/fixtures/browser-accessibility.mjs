import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

export const axPath = '/accessibility';
export const axFramePath = '/accessibility-frame';
export const foreignAxPath = '/foreign-accessibility-frame';
export const axFramePage = '<!doctype html><main><button>Same-origin frame action</button></main>';
export const foreignAxPage = '<!doctype html><main><button>Foreign AX marker</button></main>';

export function axPage(foreignOrigin) {
  const foreignFrame = new URL(foreignAxPath, foreignOrigin).href;
  return `<!doctype html><title>Native accessibility fixture</title><main>
    <h1>Accessibility review</h1>
    <section aria-label="Draft">
      <button id="apply">Apply accessible update</button>
      <button id="expired">Remove from tree</button>
      <p role="status">Awaiting update</p>
    </section>
    <section aria-label="Published"><button disabled>Archived action</button></section>
    <table aria-label="Runs"><tr><th scope="col">Run</th><th scope="col">State</th></tr><tr><td>A</td><td>Ready</td></tr></table>
    <label>Password <input type="password" value="fixture-ax-password-secret"></label>
    <iframe title="Details" src="${axFramePath}"></iframe>
    <iframe title="External" src="${foreignFrame}"></iframe>
    </main><script>
    document.querySelector('#apply').onclick = event => {
      if (!event.isTrusted) return;
      document.querySelector('[role=status]').textContent = 'Applied via trusted input';
      document.querySelector('#expired').remove();
      const added = document.createElement('button');
      added.textContent = 'New AX action';
      document.querySelector('[role=status]').after(added);
    };
    </script>`;
}

export async function verifyAccessibility({ tabId, prompt, readStatus }) {
  const get = since => ({ action: 'getAXState', tabId, since });
  const [initial] = await prompt([get()]);
  assert.equal(initial.kind, 'axState', JSON.stringify(initial));
  assert.equal(initial.full, true);
  assert.equal(initial.truncated, false);
  const node = (role, name) => initial.nodes.find(item => item.role === role && item.name === name);
  const byId = new Map(initial.nodes.map(item => [item.id, item]));
  assert.equal(byId.get(initial.rootId).role, 'RootWebArea');
  assert(node('heading', 'Accessibility review'));
  assert(node('region', 'Draft'));
  assert.equal(node('button', 'Archived action')?.state.disabled, true);
  assert(node('columnheader', 'State'));
  const frameAction = node('button', 'Same-origin frame action');
  assert(frameAction);
  assert.notEqual(frameAction.id.split('/')[0], initial.rootId.split('/')[0]);
  for (const item of initial.nodes) for (const child of item.children ?? []) assert(byId.has(child));
  assert.doesNotMatch(JSON.stringify(initial), /Foreign AX marker|fixture-ax-password-secret/);
  const removedNode = node('button', 'Remove from tree');
  assert(removedNode);

  const [, unchanged, click] = await prompt([
    { action: 'locate', tabId, locator: { by: 'role', role: 'button', name: 'Apply accessible update' } },
    get(initial.snapshotId),
    { action: 'click', tabId, name: 'Apply accessible update' },
  ]);
  assert.equal(unchanged.full, false, JSON.stringify(unchanged));
  assert.equal(unchanged.baseSnapshotId, initial.snapshotId);
  assert.deepEqual(unchanged.upserted, []);
  assert.deepEqual(unchanged.removed, []);
  assert.equal(click.outcome, 'dispatched', JSON.stringify(click));
  await expect.poll(readStatus).toBe('Applied via trusted input');
  const [delta] = await prompt([get(unchanged.snapshotId)]);
  assert.equal(delta.full, false, JSON.stringify(delta));
  assert(delta.upserted.some(node => node.name === 'Applied via trusted input'));
  assert(delta.upserted.some(node => node.name === 'New AX action'));
  assert(delta.removed.includes(removedNode.id));
  assert(!delta.upserted.some(node => node.id === frameAction.id));
  const [reload, refreshed] = await prompt([{ action: 'reload', tabId }, get(delta.snapshotId)]);
  assert.equal(reload.outcome, 'dispatched', JSON.stringify(reload));
  assert.equal(refreshed.full, true, JSON.stringify(refreshed));
  assert.equal(refreshed.baselineReset, true);
  assert(refreshed.nodes.some(node => node.name === 'Awaiting update'));
  return { fullNodes: initial.nodes.length, upserted: delta.upserted.length, removed: delta.removed.length,
    sameOriginFrame: true, foreignFrameExcluded: true, preservesDomRefs: true, resetsAfterReload: true };
}

export async function checkEmbeddedAccessibility({ app, origin, prompt, open, confirm, document }) {
  const tabId = origin + axPath;
  await open(tabId);
  await confirm(1);
  await expect.poll(async () => (await document(tabId))?.observation.notice).toBe('Browser Use allowed');
  const readStatus = () => app.evaluate(({ webContents }, url) => webContents
    .getAllWebContents().find(view => view.getURL() === url)
    .executeJavaScript("document.querySelector('[role=status]').textContent"), tabId);
  const evidence = await verifyAccessibility({ tabId, prompt, readStatus });
  const [, restored] = await prompt([{ action: 'closeTab', tabId }, { action: 'activate', tabId: origin + '/' }]);
  assert.equal(restored.kind, 'tabActivated');
  return evidence;
}

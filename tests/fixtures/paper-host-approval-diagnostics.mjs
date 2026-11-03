import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Test-fixture diagnostics only: bounded lifecycle metadata, never approval evidence.
export function observeApprovalStartup(app) {
  const events = [];
  const record = (id, kind, detail = {}) => { if (events.length < 64) events.push({ id, kind, ...detail }); };
  app.on('browser-window-created', (_event, window) => {
    const id = window.id, contents = window.webContents;
    record(id, 'created');
    for (const kind of ['show', 'closed', 'unresponsive']) window.on(kind, () => record(id, kind));
    for (const kind of ['did-start-loading', 'dom-ready', 'did-finish-load', 'did-stop-loading'])
      contents.on(kind, () => record(id, kind));
    contents.on('did-fail-load', (_event, code, description, _url, mainFrame) => record(id, 'did-fail-load', { code, mainFrame, description: description.slice(0, 200) }));
    contents.on('preload-error', (_event, _path, error) => record(id, 'preload-error', { error: error.name, message: error.message.slice(0, 300) }));
    contents.on('render-process-gone', (_event, details) => record(id, 'render-process-gone', { reason: details.reason }));
  });
  return events;
}

// These callbacks execute in the authored Electron main process, not a renderer.
export function approvalStartupState({ BrowserWindow }) {
  return {
    state: globalThis.paperHostApproval.state(), events: globalThis.paperHostApproval.events,
    windows: BrowserWindow.getAllWindows().slice(0, 8).map(window => ({
      id: window.id, title: window.getTitle(), visible: window.isVisible(), modal: window.isModal(),
      parentId: window.getParentWindow()?.id, loading: window.webContents.isLoading(),
      urlScheme: window.webContents.getURL().split(':')[0],
    })),
  };
}

export async function captureOwnedApproval({ BrowserWindow }) {
  const ownerId = globalThis.paperHostApproval.state().ownerId;
  const matches = BrowserWindow.getAllWindows().filter(window => window.getTitle() === 'Paper reproduction' && window.getParentWindow()?.id === ownerId);
  if (matches.length !== 1) return { skipped: 'no unique owned approval window' };
  const pixels = await matches[0].webContents.capturePage();
  return { windowId: matches[0].id, empty: pixels.isEmpty(), png: pixels.toPNG().toString('base64') };
}

export async function saveApprovalStartup(application, out, stage) {
  const state = await application.evaluate(approvalStartupState);
  await writeFile(join(out, `${stage}-startup.json`), JSON.stringify(state, null, 2));
  let timer;
  const source = 'owned renderer diagnostic only; not native approval evidence';
  try {
    const capture = await Promise.race([
      application.evaluate(captureOwnedApproval),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Owned diagnostic capture timed out')), 2000); }),
    ]);
    const { png, ...metadata } = capture;
    if (png) {
      const bytes = Buffer.from(png, 'base64');
      await writeFile(join(out, `${stage}-startup.png`), bytes);
      metadata.sha256 = createHash('sha256').update(bytes).digest('hex');
    }
    await writeFile(join(out, `${stage}-startup-image.json`), JSON.stringify({ source, ...metadata }, null, 2));
  } catch (error) {
    await writeFile(join(out, `${stage}-startup-image.json`), JSON.stringify({ source, error: error.message }, null, 2));
  } finally { clearTimeout(timer); }
}
